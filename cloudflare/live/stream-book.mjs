import { JSONParser, TokenType } from '@streamparser/json';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { deflateSync, inflateSync } from 'node:zlib';
import { normalizeAuction } from '../../shared/auction.mjs';
import { ApiError } from '../../src/blizzard.mjs';

export const SHARDS = 32;
export const MAX_BOOK = 4 * 1024 * 1024;
const MAX_AUCTIONS = 500_000;
const MAX_GROUPS = 85_000;
const MAX_VARIANT = 2048;
const MAX_VARIANT_TEXT = 4 * 1024 * 1024;
const MAX_VALUE = 256 * 1024;
const CHUNK = 32 * 1024;
const MAX_UNCOMPRESSED_BLOCK = 8 * 1024 * 1024;

async function readAuctions(response, byteLimit, house, add) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('Missing auction response body.');
  const parser = new JSONParser({ paths: ['$.id', '$.name', '$.auctions.*'], keepStack: false });
  let depth = 0, start = 0, length = 0, lastToken = 0, inValue = false;
  let auctions = false, id, name, previous, key;
  parser.onToken = ({ token, value, offset }) => {
    lastToken = offset;
    if (depth === 0 && token !== TokenType.LEFT_BRACE) throw new Error('Expected a house object.');
    if (depth === 1) {
      if (inValue) {
        if (key === 'auctions') {
          if (auctions || token !== TokenType.LEFT_BRACKET) throw new Error('Expected one auctions array.');
          auctions = true;
        }
        inValue = false;
      } else if (token === TokenType.COLON) {
        key = previous;
        inValue = true;
      }
      previous = value;
    }
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
      if (depth++ <= 2) start = offset;
      if (depth > 48) throw new Error('Auction JSON is too deeply nested.');
    }
    if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) depth--;
    if (offset - start > MAX_VALUE && depth >= 3) throw new Error('An auction entry is too large.');
  };
  parser.onValue = ({ key, value, parent, stack }) => {
    if (stack.length === 2) {
      if (!Array.isArray(parent)) throw new Error('Expected an auctions array.');
      add(value);
    } else if (key === 'id') {
      if (id !== undefined || value !== house) throw new Error('Unexpected auction house.');
      id = value;
    } else if (key === 'name') {
      name = value;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += CHUNK) {
        const chunk = value.subarray(offset, offset + CHUNK);
        length += chunk.length;
        if (length > byteLimit || length - lastToken > MAX_VALUE + CHUNK)
          throw new ApiError('Auction feed exceeded the input size limit.');
        parser.write(chunk);
      }
    }
    if (!parser.isEnded) parser.end();
    if (!auctions && (id !== house || typeof name !== 'string')) throw new Error('Missing auction listings.');
    return true;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ApiError) throw error;
    // Parser diagnostics can contain upstream data.
    throw new ApiError('Invalid auction feed. Collection stopped before publication.');
  } finally {
    reader.releaseLock();
  }
}

class HouseBook {
  constructor(limit) {
    this.limit = limit;
    const slots = 2 ** Math.ceil(Math.log2(limit * 2));
    this.ids = new Float64Array(slots);
    this.quantities = new Float64Array(slots);
    this.total = new Float64Array(slots);
    this.series = new Uint32Array(slots);
    this.order = new Uint32Array(limit);
    this.groups = [];
    this.groupIds = new Map();
    this.count = 0;
    this.variantText = 0;
  }

  add(raw) {
    const { id, itemId, variant, quantity, totalBuyout } = normalizeAuction(raw);
    if (variant.length > MAX_VARIANT) throw new ApiError('Auction variant exceeded the size limit.');
    const mask = this.ids.length - 1;
    let slot = Math.imul((id | 0) ^ Math.floor(id / 2 ** 32), 0x9e3779b1) & mask;
    while (this.ids[slot] && this.ids[slot] !== id) slot = (slot + 1) & mask;
    const key = itemId + ':' + variant;
    let group = this.groupIds.get(key);
    if (this.ids[slot]) {
      if (group !== this.series[slot] || quantity !== this.quantities[slot] || (totalBuyout ?? 0) !== this.total[slot])
        throw new ApiError('Item and commodity documents disagree on an auction ID.');
      return;
    }
    if (this.count >= this.limit) throw new ApiError('Auction house exceeded the listing limit.');
    if (group === undefined) {
      this.variantText += variant.length;
      if (this.groups.length >= MAX_GROUPS || this.variantText > MAX_VARIANT_TEXT)
        throw new ApiError('Auction house exceeded the variant size limit.');
      group = this.groups.length;
      this.groups.push([itemId, variant]);
      this.groupIds.set(key, group);
    }
    this.ids[slot] = id;
    this.quantities[slot] = quantity;
    this.total[slot] = totalBuyout ?? 0;
    this.series[slot] = group;
    this.order[this.count++] = slot;
  }

  encode() {
    const ask = (slot) => this.total[slot] / this.quantities[slot];
    const orderedGroups = Uint32Array.from(this.groups, (_, i) => i);
    const sorted = this.order.subarray(0, this.count);
    const compare = (a, b) => a[0] % SHARDS - b[0] % SHARDS || a[0] - b[0] || a[1].localeCompare(b[1]);
    orderedGroups.sort((a, b) => compare(this.groups[a], this.groups[b]));
    const rank = new Uint32Array(this.groups.length);
    for (const [index, group] of orderedGroups.entries()) rank[group] = index;
    sorted.sort((a, b) => rank[this.series[a]] - rank[this.series[b]] || ask(a) - ask(b));
    const blocks = [];
    let start = 0, bytes = 0;
    for (let shard = 0; shard < SHARDS; shard++) {
      const chart = [], depth = [];
      while (start < sorted.length && this.groups[this.series[sorted[start]]][0] % SHARDS === shard) {
        const group = this.series[sorted[start]];
        const levels = [];
        let units = 0, stock = 0, bidOnly = 0;
        while (start < sorted.length && this.series[sorted[start]] === group) {
          const slot = sorted[start++];
          const quantity = this.quantities[slot];
          const price = ask(slot);
          units += quantity;
          if (!price) {
            bidOnly++;
            continue;
          }
          stock += quantity;
          let level = levels.at(-1);
          if (!level || level[0] !== price) {
            level = [price, 0, 0, 0];
            levels.push(level);
          }
          level[1] += quantity;
          level[2]++;
          level[3] += this.total[slot];
          if (!Number.isSafeInteger(level[3])) throw new Error('Price depth exceeded safe numeric precision.');
        }
        if (!Number.isSafeInteger(units)) throw new Error('Quantity exceeded safe numeric precision.');
        chart.push([...this.groups[group], levels[0]?.[0] ?? null, stock]);
        depth.push([units, bidOnly, levels]);
      }
      const summary = compress(chart), detail = compress(depth);
      const header = Buffer.alloc(8);
      header.writeUInt32LE(4 + summary.length + detail.length);
      header.writeUInt32LE(summary.length, 4);
      bytes += header.length + summary.length + detail.length;
      if (bytes > MAX_BOOK) throw new Error('Compressed house exceeded the upload limit.');
      blocks.push(header, summary, detail);
    }
    return Buffer.concat(blocks, bytes);
  }
}

function compress(value) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_UNCOMPRESSED_BLOCK) throw new Error('House bucket exceeded the archive read limit.');
  return deflateSync(json);
}

export function bookParts(body) {
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

export function unpackBlock(blob) {
  return JSON.parse(inflateSync(blob, { maxOutputLength: MAX_UNCOMPRESSED_BLOCK }).toString());
}

export async function captureHouse(client, house, prior, { force = false, limit = MAX_AUCTIONS } = {}) {
  const path = '/data/wow/ruleset/1/auctions/' + house;
  const endings = ['', '/commodities'];
  let book;
  const readBody = (response, byteLimit) => readAuctions(response, byteLimit, house, (row) => {
    book ??= new HouseBook(limit);
    book.add(row);
  });
  const get = (index, forceBody = false) => client.get(path + endings[index], {
    validators: prior?.documents[index], readBody, revalidate: true, forceBody: force || forceBody
  });
  const docs = [];
  for (const index of endings.keys()) docs.push(await get(index));
  if (docs.every((doc) => doc.notModified) && prior) {
    return { ...prior, unchanged: true, documents: docs.map(feedMetadata) };
  }
  for (const [index, doc] of docs.entries()) {
    if (doc.notModified) docs[index] = await get(index, true);
  }
  const documents = docs.map((doc, index) => {
    const old = prior?.documents[index];
    const meta = feedMetadata(doc);
    if (old && ((meta.etag && old.etag === meta.etag) ||
        (!meta.etag && meta.lastModified && old.lastModified === meta.lastModified))) {
      meta.retainedAt = new Date(Math.min(Date.parse(meta.retainedAt), Date.parse(old.retainedAt))).toISOString();
    }
    return meta;
  });
  const source = Math.min(...documents.map((doc) => Date.parse(doc.retainedAt)));
  const frame = (book ?? new HouseBook(1)).encode();
  const version = createHash('sha256').update(frame)
    .update(JSON.stringify([house, source, documents.map((doc) => doc.lastModified || doc.etag)]))
    .digest('hex');
  return { source, documents, version, frame };
}

function feedMetadata({ lastModified, etag, retainedAt, observedAt, freshUntil }) {
  return { lastModified, etag, retainedAt, observedAt, freshUntil };
}
