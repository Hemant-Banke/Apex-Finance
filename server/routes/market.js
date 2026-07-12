const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { HttpError, badRequest, notFound } = require('../utils/httpError');
const { DAY_MS, YF_HEADERS } = require('../utils/constants');
const { mapQuoteType, resolveQuoteName, nowMs, toDateStr, todayMs, midnight } = require('../utils/helpers');
const { isPurityAsset } = require('../utils/assetPricing');
const {
  fetchChart, closesByDay, lastOnOrBefore, fetchMetalPricePerGram, fetchFxRate,
} = require('../services/marketDataService');
const mfService = require('../services/mfService');

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
 * (Search is the one Yahoo endpoint that is not the chart API, so it is fetched here
 * rather than through marketDataService — it returns no prices.)
 */
async function searchYahoo(q) {
  const key = q.trim().toLowerCase();
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
    .filter(x => x.symbol && x.quoteType !== 'INDEX')
    // Indian mutual funds are served from AMFI, never Yahoo: Yahoo lists them as
    // opaque Morningstar codes (0P…), reports every plan of a fund under one
    // identical name, and mixes in foreign cross-listings. Drop them outright.
    .filter(x => !INDIAN_MF_SYMBOL.test(x.symbol))
    .map(x => ({
      symbol:   x.symbol,
      name:     resolveQuoteName(x),
      type:     mapQuoteType(x.quoteType),
      exchange: x.exchDisp || x.exchange || '',
      currency: x.currency || '',
    }));

  _yahooCache.set(key, { at: Date.now(), results });
  return results;
}

/**
 * How well a result answers the query. Yahoo hits and AMFI funds are ranked TOGETHER
 * by this, rather than one list always sitting above the other: "quant small" was
 * surfacing a US "TIAA-CREF Quant Small-Cap" above the Indian quant Small Cap Fund
 * purely because the query happened not to contain the word "fund".
 */
function relevanceTo(query) {
  const qLower  = query.trim().toLowerCase();
  const qTokens = qLower.split(/[^a-z0-9]+/).filter(t => t.length > 1);

  return (r) => {
    if (!qTokens.length) return 0;
    const symbol = (r.symbol || '').toLowerCase();
    const name   = `${r.name} ${r.symbol}`.toLowerCase();

    // Someone typing a ticker exactly means THAT instrument. Without this, "AAPL"
    // ranked a Thai depositary receipt (AAPL19.BK) above Apple, because its name
    // happens to begin with the query string.
    if (symbol === qLower) return 10;

    const hits = qTokens.filter(t => name.includes(t)).length;
    return hits / qTokens.length
      + (symbol.startsWith(qLower) ? 0.3 : 0)
      + (name.startsWith(qTokens[0]) ? 0.15 : 0);
  };
}

const router = express.Router();
router.use(protect);

// GET /api/market/search?q=QUERY
router.get('/search', asyncHandler(async (req, res) => {
  const { q = '' } = req.query;
  if (q.trim().length < 1) return res.json([]);

  // The two sources are independent — hit them CONCURRENTLY, or the user waits for
  // Yahoo and AMFI back to back. Neither is allowed to sink the other: a failing
  // source contributes nothing rather than failing the whole search.
  const [quotes, funds] = await Promise.all([
    searchYahoo(q).catch(() => []),
    mfService.searchSchemes(q, 8).catch(() => []),
  ]);

  const score = relevanceTo(q);
  const merged = [...quotes, ...funds]
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))   // stable within equal relevance
    .map(({ r }) => r);

  res.json(merged);
}));

// GET /api/market/price?symbol=AAPL&date=2024-01-15
// The close on or before the requested date (so weekends/holidays still answer); a date
// of today or later resolves live.
//
// Physical gold/silver (assetType=gold|silver) have no market symbol of their own, so
// they are priced by TYPE: INR per gram, scaled to the given purity.
router.get('/price', asyncHandler(async (req, res) => {
  const { symbol, date, assetType, purity } = req.query;
  if (!symbol || !date) throw badRequest('symbol and date are required');

  const today = todayMs();
  const dayMs = midnight(date);

  // Indian mutual fund — NAV from AMFI on (or last published before) the date.
  if (mfService.isMfSymbol(symbol)) {
    const nav = await mfService.getNavOn(mfService.schemeCodeOf(symbol), Math.min(dayMs, today));
    if (nav == null) throw notFound('NAV unavailable for this date');
    return res.json({ symbol, date, price: nav, currency: 'INR', fxRate: 1, priceInr: nav });
  }

  // Physical metal — priced by type, per gram, at this purity.
  if (isPurityAsset(assetType)) {
    const metal = await fetchMetalPricePerGram(assetType, purity, dayMs);
    if (!metal) throw notFound('Metal price unavailable');
    return res.json({
      symbol, date, price: metal.price, currency: 'INR', actualDate: metal.asof, perGram: true,
    });
  }

  // Listed. A 7-day window covers any weekend or holiday run before the requested day.
  const isToday = new Date(date).getTime() >= today;
  const endMs   = (isToday ? today : dayMs) + DAY_MS;

  const result = await fetchChart(symbol, {
    period1: Math.floor((endMs - 7 * DAY_MS) / 1000),
    period2: Math.floor(endMs / 1000),
  }, 5000);
  if (!result) throw new HttpError(502, 'Price data unavailable');

  const currency = result.meta?.currency || '';

  // `price` stays in the asset's native currency (what the user sees on the exchange,
  // and what we store); `fxRate`/`priceInr` give the INR booking.
  const withFx = async (price, actualDate) => {
    const fxRate = await fetchFxRate(currency, midnight(actualDate || date));
    return {
      symbol, date, price, currency, actualDate,
      fxRate,
      priceInr: fxRate ? Math.round(price * fxRate * 100) / 100 : null,
    };
  };

  if (isToday) {
    const price = result.meta?.regularMarketPrice;
    if (!price) throw notFound('Price unavailable');
    return res.json(await withFx(price, null));
  }

  const closes = closesByDay(result);
  const last   = lastOnOrBefore(closes, dayMs);
  if (!last) throw notFound('No price available for this date');

  res.json(await withFx(last.value, toDateStr(last.day)));
}));

// GET /api/market/ohlc?symbol=AAPL&days=30
// OHLC candles over the given number of days. The interval is auto-selected so the
// series stays a readable length: ≤2 days → hourly, ≤365 → daily, beyond that weekly.
router.get('/ohlc', asyncHandler(async (req, res) => {
  const { symbol, days } = req.query;
  if (!symbol) throw badRequest('symbol is required');

  const daysNum = days ? parseInt(days, 10) : null;

  let interval = '1d';
  if (daysNum && daysNum <= 2)        interval = '1h';
  else if (!daysNum || daysNum > 365) interval = '1wk';

  const now  = nowMs();
  const span = (daysNum || 10 * 365) * DAY_MS;   // no window given → 10 years

  const result = await fetchChart(symbol, {
    period1: Math.floor((now - span) / 1000),
    period2: Math.floor(now / 1000),
    interval,
  }, 10000);
  if (!result) throw new HttpError(502, 'OHLC data unavailable');

  const timestamps = result.timestamp || [];
  const { open = [], high = [], low = [], close = [], volume = [] } = result.indicators?.quote?.[0] || {};

  const candles = timestamps
    .map((ts, i) => {
      const d = new Date(ts * 1000);
      // Hourly candles need the time; daily/weekly ones are a plain date.
      const date = interval === '1h'
        ? `${d.toISOString().slice(0, 10)}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
        : d.toISOString().slice(0, 10);

      return {
        date,
        open:   open[i]  != null ? +open[i].toFixed(4)  : null,
        high:   high[i]  != null ? +high[i].toFixed(4)  : null,
        low:    low[i]   != null ? +low[i].toFixed(4)   : null,
        close:  close[i] != null ? +close[i].toFixed(4) : null,
        volume: volume[i] || 0,
      };
    })
    .filter(c => c.open != null && c.high != null && c.low != null && c.close != null);

  res.json({ symbol, interval, candles });
}));

module.exports = router;
