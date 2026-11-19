// Read-only sizing spike. No price history, raw books, or credentials are written.
// Run: node tools/analyze-storage.mjs [--live-books]
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { readRecent, readCredentials, DAY } from '../src/store.mjs';
import { BlizzardClient } from '../src/blizzard.mjs';
import { RequestBudget } from '../src/request-budget.mjs';
import { US_PVP } from '../shared/market.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--live-books') || args.length > 1) throw new Error('Usage: node tools/analyze-storage.mjs [--live-books]');
const directory = process.env.WOW_STORAGE_STATE_DIR ?? resolve('.wow-local');
const HOURS = 24 * 90;
const factions = ['alliance', 'horde', 'neutral'];
function sizes(buffer) {
  return { bytes: buffer.length, gzipBytes: gzipSync(buffer).length,
    brotliBytes: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length };
}
function jsonSizes(value) { return sizes(Buffer.from(JSON.stringify(value))); }
function project(size) { return Object.fromEntries(Object.entries(size).map(([key, value]) => [key, value * HOURS])); }

// Column prototype: series u32, exact JS unit-price f64, buyout units u32,
// state u8. NaN denotes no ask. States distinguish unavailable, empty,
// bid-only and priced; the series dictionary stores item/variant/house once.
function summaryColumns(rows) {
  const records = [];
  for (let series = 0; series < rows.length; series++) for (let market = 0; market < factions.length; market++) {
    const quote = rows[series].quotes[factions[market]];
    if (!quote || quote.auctions === 0) continue; // Whole-house status and sparse-zero rule live in the batch header.
    const price = quote.minBuyout;
    assert.ok(price === null || Number.isFinite(price) && price > 0);
    assert.ok(Number.isSafeInteger(quote.buyoutUnits) && quote.buyoutUnits >= 0 && quote.buyoutUnits < 0xffff_ffff);
    records.push({ series: series * 3 + market, price, units: quote.buyoutUnits, state: price === null ? 2 : 3 });
  }
  const count = records.length, buffer = Buffer.alloc(16 + count * 17);
  buffer.write('SUM1'); buffer.writeUInt32LE(count, 4);
  for (let index = 0; index < count; index++) {
    const record = records[index];
    buffer.writeUInt32LE(record.series, 16 + index * 4);
    buffer.writeDoubleLE(record.price ?? NaN, 16 + count * 4 + index * 8);
    buffer.writeUInt32LE(record.units, 16 + count * 12 + index * 4);
    buffer.writeUInt8(record.state, 16 + count * 16 + index);
    const recovered = buffer.readDoubleLE(16 + count * 4 + index * 8);
    assert.equal(Number.isNaN(recovered) ? null : recovered, record.price);
    assert.equal(buffer.readUInt32LE(16 + count * 12 + index * 4), record.units);
  }
  return { observations: count, size: sizes(buffer), positionalJson: jsonSizes(records.map(r => [r.series, r.price, r.units, r.state])) };
}

function baseRows(snapshot, ids) {
  const selected = new Set(ids), rows = new Map(ids.map(id => [id, { id, quotes: {} }]));
  for (const source of snapshot.rows) if (selected.has(source.id)) for (const faction of factions) {
    const quote = source.quotes[faction];
    if (!quote) continue;
    let target = rows.get(source.id).quotes[faction];
    if (!target) rows.get(source.id).quotes[faction] = target = { minBuyout: null, buyoutUnits: 0, auctions: 0 };
    target.auctions += quote.auctions; target.buyoutUnits += quote.buyoutUnits;
    if (quote.minBuyout !== null) target.minBuyout = target.minBuyout === null ? quote.minBuyout : Math.min(target.minBuyout, quote.minBuyout);
  }
  return [...rows.values()];
}

const catalog = await readRecent(directory, 'catalog.json', 30 * DAY);
const snapshot = await readRecent(directory, 'snapshot.json', 30 * DAY);
if (!catalog || !snapshot) throw new Error('A current saved catalog and market snapshot are required.');
const report = { measuredAt: new Date().toISOString(), hours: HOURS, units: 'bytes (decimal GB = bytes / 1e9)',
  snapshotAt: snapshot.generatedAt, catalogItems: catalog.items.length, distinctAuctionAndCatalogIds: new Set(snapshot.rows.map(r => r.id)).size,
  itemVariants: snapshot.rows.length, houses: Object.fromEntries(Object.entries(snapshot.houses).map(([f, house]) => [f, { status: house.status, sourceTime: house.observedAt, listings: house.trackedAuctions }])) };
for (const file of ['catalog.json', 'snapshot.json']) {
  const body = await readFile(join(directory, file));
  report[file] = { ...sizes(body), diskBytes: (await stat(join(directory, file))).size };
}
const ids = [...new Set(snapshot.rows.map(row => row.id))].sort((a, b) => a - b);
report.variantDictionary = jsonSizes(snapshot.rows.map((row, index) => [index, row.id, row.variant]));
report.summaries = {
  catalogBaseItems: summaryColumns(baseRows(snapshot, catalog.items.map(item => item.id))),
  allBaseItems: summaryColumns(baseRows(snapshot, ids)),
  separateVariants: summaryColumns(snapshot.rows),
};
report.densePayload90Days = Object.fromEntries([['catalogBaseItems', catalog.items.length], ['allBaseItems', ids.length], ['separateVariants', snapshot.rows.length]]
  .map(([scope, count]) => [scope, { observations: count * 3 * HOURS, priceAndUnitsBytes: count * 3 * HOURS * 12 }]));
report.projected90Days = { currentSnapshotCopies: project(report['snapshot.json']),
  ...Object.fromEntries(Object.entries(report.summaries).map(([scope, value]) => [scope, project(value.size)])) };

if (args.includes('--live-books')) {
  const api = new BlizzardClient(await readCredentials(directory), { budget: new RequestBudget({ file: join(directory, 'request-budget.json') }) });
  try {
    const feedSizes = [], normalized = [], depth = [], itemKeys = new Map();
    let totalRawEntries = 0, bidOnly = 0;
    for (const [market, faction] of factions.entries()) {
      const houseId = US_PVP.houses[faction], unique = new Map();
      for (const ending of ['', '/commodities']) {
        const document = await api.get(`/data/wow/ruleset/1/auctions/${houseId}${ending}`, { forceBody: true });
        const body = document.data;
        assert.ok(Array.isArray(body.auctions) || body.id === houseId && typeof body.name === 'string');
        const listings = body.auctions ?? []; totalRawEntries += listings.length;
        feedSizes.push({ faction, feed: ending ? 'commodities' : 'items', listings: listings.length, ...jsonSizes(body) });
        for (const offer of listings) {
          const key = JSON.stringify([offer.item.id, offer.item.context || 0, [...(offer.item.bonus_lists ?? [])].sort((a, b) => a - b),
            [...(offer.item.modifiers ?? [])].map(m => [m.type, m.value]).sort((a, b) => a[0] - b[0] || a[1] - b[1])]);
          if (!itemKeys.has(key)) itemKeys.set(key, itemKeys.size);
          const value = { market, id: offer.id, itemKey: itemKeys.get(key), quantity: offer.quantity,
            buyout: offer.unit_price === undefined ? offer.buyout || 0 : offer.unit_price * offer.quantity,
            bid: offer.bid ?? 0, timeLeft: offer.time_left ?? '' };
          if (unique.has(offer.id)) assert.deepEqual(unique.get(offer.id), value);
          unique.set(offer.id, value);
        }
      }
      const levels = new Map();
      for (const offer of unique.values()) {
        normalized.push(offer);
        if (!offer.buyout) { bidOnly++; continue; }
        const key = `${offer.itemKey}:${offer.buyout / offer.quantity}`;
        const level = levels.get(key) ?? { market, itemKey: offer.itemKey, unitPrice: offer.buyout / offer.quantity, quantity: 0, offers: 0, cost: 0 };
        level.quantity += offer.quantity; level.offers++; level.cost += offer.buyout; levels.set(key, level);
      }
      for (const level of levels.values()) depth.push(level);
    }
    const columns = (records, fields, magic) => {
      const size = fields.reduce((sum, [type]) => sum + (type === 'u8' ? 1 : type === 'u32' ? 4 : 8), 0);
      const buffer = Buffer.alloc(16 + records.length * size); buffer.write(magic); buffer.writeUInt32LE(records.length, 4);
      let offset = 16;
      for (const [type, field] of fields) for (const record of records) {
        const value = typeof field === 'function' ? field(record) : record[field];
        if (type === 'u8') { assert.ok(Number.isInteger(value) && value >= 0 && value <= 255); buffer.writeUInt8(value, offset++); }
        else if (type === 'u32') { assert.ok(Number.isInteger(value) && value >= 0 && value < 0x1_0000_0000); buffer.writeUInt32LE(value, offset); offset += 4; }
        else { assert.ok(Number.isFinite(value)); buffer.writeDoubleLE(value, offset); assert.equal(buffer.readDoubleLE(offset), value); offset += 8; }
      }
      assert.equal(offset, buffer.length); return sizes(buffer);
    };
    const timeLabels = [...new Set(normalized.map(o => o.timeLeft))];
    const listingSize = columns(normalized, [['u8','market'],['u32','itemKey'],['f64','id'],['u32','quantity'],['f64','buyout'],['f64','bid'],['u8',o=>timeLabels.indexOf(o.timeLeft)]], 'BOOK');
    const depthSize = columns(depth, [['u8','market'],['u32','itemKey'],['f64','unitPrice'],['u32','quantity'],['u32','offers'],['f64','cost']], 'LVL1');
    const rawSize = Object.fromEntries(['bytes','gzipBytes','brotliBytes'].map(key => [key, feedSizes.reduce((sum, feed) => sum + feed[key], 0)]));
    report.books = { feeds: feedSizes, totalRawEntries, uniqueListings: normalized.length, bidOnly, anonymousPriceLevels: depth.length,
      variantDictionary: jsonSizes([...itemKeys].map(([key, id]) => [id, key])), requests: api.requests,
      rawSize, normalizedSize: listingSize, depthSize,
      projected90Days: { raw: project(rawSize), normalized: project(listingSize), anonymousPriceLevels: project(depthSize) } };
  } finally { api.dispose(); }
}
console.log(JSON.stringify(report, null, 2));
