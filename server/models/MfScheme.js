const mongoose = require('mongoose');

/**
 * Cached metadata for an Indian mutual-fund scheme (AMFI scheme code, via mfapi).
 *
 * The point of this registry is the FULL plan name — "quant Small Cap Fund - Growth
 * Option - Direct Plan". Yahoo reports every plan of a fund under one identical name,
 * so Direct/Regular and Growth/IDCW are indistinguishable there; AMFI's scheme codes
 * make each plan its own instrument, which is what a portfolio actually holds.
 *
 * Populated lazily as schemes are looked up — there is no need to mirror all ~14,000.
 */
const mfSchemeSchema = new mongoose.Schema({
  schemeCode:   { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  /**
   * The name normalised for matching: lower-cased, punctuation stripped, and
   * compound words merged ("small cap" → "smallcap"). Search runs substring regexes
   * against THIS, so a user typing "bandhan small" still finds "BANDHAN SMALL CAP
   * FUND" and "quant smallcap" finds "quant Small Cap Fund".
   */
  nameNorm:     { type: String, index: true },
  fundHouse:    { type: String },
  category:     { type: String },
  isinGrowth:   { type: String, index: true, sparse: true },
  isinDivReinv: { type: String, index: true, sparse: true },
  // Most recently published NAV (and the day it is for).
  nav:          { type: Number },
  navDate:      { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('MfScheme', mfSchemeSchema);
