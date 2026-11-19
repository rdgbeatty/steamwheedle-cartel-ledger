import test from 'node:test';
import assert from 'node:assert/strict';
import { comparison, listingCount, sortRows, isPvpSnapshot } from '../shared/market.mjs';
import { compactNumber } from '../public/format.mjs';

function row(name, a, h, aq = 100, hq = 30) {
  return { name, key: name, quotes: {
    alliance: { minBuyout: a, medianBuyout: a === null ? null : a + 10, buyoutUnits: aq, auctions: 12, bidOnlyAuctions: 2 },
    horde: { minBuyout: h, medianBuyout: h === null ? null : h + 10, buyoutUnits: hq, auctions: 8, bidOnlyAuctions: 1 },
  } };
}

test('absolute imbalance is symmetric; weighting uses the cheaper faction supply', () => {
  assert.deepEqual(comparison(row('A cheaper', 10, 100, 20, 900)), {
    imbalance: 90, cheaper: 'alliance', higher: 'horde', sourceUnits: 20, weightedSpread: 1800,
  });
  assert.deepEqual(comparison(row('H cheaper', 100, 10, 900, 20)), {
    imbalance: 90, cheaper: 'horde', higher: 'alliance', sourceUnits: 20, weightedSpread: 1800,
  });
});

test('missing prices or quantities remain unknown; equal prices have zero imbalance', () => {
  assert.equal(comparison(row('missing', 10, null)).imbalance, null);
  assert.equal(comparison(row('zero is not a quote', 0, 100)).weightedSpread, null);
  const unknown = row('unknown stock', 10, 100, null, 20);
  assert.equal(comparison(unknown).imbalance, 90);
  assert.equal(comparison(unknown).weightedSpread, null);
  assert.deepEqual(comparison(row('tie', 10, 10)), { imbalance: 0, higher: null, cheaper: null, sourceUnits: null, weightedSpread: 0 });
});

test('default sort ranks absolute gaps both directions; unknowns stay last', () => {
  const rows = [row('small', 10, 12), row('missing', 10, null), row('H cheaper', 100, 1), row('A cheaper', 1, 50)];
  assert.deepEqual(sortRows(rows).map((value) => value.name), ['H cheaper', 'A cheaper', 'small', 'missing']);
  assert.deepEqual(sortRows(rows, { key: 'imbalance', direction: 1 }).map((value) => value.name), ['small', 'A cheaper', 'H cheaper', 'missing']);
  assert.equal(rows[0].name, 'small');
});

test('weighted ranking uses unrounded product and updates with selected price basis', () => {
  const oneOff = row('large single offer', 10, 1000, 1, 99);
  const busy = row('many units', 10, 100, 1000, 20);
  assert.equal(sortRows([oneOff, busy])[0].name, oneOff.name);
  assert.equal(sortRows([oneOff, busy], { key: 'weightedSpread', direction: -1 })[0].name, busy.name);
  busy.quotes.alliance.medianBuyout = 500;
  busy.quotes.horde.medianBuyout = 200;
  assert.deepEqual(comparison(busy, 'medianBuyout'), { imbalance: 300, cheaper: 'horde', higher: 'alliance', sourceUnits: 20, weightedSpread: 6000 });
  const a = row('Alpha lower', 1, 1.001001, 10000);
  const b = row('Zulu higher', 1, 1.001002, 10000);
  assert.equal(compactNumber(comparison(a).weightedSpread), compactNumber(comparison(b).weightedSpread));
  assert.equal(sortRows([a, b], { key: 'weightedSpread', direction: -1 })[0].name, b.name);
});

test('quantities and buyout offer counts are separately sortable, with legacy quote support', () => {
  const first = row('first', 10, 100, 1000, 20), second = row('second', 10, 100, 1, 1000);
  assert.equal(listingCount(first.quotes.alliance), 10);
  assert.equal(listingCount({ buyoutAuctions: 3, auctions: 99 }), 3);
  assert.equal(listingCount(null), null);
  assert.equal(sortRows([first, second], { key: 'allianceUnits', direction: -1 })[0].name, 'first');
  assert.equal(sortRows([first, second], { key: 'hordeUnits', direction: -1 })[0].name, 'second');
  second.quotes.alliance.buyoutAuctions = 100;
  assert.equal(sortRows([first, second], { key: 'allianceListings', direction: -1 })[0].name, 'second');
});

test('compact formatting limits precision and handles suffix rollovers through trillions', () => {
  for (const [value, expected] of [[0, '0'], [1, '1'], [1.23456, '1.23'], [12.3456, '12.3'], [123.456, '123'],
    [1234, '1.23k'], [12345, '12.3k'], [999999, '1M'], [1234567890, '1.23B'], [1234567890123, '1.23T'],
    [999499, '999k'], [0.000123456, '0.000123'], [1e30, '1.00e+30']]) assert.equal(compactNumber(value), expected);
  for (const value of [NaN, Infinity, null, undefined, -1]) assert.equal(compactNumber(value), '—');
});

test('US PvP snapshot identity includes host region, ruleset and exact house IDs', () => {
  const base = { game: 'forever', region: 'us', ruleset: 1, houses: { alliance: { id: 110 }, horde: { id: 113 }, neutral: { id: 116 } } };
  assert.equal(isPvpSnapshot(base), true);
  assert.equal(isPvpSnapshot({ ...base, region: 'eu' }), false);
  assert.equal(isPvpSnapshot({ ...base, ruleset: 2 }), false);
  assert.equal(isPvpSnapshot({ ...base, houses: { ...base.houses, alliance: { id: 111 } } }), false);
});

test('Neutral–Alliance imbalance has independent direction, price basis and sorting', () => {
  const higher = row('neutral higher', 100, 10000);
  higher.quotes.neutral = { minBuyout: 600, medianBuyout: 70, buyoutUnits: 20 };
  assert.deepEqual(comparison(higher, 'minBuyout', 'neutral'), { imbalance: 500, cheaper: 'alliance', higher: 'neutral', sourceUnits: 100, weightedSpread: 50000 });
  assert.deepEqual(comparison(higher, 'medianBuyout', 'neutral'), { imbalance: 40, cheaper: 'neutral', higher: 'alliance', sourceUnits: 20, weightedSpread: 800 });
  const lower = row('neutral lower', 1000, null);
  lower.quotes.neutral = { minBuyout: 100, buyoutUnits: 10 };
  const unknown = row('neutral unlisted', 100, 200);
  unknown.quotes.neutral = { minBuyout: null, buyoutUnits: 0 };
  const equal = row('equal', 100, 200);
  equal.quotes.neutral = { minBuyout: 100, buyoutUnits: 5 };
  assert.equal(comparison(unknown, 'minBuyout', 'neutral').imbalance, null);
  assert.equal(comparison(equal, 'minBuyout', 'neutral').imbalance, 0);
  assert.deepEqual(sortRows([higher, lower, unknown, equal], { key: 'neutralImbalance', direction: -1 }).map((value) => value.name),
    ['neutral lower', 'neutral higher', 'equal', 'neutral unlisted']);
  assert.deepEqual(sortRows([higher, lower, unknown, equal], { key: 'neutralImbalance', direction: 1 }).map((value) => value.name),
    ['equal', 'neutral higher', 'neutral lower', 'neutral unlisted']);
});
