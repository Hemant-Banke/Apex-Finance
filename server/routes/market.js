const express = require('express');
const { protect } = require('../middleware/auth');
const { DAY_MS, YF_HEADERS } = require('../utils/constants');
const { mapQuoteType, resolveQuoteName, nowMs, toDateStr_from_ms, todayMs, midnight } = require('../utils/helpers');
const { isPurityAsset } = require('../utils/assetPricing');
const { fetchMetalPricePerGram, fetchFxRate } = require('../services/marketDataService');
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

const router = express.Router();
router.use(protect);

// GET /api/market/search?q=QUERY
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  if (q.trim().length < 1) return res.json([]);

  try {
    // The two sources are independent — hit them CONCURRENTLY, or the user waits for
    // Yahoo and AMFI back to back. Neither is allowed to sink the other: a failing
    // source contributes nothing rather than failing the whole search.
    const [quotes, funds] = await Promise.all([
      searchYahoo(q).catch(() => []),
      mfService.searchSchemes(q, 8).catch(() => []),
    ]);

    // Rank the two sources TOGETHER by how well each name actually matches, instead
    // of always putting one list ahead of the other: "quant small" was surfacing a US
    // "TIAA-CREF Quant Small-Cap" above the Indian quant Small Cap Fund purely because
    // the query happened not to contain the word "fund".
    const qLower  = q.trim().toLowerCase();
    const qTokens = qLower.split(/[^a-z0-9]+/).filter(t => t.length > 1);
    const relevance = (r) => {
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

    const merged = [...quotes, ...funds]
      .map((r, i) => ({ r, i, s: relevance(r) }))
      .sort((a, b) => (b.s - a.s) || (a.i - b.i))   // stable within equal relevance
      .map(({ r }) => r);

    res.json(merged);
  } catch (err) {
    console.error('Market search error:', err.message);
    res.status(500).json({ message: 'Market search unavailable' });
  }
});

// GET /api/market/price?symbol=AAPL&date=2024-01-15
// Returns the close price on or before the requested date (handles weekends/holidays).
// If date is today or future, returns current price.
//
// Physical gold/silver (assetType=gold|silver) have no market symbol of their own,
// so they are priced by type: INR per gram, scaled to the given purity.
router.get('/price', async (req, res) => {
  const { symbol, date, assetType, purity } = req.query;
  if (!symbol || !date) return res.status(400).json({ message: 'symbol and date are required' });

  try {
    const requestedDate = new Date(date).getTime();
    const today         = todayMs();

    // Indian mutual fund — NAV from AMFI on (or last published before) the date.
    if (mfService.isMfSymbol(symbol)) {
      const dayMs = Math.min(midnight(new Date(date)), today);
      const nav   = await mfService.getNavOn(mfService.schemeCodeOf(symbol), dayMs);
      if (nav == null) return res.status(404).json({ message: 'NAV unavailable for this date' });
      return res.json({
        symbol, date,
        price:    nav,
        currency: 'INR',
        fxRate:   1,
        priceInr: nav,
      });
    }

    if (isPurityAsset(assetType)) {
      const metal = await fetchMetalPricePerGram(assetType, purity, midnight(new Date(date)));
      if (!metal) return res.status(404).json({ message: 'Metal price unavailable' });
      return res.json({
        symbol, date,
        price:      metal.price,
        currency:   'INR',
        actualDate: metal.asof,
        perGram:    true,
      });
    }

    // For today/future, fetch a short window ending now
    const isToday = requestedDate >= today;
    const endDate = (isToday ? today : requestedDate) + DAY_MS;
    const startDate = endDate - 7 * DAY_MS; // 7-day window to cover weekends/holidays

    const period1 = Math.floor(startDate / 1000);
    const period2 = Math.floor(endDate   / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.status(502).json({ message: 'Price data unavailable' });

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ message: 'No data for this symbol' });

    const currency = result.meta?.currency || '';

    // `price` stays in the asset's native currency (that is what the user sees on
    // the exchange and what we store); `fxRate`/`priceInr` give the INR booking.
    const withFx = async (price, actualDate) => {
      const fxRate = await fetchFxRate(currency, midnight(new Date(actualDate || date)));
      return {
        symbol, date, price, currency, actualDate,
        fxRate,
        priceInr: fxRate ? Math.round(price * fxRate * 100) / 100 : null,
      };
    };

    // For today, use the regularMarketPrice from meta
    if (isToday) {
      const price = result.meta?.regularMarketPrice;
      if (!price) return res.status(404).json({ message: 'Price unavailable' });
      return res.json(await withFx(price, null));
    }

    // For historical — find the last valid close on or before the requested date
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const endTs      = endDate / 1000;

    let price = null;
    let actualDate = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] < endTs && closes[i] != null) {
        price = Math.round(closes[i] * 100)/100;
        actualDate = toDateStr_from_ms(timestamps[i] * 1000);
        break;
      }
    }

    if (price === null) return res.status(404).json({ message: 'No price available for this date' });

    res.json(await withFx(price, actualDate));
  } catch (err) {
    console.error('Price fetch error:', err.message);
    res.status(500).json({ message: 'Price data unavailable' });
  }
});

// GET /api/market/ohlc?symbol=AAPL&days=30
// Returns OHLC candle data for a symbol over the given number of days.
// Interval is auto-selected: ≤2 days → 1h, else ≤365 → 1d, else 1wk.
router.get('/ohlc', async (req, res) => {
  const { symbol, days } = req.query;
  if (!symbol) return res.status(400).json({ message: 'symbol is required' });

  const daysNum = days ? parseInt(days, 10) : null;

  // Set Chart Interval
  let interval = '1d';
  if (daysNum && daysNum <= 2)          interval = '1h';
  else if (!daysNum || daysNum > 365)   interval = '1wk';

  // Set Chart Period
  const now = nowMs();
  const period2      = Math.floor(now / 1000);
  const period1  = daysNum
    ? Math.floor((now - daysNum * DAY_MS) / 1000)
    : Math.floor((now - 10 * 365 * DAY_MS) / 1000);  // 10 Years

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}`;
    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return res.status(502).json({ message: 'OHLC data unavailable' });

    const data   = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ message: 'No data for this symbol' });

    const timestamps = result.timestamp || [];
    const q          = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = q;

    const candles = timestamps
      .map((ts, i) => {
        const d = new Date(ts * 1000);
        const dateStr = (interval === '1h')
          ? `${d.toISOString().slice(0, 10)}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
          : d.toISOString().slice(0, 10);
        return {
          date:   dateStr,
          open:   open[i]   != null ? +open[i].toFixed(4)   : null,
          high:   high[i]   != null ? +high[i].toFixed(4)   : null,
          low:    low[i]    != null ? +low[i].toFixed(4)    : null,
          close:  close[i]  != null ? +close[i].toFixed(4)  : null,
          volume: volume[i] || 0,
        };
      })
      .filter(c => c.open != null && c.high != null && c.low != null && c.close != null);

    res.json({ symbol, interval, candles });
  } catch (err) {
    console.error('OHLC fetch error:', err.message);
    res.status(500).json({ message: 'OHLC data unavailable' });
  }
});

module.exports = router;
