const express = require('express');
const DailyNetWorth = require('../models/DailyNetWorth');

const { protect }             = require('../middleware/auth');
const { asyncHandler }        = require('../middleware/asyncHandler');
const { DAY_MS }              = require('../utils/constants');
const { midnight, toDateStr, todayMs } = require('../utils/helpers');
const { sliceStartIndex, tsConcat } = require('../utils/tsHelpers');
const dvService               = require('../services/dailyValueService');
const { getAllAccountsAssetBalance } = require('../services/accountBalance');

const router = express.Router();
router.use(protect);

/**
 * GET /api/networth/daily?days=N&growth=true&basis=assets
 *
 * `basis=assets` charts the asset book alone (Σ account assetTS, no cash or debt); its
 * growth view treats every buy/sell as the flow.
 *
 * The history comes from `valuesTS`, which is a PURE T-1 series: both cash and assets as
 * they stood at the last close.
 *
 * Today is then always appended, at T cash + the T-1 asset close — leaving it off was a
 * bug. A "settled balance" in this app already means T cash + the T-1 close (see
 * `settledValue`), so the series ending at a pure T-1 point made the chart disagree with
 * the headline above it — anything that moved cash TODAY (an account opened, a salary in)
 * was in the headline and missing from the line. The chart must end where the number says
 * it ends.
 *
 * `growth=true` swaps every point for a growth-only index (chained from the first day of
 * history; PriceGrapher rebases the visible window to 100) — the complete series with every
 * later income/expense/uncashed trade subtracted back out, so what is left is what the
 * money itself did. See dailyValueService.computeGrowthIndex.
 */
router.get('/daily', asyncHandler(async (req, res) => {
  const assetsOnly = req.query.basis === 'assets';
  let valuesTS, startMs, lastCashValue = 0;
  if (assetsOnly) {
    ({ valuesTS, startMs } = await dvService.assetTotalSeries(req.user._id));
  } else {
    const doc = await DailyNetWorth.findOne({ user: req.user._id }).lean();
    valuesTS      = doc?.valuesTS || [];
    startMs       = doc && midnight(doc.startDate);
    lastCashValue = doc?.lastCashValue || 0;
  }
  if (!valuesTS.length) return res.json([]);

  // Live prices when asked: on the settled basis today's assets ARE yesterday's close, so
  // today's point could never move and a 1D growth view read zero.
  const { value: assetValue } = await getAllAccountsAssetBalance(req.user, req.query.fetchLatestBal === 'true');
  const today = todayMs();

  // A store not yet extended ends days short of today: carry its last value across the
  // gap so every point sits at its own day offset (or today's growth point fell off the end).
  const { result: series } = tsConcat(valuesTS, [lastCashValue + assetValue], startMs, today,
    startMs + (valuesTS.length - 1) * DAY_MS, today);

  // Growth is indexed over the FULL history; the client rebases the visible window to 100.
  const values = req.query.growth === 'true'
    ? await dvService.computeGrowthIndex(req.user._id, startMs, today, series, null, assetsOnly)
    : series;

  const result = [];
  for (let i = sliceStartIndex(startMs, today, req.query.days); i < values.length; i++) {
    result.push({ date: toDateStr(startMs + i * DAY_MS), value: values[i] ?? null });
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
