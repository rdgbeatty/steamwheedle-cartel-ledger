import { US_PVP } from '../shared/market.mjs';
import { ALL_ITEMS_SCOPE } from '../shared/items.mjs';

export function demoSnapshot() {
  const at = new Date().toISOString();
  const items = [
    [2770, 'Copper Ore', 'Ores', 125, 180, 90, 1850],
    [2771, 'Tin Ore', 'Ores', 310, 275, 390, 420],
    [2772, 'Iron Ore', 'Ores', 570, 640, 430, 610],
    [10620, 'Thorium Ore', 'Ores', 1500, 1680, 2100, 190],
    [2447, 'Peacebloom', 'Herbs', 42, 90, 25, 1240],
    [765, 'Silverleaf', 'Herbs', 68, 57, 90, 960],
    [2450, 'Briarthorn', 'Herbs', 210, 250, 310, 530],
    [13463, 'Dreamfoil', 'Herbs', 950, 1170, null, 280],
    [2840, 'Copper Bar', 'Metal & Stone', 400, 600, 450, 500],
    [4306, 'Silk Cloth', 'Cloth', 600, 700, 750, 1200],
    [118, 'Minor Healing Potion', 'Consumable', 500, 550, 600, 1200],
    [4560, 'Fine Scimitar', 'Weapon', 25000, 27000, 28000, 35],
  ];
  return { version: 1, mode: 'demo', game: 'forever', region: 'us', ruleset: 1, market: US_PVP, mappingVerified: false,
    generatedAt: at, retainedAt: at, neutralDepthVersion: 1,
    catalog: { scope: ALL_ITEMS_SCOPE, count: items.length, generatedAt: at, coverage: 'Twelve illustrative items across several categories. This is not a full catalog.' },
    warnings: ['Sample prices and quantities are invented. No Blizzard request was made.'],
    liquidity: { source: 'Sample estimates (invented)', kind: 'estimated-sales-per-day', game: 'forever', region: 'us', ruleset: 'pvp',
      markets: Object.fromEntries(['alliance', 'horde'].map((faction) => [faction, { status: 'ok', market: `forever.pvp.${faction}.us`, observedAt: at,
        expiresAt: Date.parse(at) + 3_600_000, items: { 2770: faction === 'alliance' ? 1800 : 1500, 2447: faction === 'alliance' ? 1400 : 1200 } }])) },
    houses: Object.fromEntries(['alliance', 'horde', 'neutral'].map((faction, index) => [faction, { id: 110 + index * 3, status: 'ok', observedAt: at, documents: [] }])),
    rows: items.map(([id, name, category, alliance, horde, neutral, units]) => ({ id, name, category, key: `${id}:`, variant: '',
      quotes: Object.fromEntries(Object.entries({ alliance, horde, neutral }).map(([faction, price]) => [faction, {
        minBuyout: price, medianBuyout: price === null ? null : Math.round(price * 1.12), units: price === null ? 0 : units,
        buyoutUnits: price === null ? 0 : units, auctions: price === null ? 0 : 30, buyoutAuctions: price === null ? 0 : 30, bidOnlyAuctions: 0,
        ...(faction === 'neutral' ? { medianBuyout: price === null ? null : Math.round(price * 1.2),
          priceLevels: price === null ? [] : [price, Math.round(price * 1.2), price * 2].map((unitPrice, index) => {
            const quantity = index === 2 ? units - 2 * Math.floor(units / 3) : Math.floor(units / 3);
            return { unitPrice, quantity, listingCount: 10, totalBuyout: unitPrice * quantity };
          }) } : {}),
      }])) })),
  };
}
