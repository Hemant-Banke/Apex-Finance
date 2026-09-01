const mongoose = require('mongoose');

/**
 * A per-user, continuously-aggregated model of HOW the user categorizes their
 * transactions — learned from every income/expense they save with a real category
 * (Misc/uncategorized rows carry no signal and are skipped).
 *
 * One profile PER CATEGORY, not a global merchant index — every feature the
 * classifier compares a new transaction against lives together:
 *
 *   merchants — { [token]: count }         merchant/receiver words seen for this category
 *   dow       — [7]                        day-of-week counts (0=Sun, UTC)
 *   dom       — [31]                       day-of-month counts (index 0 = the 1st)
 *   count, amtSum, amtSqSum                → mean = amtSum/count, std from amtSqSum
 *   firstDate, lastDate                    ms — bounds the recurrence, for frequency
 *
 * Updated incrementally (never recomputed on read); used to predict categories by
 * closest similarity across these dimensions, and to give the LLM user-specific context.
 */
const userCategoryProfileSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  categories:  { type: mongoose.Schema.Types.Mixed, default: {} },
  sampleCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('UserCategoryProfile', userCategoryProfileSchema);
