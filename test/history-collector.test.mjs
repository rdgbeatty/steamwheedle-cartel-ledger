import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { collectBook, splitBook } from '../src/history-collector.mjs';

const now = new Date().toISOString();
const auction = { id: 17, item: { id: 3820 }, quantity: 4, buyout: 11 };
const makeDoc = (auctions) => ({
  data: { id: 116, auctions },
  retainedAt: now,
  observedAt: now,
  lastModified: now,
  etag: 'demo'
});
test('historical depth deduplicates overlapping feeds, preserves fractional stack prices and excludes IDs', async () => {
  const docs = [makeDoc([auction, { ...auction, id: 18, buyout: 0 }]), makeDoc([auction])];
  const book = await collectBook({ get: async () => docs.shift() }, 116);
  assert.deepEqual(book.records, [[3820, '', 8, 1, [[2.75, 4, 1, 11]]]]);
  const block = splitBook(book.records)[3820 % 32],
    length = block.readUInt32LE();
  assert.deepEqual(JSON.parse(inflateSync(block.subarray(4, 4 + length))), [[3820, '', 2.75, 4]]);
  assert.deepEqual(JSON.parse(inflateSync(block.subarray(4 + length))), [[8, 1, [[2.75, 4, 1, 11]]]]);
});
test('an unchanged pair uses the previous publication and updated cache lifetime', async () => {
  const docs = [makeDoc([]), makeDoc([])].map((d) => ({
    ...d,
    data: null,
    notModified: true,
    freshUntil: Date.now() + 10000
  }));
  const book = await collectBook({ get: async () => docs.shift() }, 116, { documents: [{}, {}] });
  assert.equal(book.unchanged, true);
  assert.equal(book.documents.length, 2);
  assert.ok(book.documents.every((d) => d.freshUntil > Date.now() && !('data' in d)));
});
