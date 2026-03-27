const mongoose = require('mongoose');

/**
 * One document per account.
 * values[i] = cumulative cash balance on (startDate + i days).
 * Mirrors DailyNetWorth structure but scoped to a single account.
 * lastValue mirrors values[values.length-1] for fast current-balance reads.
 */
const dailyAccountBalanceSchema = new mongoose.Schema({
  account:   { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },
  values:    { type: [Number], default: [] },
  lastValue: { type: Number, default: 0 }
}, { timestamps: true });

dailyAccountBalanceSchema.index({ user: 1 });

module.exports = mongoose.model('DailyAccountBalance', dailyAccountBalanceSchema);
