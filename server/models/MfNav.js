const mongoose = require('mongoose');

/**
 * Cached daily NAV history for one mutual-fund scheme.
 *
 * mfapi serves a scheme's ENTIRE history in a single ~128 KB response, so we store
 * the whole thing rather than windows: a store rebuild replaying years of holdings
 * then costs no network at all, and only a stale tail needs refreshing.
 *
 * `navs` is { [utcMidnightMs]: nav } — keyed exactly like the price maps in
 * marketDataService, so it drops straight into buildAssetTS's day lookups.
 */
const mfNavSchema = new mongoose.Schema({
  schemeCode: { type: String, required: true, unique: true },
  navs:       { type: mongoose.Schema.Types.Mixed, default: {} },
  // Newest day present in `navs` — lets us tell "history is stale" from "the fund
  // simply did not publish on that day" (weekend / holiday).
  latestDay:  { type: Number },
  fetchedAt:  { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('MfNav', mfNavSchema);
