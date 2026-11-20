import { splitCopper, compactNumber } from './format.mjs';
import { US_PVP, comparison, listingCount, sortRows } from '../shared/market.mjs';
import { ALL_ITEMS_SCOPE, matchesItemQuery, pageRows } from '../shared/items.mjs';
import { CategoryFilter } from './category-filter.mjs';
import { collectionFreshness, collectionCooldown } from './collection.mjs';
import { neutralResale, sortResaleRows } from '../shared/resale.mjs';
import { TRADE_DEFAULTS, allianceTrade, dailyEstimate, tradeMatches, sortTradeRows } from '../shared/trade.mjs';

const $ = (id) => document.getElementById(id);
const hostedOrigin = document.documentElement?.dataset?.marketSource;
const factions = ['alliance', 'horde', 'neutral'];
const titles = { alliance: 'Alliance', horde: 'Horde', neutral: 'Neutral' };
const count = new Intl.NumberFormat('en-US');
let status, snapshot = null, sort = { key: 'profitVolume', direction: -1 }, lastJob = '', polling = false;
let initialized = false, showDemo = false;
let collectionForcedOpen = false, collectionUserOpen = false;
let resaleSort = { key: 'expectedProfit', direction: -1 };
let browserSort = { key: 'name', direction: 1 };
const views = hostedOrigin ? ['market', 'resale', 'browser'] : ['market', 'resale', 'browser', 'setup'];
const pages = { market: 1, resale: 1, browser: 1 };
const emptyRows = [];
const categoryFilters = Object.fromEntries(['market', 'resale', 'browser'].map((view) => {
  const prefix = view === 'market' ? '' : `${view}-`;
  return [view, new CategoryFilter($(`${prefix}category`), $(`${prefix}category-summary`), () => { pages[view] = 1; renderView(view); })];
}));
let activeView = 'resale', liquidity = null, liquidityLoading = false, liquidityMessage = '', liquidityRequest = 0, liquidityTimer;
let neutralReport = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function request(path, body) {
  const response = await fetch(hostedOrigin ? hostedOrigin + path : path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-CSRF': status?.csrf ?? '' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}

function error(message) { $('error').textContent = message ?? ''; $('error').hidden = !message; }

function selectView(view, focus = false) {
  activeView = view;
  for (const name of views) {
    const active = name === view;
    $(`${name}-view`).hidden = !active;
    $(`${name}-tab`).setAttribute('aria-selected', String(active));
    $(`${name}-tab`).tabIndex = active ? 0 : -1;
  }
  $('collection-toolbar').hidden = view === 'setup';
  $('data-notes').hidden = view === 'setup';
  $('market-metrics').hidden = view !== 'market';
  $('resale-metrics').hidden = view !== 'resale';
  $('browser-metrics').hidden = view !== 'browser';
  if ($('profit-dialog').open) $('profit-dialog').close();
  if ($('trade-dialog').open) $('trade-dialog').close();
  if (view === 'setup') $('setup').open = true;
  renderView(view);
  if (focus) $(`${view}-tab`).focus();
  if (view === 'market' && snapshot?.mode === 'live' && !liquidity && !liquidityLoading) return loadLiquidity();
  if (view === 'setup' && status?.configured) return loadNeutralBooks();
}

function age(value) {
  if (!value) return 'source time unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return 'source time unknown';
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ago`;
}

function updateCollectionStatus() {
  const freshness = collectionFreshness(snapshot);
  collectionForcedOpen = freshness.stale || status?.job.state === 'running';
  const shouldOpen = collectionForcedOpen || collectionUserOpen;
  if ($('collection-status').open !== shouldOpen) $('collection-status').open = shouldOpen;
  $('collection-status').classList.toggle('is-required', collectionForcedOpen);
  $('collection-status').classList.toggle('is-stale', freshness.stale);
  $('collection-summary').setAttribute('aria-disabled', String(collectionForcedOpen));
  $('collection-summary').title = freshness.stale ? 'Details stay open while collection or source prices are over four hours old.'
    : collectionForcedOpen ? 'Collection progress stays open while the collector runs.' : 'Show collection details and auction-house times';
  $('collection-stale').hidden = !freshness.stale;
  $('collection-stale').textContent = freshness.reason === 'source' ? 'Prices over 4h old' : 'Over 4h old';
  $('collection-label').textContent = snapshot?.mode === 'demo' ? 'Sample snapshot' : 'Last collection';
  $('collection-time').textContent = snapshot ? age(snapshot.generatedAt) : 'No collection yet';
}

function money(value, signed = false) {
  const element = node('span', undefined, 'money');
  if (value === null || value === undefined) { element.textContent = '—'; return element; }
  const [gold, silver, copper] = splitCopper(value);
  if (signed && value !== 0) element.append(document.createTextNode(value > 0 ? '+' : '−'));
  for (const [amount, unit] of [[gold, 'g'], [silver, 's'], [copper, 'c']]) {
    if (!amount && (unit !== 'c' || gold || silver)) continue;
    element.append(node('span', count.format(amount), unit === 'g' ? 'gold' : ''), node('span', unit, 'unit'));
  }
  return element;
}

function updateStatus() {
  const busy = status.job.state === 'running';
  $('progress').textContent = status.job.message;
  $('progress').classList.toggle('running', busy);
  $('cancel').hidden = !busy;
  updateCollectAvailability();
  $('cancel-inspect').hidden = !busy || status.job.kind !== 'inspect';
  if (status.job.kind === 'inspect' && status.job.state !== 'complete') $('neutral-progress').textContent = status.job.message;
  $('forget').disabled = busy || status.fromEnvironment || !status.configured;
  $('client-id').disabled = busy || status.fromEnvironment;
  $('client-secret').disabled = busy || status.fromEnvironment;
  for (const faction of factions) $(`house-${faction}`).textContent = US_PVP.houses[faction];
  $('credential-status').textContent = status.fromEnvironment ? 'Using credentials supplied by the server environment.'
    : status.configured ? 'Credentials saved locally. Leave the secret blank to keep it.' : 'Application credentials have not been saved.';
  if (!initialized) {
    $('client-id').value = status.clientId;
    $('setup').open = !status.configured;
    if (!status.configured) selectView('setup');
    initialized = true;
  }
  updateCollectionStatus();
}

function updateCollectAvailability() {
  const busy = status.job.state === 'running', cooldown = collectionCooldown(status.collection);
  $('collect').disabled = busy || cooldown.blocked || !status.configured || !status.settings.discovery;
  $('collect').textContent = busy ? 'Collecting…' : cooldown.label;
  $('collect').title = cooldown.blocked ? 'API checks are limited in the server and survive a page reload or server restart.' : 'Check Blizzard for newer auction books';
  $('discover').disabled = busy || cooldown.blocked || !status.configured;
  $('inspect-neutral').disabled = busy || cooldown.blocked || !status.configured;
  $('save').disabled = busy || cooldown.blocked || status.fromEnvironment;
  const collection = status.collection;
  $('last-api-check').textContent = collection?.lastCheckedAt ? `Last API check: ${new Date(collection.lastCheckedAt).toLocaleString()} · ${collection.outcome === 'unchanged' ? 'No newer auction data' : collection.outcome}` : '';
  const budget = collection?.requestBudget;
  $('request-budget').textContent = budget ? `Blizzard requests in the last hour: ${budget.used} / ${budget.limit} local budget (36,000 maximum). Includes OAuth, retries and conditional checks.` : '';
}

function price(row, faction) { return row.quotes[faction]?.[$('price-basis').value] ?? null; }

function itemCell(row) {
  const cell = node('td');
  const name = node('a', row.name, 'item-name');
  name.href = 'https://gathering-ledger.gathering-ledger.workers.dev/?' + new URLSearchParams({ item: row.id, variant: row.variant || '' });
  name.target = '_blank';
  name.rel = 'noopener noreferrer';
  cell.append(name, node('span', `#${row.id}${row.variant ? ' · variant' : ''}`, 'item-id'));
  const unnamed = /^Item #\d+$/.test(row.name);
  const details = [];
  if (unnamed) {
    cell.append(node('span', 'Name unavailable in Forever API', 'metadata-missing'));
    details.push('Auction prices are available, but Forever static item data has no name for this ID. This does not mean the item is absent from the market.');
  }
  if (row.variant) details.push(`Variant: ${row.variant}`);
  if (details.length) cell.title = details.join('\n');
  return cell;
}

async function loadNeutralBooks() {
  try { neutralReport = (await request('/api/neutral-books')).report; renderNeutralBooks(); }
  catch (failure) { $('neutral-progress').textContent = failure.message; }
}

function renderNeutralBooks() {
  if (neutralReport?.expiresAt <= Date.now()) neutralReport = null;
  const target = Number($('neutral-match').value);
  $('neutral-books').replaceChildren();
  if (!neutralReport) return;
  $('neutral-progress').textContent = `Stranglekelp #3820 · collected ${new Date(neutralReport.generatedAt).toLocaleString()} · all ${neutralReport.houses.length} advertised US neutral houses · mapping not confirmed in game`;
  for (const house of neutralReport.houses) {
    const block = node('details', undefined, 'neutral-book'); block.open = true;
    block.append(node('summary', `Neutral #${house.id} · ${house.rulesetLabel} · ${house.status === 'ok' ? 'both feeds read' : 'INCOMPLETE'}`));
    for (const document of house.documents) block.append(node('p', `${document.feed}: source ${document.observedAt ? new Date(document.observedAt).toLocaleString() : 'unknown'} (${document.timeBasis}) · fetched ${new Date(document.fetchedAt).toLocaleString()}${document.cached ? ' · cached response' : ''}`, 'fine'));
    for (const failure of house.failures) block.append(node('p', `${failure.feed}: ${failure.error}`, 'failed fine'));
    if (house.error) block.append(node('p', house.error, 'failed fine'));
    if (!house.quotes.length) block.append(node('p', house.status === 'ok' ? 'Stranglekelp is not listed in either feed.' : 'Coverage is unknown; this is not a confirmed stockout.', 'fine'));
    for (const quote of house.quotes) {
      const heading = node('p', undefined, 'fine');
      heading.append(document.createTextNode(`${quote.variant ? `Variant ${quote.variant}` : 'Base item'} · minimum `), money(quote.minBuyout), document.createTextNode(' · weighted median '), money(quote.medianBuyout), document.createTextNode(` · ${count.format(quote.buyoutUnits)} units / ${count.format(quote.buyoutAuctions)} buyout offers · ${quote.bidOnlyAuctions} bid-only offers excluded`));
      block.append(heading);
      const scroll = node('div', undefined, 'table-scroll'), table = node('table');
      const head = node('thead'), headers = node('tr');
      for (const label of ['Unit ask', 'Stack size', 'Whole-stack buyout', 'Identical offers', 'Total units', 'Feed(s)']) headers.append(node('th', label, 'numeric'));
      head.append(headers); table.append(head);
      const body = node('tbody');
      for (const offer of quote.offers) {
        const row = node('tr', undefined, Math.abs(offer.unitPrice - target) < 0.000001 ? 'ask-match' : '');
        const unit = node('td', undefined, 'numeric'), total = node('td', undefined, 'numeric');
        unit.append(money(offer.unitPrice)); total.append(money(offer.totalBuyout));
        row.append(unit, node('td', count.format(offer.quantity), 'numeric'), total, node('td', count.format(offer.listingCount), 'numeric'), node('td', count.format(offer.quantity * offer.listingCount), 'numeric'), node('td', (offer.feeds ?? []).join(', ') || 'unknown', 'fine'));
        body.append(row);
      }
      table.append(body); scroll.append(table); block.append(scroll);
    }
    $('neutral-books').append(block);
  }
}

function render() {
  const demo = snapshot?.mode === 'demo';
  $('mode').textContent = demo ? 'SAMPLE DATA' : snapshot ? 'LIVE API SNAPSHOT' : 'AWAITING SETUP';
  $('mode').className = `badge ${demo ? 'demo' : snapshot ? 'live' : ''}`;
  $('show-live').hidden = !showDemo;
  $('warnings').replaceChildren(...(snapshot?.warnings ?? []).map((warning) => node('li', warning)));
  $('warnings').hidden = !snapshot?.warnings.length;
  const warnings = snapshot?.warnings?.length ?? 0;
  $('warning-count').textContent = warnings ? `· ${warnings} ${warnings === 1 ? 'notice' : 'notices'}` : '';
  $('item-count').textContent = snapshot ? count.format(snapshot.catalog.count) : '—';
  $('catalog-detail').textContent = demo ? 'Illustrative catalog · sample only' : snapshot?.catalog.scope === ALL_ITEMS_SCOPE ? 'All item categories' : 'Older material catalog · collect to expand';
  $('house-count').textContent = snapshot ? `${Object.values(snapshot.houses).filter((house) => house.status === 'ok').length} / 3` : '—';
  $('house-detail').textContent = demo ? 'Illustrative house IDs' : 'Alliance · Horde · Neutral';
  $('collection-detail').textContent = snapshot ? new Date(snapshot.generatedAt).toLocaleString() : 'No live prices collected';
  $('catalog-coverage').textContent = snapshot?.catalog.coverage ?? '';
  $('house-times').replaceChildren();
  for (const faction of factions) {
    const house = snapshot?.houses[faction];
    const heading = $(`${faction}-heading`);
    heading.replaceChildren(document.createTextNode(`${titles[faction]}${house?.id ? ` · ${house.id}` : ''} `), node('span', '↕'));
    if (house) {
      const label = house.status === 'ok' ? `${titles[faction]} ${house.id} · ${demo ? 'sample' : age(house.observedAt)}`
        : `${titles[faction]} · ${house.status === 'error' ? 'unavailable' : 'not selected'}`;
      const stamp = node('span', label, house.status === 'error' ? 'failed' : '');
      stamp.title = house.error ?? (house.documents ?? []).map((document) => `${document.timeBasis}: ${document.observedAt ?? 'unknown'}; retrieved ${document.fetchedAt}`).join('\n');
      $('house-times').append(stamp);
    }
  }
  for (const filter of Object.values(categoryFilters)) filter.setRows(snapshot?.rows ?? emptyRows);
  renderView(activeView);
  updateCollectionStatus();
}

function renderView(view) {
  if (view === 'market') renderMarket();
  if (view === 'resale') renderResale();
  if (view === 'browser') renderBrowser();
}

function paginate(view, rows) {
  const result = pageRows(rows, pages[view]); pages[view] = result.page;
  $(`${view}-prev`).disabled = result.page === 1;
  $(`${view}-next`).disabled = result.page === result.pages;
  $(`${view}-page`).textContent = `${count.format(result.start)}–${count.format(result.end)} of ${count.format(result.total)} · Page ${count.format(result.page)} / ${count.format(result.pages)}`;
  return result.rows;
}

function tradeFilters() {
  const read = (id, fallback) => $(id).value.trim() === '' ? fallback : Number($(id).value);
  const filters = { filterLowVolume: $('filter-low-volume').checked, minVolume: $('filter-low-volume').checked ? read('min-volume', TRADE_DEFAULTS.minVolume) : 0, minUnitProfit: read('min-unit-profit', 0) * 10_000,
    minProfitVolume: read('min-profit-volume', 1) * 10_000, volumeMode: hostedOrigin ? 'stock' : $('volume-mode').value,
    volumeMarkets: $('volume-markets').value, allianceCheaper: $('alliance-cheaper').checked };
  if (![filters.minVolume, filters.minUnitProfit, filters.minProfitVolume].every((value) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)) return null;
  return filters;
}

function currentLiquidity() { return snapshot?.mode === 'demo' ? snapshot.liquidity : liquidity; }

function renderMarket() {
  const query = $('search').value, filters = tradeFilters();
  $('trade-filter-error').hidden = Boolean(filters);
  $('trade-filter-error').textContent = filters ? '' : 'Filter thresholds must be finite, nonnegative numbers.';
  $('trade-filter-summary').textContent = filters ? `· ${filters.filterLowVolume ? `≥${compactNumber(filters.minVolume)} units` : 'volume minimum off'} · ≥${compactNumber(filters.minProfitVolume / 10_000)}g` : '· check values';
  $('market-volume-hint').textContent = filters?.filterLowVolume ? `≥${count.format(filters.minVolume)} units` : 'off';
  $('min-volume').disabled = !$('filter-low-volume').checked;
  $('volume-markets').disabled = !$('filter-low-volume').checked;
  const candidates = (snapshot?.rows ?? []).filter((row) =>
    categoryFilters.market.matches(row) && matchesItemQuery(row, query))
    .map((row) => ({ ...row, trade: allianceTrade(row, { basis: $('price-basis').value, volumeMode: filters?.volumeMode, liquidity: currentLiquidity() }) }));
  const rows = sortTradeRows(filters ? candidates.filter((row) => tradeMatches(row.trade, filters)) : [], sort, $('price-basis').value);
  $('rows').replaceChildren(...paginate('market', rows).map((row) => {
    const tr = node('tr');
    const name = itemCell(row);
    const score = node('td', undefined, 'numeric weighted-cell');
    score.append(node('strong', `${compactNumber(row.trade.profitVolume / 10_000)} g`, 'weighted-value'));
    const info = node('button', 'ⓘ', 'profit-info');
    info.setAttribute('aria-label', `Show trade math for ${row.name}`); info.setAttribute('aria-haspopup', 'dialog');
    info.addEventListener('click', () => showTrade(row)); score.append(info);
    score.append(node('span', row.trade.volumeKind === 'daily' ? 'daily estimate · ceiling' : 'stock proxy · ceiling', 'stock'));
    score.title = `${count.format(row.trade.unitProfit)} copper maximum profit/unit × ${count.format(row.trade.volume)} ${row.trade.volumeKind === 'daily' ? 'estimated units/day' : 'listed units'}. The other trader earns zero at this upper bound; neutral demand is unknown.`;
    const unit = node('td', undefined, 'numeric'); unit.append(money(row.trade.unitProfit));
    unit.append(node('span', 'upper bound', 'stock'));
    tr.append(name, score, unit);
    for (const faction of factions) {
      const td = node('td', undefined, 'numeric');
      const quote = row.quotes[faction];
      if (!quote) td.append(node('span', 'Unavailable', 'muted'));
      else if (price(row, faction) === null) td.append(node('span', quote.bidOnlyAuctions ? 'Bid only' : 'Not listed', 'muted'));
      else td.append(money(price(row, faction)));
      const stock = node('td', undefined, 'numeric quantity-cell');
      if (!quote) stock.append(node('span', '—', 'muted'));
      else {
        const offers = listingCount(quote);
        stock.append(node('strong', compactNumber(quote.buyoutUnits), 'quantity-value'));
        const daily = dailyEstimate(row, faction, currentLiquidity());
        const detail = faction === 'neutral' ? `${compactNumber(offers)} ${offers === 1 ? 'offer' : 'offers'}`
          : daily === null ? 'sales/day unknown' : `${compactNumber(daily)}/day est.`;
        stock.append(node('span', detail, 'stock'));
        stock.title = `${count.format(quote.buyoutUnits)} buyout units across ${offers === null ? 'an unknown number of' : count.format(offers)} buyout listings. ${quote.bidOnlyAuctions ?? 0} bid-only listings excluded. Supply is not sales volume.`;
      }
      tr.append(td, stock);
    }
    const metrics = comparison(row, $('price-basis').value);
    const imbalance = imbalanceCell(metrics);
    const neutralImbalance = imbalanceCell(comparison(row, $('price-basis').value, 'neutral'));
    tr.append(imbalance, neutralImbalance); return tr;
  }));
  $('empty').hidden = rows.length > 0;
  if (snapshot) {
    $('empty').replaceChildren(node('h3', 'No trades match these filters.'), node('p', 'Open Trade filters to adjust the volume and profit minimums. Missing daily estimates can use the listed-stock proxy. Both faction prices and a positive spread after fees are required.'));
  } else $('empty').replaceChildren(node('h3', hostedOrigin ? 'Waiting for a market snapshot.' : 'Your first market snapshot starts here.'),
    node('p', hostedOrigin ? 'Use Refresh to check for published data.' : 'Open Local setup to connect Blizzard, or preview the table with clearly labeled sample prices.'));
  const dailyRows = rows.filter((row) => row.trade.volumeKind === 'daily').length;
  $('row-count').textContent = snapshot ? hostedOrigin ? `${count.format(rows.length)} trades · listed-stock proxy`
    : `${count.format(rows.length)} trades · ${dailyRows} daily / ${rows.length - dailyRows} stock proxy` : '';
  $('load-liquidity').disabled = liquidityLoading || !snapshot || snapshot.mode === 'demo';
  const source = currentLiquidity();
  const details = Object.entries(source?.markets ?? {}).map(([faction, market]) => market.status === 'ok' && market.expiresAt > Date.now()
    ? `${titles[faction]}: scan ${age(market.observedAt)}, estimates expire ${new Date(market.expiresAt).toLocaleTimeString()}` : `${titles[faction]}: ${market.error ?? 'estimates expired'}`);
  $('liquidity-status').textContent = snapshot?.mode === 'demo' ? 'Sample sales estimates are invented. No provider request is made.'
    : liquidityLoading ? 'Loading daily sales estimates from AHledger…' : liquidityMessage || details.join(' · ') || 'Sales estimates have not been loaded. Listed stock is the fallback proxy.';
  for (const button of document.querySelectorAll('.sort')) button.closest('th').setAttribute('aria-sort', button.dataset.sort === sort.key ? sort.direction === 1 ? 'ascending' : 'descending' : 'none');
}

function scheduleLiquidityExpiry() {
  clearTimeout(liquidityTimer);
  const times = Object.values(liquidity?.markets ?? {}).filter((market) => market.status === 'ok').map((market) => market.expiresAt);
  if (!times.length) return;
  liquidityTimer = setTimeout(() => {
    for (const [faction, market] of Object.entries(liquidity.markets)) if (market.status === 'ok' && market.expiresAt <= Date.now()) {
      liquidity.markets[faction] = { status: 'unavailable', error: 'Sales estimates expired; refresh to retry.' };
    }
    if ($('trade-dialog').open) $('trade-dialog').close();
    $('trade-math').replaceChildren(); $('trade-detail').textContent = '';
    renderMarket(); scheduleLiquidityExpiry();
  }, Math.max(1, Math.min(2_147_483_647, Math.min(...times) - Date.now())));
  liquidityTimer.unref?.();
}

async function loadLiquidity() {
  if (hostedOrigin || liquidityLoading || !snapshot || snapshot.mode === 'demo') return;
  const requestId = ++liquidityRequest, expectedSnapshot = snapshot;
  liquidityLoading = true; liquidityMessage = ''; renderMarket();
  try {
    const result = await request('/api/liquidity');
    if (requestId === liquidityRequest && snapshot === expectedSnapshot) {
      if ($('trade-dialog').open) $('trade-dialog').close();
      $('trade-math').replaceChildren(); $('trade-detail').textContent = '';
      liquidity = result.liquidity; scheduleLiquidityExpiry();
    }
  } catch { if (requestId === liquidityRequest) liquidityMessage = 'Daily sales estimates are unavailable; listed stock is the fallback proxy.'; }
  finally { liquidityLoading = false; renderMarket(); }
}

function showTrade(row) {
  const plan = row.trade;
  $('trade-title').textContent = `${row.name} · opportunity math`;
  $('trade-assumption').textContent = 'This upper bound assumes the neutral buyer resells at the selected Horde ask and earns zero profit. A price that leaves them profit reduces your own return.';
  const lines = [
    ['Alliance purchase cost / unit', plan.allianceAsk], ['Horde sale ask / unit', plan.hordeAsk],
    ['Horde sale fee (5%)', -plan.hordeFee], ['Maximum neutral price: Horde buyer breaks even', plan.neutralCeiling],
    ['Neutral sale fee (15% of that neutral price)', -plan.neutralFee], ['Maximum profit for you / unit', plan.unitProfit],
    ['Profit × volume (upper bound)', plan.profitVolume],
    ['Current neutral minimum / unit', plan.neutralAsk], ['Your profit at that neutral ask / unit', plan.ownProfitAtNeutralAsk],
    ["Other trader's profit at that neutral ask / unit", plan.traderProfitAtNeutralAsk],
  ];
  $('trade-math').replaceChildren(...lines.map(([label, value]) => {
    const tr = node('tr'), amount = node('td', undefined, 'numeric'); amount.append(money(value, true)); tr.append(node('td', label), amount); return tr;
  }));
  $('trade-detail').textContent = `Volume multiplier: min(${count.format(plan.allianceVolume)} Alliance, ${count.format(plan.hordeVolume)} Horde) = ${count.format(plan.volume)} ${plan.volumeKind === 'daily' ? 'estimated units/day' : 'currently listed units (stock proxy)'}. This is not neutral sales volume or a recommended purchase quantity. The two current-neutral-ask profits can be negative; they describe a different scenario from the ceiling. All Alliance units are not available at the minimum; deposits, relisting and price changes are excluded.`;
  $('trade-dialog').showModal();
}

function stockCell(quote) {
  const cell = node('td', undefined, 'numeric quantity-cell');
  if (!quote) { cell.append(node('span', '—', 'muted')); return cell; }
  const offers = listingCount(quote);
  cell.append(node('strong', compactNumber(quote.buyoutUnits), 'quantity-value'), node('span', `${compactNumber(offers)} ${offers === 1 ? 'offer' : 'offers'}`, 'stock'));
  cell.title = `${count.format(quote.buyoutUnits)} buyout units across ${count.format(offers)} buyout listings. Bid-only listings excluded. Listed supply, not completed sales.`;
  if (quote.bidOnlyAuctions) cell.append(node('span', `${compactNumber(quote.bidOnlyAuctions)} bid-only`, 'stock'));
  return cell;
}

function renderResale() {
  const query = $('resale-search').value;
  const filterVolume = $('resale-filter-low-volume').checked;
  const minVolume = filterVolume ? $('resale-min-volume').value.trim() === '' ? 1000 : Number($('resale-min-volume').value) : 0;
  const validVolume = Number.isSafeInteger(minVolume) && minVolume >= 0;
  $('resale-volume-control').hidden = !filterVolume;
  $('resale-volume-hint').hidden = !filterVolume;
  $('resale-filter-error').hidden = validVolume;
  $('resale-filter-error').textContent = validVolume ? '' : 'Minimum Alliance stock must be a nonnegative whole number.';
  const candidates = (snapshot?.rows ?? []).filter((row) =>
    categoryFilters.resale.matches(row) && matchesItemQuery(row, query))
    .map((row) => ({ ...row, resale: neutralResale(row) }));
  const profitable = candidates.filter((row) => row.resale.status === 'profitable');
  const rows = sortResaleRows(validVolume ? profitable.filter((row) => !filterVolume ||
    Number.isSafeInteger(row.quotes.alliance.buyoutUnits) && row.quotes.alliance.buyoutUnits >= minVolume) : [], resaleSort);
  const lowVolume = validVolume && filterVolume ? profitable.length - rows.length : 0;
  const unavailable = candidates.filter((row) => row.resale.status === 'unavailable').length;
  $('resale-count').textContent = snapshot ? `${count.format(rows.length)} opportunities${lowVolume ? ` · ${count.format(lowVolume)} below volume minimum or stock unknown` : ''}${unavailable ? ` · ${count.format(unavailable)} unpriced` : ''}` : '';
  const missingDepth = snapshot && snapshot.houses.neutral?.status === 'ok' && snapshot.neutralDepthVersion !== 1;
  const failedHouse = snapshot && ['alliance', 'neutral'].some((faction) => snapshot.houses[faction]?.status !== 'ok');
  $('resale-depth-notice').hidden = !missingDepth && !failedHouse;
  $('resale-depth-notice').textContent = missingDepth ? 'Collect now to load neutral price levels. This older snapshot contains summary prices only; profit cannot be calculated from them.'
    : failedHouse ? 'Alliance and neutral prices are both required. Check collection details and collect again to retry the unavailable house.' : '';
  $('resale-rows').replaceChildren(...paginate('resale', rows).map((row) => {
    const tr = node('tr');
    const name = itemCell(row);
    const categoryCell = node('td'); categoryCell.append(node('span', row.category, `category-tag ${row.category === 'Herbs' ? 'herb' : ''}`));
    const alliance = node('td', undefined, 'numeric'); alliance.append(money(row.resale.allianceAsk));
    const neutral = node('td', undefined, 'numeric'); neutral.append(money(row.resale.neutralAsk));
    const profit = node('td', undefined, 'numeric profit-cell');
    profit.append(node('strong', `${compactNumber(row.resale.expectedProfit / 10_000)} g`, 'weighted-value'));
    const details = node('button', 'ⓘ', 'profit-info');
    details.setAttribute('aria-label', `Show profit math for ${row.name}${row.variant ? ` (variant ${row.variant})` : ''}`);
    details.setAttribute('aria-haspopup', 'dialog');
    details.title = `Show math: ${count.format(row.resale.profitableUnits)} profitable units across ${count.format(row.resale.profitableListings)} offers`;
    details.addEventListener('click', () => showProfit(row));
    profit.append(details);
    tr.append(name, categoryCell, alliance, stockCell(row.quotes.alliance), neutral, stockCell(row.quotes.neutral), profit);
    return tr;
  }));
  $('resale-empty').hidden = rows.length > 0;
  const title = !snapshot ? hostedOrigin ? 'Waiting for a market snapshot.' : 'Collect prices to find opportunities.' : missingDepth ? 'Neutral price depth needs a new collection.'
    : failedHouse ? 'Waiting for both auction houses.' : 'No profitable listings match these filters.';
  const detail = !snapshot ? hostedOrigin ? 'Use Refresh to check for published data.' : 'Open Local setup to connect Blizzard, or preview the sample table.'
    : missingDepth || failedHouse ? 'Use Collect now beside Last collection.'
      : filterVolume ? 'Adjust the minimum Alliance stock or uncheck Filter low volume. Listed stock is a supply proxy, not completed sales. Neutral stock is not a minimum.'
        : 'Only neutral buyouts below the Alliance minimum after its 5% sale fee appear here. Items without an Alliance ask or complete neutral price depth are unpriced.';
  $('resale-empty').replaceChildren(node('h3', title), node('p', detail));
  for (const button of document.querySelectorAll('.resale-sort')) button.closest('th').setAttribute('aria-sort', button.dataset.resaleSort === resaleSort.key ? resaleSort.direction === 1 ? 'ascending' : 'descending' : 'none');
}

function renderBrowser() {
  const basis = $('browser-basis').value, query = $('browser-search').value;
  const listedOnly = $('browser-listed').checked;
  const candidates = (snapshot?.rows ?? []).filter((row) => categoryFilters.browser.matches(row) && matchesItemQuery(row, query) &&
    (!listedOnly || factions.some((faction) => (row.quotes[faction]?.auctions ?? 0) > 0 || (row.quotes[faction]?.buyoutUnits ?? 0) > 0)));
  const rows = sortRows(candidates, browserSort, basis);
  $('browser-count').textContent = snapshot ? `${count.format(rows.length)} ${listedOnly ? 'listed ' : ''}item variants` : '';
  $('browser-scope-notice').hidden = !snapshot || snapshot.catalog.scope === ALL_ITEMS_SCOPE;
  $('browser-scope-notice').textContent = 'This saved snapshot contains the older material catalog. Collect now to include all item categories.';
  $('browser-rows').replaceChildren(...paginate('browser', rows).map((row) => {
    const tr = node('tr'), name = itemCell(row), category = node('td');
    category.append(node('span', row.category, `category-tag ${row.category === 'Herbs' ? 'herb' : ''}`));
    category.title = [row.itemClass, row.subcategory].filter(Boolean).join(' · ');
    tr.append(name, category);
    for (const faction of factions) {
      const quote = row.quotes[faction], cell = node('td', undefined, 'numeric');
      if (!quote) cell.append(node('span', 'Unavailable', 'muted'));
      else if (quote[basis] === null || quote[basis] === undefined) cell.append(node('span', quote.bidOnlyAuctions ? 'Bid only' : 'Not listed', 'muted'));
      else cell.append(money(quote[basis]));
      tr.append(cell, stockCell(quote));
    }
    return tr;
  }));
  $('browser-empty').hidden = rows.length > 0;
  $('browser-empty').replaceChildren(node('h3', snapshot ? 'No items match these filters.' : hostedOrigin ? 'Waiting for a market snapshot.' : 'Collect prices to browse items.'),
    node('p', snapshot ? 'Adjust search or categories, or uncheck Only listed items to browse the full catalog.'
      : hostedOrigin ? 'Use Refresh to check for published data.' : 'Open Local setup to connect Blizzard, or preview the sample table.'));
  for (const button of document.querySelectorAll('.browser-sort')) button.closest('th').setAttribute('aria-sort', button.dataset.browserSort === browserSort.key ? browserSort.direction === 1 ? 'ascending' : 'descending' : 'none');
}

function showProfit(row) {
  const plan = row.resale;
  $('profit-title').textContent = `${row.name} · expected profit`;
  $('profit-assumption').replaceChildren(document.createTextNode('Sale target: '), money(plan.allianceAsk), document.createTextNode(` per unit on Alliance. All ${count.format(plan.profitableUnits)} units must sell at that ask; a 5% fee is deducted from gross sales.`));
  const mathRow = (level, total = false) => {
    const tr = node('tr');
    const price = node('td', undefined, 'numeric');
    if (total) price.textContent = 'Total'; else price.append(money(level.unitPrice));
    const stock = node('td', undefined, 'numeric');
    stock.append(node('strong', count.format(total ? plan.profitableUnits : level.quantity)), node('span', `${count.format(total ? plan.profitableListings : level.listingCount)} offers`, 'stock'));
    tr.append(price, stock);
    for (const [value, signed] of [[total ? plan.purchaseCost : level.totalBuyout, false], [level.grossRevenue, false], [-level.saleFee, true], [level.expectedProfit, true]]) {
      const cell = node('td', undefined, 'numeric'); cell.append(money(value, signed)); tr.append(cell);
    }
    return tr;
  };
  $('profit-levels').replaceChildren(...plan.levels.map((level) => mathRow(level)));
  $('profit-totals').replaceChildren(mathRow(plan, true));
  $('profit-detail').textContent = `Only profitable buyout levels are included; break-even, loss-making and bid-only listings are excluded. Equal-price offers are grouped, using their exact whole-listing purchase costs. Stock columns include all buyout listings. Fees are modeled as exactly 5%; deposits, relisting and price changes are excluded. Snapshot collected ${new Date(snapshot.generatedAt).toLocaleString()}.`;
  if (!$('profit-dialog').open) $('profit-dialog').showModal();
}

function imbalanceCell(metrics) {
  const cell = node('td', undefined, 'numeric imbalance-cell');
  cell.append(money(metrics.imbalance));
  if (metrics.higher) {
    const direction = node('span', undefined, 'direction');
    direction.append(node('span', `${titles[metrics.higher]} ↑`, `faction-${metrics.higher}`), document.createTextNode(' · '), node('span', `${titles[metrics.cheaper]} ↓`, `faction-${metrics.cheaper}`));
    cell.append(direction);
  } else if (metrics.imbalance === 0) cell.append(node('span', 'Equal prices', 'stock'));
  return cell;
}

async function loadSnapshot() {
  if (!showDemo) {
    const result = await request('/api/snapshot');
    if (hostedOrigin && result.snapshot?.publicVersion !== 1) throw Error('The market snapshot format is unsupported.');
    snapshot = result.snapshot;
    if ($('profit-dialog').open) $('profit-dialog').close();
    if ($('trade-dialog').open) $('trade-dialog').close();
    if (result.needsCollection) error('The saved snapshot uses other houses. Collect prices to load the locked US PvP markets.');
    render();
    if (activeView === 'market' && snapshot) void loadLiquidity();
  }
}

async function refreshHosted() {
  error(null);
  $('collect').disabled = true;
  $('collect').textContent = 'Refreshing…';
  try {
    await loadSnapshot();
    $('progress').textContent = 'Hourly snapshots are published by the hosted collector.';
  } catch (failure) {
    error(failure.message);
    $('progress').textContent = 'The latest market snapshot could not be loaded.';
  } finally {
    $('collect').disabled = false;
    $('collect').textContent = 'Refresh';
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    status = await request('/api/status');
    updateStatus();
    const key = `${status.job.startedAt}:${status.job.finishedAt}:${status.job.state}`;
    if (key !== lastJob) {
      lastJob = key;
      if (status.job.error) error(status.job.error);
      if (status.job.state === 'complete') {
        if (status.job.kind === 'inspect') await loadNeutralBooks();
        else if (!status.job.unchanged || snapshot?.mode !== 'live') await loadSnapshot();
      }
    }
  } catch (failure) { error(failure.message); }
  finally { polling = false; }
}

async function action(path, body = {}) {
  error(null);
  try { await request(path, body); await poll(); return true; }
  catch (failure) { error(failure.message); return false; }
}

for (const name of views) $(`${name}-tab`).addEventListener('click', () => selectView(name));
for (const name of views) $(`${name}-tab`).addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? views[0] : event.key === 'End' ? views.at(-1) : views[(views.indexOf(name) + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length];
  selectView(next, true);
});
$('collection-status').addEventListener('toggle', () => {
  if (collectionForcedOpen) $('collection-status').open = true;
  else collectionUserOpen = $('collection-status').open;
});
$('collection-summary').addEventListener('click', (event) => { if (collectionForcedOpen) event.preventDefault(); });
$('collection-summary').addEventListener('keydown', (event) => {
  if (collectionForcedOpen && ['Enter', ' '].includes(event.key)) event.preventDefault();
});
if (hostedOrigin) {
  $('collect').addEventListener('click', refreshHosted);
} else {
  $('callback-url').textContent = `${location.origin}/oauth/callback`;
  $('credentials-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { clientId: $('client-id').value, clientSecret: $('client-secret').value };
    $('client-secret').value = '';
    showDemo = false;
    if (await action('/api/setup', body)) selectView('resale');
  });
  $('collect').addEventListener('click', () => {
    showDemo = false;
    return action('/api/collect', { refreshCatalog: $('refresh-catalog').checked });
  });
  $('discover').addEventListener('click', () => action('/api/discover'));
  $('cancel').addEventListener('click', () => action('/api/cancel'));
  $('cancel-inspect').addEventListener('click', () => action('/api/cancel'));
  $('neutral-match').addEventListener('input', renderNeutralBooks);
  $('inspect-neutral').addEventListener('click', async () => {
    $('neutral-check').open = true;
    await action('/api/inspect-neutral');
  });
  $('forget').addEventListener('click', async () => { await action('/api/forget'); selectView('setup'); });
  $('preview').addEventListener('click', async () => {
    try { snapshot = (await request('/api/demo')).snapshot; showDemo = true; selectView('resale'); render(); }
    catch (failure) { error(failure.message); }
  });
  $('show-live').addEventListener('click', async () => { showDemo = false; await loadSnapshot(); });
}
for (const id of ['search', 'price-basis', 'filter-low-volume', 'alliance-cheaper', 'volume-mode', 'volume-markets', 'min-volume', 'min-unit-profit', 'min-profit-volume']) $(id).addEventListener('input', () => { pages.market = 1; render(); });
$('reset-trade-filters').addEventListener('click', () => {
  $('filter-low-volume').checked = true; $('alliance-cheaper').checked = true; $('volume-mode').value = 'auto'; $('volume-markets').value = 'both';
  $('min-volume').value = '1000'; $('min-unit-profit').value = '0'; $('min-profit-volume').value = '1';
  pages.market = 1; renderMarket();
});
$('load-liquidity').addEventListener('click', loadLiquidity);
$('trade-close').addEventListener('click', () => $('trade-dialog').close());
for (const id of ['resale-search', 'resale-filter-low-volume', 'resale-min-volume']) $(id).addEventListener('input', () => { pages.resale = 1; renderResale(); });
for (const id of ['browser-search', 'browser-basis', 'browser-listed']) $(id).addEventListener('input', () => { pages.browser = 1; renderBrowser(); });
for (const view of ['market', 'resale', 'browser']) for (const [direction, step] of [['prev', -1], ['next', 1]]) {
  $(`${view}-${direction}`).addEventListener('click', () => { pages[view] += step; renderView(view); });
}
$('profit-close').addEventListener('click', () => $('profit-dialog').close());
for (const button of document.querySelectorAll('.resale-sort')) button.addEventListener('click', () => {
  resaleSort = { key: button.dataset.resaleSort, direction: resaleSort.key === button.dataset.resaleSort ? -resaleSort.direction : ['name', 'category'].includes(button.dataset.resaleSort) ? 1 : -1 };
  pages.resale = 1; renderResale();
});
for (const button of document.querySelectorAll('.sort')) button.addEventListener('click', () => {
  sort = { key: button.dataset.sort, direction: sort.key === button.dataset.sort ? -sort.direction : ['name', 'category'].includes(button.dataset.sort) ? 1 : -1 };
  pages.market = 1; render();
});
for (const button of document.querySelectorAll('.browser-sort')) button.addEventListener('click', () => {
  const key = button.dataset.browserSort;
  browserSort = { key, direction: browserSort.key === key ? -browserSort.direction : ['name', 'category'].includes(key) ? 1 : -1 };
  pages.browser = 1; renderBrowser();
});
selectView('resale');
if (hostedOrigin) {
  await refreshHosted();
} else {
  await poll();
  await loadSnapshot().catch((failure) => error(failure.message));
  setInterval(poll, 2000);
  setInterval(() => { if (status) updateCollectAvailability(); }, 1000);
}
setInterval(() => {
  if (snapshot) {
    if (hostedOrigin && Date.parse(snapshot.retainedAt) <= Date.now() - 30 * 86400000) snapshot = null;
    render();
  }
  if (neutralReport) renderNeutralBooks();
}, 60_000);
