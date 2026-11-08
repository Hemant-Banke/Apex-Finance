const { PRICE_SNAPSHOT_MS } = require('../utils/constants');

/**
 * Per-user price snapshot. The first priced read opens one; every read in the next
 * PRICE_SNAPSHOT_MS shares its results, so all endpoints report the same figures.
 */
const snapshots = new Map();   // user → { at, entries: Map<key, Promise> }

const userKey = (userId) => String(userId);
const isFresh = (s) => s && Date.now() - s.at < PRICE_SNAPSHOT_MS;

function snapshotOf(u) {
  let s = snapshots.get(u);
  if (!isFresh(s)) { s = { at: Date.now(), entries: new Map() }; snapshots.set(u, s); }
  return s;
}

function memo(userId, key, compute) {
  const s = snapshotOf(userKey(userId));
  const hit = s.entries.get(key);
  if (hit) return hit;
  const promise = compute();
  s.entries.set(key, promise);
  // A failure is not remembered; the next caller tries again.
  promise.catch(() => { if (s.entries.get(key) === promise) s.entries.delete(key); });
  return promise;
}

// A write drops the user's results but keeps the snapshot, so the recompute reuses its quotes.
function invalidate(userId) {
  snapshots.get(userKey(userId))?.entries.clear();
}

// When the user's current snapshot opened, or null. Sent to the client as X-Price-Snapshot.
function snapshotAt(userId) {
  const s = snapshots.get(userKey(userId));
  return isFresh(s) ? s.at : null;
}

setInterval(() => {
  for (const [u, s] of snapshots) if (!isFresh(s)) snapshots.delete(u);
}, PRICE_SNAPSHOT_MS).unref();

module.exports = { memo, invalidate, snapshotAt };
