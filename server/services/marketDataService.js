/**
 * marketDataService — all Yahoo Finance fetching.
 *
 * fetchHistoricPrices: one HTTP request per symbol, all in parallel.
 * fetchLatestPrices:   single batch request via /v7/finance/quote.
 * buildDensePriceArray: fills weekends/holidays via carry-forward.
 *
 * Crypto date rule: midnight IST = UTC 18:30 of the previous UTC day,
 * so we shift the query date back by 5h30m before calling Yahoo.
 */

const { DAY_MS, IST_OFFSET_MS, YF_HEADERS } = require('../utils/constants');

function _adjustDate(date, assetType) {
  return assetType === 'crypto' ? date - IST_OFFSET_MS : date;
}

/** Fetch daily close prices for one symbol. Returns { [dayMs]: price }. */
async function _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs) {
  try {
    const from = _adjustDate(startMs, assetType);
    const to   = _adjustDate(endMs,   assetType);

    const period1 = Math.floor(from         / 1000);
    const period2 = Math.floor(to + DAY_MS  / 1000); // +1 day buffer

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(assetSymbol)}`
              + `?period1=${period1}&period2=${period2}&interval=1d`;

    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return {};

    const data   = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return {};

    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];

    let raw = {};
    timestamps.map((T, i) => raw[T] = closes[i] || null);
    return raw;
  } catch {
    return {};
  }
}

/**
 * Build a dense daily price array from startMs to endMs (both inclusive),
 * carrying the last known price forward for non-trading days.
 * Entries before the first known price are null.
 *
 * @param {Object} rawMap  { [YYYY-MM-DD]: price }
 * @param {number} fromMs  UTC-midnight ms, inclusive
 * @param {number} toMs    UTC-midnight ms, inclusive
 * @returns {(number|null)[]}
 */
function buildDensePriceArray(rawMap, fromMs, toMs) {
  const numDays = Math.round((toMs - fromMs) / DAY_MS) + 1;
  const out     = new Array(numDays).fill(null);
  let last = null;
  for (let i = 0; i < numDays; i++) {
    const key = new Date(fromMs + i * DAY_MS).toISOString().split('T')[0];
    if (rawMap[key] != null) last = rawMap[key];
    out[i] = last;
  }
  return out;
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

/**
 * Fetch live prices for multiple symbols in a single Yahoo Finance request.
 *
 * @param {Array<{assetSymbol: string, assetType: string}>} holdings
 * @returns {Promise<Object.<string, number>>}  { [symbol]: price }
 */
async function fetchLatestPrices(holdings) {
  if (!holdings.length) return {};
  try {
    const syms = holdings.map(i => i.assetSymbol).join(',');
    const url  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}`;
    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return {};

    const data   = await resp.json();
    const quotes = data?.quoteResponse?.result || [];
    const out    = {};
    for (const q of quotes) {
      if (q.symbol && q.regularMarketPrice != null) out[q.symbol] = q.regularMarketPrice;
    }
    return out;
  } catch {
    return {};
  }
}

module.exports = { 
  fetchHistoricPrices, 
  fetchLatestPrices, 
  buildDensePriceArray 
};
