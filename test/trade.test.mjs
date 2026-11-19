import test from 'node:test';
import assert from 'node:assert/strict';
import { TRADE_DEFAULTS, allianceTrade, tradeMatches, sortTradeRows } from '../shared/trade.mjs';

function row(name = 'Copper Ore', alliance = 1_000_000, horde = 2_000_000, neutral = 1_500_000, aq = 2000, hq = 3000) {
  return { id: 2770, key: `${name}:`, name, variant: '', quotes: {
    alliance: { minBuyout: alliance, medianBuyout: alliance * 1.1, buyoutUnits: aq },
    horde: { minBuyout: horde, medianBuyout: horde * 1.1, buyoutUnits: hq },
    neutral: { minBuyout: neutral, medianBuyout: neutral * 1.1, buyoutUnits: 10 },
  } };
}
const now = Date.now();
function estimates(a = 1200, h = 1500) {
  return { game: 'forever', region: 'us', ruleset: 'pvp', kind: 'estimated-sales-per-day', markets: Object.fromEntries(['alliance', 'horde'].map((faction) => [faction,
    { status: 'ok', market: `forever.pvp.${faction}.us`, expiresAt: now + 60_000, items: { 2770: faction === 'alliance' ? a : h } }])) };
}

test('correct fees apply to different sale prices; own return and partner return stay separate', () => {
  const result = allianceTrade(row());
  assert.equal(result.hordeFee, 100_000);
  assert.equal(result.neutralCeiling, 1_900_000);
  assert.equal(result.neutralFee, 285_000);
  assert.equal(result.unitProfit, 615_000); // 200g Horde → 190g neutral ceiling → 161.5g receipts − 100g cost.
  assert.equal(result.ownProfitAtNeutralAsk, 275_000); // 150g neutral × .85 − 100g.
  assert.equal(result.traderProfitAtNeutralAsk, 400_000); // 200g Horde × .95 − 150g.
  assert.equal(result.profitVolume, 615_000 * 2000);
  assert.equal(result.volumeKind, 'stock');
});

test('filters reject reverse flow, fee losses and stock below 1000 on either side by default', () => {
  assert.equal(tradeMatches(allianceTrade(row())), true);
  for (const item of [row('Reverse', 200, 100), row('Fees consume gap', 100, 120), row('Too little A stock', 100, 200, 150, 999, 2000), row('Too little H stock', 100, 200, 150, 2000, 999)]) {
    assert.equal(tradeMatches(allianceTrade(item)), false);
  }
  assert.equal(tradeMatches(allianceTrade(row('Boundary', 100, 200, 150, 1000, 1000))), true);
  assert.equal(tradeMatches(allianceTrade(row('Either', 100, 200, 150, 1000, 5)), { ...TRADE_DEFAULTS, volumeMarkets: 'either', minProfitVolume: 0 }), true);
  const breakEven = allianceTrade(row('Break even', 323, 400));
  assert.equal(tradeMatches(breakEven, { ...TRADE_DEFAULTS, minProfitVolume: 0 }), false);
});

test('profit minimums filter the existing margin; desired profit is never added to the score', () => {
  const result = allianceTrade(row());
  assert.equal(tradeMatches(result, { ...TRADE_DEFAULTS, minUnitProfit: 615_000, minProfitVolume: 615_000 * 2000 }), true);
  assert.equal(tradeMatches(result, { ...TRADE_DEFAULTS, minUnitProfit: 615_001 }), false);
  assert.equal(tradeMatches(result, { ...TRADE_DEFAULTS, minProfitVolume: result.profitVolume + 1 }), false);
  assert.equal(result.profitVolume, 615_000 * 2000);
});

test('turning the volume minimum off retains the fee and profit filters and volume multiplier', () => {
  const plan = allianceTrade(row('Small stock', 100, 200, 150, 5, 10));
  const filters = { ...TRADE_DEFAULTS, minProfitVolume: 0 };
  assert.equal(tradeMatches(plan, filters), false);
  assert.equal(tradeMatches(plan, { ...filters, filterLowVolume: false }), true);
  assert.equal(plan.volume, 5);
  assert.equal(tradeMatches(plan, { ...filters, filterLowVolume: false, minProfitVolume: plan.profitVolume + 1 }), false);
  assert.equal(tradeMatches(allianceTrade(row('Fee loss', 100, 120, 110, 5, 10)), { ...filters, filterLowVolume: false }), false);
});

test('use the smaller daily estimate when both exist; do not mix units/day with stock', () => {
  const result = allianceTrade(row(), { liquidity: estimates(), now });
  assert.equal(result.volumeKind, 'daily');
  assert.equal(result.volume, 1200);
  assert.equal(result.profitVolume, 615_000 * 1200);
  const partial = estimates(); delete partial.markets.horde.items[2770];
  const fallback = allianceTrade(row(), { liquidity: partial, now });
  assert.equal(fallback.volumeKind, 'stock');
  assert.equal(fallback.volume, 2000);
  assert.equal(allianceTrade(row(), { liquidity: partial, volumeMode: 'daily', now }).status, 'unavailable');
  assert.equal(allianceTrade(row(), { liquidity: estimates(0, 1500), now }).volume, 0); // Never replace measured zero with stock.
  assert.equal(allianceTrade(row(), { liquidity: estimates(), volumeMode: 'stock', now }).volume, 2000);
});

test('expired, wrong-market and variant estimates never contaminate the daily volume', () => {
  const expired = estimates(); expired.markets.alliance.expiresAt = now;
  const wrong = estimates(); wrong.markets.horde.market = 'forever.normal.horde.us';
  const retail = estimates(); retail.game = 'retail';
  for (const source of [expired, wrong, retail]) assert.equal(allianceTrade(row(), { liquidity: source, now }).volumeKind, 'stock');
  const variant = row(); variant.variant = '[2,[],[]]';
  assert.equal(allianceTrade(variant, { liquidity: estimates(), now }).volumeKind, 'stock');
});

test('unknown prices and stocks remain unavailable; missing neutral asks do not hide a faction opportunity', () => {
  const noHorde = row(); noHorde.quotes.horde = null;
  assert.equal(allianceTrade(noHorde).status, 'unavailable');
  const noStock = row(); noStock.quotes.alliance.buyoutUnits = null;
  assert.equal(allianceTrade(noStock).status, 'unavailable');
  const emptyNeutral = allianceTrade(row('Unlisted neutral', 100, 200, null));
  assert.equal(emptyNeutral.status, 'ok');
  assert.equal(emptyNeutral.ownProfitAtNeutralAsk, null);
  assert.equal(allianceTrade(row('Unsafe', 1, Number.MAX_SAFE_INTEGER)).status, 'unavailable');
});

test('sorting keeps full profit-volume precision and follows the chosen price basis', () => {
  const a = row('Alpha', 100, 200, null), b = row('Zulu', 100, 200.001, 150);
  const scored = [a, b].map((item) => ({ ...item, trade: allianceTrade(item) }));
  assert.equal(sortTradeRows(scored)[0].name, 'Zulu');
  assert.equal(sortTradeRows(scored, { key: 'neutral', direction: 1 }).at(-1).name, 'Alpha');
  assert.equal(allianceTrade(a, { basis: 'medianBuyout' }).allianceAsk, 110.00000000000001);
});
