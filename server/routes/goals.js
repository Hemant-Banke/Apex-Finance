const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const Goal = require('../models/Goal');

const router = express.Router();
router.use(protect);

const FIELDS = ['name', 'type', 'priority', 'amount', 'targetDate', 'inflation', 'saved', 'monthly', 'stepUp', 'withdrawal', 'strategy', 'notes'];
const pick = (body) => Object.fromEntries(FIELDS.filter(k => body[k] !== undefined).map(k => [k, body[k]]));

function validate(data, creating) {
  if (creating && !data.name?.trim()) throw badRequest('A goal needs a name');
  if (creating && !(data.amount > 0)) throw badRequest('A goal needs an amount');
  if (data.targetDate !== undefined && Number.isNaN(new Date(data.targetDate).getTime())) throw badRequest('Invalid target date');
  if (creating && !data.targetDate) throw badRequest('A goal needs a target date');
}

// GET /api/goals — sorted by target date
router.get('/', asyncHandler(async (req, res) => {
  res.json(await Goal.find({ user: req.user._id }).sort({ targetDate: 1 }).lean());
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = pick(req.body);
  validate(data, true);
  try {
    res.status(201).json(await Goal.create({ ...data, user: req.user._id }));
  } catch (err) {
    if (err.name === 'ValidationError') throw badRequest(err.message);
    throw err;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = pick(req.body);
  validate(data, false);
  try {
    const goal = await Goal.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, data, { new: true, runValidators: true });
    if (!goal) throw notFound('Goal not found');
    res.json(goal);
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') throw badRequest(err.message);
    throw err;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const goal = await Goal.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!goal) throw notFound('Goal not found');
  res.json({ ok: true });
}));

module.exports = router;
