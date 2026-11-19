export const ALLIANCE_SALE_FEE = 0.05;

const positive = (value) => Number.isFinite(value) && value > 0;
const whole = (value) => Number.isSafeInteger(value) && value >= 0;
const safeAmount = (value) => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;

// Prices are copper per unit; depth costs are exact whole-listing buyout totals.
// Fees are modeled as a proportional 5%, without rounding individual sale fees.
export function neutralResale(row) {
  const alliance = row.quotes?.alliance, neutral = row.quotes?.neutral;
  const unavailable = (reason) => ({ status: 'unavailable', reason, expectedProfit: null, levels: [] });
  if (!alliance || !neutral) return unavailable('An auction house is unavailable.');
  if (!Array.isArray(neutral.priceLevels)) return unavailable('Collect again to load neutral price levels.');
  if (!positive(alliance.minBuyout)) return unavailable('No Alliance buyout ask is available as a sale target.');
  if (!whole(neutral.buyoutUnits) || !whole(neutral.buyoutAuctions)) return unavailable('Neutral stock coverage is unknown.');

  const result = { status: 'unprofitable', allianceAsk: alliance.minBuyout, neutralAsk: neutral.minBuyout,
    profitableUnits: 0, profitableListings: 0, purchaseCost: 0, grossRevenue: 0,
    saleFee: 0, netRevenue: 0, expectedProfit: 0, levels: [] };
  let units = 0, listings = 0;
  for (const level of [...neutral.priceLevels].sort((a, b) => a.unitPrice - b.unitPrice)) {
    const { unitPrice, quantity, listingCount, totalBuyout } = level;
    if (!positive(unitPrice) || !whole(quantity) || quantity === 0 || !whole(listingCount) || listingCount === 0 ||
      listingCount > quantity || !whole(totalBuyout) || totalBuyout === 0) return unavailable('Neutral price depth is incomplete.');
    // Reject inconsistent depth rather than estimating from a summary minimum.
    const costError = Math.abs(unitPrice * quantity - totalBuyout);
    if (costError > Number.EPSILON * Math.max(1, totalBuyout) * 8) return unavailable('Neutral price depth has inconsistent costs.');
    units += quantity; listings += listingCount;
    const grossRevenue = alliance.minBuyout * quantity;
    const saleFee = grossRevenue * ALLIANCE_SALE_FEE;
    const netRevenue = grossRevenue - saleFee;
    const expectedProfit = netRevenue - totalBuyout;
    if (![grossRevenue, saleFee, expectedProfit].every(safeAmount)) return unavailable('Profit exceeds safe numeric precision.');
    // Suppress floating-point dust at the exact break-even boundary.
    if (expectedProfit <= Number.EPSILON * Math.max(1, grossRevenue, totalBuyout) * 8) continue;
    result.levels.push({ ...level, grossRevenue, saleFee, netRevenue, expectedProfit });
    result.profitableUnits += quantity; result.profitableListings += listingCount;
    result.purchaseCost += totalBuyout; result.grossRevenue += grossRevenue;
    result.saleFee += saleFee; result.netRevenue += netRevenue; result.expectedProfit += expectedProfit;
  }
  if (!whole(units) || !whole(listings) || units !== neutral.buyoutUnits || listings !== neutral.buyoutAuctions) return unavailable('Neutral price depth does not cover all buyout listings.');
  if (![result.purchaseCost, result.grossRevenue, result.saleFee, result.netRevenue, result.expectedProfit].every(safeAmount)) return unavailable('Profit exceeds safe numeric precision.');
  if (result.expectedProfit > 0) result.status = 'profitable';
  return result;
}

export function sortResaleRows(rows, { key = 'expectedProfit', direction = -1 } = {}) {
  const value = (row) => key === 'name' || key === 'category' ? row[key]
    : key === 'allianceUnits' ? row.quotes.alliance.buyoutUnits
      : key === 'neutralUnits' ? row.quotes.neutral.buyoutUnits : row.resale[key];
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return order * direction || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
}
