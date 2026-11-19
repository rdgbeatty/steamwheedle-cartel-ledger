import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCatalog, discoverHouses } from '../src/catalog.mjs';
import { item, fakeClient } from './fixtures.mjs';

test('catalog includes all classes and trade goods without per-item metadata requests', async () => {
  const api = fakeClient();
  const result = await collectCatalog(api);
  assert.deepEqual(result.items.map((value) => value.name).sort(), ['Copper Bar', 'Copper Ore', 'Forever Test Herb', 'Peacebloom']);
  assert.equal(result.scope, 'all-items');
  assert.equal(api.calls.length, 1);
  assert.ok(api.calls.every(({ options }) => options.namespace === 'static'));
  assert.deepEqual(api.calls[0].options.query, { id: '[1,]', _page: 1, _pageSize: 1000, orderby: 'id' });
});

test('catalog advances ID ranges when Forever caps results despite pageCount one', async () => {
  const queries = [];
  const api = { async get(path, { query }) {
    queries.push(query);
    const first = query.id === '[1,]';
    return { retainedAt: first ? '2026-11-16T12:00:00.000Z' : '2026-11-17T12:00:00.000Z', data: {
      pageCount: 1, resultCountCapped: first, results: (first ? [item(20, 'Sword', 7, 2), item(100, 'Cloth', 5)] : [item(200, 'Potion', 1, 0)]).map(data => ({ data })),
    } };
  } };
  const result = await collectCatalog(api);
  assert.equal(result.items.length, 3);
  assert.deepEqual(queries.map(query => query.id), ['[1,]', '[101,]']);
  assert.deepEqual(result.items.map(item => item.category).sort(), ['Cloth', 'Consumable', 'Weapon']);
  assert.equal(result.retainedAt, '2026-11-16T12:00:00.000Z');
  const thousand = Array.from({ length: 1000 }, (_, index) => ({ data: item(index + 1, `Item ${index + 1}`, 0, 15) }));
  let calls = 0;
  const exactPage = await collectCatalog({ async get() { return { data: { results: calls++ === 0 ? thousand : [] } }; } });
  assert.equal(exactPage.items.length, 1000);
  assert.equal(calls, 2); // A full page needs another range even without a capped flag.
});

test('catalog detects repeated pages rather than silently claiming completeness', async () => {
  await assert.rejects(collectCatalog({ async get() { return { data: { pageCount: 2, results: [{ data: item(1, 'Copper Ore', 7) }] } }; } }), /repeated a page/);
});

test('missing metadata stays searchable by ID and is reported without retail fallback', async () => {
  const api = { calls: 0, async get() { this.calls++; return { data: { results: [{ data: { id: 999 } }] } }; } };
  const result = await collectCatalog(api);
  assert.equal(api.calls, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /1 catalog items lack/);
  assert.deepEqual([result.items[0].id, result.items[0].name, result.items[0].category], [999, 'Item #999', 'Unknown']);
});

test('catalog rejects empty, malformed, unordered and partial responses', async () => {
  for (const data of [{}, { results: [] }, { results: [{ data: { id: 0 } }] }, { results: [{ data: item(2, 'B', 0) }, { data: item(1, 'A', 0) }] }]) {
    await assert.rejects(collectCatalog({ async get() { return { data }; } }), /unexpected|empty|invalid|repeated/);
  }
  let calls = 0;
  await assert.rejects(collectCatalog({ async get() {
    if (calls++) throw new Error('Upstream unavailable');
    return { data: { resultCountCapped: true, results: [{ data: item(1, 'A', 0) }] } };
  } }), /Upstream unavailable/);
});

test('discovery validates PvP and uses alternate index on 404 only', async () => {
  const api = fakeClient(), original = api.get;
  api.get = async function (path, options) {
    if (path.endsWith('/auctions/')) throw Object.assign(new Error('Not found'), { status: 404 });
    if (path.endsWith('/auctions/index')) return original.call(this, '/data/wow/ruleset/1/auctions/', options);
    return original.call(this, path, options);
  };
  const result = await discoverHouses(api);
  assert.equal(result.houses.find((value) => value.id === 116).faction, 'neutral');
  assert.equal(result.mappingVerified, true);
  assert.equal(result.mappingEvidence.method, 'community-corroborated');
  await assert.rejects(discoverHouses({ async get() { return { data: { rulesets: [{ id: 2 }] } }; } }), /PvP ruleset/);
});

test('discovery fails closed when a fixed PvP house is missing or has the wrong faction', async () => {
  for (const missing of [110, 113, 116]) {
    const api = fakeClient(), original = api.get;
    api.get = async function (path, options) {
      const result = await original.call(this, path, options);
      if (path.endsWith('/auctions/')) result.data.auctions = result.data.auctions.filter((house) => house.id !== missing);
      return result;
    };
    await assert.rejects(discoverHouses(api), /expected PvP/);
  }
});
