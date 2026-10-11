const CurrentPrice = require('../models/CurrentPrice');
const { YF_HEADERS } = require('../utils/constants');
const { todayMs, toDateStr } = require('../utils/helpers');

/**
 * Live quotes, cached in Mongo (`currentprices`) so every request, page and server restart
 * reads the same number, and Yahoo is asked at most once a minute per symbol.
 *
 * getQuotes(symbols) → { [symbol]: { price, previousClose, fetchedAt, stale } }, NATIVE currency.
 *   - fresh (under LIVE_TTL_MS, fetched today): served from the cache, no network.
 *   - otherwise: one batched spark fetch for the lot; on failure, today's last cached quote
 *     is served marked `stale` — a quote from minutes ago is still a market price.
 *   - a symbol with no quote today is simply absent; the caller falls back to the close.
 * Concurrent requests for the same symbol share one fetch.
 */

const LIVE_TTL_MS = 60 * 1000;
const SPARK_MAX = 20;   // spark 400s the whole request above this many symbols

const inflight = new Map();   // symbol → Promise of that symbol's fetch

const lastNonNull = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };

async function fetchSpark(symbols) {
  const batches = [];
  for (let i = 0; i < symbols.length; i += SPARK_MAX) batches.push(symbols.slice(i, i + SPARK_MAX));
  const parts = await Promise.all(batches.map(async (batch) => {
    const url = 'https://query1.finance.yahoo.com/v8/finance/spark'
      + `?symbols=${encodeURIComponent(batch.join(','))}&range=1d&interval=1d`;
    try {
      const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
      return resp.ok ? await resp.json() : null;
    } catch { return null; }
  }));
  const data = Object.assign({}, ...parts.filter(Boolean));
  const out = {};
  for (const sym of symbols) {
    const price = lastNonNull(data?.[sym]?.close || []);
    if (price == null) continue;
    const prev = data[sym].chartPreviousClose ?? data[sym].previousClose ?? null;
    out[sym] = { price, previousClose: prev };
  }
  return out;
}

/** Fetch and store quotes for `symbols`; resolves to whatever came back. */
async function refresh(symbols, day) {
  const got = await fetchSpark(symbols);
  const now = new Date();
  const ops = Object.entries(got).map(([symbol, q]) => ({
    updateOne: {
      filter: { symbol },
      update: { $set: { price: q.price, previousClose: q.previousClose, day, fetchedAt: now } },
      upsert: true,
    },
  }));
  if (ops.length) await CurrentPrice.bulkWrite(ops, { ordered: false }).catch(e => console.error('currentprices write failed:', e.message));
  return Object.fromEntries(Object.entries(got).map(([s, q]) => [s, { ...q, fetchedAt: now, stale: false }]));
}

async function getQuotes(symbols) {
  const unique = [...new Set(symbols.filter(Boolean))];
  if (!unique.length) return {};
  const day = toDateStr(todayMs());
  const docs = await CurrentPrice.find({ symbol: { $in: unique } }).lean();
  const cached = Object.fromEntries(docs.filter(d => d.day === day).map(d => [d.symbol, d]));

  const out = {};
  const due = [];
  for (const sym of unique) {
    const hit = cached[sym];
    if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < LIVE_TTL_MS) {
      out[sym] = { price: hit.price, previousClose: hit.previousClose ?? null, fetchedAt: hit.fetchedAt, stale: false };
    } else due.push(sym);
  }
  if (!due.length) return out;

  // Join a fetch already under way for a symbol; start one batch for the rest.
  const waiting = due.filter(s => inflight.has(s));
  const fresh = due.filter(s => !inflight.has(s));
  if (fresh.length) {
    const p = refresh(fresh, day).finally(() => fresh.forEach(s => inflight.delete(s)));
    fresh.forEach(s => inflight.set(s, p));
  }
  const results = await Promise.all([...new Set(due.map(s => inflight.get(s)).filter(Boolean))]).catch(() => []);
  const got = Object.assign({}, ...results);
  for (const sym of [...fresh, ...waiting]) {
    if (got[sym]) out[sym] = got[sym];
    else if (cached[sym]) out[sym] = { price: cached[sym].price, previousClose: cached[sym].previousClose ?? null, fetchedAt: cached[sym].fetchedAt, stale: true };
  }
  return out;
}

module.exports = { getQuotes, LIVE_TTL_MS };
