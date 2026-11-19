import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionFreshness, STALE_AFTER_MS } from '../public/collection.mjs';

const now = Date.parse('2026-11-17T12:00:00Z');
const at = (age) => new Date(now - age).toISOString();
const snapshot = (age) => ({ mode: 'live', generatedAt: at(age), houses: {} });

test('collection becomes stale strictly after four hours, including while a page stays open', () => {
  const value = snapshot(STALE_AFTER_MS);
  assert.deepEqual(collectionFreshness(value, now), { stale: false, reason: null });
  assert.deepEqual(collectionFreshness(value, now + 1), { stale: true, reason: 'collection' });
});

test('a recent collection cannot hide old source prices, including an older component document', () => {
  const value = snapshot(60_000);
  value.houses.alliance = { status: 'ok', observedAt: at(STALE_AFTER_MS + 1) };
  assert.deepEqual(collectionFreshness(value, now), { stale: true, reason: 'source' });
  value.houses.alliance.observedAt = at(60_000);
  value.houses.alliance.documents = [{ observedAt: at(STALE_AFTER_MS + 1) }];
  assert.deepEqual(collectionFreshness(value, now), { stale: true, reason: 'source' });
  value.houses.alliance.documents = [{ observedAt: at(60_000) }];
  assert.deepEqual(collectionFreshness(value, now), { stale: false, reason: null });
});

test('no collection, unknown timestamps and preview data do not invent an old collection', () => {
  assert.equal(collectionFreshness(null, now).stale, false);
  assert.equal(collectionFreshness({ mode: 'live', generatedAt: 'unknown', houses: { horde: { status: 'ok', observedAt: null } } }, now).stale, false);
  assert.equal(collectionFreshness({ ...snapshot(STALE_AFTER_MS + 1), mode: 'demo' }, now).stale, false);
});
