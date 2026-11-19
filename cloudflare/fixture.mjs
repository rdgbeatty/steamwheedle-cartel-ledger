import { deflateSync } from 'node:zlib';
import { HOUSES, MAX_ITEM, RECORD_BYTES, SHARDS, packDay, seriesFor, shardFor } from './format.mjs';

const seriesByShard = Array.from({ length: SHARDS }, () => []);
for (let series = 0; series < MAX_ITEM * 3; series++) seriesByShard[shardFor(series)].push(series);

// The same source publication always produces the same quotes.
export function sourceHour(hour, market) {
  if (market === 2 && hour % 47 === 0) return -1;
  return hour % 13 === 0 ? hour - 1 : hour;
}

export function fixtureQuote(series, market, publication) {
  if (publication < 0) return { state: 'unknown', price: null, stock: null };
  if (series !== seriesFor(3820, '') && series % 3 !== market)
    return { state: 'empty', price: null, stock: 0 };
  const noise = (Math.imul(series + 1, 48271) ^ Math.imul(publication + market, 69621)) >>> 0;
  if (noise % 101 === 0) return { state: 'empty', price: null, stock: 0 };
  if (noise % 137 === 0) return { state: 'bid-only', price: null, stock: 0 };
  return { state: 'priced', price: 100 + (noise % 10000) / 3, stock: 1 + (noise % 8000) };
}

function fixtureFrame(shard, hour) {
  const sources = HOUSES.map((_, market) => sourceHour(hour, market));
  const records = [];
  for (const series of seriesByShard[shard]) {
    for (let market = 0; market < 3; market++) {
      const quote = fixtureQuote(series, market, sources[market]);
      if (quote.state === 'priced' || quote.state === 'bid-only')
        records.push({ key: 3 * series + market, ...quote });
    }
  }
  const count = records.length;
  const raw = Buffer.alloc(24 + count * RECORD_BYTES);
  raw.write('FRM1');
  raw.writeUInt32LE(hour, 4);
  sources.forEach((source, index) => raw.writeInt32LE(source, 8 + 4 * index));
  raw.writeUInt32LE(count, 20);
  records.forEach(({ key, price, stock, state }, i) => {
    raw.writeUInt32LE(key, 24 + i * 4);
    raw.writeDoubleLE(price ?? NaN, 24 + count * 4 + i * 8);
    raw.writeUInt32LE(stock, 24 + count * 12 + i * 4);
    raw[24 + count * 16 + i] = state === 'bid-only' ? 2 : 3;
  });
  return deflateSync(raw);
}

export function fixtureBlock(shard, start, hours) {
  const members = Array(24).fill(null);
  for (let i = 0; i < hours; i++) members[(start % 24) + i] = fixtureFrame(shard, start + i);
  return packDay(members);
}
