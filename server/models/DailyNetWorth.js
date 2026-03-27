const mongoose = require('mongoose');

/**
 * One document per user.
 * values[i] = cumulative net worth on (startDate + i days).
 * startDate/endDate stored as UTC-midnight Date objects.
 * lastValue mirrors values[values.length-1] for fast current-networth reads.
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
  values:     { type: [Number], default: [] },
  lastValue:  { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('DailyNetWorth', dailyNetWorthSchema);
