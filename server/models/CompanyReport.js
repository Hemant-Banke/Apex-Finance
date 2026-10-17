const mongoose = require('mongoose');

/**
 * What one filed annual report (BSE PDF or SEC 10-K) says about the business, as extracted
 * by the LLM. A shared cache with no `user` field: a filed report never changes, so it is
 * read once and kept for good. Safe to drop.
 */
const companyReportSchema = new mongoose.Schema({
  url:     { type: String, required: true, unique: true },
  symbol:  { type: String, index: true },
  source:  { type: String, enum: ['bse', 'sec'] },
  year:    { type: Number },
  extract: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('CompanyReport', companyReportSchema);
