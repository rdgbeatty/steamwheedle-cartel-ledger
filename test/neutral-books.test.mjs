import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNeutralBooks } from '../src/neutral-books.mjs';
import { document } from './fixtures.mjs';

function client() {
  return { calls: [], async get(path) {
    this.calls.push(path);
    if (path === '/data/wow/ruleset/index') return { data: { rulesets: [{ id: 1 }] } };
    if (path.endsWith('/auctions/')) return { data: { auctions: [
      { id: 110, name: 'Alliance Auction House' }, { id: 113, name: 'Horde Auction House' },
      ...[116, 117, 118, 121, 125].map((id) => ({ id, name: 'Blackwater Auction House' })),
    ] } };
    const houseId = Number(path.split('/')[6]);
    const stack = { id: houseId * 100, item: { id: 3820 }, quantity: 20, buyout: 5600 };
    if (houseId === 118) return { data: {} };
    if (houseId === 121) return document(undefined, { id: 121, name: 'Blackwater Auction House' });
    if (path.endsWith('/commodities')) {
      if (houseId === 125) throw new Error('Unavailable');
      return document([stack, { id: houseId * 100 + 1, item: { id: 3820 }, quantity: 12, unit_price: 230 }]);
    }
    return document([stack, { id: houseId * 100 + 2, item: { id: 3820 }, quantity: 5, bid: 100 },
      { id: houseId * 100 + 3, item: { id: 3820 }, quantity: 20, buyout: 5600 },
      { id: houseId * 100 + 4, item: { id: 2770 }, quantity: 100, unit_price: 1 }]);
  } };
}

test('inspect both books of every discovered neutral house, retaining every anonymous ask and exact stack cost', async () => {
  const api = client(), report = await inspectNeutralBooks(api);
  assert.deepEqual(report.houses.map((house) => house.id), [116, 117, 118, 121, 125]);
  assert.equal(api.calls.length, 12); // Two index calls, two documents for each of five houses.
  assert.equal(report.mappingConfirmed, false);
  assert.equal(report.region, 'us');
  assert.equal(report.game, 'forever');
  const quote = report.houses[0].quotes[0];
  assert.equal(quote.buyoutAuctions, 3); // Duplicate across documents counts once.
  assert.equal(quote.buyoutUnits, 52);
  assert.equal(quote.bidOnlyAuctions, 1);
  assert.deepEqual(quote.offers, [
    { unitPrice: 230, quantity: 12, totalBuyout: 2760, listingCount: 1, feeds: ['commodities'] },
    { unitPrice: 280, quantity: 20, totalBuyout: 5600, listingCount: 2, feeds: ['commodities', 'items'] },
  ]);
  assert.equal(quote.priceLevels[1].quantity, 40);
  assert.equal(quote.minBuyout, 230);
  assert.equal(quote.medianBuyout, 280);
  assert.equal(JSON.stringify(report).includes('"id":11600'), false);
  assert.equal(report.retainedAt, '2026-11-16T12:00:00.000Z');
  assert.equal(report.expiresAt, Date.parse(report.retainedAt) + 30 * 86_400_000);
});

test('malformed, empty and partial feeds stay distinguishable; failed feeds do not erase available asks', async () => {
  const report = await inspectNeutralBooks(client());
  assert.equal(report.houses.find((house) => house.id === 118).status, 'error');
  const empty = report.houses.find((house) => house.id === 121);
  assert.equal(empty.status, 'ok'); assert.deepEqual(empty.quotes, []);
  const partial = report.houses.find((house) => house.id === 125);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.failures, [{ feed: 'commodities', error: 'Unavailable' }]);
  assert.equal(partial.quotes[0].minBuyout, 280);
  assert.equal(partial.observedAt, null);
});

test('the diagnostic can challenge the expected IDs and includes new advertised neutral houses', async () => {
  const api = client(), original = api.get;
  api.get = async function(path, options) {
    const result = await original.call(this, path, options);
    if (path.endsWith('/auctions/')) result.data.auctions = [{ id: 999, name: 'Neutral Auction House' }];
    return result;
  };
  const report = await inspectNeutralBooks(api);
  assert.deepEqual(report.houses.map((house) => house.id), [999]);
  assert.equal(report.houses[0].rulesetLabel, 'Unconfirmed ruleset');
});

test('aborting the diagnostic stops rather than returning a misleading complete book', async () => {
  const api = client(), original = api.get, controller = new AbortController();
  api.get = async function(path, options) {
    if (path.endsWith('/116')) { controller.abort(); throw new Error('Canceled'); }
    return original.call(this, path, options);
  };
  await assert.rejects(inspectNeutralBooks(api, { signal: controller.signal }), /Canceled/);
  assert.equal(api.calls.some((path) => path.includes('/117')), false);
});
