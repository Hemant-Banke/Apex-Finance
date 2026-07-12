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
const { midnight, todayMs, toDateStr } = require('../utils/helpers');
const {
  METAL_SPOT_SYMBOLS, FX_SYMBOL, isPurityAsset, metalInrPerGram, purityFactor,
} = require('../utils/assetPricing');
const {
  isBaseCurrency, fxSymbol, normalizeCurrency, distinctCurrencies,
} = require('../utils/currency');
const mfService = require('./mfService');

/**
 * Crypto trades round the clock, so its "daily close" is whatever the price was at
 * midnight IST — UTC 18:30 of the previous day. Shifting the query window back by the
 * IST offset is what lines Yahoo's bars up with our calendar days.
 */
function _adjustDateForYF(date, assetType) {
  return assetType === 'crypto' ? date - IST_OFFSET_MS : date;
}

/**
 * The one place Yahoo's chart endpoint is called.
 *
 * `/v7/finance/quote` and `/v10/quoteSummary` are crumb-gated (401), so v8/chart is
 * the only way in — for a price series, a single close, or a live quote. Every caller
 * goes through here rather than assembling the URL again.
 *
 * @returns {Promise<Object|null>} the chart `result` object, or null on any failure.
 */
async function fetchChart(symbol, params = {}, timeoutMs = 8000) {
  try {
    const query = new URLSearchParams({ interval: '1d', ...params });
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;

    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;

    return (await resp.json())?.chart?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

/** The daily closes of a chart result, keyed by the UTC-midnight ms of their day. */
function closesByDay(result) {
  const timestamps = result?.timestamp || [];
  const closes     = result?.indicators?.quote?.[0]?.close || [];

  const out = {};
  timestamps.forEach((ts, i) => {
    if (closes[i] != null) out[midnight(ts * 1000)] = _round2(closes[i]);
  });
  return out;
}

/**
 * Fetch daily close prices for one symbol, in its NATIVE currency.
 * Returns { [dayMs]: price } keyed by UTC-midnight ms, so the values align with the
 * day indices used by buildAssetTS.
 */
async function _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs) {
  const result = await fetchChart(assetSymbol, {
    period1: Math.floor(_adjustDateForYF(startMs, assetType) / 1000),
    period2: Math.floor((_adjustDateForYF(endMs, assetType) + DAY_MS) / 1000), // +1 day buffer
  });
  return closesByDay(result);
}

/** The last value in a day-keyed series on or before `dayMs`, with its day. */
function lastOnOrBefore(series, dayMs) {
  let best = null;
  for (const k of Object.keys(series || {})) {
    const day = Number(k);
    if (day <= dayMs && (best === null || day > best)) best = day;
  }
  return best === null ? null : { day: best, value: series[best] };
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
    return price == null ? null : { price: _round2(price * scale), asof: toDateStr(today) };
  }

  const series = (await fetchHistoricPrices(item, dateMs - 7 * DAY_MS, dateMs))['_METAL'] || {};
  const last   = lastOnOrBefore(series, dateMs);
  if (!last) return null;

  return { price: _round2(last.value * scale), asof: toDateStr(last.day) };
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

  const sym  = fxSymbol(currency);
  const item = [{ assetSymbol: sym, assetType: 'stock' }];

  if (dateMs >= todayMs()) {
    return (await fetchLatestPrices(item))[sym] ?? null;
  }

  const series = (await fetchHistoricPrices(item, dateMs - 7 * DAY_MS, dateMs))[sym] || {};
  return lastOnOrBefore(series, dateMs)?.value ?? null;
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
    const meta = (await fetchChart(sym, { range: '1d' }, 5000))?.meta;
    if (meta?.regularMarketPrice == null) return null;
    return { price: _round2(meta.regularMarketPrice), currency: meta.currency || '' };
  }));

  symbols.forEach((sym, i) => { if (results[i]) out[sym] = results[i]; });
  return out;
}

/**
 * The price of one asset on one day, in its NATIVE currency — what a recurring
 * asset transaction (a SIP) executed at on its own date.
 *
 * Native, not INR, because that is what a transaction's `pricePerUnit` stores;
 * `applyAssetPricing` converts to the INR `amount` from here.
 *
 * @returns {Promise<{price: number, currency: string}|null>}
 */
async function fetchPriceOnDate({ assetSymbol, assetType, purity }, dateMs) {
  // Indian mutual fund → the day's NAV (INR).
  if (mfService.isMfSymbol(assetSymbol)) {
    const nav = await mfService.getNavOn(mfService.schemeCodeOf(assetSymbol), dateMs);
    return nav == null ? null : { price: nav, currency: 'INR' };
  }

  // Physical metal → INR per gram at this purity.
  if (isPurityAsset(assetType)) {
    const metal = await fetchMetalPricePerGram(assetType, purity, dateMs);
    return metal ? { price: metal.price, currency: 'INR' } : null;
  }

  // Listed → the close on (or just before) the day. `_fetchHistoricForSymbol` is the
  // raw, UNCONVERTED series, which is exactly what we want here.
  const series = await _fetchHistoricForSymbol(assetSymbol, assetType, dateMs - 10 * DAY_MS, dateMs);
  const last   = lastOnOrBefore(series, dateMs);
  if (!last) return null;

  const meta = await fetchQuoteMeta([assetSymbol]);
  return { price: last.value, currency: meta[assetSymbol]?.currency || '' };
}

module.exports = {
  // The one door to Yahoo, plus the helpers for reading what comes back — routes use
  // these rather than assembling a chart URL of their own.
  fetchChart,
  closesByDay,
  lastOnOrBefore,
  fetchHistoricPrices,
  fetchLatestPrices,
  fetchMetalPricePerGram,
  fetchFxRate,
  fetchQuoteMeta,
  fetchPriceOnDate,
};
