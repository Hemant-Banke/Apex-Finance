const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { HttpError, badRequest, notFound } = require('../utils/httpError');
const { DAY_MS } = require('../utils/constants');
const { nowMs, toDateStr, todayMs, midnight } = require('../utils/helpers');
const { isPurityAsset } = require('../utils/assetPricing');
const { fxSymbol, normalizeCurrency } = require('../utils/currency');
const {
  fetchChart, closesByDay, lastOnOrBefore, fetchMetalPricePerGram, fetchFxRate, searchYahoo,
  fetchHistoricPrices, fetchDailyCloses, quoteCurrency,
} = require('../services/marketDataService');
const mfService = require('../services/mfService');
const sectorService = require('../services/sectorService');


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

// GET /api/market/search?q=QUERY[&indices=true]
router.get('/search', asyncHandler(async (req, res) => {
  const { q = '' } = req.query;
  if (q.trim().length < 1) return res.json([]);
  // `?indices=true` — the Markets page, which can show an index (the asset form cannot buy one).
  const indices = req.query.indices === 'true';

  // The sources are independent — hit them CONCURRENTLY, or the user waits for them
  // back to back. None is allowed to sink the others: a failing source contributes
  // nothing rather than failing the whole search. The Nifty 500 match is local and
  // guarantees the NSE listing of an Indian company Yahoo's ten rows may miss.
  const [quotes, funds, nse] = await Promise.all([
    searchYahoo(q, { indices }).catch(() => []),
    mfService.searchSchemes(q, 8).catch(() => []),
    sectorService.searchUniverse(q, 8).catch(() => []),
  ]);

  // One row per symbol — the Nifty 500 row wins, as it carries the company's sector.
  const seen = new Set(nse.map(r => r.symbol));
  const score = relevanceTo(q);
  const merged = [...nse, ...quotes.filter(r => !seen.has(r.symbol)), ...funds]
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

// GET /api/market/index-series?symbol=%5ENSEI&days=N   (or symbol=_METAL:gold|silver | AMFI:<code>)
// A day-by-day CLOSE series for a market index/benchmark — used by the growth view's
// comparison overlay, so it needs one close per CALENDAR day (carried forward across
// non-trading days), not OHLC candles: it gets re-based against the app's own
// day-indexed growth series, which has no notion of a trading calendar.
router.get('/index-series', asyncHandler(async (req, res) => {
  const { days } = req.query;
  if (!req.query.symbol) throw badRequest('symbol is required');
  // `INR:<symbol>` — the same instrument as an Indian investor holding it would see it:
  // each day's native close times that day's rupee rate, so the series compounds the
  // asset's own growth AND the currency's. The S&P 500 in dollars says how America did;
  // in rupees it says what money parked there did for you.
  const inr    = String(req.query.symbol).startsWith('INR:');
  const symbol = inr ? String(req.query.symbol).slice(4) : String(req.query.symbol);

  const daysNum = Math.max(1, parseInt(days, 10) || 3650);
  const now     = nowMs();

  // `_METAL:gold` / `_METAL:silver` — DOMESTIC metal, INR per gram, priced exactly as a
  // physical-metal holding is (spot future × the day's rupee × the duty/GST premium).
  // COMEX gold in dollars would chart the rupee's move as if it were gold's.
  const metal = /^_METAL:(gold|silver)$/.exec(symbol)?.[1];
  let closes;
  if (mfService.isMfSymbol(symbol)) {
    // An Indian fund — its NAV history from AMFI (cached), never Yahoo.
    closes = await mfService.getNavHistory(mfService.schemeCodeOf(symbol), now - daysNum * DAY_MS, now);
  } else if (metal) {
    const from = now - daysNum * DAY_MS;
    closes = (await fetchHistoricPrices([{ assetSymbol: symbol, assetType: metal }], from, now))[symbol] || {};
    if (!Object.keys(closes).length) throw new HttpError(502, 'Metal prices unavailable');
  } else {
    // Settled closes from the local price cache, today's point from the live memo.
    const from = midnight(now - daysNum * DAY_MS);
    closes = await fetchDailyCloses(symbol, from, todayMs());
    if (!Object.keys(closes).length) throw new HttpError(502, 'Index data unavailable');

    let currency;
    if (inr) {
      const quoted = await quoteCurrency(symbol);
      if (!quoted) throw new HttpError(502, 'Quote currency unavailable');
      currency = normalizeCurrency(quoted);
    }
    if (currency) {
      const rates = await fetchDailyCloses(fxSymbol(currency), from - 10 * DAY_MS, todayMs());
      // A missing rate is never treated as 1 (see utils/currency): a day with no rate
      // on or before it is dropped rather than charted as dollars read as rupees.
      // One forward pass over both sorted series (the rate carried forward across days
      // the currency market was shut), rather than a search per day.
      const rateDays = Object.keys(rates).map(Number).sort((a, b) => a - b);
      const converted = {};
      let i = -1;
      for (const day of Object.keys(closes).map(Number).sort((a, b) => a - b)) {
        while (i + 1 < rateDays.length && rateDays[i + 1] <= day) i++;
        if (i >= 0 && closes[day] != null) converted[day] = closes[day] * rates[rateDays[i]];
      }
      if (!Object.keys(converted).length) throw new HttpError(502, 'Exchange rate unavailable');
      closes = converted;
    }
  }
  const seen    = Object.keys(closes).map(Number);
  if (!seen.length) return res.json([]);

  const startMs = midnight(Math.min(...seen));
  const endMs   = midnight(todayMs());

  // One pass over the sorted closes, carrying the last one across closed days.
  const sorted = seen.sort((a, b) => a - b);
  const out = [];
  let i = -1;
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    while (i + 1 < sorted.length && sorted[i + 1] <= t) i++;
    out.push({ date: toDateStr(t), close: i >= 0 ? closes[sorted[i]] : null });
  }
  res.json(out);
}));

module.exports = router;
