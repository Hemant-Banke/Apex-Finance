const mongoose = require('mongoose');
const { TRANSACTION_TYPES, ASSET_TYPES } = require('../utils/constants');

const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true
  },
  type: {
    type: String,
    required: [true, 'Please specify transaction type'],
    enum: TRANSACTION_TYPES
  },
  category: {
    type: String,
    default: 'general',
    trim: true
  },
  amount: {
    type: Number,
    required: [true, 'Please add an amount']
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  // Asset-related fields (for buy/sell transactions)
  assetSymbol: {
    type: String,
    trim: true,
    uppercase: true
  },
  assetName: {
    type: String,
    trim: true
  },
  assetType: {
    type: String,
    enum: ASSET_TYPES
  },
  units: {
    type: Number
  },
  // NOTE: `pricePerUnit` is in the asset's NATIVE currency; `amount` is always INR.
  pricePerUnit: {
    type: Number
  },
  // Quote currency, only set when it isn't INR (e.g. 'USD' for a US stock).
  currency: {
    type: String,
    trim: true,
    uppercase: true
  },
  // INR per one unit of `currency` on the transaction date — the rate `amount`
  // was booked at. Stored so the booking stays auditable and reproducible.
  fxRate: {
    type: Number
  },
  // Purity of a physical metal ('22K', '925', …). Units are grams; the market
  // quote is per gram of pure metal and is scaled by this.
  purity: {
    type: String,
    trim: true
  },
  // Annual percentage — a coupon rate for FD/bond/EPF, an expected return for
  // any other unlisted asset. Used to accrue a price when there is no quote.
  rate: {
    type: Number
  },
  usesCashBalance: {
    type: Boolean,
    default: false
  },
  // Transfer-related
  toAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 100
  }
}, {
  timestamps: true
});

// Index for efficient queries
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ account: 1, date: -1 });
transactionSchema.index({ user: 1, type: 1 });
transactionSchema.index({ user: 1, assetSymbol: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
