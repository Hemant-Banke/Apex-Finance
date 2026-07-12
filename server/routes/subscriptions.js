const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');

const subService = require('../services/subscriptionService');
const txService  = require('../services/transactionService');
const { FREQUENCIES } = require('../utils/recurrence');
const { TRANSACTION_TYPES } = require('../utils/constants');

const router = express.Router();
router.use(protect);

const RECURRING_TYPES = TRANSACTION_TYPES.filter(t => !t.startsWith('_'));

// @route   GET /api/subscriptions
router.get('/', async (req, res) => {
  try {
    res.json(await subService.getSubscriptions(req.user._id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/subscriptions
// Creates the schedule and fires every occurrence already in the past. Those
// back-dated transactions go through the normal mutation path, so the stores absorb
// them exactly as if each had been entered by hand.
router.post('/', [
  body('account').notEmpty().withMessage('Account is required'),
  body('type').isIn(RECURRING_TYPES).withMessage('Invalid transaction type'),
  body('frequency').isIn(FREQUENCIES).withMessage('Invalid frequency'),
  body('startDate').notEmpty().withMessage('Start date is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, invariant, amount, units } = req.body;
    const isAsset = type === 'buy' || type === 'sell';

    // The invariant is what stays fixed each period, so it must actually be set.
    if (isAsset && invariant === 'units') {
      if (!(Number(units) > 0)) return res.status(400).json({ message: 'Units are required for a unit-based schedule' });
    } else if (!(Number(amount) > 0)) {
      return res.status(400).json({ message: 'Amount is required' });
    }
    if (type === 'transfer' && !req.body.toAccount) {
      return res.status(400).json({ message: 'Transfer requires a destination account' });
    }

    const { subscription, created } = await subService.createSubscription(req.user._id, req.body);

    // Back-dated occurrences land in the stores like any other mutation.
    if (created.length) {
      try { await txService.onCreateMany(req.user._id, created); } catch (e) { console.error(e); }
    }

    res.status(201).json({ subscription, executed: created.length });
  } catch (err) {
    console.error('Subscription create error:', err.message);
    res.status(400).json({ message: err.message || 'Failed to create subscription' });
  }
});

// @route   PATCH /api/subscriptions/:id  — pause / resume
router.patch('/:id', async (req, res) => {
  try {
    const sub = await subService.setActive(req.user._id, req.params.id, !!req.body.active);
    if (!sub) return res.status(404).json({ message: 'Subscription not found' });
    res.json(sub);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/subscriptions/:id
// Only stops FUTURE occurrences — transactions already materialised are real and stay.
router.delete('/:id', async (req, res) => {
  try {
    const ok = await subService.deleteSubscription(req.user._id, req.params.id);
    if (!ok) return res.status(404).json({ message: 'Subscription not found' });
    res.json({ message: 'Subscription removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
