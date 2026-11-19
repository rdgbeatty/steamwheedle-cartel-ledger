export const item = (id, name, subclass, itemClass = 7) => ({ id, name: { en_US: name }, item_class: { id: itemClass }, item_subclass: { id: subclass } });
export const catalog = { items: [{ id: 2770, name: 'Copper Ore', category: 'Ores' }, { id: 2447, name: 'Peacebloom', category: 'Herbs' }],
  warnings: [], generatedAt: new Date().toISOString(), coverage: 'Test catalog' };
export const discovery = { houses: [
  { id: 110, name: 'Alliance Auction House', faction: 'alliance' },
  { id: 111, name: 'Alliance Auction House', faction: 'alliance' },
  { id: 113, name: 'Horde Auction House', faction: 'horde' },
  { id: 116, name: 'Blackwater Auction House', faction: 'neutral' },
] };
export const selected = { alliance: 110, horde: 113, neutral: 116 };
export const document = (auctions, extras = {}) => ({ data: { auctions, ...extras }, observedAt: '2026-11-16T12:00:00.000Z', fetchedAt: '2026-11-16T12:20:00.000Z', timeBasis: 'Last-Modified', cached: false });

export function fakeClient() {
  return {
    calls: [], failBooks: false,
    async get(path, options = {}) {
      this.calls.push({ path, options });
      if (options.signal?.aborted) throw new Error('Collection canceled.');
      if (path === '/data/wow/ruleset/index') return { data: { rulesets: [{ id: 1, name: 'PvP' }] } };
      if (path === '/data/wow/ruleset/1/auctions/') return { data: { auctions: discovery.houses } };
      if (path === '/data/wow/search/item') return { data: { pageCount: 1, resultCountCapped: false, results:
        [item(2447, 'Peacebloom', 9), item(2770, 'Copper Ore', 7), item(2840, 'Copper Bar', 7), item(999999, 'Forever Test Herb', 9)]
        .map((data) => ({ data })) } };
      if (this.failBooks) throw new Error('Test upstream is unavailable.');
      const house = Number(path.split('/')[6]);
      return path.endsWith('/commodities') ? document([
        { id: house * 100, item: { id: 2770 }, quantity: 20, unit_price: house },
        { id: house * 100 + 1, item: { id: 2447 }, quantity: 50, unit_price: 10 },
      ]) : document([]);
    },
  };
}
