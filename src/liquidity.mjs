const API = 'https://api.ahledger.com/v1/pricetable/';
const DAY = 86_400_000;
export const LIQUIDITY_MARKETS = Object.freeze({ alliance: 'forever.pvp.alliance.us', horde: 'forever.pvp.horde.us' });

// AHledger's documented AHL1 table: field nine is estimated sales/day × 10.
// These are base-item scan estimates, never actual executed sales or variants.
export function parseSalesTable(body, market, now = Date.now()) {
  const lines = body.trim().split(/\r?\n/);
  const [format, scope, epoch, count] = lines.shift().split('|');
  const observedAt = Number(epoch) * 1000;
  if (format !== 'AHL1' || scope !== market.replaceAll('.', '/') || !/^\d+$/.test(epoch) ||
    !Number.isSafeInteger(observedAt) || observedAt > now + 60_000 || now - observedAt >= 30 * DAY ||
    !/^\d+$/.test(count) || Number(count) !== lines.length) throw new Error('AHledger returned an unsupported or stale market table.');
  const items = {}, seen = new Set();
  for (const line of lines) {
    const fields = line.split(':'), id = Number(fields[0]);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) || fields.length < 9) throw new Error('AHledger returned an unsupported item table.');
    seen.add(id);
    const encoded = fields[8];
    if (encoded === '') continue; // Unknown is different from a measured zero.
    if (!/^\d+$/.test(encoded) || !Number.isSafeInteger(Number(encoded))) throw new Error('AHledger returned an invalid sales estimate.');
    items[id] = Number(encoded) / 10;
  }
  return { market, observedAt: new Date(observedAt).toISOString(), items };
}

function remainingCache(headers, now) {
  const policy = headers.get('cache-control') ?? '';
  if (/(?:^|,)\s*(?:no-store|no-cache)\b/i.test(policy)) return 0;
  const match = /(?:^|,)\s*max-age="?(\d+)/i.exec(policy);
  const expires = Date.parse(headers.get('expires'));
  const date = Date.parse(headers.get('date'));
  const age = Math.max(0, Number(headers.get('age') ?? 0) * 1000, Number.isFinite(date) ? now - date : 0);
  const ttl = match ? Number(match[1]) * 1000 - age : Number.isFinite(expires) ? expires - now : 0;
  return Math.max(0, Math.min(ttl, 30 * DAY));
}

function retryDelay(headers, now) {
  const value = headers.get('retry-after');
  const delay = /^\d+$/.test(value ?? '') ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(60_000, delay) : 60_000;
}

export class LiquidityClient {
  constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl; this.now = now;
    this.cache = new Map(); this.pending = new Map(); this.cooldowns = new Map(); this.timers = new Map();
    this.controllers = new Set(); this.disposed = false;
    this.retryAt = 0;
  }

  async market(faction) {
    if (this.disposed) return { status: 'unavailable', error: 'Sales estimate client stopped.' };
    const cached = this.cache.get(faction);
    if (cached && cached.expiresAt > this.now()) return cached;
    this.cache.delete(faction);
    if (this.pending.has(faction)) return this.pending.get(faction);
    const cooldown = this.cooldowns.get(faction);
    if (Math.max(cooldown?.until ?? 0, this.retryAt) > this.now()) return { status: 'unavailable',
      error: cooldown?.error ?? 'AHledger asked us to wait before retrying.', retryAt: new Date(Math.max(cooldown?.until ?? 0, this.retryAt)).toISOString() };
    const request = this.fetchMarket(faction);
    this.pending.set(faction, request);
    try { return await request; } finally { this.pending.delete(faction); }
  }

  async fetchMarket(faction) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    let error = 'Could not reach AHledger. Listed-stock fallback is available.';
    this.cooldowns.set(faction, { until: this.now() + 60_000, error }); // At most one download/market/minute.
    try {
      const response = await this.fetch(`${API}${LIQUIDITY_MARKETS[faction]}`, { redirect: 'error', signal: controller.signal, headers: { Accept: 'text/plain' } });
      if (!response.ok) {
        const until = this.now() + retryDelay(response.headers, this.now());
        if (response.status === 429 || response.headers.has('retry-after')) this.retryAt = Math.max(this.retryAt, until);
        error = `AHledger daily estimates are unavailable (HTTP ${response.status}).`;
        this.cooldowns.set(faction, { until, error });
        await response.body?.cancel();
        throw new Error(error);
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of response.body ?? []) {
        length += chunk.length;
        if (length > 4 * 1024 * 1024) throw new Error('AHledger returned an oversized market table.');
        chunks.push(Buffer.from(chunk));
      }
      if (this.disposed) throw new Error('AHledger request canceled.');
      const parsed = parseSalesTable(Buffer.concat(chunks).toString('utf8'), LIQUIDITY_MARKETS[faction], this.now());
      const ttl = Math.min(remainingCache(response.headers, this.now()), Date.parse(parsed.observedAt) + 30 * DAY - this.now());
      if (ttl <= 0) throw new Error('AHledger estimates have no remaining cache lifetime.');
      const result = { status: 'ok', ...parsed, expiresAt: this.now() + ttl };
      this.cache.set(faction, result);
      clearTimeout(this.timers.get(faction));
      const purge = setTimeout(() => { this.cache.delete(faction); this.timers.delete(faction); }, Math.min(ttl, 2_147_483_647));
      purge.unref?.(); this.timers.set(faction, purge);
      return result;
    } catch (failure) {
      error = controller.signal.aborted ? 'AHledger timed out. Listed-stock fallback is available.'
        : failure.message.startsWith('AHledger ') ? failure.message : error;
      const until = Math.max(this.cooldowns.get(faction)?.until ?? 0, this.retryAt);
      this.cooldowns.set(faction, { until, error });
      return { status: 'unavailable', error, retryAt: new Date(until).toISOString() };
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }

  async get(itemIds) {
    const factions = Object.keys(LIQUIDITY_MARKETS);
    const results = await Promise.all(factions.map((faction) => this.market(faction)));
    const markets = Object.fromEntries(factions.map((faction, index) => {
      const result = results[index];
      return [faction, result.status === 'ok' ? { ...result, items: Object.fromEntries(itemIds.filter((id) => result.items[id] !== undefined).map((id) => [id, result.items[id]])) } : result];
    }));
    return { source: 'AHledger', url: 'https://ahledger.com/developers', methodUrl: 'https://ahledger.com/glossary',
      kind: 'estimated-sales-per-day', game: 'forever', region: 'us', ruleset: 'pvp', markets };
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.cache.clear();
  }
}
