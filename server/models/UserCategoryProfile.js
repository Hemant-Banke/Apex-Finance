const mongoose = require('mongoose');

/**
 * A per-user, continuously-aggregated model of HOW the user categorizes their
 * transactions — learned from every income/expense they save with a category.
 *
 *   tokens     — { [merchantToken]: { [categoryCode]: count } }
 *                merchant/receiver word → the categories it has been filed under.
 *   categories — { [categoryCode]: { count, amtSum, amtSqSum, dow: [7] } }
 *                per-category amount statistics and day-of-week distribution,
 *                for pattern inference (e.g. rent ~ large monthly, cabs ~ small weekday).
 *
 * Updated incrementally (never recomputed on read); used to predict categories
 * decisively and to give the LLM user-specific context.
 */
const userCategoryProfileSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  tokens:      { type: mongoose.Schema.Types.Mixed, default: {} },
  categories:  { type: mongoose.Schema.Types.Mixed, default: {} },
  sampleCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('UserCategoryProfile', userCategoryProfileSchema);
