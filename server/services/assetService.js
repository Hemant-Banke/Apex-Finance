/**
 * assetService — any priceable instrument, for its page in Markets.
 *
 * The company page (`stockService`) is built around an NSE listing's filings. Everything
 * else a user can hold or compare against — an index, gold, silver, a coin, a US share,
 * an ETF, an Indian mutual fund — has no filings, but has a PRICE HISTORY, and that is
 * enough for the half of the company page that is about the price: the quote, the day's
 * move, returns over every window against a benchmark, and the risk measures. Those are
 * computed exactly as the company page computes them (`series.windowReturns`,
 * `stockService._risk`), so a 1-year return means one thing everywhere.
 *
 * Each source answers in its own unit, and the payload says which (`unit`):
 *   - `_METAL:gold|silver` — DOMESTIC metal, ₹ per gram of 999 (spot × USDINR × premium),
 *     the same figure a physical holding is valued at.
 *   - `AMFI:<code>` — the fund's NAV, ₹.
 *   - anything else — Yahoo, in the instrument's own currency; an index is in points.
 */

const { DAY_MS } = require('../utils/constants');
const { nowMs, toDateStr } = require('../utils/helpers');
const { notFound } = require('../utils/httpError');
const { round, toSorted, windowReturns } = require('../utils/series');
const { fetchChart, closesByDay, fetchHistoricPrices } = require('./marketDataService');
const mfService = require('./mfService');
const { _risk } = require('./stockService');

const TTL_MS = 10 * 60 * 1000;
const _memo = new Map();   // symbol → { at, data }

const HISTORY_DAYS = 5 * 365 + 10;
const PERIODS = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'];

const METALS = {
  gold:   { name: 'Gold',   sub: '24K (999), domestic price per gram' },
  silver: { name: 'Silver', sub: '999, domestic price per gram' },
};

/** Yahoo's instrument type → ours. An index gets its own: it is a yardstick, not a holding. */
const YAHOO_TYPES = {
  EQUITY: 'stock', ETF: 'etf', CRYPTOCURRENCY: 'crypto', MUTUALFUND: 'mutual_fund',
  FUTURE: 'commodity', CURRENCY: 'currency', INDEX: 'index',
};

/** The yardstick an asset is measured against — the Nifty, except for the Nifty itself. */
const benchmarkFor = (symbol) => (symbol === '^NSEI'
  ? { symbol: '^BSESN', label: 'Sensex' }
  : { symbol: '^NSEI', label: 'Nifty 50' });

/** Sorted daily closes + what the instrument is, from whichever source owns it. */
async function _load(symbol) {
  const now = nowMs();
  const from = now - HISTORY_DAYS * DAY_MS;

  const metal = /^_METAL:(gold|silver)$/.exec(symbol)?.[1];
  if (metal) {
    const closes = (await fetchHistoricPrices([{ assetSymbol: symbol, assetType: metal }], from, now))[symbol] || {};
    return { series: toSorted(closes), name: METALS[metal].name, sub: METALS[metal].sub, type: metal, currency: 'INR', unit: 'g' };
  }

  if (mfService.isMfSymbol(symbol)) {
    const code = mfService.schemeCodeOf(symbol);
    const [navs, schemes] = await Promise.all([
      mfService.getNavHistory(code, from, now),
      mfService.getSchemes([code]),
    ]);
    return { series: toSorted(navs), name: schemes[code]?.name || symbol, sub: 'NAV', type: 'mutual_fund', currency: 'INR', unit: null };
  }

  const chart = await fetchChart(symbol, { range: '5y', interval: '1d' }, 12000);
  const meta = chart?.meta || {};
  const name = meta.longName || meta.shortName || symbol;
  // Yahoo files some Indian ETFs as EQUITY; the same name rule `searchYahoo` applies.
  const type = /\b(ETF|BEES)\b|AMC\s*-\s/i.test(name) ? 'etf' : (YAHOO_TYPES[meta.instrumentType] || 'other');
  return {
    series: toSorted(closesByDay(chart)),
    name,
    sub: meta.fullExchangeName || meta.exchangeName || null,
    type,
    // An index is in POINTS — Yahoo stamps the Nifty "INR", which would print it as ₹.
    currency: type === 'index' ? null : (meta.currency || null),
    unit: null,
  };
}

async function getAsset(symbol, { fresh = false } = {}) {
  const hit = _memo.get(symbol);
  if (hit && Date.now() - hit.at < (fresh ? 30 * 1000 : TTL_MS)) return hit.data;

  const bench = benchmarkFor(symbol);
  const [asset, benchChart] = await Promise.all([
    _load(symbol),
    fetchChart(bench.symbol, { range: '5y', interval: '1d' }, 12000),
  ]);
  const s = asset.series;
  if (s.length < 2) throw notFound(`No price history for ${symbol}`);

  const b = toSorted(closesByDay(benchChart));
  const aRet = windowReturns(s), bRet = windowReturns(b);
  const last = s[s.length - 1][1];

  const data = {
    symbol,
    name: asset.name,
    sub: asset.sub,
    type: asset.type,
    currency: asset.currency,
    unit: asset.unit,
    asof: toDateStr(s[s.length - 1][0]),
    benchmark: bench,

    quote: {
      price: round(last, 4),
      change: round(last - s[s.length - 2][1], 4),
      changePct: round(aRet['1d']),
    },

    // Same shape as the company page's, so the same component draws it: `stock` is this
    // asset and `nifty` is its benchmark, whichever that is.
    performance: {
      returns: Object.fromEntries(PERIODS.map(k => [k, {
        stock: round(aRet[k]), nifty: round(bRet[k]),
        stockCagr: round(aRet[`${k}Cagr`]), niftyCagr: round(bRet[`${k}Cagr`]),
      }])),
      ...(s.length > 30 && b.length > 30 ? _risk(s, b) : {}),
    },
  };

  _memo.set(symbol, { at: Date.now(), data });
  return data;
}

module.exports = { getAsset };
