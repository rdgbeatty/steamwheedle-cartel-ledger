import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceHouse, mergeRows, collectMarket } from '../src/market.mjs';
import { splitCopper } from '../public/format.mjs';
import { ALL_ITEMS_SCOPE } from '../shared/items.mjs';
import { catalog, discovery, selected, document, fakeClient } from './fixtures.mjs';

test('stack totals and commodity unit prices, weighted median, bids and duplicate books', () => {
  const stack = { id: 1, item: { id: 2770 }, quantity: 5, buyout: 500 };
  const commodity = { id: 2, item: { id: 2770 }, quantity: 100, unit_price: 10 };
  const bids = { id: 3, item: { id: 2770 }, quantity: 4, bid: 1 };
  const result = reduceHouse([document([stack, commodity]), document([commodity, bids])], catalog, 110);
  assert.equal(result.trackedAuctions, 3);
  assert.deepEqual(result.quotes[0], { itemId: 2770, variant: '', units: 109, buyoutUnits: 105, auctions: 3, buyoutAuctions: 2, bidOnlyAuctions: 1, minBuyout: 10, medianBuyout: 10 });
});

test('variants stay distinct and variant order is canonical', () => {
  const result = reduceHouse([document([
    { id: 1, item: { id: 2770, bonus_lists: [2, 1], context: 0 }, quantity: 1, buyout: 7 },
    { id: 2, item: { id: 2770, bonus_lists: [1, 2] }, quantity: 1, buyout: 9 },
    { id: 3, item: { id: 2770 }, quantity: 1, buyout: 100 },
  ])], catalog, 110);
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes.find((quote) => quote.variant).units, 2);
});

test('failed and absent markets stay unknown; complete empty markets have zero units and null prices', () => {
  const rows = mergeRows(catalog, { alliance: { status: 'ok', quotes: [] }, horde: { status: 'error' } });
  assert.equal(rows[0].quotes.alliance.units, 0);
  assert.equal(rows[0].quotes.alliance.minBuyout, null);
  assert.equal(rows[0].quotes.horde, null);
  assert.equal(rows[0].quotes.neutral, null);
});

test('all-item books preserve unknown IDs, equipment variants and non-material prices', async () => {
  const full = { ...catalog, scope: ALL_ITEMS_SCOPE, retainedAt: '2026-11-15T12:00:00.000Z',
    items: [...catalog.items, { id: 10, name: 'Sword', category: 'Weapon' }] };
  const api = { async get(path) {
    const house = Number(path.split('/')[6]);
    return document([
      { id: house * 10, item: { id: 10, modifiers: [{ type: 9, value: 11 }] }, quantity: 1, buyout: house },
      { id: house * 10 + 1, item: { id: 9999 }, quantity: 20, buyout: house * 20 },
    ]);
  } };
  const original = await collectMarket(api, full, selected, discovery);
  assert.equal(original.rows.length, 5); // Three catalog bases, sword variant, uncatalogued ID.
  const unknown = original.rows.find(row => row.id === 9999);
  assert.equal(unknown.name, 'Item #9999'); assert.equal(unknown.category, 'Unknown');
  assert.equal(unknown.quotes.neutral.minBuyout, 116);
  assert.equal(original.rows.find(row => row.id === 10 && row.variant).quotes.horde.minBuyout, 113);
  assert.equal(original.catalog.unknownCount, 1);
  assert.equal(original.catalog.count, 4);
  assert.equal(original.retainedAt, full.retainedAt); // New prices cannot renew old copied item metadata.
  assert.match(original.warnings.join(' '), /1 auctioned items.*Unknown/);
  const calls = [];
  const recheck = await collectMarket({ async get(path, options) {
    calls.push(options); return { ...options.validators, data: null, notModified: true };
  } }, full, selected, discovery, { previousSnapshot: original });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(options => !options.forceBody));
  assert.equal(recheck.unchanged, true);
  assert.deepEqual(recheck.rows, original.rows);
  assert.deepEqual(recheck.warnings, original.warnings);
  const old = { ...original, catalog: { ...original.catalog, scope: undefined } };
  const upgraded = await collectMarket({ async get(path, options) {
    assert.equal(options.forceBody, true); return api.get(path);
  } }, full, selected, discovery, { previousSnapshot: old });
  assert.equal(upgraded.unchanged, false);
});

test('reject malformed books, unsafe prices and inconsistent duplicated auctions', () => {
  assert.throws(() => reduceHouse([{ data: {} }], catalog, 110), /no recognizable/);
  assert.throws(() => reduceHouse([document([], { id: 113 })], catalog, 110), /different house/);
  assert.throws(() => reduceHouse([document([{ id: 1, item: { id: 2770 }, quantity: 0, buyout: 100 }])], catalog, 110), /quantity/);
  assert.throws(() => reduceHouse([document([{ id: 1, item: { id: 2770 }, quantity: 2, buyout: Number.MAX_SAFE_INTEGER + 1 }])], catalog, 110), /price/);
  assert.throws(() => reduceHouse([document([{ id: 1, item: { id: 2770 }, quantity: 1, unit_price: 0 }])], catalog, 110), /price/);
  assert.throws(() => reduceHouse([document([
    { id: 1, item: { id: 2770 }, quantity: 2, buyout: 10 },
    { id: 1, item: { id: 2770 }, quantity: 3, buyout: 10 },
  ])], catalog, 110), /disagree/);
  assert.equal(reduceHouse([{ data: { id: 110, name: 'Alliance Auction House' } }], catalog, 110).trackedAuctions, 0);
});

test('collection reads both documents for three houses, persists aggregates and detects aliases', async () => {
  const api = fakeClient();
  const result = await collectMarket(api, catalog, selected, discovery);
  assert.equal(api.calls.length, 6);
  assert.equal(result.rows.length, 2);
  assert.equal(result.game, 'forever');
  assert.equal(result.mappingVerified, true);
  assert.equal(result.rows.find((row) => row.id === 2770).quotes.horde.minBuyout, 113);
  assert.equal(result.houses.alliance.quotes, undefined);
  assert.equal(result.houses.alliance.fingerprint, undefined);
  assert.equal(result.retainedAt, '2026-11-16T12:00:00.000Z');
  const identical = { async get() { return document([{ id: 7, item: { id: 2770 }, quantity: 20, unit_price: 10 }]); } };
  const duplicate = await collectMarket(identical, catalog, selected, discovery);
  assert.ok(duplicate.warnings.some((warning) => warning.includes('identical')));
});

test('a non-PvP selection is rejected before issuing any book requests', async () => {
  const api = fakeClient();
  await assert.rejects(collectMarket(api, catalog, { ...selected, alliance: 111 }, discovery), /locked to US PvP/);
  assert.equal(api.calls.length, 0);
});

test('partial collection reports failed house without treating it as a stockout', async () => {
  const api = fakeClient(), original = api.get;
  api.get = function (path, options) { if (path.includes('/113')) throw new Error('Unavailable'); return original.call(this, path, options); };
  const result = await collectMarket(api, catalog, selected, discovery);
  assert.equal(result.houses.horde.status, 'error');
  assert.equal(result.rows[0].quotes.horde, null);
  assert.ok(result.warnings.some((warning) => warning.includes('horde')));
  api.failBooks = true;
  await assert.rejects(collectMarket(api, catalog, selected, discovery), /unavailable/i);
});

test('copper formatting handles unit averages and carries across denomination boundaries', () => {
  assert.deepEqual(splitCopper(12345.67), [1, 23, 45.67]);
  assert.deepEqual(splitCopper(-99.999), [0, 1, 0]);
  assert.deepEqual(splitCopper(9999.999), [1, 0, 0]);
  assert.deepEqual(splitCopper(0), [0, 0, 0]);
  assert.equal(splitCopper(NaN), null);
});

test('all-six 304 checks reuse complete aggregates and preserve original source retention', async () => {
  const original = await collectMarket(fakeClient(), catalog, selected, discovery);
  const calls = [];
  const api = { async get(path, options) {
    calls.push({ path, options });
    return { ...options.validators, data: null, fetchedAt: new Date().toISOString(), notModified: true, cached: true };
  } };
  const result = await collectMarket(api, catalog, selected, discovery, { previousSnapshot: original });
  assert.equal(calls.length, 6);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.rows, original.rows);
  assert.equal(result.retainedAt, original.retainedAt);
  assert.deepEqual(result.warnings, []); // Missing new fingerprints must not create false alias warnings.
});

test('changed catalog requires full books; mixed 200/304 responses refetch only a missing body', async () => {
  const original = await collectMarket(fakeClient(), catalog, selected, discovery);
  const changedCatalog = { ...catalog, items: [...catalog.items, { id: 999999, name: 'New Herb', category: 'Herbs' }] };
  const base = fakeClient(), calls = [];
  const api = { async get(path, options) { calls.push({ path, options }); return base.get(path, options); } };
  const added = await collectMarket(api, changedCatalog, selected, discovery, { previousSnapshot: original });
  assert.equal(added.rows.length, 3);
  assert.equal(added.unchanged, false);
  assert.ok(calls.every(({ options }) => options.forceBody && !options.validators));
  calls.length = 0;
  api.get = async (path, options) => {
    calls.push({ path, options });
    if (path.includes('/110') && path.endsWith('/commodities') && !options.forceBody) return { ...options.validators, data: null, notModified: true };
    return base.get(path, options);
  };
  const mixed = await collectMarket(api, catalog, selected, discovery, { previousSnapshot: original });
  assert.equal(mixed.unchanged, false);
  assert.equal(calls.length, 7);
  assert.equal(calls.filter(({ options }) => options.forceBody).length, 1);
  assert.deepEqual(mixed.rows, original.rows);
});
