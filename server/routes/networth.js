const express = require('express');
const DailyNetWorth = require('../models/DailyNetWorth');
const { protect } = require('../middleware/auth');
const { ensureUpToToday, rebuild, toDateStr, DAY_MS } = require('../services/dailyValueService');
const holdingsService = require('../services/holdingsService');

const router = express.Router();
router.use(protect);

/**
 * GET /api/networth/daily?days=N
 * Returns [{ date: 'YYYY-MM-DD', value: number }, ...].
 */
router.get('/daily', async (req, res) => {
  try {
    const doc = await DailyNetWorth.findOne({ user: req.user._id }).lean();
    if (!doc || !doc.values.length) return res.json([]);

    const docStartMs = doc.startDate.getTime();
    let sliceStart   = 0;

    if (req.query.days) {
      const cutoffMs = doc.endDate.getTime() - (parseInt(req.query.days) - 1) * DAY_MS;
      if (cutoffMs > docStartMs) {
        sliceStart = Math.round((cutoffMs - docStartMs) / DAY_MS);
      }
    }

    const result = [];
    for (let i = Math.max(0, sliceStart); i < doc.values.length; i++) {
      result.push({ date: toDateStr(new Date(docStartMs + i * DAY_MS)), value: doc.values[i] });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/networth/ensure
 * Extends all stores (networth + all account) to today with carry-forward.
 * Call on session start.
 */
router.post('/ensure', async (req, res) => {
  try {
    await ensureUpToToday(req.user._id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/networth/rebuild
 * Full rebuild of all stores from transactions (recovery / admin).
 */
router.post('/rebuild', async (req, res) => {
  try {
    await Promise.all([
      rebuild(req.user._id),
      holdingsService.rebuildAllForUser(req.user._id)
    ]);
    res.json({ message: 'All stores rebuilt' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
