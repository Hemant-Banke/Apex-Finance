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
  pricePerUnit: {
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
