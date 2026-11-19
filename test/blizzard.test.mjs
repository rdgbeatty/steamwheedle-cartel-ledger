import test from 'node:test';
import assert from 'node:assert/strict';
import { BlizzardClient } from '../src/blizzard.mjs';
import { RequestBudget } from '../src/request-budget.mjs';

const credentials = { clientId: 'local-client', clientSecret: 'secret:&%' };
function json(body, options = {}) { return new Response(JSON.stringify(body), { status: 200, ...options }); }

test('OAuth client credentials, fixed Forever namespace and one reusable token', async () => {
  const calls = [];
  const api = new BlizzardClient(credentials, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.includes('/token') ? json({ access_token: 'app-token', expires_in: 3600 }) : json({ auctions: [] });
  } });
  await api.get('/data/wow/ruleset/index');
  await api.get('/data/wow/search/item', { namespace: 'static', query: { namespace: 'static-us', locale: 'fr_FR' } });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://oauth.battle.net/token');
  assert.equal(calls[0].options.body, 'grant_type=client_credentials');
  assert.equal(Buffer.from(calls[0].options.headers.Authorization.slice(6), 'base64').toString(), 'local-client:secret%3A%26%25');
  assert.equal(new URL(calls[1].url).searchParams.get('namespace'), 'dynamic-forever-us');
  assert.equal(new URL(calls[2].url).searchParams.get('namespace'), 'static-forever-us');
  assert.equal(new URL(calls[2].url).searchParams.get('locale'), 'en_US');
  assert.ok(calls.every(({ options }) => options.redirect === 'error'));
  await assert.rejects(api.get('https://attacker.invalid/data/wow/foo'), /Unsupported/);
  await assert.rejects(api.get('/data/wow/item/1', { namespace: 'static-us' }), /Only Forever/);
});

test('304 and cache hits preserve source observation time', async () => {
  let time = Date.parse('2026-11-16T14:00:00Z'), count = 0;
  const api = new BlizzardClient(credentials, { now: () => time, fetchImpl: async (url, options) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    count++;
    if (count === 1) return json({ auctions: [] }, { headers: { 'Last-Modified': 'Mon, 16 Nov 2026 12:00:00 GMT', ETag: 'one', 'Cache-Control': 'max-age=10' } });
    assert.equal(options.headers['If-None-Match'], 'one');
    return new Response(null, { status: 304, headers: { 'Cache-Control': 'max-age=10' } });
  } });
  const first = await api.get('/data/wow/ruleset/1/auctions/110');
  time += 5000;
  const cached = await api.get('/data/wow/ruleset/1/auctions/110');
  assert.equal(count, 1);
  assert.equal(cached.observedAt, first.observedAt);
  time += 10000;
  const updated = await api.get('/data/wow/ruleset/1/auctions/110');
  assert.equal(count, 2);
  assert.equal(updated.observedAt, first.observedAt);
  assert.notEqual(updated.fetchedAt, first.fetchedAt);
});

test('rejected credentials and network errors never echo secrets or upstream bodies', async () => {
  const api = new BlizzardClient(credentials, { fetchImpl: async () => json({ error_description: `Bad ${credentials.clientSecret} token=leak` }, { status: 401 }) });
  await assert.rejects(api.accessToken(), (error) => {
    assert.equal(error.status, 401); assert.match(error.message, /OAuth/);
    assert.ok(!error.message.includes(credentials.clientSecret)); assert.ok(!error.message.includes('leak')); return true;
  });
  const failing = new BlizzardClient(credentials, { fetchImpl: async () => { throw new Error(credentials.clientSecret); }, sleep: async () => {} });
  await assert.rejects(failing.accessToken(), /Could not reach Blizzard/);
});

test('401 renews token once; 429 honors Retry-After; cancellation stops work', async () => {
  let tokens = 0, reads = 0;
  let time = Date.now();
  const waits = [];
  const api = new BlizzardClient(credentials, { now: () => time, sleep: async (wait) => { waits.push(wait); time += wait; }, fetchImpl: async (url) => {
    if (url.includes('/token')) { tokens++; return json({ access_token: `token${tokens}`, expires_in: 3600 }); }
    reads++;
    if (reads === 1) return json({}, { status: 401 });
    if (reads === 2) return json({}, { status: 429, headers: { 'Retry-After': '2' } });
    return json({ auctions: [] });
  } });
  await api.get('/data/wow/ruleset/1/auctions/110');
  assert.equal(tokens, 2); assert.equal(reads, 3); assert.deepEqual(waits, [2000]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.get('/data/wow/ruleset/index', { signal: controller.signal }), /canceled/);
});

test('an aged upstream response does not receive a new full cache lifetime locally', async () => {
  let time = Date.parse('2026-11-18T02:00:00Z'), reads = 0;
  const api = new BlizzardClient(credentials, { now: () => time, fetchImpl: async (url) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    reads++;
    return json({ auctions: [] }, { headers: { 'Cache-Control': 's-maxage=3600, max-age=120', Age: '100', Date: 'Wed, 18 Nov 2026 01:58:20 GMT' } });
  } });
  const path = '/data/wow/ruleset/1/auctions/116';
  await api.get(path); time += 19_000; await api.get(path);
  assert.equal(reads, 1);
  time += 2000; await api.get(path);
  assert.equal(reads, 2);
});

test('no-cache revalidates on each read and no-store never keeps raw API responses', async () => {
  for (const policy of ['no-cache, max-age=3600', 'no-store, max-age=3600']) {
    let reads = 0;
    const api = new BlizzardClient(credentials, { fetchImpl: async (url) => {
      if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
      reads++; return json({ auctions: [] }, { headers: { 'Cache-Control': policy } });
    } });
    await api.get('/data/wow/ruleset/1/auctions/116');
    await api.get('/data/wow/ruleset/1/auctions/116');
    assert.equal(reads, 2);
    if (policy.startsWith('no-store')) assert.equal(api.cache.size, 0);
  }
});

test('raw cache expiry drops old validators and rejects over-age API observations', async (t) => {
  let time = Date.parse('2026-11-18T02:00:00Z'), reads = 0, expiredResponse = false;
  const initial = time;
  const api = new BlizzardClient(credentials, { now: () => time, fetchImpl: async (url, options) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    reads++;
    assert.equal(options.headers['If-None-Match'], undefined);
    return json({ auctions: [] }, { headers: { 'Last-Modified': new Date(expiredResponse ? initial : time).toUTCString(), ETag: 'version', 'Cache-Control': 'max-age=3600' } });
  } });
  t.after(() => api.dispose());
  const path = '/data/wow/ruleset/1/auctions/116';
  await api.get(path);
  time += 31 * 86_400_000;
  const fresh = await api.get(path);
  assert.equal(reads, 2);
  assert.equal(fresh.retainedAt, new Date(time).toISOString());
  expiredResponse = true;
  await assert.rejects(api.get('/data/wow/ruleset/1/auctions/117'), /30-day retention/);
  assert.equal(api.cache.size, 1);
});

test('304 never renews raw retention age when the original source timestamp is unknown', async (t) => {
  let time = Date.parse('2026-11-18T02:00:00Z'), reads = 0;
  const api = new BlizzardClient(credentials, { now: () => time, fetchImpl: async (url) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    return ++reads === 1 ? json({ auctions: [] }, { headers: { ETag: 'one' } }) : new Response(null, { status: 304 });
  } });
  t.after(() => api.dispose());
  const first = await api.get('/data/wow/ruleset/1/auctions/116');
  time += 60_000;
  const revalidated = await api.get('/data/wow/ruleset/1/auctions/116');
  assert.equal(first.observedAt, null);
  assert.equal(revalidated.retainedAt, first.retainedAt);
  assert.notEqual(revalidated.fetchedAt, first.fetchedAt);
});

test('Last-Modified validators work after restart without retaining raw books', async (t) => {
  const time = Date.parse('2026-11-18T03:00:00Z');
  const prior = { observedAt: '2026-11-18T02:00:00.000Z', retainedAt: '2026-11-18T02:00:00.000Z', fetchedAt: '2026-11-18T02:10:00.000Z', timeBasis: 'Last-Modified' };
  const api = new BlizzardClient(credentials, { now: () => time, fetchImpl: async (url, options) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    assert.equal(options.headers['If-Modified-Since'], 'Wed, 18 Nov 2026 02:00:00 GMT');
    assert.equal(options.headers['Cache-Control'], 'max-age=0');
    return new Response(null, { status: 304 });
  } });
  t.after(() => api.dispose());
  const result = await api.get('/data/wow/ruleset/1/auctions/116', { revalidate: true, validators: prior });
  assert.equal(result.notModified, true);
  assert.equal(result.data, null);
  assert.equal(result.retainedAt, prior.retainedAt);
  assert.equal(result.observedAt, prior.observedAt);
  assert.equal(api.cache.size, 0);
  assert.equal((await api.budget.status()).used, 2); // OAuth and the conditional GET both count.
});

test('validate the displayed snapshot, not a newer response left by a diagnostic; forceBody omits validators', async (t) => {
  let reads = 0;
  const newer = 'Wed, 18 Nov 2026 03:00:00 GMT', older = 'Wed, 18 Nov 2026 02:00:00 GMT';
  const api = new BlizzardClient(credentials, { now: () => Date.parse('2026-11-18T03:10:00Z'), fetchImpl: async (url, options) => {
    if (url.includes('/token')) return json({ access_token: 'token', expires_in: 3600 });
    reads++;
    if (reads === 2) assert.equal(options.headers['If-Modified-Since'], older);
    if (reads === 3) { assert.equal(options.headers['If-Modified-Since'], undefined); assert.equal(options.headers['If-None-Match'], undefined); }
    return json({ auctions: [] }, { headers: { 'Last-Modified': newer, 'Cache-Control': 'max-age=86400' } });
  } });
  t.after(() => api.dispose());
  const path = '/data/wow/ruleset/1/auctions/116';
  await api.get(path);
  const result = await api.get(path, { revalidate: true, validators: { lastModified: older, observedAt: new Date(older).toISOString(), timeBasis: 'Last-Modified' } });
  assert.equal(result.notModified, false);
  await api.get(path, { forceBody: true });
  assert.equal(reads, 3);
});

test('long Retry-After blocks subsequent API calls and retries cannot evade a small budget', async () => {
  let time = Date.now(), calls = 0;
  const budget = new RequestBudget({ now: () => time });
  const api = new BlizzardClient(credentials, { budget, now: () => time, fetchImpl: async (url) => {
    calls++;
    return url.includes('/token') ? json({ access_token: 'token', expires_in: 3600 }) : json({}, { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(api.get('/data/wow/ruleset/1/auctions/116'), /asked us to wait/);
  await assert.rejects(api.get('/data/wow/ruleset/1/auctions/113'), (error) => error.status === 429);
  assert.equal(calls, 2);
  assert.equal((await budget.status()).used, 2);
  assert.equal((await budget.status()).retryAt, time + 120_000);
  const small = new RequestBudget({ limit: 2, now: () => time });
  const failing = new BlizzardClient(credentials, { budget: small, now: () => time, sleep: async () => {}, fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(failing.accessToken(), (error) => error.status === 429);
  assert.equal((await small.status()).used, 2);
});

test('local budget write failures stop before networking and are not mislabeled as DNS failures', async () => {
  let calls = 0;
  const api = new BlizzardClient(credentials, { budget: { async take() { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); } }, fetchImpl: async () => { calls++; } });
  await assert.rejects(api.accessToken(), /local request budget.*state-directory permissions/);
  assert.equal(calls, 0);
});
