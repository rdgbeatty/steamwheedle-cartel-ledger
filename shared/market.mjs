// Community-correlated mapping; the ruleset segment alone does not filter auction books.
// Evidence and unresolved empty-house slots: docs/us-pvp-markets.md.
export const US_PVP = Object.freeze({
  game: 'forever', region: 'us', ruleset: 1, label: 'US PvP', locked: true,
  houses: Object.freeze({ alliance: 110, horde: 113, neutral: 116 }),
});
export const MAPPING_EVIDENCE = Object.freeze({
  method: 'community-corroborated', checkedAt: '2026-11-17',
  sources: [
    'https://hyjal.cc/auctions/us/pvp/alliance/item/8153/wildvine',
    'https://forevermastery.com/en/prices/us-ah125-neutral',
    'https://azerothauctionassassin.com/wow-forever/upload-timers',
  ],
});

export function validatePvpHouses(discovery) {
  for (const [faction, id] of Object.entries(US_PVP.houses)) {
    if (!discovery?.houses?.some((house) => house.id === id && house.faction === faction)) {
      throw new Error(`The US Forever index did not advertise the expected PvP ${faction} house ${id}. Check house discovery before collecting.`);
    }
  }
  return { ...US_PVP.houses };
}

export function isPvpSnapshot(snapshot) {
  return Boolean(snapshot && snapshot.game === US_PVP.game && snapshot.region === US_PVP.region && snapshot.ruleset === US_PVP.ruleset &&
    Object.entries(US_PVP.houses).every(([faction, id]) => snapshot.houses?.[faction]?.id === id));
}

// A single definition powers rendering and numeric sorting. Listed supply is not traded volume.
export function comparison(row, basis = 'minBuyout', otherFaction = 'horde') {
  const alliance = row.quotes?.alliance?.[basis];
  const other = row.quotes?.[otherFaction]?.[basis];
  const unknown = { imbalance: null, cheaper: null, higher: null, sourceUnits: null, weightedSpread: null };
  if (![alliance, other].every((price) => Number.isFinite(price) && price > 0)) return unknown;
  const imbalance = Math.abs(other - alliance);
  if (imbalance === 0) return { imbalance: 0, cheaper: null, higher: null, sourceUnits: null, weightedSpread: 0 };
  const cheaper = alliance < other ? 'alliance' : otherFaction;
  const higher = cheaper === 'alliance' ? otherFaction : 'alliance';
  const quantity = row.quotes[cheaper].buyoutUnits;
  const sourceUnits = Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
  const weightedSpread = sourceUnits === null ? null : imbalance * sourceUnits;
  return { imbalance, cheaper, higher, sourceUnits, weightedSpread: Number.isFinite(weightedSpread) ? weightedSpread : null };
}

export function listingCount(quote) {
  if (!quote) return null;
  if (Number.isSafeInteger(quote.buyoutAuctions) && quote.buyoutAuctions >= 0) return quote.buyoutAuctions;
  if (!Number.isSafeInteger(quote.auctions) || !Number.isSafeInteger(quote.bidOnlyAuctions)) return null;
  const count = quote.auctions - quote.bidOnlyAuctions;
  return count >= 0 ? count : null;
}

export function sortRows(rows, { key = 'imbalance', direction = -1 } = {}, basis = 'minBuyout') {
  const value = (row) => {
    if (['alliance', 'horde', 'neutral'].includes(key)) return row.quotes?.[key]?.[basis] ?? null;
    if (key.endsWith('Units')) return row.quotes?.[key.slice(0, -5)]?.buyoutUnits ?? null;
    if (key.endsWith('Listings')) return listingCount(row.quotes?.[key.slice(0, -8)]);
    if (key === 'neutralImbalance') return comparison(row, basis, 'neutral').imbalance;
    if (['imbalance', 'weightedSpread'].includes(key)) return comparison(row, basis)[key];
    return row[key] ?? null;
  };
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
    const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return order * direction || a.name.localeCompare(b.name) || (a.key ?? '').localeCompare(b.key ?? '');
  });
}
