const mongoose = require('mongoose');

// One observation of an economic series (reserves, BoP, FPI, GDP, rates). A shared cache that accumulates history the sources do not keep.
const macroPointSchema = new mongoose.Schema({
  series: { type: String, required: true },
  date: { type: String, required: true },   // "YYYY-MM-DD", the END of the period it covers
  freq: { type: String, enum: ['D', 'W', 'F', 'M', 'Q'], required: true },
  value: { type: Number, required: true },
  src: String,
}, { timestamps: true });

macroPointSchema.index({ series: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('MacroPoint', macroPointSchema);
