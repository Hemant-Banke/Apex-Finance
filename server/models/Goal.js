const mongoose = require('mongoose');

const GOAL_TYPES = ['home', 'education', 'car', 'wedding', 'travel', 'emergency', 'business', 'retirement', 'other'];
const GOAL_PRIORITIES = ['essential', 'important', 'aspirational'];
const GOAL_STRATEGIES = ['auto', 'conservative', 'balanced', 'growth', 'aggressive'];

// A financial goal. A PLAN, not money: nothing here moves a balance; all maths is client-side (lib/goals).
const goalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  type: { type: String, enum: GOAL_TYPES, default: 'other' },
  priority: { type: String, enum: GOAL_PRIORITIES, default: 'important' },

  amount: { type: Number, required: true, min: 0 },       // cost in TODAY's rupees
  targetDate: { type: Date, required: true },
  inflation: { type: Number, min: 0, max: 30, default: 6 },

  saved: { type: Number, min: 0, default: 0 },            // set aside today
  monthly: { type: Number, min: 0, default: 0 },          // planned contribution a month
  stepUp: { type: Number, min: 0, max: 50, default: 0 },  // % rise in the contribution each year

  withdrawal: {
    mode: { type: String, enum: ['lump', 'spread'], default: 'lump' },
    years: { type: Number, min: 1, max: 40, default: 1 },  // spread: drawn evenly over this many years
  },
  strategy: { type: String, enum: GOAL_STRATEGIES, default: 'auto' },
  notes: { type: String, trim: true, maxlength: 200 },
}, { timestamps: true });

module.exports = mongoose.model('Goal', goalSchema);
module.exports.GOAL_TYPES = GOAL_TYPES;
module.exports.GOAL_PRIORITIES = GOAL_PRIORITIES;
module.exports.GOAL_STRATEGIES = GOAL_STRATEGIES;
