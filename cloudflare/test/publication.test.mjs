import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import { HOUR, SHARDS } from '../format.mjs';
import { createClient, publish, prepare, verifyChart, parallelRange } from '../pilot.mjs';

test(
  'local SQLite objects fence publications, recover on restart, and expose only committed charts',
  { timeout: 180_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'ledger-staging-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = 'http://127.0.0.1:' + port;
    const token = randomBytes(32).toString('hex');
    let child, stopped;
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (stopped) await stopped;
    }
    t.after(stop);
    async function start() {
      const cwd = fileURLToPath(new URL('../', import.meta.url));
      child = spawn(
        process.execPath,
        [
          'node_modules/wrangler/bin/wrangler.js',
          'dev',
          '--port',
          String(port),
          '--inspector-port',
          '0',
          '--ip',
          '127.0.0.1',
          '--persist-to',
          directory,
          '--var',
          'MARKET_INGEST_TOKEN:' + token
        ],
        {
          cwd,
          env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      stopped = once(child, 'exit');
      let diagnostic = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (v) => {
          diagnostic = (diagnostic + v).slice(-5000);
        });
      for (let i = 0; i < 250; i++) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        try {
          if ((await fetch(origin + '/api/status')).ok) return;
        } catch {}
        await delay(100);
      }
      throw new Error('Local Wrangler did not start. ' + diagnostic.replaceAll(token, '[redacted]'));
    }
    await start();
    const req = createClient(origin, token);
    assert.match(await (await fetch(origin)).text(), /Synthetic staging data/);
    const chart = () => req('/api/history?item=3820&days=90');
    assert.equal((await chart()).points.length, 0);
    assert.equal((await fetch(origin + '/api/ingest/begin', { method: 'POST', body: '{}' })).status, 401);
    const day = Math.floor(Date.now() / HOUR / 24) * 24 - 24;
    const first = prepare(day, 2),
      second = prepare(day + 4, 1);
    await publish(req, first);
    const previous = await chart();
    verifyChart(previous);
    assert.equal(previous.points.length, 2);
    const begin = () => req('/api/ingest/begin', JSON.stringify(second.batch));
    const { generation } = await begin();
    assert.equal((await begin()).generation, generation);
    await assert.rejects(req('/api/ingest/begin', JSON.stringify(prepare(day + 5, 1).batch)), /409/);
    const send = (shard, block = second.blocks[shard]) =>
      req('/api/ingest/' + generation + '/' + shard, block);
    const commit = () => req('/api/ingest/' + generation + '/commit', '');
    await assert.rejects(send(0, new Uint8Array(1)), /409/);
    await parallelRange(SHARDS - 1, send);
    await assert.rejects(commit(), /409/);
    assert.deepEqual((await chart()).points, previous.points);
    await stop();
    await start();
    assert.deepEqual((await chart()).points, previous.points);
    await send(0);
    await send(SHARDS - 1);
    await commit();
    await commit();
    await assert.rejects(send(0), /409/);
    assert.equal((await begin()).committed, true);
    const result = await chart();
    verifyChart(result);
    assert.deepEqual(
      result.points.map((v) => v.hour),
      [day, day + 1, day + 4]
    );
    const bad = prepare(day + 5, 1);
    bad.blocks[0][0] = 0;
    bad.batch.digests[0] = createHash('sha256').update(bad.blocks[0]).digest('hex');
    const rejected = await req('/api/ingest/begin', JSON.stringify(bad.batch));
    await assert.rejects(req('/api/ingest/' + rejected.generation + '/0', bad.blocks[0]), /422/);
    assert.equal((await chart()).points.length, 3);
  }
);
