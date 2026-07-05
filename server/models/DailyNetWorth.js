const mongoose = require('mongoose');

/**
 * One document per user.
 * valuesTS = cumulative net worth time series. [0, ..., T-1]
 * startDate/endDate stored as UTC-midnight Date objects.
 * settledValue mirrors T-1 value for fast last net-worth reads.
 * lastCashValue mirrors T value for fast last cash balance reads.
 */
const dailyNetWorthSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  startDate:  { type: Date, required: true },
  endDate:    { type: Date, required: true },
  valuesTS:     { type: [Number], default: [] },
  settledValue:  { type: Number, default: 0 },
  lastCashValue:  { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('DailyNetWorth', dailyNetWorthSchema);
