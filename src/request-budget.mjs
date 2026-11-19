import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { historyService } from './history-service.mjs';
import { readJson, writeJson } from './store.mjs';

const HOUR = 3_600_000;
export const LOCAL_HOURLY_LIMIT = 600;
export class BudgetError extends Error {
  constructor(message, retryAt) { super(message); this.name = 'BudgetError'; this.status = 429; this.retryAt = retryAt; }
}

export async function withFileLock(file, operation, now = () => Date.now()) {
  if (!file) return operation();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      handle = await open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(await readFile(lock, 'utf8'));
        const old = Date.now() - (await stat(lock)).mtimeMs > 30_000;
        if (old && Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (failure) { if (failure.code === 'ESRCH') { await unlink(lock); continue; } }
        }
      } catch (failure) { if (failure.code === 'ENOENT') continue; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new BudgetError('Local request controls are busy. Try again shortly.', now() + 1000);
  try { return await operation(); }
  finally { await handle.close(); await unlink(lock).catch(() => {}); }
}

// One file is shared by the server and CLI. It holds local request timestamps,
// not credentials, URLs, response bodies or auction observations.
export class RequestBudget {
  constructor({ file = null, limit = LOCAL_HOURLY_LIMIT, now = () => Date.now() } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 36_000) throw new Error('Request budget must be between 1 and 36,000 per hour.');
    this.file = file; this.limit = limit; this.now = now;
    this.state = { requests: [], blockedUntil: 0 }; this.queue = Promise.resolve();
  }

  async locked(operation) {
    const run = () => withFileLock(this.file, operation, this.now);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async read() {
    const state = this.file ? await readJson(this.file, { requests: [], blockedUntil: 0 }) : this.state;
    if (!Array.isArray(state.requests) || !state.requests.every(Number.isFinite) || !Number.isFinite(state.blockedUntil)) throw new Error('The request-budget file is invalid.');
    return { requests: state.requests.filter((time) => time > this.now() - HOUR).sort((a, b) => a - b), blockedUntil: state.blockedUntil };
  }

  async write(state) { if (this.file) await writeJson(this.file, state); else this.state = state; }

  describe(state) {
    return { limit: this.limit, used: state.requests.length, remaining: Math.max(0, this.limit - state.requests.length),
      retryAt: Math.max(state.blockedUntil, state.requests.length >= this.limit ? state.requests[state.requests.length - this.limit] + HOUR : 0) };
  }

  async status() { return this.describe(await this.read()); }

  async remote() {
    if (!this.file) return null;
    const settings = await readJson(join(dirname(this.file), 'private', 'history-service.json'));
    return settings ? historyService(settings) : null;
  }

  async take() {
    await this.locked(async () => {
      const state = await this.read(), info = this.describe(state);
      if (info.retryAt > this.now()) throw new BudgetError(state.blockedUntil > this.now()
        ? 'Blizzard asked us to wait before making more requests.' : 'The local hourly request budget is exhausted.', info.retryAt);
      state.requests.push(this.now()); await this.write(state);
    });
    const service = await this.remote();
    if (service) {
      const { accepted, retryAt } = await service('take');
      if (!accepted) throw new BudgetError('The shared Blizzard budget is cooling down.', retryAt);
    }
  }

  async defer(until) {
    if (!Number.isFinite(until) || until <= this.now()) return;
    await this.locked(async () => { const state = await this.read(); state.blockedUntil = Math.max(state.blockedUntil, until); await this.write(state); });
    const service = await this.remote();
    if (service) await service('defer', { until });
  }
}
