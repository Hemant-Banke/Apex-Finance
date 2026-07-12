const express = require('express');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const Category = require('../models/Category');
const UserCategory = require('../models/UserCategory');

const router = express.Router();
router.use(protect);

// GET /api/categories?type=expense|income
router.get('/', asyncHandler(async (req, res) => {
  const { type } = req.query;
  const filter = type ? { applicableTo: type } : {};

  const [defaults, userDefined] = await Promise.all([
    Category.find(filter).lean(),
    UserCategory.find({ user: req.user._id, ...filter }).lean(),
  ]);

  const all = [...defaults, ...userDefined];
  const secondary = {};
  for (const s of all.filter(c => c.level === 'secondary')) {
    (secondary[s.parent] ??= []).push(s);
  }

  res.json({ primary: all.filter(c => c.level === 'primary'), secondary });
}));

// POST /api/categories — create a user-defined category
router.post('/', asyncHandler(async (req, res) => {
  const { name, emoji, level, parent, applicableTo } = req.body;
  if (!name || !level) throw badRequest('name and level are required');
  if (level === 'secondary' && !parent) {
    throw badRequest('parent is required for secondary categories');
  }

  // The `tpu_`/`tsu_` prefix is what marks a category as the user's own (and so
  // deletable); the random suffix keeps two same-named categories distinct.
  const slug   = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 18);
  const rand   = Math.random().toString(36).slice(2, 6);
  const prefix = level === 'primary' ? 'tpu_' : 'tsu_';

  try {
    const cat = await UserCategory.create({
      user:         req.user._id,
      code:         `${prefix}${slug}_${rand}`,
      name:         name.trim(),
      emoji:        emoji || '📋',
      level,
      parent:       parent || null,
      applicableTo: Array.isArray(applicableTo) ? applicableTo : [],
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 11000) throw badRequest('Category already exists');
    throw err;
  }
}));

// PATCH /api/categories/:code — rename / re-emoji a user-defined category
//
// The `code` is NOT regenerated: transactions already filed under it reference it, and
// changing it would orphan them. Only the label and the emoji move.
// Built-in categories are shared across users and are not editable — the filter on
// `user` is what enforces that (a default category has no `user`).
router.patch('/:code', asyncHandler(async (req, res) => {
  const { name, emoji } = req.body;
  const update = {};
  if (typeof name === 'string' && name.trim())   update.name  = name.trim();
  if (typeof emoji === 'string' && emoji.trim()) update.emoji = emoji.trim();
  if (!Object.keys(update).length) throw badRequest('Nothing to update');

  const cat = await UserCategory.findOneAndUpdate(
    { code: req.params.code, user: req.user._id },
    { $set: update },
    { new: true },
  );
  if (!cat) throw notFound('Category not found');
  res.json(cat);
}));

// DELETE /api/categories/:code — delete a user-defined category
router.delete('/:code', asyncHandler(async (req, res) => {
  const cat = await UserCategory.findOneAndDelete({ code: req.params.code, user: req.user._id });
  if (!cat) throw notFound('Category not found');
  res.json({ message: 'Deleted' });
}));

module.exports = router;
