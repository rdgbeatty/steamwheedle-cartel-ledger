import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { BlizzardClient } from '../../src/blizzard.mjs';
import { BudgetError } from '../../src/request-budget.mjs';
import { collectCatalog } from '../../src/catalog.mjs';
import { FACTIONS, mergeRows } from '../../src/market.mjs';
import { US_PVP } from '../../shared/market.mjs';
import { bookParts, captureHouse, SHARDS, unpackBlock } from './stream-book.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR, RETENTION = 30 * DAY;
const CATALOG_KEY = 'collector-catalog-v1';
const SCHEDULE_KEY = 'scheduled-collection';
export const MAX_SNAPSHOT = 8 * 1024 * 1024;

export class MarketCollector extends DurableObject {
  async run({ force = false, scheduledTime } = {}) {
    if (this.running) return { status: 'busy' };
    this.running = true;
    try {
      if (scheduledTime === undefined) return await this.collect({ force, revalidate: false });

      const hour = Math.floor(scheduledTime / HOUR);
      const retry = new Date(scheduledTime).getUTCMinutes() === 45;
      const previous = await this.ctx.storage.get(SCHEDULE_KEY);
      if (previous?.hour > hour) return { status: 'skipped' };
      if (previous?.hour === hour) {
        if (!retry || previous.retry || ['published', 'unchanged', 'credentials-required'].includes(previous.status))
          return { status: 'skipped' };
        if (previous.retryAt > Date.now()) return { status: 'deferred', retryAt: previous.retryAt };
      }

      // Persist the attempt before collecting so an interrupted run still has a retry limit.
      const attempt = { hour, retry, status: 'started' };
      await this.ctx.storage.put(SCHEDULE_KEY, attempt);
      const result = await this.collect({ force, revalidate: true });
      await this.ctx.storage.put(SCHEDULE_KEY, { ...attempt, status: result.status, retryAt: result.retryAt ?? 0 });
      return result;
    } finally {
      this.running = false;
    }
  }

  async collect({ force, revalidate }) {
    const startedAt = Date.now();
    const control = this.env.CONTROL.getByName('live');
    const previous = await this.ctx.storage.get('published');
    // A binding-level failure aborts the run before another upstream call.
    const budget = {
      async take() {
        const { accepted, retryAt } = await control.budget('take');
        if (!accepted) throw new BudgetError('The shared Blizzard budget is cooling down.', retryAt);
      },
      defer: (until) => control.budget('defer', until)
    };
    const client = new BlizzardClient({
      clientId: this.env.BLIZZARD_CLIENT_ID,
      clientSecret: this.env.BLIZZARD_CLIENT_SECRET
    }, { cacheBodies: false, budget });
    if (!this.env.BLIZZARD_CLIENT_ID || !this.env.BLIZZARD_CLIENT_SECRET)
      return { status: 'credentials-required' };

    const houses = {};
    const failures = [];
    let phase = 'markets';
    try {
      for (const [faction, house] of Object.entries(US_PVP.houses)) {
        const checked = Date.now();
        try {
          const prior = await this.env.EXPIRY.get('prior-' + house, 'json');
          const result = !force && !revalidate && prior?.documents?.every((doc) => doc.freshUntil > checked)
            ? { ...prior, unchanged: true, cached: true }
            : await captureHouse(client, house, prior, { force });
          if (!Number.isSafeInteger(result.source) || result.source <= Date.now() - RETENTION)
            throw Error('Missing or expired market source.');
          const day = this.env.BOOKS.getByName('forever-us-pvp/' + Math.floor(result.source / DAY));
          if (result.frame) {
            await day.writePublication({ house, source: result.source, version: result.version, checked: Date.now() }, result.frame);
          }
          const { version, source, documents } = result;
          if (!result.cached) {
            await this.env.EXPIRY.put('prior-' + house, JSON.stringify({ version, source, documents }), {
              expiration: Math.floor((source + RETENTION) / 1000)
            });
          }
          await control.check(house, checked, source, result.cached ? 'cached' : result.unchanged ? 'unchanged' : 'changed');
          houses[faction] = { id: house, status: 'ok', observedAt: new Date(source).toISOString(), version };
        } catch (error) {
          if (error instanceof BudgetError) throw error;
          // Only report controlled errors. Upstream and runtime messages can contain request data.
          failures.push({ house, ...(error.name === 'ApiError' ? { reason: error.message } : {}) });
          await control.check(house, checked, null, 'failed').catch(() => {});
        }
      }
      if (failures.length) return { status: 'incomplete', failures };
      phase = 'catalog';
      let catalog = await this.env.EXPIRY.get(CATALOG_KEY, 'json');
      if (!catalog || Date.parse(catalog.generatedAt) <= startedAt - DAY ||
          Date.parse(catalog.retainedAt) <= startedAt - RETENTION) {
        catalog = await collectCatalog(client);
        await this.env.EXPIRY.put(CATALOG_KEY, JSON.stringify(catalog), {
          expiration: Math.floor((Date.parse(catalog.retainedAt) + RETENTION) / 1000)
        });
      }
      const versions = FACTIONS.map((name) => houses[name].version);
      if (!force && previous?.catalog === catalog.generatedAt &&
          versions.every((version, index) => version === previous.versions[index]))
        return { status: 'unchanged', requests: client.requests };
      phase = 'read-history';
      const frames = {};
      for (const faction of FACTIONS) {
        const { id, observedAt, version } = houses[faction];
        const source = Date.parse(observedAt);
        const day = this.env.BOOKS.getByName('forever-us-pvp/' + Math.floor(source / DAY));
        frames[faction] = bookParts(await day.readPublication(id, source, version));
      }
      phase = 'snapshot';
      const { body, rows, retainedAt } = await encodeSnapshot(houses, frames, catalog, startedAt);
      const digest = createHash('sha256').update(body).digest('hex');
      const result = await control.publishSnapshot({ startedAt, retainedAt, digest }, body);
      await this.ctx.storage.put('published', { catalog: catalog.generatedAt, versions });
      return { status: result.reused ? 'unchanged' : 'published', rows, bytes: body.length, requests: client.requests };
    } catch (error) {
      if (error instanceof BudgetError) return { status: 'deferred', retryAt: error.retryAt };
      return { status: 'failed', phase, ...(error.name === 'ApiError' ? { reason: error.message } : {}) };
    } finally {
      client.dispose();
    }
  }
}

function quoteFor([itemId, variant, minBuyout, buyoutUnits], [units, bidOnlyAuctions, levels], depth) {
  let cumulative = 0, buyoutAuctions = 0, medianBuyout = null;
  for (const [price, quantity, count] of levels) {
    cumulative += quantity;
    buyoutAuctions += count;
    if (medianBuyout === null && cumulative >= buyoutUnits / 2) medianBuyout = price;
  }
  const quote = { itemId, variant, units, buyoutUnits, auctions: buyoutAuctions + bidOnlyAuctions, bidOnlyAuctions,
    buyoutAuctions, minBuyout, medianBuyout };
  if (depth) quote.priceLevels = levels.map(([unitPrice, quantity, listingCount, totalBuyout]) =>
    ({ unitPrice, quantity, listingCount, totalBuyout }));
  return quote;
}

export async function encodeSnapshot(houses, frames, catalog, now = Date.now()) {
  const retainedAt = Math.min(Date.parse(catalog.retainedAt), ...Object.values(houses).map((h) => Date.parse(h.observedAt)));
  if (!(retainedAt > now - RETENTION)) throw Error('Cannot publish an expired market snapshot.');
  const header = {
    publicVersion: 1, mode: 'live', game: US_PVP.game, region: US_PVP.region, ruleset: US_PVP.ruleset,
    market: US_PVP, generatedAt: new Date(now).toISOString(), retainedAt: new Date(retainedAt).toISOString(),
    neutralDepthVersion: 1, houses
  };
  const catalogBuckets = Array.from({ length: SHARDS }, () => []);
  for (const item of catalog.items) catalogBuckets[item.id % SHARDS].push(item);

  const encoder = new TextEncoder();
  let shard = 0, rows = 0, count = 0, unknownCount = 0;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"snapshot":' + JSON.stringify(header).slice(0, -1) + ',"rows":['));
    },
    pull(controller) {
      while (shard < SHARDS) {
        const bucket = {};
        for (const faction of FACTIONS) {
          const [chart, depth] = frames[faction][shard].map(unpackBlock);
          bucket[faction] = { status: 'ok', quotes: chart.map((entry, i) => quoteFor(entry, depth[i], faction === 'neutral')) };
        }
        const batch = mergeRows({ items: catalogBuckets[shard++] }, bucket);
        count += new Set(batch.map(({ id }) => id)).size;
        unknownCount += new Set(batch.filter((row) => row.metadataSource === 'auction').map(({ id }) => id)).size;
        if (batch.length) {
          controller.enqueue(encoder.encode((rows ? ',' : '') + JSON.stringify(batch).slice(1, -1)));
          rows += batch.length;
          return;
        }
      }
      const info = {
        scope: catalog.scope, count, metadataCount: catalog.items.length, unknownCount,
        coverage: catalog.coverage, warnings: catalog.warnings, generatedAt: catalog.generatedAt, retainedAt: catalog.retainedAt
      };
      const warnings = [...catalog.warnings];
      if (unknownCount) warnings.push(`${unknownCount} auctioned items have no Forever catalog record. Search them by item ID under Unknown.`);
      controller.enqueue(encoder.encode('],"catalog":' + JSON.stringify(info) + ',"warnings":' + JSON.stringify(warnings) + '}}'));
      controller.close();
    }
  });
  const compressed = source.pipeThrough(new CompressionStream('gzip'));
  const chunks = [];
  let bytes = 0;
  for await (const chunk of compressed) {
    bytes += chunk.length;
    if (bytes > MAX_SNAPSHOT) throw Error('Compressed snapshot exceeded the upload limit.');
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks, bytes), rows, retainedAt };
}
