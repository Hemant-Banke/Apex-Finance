const mongoose = require('mongoose');

const userCategorySchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  code:        { type: String, required: true, trim: true },
  name:        { type: String, required: true, trim: true },
  emoji:       { type: String, default: '📋' },
  level:       { type: String, enum: ['primary', 'secondary'], required: true },
  parent:      { type: String, default: null },   // code of parent primary category
  applicableTo: [{ type: String, enum: ['income', 'expense'] }],
}, { timestamps: true });

userCategorySchema.index({ user: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('UserCategory', userCategorySchema);
