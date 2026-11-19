import { DurableObject } from 'cloudflare:workers';
import { inflateSync } from 'node:zlib';

const HOUR = 3_600_000,
  DAY = 24 * HOUR;
const SHARDS = 32,
  HOUSES = [110, 113, 116],
  MAX_UPLOAD = 4 * 1024 * 1024;
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hourNow = () => Math.floor(Date.now() / HOUR);
const hourKey = (hour) => 'book-key-' + hour;
const bytes = (input) => new Uint8Array(input);
const encode = (data) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
const decode = (hex) => Uint8Array.from(hex.match(/../g), (v) => parseInt(v, 16));
const importKey = (hex) =>
  crypto.subtle.importKey('raw', decode(hex), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const packed = new Uint8Array(12 + encrypted.byteLength);
  packed.set(iv);
  packed.set(bytes(encrypted), 12);
  return packed;
}
async function open(key, data) {
  const v = bytes(data);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.subarray(0, 12) }, key, v.subarray(12));
}
function parseFrame(body) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let pos = 0;
  const parts = [];
  for (let shard = 0; shard < SHARDS; shard++) {
    const length = view.getUint32(pos, true);
    pos += 4;
    const split = view.getUint32(pos, true);
    if (length < 5 || split < 1 || split >= length - 4 || pos + length > body.length)
      throw Error('invalid frame');
    parts.push([body.subarray(pos + 4, pos + 4 + split), body.subarray(pos + 4 + split, pos + length)]);
    pos += length;
  }
  if (pos !== body.length) throw Error('extra bytes');
  return parts;
}

// A single transaction publishes an entire house. All books whose oldest source falls
// on the same UTC day reach the same writer, including retries on a fresh runner.
export class BookDay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS publications(
      hour INTEGER, house INTEGER, source INTEGER, checked INTEGER, version TEXT, PRIMARY KEY(hour,house));
      CREATE TABLE IF NOT EXISTS blocks(
      shard INTEGER, hour INTEGER, house INTEGER, chart BLOB, depth BLOB, PRIMARY KEY(shard,hour,house));
      CREATE TABLE IF NOT EXISTS keys_created(hour INTEGER PRIMARY KEY)`);
    this.keys = new Map();
  }
  async getKey(hour, create = false) {
    if (hour <= hourNow() - 2160) return null;
    if (this.keys.has(hour)) return this.keys.get(hour);
    let hex = await this.env.EXPIRY.get(hourKey(hour));
    if (!hex && create) {
      if (this.sql.exec('SELECT hour FROM keys_created WHERE hour=?', hour).toArray().length)
        throw Error('The encryption key is propagating. Retry this publication.');
      hex = encode(crypto.getRandomValues(new Uint8Array(32)));
      await this.env.EXPIRY.put(hourKey(hour), hex, { expiration: (hour + 2160) * 3600 });
      this.sql.exec('INSERT INTO keys_created VALUES(?)', hour);
    }
    if (!hex) return null;
    const key = await importKey(hex);
    this.keys.set(hour, key);
    return key;
  }
  async fetch(request) {
    const p = new URL(request.url).searchParams;
    const source = Number(p.get('source')),
      checked = Number(p.get('checked')),
      house = Number(p.get('house')),
      version = p.get('version');
    const hour = Math.floor(source / HOUR);
    if (
      !Number.isSafeInteger(source) ||
      !HOUSES.includes(house) ||
      hour <= hourNow() - 2160 ||
      source > Date.now() + 60000 ||
      !Number.isSafeInteger(checked) ||
      checked < source ||
      checked > Date.now() + 60000 ||
      !/^[a-f0-9]{64}$/.test(version)
    )
      return json({ error: 'Invalid publication' }, 400);
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD)
      return json({ error: 'Oversize book' }, 413);
    const body = bytes(await request.arrayBuffer());
    if (body.length > MAX_UPLOAD) return json({ error: 'Oversize book' }, 413);
    let parts;
    try {
      parts = parseFrame(body);
    } catch {
      return json({ error: 'Invalid book' }, 422);
    }
    // Serialise key creation and publication selection across overlapping retries.
    return this.ctx.blockConcurrencyWhile(async () => {
      const old = this.sql
        .exec('SELECT * FROM publications WHERE hour=? AND house=?', hour, house)
        .toArray()[0];
      if (
        old &&
        (old.version === version || old.source > source || (old.source === source && old.checked >= checked))
      )
        return json({ reused: true });
      const key = await this.getKey(hour, true);
      if (!key) return json({ error: 'Publication expired' }, 410);
      const encrypted = await Promise.all(
        parts.map((pair) => Promise.all(pair.map((data) => seal(key, data))))
      );
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm((Math.floor(hour / 24) + 1) * DAY + 90 * DAY);
      this.ctx.storage.transactionSync(() => {
        for (const [shard, [chart, depth]] of encrypted.entries())
          this.sql.exec('INSERT OR REPLACE INTO blocks VALUES(?,?,?,?,?)', shard, hour, house, chart, depth);
        this.sql.exec(
          'INSERT OR REPLACE INTO publications VALUES(?,?,?,?,?)',
          hour,
          house,
          source,
          checked,
          version
        );
      });
      return json({ published: true });
    });
  }
  async read(item, variant, from, to, depthHouse) {
    const pubs = this.sql
      .exec('SELECT * FROM publications WHERE hour BETWEEN ? AND ? ORDER BY hour, house', from, to)
      .toArray();
    const missing = [...new Set(pubs.map((p) => p.hour))].filter(
      (h) => !this.keys.has(h) && h > hourNow() - 2160
    );
    if (missing.length) {
      const values = await this.env.EXPIRY.get(missing.map(hourKey));
      for (const h of missing)
        if (values.get(hourKey(h))) this.keys.set(h, await importKey(values.get(hourKey(h))));
    }
    const result = [];
    for (const p of pubs) {
      if (p.hour <= hourNow() - 2160 || (depthHouse && p.house !== depthHouse)) continue;
      const key = this.keys.get(p.hour);
      if (!key) throw Error('Publication key temporarily unavailable.');
      const cols = depthHouse ? 'chart,depth' : 'chart';
      const row = this.sql
        .exec(
          'SELECT ' + cols + ' FROM blocks WHERE shard=? AND hour=? AND house=?',
          item % SHARDS,
          p.hour,
          p.house
        )
        .one();
      const unpack = async (blob) =>
        JSON.parse(inflateSync(await open(key, blob), { maxOutputLength: 8 * 1024 * 1024 }).toString());
      const quotes = await unpack(row.chart);
      const index = quotes.findIndex((q) => q[0] === item && q[1] === variant);
      const q = quotes[index];
      const point = {
        hour: p.hour,
        house: p.house,
        source: p.source,
        price: q?.[2] ?? null,
        stock: q?.[3] ?? 0
      };
      if (depthHouse) point.book = index < 0 ? [0, 0, []] : (await unpack(row.depth))[index];
      result.push(point);
    }
    return result;
  }
  async alarm() {
    this.keys.clear();
    await this.ctx.storage.deleteAll();
  }
}

export class LiveControl extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql
      .exec(`CREATE TABLE IF NOT EXISTS calls(t INTEGER); CREATE TABLE IF NOT EXISTS cooldown(until INTEGER);
      CREATE TABLE IF NOT EXISTS checks(house INTEGER PRIMARY KEY, checked INTEGER, source INTEGER, status TEXT)`);
  }
  budget(action, until) {
    this.sql.exec('DELETE FROM calls WHERE t<=?', Date.now() - HOUR);
    const { used, oldest } = this.sql.exec('SELECT count(*) AS used,min(t) AS oldest FROM calls').one();
    const deferred = this.sql.exec('SELECT until FROM cooldown').toArray()[0]?.until ?? 0;
    const retryAt = Math.max(deferred, used >= 600 ? oldest + HOUR : 0);
    if (action === 'defer' && Number.isFinite(until) && until > deferred) {
      this.sql.exec('DELETE FROM cooldown');
      this.sql.exec('INSERT INTO cooldown VALUES(?)', until);
    }
    const accepted = retryAt <= Date.now();
    if (action === 'take' && accepted) this.sql.exec('INSERT INTO calls VALUES(?)', Date.now());
    return { accepted, limit: 600, used, remaining: Math.max(0, 600 - used), retryAt };
  }
  check(house, checked, source, status) {
    this.sql.exec(
      'INSERT INTO checks VALUES(?,?,?,?) ON CONFLICT(house) DO UPDATE SET checked=excluded.checked, source=coalesce(excluded.source,checks.source),status=excluded.status WHERE excluded.checked>=checks.checked',
      house,
      checked,
      source,
      status
    );
  }
  status() {
    return this.sql.exec('SELECT * FROM checks ORDER BY house').toArray();
  }
}
const dayStub = (env, hour) => env.BOOKS.getByName('forever-us-pvp/' + Math.floor(hour / 24));
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      p = url.searchParams;
    const control = env.CONTROL.getByName('live');
    if (request.method === 'GET' && url.pathname === '/api/status')
      return json({ dataset: 'forever-us-pvp', houses: await control.status() });
    if (request.method === 'GET' && ['/api/history', '/api/book'].includes(url.pathname)) {
      const item = Number(p.get('item')),
        variant = p.get('variant') ?? '';
      const from = Number(p.get('from')),
        to = Number(p.get('to'));
      const house = url.pathname === '/api/book' ? Number(p.get('house')) : null;
      if (
        !Number.isSafeInteger(item) ||
        item < 1 ||
        variant.length > 2048 ||
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from <= hourNow() - 2160 ||
        to > hourNow() ||
        from > to ||
        to - from >= 168 ||
        (house !== null && (!HOUSES.includes(house) || from !== to))
      )
        return json({ error: 'Invalid item or hour range' }, 400);
      const reads = [];
      for (let day = Math.floor(from / 24); day <= Math.floor(to / 24); day++)
        reads.push(dayStub(env, day * 24).read(item, variant, from, to, house));
      return json({ dataset: 'forever-us-pvp', item, variant, points: (await Promise.all(reads)).flat() });
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/collector/'))
      return json({ error: 'Unknown route' }, 404);
    if (
      !env.MARKET_INGEST_TOKEN ||
      request.headers.get('Authorization') !== 'Bearer ' + env.MARKET_INGEST_TOKEN
    )
      return json({ error: 'Unauthorized' }, 401);
    const action = url.pathname.slice('/api/collector/'.length);
    if (['take', 'defer', 'status'].includes(action))
      return json(await control.budget(action, Number(p.get('until'))));
    const house = Number(p.get('house'));
    if (!HOUSES.includes(house)) return json({ error: 'Unknown house' }, 400);
    if (action === 'upload') return dayStub(env, Math.floor(Number(p.get('source')) / HOUR)).fetch(request);
    if (action === 'prior') return json(await env.EXPIRY.get('prior-' + house, 'json'));
    if (action === 'check') {
      const { prior, checked, status } = await request.json();
      if (!Number.isSafeInteger(checked) || !['changed', 'unchanged', 'failed', 'cached'].includes(status))
        return json({ error: 'Invalid check' }, 400);
      if (prior) {
        const expiry = Math.floor(prior.source / 1000) + 30 * 86400;
        if (expiry > Date.now() / 1000 + 60)
          await env.EXPIRY.put('prior-' + house, JSON.stringify(prior), { expiration: expiry });
      }
      await control.check(house, checked, prior?.source ?? null, status);
      return json({ ok: true });
    }
    return json({ error: 'Unknown collector endpoint' }, 404);
  }
};
