import test from 'node:test';
import assert from 'node:assert/strict';
import { LiquidityClient, parseSalesTable, LIQUIDITY_MARKETS } from '../src/liquidity.mjs';

const now = Date.parse('2026-11-17T12:00:00Z');
const table = (faction = 'alliance', at = now) => `AHL1|forever/pvp/${faction}/us|${at / 1000}|3\n2770:20:18:3420:22:21:18:25:12345\n2447:20:18:3420:22:21:18:25:0\n2771:20:18:3420:22:21:18:25:\n`;

test('AHledger table scales estimated units/day correctly, including zero and missing coverage', () => {
  const result = parseSalesTable(table(), LIQUIDITY_MARKETS.alliance, now);
  assert.equal(result.items[2770], 1234.5);
  assert.equal(result.items[2447], 0);
  assert.equal(result.items[2771], undefined);
  assert.equal(result.observedAt, '2026-11-17T12:00:00.000Z');
  for (const body of [table('horde'), table().replace('forever', 'classic'), table().replace('|3', '|4'),
    table().replace(':12345', ':NaN'), table().replace(':12345', ':-10'), table('alliance', now + 120_000), table('alliance', now - 31 * 86_400_000)]) {
    assert.throws(() => parseSalesTable(body, LIQUIDITY_MARKETS.alliance, now));
  }
});

test('two public requests, no credentials, subset responses and cache age honored without disk storage', async (t) => {
  let clock = now;
  const calls = [];
  const client = new LiquidityClient({ now: () => clock, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(table(url.includes('alliance') ? 'alliance' : 'horde'), { headers: { 'Cache-Control': 'public, max-age=120', Age: '30' } });
  } });
  t.after(() => client.dispose());
  const result = await client.get([2770, 2771]);
  assert.equal(calls.length, 2);
  assert.equal(result.markets.alliance.expiresAt, now + 90_000);
  assert.deepEqual(result.markets.alliance.items, { 2770: 1234.5 });
  assert.ok(calls.every(({ url, options }) => url.startsWith('https://api.ahledger.com/v1/pricetable/forever.pvp.') && options.headers.Authorization === undefined));
  await client.get([2770]); assert.equal(calls.length, 2);
  clock += 90_001;
  await client.get([2770]); assert.equal(calls.length, 4);
});

test('concurrent readers share requests, Retry-After prevents early retries and malformed sources stay unavailable', async (t) => {
  let clock = now, calls = 0;
  const client = new LiquidityClient({ now: () => clock, fetchImpl: async () => {
    calls++; return new Response('', { status: 429, headers: { 'Retry-After': '300' } });
  } });
  t.after(() => client.dispose());
  const [a, b] = await Promise.all([client.get([2770]), client.get([2770])]);
  assert.equal(calls, 2);
  assert.equal(a.markets.alliance.status, 'unavailable');
  assert.deepEqual(a, b);
  assert.equal(client.cache.size, 0);
  clock += 299_999;
  await client.get([2770]); assert.equal(calls, 2);
  clock += 2;
  client.fetch = async (url) => { calls++; return new Response(table('horde'), { headers: { 'Cache-Control': 'max-age=120' } }); };
  const result = await client.get([2770]);
  assert.equal(calls, 4);
  assert.equal(result.markets.alliance.status, 'unavailable');
  assert.equal(result.markets.horde.status, 'ok');
});

test('no-store, no-cache and expired HTTP cache entries are never retained or reused', async (t) => {
  for (const headers of [{ 'Cache-Control': 'no-store, max-age=120' }, { 'Cache-Control': 'no-cache, max-age=120' },
    { 'Cache-Control': 'max-age=120', Age: '120' }, { 'Cache-Control': 'max-age=120', Date: new Date(now - 120_000).toUTCString() }]) {
    const client = new LiquidityClient({ now: () => now, fetchImpl: async (url) => new Response(table(url.includes('alliance') ? 'alliance' : 'horde'), { headers }) });
    t.after(() => client.dispose());
    const result = await client.get([2770]);
    assert.equal(result.markets.alliance.status, 'unavailable');
    assert.equal(client.cache.size, 0);
  }
});
