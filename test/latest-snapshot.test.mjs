import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { publishLatest, reuseCatalog, reuseHouse } from '../src/latest-snapshot.mjs';
import { itemMetadata, ALL_ITEMS_SCOPE } from '../shared/items.mjs';
import { US_PVP } from '../shared/market.mjs';

test('the complete snapshot preserves source age, catalog coverage, price levels and reuse', async () => {
  const now = Date.now();
  const observedAt = new Date(now - 60000).toISOString();
  const retainedAt = new Date(now - 86400000).toISOString();
  const item = itemMetadata({ id: 3820, name: 'Stranglekelp', item_class: { id: 7 }, item_subclass: { id: 9 } });
  const catalog = { scope: ALL_ITEMS_SCOPE, generatedAt: observedAt, retainedAt, items: [item], warnings: [] };
  const quote = { itemId: item.id, variant: '', minBuyout: 251, medianBuyout: 251, auctions: 1, buyoutUnits: 2, buyoutAuctions: 1 };
  const level = { unitPrice: 251, quantity: 2, listingCount: 1, totalBuyout: 502 };
  const houses = Object.fromEntries(Object.entries(US_PVP.houses).map(([faction, id]) => [faction, {
    id, status: 'ok', observedAt, version: String(id),
    quotes: [faction === 'neutral' ? { ...quote, priceLevels: [level] } : quote]
  }]));
  let snapshot;
  const publish = async (action, params, body) => {
    assert.equal(action, 'snapshot');
    assert.equal(params.retainedAt, Date.parse(retainedAt));
    ({ snapshot } = JSON.parse(gunzipSync(body)));
    return { published: true };
  };
  assert.equal(await publishLatest(publish, catalog, houses, null, now), true);
  assert.equal(snapshot.retainedAt, retainedAt);
  assert.deepEqual(snapshot.rows[0].quotes.neutral.priceLevels, [level]);
  assert.equal(snapshot.houses.neutral.quotes, undefined);
  assert.deepEqual(reuseCatalog(snapshot, now).items, catalog.items);
  assert.deepEqual(reuseHouse(snapshot, 'neutral', { version: '116', source: Date.parse(observedAt) }), houses.neutral);
  assert.equal(reuseHouse(snapshot, 'neutral', { version: 'older', source: Date.parse(observedAt) }), null);
  assert.equal(await publishLatest(() => assert.fail('An unchanged snapshot must not be rewritten'), catalog, houses, snapshot, now), false);
});
