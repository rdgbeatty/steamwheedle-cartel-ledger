import { createHash } from 'node:crypto';
import { US_PVP, MAPPING_EVIDENCE, validatePvpHouses } from '../shared/market.mjs';
import { normalizeAuction } from '../shared/auction.mjs';
import { ALL_ITEMS_SCOPE, unknownItem } from '../shared/items.mjs';

export const FACTIONS = ['alliance', 'horde', 'neutral'];

function entries(document, houseId) {
  const body = document.data;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Unexpected auction document.');
  if (body.id !== undefined && body.id !== houseId) throw new Error('Blizzard returned a different house than requested.');
  if (Array.isArray(body.auctions)) return body.auctions;
  // Documented empty houses can omit auctions, but an arbitrary {} is not an empty book.
  if (body.id === houseId && typeof body.name === 'string' && body.auctions === undefined) return [];
  throw new Error('Auction document has no recognizable listings; coverage is unknown.');
}

export function reduceHouse(documents, catalog, houseId, { priceDepth = houseId === US_PVP.houses.neutral, includeOffers = false } = {}) {
  const tracked = new Set(catalog.items.map((item) => item.id));
  const unique = new Map();
  const sources = new Map();
  const fingerprints = [];
  for (const document of documents) {
    const rows = entries(document, houseId);
    for (const row of rows) {
      if (catalog.scope !== ALL_ITEMS_SCOPE && !tracked.has(row.item?.id)) continue;
      const value = normalizeAuction(row);
      if (unique.has(row.id) && JSON.stringify(unique.get(row.id)) !== JSON.stringify(value)) throw new Error('Item and commodity documents disagree on an auction ID. Retry after the next publication.');
      unique.set(row.id, value);
      if (includeOffers) {
        const feeds = sources.get(row.id) ?? new Set();
        feeds.add(document.feed ?? 'unspecified'); sources.set(row.id, feeds);
      }
    }
  }
  const groups = new Map();
  for (const row of unique.values()) {
    const key = `${row.itemId}:${row.variant}`;
    if (!groups.has(key)) groups.set(key, { itemId: row.itemId, variant: row.variant, units: 0, buyoutUnits: 0, auctions: 0, bidOnlyAuctions: 0, prices: [] });
    const group = groups.get(key);
    group.units += row.quantity; group.auctions++;
    if (!Number.isSafeInteger(group.units)) throw new Error('Tracked quantity exceeded safe numeric precision.');
    if (row.unitPrice === null) group.bidOnlyAuctions++;
    else { group.buyoutUnits += row.quantity; group.prices.push([row.unitPrice, row.quantity, row.totalBuyout, sources.get(row.id)]); }
    fingerprints.push([row.id, row.itemId, row.variant, row.quantity, row.unitPrice]);
  }
  const quotes = [...groups.values()].map(({ prices, ...group }) => {
    prices.sort((a, b) => a[0] - b[0]);
    let cumulative = 0, median = null;
    for (const [price, units] of prices) {
      cumulative += units;
      if (cumulative >= group.buyoutUnits / 2) { median = price; break; }
    }
    const quote = { ...group, buyoutAuctions: group.auctions - group.bidOnlyAuctions, minBuyout: prices[0]?.[0] ?? null, medianBuyout: median };
    // Retain anonymous neutral price depth in the latest snapshot only. Whole-stack
    // costs remain exact; IDs and other listing details never leave this reducer.
    if (priceDepth) {
      const levels = new Map();
      for (const [unitPrice, quantity, totalBuyout] of prices) {
        const level = levels.get(unitPrice) ?? { unitPrice, quantity: 0, listingCount: 0, totalBuyout: 0 };
        level.quantity += quantity; level.listingCount++; level.totalBuyout += totalBuyout;
        if (!Number.isSafeInteger(level.totalBuyout)) throw new Error('Neutral price depth exceeded safe numeric precision.');
        levels.set(unitPrice, level);
      }
      quote.priceLevels = [...levels.values()];
    }
    if (includeOffers) {
      const offers = new Map();
      for (const [unitPrice, quantity, totalBuyout, feeds] of prices) {
        const key = JSON.stringify([unitPrice, quantity, totalBuyout]);
        const offer = offers.get(key) ?? { unitPrice, quantity, totalBuyout, listingCount: 0, feeds: new Set() };
        for (const feed of feeds ?? []) offer.feeds.add(feed);
        offer.listingCount++; offers.set(key, offer);
      }
      quote.offers = [...offers.values()].map((offer) => ({ ...offer, feeds: [...offer.feeds].sort() })).sort((a, b) => a.unitPrice - b.unitPrice || a.quantity - b.quantity);
    }
    return quote;
  });
  fingerprints.sort((a, b) => a[0] - b[0]);
  return { quotes, fingerprint: createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex'), trackedAuctions: unique.size };
}

export function mergeRows(catalog, houses) {
  const metadata = new Map(catalog.items.map((item) => [item.id, item]));
  const rows = new Map(catalog.items.map((item) => [`${item.id}:`, { ...item, key: `${item.id}:`, variant: '', quotes: {} }]));
  for (const faction of FACTIONS) {
    const house = houses[faction];
    if (house?.status !== 'ok') continue;
    for (const quote of house.quotes) {
      const key = `${quote.itemId}:${quote.variant}`;
      if (!rows.has(key)) rows.set(key, { ...(metadata.get(quote.itemId) ?? unknownItem(quote.itemId)), key, variant: quote.variant, quotes: {} });
      rows.get(key).quotes[faction] = quote;
    }
  }
  for (const row of rows.values()) for (const faction of FACTIONS) {
    if (row.quotes[faction] === undefined) row.quotes[faction] = houses[faction]?.status === 'ok'
      ? { minBuyout: null, medianBuyout: null, units: 0, buyoutUnits: 0, auctions: 0, buyoutAuctions: 0, bidOnlyAuctions: 0,
        ...(faction === 'neutral' ? { priceLevels: [] } : {}) } : null;
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.variant.localeCompare(b.variant));
}

export async function collectMarket(client, catalog, selected, discovered, { signal, progress = () => {}, previousSnapshot = null } = {}) {
  const expected = validatePvpHouses(discovered);
  if (FACTIONS.some((faction) => selected[faction] !== expected[faction])) throw new Error('Collection is locked to US PvP houses 110, 113 and 116.');
  const houses = {};
  const itemSignature = (items) => JSON.stringify(items.map(({ id, name, category, itemClass, subcategory, classId, subclassId }) => [id, name, category, itemClass, subcategory, classId, subclassId]).sort((a, b) => a[0] - b[0]));
  const sameCatalog = previousSnapshot && previousSnapshot.catalog?.scope === catalog.scope && itemSignature(catalog.items) === itemSignature((previousSnapshot.rows ?? []).filter((row) => !row.variant && row.metadataSource !== 'auction')) &&
    catalog.coverage === previousSnapshot.catalog?.coverage && JSON.stringify(catalog.warnings) === JSON.stringify(previousSnapshot.catalog?.warnings ?? []);
  for (const faction of FACTIONS) {
    const id = selected[faction];
    if (!id) { houses[faction] = { status: 'unselected', id: null }; continue; }
    const known = discovered.houses.find((house) => house.id === id && house.faction === faction);
    if (!known) throw new Error('A selected house does not match the discovered faction. Discover houses again.');
    progress(`Reading ${faction} house ${id} · items and commodities`);
    try {
      const documents = [];
      const prior = previousSnapshot?.houses[faction];
      const reusable = sameCatalog && prior?.status === 'ok' && prior.id === id && prior.documents?.length === 2 &&
        (faction !== 'neutral' || previousSnapshot.neutralDepthVersion === 1);
      const endings = ['', '/commodities'];
      for (const [index, ending] of endings.entries()) documents.push(await client.get(`/data/wow/ruleset/1/auctions/${id}${ending}`, {
        signal, revalidate: true, forceBody: !reusable, validators: reusable ? prior.documents[index] : null,
      }));
      const unchanged = Boolean(reusable && documents.every((document) => document.notModified));
      // A partially changed house needs both raw documents to deduplicate books
      // and recompute its weighted median. Saved summaries alone cannot do that.
      if (!unchanged) for (const [index, document] of documents.entries()) if (document.data === null) {
        documents[index] = await client.get(`/data/wow/ruleset/1/auctions/${id}${endings[index]}`, { signal, revalidate: true, forceBody: true });
      }
      const reduced = unchanged ? { trackedAuctions: prior.trackedAuctions,
        quotes: previousSnapshot.rows.map((row) => row.quotes[faction]).filter((quote) => quote && quote.auctions > 0) }
        : reduceHouse(documents, catalog, id);
      const times = documents.map((doc) => doc.observedAt).filter(Boolean).sort();
      houses[faction] = { ...known, status: 'ok', unchanged, ...reduced,
        observedAt: times.length === documents.length ? times[0] : null,
        documents: documents.map(({ data, ...document }) => document) };
    } catch (error) {
      if (signal?.aborted) throw error;
      houses[faction] = { ...known, status: 'error', error: error.message };
    }
  }
  if (!Object.values(houses).some((house) => house.status === 'ok')) throw new Error(Object.values(houses).find((house) => house.error)?.error ?? 'Select at least one auction house.');
  const warnings = [...catalog.warnings];
  for (const faction of FACTIONS) if (houses[faction]?.status === 'error') warnings.push(`${faction}: ${houses[faction].error}`);
  const successful = Object.values(houses).filter((house) => house.status === 'ok' && house.trackedAuctions > 0 && house.fingerprint);
  for (let a = 0; a < successful.length; a++) for (let b = a + 1; b < successful.length; b++) {
    if (successful[a].fingerprint === successful[b].fingerprint) warnings.push(`Houses ${successful[a].id} and ${successful[b].id} returned identical tracked auctions. Do not treat them as independent markets.`);
  }
  const rows = mergeRows(catalog, houses);
  const unknownIds = new Set(rows.filter((row) => row.metadataSource === 'auction').map((row) => row.id));
  if (unknownIds.size) warnings.push(`${unknownIds.size} auctioned items are absent from Forever static search. Their prices remain included under Unknown, searchable by item ID.`);
  // Keep quote summaries and anonymous neutral price levels, never book identities.
  for (const house of Object.values(houses)) { delete house.quotes; delete house.fingerprint; }
  const documents = Object.values(houses).flatMap((house) => house.documents ?? []);
  const times = documents.map((document) => Date.parse(document.retainedAt ?? document.observedAt ?? document.fetchedAt));
  const catalogTime = Date.parse(catalog.retainedAt ?? catalog.generatedAt);
  if (Number.isFinite(catalogTime)) times.push(catalogTime);
  return { version: 1, mode: 'live', game: 'forever', region: 'us', ruleset: 1, market: US_PVP, mappingVerified: true, mappingEvidence: MAPPING_EVIDENCE,
    unchanged: Boolean(sameCatalog && FACTIONS.every((faction) => houses[faction]?.unchanged)),
    generatedAt: new Date().toISOString(), retainedAt: new Date(Math.min(...times)).toISOString(),
    neutralDepthVersion: houses.neutral?.status === 'ok' ? 1 : null,
    houses, catalog: { scope: catalog.scope, count: new Set(rows.map((row) => row.id)).size, metadataCount: catalog.items.length, unknownCount: unknownIds.size,
      generatedAt: catalog.generatedAt, coverage: catalog.coverage, warnings: catalog.warnings },
    rows, warnings };
}
