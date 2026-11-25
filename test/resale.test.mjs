import test from 'node:test';
import assert from 'node:assert/strict';
import { neutralResale, sortResaleRows } from '../shared/resale.mjs';
import { reduceHouse, mergeRows } from '../src/market.mjs';
import { catalog, document } from './fixtures.mjs';

function example() {
  const levels = [
    { unitPrice: 500, quantity: 2, listingCount: 1, totalBuyout: 1000 },
    { unitPrice: 900, quantity: 3, listingCount: 2, totalBuyout: 2700 },
    { unitPrice: 950, quantity: 100, listingCount: 1, totalBuyout: 95000 },
    { unitPrice: 1000, quantity: 500, listingCount: 1, totalBuyout: 500000 },
  ];
  return { key: '2770:', id: 2770, name: 'Copper Ore', category: 'Ores', quotes: {
    alliance: { minBuyout: 1000, medianBuyout: 2000, buyoutUnits: 10 },
    neutral: { minBuyout: 500, buyoutUnits: 605, buyoutAuctions: 5, priceLevels: levels },
  } };
}

test('sum every profitable neutral level after the Alliance fee; exclude break-even and losing stock', () => {
  const row = example(), before = structuredClone(row);
  row.quotes.neutral.priceLevels.reverse();
  const plan = neutralResale(row);
  assert.equal(plan.status, 'profitable');
  assert.equal(plan.allianceAsk, 1000); // Never use the comparison page's median.
  assert.equal(plan.profitableUnits, 5);
  assert.equal(plan.profitableListings, 3);
  assert.equal(plan.purchaseCost, 3700);
  assert.equal(plan.grossRevenue, 5000);
  assert.equal(plan.saleFee, 250);
  assert.equal(plan.netRevenue, 4750);
  assert.equal(plan.expectedProfit, 1050);
  assert.equal(plan.expectedMargin, 0.21);
  assert.deepEqual(plan.levels.map((level) => [level.unitPrice, level.expectedProfit]), [[500, 900], [900, 150]]);
  assert.deepEqual(row.quotes.neutral.priceLevels, before.quotes.neutral.priceLevels.reverse()); // Input is not sorted in place.
});

test('whole-stack costs, equal-price offers, duplicates and bids survive reduction correctly', () => {
  const stack = { id: 1, item: { id: 2770 }, quantity: 3, buyout: 100 };
  const otherStack = { id: 2, item: { id: 2770 }, quantity: 6, buyout: 200 };
  const commodity = { id: 3, item: { id: 2770 }, quantity: 2, unit_price: 40 };
  const bid = { id: 4, item: { id: 2770 }, quantity: 100, bid: 1 };
  const neutral = reduceHouse([document([stack, otherStack]), document([stack, commodity, bid])], catalog, 116);
  assert.deepEqual(neutral.quotes[0].priceLevels, [
    { unitPrice: 100 / 3, quantity: 9, listingCount: 2, totalBuyout: 300 },
    { unitPrice: 40, quantity: 2, listingCount: 1, totalBuyout: 80 },
  ]);
  const alliance = reduceHouse([document([{ id: 5, item: { id: 2770 }, quantity: 10, buyout: 1000 }])], catalog, 110);
  const rows = mergeRows(catalog, { alliance: { status: 'ok', ...alliance }, neutral: { status: 'ok', ...neutral } });
  const plan = neutralResale(rows.find((row) => row.id === 2770));
  assert.equal(plan.profitableUnits, 11);
  assert.equal(plan.purchaseCost, 380);
  assert.equal(plan.saleFee, 55);
  assert.equal(plan.expectedProfit, 665);
  assert.equal(neutral.quotes[0].buyoutUnits, 11);
  assert.equal(neutral.quotes[0].units, 111);
  assert.equal(alliance.quotes[0].priceLevels, undefined);
  assert.ok(!JSON.stringify(neutral.quotes).includes('"id":'));
});

test('missing or partial price depth and unknown sale targets do not invent profit', () => {
  const mutations = [
    (row) => { delete row.quotes.neutral.priceLevels; },
    (row) => { row.quotes.neutral.priceLevels.pop(); },
    (row) => { row.quotes.neutral.priceLevels[0].quantity = 0; },
    (row) => { row.quotes.neutral.priceLevels[0].totalBuyout = 1; },
    (row) => { row.quotes.neutral.buyoutAuctions++; },
    (row) => { row.quotes.neutral = null; },
    (row) => { row.quotes.alliance = null; },
    (row) => { row.quotes.alliance.minBuyout = null; },
    (row) => { row.quotes.alliance.minBuyout = Number.MAX_SAFE_INTEGER; },
  ];
  for (const mutate of mutations) {
    const row = example(); mutate(row);
    const plan = neutralResale(row);
    assert.equal(plan.status, 'unavailable');
    assert.equal(plan.expectedProfit, null);
    assert.equal(plan.expectedMargin, null);
  }
});

test('known empty books and wholly unprofitable books yield no opportunity', () => {
  const row = example();
  row.quotes.alliance.minBuyout = 500;
  assert.equal(neutralResale(row).status, 'unprofitable');
  assert.equal(neutralResale(row).expectedProfit, 0);
  row.quotes.neutral = { minBuyout: null, buyoutUnits: 0, buyoutAuctions: 0, priceLevels: [] };
  assert.equal(neutralResale(row).status, 'unprofitable');
});

test('variants match only their own Alliance ask and never borrow a base-item price', () => {
  const neutral = reduceHouse([document([{ id: 1, item: { id: 2770, context: 2 }, quantity: 10, buyout: 100 }])], catalog, 116);
  const alliance = reduceHouse([document([{ id: 2, item: { id: 2770 }, quantity: 1, buyout: 1000 }])], catalog, 110);
  const rows = mergeRows(catalog, { alliance: { status: 'ok', ...alliance }, neutral: { status: 'ok', ...neutral } });
  assert.equal(neutralResale(rows.find((row) => row.variant)).status, 'unavailable');
  assert.equal(neutralResale(rows.find((row) => row.id === 2770 && !row.variant)).status, 'unprofitable');
});

test('profit sorting uses full precision and both stock columns remain independently sortable', () => {
  const a = { ...example(), name: 'A', resale: { expectedProfit: 1000.1 } };
  const b = { ...example(), name: 'B', resale: { expectedProfit: 1000.2 } };
  b.quotes.alliance.buyoutUnits = 20;
  b.quotes.neutral.buyoutUnits = 2;
  assert.deepEqual(sortResaleRows([a, b]).map((row) => row.name), ['B', 'A']);
  assert.deepEqual(sortResaleRows([a, b], { key: 'allianceUnits', direction: -1 }).map((row) => row.name), ['B', 'A']);
  assert.deepEqual(sortResaleRows([a, b], { key: 'neutralUnits', direction: -1 }).map((row) => row.name), ['A', 'B']);
});
