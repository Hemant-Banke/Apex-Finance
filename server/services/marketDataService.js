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
const { midnight_from_ms, todayMs, toDateStr_from_ms } = require('../utils/helpers');
const {
  METAL_SPOT_SYMBOLS, FX_SYMBOL, isPurityAsset, metalInrPerGram, purityFactor,
} = require('../utils/assetPricing');
const {
  isBaseCurrency, fxSymbol, normalizeCurrency, distinctCurrencies,
} = require('../utils/currency');
const mfService = require('./mfService');

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
 * Physical metal holdings carry an arbitrary user-chosen symbol ("WEDDING-GOLD"),
 * so their price comes from the metal's spot future + USD/INR rather than from
 * the symbol itself. Returns the distinct spot symbols such holdings need.
 */
function _metalSpotsNeeded(holdings) {
  const spots = new Set();
  for (const h of holdings) {
    if (isPurityAsset(h.assetType)) {
      const spot = METAL_SPOT_SYMBOLS[h.assetType];
      if (spot) spots.add(spot);
    }
  }
  return [...spots];
}

/**
 * Carry-forward lookup over a daily rate series: the rate on a given day, or the
 * last one quoted before it. Currency and metal markets close on different days,
 * so an asset's trading day must never be dropped for want of a same-day rate.
 * Days before the series begins fall back to its earliest rate.
 */
function _rateLookup(rateMap) {
  const days = Object.keys(rateMap).map(Number).sort((a, b) => a - b);
  if (!days.length) return () => null;

  let idx = 0;
  let last = null;
  return (day) => {
    while (idx < days.length && days[idx] <= day) last = rateMap[days[idx++]];
    return last ?? rateMap[days[0]];
  };
}

const _round2 = (n) => Math.round(n * 100) / 100;

/** USD/troy-oz spot series → INR/gram series for pure (999) metal. */
function _perGramSeries(spotMap, fxMap, assetType) {
  const rateAt = _rateLookup(fxMap);
  const out = {};
  for (const day of Object.keys(spotMap).map(Number).sort((a, b) => a - b)) {
    const perGram = metalInrPerGram(spotMap[day], rateAt(day), assetType);
    if (perGram != null) out[day] = _round2(perGram);
  }
  return out;
}

/** Native-currency price series → INR, day by day. */
function _toInrSeries(nativeMap, fxMap) {
  const rateAt = _rateLookup(fxMap);
  const out = {};
  for (const day of Object.keys(nativeMap).map(Number).sort((a, b) => a - b)) {
    const fx = rateAt(day);
    if (fx != null) out[day] = _round2(nativeMap[day] * fx);
  }
  return out;
}

/**
 * Fetch historic daily prices for multiple symbols in parallel (one request per symbol).
 *
 * **Every returned price is in INR.** Foreign-quoted assets (US stocks, USD crypto)
 * are converted with the day-matched FX rate, and physical gold/silver resolve to
 * INR per gram of PURE metal — the caller scales that by each holding's purity.
 *
 * @param {Array<{assetSymbol: string, assetType: string, currency?: string}>} holdings
 * @param {number} startMs
 * @param {number} endMs
 * @returns {Promise<Object.<string, Object.<number, number>>>}  { [symbol]: { [dayMs]: inrPrice } }
 */
async function fetchHistoricPrices(holdings, startMs, endMs) {
  if (!holdings.length) return {};

  // Indian mutual funds are AMFI schemes — their NAVs come from mfService, never
  // from Yahoo (which cannot even tell one plan of a fund from another).
  const mfHoldings = holdings.filter(h => mfService.isMfSymbol(h.assetSymbol));
  const rest       = holdings.filter(h => !mfService.isMfSymbol(h.assetSymbol));

  const mfSeries = {};
  await Promise.all(mfHoldings.map(async (h) => {
    const code = mfService.schemeCodeOf(h.assetSymbol);
    mfSeries[h.assetSymbol] = await mfService.getNavHistory(code, startMs, endMs);
  }));

  if (!rest.length) return mfSeries;
  holdings = rest;

  const metalSpots = _metalSpotsNeeded(holdings);
  const listed     = holdings.filter(h => !isPurityAsset(h.assetType));

  // FX series needed: one per foreign currency, plus USD/INR for any metal.
  // The metal's rate is the same USDINR=X series, so the Set dedupes it.
  const fxSymbols = new Set(distinctCurrencies(listed).map(fxSymbol));
  if (metalSpots.length) fxSymbols.add(FX_SYMBOL);

  const extras = [...metalSpots, ...fxSymbols];

  const [listedMaps, extraMaps] = await Promise.all([
    Promise.all(listed.map(({ assetSymbol, assetType }) =>
      _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs))),
    Promise.all(extras.map(sym => _fetchHistoricForSymbol(sym, 'stock', startMs, endMs))),
  ]);

  const extraBySymbol = Object.fromEntries(extras.map((sym, i) => [sym, extraMaps[i]]));
  const out = {};

  // Listed assets: convert to INR when quoted in a foreign currency.
  listed.forEach((h, i) => {
    const currency = normalizeCurrency(h.currency);
    out[h.assetSymbol] = currency
      ? _toInrSeries(listedMaps[i], extraBySymbol[fxSymbol(currency)] || {})
      : listedMaps[i];
  });

  // Physical metal: priced by type, keyed back under each holding's own symbol.
  if (metalSpots.length) {
    const fxMap         = extraBySymbol[FX_SYMBOL] || {};
    const perGramByType = {};
    for (const h of holdings) {
      if (!isPurityAsset(h.assetType)) continue;
      const type = h.assetType;
      if (!perGramByType[type]) {
        perGramByType[type] = _perGramSeries(extraBySymbol[METAL_SPOT_SYMBOLS[type]] || {}, fxMap, type);
      }
      out[h.assetSymbol] = perGramByType[type];
    }
  }

  return { ...mfSeries, ...out };
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

  // Indian mutual funds: latest NAV from AMFI (via mfService), never Yahoo.
  const mfHoldings = holdings.filter(h => mfService.isMfSymbol(h.assetSymbol));
  const mfPrices   = {};
  if (mfHoldings.length) {
    const codes = mfHoldings.map(h => mfService.schemeCodeOf(h.assetSymbol));
    const navs  = await mfService.getLatestNavs(codes);
    for (const h of mfHoldings) {
      const nav = navs[mfService.schemeCodeOf(h.assetSymbol)];
      if (nav != null) mfPrices[h.assetSymbol] = nav;
    }
  }

  holdings = holdings.filter(h => !mfService.isMfSymbol(h.assetSymbol));
  if (!holdings.length) return mfPrices;

  try {
    const metalSpots  = _metalSpotsNeeded(holdings);
    const listedItems = holdings.filter(h => !isPurityAsset(h.assetType));
    const listed      = [...new Set(listedItems.map(h => h.assetSymbol))];

    const fxSymbols = new Set(distinctCurrencies(listedItems).map(fxSymbol));
    if (metalSpots.length) fxSymbols.add(FX_SYMBOL);

    const extras  = [...metalSpots, ...fxSymbols];
    const symbols = [...listed, ...extras];
    // Every exit keeps the fund NAVs already resolved — a Yahoo failure must not
    // drop prices that came from a different source entirely.
    if (!symbols.length) return mfPrices;

    const url = `https://query1.finance.yahoo.com/v8/finance/spark`
              + `?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1d`;

    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return mfPrices;
    const data = await resp.json();

    const quote = (sym) => {
      const price = _lastNonNull(data?.[sym]?.close || []);
      return price != null ? Math.round(price * 100) / 100 : null;
    };

    // Listed assets, converted to INR when quoted in a foreign currency. A
    // foreign holding whose FX rate is missing is omitted rather than passed
    // through at its native value — the caller must not read USD as INR.
    const out = {};
    for (const h of listedItems) {
      const price = quote(h.assetSymbol);
      if (price == null) continue;
      const currency = normalizeCurrency(h.currency);
      if (!currency) { out[h.assetSymbol] = price; continue; }
      const fx = quote(fxSymbol(currency));
      if (fx != null) out[h.assetSymbol] = _round2(price * fx);
    }

    // Metals: INR per gram of PURE metal, keyed by each holding's own symbol.
    // The caller scales this by the holding's purity.
    if (metalSpots.length) {
      const usdInr = quote(FX_SYMBOL);
      for (const h of holdings) {
        if (!isPurityAsset(h.assetType)) continue;
        const perGram = metalInrPerGram(quote(METAL_SPOT_SYMBOLS[h.assetType]), usdInr, h.assetType);
        if (perGram != null) out[h.assetSymbol] = _round2(perGram);
      }
    }

    return { ...mfPrices, ...out };
  } catch {
    return mfPrices;
  }
}

/**
 * INR-per-gram price of physical gold/silver on a given day, scaled to `purity`.
 *
 * Physical metal has no symbol of its own, so it is priced by asset type. A date
 * of today (or later) resolves live; otherwise we take the last quote on or before
 * the requested day, so weekends and holidays still return a sensible price.
 *
 * @returns {Promise<{price: number, asof: string}|null>}
 */
async function fetchMetalPricePerGram(assetType, purity, dateMs) {
  if (!isPurityAsset(assetType)) return null;
  const item  = [{ assetSymbol: '_METAL', assetType }];
  const scale = purityFactor(assetType, purity);
  const today = todayMs();

  if (dateMs >= today) {
    const price = (await fetchLatestPrices(item))['_METAL'];
    if (price == null) return null;
    return { price: Math.round(price * scale * 100) / 100, asof: toDateStr_from_ms(today) };
  }

  const series = (await fetchHistoricPrices(item, dateMs - 7 * DAY_MS, dateMs))['_METAL'] || {};
  const days   = Object.keys(series).map(Number).filter(d => d <= dateMs).sort((a, b) => a - b);
  if (!days.length) return null;

  const day = days[days.length - 1];
  return {
    price: Math.round(series[day] * scale * 100) / 100,
    asof:  toDateStr_from_ms(day),
  };
}

/**
 * INR per one unit of `currency` on a given day — the rate used to book a foreign
 * transaction's amount. A date of today (or later) resolves live; otherwise the
 * last rate quoted on or before that day (weekends/holidays carry forward).
 *
 * INR itself is rate 1. An unavailable rate returns null — the caller must fail
 * rather than silently book a foreign amount as INR.
 *
 * @returns {Promise<number|null>}
 */
async function fetchFxRate(currency, dateMs) {
  if (isBaseCurrency(currency)) return 1;

  const sym   = fxSymbol(currency);
  const today = todayMs();

  if (dateMs >= today) {
    const live = await fetchLatestPrices([{ assetSymbol: sym, assetType: 'stock' }]);
    return live[sym] ?? null;
  }

  const series = (await fetchHistoricPrices(
    [{ assetSymbol: sym, assetType: 'stock' }], dateMs - 7 * DAY_MS, dateMs,
  ))[sym] || {};
  const days = Object.keys(series).map(Number).filter(d => d <= dateMs).sort((a, b) => a - b);
  return days.length ? series[days[days.length - 1]] : null;
}

/**
 * Current price + currency for a handful of symbols, straight from each chart's
 * metadata (one request per symbol, in parallel).
 *
 * Used to tell apart search hits that Yahoo reports under an identical name —
 * Indian mutual-fund plans (Direct/Regular, Growth/IDCW) all share one `longname`,
 * and the plan is in no field of any endpoint we can reach. Their NAVs differ
 * sharply, so the NAV is what actually identifies the plan.
 *
 * Unlike the other fetchers this returns the NATIVE price and its currency, since
 * it feeds a display label rather than a valuation.
 *
 * @returns {Promise<Object.<string, {price: number, currency: string}>>}
 */
async function fetchQuoteMeta(symbols = []) {
  if (!symbols.length) return {};

  // AMFI schemes: NAV from mfService — they have no Yahoo chart at all.
  const out = {};
  const mfSyms = symbols.filter(mfService.isMfSymbol);
  if (mfSyms.length) {
    const navs = await mfService.getLatestNavs(mfSyms.map(mfService.schemeCodeOf));
    for (const sym of mfSyms) {
      const nav = navs[mfService.schemeCodeOf(sym)];
      if (nav != null) out[sym] = { price: nav, currency: 'INR' };
    }
  }

  symbols = symbols.filter(s => !mfService.isMfSymbol(s));
  if (!symbols.length) return out;

  const results = await Promise.all(symbols.map(async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`;
      const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return null;
      const meta = (await resp.json())?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice == null) return null;
      return { price: _round2(meta.regularMarketPrice), currency: meta.currency || '' };
    } catch {
      return null;
    }
  }));

  symbols.forEach((sym, i) => { if (results[i]) out[sym] = results[i]; });
  return out;
}

module.exports = {
  fetchHistoricPrices,
  fetchLatestPrices,
  fetchMetalPricePerGram,
  fetchFxRate,
  fetchQuoteMeta,
};
