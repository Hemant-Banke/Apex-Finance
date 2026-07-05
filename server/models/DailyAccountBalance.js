const mongoose = require('mongoose');

/**
 * One document per account.
 * cashTS = cumulative cash balance time series. [0, ..., T]
 * assetTS = Asset balance time series. [0, ..., T-1]
 * Mirrors DailyNetWorth structure but scoped to a single account.
 * settledValue mirrors T-1 value for fast last balance reads.
 * lastCashValue mirrors T value for fast last cash balance reads.
 */
const dailyAccountBalanceSchema = new mongoose.Schema({
  account:   { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },
  assetTS:    { type: [Number], default: [] },
  cashTS:    { type: [Number], default: [] },
  settledValue: { type: Number, default: 0 },
  lastCashValue: { type: Number, default: 0 },
}, { timestamps: true });

dailyAccountBalanceSchema.index({ user: 1 });

module.exports = mongoose.model('DailyAccountBalance', dailyAccountBalanceSchema);
