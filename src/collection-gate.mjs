import { readJson, writeJson } from './store.mjs';
import { BudgetError, withFileLock } from './request-budget.mjs';

export const MIN_COLLECTION_DELAY = 5 * 60_000;
const MAX_COLLECTION_DELAY = 15 * 60_000;

export class CollectionGate {
  constructor(file, { now = () => Date.now() } = {}) { this.file = file; this.now = now; }
  async status() { return readJson(this.file, { nextEligibleAt: 0, lastCheckedAt: null, unchangedChecks: 0, outcome: null }); }
  async begin() {
    return withFileLock(this.file, async () => {
      const state = await this.status();
      if (state.nextEligibleAt > this.now()) throw new BudgetError('Auction collection is cooling down.', state.nextEligibleAt);
      await writeJson(this.file, { ...state, nextEligibleAt: this.now() + MIN_COLLECTION_DELAY });
    }, this.now);
  }
  async finish(outcome) {
    return withFileLock(this.file, async () => {
      const state = await this.status();
      const unchangedChecks = outcome === 'unchanged' ? (state.unchangedChecks ?? 0) + 1 : 0;
      const delay = Math.min(MAX_COLLECTION_DELAY, MIN_COLLECTION_DELAY * (1 + unchangedChecks));
      await writeJson(this.file, { nextEligibleAt: this.now() + delay, lastCheckedAt: new Date(this.now()).toISOString(), unchangedChecks, outcome });
    }, this.now);
  }
}
