const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest } = require('../utils/httpError');
const { getPortfolio, getContribution, allocationByType } = require('../services/portfolioService');
const { getProfile } = require('../services/portfolioProfileService');
const { getCalendar } = require('../services/calendarService');
const { getMoneyFlow } = require('../services/moneyFlowService');
const dash = require('../services/dashboardService');
const { todayMs } = require('../utils/helpers');
const { DAY_MS } = require('../utils/constants');

const router = express.Router();
router.use(protect);

// @route   GET /api/dashboard/summary — net worth, its components and changes (dashboardService).
router.get('/summary', asyncHandler(async (req, res) => {
  res.json(await dash.getSummary(req.user._id, { live: req.query.fetchLatestBal === 'true' }));
}));

// @route   GET /api/dashboard/portfolio
// The book marked to market: per-holding value, unrealised & realised P&L, day change,
// weight — plus the same rolled up, and allocation by asset type at MARKET VALUE.
// Values are the last settled close (T-1), matching the stores — or live prices with
// `?fetchLatestBal=true`. `?account=<id>` scopes it to one account (the account page's holdings).
router.get('/portfolio', asyncHandler(async (req, res) => {
  const { account } = req.query;
  if (account && !mongoose.Types.ObjectId.isValid(account)) throw badRequest('Invalid account id');
  const live = req.query.fetchLatestBal === 'true';
  const { holdings, totals } = await getPortfolio(req.user._id, { live, account: account || null });
  const profile = await getProfile(holdings).catch((e) => { console.error(e); return null; });
  res.json({ holdings, totals, allocation: allocationByType(holdings), profile });
}));

// @route   GET /api/dashboard/contribution?days=N
//
// Who made the money over the last N days — each holding's gain, and its share of the
// portfolio's return over that window in percentage points. `days` omitted (or 0) means
// the whole history, where the same formula degenerates into lifetime total gain with
// realised profits included, because a position closed inside the window still counts.
//
// This cannot be served from `/portfolio`: the AVCO cost basis carries no date, so every
// figure derived from it is lifetime by construction. See `getContribution`.
router.get('/contribution', asyncHandler(async (req, res) => {
  const days = Math.max(0, Math.min(parseInt(req.query.days) || 0, 3650));
  const { account } = req.query;
  if (account && !mongoose.Types.ObjectId.isValid(account)) throw badRequest('Invalid account id');
  res.json(await getContribution(req.user._id, {
    fromMs: days ? todayMs() - days * DAY_MS : null,
    account: account || null,
    live: req.query.fetchLatestBal === 'true',
  }));
}));

// @route   GET /api/dashboard/calendar
// One row per calendar day — the asset book's gain and return, and income/expense — for
// the calendar view, which rolls days into months and years. See calendarService.
router.get('/calendar', asyncHandler(async (req, res) => {
  res.json(await getCalendar(req.user._id, { live: req.query.fetchLatestBal === 'true' }));
}));

// @route   GET /api/dashboard/holdings — the raw book at COST; `/portfolio` is the marked one.
router.get('/holdings', asyncHandler(async (req, res) => {
  res.json(await dash.getHoldingsAtCost(req.user._id));
}));

// @route   GET /api/dashboard/income-expense?months=N
router.get('/income-expense', asyncHandler(async (req, res) => {
  res.json(await dash.getIncomeExpense(req.user._id, req.query.months));
}));

// @route   GET /api/dashboard/money-flow?months=N
// Each month's money: where it came from and where it went (moneyFlowService), plus the window before.
router.get('/money-flow', asyncHandler(async (req, res) => {
  res.json(await getMoneyFlow(req.user._id, req.query.months));
}));

// @route   GET /api/dashboard/categories?type=expense|income&months=N — with the window before.
router.get('/categories', asyncHandler(async (req, res) => {
  res.json(await dash.getCategoryTotals(req.user._id, { type: req.query.type, months: req.query.months }));
}));

// @route   GET /api/dashboard/spending-profile?months=N — the inputs the FIRE page plans from.
router.get('/spending-profile', asyncHandler(async (req, res) => {
  res.json(await dash.getSpendingProfile(req.user._id, req.query.months));
}));

module.exports = router;
