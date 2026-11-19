import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestBudget, BudgetError } from '../src/request-budget.mjs';
import { CollectionGate, MIN_COLLECTION_DELAY } from '../src/collection-gate.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'forever-budget-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('shared file budget serializes readers and survives client/server restarts', async (t) => {
  const file = join(await directory(t), 'requests.json');
  let clock = Date.now();
  const a = new RequestBudget({ file, limit: 3, now: () => clock }), b = new RequestBudget({ file, limit: 3, now: () => clock });
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => (index % 2 ? a : b).take()));
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 3);
  assert.ok(attempts.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof BudgetError));
  const restarted = new RequestBudget({ file, limit: 3, now: () => clock });
  assert.equal((await restarted.status()).remaining, 0);
  clock += 3_600_000;
  await restarted.take();
  assert.equal((await restarted.status()).used, 1);
  const stored = await readFile(file, 'utf8');
  assert.ok(!stored.includes('secret')); assert.ok(!stored.includes('https://'));
});

test('Retry-After is shared and persisted; limits cannot exceed the Blizzard maximum', async (t) => {
  const file = join(await directory(t), 'requests.json');
  let clock = Date.now();
  const a = new RequestBudget({ file, now: () => clock });
  assert.equal((await a.status()).limit, 600);
  await a.defer(clock + 120_000);
  const b = new RequestBudget({ file, now: () => clock });
  await assert.rejects(b.take(), (error) => error.status === 429 && error.retryAt === clock + 120_000);
  clock += 120_000; await b.take();
  assert.equal((await b.status()).used, 1);
  assert.throws(() => new RequestBudget({ limit: 36_001 }), /36,000/);
});

test('collection gate persists the floor, backs off to 15 minutes and resets on new data', async (t) => {
  const file = join(await directory(t), 'collection.json');
  let clock = Date.now();
  let gate = new CollectionGate(file, { now: () => clock });
  await gate.begin();
  await assert.rejects(gate.begin(), BudgetError);
  gate = new CollectionGate(file, { now: () => clock });
  await assert.rejects(gate.begin(), BudgetError);
  await gate.finish('updated');
  assert.equal((await gate.status()).nextEligibleAt, clock + MIN_COLLECTION_DELAY);
  clock += MIN_COLLECTION_DELAY;
  await gate.begin(); await gate.finish('unchanged');
  assert.equal((await gate.status()).nextEligibleAt, clock + 10 * 60_000);
  clock += 10 * 60_000;
  await gate.begin(); await gate.finish('unchanged');
  assert.equal((await gate.status()).nextEligibleAt, clock + 15 * 60_000);
  clock += 15 * 60_000;
  await gate.begin(); await gate.finish('unchanged');
  assert.equal((await gate.status()).nextEligibleAt, clock + 15 * 60_000);
  clock += 15 * 60_000;
  await gate.begin(); await gate.finish('updated');
  assert.equal((await gate.status()).nextEligibleAt, clock + MIN_COLLECTION_DELAY);
});

test('two server instances cannot reserve the same collection slot simultaneously', async (t) => {
  const file = join(await directory(t), 'collection.json');
  const a = new CollectionGate(file), b = new CollectionGate(file);
  const results = await Promise.allSettled([a.begin(), b.begin()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 429).length, 1);
});
