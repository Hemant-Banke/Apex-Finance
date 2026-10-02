const mongoose = require('mongoose');

/**
 * Cached daily closes for one Yahoo symbol (stocks, ETFs, crypto, FX, metal spots), in its
 * NATIVE currency. A shared cache with no `user` field — safe to drop, rebuilt on demand.
 *
 * `closes` is { [utcMidnightMs]: close }. `from`/`to` are the days a SUCCESSFUL fetch has
 * covered, so a day inside them with no close was a closed market, not a missing fetch.
 */
const priceHistorySchema = new mongoose.Schema({
  symbol:    { type: String, required: true, unique: true },
  assetType: { type: String },
  currency:  { type: String },   // Yahoo's quote currency, for callers converting to INR
  closes:    { type: mongoose.Schema.Types.Mixed, default: {} },
  from:      { type: Number },
  to:        { type: Number },
  fetchedAt: { type: Date },
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
