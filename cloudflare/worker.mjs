import { DurableObject } from 'cloudflare:workers';
import { inflateSync } from 'node:zlib';
import {
  HOUR,
  WINDOW,
  SHARDS,
  MAX_ITEM,
  MAX_BLOCK,
  MAX_FRAME,
  VARIANTS,
  packDay,
  unpackDay,
  frameView,
  validateFrame,
  readSeries,
  digest,
  seriesFor,
  shardFor
} from './format.mjs';

const LEASE_MS = 10 * 60_000;
const GC_GRACE_MS = 30 * 60_000;
const dayOf = (hour) => Math.floor(hour / 24);
const nowHour = () => Math.floor(Date.now() / HOUR);
const firstHour = () => nowHour() - WINDOW + 1;
const control = (env) => env.CONTROL.getByName('synthetic-v1');
const shardStub = (env, shard) => env.HISTORY.getByName('synthetic-v1/' + shard);
const problem = (status, error) => ({ status, error });
const respond = (result) =>
  Response.json(result, { status: result.status ?? 200, headers: { 'cache-control': 'no-store' } });

async function boundedBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new RangeError();
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError();
    }
    parts.push(value);
  }
  const result = new Uint8Array(size);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

function validBatch(input) {
  return (
    input &&
    Number.isSafeInteger(input.start) &&
    Number.isSafeInteger(input.hours) &&
    input.hours >= 1 &&
    input.hours <= 24 &&
    input.start >= firstHour() &&
    input.start + input.hours - 1 <= nowHour() &&
    (input.start % 24) + input.hours <= 24 &&
    Array.isArray(input.digests) &&
    input.digests.length === SHARDS &&
    input.digests.every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
  );
}

export class MarketControl extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
      gen INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT UNIQUE, start INTEGER, hours INTEGER,
      base INTEGER, digests TEXT, receipts TEXT, expires INTEGER, state TEXT);
      CREATE TABLE IF NOT EXISTS manifest (day INTEGER PRIMARY KEY, gen INTEGER, endHour INTEGER)`);
  }

  async begin(batch) {
    if (!validBatch(batch)) return problem(400, 'Expected a synthetic batch inside the 90-day UTC window.');
    const { start, hours, digests } = batch;
    const fingerprint = await digest(new TextEncoder().encode(JSON.stringify([start, hours, digests])));
    await this.ensureCleanup();
    return this.ctx.storage.transactionSync(() => {
      const prior = this.sql
        .exec('SELECT gen, state, expires FROM runs WHERE fingerprint=?', fingerprint)
        .toArray()[0];
      if (prior?.state === 'committed') return { generation: prior.gen, committed: true };
      if (prior?.state === 'pending' && prior.expires > Date.now())
        return { generation: prior.gen, committed: false };
      const active = this.sql
        .exec("SELECT gen FROM runs WHERE state='pending' AND expires>? LIMIT 1", Date.now())
        .toArray();
      if (active.length) return problem(409, 'Another publication holds the collection lease.');
      const base = this.sql.exec('SELECT gen,endHour FROM manifest WHERE day=?', dayOf(start)).toArray()[0];
      if (base && start <= base.endHour) return problem(409, 'That UTC interval is already committed.');
      this.sql.exec("DELETE FROM runs WHERE state='pending' AND expires<=?", Date.now());
      const { gen } = this.sql
        .exec(
          `INSERT INTO runs(fingerprint,start,hours,base,digests,receipts,expires,state)
        VALUES(?,?,?,?,?,?,?,'pending') RETURNING gen`,
          fingerprint,
          start,
          hours,
          base?.gen ?? 0,
          JSON.stringify(digests),
          '0'.repeat(SHARDS),
          Date.now() + LEASE_MS
        )
        .one();
      return { generation: gen, committed: false };
    });
  }

  pending(gen) {
    return this.sql
      .exec("SELECT * FROM runs WHERE gen=? AND state='pending' AND expires>?", gen, Date.now())
      .toArray()[0];
  }

  ticket(gen, shard) {
    const run = this.pending(gen);
    if (!run) return problem(409, 'Upload lease expired or already committed.');
    return { start: run.start, hours: run.hours, base: run.base, hash: JSON.parse(run.digests)[shard] };
  }

  receipt(gen, shard, hash) {
    return this.ctx.storage.transactionSync(() => {
      const run = this.pending(gen);
      if (!run || JSON.parse(run.digests)[shard] !== hash)
        return problem(409, 'Receipt does not match active publication.');
      if (run.receipts[shard] === '0')
        this.sql.exec(
          'UPDATE runs SET receipts=? WHERE gen=?',
          run.receipts.slice(0, shard) + '1' + run.receipts.slice(shard + 1),
          gen
        );
      return { generation: gen, shard };
    });
  }

  commit(gen) {
    return this.ctx.storage.transactionSync(() => {
      const run = this.sql.exec('SELECT * FROM runs WHERE gen=?', gen).toArray()[0];
      if (run?.state === 'committed') return { generation: gen, committed: true };
      if (!run || run.expires <= Date.now() || run.receipts.includes('0'))
        return problem(409, 'Incomplete or expired publication.');
      const day = dayOf(run.start);
      const current = this.sql.exec('SELECT gen FROM manifest WHERE day=?', day).toArray()[0];
      if ((current?.gen ?? 0) !== run.base) return problem(409, 'Base generation changed.');
      this.sql.exec('INSERT OR REPLACE INTO manifest VALUES(?,?,?)', day, gen, run.start + run.hours - 1);
      this.sql.exec("UPDATE runs SET state='committed',digests=NULL,receipts=NULL WHERE gen=?", gen);
      return { generation: gen, committed: true };
    });
  }

  versions(first, last) {
    return this.sql
      .exec(
        'SELECT day,gen,endHour FROM manifest WHERE day BETWEEN ? AND ? ORDER BY day',
        dayOf(first),
        dayOf(last)
      )
      .toArray();
  }

  async ensureCleanup() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR);
  }

  async alarm() {
    this.sql.exec('DELETE FROM manifest WHERE day<?', dayOf(firstHour()));
    this.sql.exec(
      "DELETE FROM runs WHERE start+hours<=? OR (state='pending' AND expires<=?)",
      firstHour(),
      Date.now()
    );
    if (this.sql.exec('SELECT 1 FROM runs LIMIT 1').toArray().length)
      await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR);
  }
}

export class HistoryShard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS blocks (
      gen INTEGER PRIMARY KEY, day INTEGER, created INTEGER, hash TEXT, payload BLOB)`);
  }

  async fetch(request) {
    const [, generationParam, shardParam] = new URL(request.url).pathname.match(/\/(\d+)\/(\d+)$/);
    const gen = Number(generationParam),
      shard = Number(shardParam);
    const ctl = control(this.env);
    const ticket = await ctl.ticket(gen, shard);
    if (ticket.error) return respond(ticket);
    let bytes;
    try {
      bytes = await boundedBody(request, MAX_BLOCK);
    } catch {
      return respond(problem(413, 'Invalid upload size.'));
    }
    const hash = await digest(bytes);
    if (hash !== ticket.hash) return respond(problem(409, 'Upload checksum mismatch.'));
    if (!this.sql.exec('SELECT gen FROM blocks WHERE gen=?', gen).toArray().length) {
      const base = ticket.base
        ? this.sql.exec('SELECT payload FROM blocks WHERE gen=?', ticket.base).toArray()[0]
        : null;
      if (ticket.base && !base) return respond(problem(409, 'Committed base unavailable.'));
      const members = base ? unpackDay(base.payload) : Array(24).fill(null);
      let packed;
      try {
        const added = unpackDay(bytes);
        const start = ticket.start % 24;
        for (let i = 0; i < 24; i++) {
          const expected = i >= start && i < start + ticket.hours;
          if (expected !== Boolean(added[i])) throw new RangeError();
          if (!expected) continue;
          if (members[i]) throw new RangeError();
          const raw = inflateSync(added[i], { maxOutputLength: MAX_FRAME });
          validateFrame(frameView(raw, ticket.start + i - start), shard);
          members[i] = added[i];
        }
        packed = packDay(members);
      } catch {
        return respond(problem(422, 'Invalid compressed market frame.'));
      }
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR);
      this.sql.exec(
        'INSERT OR IGNORE INTO blocks VALUES(?,?,?,?,?)',
        gen,
        dayOf(ticket.start),
        Date.now(),
        hash,
        packed
      );
    }
    return respond(await ctl.receipt(gen, shard, hash));
  }

  size() {
    return this.sql.databaseSize;
  }

  chart(item, variant, versions, first, last) {
    const series = seriesFor(item, variant);
    const points = [];
    let rowsRead = 0;
    for (const { day, gen } of versions) {
      const cursor = this.sql.exec('SELECT payload FROM blocks WHERE gen=? AND day=?', gen, day);
      const row = cursor.toArray()[0];
      rowsRead += cursor.rowsRead;
      if (!row) return respond(problem(409, 'History version expired. Refresh the chart.'));
      const members = unpackDay(row.payload);
      for (let i = 0; i < 24; i++) {
        const hour = day * 24 + i;
        if (hour < first || hour > last || !members[i]) continue;
        const frame = frameView(inflateSync(members[i], { maxOutputLength: MAX_FRAME }), hour);
        points.push({ hour, quotes: readSeries(frame, series) });
      }
    }
    return respond({ dataset: 'synthetic-v1', item, variant, first, last, points, rowsRead });
  }

  async alarm() {
    // Snapshot eligible candidates BEFORE awaiting a manifest. A writer can
    // prepare and commit a later generation while the RPC is in flight.
    const candidates = this.sql
      .exec('SELECT day,gen FROM blocks WHERE created<?', Date.now() - GC_GRACE_MS)
      .toArray();
    const pinned = new Set((await control(this.env).versions(firstHour(), nowHour())).map((row) => row.gen));
    for (const { gen } of candidates)
      if (!pinned.has(gen)) this.sql.exec('DELETE FROM blocks WHERE gen=?', gen);
    if (this.sql.exec('SELECT 1 FROM blocks LIMIT 1').toArray().length)
      await this.ctx.storage.setAlarm(Date.now() + 24 * HOUR);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ctl = control(env);
    if (request.method === 'GET' && path === '/api/status') {
      const dates = await ctl.versions(firstHour(), nowHour());
      return respond({ dataset: 'synthetic-v1', dates });
    }
    if (request.method === 'GET' && path === '/api/history') {
      const item = Number(url.searchParams.get('item'));
      const variant = url.searchParams.get('variant') ?? '';
      const days = Number(url.searchParams.get('days') ?? 90);
      if (
        !Number.isInteger(item) ||
        item < 1 ||
        item > MAX_ITEM ||
        !VARIANTS.includes(variant) ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 90
      )
        return respond(problem(400, 'Invalid fixture item, variant or day count.'));
      const last = nowHour(),
        first = last - days * 24 + 1;
      const series = seriesFor(item, variant);
      const stub = shardStub(env, shardFor(series));
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await stub.chart(item, variant, await ctl.versions(first, last), first, last);
        if (response.status !== 409) return response;
        await response.body?.cancel();
      }
      return respond(problem(503, 'Committed history temporarily unavailable.'));
    }
    if (!path.startsWith('/api/ingest/') || request.method !== 'POST')
      return respond(problem(404, 'Unknown route.'));
    const secret = env.MARKET_INGEST_TOKEN;
    if (!secret || secret.length < 32) return respond(problem(503, 'Staging ingestion needs a secret.'));
    if (request.headers.get('authorization') !== 'Bearer ' + secret)
      return respond(problem(401, 'Invalid ingestion credential.'));
    const sizeRoute = path.match(/^\/api\/ingest\/size\/(\d{1,2})$/);
    if (sizeRoute && Number(sizeRoute[1]) < SHARDS) {
      return respond({ bytes: await shardStub(env, Number(sizeRoute[1])).size() });
    }
    if (path === '/api/ingest/begin') {
      let input;
      try {
        input = JSON.parse(new TextDecoder().decode(await boundedBody(request, 8192)));
      } catch {
        return respond(problem(400, 'Invalid batch declaration.'));
      }
      return respond(await ctl.begin(input));
    }
    const match = path.match(/^\/api\/ingest\/(\d{1,15})\/(commit|\d{1,2})$/);
    if (!match) return respond(problem(404, 'Unknown ingestion route.'));
    const gen = Number(match[1]);
    if (match[2] === 'commit') return respond(await ctl.commit(gen));
    const shard = Number(match[2]);
    if (shard >= SHARDS) return respond(problem(400, 'Invalid shard.'));
    return shardStub(env, shard).fetch(request);
  }
};
