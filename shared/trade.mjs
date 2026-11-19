export const TRADE_DEFAULTS = Object.freeze({ filterLowVolume: true, minVolume: 1000, volumeMode: 'auto', volumeMarkets: 'both', minUnitProfit: 0, minProfitVolume: 10_000, allianceCheaper: true });
export const NEUTRAL_FEE = 0.15;
export const HORDE_FEE = 0.05;
const validPrice = (value) => Number.isFinite(value) && value > 0;
const validStock = (value) => Number.isSafeInteger(value) && value >= 0;

export function dailyEstimate(row, faction, liquidity, now = Date.now()) {
  // Providers report base items; never spread one estimate across distinct variants.
  if (row.variant || liquidity?.game !== 'forever' || liquidity.region !== 'us' || liquidity.ruleset !== 'pvp' || liquidity.kind !== 'estimated-sales-per-day') return null;
  const market = liquidity.markets?.[faction];
  if (market?.status !== 'ok' || market.market !== `forever.pvp.${faction}.us` || !Number.isFinite(market.expiresAt) || market.expiresAt <= now) return null;
  const value = market.items?.[row.id];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function allianceTrade(row, { basis = 'minBuyout', volumeMode = 'auto', liquidity = null, now = Date.now() } = {}) {
  const alliance = row.quotes?.alliance, horde = row.quotes?.horde;
  const a = alliance?.[basis], h = horde?.[basis], n = row.quotes?.neutral?.[basis];
  if (![a, h].every(validPrice)) return { status: 'unavailable', reason: 'Alliance and Horde buyout prices are required.' };
  const aDaily = dailyEstimate(row, 'alliance', liquidity, now), hDaily = dailyEstimate(row, 'horde', liquidity, now);
  const hasDaily = aDaily !== null && hDaily !== null;
  const daily = volumeMode !== 'stock' && hasDaily;
  if (volumeMode === 'daily' && !hasDaily) return { status: 'unavailable', reason: 'Both daily sales estimates are required.' };
  // Never mix daily estimates and stock counts into a single quantity measure.
  const aVolume = daily ? aDaily : alliance?.buyoutUnits, hVolume = daily ? hDaily : horde?.buyoutUnits;
  if (daily ? ![aVolume, hVolume].every((v) => Number.isFinite(v) && v >= 0) : ![aVolume, hVolume].every(validStock)) return { status: 'unavailable', reason: 'Both listed-stock counts are required for the proxy.' };
  const volume = Math.min(aVolume, hVolume);
  const hordeFee = h * HORDE_FEE;
  const neutralCeiling = h - hordeFee;
  const neutralFee = neutralCeiling * NEUTRAL_FEE;
  const unitProfit = neutralCeiling - neutralFee - a;
  const profitVolume = unitProfit * volume;
  if (![neutralCeiling, unitProfit, profitVolume].every((v) => Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER)) return { status: 'unavailable', reason: 'Opportunity exceeds safe numeric precision.' };
  return { status: 'ok', allianceAsk: a, hordeAsk: h, neutralAsk: validPrice(n) ? n : null,
    allianceVolume: aVolume, hordeVolume: hVolume, aDaily, hDaily, volume, volumeKind: daily ? 'daily' : 'stock',
    hordeFee, neutralCeiling, neutralFee, unitProfit, profitVolume,
    // These describe a different, observable neutral-price scenario, not the ceiling.
    ownProfitAtNeutralAsk: validPrice(n) ? n * (1 - NEUTRAL_FEE) - a : null,
    traderProfitAtNeutralAsk: validPrice(n) ? neutralCeiling - n : null };
}

export function tradeMatches(plan, filters = TRADE_DEFAULTS) {
  if (plan.status !== 'ok') return false;
  if (filters.allianceCheaper && plan.allianceAsk >= plan.hordeAsk) return false;
  const volumePass = filters.volumeMarkets === 'either' ? Math.max(plan.allianceVolume, plan.hordeVolume) : Math.min(plan.allianceVolume, plan.hordeVolume);
  const epsilon = Number.EPSILON * Math.max(plan.allianceAsk, plan.hordeAsk) * 8;
  return (filters.filterLowVolume === false || volumePass >= filters.minVolume) && plan.unitProfit > epsilon && plan.unitProfit + epsilon >= filters.minUnitProfit && plan.profitVolume >= filters.minProfitVolume;
}

export function sortTradeRows(rows, { key = 'profitVolume', direction = -1 } = {}, basis = 'minBuyout') {
  const value = (row) => {
    if (['name', 'category'].includes(key)) return row[key];
    if (['alliance', 'horde', 'neutral'].includes(key)) return row.quotes?.[key]?.[basis] ?? null;
    if (key.endsWith('Units')) return row.quotes?.[key.slice(0, -5)]?.buyoutUnits ?? null;
    if (key === 'imbalance') return row.trade.hordeAsk - row.trade.allianceAsk;
    if (key === 'neutralImbalance') return row.trade.neutralAsk === null ? null : Math.abs(row.trade.neutralAsk - row.trade.allianceAsk);
    return row.trade[key] ?? null;
  };
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * direction || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
}
