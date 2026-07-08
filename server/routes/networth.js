const express = require('express');
const DailyNetWorth       = require('../models/DailyNetWorth');
const AccountHoldings     = require('../models/AccountHoldings');

const { protect }                   = require('../middleware/auth');
const { DAY_MS }                    = require('../utils/constants');
const { midnight, toDateStr, toDateStr_from_ms, todayStr } = require('../utils/helpers');
const dvService  = require('../services/dailyValueService');
const { getAllAccountsAssetBalance }         = require('../services/accountBalance');

const router = express.Router();
router.use(protect);

/**
 * GET /api/networth/daily?days=N&fetchLatestBal=true
 * Returns [{ date, value }] from valuesTS (complete settled NW, ends at T-1).
 * If fetchLatestBal=true, appends one more entry for today:
 *   value = lastCashValue (T cash) + live asset prices across all holdings.
 */
router.get('/daily', async (req, res) => {
  try {
    const userId = req.user._id;
    const doc    = await DailyNetWorth.findOne({ user: userId }).lean();
    if (!doc || !doc.valuesTS?.length) return res.json([]);

    const docStartMs = midnight(doc.startDate);
    let sliceStart   = 0;

    if (req.query.days) {
      const cutoffMs = midnight(doc.endDate) - (parseInt(req.query.days) - 1) * DAY_MS;
      if (cutoffMs > docStartMs) {
        sliceStart = Math.round((cutoffMs - docStartMs) / DAY_MS);
      }
    }

    const result = [];
    for (let i = Math.max(0, sliceStart); i < doc.valuesTS.length; i++) {
      result.push({ date: toDateStr_from_ms(docStartMs + i * DAY_MS), value: doc.valuesTS[i] });
    }

    // Append today's value if fetchLatestBal
    if (req.query.fetchLatestBal === 'true') {
      const { value: liveAssetValue } = await getAllAccountsAssetBalance(req.user, true);

      result.push({
        date:  todayStr(),
        value: (doc.lastCashValue || 0) + liveAssetValue,
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/networth/ensure
 * Carry-forward all cash stores to today. Call on session start.
 */
router.post('/ensure', async (req, res) => {
  try {
    await dvService.ensureUpToToday(req.user._id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/networth/rebuild
 * Full rebuild of all cash stores + holdings from transaction history.
 */
router.post('/rebuild', async (req, res) => {
  try {
    await dvService.rebuildAll(req.user._id);
    res.json({ message: 'All stores rebuilt' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
