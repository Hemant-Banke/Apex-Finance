/**
 * Short-lived per-user memo for expensive reads (the marked book). One page load asks for the
 * same valuation several times at once; this computes it once and shares the promise.
 * Any write by the user bumps their version, so a stale result is never served after a change.
 */
const entries  = new Map();   // `${user}|${key}` → { at, version, promise }
const versions = new Map();   // user → number

const userKey = (userId) => String(userId);
const versionOf = (u) => versions.get(u) || 0;

function invalidate(userId) {
  const u = userKey(userId);
  versions.set(u, versionOf(u) + 1);
  for (const k of entries.keys()) if (k.startsWith(`${u}|`)) entries.delete(k);
}

function memo(userId, key, ttlMs, compute) {
  const u = userKey(userId);
  const k = `${u}|${key}`;
  const version = versionOf(u);
  const hit = entries.get(k);
  if (hit && hit.version === version && Date.now() - hit.at < ttlMs) return hit.promise;

  const promise = compute();
  const entry = { at: Date.now(), version, promise };
  entries.set(k, entry);
  // A failure is not remembered; the next caller tries again.
  promise.catch(() => { if (entries.get(k) === entry) entries.delete(k); });
  return promise;
}

// Drop expired entries now and then so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of entries) if (now - e.at > 5 * 60_000) entries.delete(k);
}, 60_000).unref();

module.exports = { memo, invalidate };
