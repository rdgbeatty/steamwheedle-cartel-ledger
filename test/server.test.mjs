import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalServer } from '../src/server.mjs';
import { readCredentials, readRecent, writeJson, DAY } from '../src/store.mjs';
import { fakeClient, selected, document } from './fixtures.mjs';
import { localTransport } from './http-harness.mjs';

async function local(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forever-test-'));
  const client = fakeClient(), original = client.get;
  client.get = async function (path, options) {
    const doc = await original.call(this, path, options);
    if (doc.observedAt) doc.observedAt = new Date(Date.now() - 3_600_000).toISOString();
    return doc;
  };
  let clock = Date.now();
  const server = createLocalServer({ directory, env: {}, clientFactory: () => client, now: () => clock, ...extra });
  const origin = 'http://127.0.0.1:4174';
  const fetch = localTransport(server, origin);
  t.after(async () => {
    server.stopJobs(); await server.waitForIdle();
    await rm(directory, { recursive: true, force: true });
  });
  const status = async () => (await fetch(`${origin}/api/status`)).json();
  const post = async (path, body = {}, headers = {}) => fetch(`${origin}${path}`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Local-CSRF': (await status()).csrf, ...headers }, body: JSON.stringify(body),
  });
  return { directory, client, server, origin, status, post, fetch, now: () => clock, advance: (ms) => { clock += ms; } };
}

test('localhost setup to collection: saved credentials, live table, repeat refresh, last-good recovery', async (t) => {
  const app = await local(t);
  assert.equal((await app.status()).configured, false);
  assert.equal((await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json())).snapshot, null);
  const setup = await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'test-secret-never-returned' });
  assert.equal(setup.status, 202);
  await app.server.waitForIdle();
  const state = await app.status();
  assert.equal(state.job.state, 'complete');
  assert.deepEqual(state.settings.selected, selected);
  assert.ok(!JSON.stringify(state).includes('test-secret'));
  const stored = JSON.parse(await readFile(join(app.directory, 'private', 'credentials.json'), 'utf8'));
  assert.equal(stored.clientSecret, 'test-secret-never-returned');
  assert.equal((await stat(join(app.directory, 'private', 'credentials.json'))).mode & 0o777, 0o600);
  const snapshot = await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json());
  assert.equal(snapshot.snapshot.rows.length, 4);
  assert.equal(snapshot.snapshot.catalog.scope, 'all-items');
  assert.equal(snapshot.snapshot.mode, 'live');
  assert.equal(snapshot.snapshot.neutralDepthVersion, 1);
  assert.deepEqual(snapshot.snapshot.rows.find((row) => row.id === 2770).quotes.neutral.priceLevels,
    [{ unitPrice: 116, quantity: 20, listingCount: 1, totalBuyout: 2320 }]);
  assert.equal(snapshot.snapshot.rows.find((row) => row.id === 2770).quotes.alliance.minBuyout, 110);
  assert.ok(!JSON.stringify(snapshot).includes('test-secret'));
  assert.ok(!JSON.stringify(snapshot).includes('unit_price'));
  app.client.failBooks = true;
  app.advance(5 * 60_000 + 1);
  const retry = await app.post('/api/collect', { selected });
  assert.equal(retry.status, 202);
  await app.server.waitForIdle();
  assert.equal((await app.status()).job.state, 'failed');
  assert.deepEqual(await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json()), snapshot);
  await app.post('/api/forget');
  assert.equal((await app.status()).configured, false);
});

test('secrets and private state are not served; Host, Origin and CSRF checks protect mutations', async (t) => {
  const app = await local(t);
  for (const path of ['/private/credentials.json', '/.wow-local/private/credentials.json', '/src/server.mjs']) {
    assert.equal((await app.fetch(`${app.origin}${path}`)).status, 404);
  }
  assert.equal((await app.post('/api/setup', {}, { 'X-Local-CSRF': 'wrong' })).status, 403);
  assert.equal((await app.post('/api/setup', {}, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await app.fetch(`${app.origin}/api/status`, { headers: { Host: 'attacker.invalid' } })).status, 403);
  assert.equal((await app.post('/api/collect', { selected })).status, 400);
  assert.equal((await app.post('/api/setup', { clientId: 'short' })).status, 400);
  const html = await app.fetch(app.origin);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /connect-src 'self'/);
  for (const asset of ['/app.mjs', '/format.mjs', '/collection.mjs', '/category-filter.mjs', '/styles.css', '/market-table.css', '/shared/market.mjs', '/shared/resale.mjs', '/shared/trade.mjs', '/shared/items.mjs']) assert.equal((await app.fetch(`${app.origin}${asset}`)).status, 200);
});

test('changing client ID requires a new secret and the secret is never echoed', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'first-client', clientSecret: 'private-one' });
  await app.server.waitForIdle();
  const response = await app.post('/api/setup', { clientId: 'second-client', clientSecret: '' });
  assert.equal(response.status, 400);
  assert.equal((await app.status()).clientId, 'first-client');
  app.advance(5 * 60_000 + 1);
  assert.equal((await app.post('/api/setup', { clientId: 'first-client', clientSecret: '' })).status, 202);
  await app.server.waitForIdle();
  assert.ok(!JSON.stringify(await app.status()).includes('private-one'));
});

test('demo is explicit and cannot overwrite a live snapshot', async (t) => {
  const app = await local(t);
  const demo = await app.fetch(`${app.origin}/api/demo`).then((response) => response.json());
  assert.equal(demo.snapshot.mode, 'demo');
  assert.equal(demo.snapshot.rows.length, 12);
  assert.equal((await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json())).snapshot, null);
  assert.equal(app.client.calls.length, 0);
});

test('concurrent setup requests cannot race credential writes', async (t) => {
  const app = await local(t);
  const results = await Promise.all([
    app.post('/api/setup', { clientId: 'first-client', clientSecret: 'first-secret' }),
    app.post('/api/setup', { clientId: 'second-client', clientSecret: 'second-secret' }),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [202, 409]);
  await app.server.waitForIdle();
  const accepted = results[0].status === 202 ? 'first-client' : 'second-client';
  assert.equal((await app.status()).clientId, accepted);
});

test('US PvP lock migrates old settings, rejects another house and hides incompatible cached data', async (t) => {
  const app = await local(t);
  const now = new Date().toISOString();
  await writeJson(join(app.directory, 'settings.json'), {
    selected: { alliance: 111, horde: 114, neutral: 117 },
    discovery: { houses: [{ id: 110, faction: 'alliance' }, { id: 111, faction: 'alliance' }, { id: 113, faction: 'horde' }, { id: 116, faction: 'neutral' }] },
  });
  assert.deepEqual((await app.status()).settings.selected, selected);
  assert.equal((await app.status()).market.locked, true);
  const initialCalls = app.client.calls.length;
  const rejected = await app.post('/api/collect', { selected: { ...selected, alliance: 111 } });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /locked to US PvP/);
  assert.equal(app.client.calls.length, initialCalls);
  const old = { game: 'forever', region: 'us', ruleset: 1, generatedAt: now, retainedAt: now,
    houses: { alliance: { id: 111 }, horde: { id: 114 }, neutral: { id: 117 } } };
  await writeJson(join(app.directory, 'snapshot.json'), old);
  assert.deepEqual(await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json()), { snapshot: null, needsCollection: true });
  const compatible = { ...old, houses: { alliance: { id: 110 }, horde: { id: 113 }, neutral: { id: 116 } }, mappingVerified: false };
  await writeJson(join(app.directory, 'snapshot.json'), compatible);
  const recognized = await app.fetch(`${app.origin}/api/snapshot`).then((response) => response.json());
  assert.equal(recognized.snapshot.mappingEvidence.method, 'community-corroborated');
  assert.equal(recognized.snapshot.retainedAt, now);
  assert.equal(recognized.snapshot.generatedAt, now);
  assert.equal(recognized.needsCollection, false);
});

test('the current UI collects locked houses without accepting a user-selected override', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'local-client', clientSecret: 'local-secret' });
  await app.server.waitForIdle();
  app.advance(5 * 60_000 + 1);
  const response = await app.post('/api/collect', { refreshCatalog: false });
  assert.equal(response.status, 202);
  await app.server.waitForIdle();
  assert.equal((await app.status()).job.state, 'complete');
  assert.deepEqual((await app.status()).settings.selected, selected);
  assert.ok(app.client.calls.filter((call) => /\/auctions\/\d/.test(call.path)).every((call) => /\/auctions\/(110|113|116)(\/|$)/.test(call.path)));
});

test('a saved material-only catalog upgrades automatically and a failed catalog refresh preserves saved data', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'private-secret' });
  await app.server.waitForIdle();
  const catalogPath = join(app.directory, 'catalog.json');
  const oldCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  delete oldCatalog.scope;
  oldCatalog.items = oldCatalog.items.filter(item => ['Ores', 'Herbs'].includes(item.category));
  await writeJson(catalogPath, oldCatalog);
  app.advance(300_000);
  const before = app.client.calls.length;
  assert.equal((await app.post('/api/collect', { refreshCatalog: false })).status, 202);
  await app.server.waitForIdle();
  assert.equal((await app.status()).job.state, 'complete');
  const requests = app.client.calls.slice(before);
  assert.equal(requests.filter(call => call.path === '/data/wow/search/item').length, 1);
  assert.equal(requests.filter(call => /\/auctions\/\d/.test(call.path)).length, 6);
  const upgraded = JSON.parse(await readFile(catalogPath, 'utf8'));
  assert.equal(upgraded.scope, 'all-items');
  assert.ok(upgraded.items.some(item => item.name === 'Copper Bar'));
  const savedCatalog = await readFile(catalogPath, 'utf8');
  const savedSnapshot = await readFile(join(app.directory, 'snapshot.json'), 'utf8');
  const original = app.client.get;
  app.client.get = async function(path, options) {
    if (path === '/data/wow/search/item') throw new Error('Catalog unavailable');
    return original.call(this, path, options);
  };
  app.advance(300_000);
  assert.equal((await app.post('/api/collect', { refreshCatalog: true })).status, 202);
  await app.server.waitForIdle();
  assert.equal((await app.status()).job.state, 'failed');
  assert.equal(await readFile(catalogPath, 'utf8'), savedCatalog);
  assert.equal(await readFile(join(app.directory, 'snapshot.json'), 'utf8'), savedSnapshot);
});

test('expired aggregates are removed rather than displayed; partial env credentials never mix with disk credentials', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'forever-retention-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  await writeJson(join(directory, 'snapshot.json'), { generatedAt: new Date(now).toISOString(), retainedAt: new Date(now - 31 * DAY).toISOString() });
  assert.equal(await readRecent(directory, 'snapshot.json', 30 * DAY, now), null);
  await assert.rejects(readFile(join(directory, 'snapshot.json')), { code: 'ENOENT' });
  await writeJson(join(directory, 'private', 'credentials.json'), { clientId: 'disk-client', clientSecret: 'disk-secret' });
  assert.deepEqual(await readCredentials(directory, { BLIZZARD_CLIENT_ID: 'env-client' }), { clientId: 'env-client', clientSecret: '', fromEnvironment: true });
});

test('liquidity is fetched separately for tracked base items and never enters saved snapshots', async (t) => {
  const ids = [];
  const app = await local(t, { liquidityClient: { async get(itemIds) { ids.push(itemIds); return { source: 'test', markets: {} }; } } });
  const read = () => app.fetch(`${app.origin}/api/liquidity`).then((response) => response.json());
  assert.deepEqual(await read(), { liquidity: null });
  assert.equal(ids.length, 0);
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'test-secret' });
  await app.server.waitForIdle();
  const before = await readFile(join(app.directory, 'snapshot.json'), 'utf8');
  assert.equal((await read()).liquidity.source, 'test');
  assert.deepEqual(new Set(ids[0]), new Set([2770, 2447, 2840, 999999]));
  assert.equal(await readFile(join(app.directory, 'snapshot.json'), 'utf8'), before);
  assert.ok(!before.includes('salesPerDay'));
});

test('all-neutral inspection is authorized, read-only and independent of the trading lock', async (t) => {
  const app = await local(t);
  assert.equal((await app.post('/api/inspect-neutral')).status, 400);
  assert.deepEqual(await app.fetch(`${app.origin}/api/neutral-books`).then((response) => response.json()), { report: null });
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'private-test-secret' });
  await app.server.waitForIdle();
  app.advance(5 * 60_000 + 1);
  const snapshot = await readFile(join(app.directory, 'snapshot.json'), 'utf8');
  const settings = await readFile(join(app.directory, 'settings.json'), 'utf8');
  const original = app.client.get;
  app.client.get = async function(path, options) {
    if (path.endsWith('/auctions/')) return { data: { auctions: [116, 117, 118, 121, 125].map((id) => ({ id, name: 'Blackwater Auction House' })) } };
    if (/\/auctions\/\d/.test(path)) return document([{ id: 1, item: { id: 3820 }, quantity: 20, buyout: 5600 }]);
    return original.call(this, path, options);
  };
  assert.equal((await app.post('/api/inspect-neutral', {}, { 'X-Local-CSRF': 'bad' })).status, 403);
  assert.equal((await app.post('/api/inspect-neutral')).status, 202);
  await app.server.waitForIdle();
  assert.equal((await app.status()).job.kind, 'inspect');
  assert.equal((await app.status()).job.state, 'complete');
  const { report } = await app.fetch(`${app.origin}/api/neutral-books`).then((response) => response.json());
  assert.deepEqual(report.houses.map((house) => house.id), [116, 117, 118, 121, 125]);
  assert.equal(report.houses[4].quotes[0].offers[0].unitPrice, 280);
  assert.equal(report.mappingConfirmed, false);
  assert.equal(JSON.stringify(report).includes('private-test-secret'), false);
  assert.equal(await readFile(join(app.directory, 'snapshot.json'), 'utf8'), snapshot);
  assert.equal(await readFile(join(app.directory, 'settings.json'), 'utf8'), settings);
});

test('cooldown cannot be bypassed by direct POSTs, setup, another tab or a server restart', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'private-secret' });
  await app.server.waitForIdle();
  const calls = app.client.calls.length;
  for (const path of ['/api/collect', '/api/discover', '/api/inspect-neutral']) {
    const result = await app.post(path);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('retry-after'), '300');
  }
  assert.equal((await app.post('/api/setup', { clientId: 'test-client', clientSecret: '' })).status, 429);
  assert.equal(app.client.calls.length, calls);
  const restarted = createLocalServer({ directory: app.directory, env: {}, clientFactory: () => app.client, now: app.now });
  const transport = localTransport(restarted, app.origin);
  const state = await transport(`${app.origin}/api/status`).then((r) => r.json());
  assert.equal(state.collection.nextEligibleAt, app.now() + 300_000);
  const blocked = await transport(`${app.origin}/api/collect`, { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Local-CSRF': state.csrf }, body: '{}' });
  assert.equal(blocked.status, 429);
  assert.equal(app.client.calls.length, calls);
});

test('unchanged checks preserve the snapshot bytes and data age while backing off', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'private-secret' });
  await app.server.waitForIdle();
  const saved = await readFile(join(app.directory, 'snapshot.json'), 'utf8');
  const original = app.client.get;
  app.client.get = async function(path, options) {
    if (options?.validators) return { ...options.validators, data: null, notModified: true, cached: true, fetchedAt: new Date().toISOString() };
    return original.call(this, path, options);
  };
  app.advance(300_000);
  assert.equal((await app.post('/api/collect')).status, 202);
  await app.server.waitForIdle();
  let state = await app.status();
  assert.equal(state.job.unchanged, true);
  assert.equal(state.collection.outcome, 'unchanged');
  assert.equal(state.collection.nextEligibleAt, app.now() + 600_000);
  assert.equal(await readFile(join(app.directory, 'snapshot.json'), 'utf8'), saved);
  app.advance(600_000);
  await app.post('/api/collect'); await app.server.waitForIdle();
  state = await app.status();
  assert.equal(state.collection.nextEligibleAt, app.now() + 900_000);
  assert.equal(await readFile(join(app.directory, 'snapshot.json'), 'utf8'), saved);
});

test('an exhausted shared budget prevents upstream work even when collection cooldown elapsed', async (t) => {
  const app = await local(t);
  await app.post('/api/setup', { clientId: 'test-client', clientSecret: 'private-secret' });
  await app.server.waitForIdle();
  app.advance(300_000);
  await writeJson(join(app.directory, 'request-budget.json'), { requests: Array(600).fill(app.now()), blockedUntil: 0 });
  const calls = app.client.calls.length;
  const result = await app.post('/api/collect');
  assert.equal(result.status, 429);
  assert.equal(app.client.calls.length, calls);
  const state = await app.status();
  assert.equal(state.collection.requestBudget.remaining, 0);
  assert.equal(state.collection.nextEligibleAt, app.now() + 3_600_000);
});

test('localhost proxies bounded item history to the fixed public Worker', async (t) => {
  const calls = [];
  const app = await local(t, { historyFetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ points: [] });
  } });
  const hour = Math.floor(app.now() / 3_600_000);
  const params = new URLSearchParams({ item: '3820', variant: '[]', from: String(hour - 23), to: String(hour), origin: 'https://other.invalid' });
  const endpoint = app.origin + '/api/history?';
  const result = await app.fetch(endpoint + params);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { points: [] });
  assert.equal(calls[0].url.origin, 'https://gathering-ledger.gathering-ledger.workers.dev');
  assert.equal(calls[0].url.pathname, '/api/history');
  assert.deepEqual([...calls[0].url.searchParams.keys()], ['item', 'variant', 'from', 'to']);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers, undefined);

  params.set('from', String(hour - 168));
  assert.equal((await app.fetch(endpoint + params)).status, 400);
  params.set('from', String(hour - 23));
  assert.equal((await app.fetch(endpoint + params, { headers: { Origin: 'https://other.invalid' } })).status, 403);
  assert.equal(calls.length, 1);
});
