const express = require('express');
const DailyNetWorth = require('../models/DailyNetWorth');

const { protect }             = require('../middleware/auth');
const { asyncHandler }        = require('../middleware/asyncHandler');
const { DAY_MS }              = require('../utils/constants');
const { midnight, toDateStr, todayStr } = require('../utils/helpers');
const { sliceStartIndex }     = require('../utils/tsHelpers');
const dvService               = require('../services/dailyValueService');
const { getAllAccountsAssetBalance } = require('../services/accountBalance');

const router = express.Router();
router.use(protect);

/**
 * GET /api/networth/daily?days=N&fetchLatestBal=true
 * Returns [{ date, value }] from valuesTS (settled net worth, ending at T-1).
 * With fetchLatestBal, today is appended: T cash + live asset prices.
 */
router.get('/daily', asyncHandler(async (req, res) => {
  const doc = await DailyNetWorth.findOne({ user: req.user._id }).lean();
  if (!doc?.valuesTS?.length) return res.json([]);

  const startMs = midnight(doc.startDate);
  const from    = sliceStartIndex(startMs, midnight(doc.endDate), req.query.days);

  const result = [];
  for (let i = from; i < doc.valuesTS.length; i++) {
    result.push({ date: toDateStr(startMs + i * DAY_MS), value: doc.valuesTS[i] });
  }

  if (req.query.fetchLatestBal === 'true') {
    const { value: liveAssetValue } = await getAllAccountsAssetBalance(req.user, true);
    result.push({ date: todayStr(), value: (doc.lastCashValue || 0) + liveAssetValue });
  }

  res.json(result);
}));

/**
 * POST /api/networth/ensure
 * Carry every store forward to today (and fire anything a subscription owes).
 * Called on session start.
 */
router.post('/ensure', asyncHandler(async (req, res) => {
  await dvService.ensureUpToToday(req.user._id);
  res.json({ ok: true });
}));

/**
 * POST /api/networth/rebuild
 * Full rebuild of every store + holdings from transaction history.
 */
router.post('/rebuild', asyncHandler(async (req, res) => {
  await dvService.rebuildAll(req.user._id);
  res.json({ message: 'All stores rebuilt' });
}));

module.exports = router;
