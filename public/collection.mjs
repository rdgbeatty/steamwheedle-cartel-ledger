export const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export function collectionCooldown(collection, now = Date.now()) {
  const remaining = Math.max(0, (collection?.nextEligibleAt ?? 0) - now);
  const seconds = Math.ceil(remaining / 1000);
  return { blocked: seconds > 0, label: seconds > 0 ? `Check again in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Collect now ↻' };
}

// Collection time and source time are independent: fetching cached prices is not new data.
export function collectionFreshness(snapshot, now = Date.now()) {
  if (!snapshot || snapshot.mode === 'demo') return { stale: false, reason: null };
  const generated = Date.parse(snapshot.generatedAt);
  if (Number.isFinite(generated) && now - generated > STALE_AFTER_MS) return { stale: true, reason: 'collection' };
  const sourceTimes = Object.values(snapshot.houses ?? {}).filter((house) => house.status === 'ok')
    .flatMap((house) => [house.observedAt, ...(house.documents ?? []).map((document) => document.observedAt)])
    .map((time) => Date.parse(time)).filter(Number.isFinite);
  if (sourceTimes.some((time) => now - time > STALE_AFTER_MS)) return { stale: true, reason: 'source' };
  return { stale: false, reason: null };
}
