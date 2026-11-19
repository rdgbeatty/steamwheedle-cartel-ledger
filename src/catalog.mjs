import { validatePvpHouses, MAPPING_EVIDENCE } from '../shared/market.mjs';
import { ALL_ITEMS_SCOPE, itemMetadata, localized } from '../shared/items.mjs';
export { localized } from '../shared/items.mjs';

export async function collectCatalog(client, { signal, progress = () => {} } = {}) {
  const items = new Map();
  const warnings = [];
  const times = [];
  let cursor = 1, ranges = 0, complete = false;
  // Forever caps a search at 1,000 hits even when pageCount says one. Move the
  // ID lower bound rather than mistaking that first capped page for the catalog.
  for (; ranges < 200; ranges++) {
    if (signal?.aborted) throw new Error('Collection canceled.');
    progress(`Reading all Forever items · ${items.size.toLocaleString('en-US')} found · IDs from ${cursor}`);
    const document = await client.get('/data/wow/search/item', {
      namespace: 'static', query: { id: `[${cursor},]`, _page: 1, _pageSize: 1000, orderby: 'id' }, signal,
    });
    const data = document.data;
    if (!Array.isArray(data?.results)) throw new Error('Forever item search returned an unexpected catalog response.');
    const time = Date.parse(document.retainedAt ?? document.observedAt ?? document.fetchedAt);
    if (Number.isFinite(time)) times.push(time);
    let lastId = cursor - 1;
    for (const result of data.results) {
      const item = itemMetadata(result.data);
      if (item.id < cursor || item.id <= lastId || items.has(item.id)) throw new Error('Forever item search repeated a page or ignored its ID range. The catalog is incomplete; collection stopped.');
      items.set(item.id, item); lastId = item.id;
    }
    if (data.results.length === 0 || lastId === Number.MAX_SAFE_INTEGER ||
      data.results.length < 1000 && data.resultCountCapped !== true && !(data.pageCount > 1)) { complete = true; break; }
    cursor = lastId + 1;
  }
  if (!complete) throw new Error('Forever catalog search did not finish within 200 ID ranges; the previous catalog is preserved.');
  const values = [...items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  if (!values.length) throw new Error('Forever returned an empty item catalog; the previous catalog is preserved.');
  const missing = values.filter((item) => item.metadataMissing).length;
  if (missing) warnings.push(`${missing} catalog items lack complete Forever metadata; they remain available by item ID.`);
  const generatedAt = new Date().toISOString();
  return { version: 2, scope: ALL_ITEMS_SCOPE, items: values, warnings, ranges: ranges + 1, generatedAt,
    retainedAt: times.length ? new Date(Math.min(...times)).toISOString() : generatedAt,
    coverage: 'All item classes from Forever static search, traversed by ascending item-ID ranges. Every auctioned item is included even when static metadata is absent; unresolved names/categories appear as Item #ID / Unknown.' };
}

export async function discoverHouses(client, { signal, verifyPvp = true } = {}) {
  const { data: rulesets } = await client.get('/data/wow/ruleset/index', { signal });
  if (!Array.isArray(rulesets?.rulesets) || !rulesets.rulesets.some((ruleset) => ruleset.id === 1)) {
    throw new Error('The US Forever API did not advertise PvP ruleset 1. Discovery stopped.');
  }
  let result;
  try { result = await client.get('/data/wow/ruleset/1/auctions/', { signal }); }
  catch (error) {
    if (error.status !== 404) throw error;
    result = await client.get('/data/wow/ruleset/1/auctions/index', { signal });
  }
  if (!Array.isArray(result.data?.auctions)) throw new Error('Forever returned an unexpected auction-house index.');
  const houses = result.data.auctions.map((house) => {
    const name = localized(house.name);
    if (!Number.isSafeInteger(house.id) || house.id < 1 || !name) throw new Error('Forever returned an invalid auction-house entry.');
    const faction = /alliance/i.test(name) ? 'alliance' : /horde/i.test(name) ? 'horde' : /blackwater|neutral|goblin/i.test(name) ? 'neutral' : 'unknown';
    return { id: house.id, name, faction };
  });
  if (!houses.length || new Set(houses.map((house) => house.id)).size !== houses.length) throw new Error('Forever returned an empty or duplicate house index.');
  const discovery = { houses, discoveredAt: new Date().toISOString(), mappingVerified: verifyPvp, mappingEvidence: MAPPING_EVIDENCE };
  if (verifyPvp) validatePvpHouses(discovery);
  return discovery;
}
