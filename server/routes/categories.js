const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Category = require('../models/Category');
const UserCategory = require('../models/UserCategory');

// GET /api/categories?type=expense|income
router.get('/', protect, async (req, res) => {
  try {
    const { type } = req.query;
    const filter = type ? { applicableTo: type } : {};

    const [defaults, userDefined] = await Promise.all([
      Category.find(filter).lean(),
      UserCategory.find({ user: req.user._id, ...filter }).lean(),
    ]);

    const all = [...defaults, ...userDefined];
    const primary = all.filter(c => c.level === 'primary');
    const secondary = {};
    for (const s of all.filter(c => c.level === 'secondary')) {
      if (!secondary[s.parent]) secondary[s.parent] = [];
      secondary[s.parent].push(s);
    }

    res.json({ primary, secondary });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load categories' });
  }
});

// POST /api/categories — create a user-defined category
router.post('/', protect, async (req, res) => {
  try {
    const { name, emoji, level, parent, applicableTo } = req.body;
    if (!name || !level) {
      return res.status(400).json({ message: 'name and level are required' });
    }
    if (level === 'secondary' && !parent) {
      return res.status(400).json({ message: 'parent is required for secondary categories' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 18);
    const rand = Math.random().toString(36).slice(2, 6);
    const prefix = level === 'primary' ? 'tpu_' : 'tsu_';
    const code = `${prefix}${slug}_${rand}`;

    const cat = await UserCategory.create({
      user:         req.user._id,
      code,
      name:         name.trim(),
      emoji:        emoji || '📋',
      level,
      parent:       parent || null,
      applicableTo: Array.isArray(applicableTo) ? applicableTo : [],
    });

    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Category already exists' });
    }
    res.status(500).json({ message: 'Failed to create category' });
  }
});

// PATCH /api/categories/:code — rename / re-emoji a user-defined category
//
// The `code` is NOT regenerated: transactions already filed under it reference it, and
// changing it would orphan them. Only the label and the emoji move.
// Built-in categories are shared across users and are not editable — the filter on
// `user` is what enforces that (a default category has no `user`).
router.patch('/:code', protect, async (req, res) => {
  try {
    const { name, emoji } = req.body;
    const update = {};
    if (typeof name === 'string' && name.trim()) update.name = name.trim();
    if (typeof emoji === 'string' && emoji.trim()) update.emoji = emoji.trim();
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    const cat = await UserCategory.findOneAndUpdate(
      { code: req.params.code, user: req.user._id },
      { $set: update },
      { new: true },
    );
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update category' });
  }
});

// DELETE /api/categories/:code — delete a user-defined category
router.delete('/:code', protect, async (req, res) => {
  try {
    const cat = await UserCategory.findOneAndDelete({
      code: req.params.code,
      user: req.user._id,
    });
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete category' });
  }
});

module.exports = router;
