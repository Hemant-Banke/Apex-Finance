const mongoose = require('mongoose');
const { ACCOUNT_TYPES } = require('../utils/constants');

const accountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add an account name'],
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  type: {
    type: String,
    required: [true, 'Please specify account type'],
    enum: ACCOUNT_TYPES
  },
  description: {
    type: String,
    trim: true,
    maxlength: 100
  },
  currency: {
    type: String,
    default: 'INR'
  },
  isDebt: {
    type: Boolean,
    default: false
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto set isDebt for debt accounts
accountSchema.pre('save', function(next) {
  if (this.type === 'debt') {
    this.isDebt = true;
  }
  next();
});

module.exports = mongoose.model('Account', accountSchema);
