import { discoverHouses } from './catalog.mjs';
import { reduceHouse } from './market.mjs';

export const STRANGLEKELP = Object.freeze({ id: 3820, name: 'Stranglekelp', category: 'Herbs' });
const labels = { 116: 'PvP (community label)', 117: 'Normal (community label)', 118: 'Unconfirmed ruleset', 121: 'RP Normal (community label)', 125: 'RP PvP (community label)' };
const DAY = 86_400_000;

// Discovery is intentionally independent of the trading selection: this check is
// how the owner can falsify that selection. It never saves settings or prices.
export async function inspectNeutralBooks(client, { signal, progress = () => {} } = {}) {
  progress('Discovering all US Forever neutral houses…');
  const discovery = await discoverHouses(client, { signal, verifyPvp: false });
  const neutrals = discovery.houses.filter((house) => house.faction === 'neutral').sort((a, b) => a.id - b.id);
  if (!neutrals.length) throw new Error('The US Forever index advertised no recognizable neutral houses.');
  const houses = [];
  for (const house of neutrals) {
    const documents = [], failures = [];
    for (const [feed, ending] of [['items', ''], ['commodities', '/commodities']]) {
      progress(`Stranglekelp · neutral ${house.id} · ${feed}`);
      try { documents.push({ ...await client.get(`/data/wow/ruleset/1/auctions/${house.id}${ending}`, { signal }), feed }); }
      catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ feed, error: error.message });
      }
    }
    const metadata = documents.map(({ data, ...document }) => document);
    const observed = documents.map((document) => document.observedAt).filter(Boolean).sort();
    const common = { ...house, rulesetLabel: labels[house.id] ?? 'Unconfirmed ruleset',
      observedAt: observed.length === 2 ? observed[0] : null, documents: metadata, failures };
    try {
      const result = documents.length ? reduceHouse(documents, { items: [STRANGLEKELP] }, house.id, { priceDepth: true, includeOffers: true }) : null;
      houses.push({ ...common, status: !result ? 'error' : failures.length ? 'partial' : 'ok', quotes: result?.quotes ?? [] });
    } catch (error) { houses.push({ ...common, status: 'error', error: error.message, quotes: [] }); }
  }
  const now = Date.now();
  const times = houses.flatMap((house) => house.documents).map((document) => Date.parse(document.retainedAt ?? document.observedAt ?? document.fetchedAt)).filter(Number.isFinite);
  const retainedAt = Math.min(now, ...times);
  return { version: 1, game: 'forever', region: 'us', item: STRANGLEKELP, mappingConfirmed: false,
    generatedAt: new Date(now).toISOString(), retainedAt: new Date(retainedAt).toISOString(), expiresAt: retainedAt + 30 * DAY,
    discoveryAt: discovery.discoveredAt, houses,
    note: 'All advertised US neutral houses; ruleset labels are community evidence, not confirmation. API publication may lag the in-game book. All buyouts are included, grouped only when price and stack size match. Bid-only listings are counted separately. No seller or auction identities are retained.' };
}
