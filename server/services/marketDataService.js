/**
 * marketDataService — all Yahoo Finance fetching.
 *
 * fetchHistoricPrices: one HTTP request per symbol, all in parallel.
 * fetchLatestPrices:   live quotes via livePriceService (spark, cached a minute in `currentprices`).
 *
 * Crypto date rule: midnight IST = UTC 18:30 of the previous UTC day,
 * so we shift the query date back by 5h30m before calling Yahoo.
 */

const { DAY_MS, IST_OFFSET_MS, YF_HEADERS } = require('../utils/constants');
const { midnight, todayMs, toDateStr, mapQuoteType, resolveQuoteName } = require('../utils/helpers');
const {
  METAL_SPOT_SYMBOLS, FX_SYMBOL, isPurityAsset, metalInrPerGram, purityFactor,
} = require('../utils/assetPricing');
const {
  isBaseCurrency, fxSymbol, normalizeCurrency, distinctCurrencies,
} = require('../utils/currency');
const mfService = require('./mfService');
const priceCache = require('./priceCacheService');
const livePrices = require('./livePriceService');

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

/** One range straight from Yahoo, native currency; null when the request failed. */
async function _fetchRangeRaw(assetSymbol, assetType, startMs, endMs) {
  const result = await fetchChart(assetSymbol, {
    period1: Math.floor(_adjustDateForYF(startMs, assetType) / 1000),
    period2: Math.floor((_adjustDateForYF(endMs, assetType) + DAY_MS) / 1000), // +1 day buffer
  }, 12000);
  return result ? { closes: closesByDay(result), currency: result.meta?.currency || null } : null;
}

/**
 * Daily closes for one symbol, in its NATIVE currency, keyed by UTC-midnight ms so they
 * align with buildAssetTS's day indices. Served from the local price cache; Yahoo is
 * asked only for days the cache does not yet hold.
 */
function _fetchHistoricForSymbol(assetSymbol, assetType, startMs, endMs) {
  return priceCache.getCloses(assetSymbol, assetType, startMs, endMs, _fetchRangeRaw);
}

/**
 * Native daily closes over [startMs, endMs] from the cache, plus today's live price when the
 * window reaches today (the 60s live memo; omitted if the quote fails).
 */
async function fetchDailyCloses(symbol, startMs, endMs, { assetType = 'stock' } = {}) {
  const closes = await _fetchHistoricForSymbol(symbol, assetType, startMs, endMs);
  const today = todayMs();
  if (endMs >= today) {
    const live = await _nativeLive(symbol);
    if (live != null) closes[today] = live;
  }
  return closes;
}

// Today's native quote for a chart's last point, from the same live cache.
async function _nativeLive(symbol) {
  const q = (await livePrices.getQuotes([symbol]).catch(() => ({})))[symbol];
  return q?.price ?? null;
}

/** A symbol's quote currency: the cached one, else Yahoo's chart meta; null if neither knows. */
async function quoteCurrency(symbol) {
  return (await priceCache.getCurrency(symbol)) || (await fetchQuoteMeta([symbol]))[symbol]?.currency || null;
}

/** Top up every cached symbol to the last settled close. Runs on a timer from index.js. */
function refreshPriceCache() {
  return priceCache.refreshAll(_fetchRangeRaw);
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

// ─── Live prices ─────────────────────────────────────────────────────────────
//
// Raw quotes come from `livePriceService`, cached in Mongo (`currentprices`) for a minute,
// so a page's tiles, table and list all read the same number and a restart keeps it.
// Here they are only converted: INR via the day's FX quote, metals to ₹/gram.
// Called ONLY when live prices are asked for — the settled basis never touches the network.

// The session each last live price belongs to, for `latestSessionDays`.
const _session = new Map();   // symbol → { session, day }

/**
 * The day key of the session behind each live price (the spot's, for a metal) — how a
 * caller tells "today's session, not yet a close" from "a session already stored".
 */
function latestSessionDays(symbols) {
  const today = toDateStr(todayMs());
  const out = {};
  for (const sym of symbols) {
    const hit = _session.get(sym);
    if (hit?.day === today && hit.session != null) out[sym] = hit.session;
  }
  return out;
}

/**
 * Live INR prices for holdings: listed assets from the cached spark quotes (converted with
 * the day's FX), metals as ₹ per gram of pure metal, Indian funds from AMFI's latest NAV.
 * Symbols with no quote are omitted — the caller falls back to the last close.
 *
 * @param {Array<{assetSymbol: string, assetType: string, currency?: string}>} holdings
 * @returns {Promise<Object.<string, number>>}  { [symbol]: inrPrice }
 */
async function fetchLatestPrices(holdings) {
  if (!holdings.length) return {};
  const today = toDateStr(todayMs());
  const out = {};

  // Indian mutual funds: latest NAV from AMFI (via mfService), never Yahoo.
  const funds = holdings.filter(h => mfService.isMfSymbol(h.assetSymbol));
  if (funds.length) {
    const navs = await mfService.getLatestNavs(funds.map(h => mfService.schemeCodeOf(h.assetSymbol)));
    for (const h of funds) {
      const nav = navs[mfService.schemeCodeOf(h.assetSymbol)];
      if (nav != null) out[h.assetSymbol] = nav;
    }
  }

  const rest = holdings.filter(h => !mfService.isMfSymbol(h.assetSymbol));
  if (!rest.length) return out;
  const metalSpots  = _metalSpotsNeeded(rest);
  const listedItems = rest.filter(h => !isPurityAsset(h.assetType));
  const fxSymbols   = new Set(distinctCurrencies(listedItems).map(fxSymbol));
  if (metalSpots.length) fxSymbols.add(FX_SYMBOL);

  let quotes = {};
  try {
    quotes = await livePrices.getQuotes([...listedItems.map(h => h.assetSymbol), ...metalSpots, ...fxSymbols]);
  } catch (e) { console.error('live quotes failed:', e.message); }
  const price = (sym) => (quotes[sym]?.price != null ? _round2(quotes[sym].price) : null);
  const keepSession = (sym, quoteSym) => {
    const session = quotes[quoteSym]?.sessionDay;
    if (session != null) _session.set(sym, { session, day: today });
  };

  // Listed assets, converted when quoted abroad. A foreign holding with no FX quote is
  // omitted rather than passed through at its native value — USD must never read as INR.
  for (const h of listedItems) {
    const p = price(h.assetSymbol);
    if (p == null) continue;
    const currency = normalizeCurrency(h.currency);
    if (!currency) { out[h.assetSymbol] = p; keepSession(h.assetSymbol, h.assetSymbol); continue; }
    const fx = price(fxSymbol(currency));
    if (fx == null) continue;
    out[h.assetSymbol] = _round2(p * fx);
    keepSession(h.assetSymbol, h.assetSymbol);
  }

  // Metals: INR per gram of PURE metal, keyed by each holding's own symbol; the caller scales by purity.
  if (metalSpots.length) {
    const usdInr = price(FX_SYMBOL);
    for (const h of rest) {
      if (!isPurityAsset(h.assetType)) continue;
      const spot = METAL_SPOT_SYMBOLS[h.assetType];
      const perGram = metalInrPerGram(price(spot), usdInr, h.assetType);
      if (perGram != null) out[h.assetSymbol] = _round2(perGram);
      keepSession(h.assetSymbol, spot);
    }
  }
  return out;
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

  // The synthetic symbol must name the METAL, not just "a metal": the live-price memo is
  // keyed by symbol, so a shared `_METAL` key would serve silver whatever gold was
  // quoted at a moment earlier.
  const sym   = `_METAL:${assetType}`;
  const item  = [{ assetSymbol: sym, assetType }];
  const scale = purityFactor(assetType, purity);
  const today = todayMs();

  if (dateMs >= today) {
    const price = (await fetchLatestPrices(item))[sym];
    return price == null ? null : { price: _round2(price * scale), asof: toDateStr(today) };
  }

  const series = (await fetchHistoricPrices(item, dateMs - 7 * DAY_MS, dateMs))[sym] || {};
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
    return { price: _round2(meta.regularMarketPrice), currency: meta.currency || '', name: meta.longName || meta.shortName || undefined };
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

/**
 * Yahoo's crumb-gated endpoints — `/v7/finance/quote`, `/v10/finance/quoteSummary`, the
 * fundamentals timeseries — need a session: a cookie from fc.yahoo.com, then a crumb
 * minted against it. Both are cached for hours and re-minted once on a 401.
 *
 * Two details that each cost an afternoon: the crumb endpoint answers **406** if the
 * request says `Accept: application/json` (the crumb is plain text), and **429** to a full
 * desktop-Chrome agent — so it is called with the short agent and nothing else.
 */
let _yahooSession = null;   // { cookie, crumb, at }
const YAHOO_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function _getYahooSession(force = false) {
  if (!force && _yahooSession && Date.now() - _yahooSession.at < YAHOO_SESSION_TTL_MS) return _yahooSession;
  try {
    const ua = { 'User-Agent': YF_HEADERS['User-Agent'] };
    const first = await fetch('https://fc.yahoo.com/', { headers: ua, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const cookie = (first.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
    if (!cookie) return null;
    const resp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...ua, cookie }, signal: AbortSignal.timeout(8000),
    });
    const crumb = resp.ok ? (await resp.text()).trim() : '';
    if (!crumb || crumb.includes('{')) return null;
    _yahooSession = { cookie, crumb, at: Date.now() };
    return _yahooSession;
  } catch { return null; }
}

/**
 * GET a crumb-gated Yahoo URL (without its `crumb` — this adds it) → parsed JSON, or null
 * on any failure. One fresh session is minted on a 401 before giving up.
 */
async function fetchYahooAuthed(url, timeoutMs = 10000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await _getYahooSession(attempt > 0);
    if (!session) return null;
    try {
      const sep = url.includes('?') ? '&' : '?';
      const resp = await fetch(`${url}${sep}crumb=${encodeURIComponent(session.crumb)}`, {
        headers: { ...YF_HEADERS, cookie: session.cookie }, signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.status === 401) continue;          // session expired — mint once more
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  }
  return null;
}

/** Yahoo's Morningstar-coded Indian mutual funds — replaced wholesale by AMFI. */
const INDIAN_MF_SYMBOL = /^0P\w+\.(BO|NS)$/i;

/** Type-ahead results, briefly. Users retype the same prefixes constantly. */
const _yahooCache = new Map();
const YAHOO_TTL_MS = 5 * 60 * 1000;

/**
 * Yahoo's symbol search, with ONE retry.
 *
 * A first connection out of this process intermittently stalls for seconds while the
 * next is milliseconds — so a single tight-timeout attempt would hand the user an
 * empty result list for a perfectly good query ("AAPL" returned nothing). Retrying
 * once costs little and turns that into a hit.
 *
 * (Lives here with every other Yahoo call; shared by the asset search and the Markets
 * page's stock search.)
 */
/**
 * Yahoo's instrument search. `indices` keeps INDEX hits (typed `index`) — wanted by the
 * Markets page, which can SHOW an index; the asset form cannot BUY one, so it is off by default.
 */
async function searchYahoo(q, { indices = false } = {}) {
  const key = `${indices ? 'i:' : ''}${q.trim().toLowerCase()}`;
  const hit = _yahooCache.get(key);
  if (hit && Date.now() - hit.at < YAHOO_TTL_MS) return hit.results;

  const url = `https://query1.finance.yahoo.com/v1/finance/search`
            + `?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`;

  let data = null;
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    try {
      const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(3000) });
      if (resp.ok) data = await resp.json();
    } catch { /* stalled — try once more on a fresh connection */ }
  }
  if (!data) return [];

  const results = (data.quotes || [])
    .filter(x => x.symbol && (indices || x.quoteType !== 'INDEX'))
    // Indian mutual funds are served from AMFI, never Yahoo: Yahoo lists them as
    // opaque Morningstar codes (0P…), reports every plan of a fund under one
    // identical name, and mixes in foreign cross-listings. Drop them outright.
    .filter(x => !INDIAN_MF_SYMBOL.test(x.symbol))
    .map(x => ({
      symbol:   x.symbol,
      name:     resolveQuoteName(x),
      // Yahoo files some Indian exchange-traded funds as EQUITY — sometimes named as one
      // ("… ETF", "… BeES"), sometimes only as an asset manager's product ("HDFCAMC -
      // HDFCSILVER"). Typed as a stock, the asset form would book a fund as a company and
      // the Markets search would offer it a company page.
      type:     x.quoteType === 'INDEX' ? 'index'
              : /\bETF\b|BEES\b|AMC\s*-\s/i.test(resolveQuoteName(x) || '') ? 'etf' : mapQuoteType(x.quoteType),
      exchange: x.exchDisp || x.exchange || '',
      currency: x.currency || '',
    }));

  _yahooCache.set(key, { at: Date.now(), results });
  return results;
}

module.exports = {
  // The one door to Yahoo, plus the helpers for reading what comes back — routes use
  // these rather than assembling a chart URL of their own.
  fetchChart,
  fetchYahooAuthed,
  searchYahoo,
  closesByDay,
  lastOnOrBefore,
  fetchHistoricPrices,
  fetchLatestPrices,
  latestSessionDays,
  fetchMetalPricePerGram,
  fetchFxRate,
  fetchQuoteMeta,
  fetchPriceOnDate,
  refreshPriceCache,
  fetchDailyCloses,
  quoteCurrency,
};
