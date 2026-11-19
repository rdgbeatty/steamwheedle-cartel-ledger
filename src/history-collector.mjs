import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { reduceHouse } from './market.mjs';
import { ALL_ITEMS_SCOPE } from '../shared/items.mjs';
import { US_PVP } from '../shared/market.mjs';

export const BOOK_HOUSES = Object.values(US_PVP.houses);
export const SHARDS = 32;
const DAY = 86_400_000;

// Capture the two feeds as one market. Only the anonymous price ladder leaves this function.
export async function collectBook(client, house, prior = null) {
  if (!BOOK_HOUSES.includes(house)) throw new Error('Unknown Forever US PvP house.');
  const path = '/data/wow/ruleset/1/auctions/' + house;
  const endings = ['', '/commodities'];
  const docs = [];
  for (const [i, ending] of endings.entries()) {
    docs.push(await client.get(path + ending, { validators: prior?.documents?.[i], revalidate: true }));
  }
  const metadata = () =>
    docs.map(({ lastModified, etag, retainedAt, observedAt, freshUntil }) => ({
      lastModified,
      etag,
      retainedAt,
      observedAt,
      freshUntil
    }));
  if (docs.every((doc) => doc.notModified) && prior) return { unchanged: true, documents: metadata() };
  for (const [i, doc] of docs.entries()) {
    if (doc.data === null) docs[i] = await client.get(path + endings[i], { forceBody: true });
  }
  for (const [i, doc] of docs.entries()) {
    const old = prior?.documents?.[i];
    if (
      old &&
      ((doc.etag && old.etag === doc.etag) ||
        (!doc.etag && doc.lastModified && old.lastModified === doc.lastModified))
    ) {
      doc.retainedAt = new Date(
        Math.min(Date.parse(doc.retainedAt), Date.parse(old.retainedAt))
      ).toISOString();
    }
  }
  const retained = docs.map((doc) => Date.parse(doc.retainedAt));
  if (!retained.every(Number.isFinite) || Math.min(...retained) <= Date.now() - 30 * DAY) {
    throw new Error('Missing or expired market source.');
  }
  const { quotes } = reduceHouse(docs, { scope: ALL_ITEMS_SCOPE, items: [] }, house, { priceDepth: true });
  const records = quotes.map((q) => [
    q.itemId,
    q.variant,
    q.units,
    q.bidOnlyAuctions,
    q.priceLevels.map((p) => [p.unitPrice, p.quantity, p.listingCount, p.totalBuyout])
  ]);
  records.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  const documents = metadata();
  const content = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const source = Math.min(...retained);
  const version = createHash('sha256')
    .update(JSON.stringify([house, content, documents.map((d) => d.lastModified || d.etag || content)]))
    .digest('hex');
  if (version === prior?.version)
    return {
      unchanged: true,
      documents: documents.map((doc, i) => ({ ...doc, retainedAt: prior.documents[i].retainedAt }))
    };
  return { house, version, source, documents, records };
}

// Store stock and minimum separately to let chart readers skip all the price levels.
export function splitBook(records) {
  const shards = Array.from({ length: SHARDS }, () => ({ quotes: [], levels: [] }));
  for (const [id, variant, units, bidOnly, levels] of records) {
    const shard = shards[id % SHARDS];
    const stock = levels.reduce((sum, level) => sum + level[1], 0);
    shard.quotes.push([id, variant, levels[0]?.[0] ?? null, stock]);
    shard.levels.push([units, bidOnly, levels]);
  }
  return shards.map(({ quotes, levels }) => {
    const chart = deflateSync(JSON.stringify(quotes));
    const depth = deflateSync(JSON.stringify(levels));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(chart.length);
    return Buffer.concat([header, chart, depth]);
  });
}
