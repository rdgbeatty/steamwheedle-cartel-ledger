import { createServer } from 'node:http';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { BlizzardClient } from './blizzard.mjs';
import { collectCatalog, discoverHouses } from './catalog.mjs';
import { collectMarket, FACTIONS } from './market.mjs';
import { readCredentials, readJson, readRecent, writeJson, DAY } from './store.mjs';
import { demoSnapshot } from './demo.mjs';
import { LiquidityClient } from './liquidity.mjs';
import { inspectNeutralBooks } from './neutral-books.mjs';
import { RequestBudget, BudgetError } from './request-budget.mjs';
import { CollectionGate } from './collection-gate.mjs';
import { ALL_ITEMS_SCOPE } from '../shared/items.mjs';
import { US_PVP, MAPPING_EVIDENCE, validatePvpHouses, isPvpSnapshot } from '../shared/market.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_STATE = join(ROOT, '.wow-local');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/format.mjs', ['format.mjs', 'text/javascript; charset=utf-8']],
  ['/collection.mjs', ['collection.mjs', 'text/javascript; charset=utf-8']],
  ['/category-filter.mjs', ['category-filter.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/market.mjs', ['market.mjs', 'text/javascript; charset=utf-8', 'shared']],
  ['/shared/resale.mjs', ['resale.mjs', 'text/javascript; charset=utf-8', 'shared']],
  ['/shared/trade.mjs', ['trade.mjs', 'text/javascript; charset=utf-8', 'shared']],
  ['/shared/items.mjs', ['items.mjs', 'text/javascript; charset=utf-8', 'shared']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/market-table.css', ['market-table.css', 'text/css; charset=utf-8']],
]);
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError('Expected a JSON request.');
  let length = 0, content = '';
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16_384) throw new HttpError('Local setup request is too large.', 413);
    content += chunk.toString('utf8');
  }
  let result;
  try { result = JSON.parse(content || '{}'); } catch { throw new HttpError('Invalid JSON request.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new HttpError('Expected a JSON object.');
  return result;
}

function validateSelection(input, discovery) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input) ||
    FACTIONS.some((faction) => input[faction] !== US_PVP.houses[faction]))) {
    throw new HttpError('This tool is locked to US PvP: Alliance 110, Horde 113, neutral 116.');
  }
  try { return validatePvpHouses(discovery); }
  catch (error) { throw new HttpError(error.message); }
}

export function createLocalServer({ directory = DEFAULT_STATE, clientFactory = null, liquidityClient = new LiquidityClient(), env = process.env, now = () => Date.now() } = {}) {
  const csrf = randomBytes(32).toString('hex');
  let client, credentialKey, mutationBusy = false;
  let job = { state: 'idle', message: 'Ready for local setup.' };
  let controller, pending = Promise.resolve();
  let neutralReport = null, neutralReportTimer;
  const budget = new RequestBudget({ file: join(directory, 'request-budget.json'), now });
  const gate = new CollectionGate(join(directory, 'collection-state.json'), { now });
  const settingsPath = join(directory, 'settings.json');
  const credentialsPath = join(directory, 'private', 'credentials.json');
  const settings = async () => ({ ...await readJson(settingsPath, { discovery: null }), selected: { ...US_PVP.houses }, market: US_PVP });

  async function reserveCollection() {
    const state = await budget.status();
    if (state.retryAt > now()) throw new BudgetError('The shared Blizzard request budget is cooling down.', state.retryAt);
    await gate.begin();
  }

  async function readSnapshot() {
    const snapshot = await readRecent(directory, 'snapshot.json', 30 * DAY);
    if (!isPvpSnapshot(snapshot)) return { snapshot: null, needsCollection: Boolean(snapshot) };
    // Preserve all data ages when recognizing an existing snapshot's market IDs.
    return { snapshot: { ...snapshot, market: US_PVP, mappingVerified: true, mappingEvidence: MAPPING_EVIDENCE }, needsCollection: false };
  }

  async function getClient() {
    const credentials = await readCredentials(directory, env);
    if (!credentials.clientId || !credentials.clientSecret) throw new HttpError('Save your Blizzard developer client ID and secret first.');
    const key = JSON.stringify([credentials.clientId, credentials.clientSecret]);
    if (!client || key !== credentialKey) { client?.dispose?.(); client = clientFactory ? clientFactory(credentials) : new BlizzardClient(credentials, { budget, now }); credentialKey = key; }
    return client;
  }

  function startJob(kind, operation) {
    if (job.state === 'running') throw new HttpError('A collection is already running.', 409);
    controller = new AbortController();
    job = { state: 'running', kind, message: 'Starting…', startedAt: new Date().toISOString(), finishedAt: null, error: null };
    const progress = (message) => { job.message = message; };
    const signal = controller.signal;
    pending = (async () => {
      try {
        const result = await operation({ signal, progress });
        await gate.finish(result?.unchanged ? 'unchanged' : kind === 'collect' ? 'updated' : kind);
        job = { ...job, state: 'complete', unchanged: Boolean(result?.unchanged), message: kind === 'discover' ? 'Auction houses discovered.' : kind === 'inspect' ? 'Neutral house check complete.' : result?.unchanged ? 'Checked Blizzard: no newer auction data.' : 'Collection complete.', finishedAt: new Date().toISOString() };
      } catch (error) {
        await gate.finish(signal.aborted ? 'canceled' : 'failed').catch(() => {});
        job = { ...job, state: signal.aborted ? 'canceled' : 'failed', message: signal.aborted ? 'Collection canceled.' : error.message,
          error: signal.aborted ? null : error.message, finishedAt: new Date().toISOString() };
      }
    })();
  }

  async function discover(options) {
    options.progress('Authenticating and discovering US Forever houses…');
    const api = await getClient();
    const discovery = await discoverHouses(api, options);
    const updated = { selected: validatePvpHouses(discovery), discovery, market: US_PVP };
    await writeJson(settingsPath, updated);
    return updated;
  }

  async function collect(options, refreshCatalog = false) {
    const api = await getClient();
    const current = await settings();
    if (!current.discovery) throw new HttpError('Discover auction houses before collecting.');
    const selected = validateSelection(current.selected, current.discovery);
    let catalog = refreshCatalog ? null : await readRecent(directory, 'catalog.json', 30 * DAY);
    if (catalog && (catalog.scope !== ALL_ITEMS_SCOPE || Date.now() - Date.parse(catalog.generatedAt) >= DAY)) catalog = null;
    if (!catalog) {
      catalog = await collectCatalog(api, options);
      await writeJson(join(directory, 'catalog.json'), catalog);
    }
    options.progress(`Collecting auction data for all items · ${catalog.items.length.toLocaleString('en-US')} catalog entries…`);
    const { snapshot: previousSnapshot } = await readSnapshot();
    const snapshot = await collectMarket(api, catalog, selected, current.discovery, { ...options, previousSnapshot });
    if (options.signal.aborted) throw new Error('Collection canceled.');
    // Replace only after a valid collection. Previous snapshots survive failed jobs.
    if (!snapshot.unchanged) await writeJson(join(directory, 'snapshot.json'), snapshot);
    return { unchanged: snapshot.unchanged };
  }

  const server = createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8',
      ...(status === 429 && body.retryAt ? { 'Retry-After': String(Math.max(1, Math.ceil((body.retryAt - now()) / 1000))) } : {}) }); res.end(JSON.stringify(body)); };
    const port = res.socket.localPort;
    if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) return json(403, { error: 'Open the tool on localhost.' });
    const origin = `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== origin) return json(403, { error: 'Use the local tool page.' });
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type, folder = 'public'] = assets.get(url.pathname);
        res.writeHead(200, { ...headers, 'Content-Type': type });
        return res.end(await readFile(join(ROOT, folder, file)));
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const credentials = await readCredentials(directory, env);
        const current = await settings();
        const [collection, requestBudget] = await Promise.all([gate.status(), budget.status()]);
        return json(200, { csrf, job, configured: Boolean(credentials.clientId && credentials.clientSecret),
          collection: { ...collection, nextEligibleAt: Math.max(collection.nextEligibleAt, requestBudget.retryAt), requestBudget },
          clientId: credentials.clientId, fromEnvironment: credentials.fromEnvironment, settings: current, market: US_PVP });
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(200, await readSnapshot());
      if (req.method === 'GET' && url.pathname === '/api/neutral-books') {
        if (neutralReport?.expiresAt <= Date.now()) neutralReport = null;
        return json(200, { report: neutralReport });
      }
      if (req.method === 'GET' && url.pathname === '/api/liquidity') {
        const { snapshot } = await readSnapshot();
        if (!snapshot) return json(200, { liquidity: null });
        const ids = [...new Set((snapshot.rows ?? []).filter((row) => !row.variant).map((row) => row.id))];
        return json(200, { liquidity: await liquidityClient.get(ids) });
      }
      if (req.method === 'GET' && url.pathname === '/api/demo') return json(200, { snapshot: demoSnapshot() });
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers.origin !== origin || req.headers['x-local-csrf'] !== csrf) return json(403, { error: 'Reload the local page before making changes.' });
        const body = await readBody(req);
        if (url.pathname === '/api/cancel') {
          controller?.abort();
          return json(200, { ok: true });
        }
        if (job.state === 'running' || mutationBusy) throw new HttpError('Wait for the current operation or cancel the collection first.', 409);
        mutationBusy = true;
        try {
        if (url.pathname === '/api/setup') {
          const old = await readCredentials(directory, env);
          if (old.fromEnvironment) throw new HttpError('Credentials are set in the server environment. Change them there or unset them to use local setup.');
          const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
          const secret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
          const clientSecret = secret || (clientId === old.clientId ? old.clientSecret : '');
          if (!/^[A-Za-z0-9_-]{6,256}$/.test(clientId) || !clientSecret || clientSecret.length > 2048 || /[\x00-\x20\x7f]/.test(clientSecret)) {
            throw new HttpError('Enter a valid developer client ID and secret. Changing the client ID requires its matching secret.');
          }
          await reserveCollection();
          await writeJson(credentialsPath, { clientId, clientSecret });
          client?.dispose?.(); client = null;
          startJob('collect', async (options) => { await discover(options); return collect(options, true); });
          return json(202, { ok: true });
        }
        if (url.pathname === '/api/forget') {
          await unlink(credentialsPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          client?.dispose?.(); client = null; credentialKey = null;
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/discover') {
          await getClient();
          await reserveCollection();
          startJob('discover', discover);
          return json(202, { ok: true });
        }
        if (url.pathname === '/api/inspect-neutral') {
          const api = await getClient();
          await reserveCollection();
          startJob('inspect', async (options) => {
            const report = await inspectNeutralBooks(api, options);
            if (options.signal.aborted) throw new Error('House check canceled.');
            if (report.expiresAt <= Date.now()) throw new Error('Blizzard returned observations beyond the 30-day retention limit.');
            neutralReport = report;
            clearTimeout(neutralReportTimer);
            neutralReportTimer = setTimeout(() => { neutralReport = null; }, Math.min(report.expiresAt - Date.now(), 2_147_483_647));
            neutralReportTimer.unref?.();
          });
          return json(202, { ok: true });
        }
        if (url.pathname === '/api/collect') {
          const current = await settings();
          const selected = validateSelection(body.selected, current.discovery);
          await getClient();
          await reserveCollection();
          await writeJson(settingsPath, { ...current, selected });
          startJob('collect', (options) => collect(options, body.refreshCatalog === true));
          return json(202, { ok: true });
        }
        return json(404, { error: 'Unknown local action.' });
        } finally { mutationBusy = false; }
      }
      return json(404, { error: 'Not found.' });
    } catch (error) {
      return json(error instanceof HttpError || error instanceof BudgetError ? error.status : 500,
        { error: error instanceof HttpError || error instanceof BudgetError ? error.message : 'The local operation failed. Check the state directory and retry.',
          ...(error instanceof BudgetError ? { retryAt: error.retryAt } : {}) });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.stopJobs = () => controller?.abort();
  server.waitForIdle = () => pending;
  server.on('close', () => { controller?.abort(); client?.dispose?.(); liquidityClient.dispose?.(); clearTimeout(neutralReportTimer); neutralReport = null; });
  return server;
}
