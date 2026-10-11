const mongoose = require('mongoose');

/**
 * The latest quote for one Yahoo symbol, in its NATIVE currency — the live counterpart of
 * `PriceHistory`, which holds settled closes only. A shared cache with no `user` field:
 * safe to drop, refilled on the next live request.
 *
 * `day` is the IST date the quote was fetched on; a quote from an earlier day is never
 * served as current (yesterday's last price is a close, and PriceHistory owns closes).
 */
const currentPriceSchema = new mongoose.Schema({
  symbol:        { type: String, required: true, unique: true },
  price:         { type: Number, required: true },
  previousClose: { type: Number },   // the session before the quote's own, for a day's move
  day:           { type: String, required: true },
  fetchedAt:     { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('CurrentPrice', currentPriceSchema);
