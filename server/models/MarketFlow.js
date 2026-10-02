const mongoose = require('mongoose');

/**
 * One trading day of "where the big money went" in Indian equities — a shared CACHE, like
 * `mfschemes`: no `user` field, safe to drop, rebuilt on the next refresh.
 *
 * It exists because every upstream only ever shows a WINDOW. NSE's FII/DII endpoint
 * returns today and nothing else; the 30-day history page shows thirty days and forgets
 * the thirty-first. Keeping each day as it is seen is the only way the page can ever show
 * a longer run than the source does — so the history accumulates here, a day at a time.
 *
 * All money is ₹ CRORE, as the exchanges publish it (converting to rupees would only
 * produce eleven-digit numbers the UI then has to shrink back). Every block is optional
 * and written with `$set` per field, because the sources publish on different schedules
 * and must never clobber each other: the participant OI file can land before or after
 * the provisional cash figures.
 */
const side = { buy: Number, sell: Number, net: Number };

/** Open interest by participant, in CONTRACTS (NSE's own unit for this file). */
const participant = {
  idxFutLong: Number, idxFutShort: Number,
  stkFutLong: Number, stkFutShort: Number,
  idxCallLong: Number, idxPutLong: Number, idxCallShort: Number, idxPutShort: Number,
};

const marketFlowSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },   // "YYYY-MM-DD", the trading day

  // Provisional cash-market activity (NSE + BSE + MSEI), as published that evening.
  fii: side,
  dii: side,

  // FII activity in derivatives — net ₹ crore per segment.
  fiiDeriv: { idxFut: Number, idxOpt: Number, stkFut: Number, stkOpt: Number },

  // Domestic mutual funds, as reported to SEBI — the channel retail SIP money arrives by.
  mf: { equity: Number, debt: Number },

  // Participant-wise open interest: Client (retail + HNI), DII, FII, Pro (prop desks).
  positioning: { client: participant, dii: participant, fii: participant, pro: participant },
}, { timestamps: true });

module.exports = mongoose.model('MarketFlow', marketFlowSchema);
