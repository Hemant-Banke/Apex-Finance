const mongoose = require('mongoose');

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
    enum: ['income', 'expense', 'transfer', 'adjustment', 'buy', 'sell']
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
    enum: ['stock', 'bond', 'mutual_fund', 'etf', 'crypto', 'gold', 'commodity', 'epf_nps', 'fd', 'other', null]
  },
  units: {
    type: Number
  },
  pricePerUnit: {
    type: Number
  },
  // Transfer-related
  toAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500
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
