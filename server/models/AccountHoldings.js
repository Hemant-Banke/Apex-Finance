const mongoose = require('mongoose');

// The shape of each holding is:
//   { units, avgCostPerUnit, totalInvested, firstPurchaseDate,
//     lastTransactionDate, name, type }
const accountHoldingsSchema = new mongoose.Schema({
  account:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  holdings:    { type: [mongoose.Schema.Types.Array], default: [] },
}, { timestamps: true });

accountHoldingsSchema.index({ user: 1 });

module.exports = mongoose.model('AccountHoldings', accountHoldingsSchema);
