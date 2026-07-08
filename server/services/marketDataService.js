/**
 * marketDataService — all Yahoo Finance fetching.
 *
 * fetchHistoricPrices: one HTTP request per symbol, all in parallel.
 * fetchLatestPrices:   single batch request via the v8 spark endpoint.
 *
 * Crypto date rule: midnight IST = UTC 18:30 of the previous UTC day,
 * so we shift the query date back by 5h30m before calling Yahoo.
 */

const { DAY_MS, IST_OFFSET_MS, YF_HEADERS } = require('../utils/constants');
const { midnight_from_ms } = require('../utils/helpers');

function _adjustDateForYF(date, assetType) {
  return assetType === 'crypto' ? date - IST_OFFSET_MS : date;
}

function _revertDateFromYF(T, assetType){
  return midnight_from_ms(T * 1000 + (assetType === 'crypto' ? IST_OFFSET_MS : 0));
}

/**
 * Fetch daily close prices for one symbol.
 * Returns { [dayMs]: price } keyed by UTC-midnight ms so the values align with
 * the day indices used by buildAssetTS.
 */
async function _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs) {
  try {
    const from = _adjustDateForYF(startMs, assetType);
    const to   = _adjustDateForYF(endMs,   assetType);

    const period1 = Math.floor(from / 1000);
    const period2 = Math.floor((to + DAY_MS) / 1000); // +1 day buffer

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(assetSymbol)}`
              + `?period1=${period1}&period2=${period2}&interval=1d`;

    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return {};

    const data   = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return {};

    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];

    // Key each close by the UTC-midnight ms of its calendar day. For crypto, the
    // IST offset is added back so the shifted query maps onto the right day.
    const raw = {};
    timestamps.forEach((T, i) => {
      if (closes[i] == null) return;
      raw[_revertDateFromYF(T)] = Math.round(closes[i] * 100)/100;
    });
    return raw;
  } catch {
    return {};
  }
}

/**
 * Fetch historic daily prices for multiple symbols in parallel (one request per symbol).
 *
 * @param {Array<{assetSymbol: string, assetType: string}>} holdings
 * @param {number} startMs
 * @param {number} endMs
 * @returns {Promise<Object.<string, Object.<number, number>>>}  { [symbol]: { [dayMs]: price } }
 */
async function fetchHistoricPrices(holdings, startMs, endMs) {
  if (!holdings.length) return {};
  const results = await Promise.all(
    holdings.map(({ assetSymbol, assetType }) => _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs))
  );
  return Object.fromEntries(holdings.map(({ assetSymbol }, i) => [assetSymbol, results[i]]));
}

/** Last non-null value of an array, or null. */
function _lastNonNull(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

/**
 * Fetch live prices for all symbols in a SINGLE request via the v8 spark
 * endpoint (the v7 /quote batch endpoint is gated without a session crumb).
 * The spark response is a top-level object keyed by symbol, each with a `close`
 * array whose last non-null entry is the current price.
 *
 * Symbols with no data are simply omitted (caller decides the fallback).
 *
 * @param {Array<{assetSymbol: string, assetType: string}>} holdings
 * @returns {Promise<Object.<string, number>>}  { [symbol]: price }
 */
async function fetchLatestPrices(holdings) {
  if (!holdings.length) return {};
  try {
    const symbols = [...new Set(holdings.map(h => h.assetSymbol))];
    const url = `https://query1.finance.yahoo.com/v8/finance/spark`
              + `?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1d`;

    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return {};
    const data = await resp.json();

    const out = {};
    for (const sym of symbols) {
      const price = _lastNonNull(data?.[sym]?.close || []);
      if (price != null) out[sym] = Math.round(price * 100)/100;
    }
    return out;
  } catch {
    return {};
  }
}

module.exports = { 
  fetchHistoricPrices, 
  fetchLatestPrices,
};
