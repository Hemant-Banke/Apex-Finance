/**
 * priceCacheService — daily closes per Yahoo symbol, kept in Mongo (`PriceHistory`).
 *
 * A request inside the cached range never touches the network; only missing days are
 * fetched. A failed fetch never advances coverage, so the last real close is always
 * what gets served. Today's bar is never stored — it is not a close until the day ends.
 *
 * The fetcher is passed in (`fetchRange(symbol, assetType, startMs, endMs)` → `{ closes,
 * currency }`, or null on failure) so this module does not require marketDataService back.
 */

const PriceHistory = require('../models/PriceHistory');
const { DAY_MS } = require('../utils/constants');
const { todayMs } = require('../utils/helpers');

// Re-fetch a few settled days on every top-up, to pick up late or revised closes.
const OVERLAP_MS = 3 * DAY_MS;
// A symbol's first fetch takes this much history, so later windows are cache hits.
const FIRST_FETCH_MS = 5 * 365 * DAY_MS;
const REFRESH_CONCURRENCY = 5;

// One fetch per symbol at a time: a second caller waits and then finds the cache warm.
const locks = new Map();
function withLock(symbol, fn) {
  const prev = locks.get(symbol) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(symbol, next);
  next.finally(() => { if (locks.get(symbol) === next) locks.delete(symbol); }).catch(() => {});
  return next;
}

/** The day ranges a request needs that the cache does not yet cover. */
function gapsFor(doc, startMs, endMs, today) {
  if (endMs < startMs) return [];
  if (doc?.from == null || doc?.to == null) return [[Math.min(startMs, today - FIRST_FETCH_MS), endMs]];
  const gaps = [];
  if (startMs < doc.from) gaps.push([startMs, doc.from - DAY_MS]);
  if (endMs > doc.to) gaps.push([Math.max(doc.from, doc.to - OVERLAP_MS), endMs]);
  return gaps;
}

async function fill(symbol, assetType, startMs, endMs, fetchRange) {
  const today = todayMs();
  const settledEnd = Math.min(endMs, today - DAY_MS);
  const doc = await PriceHistory.findOne({ symbol }).lean();

  let { from, to, currency } = doc || {};
  const closes = { ...(doc?.closes || {}) };
  let changed = false;

  for (const [a, b] of gapsFor(doc, startMs, settledEnd, today)) {
    const got = await fetchRange(symbol, assetType, a, b);
    if (!got) continue;   // failed: leave coverage alone, serve what we have
    for (const [day, close] of Object.entries(got.closes)) if (Number(day) < today) closes[day] = close;
    if (got.currency) currency = got.currency;
    from = from == null ? a : Math.min(from, a);
    to   = to   == null ? b : Math.max(to, b);
    changed = true;
  }

  if (changed) {
    await PriceHistory.updateOne(
      { symbol },
      { $set: { closes, from, to, currency, assetType, fetchedAt: new Date() } },
      { upsert: true },
    );
  }
  return closes;
}

/**
 * Daily closes for one symbol over [startMs, endMs], as { [dayMs]: close }. Served from
 * the cache, topped up from `fetchRange` only where the cache has a gap.
 */
async function getCloses(symbol, assetType, startMs, endMs, fetchRange) {
  const closes = await withLock(symbol, () => fill(symbol, assetType, startMs, endMs, fetchRange));
  const out = {};
  for (const [k, v] of Object.entries(closes)) {
    const day = Number(k);
    if (day >= startMs && day <= endMs) out[day] = v;
  }
  return out;
}

/** Tops up every cached symbol to the last settled day; run on a timer, off the request path. */
async function refreshAll(fetchRange) {
  const lastSettled = todayMs() - DAY_MS;
  const docs = await PriceHistory.find({ $or: [{ to: { $lt: lastSettled } }, { to: null }] })
    .select('symbol assetType').lean();

  let i = 0, refreshed = 0;
  const worker = async () => {
    while (i < docs.length) {
      const { symbol, assetType } = docs[i++];
      await withLock(symbol, () => fill(symbol, assetType, lastSettled, lastSettled, fetchRange))
        .then(() => { refreshed++; })
        .catch(e => console.error(`[priceCache] ${symbol}:`, e.message));
    }
  };
  await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
  return { symbols: docs.length, refreshed };
}

/** The symbol's quote currency as Yahoo last reported it, or null if never fetched. */
async function getCurrency(symbol) {
  return (await PriceHistory.findOne({ symbol }).select('currency').lean())?.currency || null;
}

module.exports = { getCloses, getCurrency, refreshAll };
