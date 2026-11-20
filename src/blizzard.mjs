import { RequestBudget, BudgetError } from './request-budget.mjs';

const API = 'https://us.api.blizzard.com';
const TOKEN = 'https://oauth.battle.net/token';
const RAW_TTL = 30 * 86_400_000;

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}

function encoded(value) { return new URLSearchParams({ v: value }).toString().slice(2); }

async function boundedJson(response, limit) {
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > limit) throw new ApiError('Blizzard returned a document larger than the local collection limit.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('Blizzard returned an unreadable JSON document. Retry later.'); }
}

function maxAge(headers, now) {
  const policy = headers.get('cache-control') ?? '';
  if (/(?:^|,)\s*(?:no-cache|no-store)\b/i.test(policy)) return 0;
  const match = /(?:^|,)\s*max-age="?(\d+)/i.exec(policy);
  const date = Date.parse(headers.get('date')), expires = Date.parse(headers.get('expires'));
  const age = Math.max(0, Number(headers.get('age') ?? 0) * 1000, Number.isFinite(date) ? now - date : 0);
  const remaining = match ? Number(match[1]) * 1000 - age : Number.isFinite(expires) ? expires - now : 0;
  return Number.isFinite(remaining) ? Math.max(0, Math.min(remaining, 3_600_000)) : 0;
}

export class BlizzardClient {
  constructor(credentials, { fetchImpl = fetch, now = () => Date.now(), budget = null, cacheBodies = true, sleep = (ms, signal) => new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); reject(new ApiError('Collection canceled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  }) } = {}) {
    this.credentials = credentials;
    this.fetch = fetchImpl;
    this.now = now;
    this.budget = budget ?? new RequestBudget({ now });
    this.sleep = sleep;
    this.cacheBodies = cacheBodies;
    this.token = null;
    this.cache = new Map();
    this.cacheTimers = new Map();
    this.requests = 0;
  }

  forget(url) {
    this.cache.delete(url);
    clearTimeout(this.cacheTimers.get(url)); this.cacheTimers.delete(url);
  }

  dispose() { for (const url of this.cache.keys()) this.forget(url); this.token = null; }

  async request(url, options, signal, tokenRequest = false, readBody = boundedJson) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new ApiError('Collection canceled.');
      try { await this.budget.take(); }
      catch (error) {
        if (error instanceof BudgetError) throw error;
        throw new ApiError('The local request budget could not be updated. Check the state-directory permissions.');
      }
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 30_000);
      try {
        this.requests++;
        const fetchImpl = this.fetch;
        const response = await fetchImpl(url, { ...options, redirect: 'manual', signal: controller.signal });
        const retry = response.headers.get('retry-after');
        const retryMs = retry === null ? null : /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - this.now());
        if (Number.isFinite(retryMs)) await this.budget.defer(this.now() + retryMs);
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retry = response.headers.get('retry-after');
          const wait = retry === null ? (attempt + 1) * 1000 : /^\d+$/.test(retry)
            ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - this.now());
          await response.body?.cancel();
          if (!Number.isFinite(wait) || wait > 30_000) throw new ApiError('Blizzard asked us to wait before retrying. Try collection again later.', response.status);
          clearTimeout(timer);
          await this.sleep(wait, signal);
          continue;
        }
        if (!response.ok && response.status !== 304) {
          await response.body?.cancel();
          // Never echo upstream bodies: authentication errors can contain secrets.
          const message = tokenRequest
            ? `Blizzard OAuth rejected the application credentials (HTTP ${response.status}). Check the client ID and secret from the same developer application.`
            : `Blizzard ${new URL(url).pathname} returned HTTP ${response.status}.`;
          throw new ApiError(message, response.status);
        }
        const data = response.status === 304 ? null : await readBody(response, tokenRequest ? 64_000 : 64 * 1024 * 1024);
        return { response, data };
      } catch (error) {
        if (signal?.aborted) throw new ApiError('Collection canceled.');
        if (error instanceof ApiError || error instanceof BudgetError) throw error;
        if (attempt === 2) throw new ApiError('Could not reach Blizzard. Check internet access, DNS and the system clock, then retry.');
        await this.sleep((attempt + 1) * 1000, signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
  }

  async accessToken(signal) {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) throw new ApiError('Enter your Blizzard developer client ID and secret in Local setup.');
    const { data } = await this.request(TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${encoded(clientId)}:${encoded(clientSecret)}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    }, signal, true);
    if (typeof data?.access_token !== 'string' || !data.access_token || /[\r\n]/.test(data.access_token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new ApiError('Blizzard OAuth did not return a usable application token.');
    }
    this.token = { value: data.access_token, expiresAt: this.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  async get(path, { namespace = 'dynamic', query = {}, signal, revalidate = false, validators = null, forceBody = false, readBody } = {}) {
    if (!path.startsWith('/data/wow/') || path.includes('..') || path.includes('?') || path.includes('#')) throw new ApiError('Unsupported Blizzard path.');
    if (!['dynamic', 'static'].includes(namespace)) throw new ApiError('Only Forever game-data namespaces are supported.');
    const url = new URL(path, API);
    url.search = new URLSearchParams({ ...query, namespace: `${namespace}-forever-us`, locale: 'en_US' }).toString();
    if (this.cache.get(url.href)?.rawExpiresAt <= this.now()) this.forget(url.href);
    const cached = this.cache.get(url.href);
    if (!forceBody && !revalidate && cached && cached.expiresAt > this.now()) return { ...cached.document, cached: true };
    // Validate the displayed snapshot's version, even if a diagnostic has put a
    // newer raw response in this client's cache.
    const prior = forceBody ? null : validators ?? cached?.document;
    const etag = forceBody ? null : prior?.etag;
    const modified = prior?.lastModified ?? (prior?.timeBasis === 'Last-Modified' && prior.observedAt ? new Date(prior.observedAt).toUTCString() : null);
    const cachedVersionMatches = cached && (etag ? cached.document.etag === etag
      : modified ? (cached.document.lastModified ?? (cached.document.timeBasis === 'Last-Modified' ? new Date(cached.document.observedAt).toUTCString() : null)) === modified : !validators);
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      const accessToken = await this.accessToken(signal);
      try {
        result = await this.request(url.href, { headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(etag ? { 'If-None-Match': etag } : modified ? { 'If-Modified-Since': modified } : {}),
          ...(revalidate ? { 'Cache-Control': 'max-age=0' } : {}),
        } }, signal, false, readBody);
        break;
      } catch (error) {
        if (error.status !== 401 || attempt) throw error;
        this.token = null;
      }
    }
    const { response, data } = result;
    const fetchedAt = new Date(this.now()).toISOString();
    let document;
    if (response.status === 304) {
      if (!prior) throw new ApiError('Blizzard returned 304 without a cached document. Retry the collection.');
      document = { ...prior, data: cachedVersionMatches ? cached.document.data : null, fetchedAt, cached: true, notModified: true };
      document.retainedAt ??= prior.observedAt ?? prior.fetchedAt;
    } else {
      const modified = response.headers.get('last-modified');
      const date = Date.parse(response.headers.get('date'));
      const age = Number(response.headers.get('age') ?? 0);
      const sourceTime = Number.isFinite(Date.parse(modified)) ? Date.parse(modified)
        : Number.isFinite(date) && Number.isFinite(age) && age >= 0 ? date - age * 1000 : null;
      document = { data, fetchedAt, observedAt: sourceTime === null ? null : new Date(sourceTime).toISOString(),
        retainedAt: new Date(Math.min(this.now(), sourceTime ?? this.now())).toISOString(),
        timeBasis: Number.isFinite(Date.parse(modified)) ? 'Last-Modified' : sourceTime === null ? 'unknown' : 'HTTP Date/Age', cached: false, notModified: false };
    }
    document.lastModified = response.headers.get('last-modified') ?? (response.status === 304 ? prior?.lastModified ?? modified : null);
    document.etag = response.headers.get('etag') ?? (response.status === 304 ? etag : null);
    document.cacheControl = response.headers.get('cache-control');
    document.freshUntil = this.now() + maxAge(response.headers, this.now());
    const rawExpiresAt = Date.parse(document.retainedAt) + RAW_TTL;
    if (rawExpiresAt <= this.now()) { this.forget(url.href); throw new ApiError('Blizzard returned observations beyond the 30-day retention limit.'); }
    // Keep only a few raw responses in memory; raw auction books never go to disk.
    this.forget(url.href);
    if (this.cacheBodies && document.data !== null && !/(?:^|,)\s*no-store\b/i.test(response.headers.get('cache-control') ?? '')) {
      this.cache.set(url.href, { document, etag: document.etag, rawExpiresAt,
        expiresAt: Math.min(rawExpiresAt, this.now() + maxAge(response.headers, this.now())) });
      const purge = setTimeout(() => this.forget(url.href), Math.min(rawExpiresAt - this.now(), 2_147_483_647));
      purge.unref?.(); this.cacheTimers.set(url.href, purge);
    }
    while (this.cache.size > 8) this.forget(this.cache.keys().next().value);
    return document;
  }
}
