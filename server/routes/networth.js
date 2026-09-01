const express = require('express');
const DailyNetWorth = require('../models/DailyNetWorth');

const { protect }             = require('../middleware/auth');
const { asyncHandler }        = require('../middleware/asyncHandler');
const { DAY_MS }              = require('../utils/constants');
const { midnight, toDateStr, todayStr, todayMs } = require('../utils/helpers');
const { sliceStartIndex }     = require('../utils/tsHelpers');
const dvService               = require('../services/dailyValueService');
const { getAllAccountsAssetBalance } = require('../services/accountBalance');

const router = express.Router();
router.use(protect);

/**
 * GET /api/networth/daily?days=N&growth=true
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
 * `growth=true` swaps every point for a growth-only index (base 100 at the series' own
 * first day, i.e. the user's very first transaction) — the complete series with every
 * later income/expense/uncashed trade subtracted back out, so what is left is what the
 * money itself did. See dailyValueService.computeGrowthIndex.
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

  const { value: assetValue } = await getAllAccountsAssetBalance(req.user, false);
  const todayValue = (doc.lastCashValue || 0) + assetValue;
  result.push({ date: todayStr(), value: todayValue });

  if (req.query.growth === 'true') {
    // Always indexed from the TRUE start of history, regardless of the `days` window
    // being displayed — zooming into the last month shows where the index sits today,
    // not a rebase to 100 for that month (the standard convention for a growth chart).
    const fullValuesTS = doc.valuesTS.concat([todayValue]);
    const growthTS = await dvService.computeGrowthIndex(req.user._id, startMs, todayMs(), fullValuesTS);
    for (const row of result) {
      const idx = Math.round((midnight(row.date) - startMs) / DAY_MS);
      row.value = growthTS[idx] ?? null;
    }
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
