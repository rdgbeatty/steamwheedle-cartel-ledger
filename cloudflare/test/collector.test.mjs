import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare';
import { reduceHouse } from '../../src/market.mjs';
import { ALL_ITEMS_SCOPE } from '../../shared/items.mjs';

const HOUR = 3600_000;
const scope = { scope: ALL_ITEMS_SCOPE, items: [] };

function auction(index, house) {
  const id = index % 31_991 + 1;
  const quantity = index % 20 + 1;
  const price = (index % 1093) + house;
  const item = index % 19 ? { id } : { id, bonus_lists: [400, 100] };
  const row = { id: 2 ** 40 + index, item, quantity, time_left: 'LONG' };
  if (index % 11 === 0) row.bid = price * quantity;
  else if (index % 3) row.buyout = price * quantity + index % quantity;
  else row.unit_price = price;
  return row;
}

function* listings(total, house, commodities) {
  for (let i = 0; i < total; i++) {
    if (commodities ? i % 3 !== 0 && i % 50 !== 0 : i % 3 === 0) continue;
    yield auction(i, house);
  }
}

function marketBody(house, entries) {
  let first = true, started = false;
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      let chunk = '';
      if (!started) {
        chunk += '{"auctions":[';
        started = true;
      }
      while (chunk.length < 32 * 1024) {
        const next = entries.next();
        if (next.done) {
          chunk += '],"id":' + house + '}';
          controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += (first ? '' : ',') + JSON.stringify(next.value);
        first = false;
      }
      controller.enqueue(encoder.encode(chunk));
    }
  });
}

test('Workers replay streams books, commits history and preserves the last good snapshot', { timeout: 150_000 }, async (t) => {
  const { outputFiles: [bundle] } = await build({
    entryPoints: [fileURLToPath(new URL('../live/worker.mjs', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:*'], write: false
  });
  const ingest = randomBytes(32).toString('hex');
  const source = Math.floor((Date.now() - HOUR) / HOUR) * HOUR + 120_000;
  const totals = { 110: Number(process.env.REPLAY_AUCTIONS ?? 20_000), 113: 6_000, 116: 2_500 };
  let invalidate = false, conditional = 0, tokens = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'collector-replay', compatibilityDate: '2026-11-01', compatibilityFlags: ['nodejs_compat'], modules: true, script: bundle.text,
    durableObjects: {
      BOOKS: { className: 'BookDay', useSQLite: true },
      CONTROL: { className: 'LiveControl', useSQLite: true },
      COLLECTOR: { className: 'MarketCollector', useSQLite: true }
    },
    kvNamespaces: ['EXPIRY', 'LATEST'],
    bindings: { BLIZZARD_CLIENT_ID: 'fixture-id', BLIZZARD_CLIENT_SECRET: 'fixture-secret', MARKET_INGEST_TOKEN: ingest },
    outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === 'oauth.battle.net') {
        tokens++;
        return Response.json({ access_token: 'fake-token', expires_in: 3600 });
      }
      assert.equal(url.hostname, 'us.api.blizzard.com');
      if (url.pathname.endsWith('/search/item')) {
        return Response.json({ results: [{ data: {
          id: 1, name: 'Fixture Herb', item_class: { id: 7 }, item_subclass: { id: 9 }
        } }] });
      }
      const [, id, commodities] = url.pathname.match(/\/auctions\/(110|113|116)(\/commodities)?$/);
      const house = Number(id);
      const headers = {
        'last-modified': new Date(source).toUTCString(),
        'cache-control': 'no-cache',
        etag: '"' + id + (commodities ?? '') + '"',
        'content-type': 'application/json'
      };
      if (request.headers.has('if-none-match')) {
        conditional++;
        assert.equal(request.headers.get('if-none-match'), headers.etag);
        return new Response(null, { status: 304, headers });
      }
      if (invalidate && !commodities && house === 110)
        return new Response('{"id":110,"auctions":{}}', { headers });
      return new Response(marketBody(house, listings(totals[id], house, commodities)), { headers });
    }
  }));
  t.after(() => mf.dispose());

  const fetch = (path, options) => mf.dispatchFetch('http://market.test' + path, options);
  const run = (force = '') => fetch('/api/collector/run' + force, { method: 'POST', headers: { authorization: 'Bearer ' + ingest } });
  const unauthorized = await fetch('/api/collector/run', { method: 'POST' });
  assert.equal(await unauthorized.json().then(({ error }) => error), 'Unauthorized');
  assert.equal(unauthorized.status, 401);
  const initialRun = await run();
  const result = await initialRun.json();
  assert.equal(initialRun.status, 200, JSON.stringify(result));
  assert.equal(result.status, 'published');
  assert.equal(result.requests, 8);
  assert.equal(tokens, 1);
  assert.ok(result.rows >= 5_000 && result.bytes > 0);

  const response = await fetch('/api/snapshot');
  const published = response.headers.get('etag');
  assert.ok(published);
  const { snapshot } = await response.json();
  assert.equal(snapshot.rows.length, result.rows);
  assert.equal(snapshot.catalog.metadataCount, 1);
  assert.equal(snapshot.retainedAt, new Date(source).toISOString());
  assert.equal(snapshot.rows.find(({ key }) => key === '1:').name, 'Fixture Herb');
  const reference = reduceHouse([false, true].map((f) => ({
    data: { id: 116, auctions: Array.from(listings(totals[116], 116, f)) }
  })), scope, 116);
  const quotes = new Map(snapshot.rows.map(({ key, quotes }) => [key, quotes.neutral]));
  for (const quote of reference.quotes) assert.deepEqual(quotes.get(quote.itemId + ':' + quote.variant), quote);

  const hour = Math.floor(source / HOUR);
  const chart = await fetch('/api/history?item=2&from=' + hour + '&to=' + hour);
  assert.equal(chart.status, 200);
  const pagesOrigin = 'https://rdgbeatty.github.io';
  assert.equal(chart.headers.get('access-control-allow-origin'), pagesOrigin);
  const invalidChart = await fetch('/api/history?item=0');
  assert.equal(invalidChart.status, 400);
  assert.equal(invalidChart.headers.get('access-control-allow-origin'), pagesOrigin);
  await invalidChart.json();
  assert.equal((await chart.json()).points.length, 3);
  const order = await (await fetch('/api/book?house=116&item=2&from=' + hour + '&to=' + hour)).json();
  assert.deepEqual(order.points[0].book, [2, 0, [[117.5, 2, 1, 235]]]);
  assert.equal((await (await run()).json()).status, 'unchanged');
  assert.equal(conditional, 6);

  invalidate = true;
  const failed = await run('?force=1');
  assert.equal(failed.status, 502);
  assert.deepEqual((await failed.json()).failures.map(({ house }) => house), [110]);
  assert.equal((await fetch('/api/snapshot', { headers: { 'if-none-match': published } })).status, 304);
});
