import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('Pages loads the same browser entry files as localhost', async (t) => {
  const artifact = await mkdtemp(join(tmpdir(), 'ledger-pages-'));
  t.after(() => rm(artifact, { recursive: true, force: true }));
  const source = new URL('../', import.meta.url);
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('tools/build-pages.mjs', source)), artifact]);
  const local = await readFile(new URL('public/index.html', source), 'utf8');
  const hosted = await readFile(join(artifact, 'index.html'), 'utf8');
  const entryFiles = (html) => Array.from(html.matchAll(/(?:href|src)="(\.\/[^"]+\.(?:css|mjs))"/g), ([, file]) => file);
  const files = entryFiles(local);
  assert.ok(files.includes('./public/market-table.css'));
  assert.deepEqual(entryFiles(hosted), files);
  for (const file of files) {
    assert.deepEqual(await readFile(join(artifact, file)), await readFile(new URL(file, source)));
  }
  assert.doesNotMatch(hosted, /id="credentials-form"/);
});
