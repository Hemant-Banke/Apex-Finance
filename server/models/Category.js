const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, trim: true },
  name:        { type: String, required: true, trim: true },
  emoji:       { type: String, default: '📋' },
  level:       { type: String, enum: ['primary', 'secondary'], required: true },
  parent:      { type: String, default: null },   // code of parent primary category
  applicableTo: [{ type: String, enum: ['income', 'expense'] }],
});

module.exports = mongoose.model('Category', categorySchema);
