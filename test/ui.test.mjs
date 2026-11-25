import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoSnapshot } from '../src/demo.mjs';

// A small DOM harness exercises real UI handlers without downloading a browser dependency.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ''; this.hidden = false;
    this.dataset = {}; this.className = ''; this.checked = false;
    this.classList = { toggle: (name, active) => { const values = new Set(this.className.split(' ').filter(Boolean)); active ? values.add(name) : values.delete(name); this.className = [...values].join(' '); } };
  }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text ?? '') + this.children.map((child) => child.textContent ?? '').join(''); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
  get firstChild() { return this.children[0]; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  closest(tag) { return this.tagName === tag ? this : this.parent?.closest(tag); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  async trigger(type = 'click', properties = {}) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    await this.listeners[type]?.(event);
    return event;
  }
}

let uiRun = 0;
async function withUI({ configured = false, initialSnapshot = null, initialLiquidity = null, initialNeutralReport = null, collection = null, hostedOrigin, historyFixture } = {}, run) {
  const original = Object.fromEntries(['document', 'fetch', 'location', 'setInterval', 'setTimeout', 'clearTimeout'].map((key) => [key, globalThis[key]]));
  const originalNow = Date.now;
  let clock = originalNow(), liveSnapshot = initialSnapshot;
  Date.now = () => clock;
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  elements['price-basis'].value = 'minBuyout';
  elements['filter-low-volume'].checked = true; elements['resale-min-volume'].value = '1000';
  elements['browser-basis'].value = 'minBuyout'; elements['browser-listed'].checked = true;
  elements['volume-mode'].value = 'auto'; elements['volume-markets'].value = 'both';
  elements['min-volume'].value = '1000'; elements['min-unit-profit'].value = '0'; elements['min-profit-volume'].value = '1'; elements['alliance-cheaper'].checked = true;
  elements['neutral-match'].value = '280';
  const buttons = [...html.matchAll(/data-sort="([^"]+)"/g)].map((match) => {
    const key = match[1];
    const th = new Element('th'), button = new Element('button'); button.dataset.sort = key; th.append(button); return button;
  });
  const resaleButtons = [...html.matchAll(/data-resale-sort="([^"]+)"/g)].map((match) => {
    const th = new Element('th'), button = new Element('button'); button.dataset.resaleSort = match[1]; th.append(button); return button;
  });
  const browserButtons = [...html.matchAll(/data-browser-sort="([^"]+)"/g)].map((match) => {
    const th = new Element('th'), button = new Element('button'); button.dataset.browserSort = match[1]; th.append(button); return button;
  });
  const calls = [], intervals = [], timeouts = [];
  globalThis.document = { documentElement: { dataset: { marketSource: hostedOrigin } }, getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), createTextNode: (text) => { const node = new Element('text'); node.textContent = text; return node; }, querySelectorAll: (selector) => selector === '.sort' ? buttons : selector === '.resale-sort' ? resaleButtons : selector === '.browser-sort' ? browserButtons : [] };
  globalThis.location = { origin: 'http://localhost:4174' };
  globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return 0; };
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false, unref() {} }; timeouts.push(timer); return timer; };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    if (historyFixture && new URL(path, location.origin).pathname === '/api/history') return historyFixture(path, options);
    const body = path === '/api/status' ? { csrf: 'local-test', job: { state: 'idle', message: 'Ready' }, configured, collection, clientId: '', settings: { selected: {}, discovery: configured ? {} : null } }
      : path === '/api/demo' ? { snapshot: demoSnapshot() } : path === '/api/snapshot' || (hostedOrigin && path === hostedOrigin + '/api/snapshot') ? { snapshot: liveSnapshot } : path === '/api/liquidity' ? { liquidity: initialLiquidity } : path === '/api/neutral-books' ? { report: initialNeutralReport } : { ok: true };
    return { ok: true, json: async () => body };
  };
  try {
    await import(`../public/app.mjs?smoke=${++uiRun}`);
    const chooseCategories = async (view, categories) => {
      const container = elements[view === 'market' ? 'category' : `${view}-category`];
      await container.children[0].children.find(button => button.dataset.action === (categories === 'all' ? 'all' : 'none')).trigger();
      if (categories === 'all') return;
      for (const label of container.children[1].children) {
        const input = label.children[0];
        if (categories.includes(input.dataset.category)) { input.checked = true; await input.trigger('change'); }
      }
    };
    await run({ elements, buttons, resaleButtons, browserButtons, chooseCategories, calls, intervals, timeouts, now: clock, setClock: (value) => { clock = value; },
      refreshSnapshot: async (value) => { liveSnapshot = value; await elements['show-live'].trigger(); } });
  } finally {
    Date.now = originalNow;
    for (const [key, value] of Object.entries(original)) globalThis[key] = value;
  }
}

test('hosted UI uses the snapshot and listed stock without local collection or sales lookup', async () => {
  const hostedOrigin = 'https://test.example';
  const initialSnapshot = { ...demoSnapshot(), mode: 'live', publicVersion: 1, retainedAt: new Date().toISOString() };
  await withUI({ hostedOrigin, initialSnapshot }, async ({ elements, calls }) => {
    assert.equal(elements['resale-view'].hidden, false);
    assert.equal(elements['collect'].textContent, 'Refresh');
    await elements['market-tab'].trigger();
    assert.match(elements['row-count'].textContent, /listed-stock proxy/);
    await elements['collect'].trigger();
    assert.deepEqual(calls.map(({ path }) => path), Array(2).fill(hostedOrigin + '/api/snapshot'));
    assert.ok(calls.every(({ options }) => !options.method));
  });
});

test('setup tab, sample preview, trade defaults, filters, sorts and local credential submission', async () => {
  await withUI({}, async ({ elements, buttons, chooseCategories, calls }) => {
    assert.equal(elements.setup.open, true);
    assert.equal(elements['setup-view'].hidden, false);
    assert.equal(elements['market-view'].hidden, true);
    assert.equal(elements.rows.children.length, 0);
    assert.equal(elements['house-alliance'].textContent, '110');
    assert.equal(elements['callback-url'].textContent, 'http://localhost:4174/oauth/callback');
    await elements.preview.trigger();
    assert.equal(elements['resale-view'].hidden, false);
    await elements['market-tab'].trigger();
    assert.equal(elements['market-view'].hidden, false);
    assert.equal(elements['setup-view'].hidden, true);
    assert.equal(elements.mode.textContent, 'SAMPLE DATA');
    assert.equal(elements.rows.children.length, 2);
    assert.match(elements.rows.children[0].textContent, /Peacebloom/);
    assert.match(elements.rows.children[0].textContent, /Horde ↑ · Alliance ↓/);
    assert.equal(elements.rows.children[0].children.length, 11);
    const copper = elements.rows.children.find((value) => value.textContent.includes('Copper Ore'));
    assert.match(copper.children[10].textContent, /Alliance ↑ · Neutral ↓/);
    assert.match(copper.children[1].textContent, /3\.05 g/);
    assert.match(copper.children[4].textContent, /1\.85k1\.8k\/day est\./);
    assert.match(elements.rows.textContent, /Copper Ore/);
    await chooseCategories('market', ['Ores']);
    assert.equal(elements.rows.children.length, 1);
    elements.search.value = '2770'; await elements.search.trigger('input');
    assert.equal(elements.rows.children.length, 1);
    elements.search.value = ''; await chooseCategories('market', 'all');
    await buttons.find((button) => button.dataset.sort === 'alliance').trigger();
    assert.match(elements.rows.children[0].textContent, /Copper Ore/);
    await buttons.find((button) => button.dataset.sort === 'neutralImbalance').trigger();
    assert.match(elements.rows.children[0].textContent, /Copper Ore/);
    assert.match(elements.rows.children.at(-1).textContent, /Peacebloom/);
    await elements['show-live'].trigger();
    assert.equal(elements.mode.textContent, 'AWAITING SETUP');
    await elements['setup-tab'].trigger();
    assert.equal(elements['setup-view'].hidden, false);
    await elements['setup-tab'].trigger('keydown', { key: 'ArrowLeft' });
    assert.equal(elements['browser-view'].hidden, false);
    assert.equal(elements['browser-tab'].focused, true);
    await elements['browser-tab'].trigger('keydown', { key: 'ArrowLeft' });
    assert.equal(elements['resale-view'].hidden, false);
    assert.equal(elements['resale-tab'].focused, true);
    await elements['resale-tab'].trigger('keydown', { key: 'ArrowLeft' });
    assert.equal(elements['market-view'].hidden, false);
    assert.equal(elements['market-tab'].focused, true);
    elements['client-id'].value = 'test-client'; elements['client-secret'].value = 'private-secret';
    await elements['credentials-form'].trigger('submit');
    assert.equal(elements['client-secret'].value, '');
    assert.equal(calls.find((call) => call.path === '/api/setup').options.headers['X-Local-CSRF'], 'local-test');
  });
});

test('configured users land on the table; collection details stay open after four hours and fold after fresh data', async () => {
  const hour = 60 * 60 * 1000;
  const now = Date.now();
  const live = { ...demoSnapshot(), mode: 'live', generatedAt: new Date(now - hour).toISOString() };
  for (const house of Object.values(live.houses)) house.observedAt = live.generatedAt;
  await withUI({ configured: true, initialSnapshot: live }, async ({ elements, intervals, setClock, refreshSnapshot }) => {
    assert.equal(elements['resale-view'].hidden, false);
    assert.equal(elements['setup-view'].hidden, true);
    assert.equal(elements['collection-status'].open, false);
    assert.equal(elements['collection-stale'].hidden, true);
    assert.equal(elements['house-times'].children.length, 3);
    elements['collection-status'].open = true;
    await elements['collection-status'].trigger('toggle');
    assert.equal((await elements['collection-summary'].trigger()).defaultPrevented, false);
    elements['collection-status'].open = false;
    await elements['collection-status'].trigger('toggle');
    setClock(now + 3 * hour + 1);
    await intervals.find((interval) => interval.ms === 60_000).fn();
    assert.equal(elements['collection-status'].open, true);
    assert.equal(elements['collection-stale'].hidden, false);
    assert.equal(elements['collection-summary'].attributes['aria-disabled'], 'true');
    assert.equal((await elements['collection-summary'].trigger()).defaultPrevented, true);
    assert.equal((await elements['collection-summary'].trigger('keydown', { key: 'Enter' })).defaultPrevented, true);
    elements['collection-status'].open = false;
    await elements['collection-status'].trigger('toggle');
    assert.equal(elements['collection-status'].open, true);

    const fresh = { ...live, generatedAt: new Date(now + 3 * hour + 1).toISOString(), houses: structuredClone(live.houses) };
    for (const house of Object.values(fresh.houses)) house.observedAt = fresh.generatedAt;
    await refreshSnapshot(fresh);
    assert.equal(elements['collection-status'].open, false);
    assert.equal(elements['collection-stale'].hidden, true);
    // A new collection of cached, older source prices must stay expanded.
    fresh.houses.horde.observedAt = new Date(now - 2 * hour).toISOString();
    await refreshSnapshot(fresh);
    assert.equal(elements['collection-status'].open, true);
    assert.equal(elements['collection-stale'].textContent, 'Prices over 4h old');
  });
});

test('neutral resale shows profitable opportunities, sorts by profit or margin and opens the price-level math', async () => {
  await withUI({ configured: true, initialSnapshot: demoSnapshot() }, async ({ elements, resaleButtons, chooseCategories, refreshSnapshot }) => {
    assert.equal(elements['resale-view'].hidden, false);
    assert.equal(elements['collection-toolbar'].hidden, false);
    assert.equal(elements['resale-rows'].children.length, 3);
    const iron = elements['resale-rows'].children[0];
    assert.equal(iron.children.length, 8);
    assert.match(iron.textContent, /Iron Ore/);
    assert.match(iron.children[6].textContent, /2\.78 gⓘ/);
    assert.equal(iron.children[7].textContent, '12%');
    assert.match(iron.children[3].textContent, /61030 offers/);
    assert.match(iron.children[5].textContent, /61030 offers/); // Includes loss-making stock.
    assert.equal(elements['resale-rows'].textContent.includes('Tin Ore'), false);
    await iron.children[6].children[1].trigger();
    assert.equal(elements['profit-dialog'].open, true);
    assert.match(elements['profit-title'].textContent, /Iron Ore/);
    assert.match(elements['profit-assumption'].textContent, /406 units/);
    assert.equal(elements['profit-levels'].children.length, 2);
    assert.match(elements['profit-totals'].textContent, /−1g15s71c/);
    assert.match(elements['profit-totals'].textContent, /\+2g78s11c/);
    await elements['profit-close'].trigger();
    assert.equal(elements['profit-dialog'].open, false);

    await chooseCategories('resale', ['Herbs']);
    assert.equal(elements['resale-rows'].children.length, 1);
    assert.match(elements['resale-rows'].textContent, /Peacebloom/);
    await chooseCategories('resale', 'all'); elements['resale-search'].value = '2770';
    await elements['resale-search'].trigger('input');
    assert.equal(elements['resale-rows'].children.length, 1);
    assert.match(elements['resale-rows'].textContent, /Copper Ore/);
    elements['resale-search'].value = ''; await elements['resale-search'].trigger('input');
    const profitSort = resaleButtons.find((button) => button.dataset.resaleSort === 'expectedProfit');
    await profitSort.trigger();
    assert.match(elements['resale-rows'].children.at(-1).textContent, /Iron Ore/);
    assert.equal(profitSort.closest('th').attributes['aria-sort'], 'ascending');
    // The other page's median control cannot change the resale target or profit.
    elements['price-basis'].value = 'medianBuyout'; await elements['price-basis'].trigger('input');
    assert.match(elements['resale-rows'].children.at(-1).children[6].textContent, /2\.78 g/);

    const marginSort = resaleButtons.find((button) => button.dataset.resaleSort === 'expectedMargin');
    await marginSort.trigger();
    assert.equal(marginSort.closest('th').attributes['aria-sort'], 'descending');
    assert.match(elements['resale-rows'].children[0].textContent, /Peacebloom/);
    assert.equal(elements['resale-rows'].children[0].children[7].textContent, '29.5%');

    const current = elements['resale-rows'].children[0];
    await current.children[6].children[1].trigger();
    await elements['setup-tab'].trigger();
    assert.equal(elements['profit-dialog'].open, false);
    assert.equal(elements['collection-toolbar'].hidden, true);
    await elements['resale-tab'].trigger();
    assert.equal(elements['collection-toolbar'].hidden, false);
    await current.children[6].children[1].trigger();
    await refreshSnapshot(demoSnapshot());
    assert.equal(elements['profit-dialog'].open, false); // Never retain math from replaced data.
  });
});

test('summary-only snapshots require a collection and failed or unprofitable books do not suggest trades', async () => {
  const old = demoSnapshot(); delete old.neutralDepthVersion;
  for (const row of old.rows) delete row.quotes.neutral.priceLevels;
  await withUI({ configured: true, initialSnapshot: old }, async ({ elements, refreshSnapshot }) => {
    assert.equal(elements['resale-rows'].children.length, 0);
    assert.equal(elements['resale-depth-notice'].hidden, false);
    assert.match(elements['resale-depth-notice'].textContent, /Collect now.*older snapshot/);
    await elements['market-tab'].trigger();
    assert.equal(elements.rows.children.length, 2); // Older summaries can still rank faction opportunities.
    await elements['resale-tab'].trigger();
    const failed = demoSnapshot(); failed.houses.neutral.status = 'error';
    for (const row of failed.rows) row.quotes.neutral = null;
    await refreshSnapshot(failed);
    assert.equal(elements['resale-rows'].children.length, 0);
    assert.match(elements['resale-depth-notice'].textContent, /unavailable house/);
    const losing = demoSnapshot();
    for (const row of losing.rows) row.quotes.alliance.minBuyout = 1;
    await refreshSnapshot(losing);
    assert.equal(elements['resale-depth-notice'].hidden, true);
    assert.equal(elements['resale-rows'].children.length, 0);
    assert.match(elements['resale-empty'].textContent, /No profitable listings/);
  });
});

test('page one filters volume and net profit and exposes both traders fee math', async () => {
  await withUI({ configured: true, initialSnapshot: demoSnapshot() }, async ({ elements }) => {
    await elements['market-tab'].trigger();
    assert.equal(elements.rows.children.length, 2);
    assert.match(elements['row-count'].textContent, /2 daily \/ 0 stock proxy/);
    const peace = elements.rows.children[0];
    await peace.children[1].children[1].trigger();
    assert.equal(elements['trade-dialog'].open, true);
    assert.match(elements['trade-assumption'].textContent, /zero profit/);
    assert.match(elements['trade-math'].textContent, /Horde sale fee \(5%\)−4\.5c/);
    assert.match(elements['trade-math'].textContent, /Neutral sale fee.*−12\.83c/);
    assert.match(elements['trade-math'].textContent, /Your profit at that neutral ask \/ unit−20\.75c/);
    assert.match(elements['trade-detail'].textContent, /1,200 estimated units\/day/);
    await elements['trade-close'].trigger();
    assert.equal(elements['trade-dialog'].open, false);

    elements['min-volume'].value = '1600'; await elements['min-volume'].trigger('input');
    assert.equal(elements.rows.children.length, 0); // Both markets must clear the minimum.
    elements['volume-markets'].value = 'either'; await elements['volume-markets'].trigger('input');
    assert.equal(elements.rows.children.length, 1);
    assert.match(elements.rows.textContent, /Copper Ore/);
    elements['min-profit-volume'].value = '4'; await elements['min-profit-volume'].trigger('input');
    assert.equal(elements.rows.children.length, 0);
    await elements['reset-trade-filters'].trigger();
    assert.equal(elements.rows.children.length, 2);
    elements['min-unit-profit'].value = '0.003'; await elements['min-unit-profit'].trigger('input');
    assert.equal(elements.rows.children.length, 1);
    assert.match(elements.rows.textContent, /Peacebloom/);
    await elements['reset-trade-filters'].trigger();
    elements['volume-mode'].value = 'stock'; await elements['volume-mode'].trigger('input');
    assert.match(elements['row-count'].textContent, /0 daily \/ 2 stock proxy/);
    elements['min-volume'].value = '-1'; await elements['min-volume'].trigger('input');
    assert.equal(elements['trade-filter-error'].hidden, false);
    assert.equal(elements.rows.children.length, 0);
    await elements['reset-trade-filters'].trigger();
    assert.equal(elements['trade-filter-error'].hidden, true);
  });
});

test('live estimates load on page one only, expire into stock fallback, and daily-only mode stays strict', async () => {
  const live = { ...demoSnapshot(), mode: 'live' }, source = structuredClone(live.liquidity);
  await withUI({ configured: true, initialSnapshot: live, initialLiquidity: source }, async ({ elements, calls, timeouts, setClock }) => {
    assert.equal(calls.filter((call) => call.path === '/api/liquidity').length, 0);
    await elements['market-tab'].trigger();
    assert.equal(calls.filter((call) => call.path === '/api/liquidity').length, 1);
    assert.match(elements['row-count'].textContent, /2 daily/);
    await elements.rows.children[0].children[1].children[1].trigger();
    assert.equal(elements['trade-dialog'].open, true);
    await elements['load-liquidity'].trigger();
    assert.equal(elements['trade-dialog'].open, false);
    assert.equal(elements['trade-math'].textContent, '');
    await elements.rows.children[0].children[1].children[1].trigger();
    const expiresAt = source.markets.alliance.expiresAt;
    setClock(expiresAt + 1);
    await timeouts.find((timer) => !timer.cancelled).fn();
    assert.equal(elements['trade-dialog'].open, false);
    assert.equal(elements['trade-math'].textContent, '');
    assert.match(elements['row-count'].textContent, /0 daily \/ 2 stock proxy/);
    assert.equal(source.markets.alliance.items, undefined);
    elements['volume-mode'].value = 'daily'; await elements['volume-mode'].trigger('input');
    assert.equal(elements.rows.children.length, 0);
    assert.match(elements.empty.textContent, /No trades match/);
  });
});

test('neutral verification renders all asks, distinguishes incomplete books and highlights the in-game price', async () => {
  const at = new Date().toISOString();
  const offers = Array.from({ length: 80 }, (_, index) => ({ unitPrice: 230 + index, quantity: 20, totalBuyout: (230 + index) * 20, listingCount: 1 }));
  const report = { generatedAt: at, expiresAt: Date.parse(at) + 60_000, houses: [
    { id: 116, rulesetLabel: 'PvP (community label)', status: 'ok', failures: [], documents: [{ feed: 'items', observedAt: at, fetchedAt: at, cached: true, timeBasis: 'Last-Modified' }],
      quotes: [{ variant: '', minBuyout: 230, medianBuyout: 280, buyoutUnits: 1600, buyoutAuctions: 80, bidOnlyAuctions: 1, offers }] },
    { id: 117, rulesetLabel: 'Normal (community label)', status: 'error', failures: [{ feed: 'commodities', error: 'Unavailable' }], documents: [], quotes: [] },
    { id: 118, rulesetLabel: 'Unconfirmed ruleset', status: 'ok', failures: [], documents: [], quotes: [] },
  ] };
  await withUI({ configured: true, initialNeutralReport: report }, async ({ elements, calls, setClock, intervals }) => {
    await elements['setup-tab'].trigger();
    assert.equal(elements['neutral-books'].children.length, 3);
    assert.match(elements['neutral-progress'].textContent, /mapping not confirmed in game/);
    const book = elements['neutral-books'].children[0];
    const body = book.children.find((child) => child.className === 'table-scroll').children[0].children[1];
    assert.equal(body.children.length, 80); // Never truncate to a summary/top N.
    assert.equal(body.children[50].className, 'ask-match');
    assert.match(body.children[50].textContent, /2s80c2056s120/);
    assert.match(book.textContent, /cached response/);
    assert.match(elements['neutral-books'].children[1].textContent, /INCOMPLETE.*Coverage is unknown/);
    assert.match(elements['neutral-books'].children[2].textContent, /not listed in either feed/);
    elements['neutral-match'].value = '230'; await elements['neutral-match'].trigger('input');
    const changedBody = elements['neutral-books'].children[0].children.find((child) => child.className === 'table-scroll').children[0].children[1];
    assert.equal(changedBody.children[0].className, 'ask-match');
    await elements['inspect-neutral'].trigger();
    assert.equal(elements['neutral-check'].open, true);
    const post = calls.find((call) => call.path === '/api/inspect-neutral');
    assert.equal(post.options.headers['X-Local-CSRF'], 'local-test');
    setClock(report.expiresAt + 1);
    await intervals.find((interval) => interval.ms === 60_000).fn();
    assert.equal(elements['neutral-books'].children.length, 0);
  });
});

test('collection countdown and budget are visible, tick without API calls and reenable at expiry', async () => {
  const now = Date.now();
  const collection = { nextEligibleAt: now + 300_000, lastCheckedAt: new Date(now).toISOString(), outcome: 'unchanged', requestBudget: { used: 8, limit: 600 } };
  await withUI({ configured: true, initialSnapshot: demoSnapshot(), collection }, async ({ elements, calls, intervals, setClock }) => {
    assert.equal(elements.collect.disabled, true);
    assert.match(elements.collect.textContent, /Check again in 5:00/);
    assert.match(elements['last-api-check'].textContent, /No newer auction data/);
    assert.match(elements['request-budget'].textContent, /8 \/ 600/);
    assert.equal(elements.discover.disabled, true);
    assert.equal(elements['inspect-neutral'].disabled, true);
    const before = calls.length;
    setClock(now + 299_000);
    await intervals.find((interval) => interval.ms === 1000).fn();
    assert.equal(elements.collect.textContent, 'Check again in 0:01');
    setClock(now + 300_000);
    await intervals.find((interval) => interval.ms === 1000).fn();
    assert.equal(elements.collect.disabled, false);
    assert.equal(elements.collect.textContent, 'Collect now ↻');
    assert.equal(calls.length, before);
  });
});

test('data browser has independent checkbox categories, raw stock, prices and no trade gates', async () => {
  const snapshot = demoSnapshot();
  const sword = snapshot.rows.find(row => row.category === 'Weapon');
  sword.quotes.horde = null;
  const peace = snapshot.rows.find(row => row.id === 2447);
  peace.quotes.neutral = { ...peace.quotes.neutral, minBuyout: null, medianBuyout: null, buyoutUnits: 0, buyoutAuctions: 0, bidOnlyAuctions: 3, auctions: 3 };
  // Entirely bid-only items still belong in the default listed-items browser.
  const unknown = structuredClone(peace);
  Object.assign(unknown, { id: 987654, key: '987654:', name: 'Item #987654', category: 'Unknown' });
  unknown.quotes.alliance = unknown.quotes.neutral; unknown.quotes.horde = null;
  snapshot.rows.push(unknown);
  const empty = structuredClone(unknown); Object.assign(empty, { id: 999888, key: '999888:', name: 'Empty Recipe', category: 'Recipe' });
  empty.quotes = Object.fromEntries(['alliance', 'horde', 'neutral'].map(faction => [faction, { minBuyout: null, medianBuyout: null, auctions: 0, buyoutUnits: 0, buyoutAuctions: 0, bidOnlyAuctions: 0 }]));
  snapshot.rows.push(empty);
  await withUI({ configured: true, initialSnapshot: snapshot }, async ({ elements, browserButtons, chooseCategories, calls, refreshSnapshot }) => {
    const before = calls.length;
    await elements['browser-tab'].trigger();
    assert.equal(calls.length, before); // Browsing does not collect or load sales estimates.
    assert.equal(elements['browser-view'].hidden, false);
    assert.equal(elements['browser-metrics'].hidden, false);
    assert.equal(elements['market-metrics'].hidden, true);
    assert.equal(elements['resale-metrics'].hidden, true);
    assert.equal(elements['browser-rows'].children.length, 13);
    assert.equal(elements['browser-rows'].children[0].children.length, 8);
    assert.equal(elements['browser-rows'].textContent.includes('Expected profit'), false);
    assert.match(elements['browser-rows'].textContent, /Copper Bar/);
    assert.match(elements['browser-rows'].textContent, /Fine Scimitar.*Unavailable/);
    assert.match(elements['browser-rows'].textContent, /Item #987654.*Bid only.*3 bid-only/);
    assert.equal(elements['browser-scope-notice'].hidden, true);
    await chooseCategories('browser', ['Weapon', 'Metal & Stone']);
    assert.equal(elements['browser-rows'].children.length, 2);
    assert.match(elements['browser-category-summary'].textContent, /2 selected/);
    elements['browser-search'].value = '4560'; await elements['browser-search'].trigger('input');
    assert.equal(elements['browser-rows'].children.length, 1);
    assert.match(elements['browser-rows'].children[0].children[2].textContent, /2g50s/);
    elements['browser-basis'].value = 'medianBuyout'; await elements['browser-basis'].trigger('input');
    assert.match(elements['browser-rows'].children[0].children[2].textContent, /2g80s/);
    elements['browser-search'].value = ''; await elements['browser-search'].trigger('input');
    await chooseCategories('browser', []);
    assert.equal(elements['browser-rows'].children.length, 0);
    assert.equal(elements['browser-empty'].hidden, false);
    await chooseCategories('browser', 'all');
    elements['browser-listed'].checked = false; await elements['browser-listed'].trigger('input');
    assert.equal(elements['browser-rows'].children.length, 14);
    await browserButtons.find(button => button.dataset.browserSort === 'horde').trigger();
    assert.match(elements['browser-rows'].children.at(-1).textContent, /Item #987654/); // Missing prices remain last.
    await elements['resale-tab'].trigger();
    assert.equal(elements['resale-rows'].children.length, 2); // Browser settings do not hide resale rows.
    await elements['browser-tab'].trigger();
    assert.equal(elements['browser-rows'].children.length, 14);
    const legacy = structuredClone(snapshot); delete legacy.catalog.scope;
    await refreshSnapshot(legacy);
    assert.equal(elements['browser-scope-notice'].hidden, false);
    assert.match(elements['browser-scope-notice'].textContent, /Collect now/);
  });
});

test('browser paginates after global sorting, resets on filters and keeps selections on new data', async () => {
  const snapshot = demoSnapshot(), template = snapshot.rows[0];
  snapshot.rows = Array.from({ length: 205 }, (_, index) => ({ ...structuredClone(template), id: 1000 + index,
    key: `${1000 + index}:`, name: `Item ${String(index).padStart(3, '0')}`, category: index % 2 ? 'Armor' : 'Weapon' }));
  await withUI({ configured: true, initialSnapshot: snapshot }, async ({ elements, browserButtons, chooseCategories, refreshSnapshot }) => {
    await elements['browser-tab'].trigger();
    assert.equal(elements['browser-rows'].children.length, 100);
    assert.match(elements['browser-page'].textContent, /1–100 of 205.*Page 1 \/ 3/);
    assert.equal(elements['browser-prev'].disabled, true);
    await elements['browser-next'].trigger();
    assert.match(elements['browser-rows'].children[0].textContent, /Item 100/);
    await elements['browser-next'].trigger();
    assert.equal(elements['browser-rows'].children.length, 5);
    assert.equal(elements['browser-next'].disabled, true);
    await browserButtons.find(button => button.dataset.browserSort === 'name').trigger();
    assert.match(elements['browser-page'].textContent, /Page 1 \/ 3/);
    assert.match(elements['browser-rows'].children[0].textContent, /Item 204/);
    await chooseCategories('browser', ['Weapon']);
    assert.match(elements['browser-page'].textContent, /of 103.*Page 1 \/ 2/);
    await elements['browser-next'].trigger();
    const smaller = structuredClone(snapshot); smaller.rows = smaller.rows.slice(0, 10);
    await refreshSnapshot(smaller);
    assert.equal(elements['browser-rows'].children.length, 5);
    assert.match(elements['browser-page'].textContent, /Page 1 \/ 1/);
    assert.equal(elements['browser-category-summary'].textContent, 'Categories · Weapon');
    elements['browser-search'].value = 'armor'; await elements['browser-search'].trigger('input');
    assert.equal(elements['browser-rows'].children.length, 0);
    await chooseCategories('browser', 'all');
    assert.equal(elements['browser-rows'].children.length, 5); // Category text is searchable.
  });
});

test('volume toggles are independent, keep profit math and use the resale destination stock', async () => {
  const snapshot = demoSnapshot();
  const copper = snapshot.rows.find(row => row.id === 2770), iron = snapshot.rows.find(row => row.id === 2772);
  // A single cheap neutral offer can still be worth buying in a busy Alliance market.
  copper.quotes.neutral = { ...copper.quotes.neutral, auctions: 1, buyoutAuctions: 1, buyoutUnits: 1,
    priceLevels: [{ unitPrice: 90, quantity: 1, listingCount: 1, totalBuyout: 90 }] };
  iron.quotes.alliance.buyoutUnits = 999;
  await withUI({ configured: true, initialSnapshot: snapshot }, async ({ elements, calls }) => {
    const before = calls.length;
    assert.equal(elements['resale-rows'].children.length, 3);
    assert.equal(elements['resale-volume-control'].hidden, true);
    const originalProfit = elements['resale-rows'].children.find(row => row.textContent.includes('Copper Ore')).children[6].textContent;
    elements['resale-filter-low-volume'].checked = true; await elements['resale-filter-low-volume'].trigger('input');
    assert.equal(elements['resale-volume-control'].hidden, false);
    assert.equal(elements['resale-rows'].children.length, 2);
    assert.match(elements['resale-count'].textContent, /1 below volume minimum/);
    assert.equal(elements['resale-volume-hint'].hidden, false);
    const filteredCopper = elements['resale-rows'].children.find(row => row.textContent.includes('Copper Ore'));
    assert.equal(filteredCopper.children[6].textContent, originalProfit);
    elements['resale-min-volume'].value = '999'; await elements['resale-min-volume'].trigger('input');
    assert.equal(elements['resale-rows'].children.length, 3); // Inclusive boundary.
    elements['resale-min-volume'].value = '1241'; await elements['resale-min-volume'].trigger('input');
    assert.equal(elements['resale-rows'].children.length, 1);
    assert.match(elements['resale-rows'].textContent, /Copper Ore/);
    elements['resale-min-volume'].value = '1.5'; await elements['resale-min-volume'].trigger('input');
    assert.equal(elements['resale-filter-error'].hidden, false);
    assert.equal(elements['resale-rows'].children.length, 0);
    elements['resale-filter-low-volume'].checked = false; await elements['resale-filter-low-volume'].trigger('input');
    assert.equal(elements['resale-filter-error'].hidden, true);
    assert.equal(elements['resale-rows'].children.length, 3);
    await elements['market-tab'].trigger();
    assert.equal(elements.rows.children.length, 2);
    elements['filter-low-volume'].checked = false; await elements['filter-low-volume'].trigger('input');
    assert.equal(elements['min-volume'].disabled, true);
    assert.equal(elements['volume-markets'].disabled, true);
    assert.equal(elements.rows.children.length, 3); // Copper Bar still clears the profit minimum.
    assert.match(elements['trade-filter-summary'].textContent, /volume minimum off/);
    await elements['reset-trade-filters'].trigger();
    assert.equal(elements['filter-low-volume'].checked, true);
    assert.equal(elements['min-volume'].disabled, false);
    assert.equal(elements.rows.children.length, 2);
    assert.equal(calls.length, before); // All filtering uses existing data.
  });
});

test('unnamed item explanation preserves prices, IDs and equipment variant details', async () => {
  const snapshot = demoSnapshot(), row = snapshot.rows.find(row => row.id === 2772);
  row.name = 'Item #2772'; row.metadataMissing = true; row.variant = '[0,[12727],[]]';
  await withUI({ configured: true, initialSnapshot: snapshot }, async ({ elements }) => {
    const item = elements['resale-rows'].children[0];
    assert.match(item.children[0].textContent, /Item #2772.*Name unavailable in Forever API/);
    assert.match(item.children[0].title, /Auction prices are available/);
    assert.match(item.children[0].title, /Variant: \[0,\[12727\],\[\]\]/);
    assert.match(item.children[6].textContent, /2\.78 g/);
  });
});

test('opening a hosted item requests its variant on demand and preserves available ranges through a retry', async () => {
  const hostedOrigin = 'https://test.example';
  const initialSnapshot = { ...demoSnapshot(), mode: 'live', publicVersion: 1, retainedAt: new Date().toISOString() };
  const row = initialSnapshot.rows[0];
  row.variant = '[2,[10],[]]';
  row.key = row.id + ':' + row.variant;
  let attempts = 0;
  async function historyFixture(path) {
    const to = Number(new URL(path).searchParams.get('to'));
    attempts++;
    return {
      ok: attempts !== 3,
      json: async () => ({ points: [
        { house: 110, hour: to - 2, price: null, stock: 0 },
        { house: 110, hour: to, price: 240, stock: 40 }
      ] })
    };
  }
  await withUI({ hostedOrigin, initialSnapshot, historyFixture }, async ({ elements, calls }) => {
    await elements['browser-tab'].trigger();
    const cell = elements['browser-rows'].children.find((tr) => tr.textContent.includes(row.name)).children[0];
    const link = cell.children[0];
    assert.equal(attempts, 0);
    assert.equal((await link.trigger('click')).defaultPrevented, true);
    assert.equal(elements['history-dialog'].open, true);
    assert.equal(attempts, 1);
    const query = new URL(calls.at(-1).path).searchParams;
    assert.equal(query.get('item'), String(row.id));
    assert.equal(query.get('variant'), row.variant);
    assert.equal(Number(query.get('to')) - Number(query.get('from')), 23);
    assert.match(elements['history-values'].children[0].textContent, /2s 40c.*40/);
    assert.match(elements['history-values'].children[1].textContent, /No observation/);
    elements['history-hour'].value = String(Number(query.get('to')) - 2);
    await elements['history-hour'].trigger('input');
    assert.match(elements['history-values'].children[0].textContent, /No buyout listings0/);

    elements['history-range'].value = '30';
    await elements['history-range'].trigger('change');
    assert.equal(attempts, 6);
    assert.match(elements['history-status'].textContent, /couldn’t load/);
    assert.equal(elements['history-chart'].hidden, false);
    assert.equal(elements['history-retry'].hidden, false);
    await elements['history-retry'].trigger('click');
    assert.equal(attempts, 7);
    assert.equal(elements['history-retry'].hidden, true);
    assert.equal(calls.filter(({ path }) => path === hostedOrigin + '/api/snapshot').length, 1);

    const dialog = elements['history-dialog'];
    dialog.getBoundingClientRect = () => ({ left: 100, right: 500, top: 100, bottom: 400 });
    const padding = { target: dialog, clientX: 105, clientY: 105 };
    const backdrop = { target: dialog, clientX: 80, clientY: 100 };
    await dialog.trigger('pointerdown', padding);
    await dialog.trigger('click', padding);
    assert.equal(dialog.open, true);
    await dialog.trigger('pointerdown', padding);
    await dialog.trigger('click', backdrop);
    assert.equal(dialog.open, true);
    await dialog.trigger('pointerdown', backdrop);
    await dialog.trigger('click', backdrop);
    assert.equal(dialog.open, false);
    await dialog.trigger('close');
    assert.equal(link.focused, true);
  });
});
