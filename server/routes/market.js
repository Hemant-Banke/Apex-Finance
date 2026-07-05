const express = require('express');
const { protect } = require('../middleware/auth');
const { DAY_MS, YF_HEADERS } = require('../utils/constants');
const { mapQuoteType, nowMs, toDateStr_from_ms, todayMs } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

// GET /api/market/search?q=QUERY
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  if (q.trim().length < 1) return res.json([]);

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`;
    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.status(502).json({ message: 'Market data unavailable' });

    const data = await resp.json();
    const quotes = (data.quotes || [])
      .filter(q => q.symbol && q.quoteType !== 'INDEX')
      .map(q => ({
        symbol:   q.symbol,
        name:     q.shortname || q.longname || q.symbol,
        type:     mapQuoteType(q.quoteType),
        exchange: q.exchDisp || q.exchange || '',
        currency: q.currency || ''
      }));

    res.json(quotes);
  } catch (err) {
    console.error('Market search error:', err.message);
    res.status(500).json({ message: 'Market search unavailable' });
  }
});

// GET /api/market/price?symbol=AAPL&date=2024-01-15
// Returns the close price on or before the requested date (handles weekends/holidays).
// If date is today or future, returns current price.
router.get('/price', async (req, res) => {
  const { symbol, date } = req.query;
  if (!symbol || !date) return res.status(400).json({ message: 'symbol and date are required' });

  try {
    const requestedDate = new Date(date).getTime();
    const today         = todayMs();

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

    // For today, use the regularMarketPrice from meta
    if (isToday) {
      const price = result.meta?.regularMarketPrice;
      if (!price) return res.status(404).json({ message: 'Price unavailable' });
      return res.json({ symbol, date, price, currency });
    }

    // For historical — find the last valid close on or before the requested date
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const endTs      = endDate / 1000;

    let price = null;
    let actualDate = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] < endTs && closes[i] != null) {
        price = closes[i];
        actualDate = toDateStr_from_ms(timestamps[i] * 1000);
        break;
      }
    }

    if (price === null) return res.status(404).json({ message: 'No price available for this date' });

    res.json({ symbol, date, price, currency, actualDate });
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
