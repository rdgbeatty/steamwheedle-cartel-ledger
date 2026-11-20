import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { FACTIONS, mergeRows } from './market.mjs';
import { DAY } from './store.mjs';
import { ALL_ITEMS_SCOPE } from '../shared/items.mjs';
import { US_PVP } from '../shared/market.mjs';

export async function readLatestSnapshot(origin) {
  const response = await fetch(origin + '/api/snapshot', {
    redirect: 'error', signal: AbortSignal.timeout(60_000)
  });
  if (response.status === 404) {
    const { error } = await response.json();
    // Older deployments can still accept history while the snapshot endpoint rolls out.
    return { enabled: error !== 'Unknown route', snapshot: null };
  }
  if (!response.ok) throw Error('Could not read the last hosted snapshot (HTTP ' + response.status + ').');
  const { snapshot } = await response.json();
  if (snapshot?.publicVersion !== 1 || !Array.isArray(snapshot.rows) || !snapshot.houses || !snapshot.catalog)
    throw Error('The hosted snapshot has an unsupported format.');
  return { enabled: true, snapshot };
}

export function reuseCatalog(snapshot, now) {
  const catalog = snapshot?.catalog;
  if (catalog?.scope !== ALL_ITEMS_SCOPE ||
      !(Date.parse(catalog.generatedAt) > now - DAY) ||
      !(Date.parse(catalog.retainedAt) > now - 30 * DAY)) return null;
  // The combined snapshot includes a base row for each catalog item.
  const items = snapshot.rows.filter((row) => !row.variant && row.metadataSource !== 'auction')
    .map(({ key, variant, quotes, ...item }) => item);
  return items.length === catalog.metadataCount ? { ...catalog, items } : null;
}

export function reuseHouse(snapshot, faction, prior) {
  const house = snapshot?.houses?.[faction];
  if (!prior || house?.version !== prior.version || Date.parse(house.observedAt) !== prior.source) return null;
  return { ...house, quotes: snapshot.rows.map((row) => row.quotes[faction]).filter((quote) => quote?.auctions > 0) };
}

export function summarizeBook(book) {
  return {
    id: book.house,
    status: 'ok',
    observedAt: new Date(book.source).toISOString(),
    version: book.version,
    quotes: book.summary
  };
}

export async function publishLatest(service, catalog, houses, previous, startedAt) {
  if (previous?.catalog.generatedAt === catalog.generatedAt &&
      FACTIONS.every((faction) => previous.houses[faction].version === houses[faction].version)) return false;
  const rows = mergeRows(catalog, houses);
  const retainedAt = Math.min(Date.parse(catalog.retainedAt),
    ...Object.values(houses).map((house) => Date.parse(house.observedAt)));
  if (!(retainedAt > Date.now() - 30 * DAY)) throw Error('Cannot publish an expired market snapshot.');
  const unknownCount = new Set(rows.filter((row) => row.metadataSource === 'auction').map((row) => row.id)).size;
  const warnings = [...catalog.warnings];
  if (unknownCount) warnings.push(`${unknownCount} auctioned items have no Forever catalog record. Search them by item ID under Unknown.`);
  const snapshot = {
    publicVersion: 1, mode: 'live', game: US_PVP.game, region: US_PVP.region, ruleset: US_PVP.ruleset,
    market: US_PVP, generatedAt: new Date().toISOString(), retainedAt: new Date(retainedAt).toISOString(),
    neutralDepthVersion: 1,
    houses: Object.fromEntries(Object.entries(houses).map(([faction, { quotes, ...house }]) => [faction, house])),
    catalog: { scope: catalog.scope, count: new Set(rows.map((row) => row.id)).size,
      metadataCount: catalog.items.length, unknownCount, coverage: catalog.coverage, warnings: catalog.warnings,
      generatedAt: catalog.generatedAt, retainedAt: catalog.retainedAt },
    rows, warnings
  };
  const body = gzipSync(JSON.stringify({ snapshot }));
  const digest = createHash('sha256').update(body).digest('hex');
  const result = await service('snapshot', { startedAt, retainedAt, digest }, body);
  if (!result.reused) console.log('Published latest snapshot with', rows.length, 'rows and', body.length, 'gzip bytes.');
  return !result.reused;
}
