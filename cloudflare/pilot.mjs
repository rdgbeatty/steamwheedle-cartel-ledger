import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HOUR, WINDOW, SHARDS, HOUSES, seriesFor } from './format.mjs';
import { fixtureBlock, fixtureQuote, sourceHour } from './fixture.mjs';
import assert from 'node:assert/strict';

export function prepare(start, hours) {
  const blocks = Array.from({ length: SHARDS }, (_, shard) => fixtureBlock(shard, start, hours));
  const digests = blocks.map((bytes) => createHash('sha256').update(bytes).digest('hex'));
  return { blocks, batch: { start, hours, digests } };
}

export async function parallelRange(length, fn) {
  let next = 0;
  async function work() {
    while (next < length) {
      const i = next++;
      await fn(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, length) }, work));
}

export function createClient(origin, token) {
  const target = new URL(origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (
    target.username ||
    target.password ||
    target.origin !== origin ||
    !(
      (local && target.protocol === 'http:') ||
      (target.protocol === 'https:' &&
        /^gathering-ledger-staging\.[a-z0-9-]+\.workers\.dev$/.test(target.hostname))
    )
  ) {
    throw new Error('Set MARKET_API_URL to the staging workers.dev origin or an HTTP loopback origin.');
  }
  if (!token || token.length < 32)
    throw new Error('Set MARKET_INGEST_TOKEN to the staging ingestion secret.');
  return async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(origin + path, {
          method,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            ...(method === 'POST' ? { authorization: 'Bearer ' + token } : {}),
            'user-agent': 'GatheringLedger-Staging/1'
          }
        });
      } catch (error) {
        if (attempt >= 2) throw error;
      }
      if (response?.ok) return response.json();
      if (response && (response.status < 500 || attempt >= 2)) {
        throw new Error(method + ' ' + path + ' returned ' + response.status);
      }
      await response?.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  };
}

export async function publish(request, { batch, blocks }) {
  const { generation, committed } = await request('/api/ingest/begin', JSON.stringify(batch));
  if (!committed) {
    await parallelRange(SHARDS, (shard) => request('/api/ingest/' + generation + '/' + shard, blocks[shard]));
    await request('/api/ingest/' + generation + '/commit', '');
  }
  return generation;
}

export function verifyChart(chart) {
  assert.equal(chart.dataset, 'synthetic-v1');
  const series = seriesFor(chart.item, chart.variant);
  let prior = chart.first - 1;
  for (const { hour, quotes } of chart.points) {
    assert.ok(hour > prior && hour <= chart.last);
    prior = hour;
    assert.deepEqual(
      quotes,
      HOUSES.map((house, market) => {
        const source = sourceHour(hour, market);
        return { house, publication: source < 0 ? null : source, ...fixtureQuote(series, market, source) };
      })
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--days'))
    throw new Error('Usage: npm run pilot -- [--days 1..90]');
  const days = Number(args[1] ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Choose 1 to 90 days.');
  const request = createClient(
    process.env.MARKET_API_URL ?? 'http://127.0.0.1:8787',
    process.env.MARKET_INGEST_TOKEN
  );
  const status = await request('/api/status');
  assert.equal(status.dataset, 'synthetic-v1');
  const now = Math.floor(Date.now() / HOUR),
    oldest = now - WINDOW + 1;
  const first = now - days * 24 + 1;
  // Start shorter seeds at UTC midnight so a later, wider seed can reuse the entire day.
  const seedStart = Math.max(oldest, 24 * Math.floor(first / 24));
  const committedEnds = new Map(status.dates.map((row) => [row.day, row.endHour]));
  for (let day = Math.floor(seedStart / 24); day <= Math.floor(now / 24); day++) {
    const start = Math.max(day * 24, seedStart, (committedEnds.get(day) ?? -1) + 1);
    const end = Math.min(now, day * 24 + 23);
    if (start > end) continue;
    await publish(request, prepare(start, end - start + 1));
    console.log('Published fixture through ' + new Date(end * HOUR).toISOString());
  }
  const readStarted = performance.now();
  const chart = await request('/api/history?item=3820&days=' + days);
  const chartRoundTripMs = Math.round(performance.now() - readStarted);
  verifyChart(chart);
  // UTC midnight/expiry may advance during a long seed.
  const expectedFirst = Math.max(first, chart.first);
  assert.equal(
    chart.points.filter((p) => p.hour >= expectedFirst && p.hour <= now).length,
    now - expectedFirst + 1
  );
  const sizes = Array(SHARDS);
  await parallelRange(SHARDS, async (shard) => {
    sizes[shard] = (await request('/api/ingest/size/' + shard, '')).bytes;
  });
  console.log(
    JSON.stringify(
      {
        dataset: chart.dataset,
        verifiedHours: chart.points.length,
        chartRowsRead: chart.rowsRead,
        chartRoundTripMs,
        historyDatabaseBytes: sizes.reduce((a, b) => a + b, 0),
        largestHistoryDatabaseBytes: Math.max(...sizes)
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
