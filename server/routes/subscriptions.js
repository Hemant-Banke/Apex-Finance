const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/asyncHandler');
const { badRequest, notFound }     = require('../utils/httpError');

const subService = require('../services/subscriptionService');
const txService  = require('../services/transactionService');
const { FREQUENCIES } = require('../utils/recurrence');
const { TRANSACTION_TYPES } = require('../utils/constants');

const router = express.Router();
router.use(protect);

/** The calibration types are internal — nothing may schedule one. */
const RECURRING_TYPES = TRANSACTION_TYPES.filter(t => !t.startsWith('_'));

// @route   GET /api/subscriptions
router.get('/', asyncHandler(async (req, res) => {
  res.json(await subService.getSubscriptions(req.user._id));
}));

// @route   POST /api/subscriptions
// Creates the schedule and fires every occurrence already in the past. Those
// back-dated transactions go through the normal mutation path, so the stores absorb
// them exactly as if each had been entered by hand.
router.post('/', [
  body('account').notEmpty().withMessage('Account is required'),
  body('type').isIn(RECURRING_TYPES).withMessage('Invalid transaction type'),
  body('frequency').isIn(FREQUENCIES).withMessage('Invalid frequency'),
  body('startDate').notEmpty().withMessage('Start date is required'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { type, invariant, amount, units, toAccount } = req.body;
  const isAsset = type === 'buy' || type === 'sell';

  // The invariant is what stays fixed each period, so it must actually be set.
  if (isAsset && invariant === 'units') {
    if (!(Number(units) > 0)) throw badRequest('Units are required for a unit-based schedule');
  } else if (!(Number(amount) > 0)) {
    throw badRequest('Amount is required');
  }
  if (type === 'transfer' && !toAccount) {
    throw badRequest('Transfer requires a destination account');
  }

  const { subscription, created } = await subService.createSubscription(req.user._id, req.body);

  // Back-dated occurrences land in the stores like any other mutation.
  if (created.length) {
    await txService.onCreateMany(req.user._id, created).catch(console.error);
  }

  res.status(201).json({ subscription, executed: created.length });
}));

// @route   PATCH /api/subscriptions/:id  — pause / resume
router.patch('/:id', asyncHandler(async (req, res) => {
  const sub = await subService.setActive(req.user._id, req.params.id, !!req.body.active);
  if (!sub) throw notFound('Subscription not found');
  res.json(sub);
}));

// @route   DELETE /api/subscriptions/:id
// Only stops FUTURE occurrences — transactions already materialised are real and stay.
router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await subService.deleteSubscription(req.user._id, req.params.id);
  if (!ok) throw notFound('Subscription not found');
  res.json({ message: 'Subscription removed' });
}));

module.exports = router;
