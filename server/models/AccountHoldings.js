const mongoose = require('mongoose');

// Using Mixed type instead of Map<holdingSchema> to avoid Mongoose Map
// serialization issues with findOneAndUpdate / $set.  The shape of each
// entry is:
//   { qty, avgCostPerUnit, totalInvested, firstPurchaseDate,
//     lastTransactionDate, name, type }
const accountHoldingsSchema = new mongoose.Schema({
  account:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  holdings:    { type: mongoose.Schema.Types.Mixed, default: {} },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

accountHoldingsSchema.index({ user: 1 });

module.exports = mongoose.model('AccountHoldings', accountHoldingsSchema);
