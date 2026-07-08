const mongoose = require('mongoose');

// The shape of each holding is:
//   { assetSymbol, assetName, assetType, units, avgPricePerUnit, totalInvested,
//     firstPurchaseDate, lastTransactionDate }
const accountHoldingsSchema = new mongoose.Schema({
  account:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  holdings:    { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

accountHoldingsSchema.index({ user: 1 });

module.exports = mongoose.model('AccountHoldings', accountHoldingsSchema);
