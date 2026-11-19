// Wire format for the synthetic namespace. Integers are little endian.
export const SHARDS = 64;
export const HOUR = 3_600_000;
export const WINDOW = 90 * 24;
export const HOUSES = [110, 113, 116];
export const VARIANTS = ['', 'v1', 'v2'];
export const MAX_ITEM = 21_334;
export const DAY_HEADER = 4 + 25 * 4;
export const MAX_BLOCK = 1024 * 1024;
export const MAX_FRAME = 128 * 1024;
export const RECORD_BYTES = 17;

export function seriesFor(item, variant) {
  return (item - 1) * VARIANTS.length + VARIANTS.indexOf(variant);
}

// One stable routing function shared by the fixture producer and chart reader.
export function shardFor(series) {
  let value = Math.imul(series ^ (series >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) & (SHARDS - 1);
}

export function packDay(members) {
  const size = DAY_HEADER + members.reduce((sum, bytes) => sum + (bytes?.length ?? 0), 0);
  if (size > MAX_BLOCK) throw new RangeError('Daily block exceeds the size limit.');
  const bytes = new Uint8Array(size);
  bytes.set([68, 65, 89, 49]); // DAY1
  const view = new DataView(bytes.buffer);
  let cursor = DAY_HEADER;
  for (let hour = 0; hour < 24; hour++) {
    view.setUint32(4 + hour * 4, cursor, true);
    if (members[hour]) {
      bytes.set(members[hour], cursor);
      cursor += members[hour].length;
    }
  }
  view.setUint32(100, cursor, true);
  return bytes;
}

export function unpackDay(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length < DAY_HEADER || bytes.length > MAX_BLOCK)
    throw new RangeError('Invalid daily block size.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0) !== 0x44415931 ||
    view.getUint32(4, true) !== DAY_HEADER ||
    view.getUint32(100, true) !== bytes.length
  )
    throw new RangeError('Invalid day header.');
  const members = [];
  let cursor = DAY_HEADER;
  for (let hour = 0; hour < 24; hour++) {
    const end = view.getUint32(8 + hour * 4, true);
    if (end < cursor || end > bytes.length) throw new RangeError('Invalid frame offset.');
    members.push(end === cursor ? null : bytes.subarray(cursor, end));
    cursor = end;
  }
  return members;
}

// FRM1, UTC hour, three source publication hours (-1 means failed), count,
// then sorted columns: series/house key u32, price f64, quantity u32, state u8.
export function frameView(bytes, hour) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 24 ||
    bytes.length > MAX_FRAME ||
    view.getUint32(0) !== 0x46524d31 ||
    view.getUint32(4, true) !== hour
  )
    throw new RangeError('Invalid frame header.');
  const count = view.getUint32(20, true);
  if (bytes.length !== 24 + count * RECORD_BYTES) throw new RangeError('Invalid frame length.');
  const sources = HOUSES.map((_, i) => view.getInt32(8 + i * 4, true));
  if (sources.some((time) => time < -1 || time > hour)) throw new RangeError('Invalid publication hour.');
  return { view, sources, count };
}

function quoteAt({ view, count }, i) {
  return {
    price: view.getFloat64(24 + count * 4 + i * 8, true),
    stock: view.getUint32(24 + count * 12 + i * 4, true),
    state: view.getUint8(24 + count * 16 + i)
  };
}

export function validateFrame(frame, shard) {
  let last = -1;
  for (let i = 0; i < frame.count; i++) {
    const key = frame.view.getUint32(24 + i * 4, true);
    const { price, stock, state } = quoteAt(frame, i);
    if (
      key <= last ||
      key >= MAX_ITEM * 9 ||
      shardFor(Math.floor(key / 3)) !== shard ||
      frame.sources[key % 3] < 0
    )
      throw new RangeError('Invalid series or coverage.');
    if (
      !(state === 2 && Number.isNaN(price) && stock === 0) &&
      !(state === 3 && Number.isFinite(price) && price > 0 && stock > 0)
    )
      throw new RangeError('Invalid quote.');
    last = key;
  }
}

export function readSeries(frame, series) {
  return HOUSES.map((house, market) => {
    const publication = frame.sources[market];
    const key = series * 3 + market;
    let low = 0,
      high = frame.count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (frame.view.getUint32(24 + mid * 4, true) < key) low = mid + 1;
      else high = mid;
    }
    let price = null,
      stock = publication < 0 ? null : 0,
      state = publication < 0 ? 'unknown' : 'empty';
    if (low < frame.count && frame.view.getUint32(24 + low * 4, true) === key) {
      const quote = quoteAt(frame, low);
      price = quote.state === 3 ? quote.price : null;
      stock = quote.stock;
      state = quote.state === 3 ? 'priced' : 'bid-only';
    }
    return { house, publication: publication < 0 ? null : publication, price, stock, state };
  });
}

export async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
