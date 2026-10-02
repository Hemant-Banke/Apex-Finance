const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest } = require('../utils/httpError');
const indiaMarket = require('../services/indiaMarketService');
const sectorService = require('../services/sectorService');
const stockService = require('../services/stockService');
const assetService = require('../services/assetService');

/**
 * The market as a whole — not the user's money. Distinct from `/api/market`, which
 * looks up and prices ONE instrument for a transaction; everything here is a view of
 * the Indian market for the Markets page. See indiaMarketService.
 */
const router = express.Router();
router.use(protect);

/** `?fresh=true` — the page's refresh button; services honour it subject to a throttle. */
const fresh = (req) => ({ fresh: req.query.fresh === 'true' });

// @route GET /api/markets/overview
// Headline indices, other asset classes (gold, silver, G-Sec, rupee, crude, bitcoin)
// and market breadth — each with 1D / 1W / 1M / 1Y changes.
router.get('/overview', asyncHandler(async (req, res) => {
  res.json(await indiaMarket.getOverview(fresh(req)));
}));

// @route GET /api/markets/sectors
// The Nifty 500 stock by stock: every sector (cap-weighted returns, total cap) and every
// stock (sector, cap, 1D/1W/1M/1Y) — the client draws the map and each sector's drill-down
// from this one payload.
router.get('/sectors', asyncHandler(async (req, res) => {
  res.json(await sectorService.getSectors(fresh(req)));
}));

// @route GET /api/markets/stocks/:symbol
// One NSE-listed company in full for its page: quote, price history against the Nifty 50,
// computed performance and risk, valuation, financials, analysts, ownership and peers.
router.get('/stocks/:symbol', asyncHandler(async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  // NSE symbols are letters, digits, '&' and '-' ("M&M", "BAJAJ-AUTO"). Anything else is
  // not a symbol, and must not reach a URL we build.
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw badRequest('Not an NSE symbol');
  res.json(await stockService.getStock(symbol, fresh(req)));
}));

// @route GET /api/markets/assets/:symbol
// Any other priceable instrument — an index, gold/silver (`_METAL:*`), a coin, a US
// share, an ETF, an Indian fund (`AMFI:<code>`): quote, returns against a benchmark, and
// risk, from its price history alone. See assetService.
router.get('/assets/:symbol', asyncHandler(async (req, res) => {
  const symbol = String(req.params.symbol || '');
  // Yahoo's symbol alphabet (^NSEI, GC=F, BTC-USD, RELIANCE.NS) plus our two namespaces.
  // Nothing else may reach a URL we build.
  if (!/^[A-Za-z0-9^.=:_&-]{1,40}$/.test(symbol)) throw badRequest('Not a symbol');
  res.json(await assetService.getAsset(symbol, fresh(req)));
}));

// @route GET /api/markets/flows?sessions=N
// FII / DII cash, FII derivatives, mutual-fund flows (₹ crore) and participant-wise
// index-futures positioning, from the accumulated MarketFlow cache.
router.get('/flows', asyncHandler(async (req, res) => {
  const sessions = Math.max(5, Math.min(parseInt(req.query.sessions, 10) || 60, 250));
  res.json(await indiaMarket.getFlows(sessions, fresh(req)));
}));

module.exports = router;
