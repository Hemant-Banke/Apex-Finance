const mongoose = require('mongoose');
const { TRANSACTION_TYPES, ASSET_TYPES } = require('../utils/constants');
const { FREQUENCIES } = require('../utils/recurrence');

/**
 * A recurring transaction — a "subscription".
 *
 * It is a TEMPLATE, not a transaction: each due occurrence is materialised into a
 * real `Transaction` (see subscriptionService), which is what every store, balance
 * and net-worth figure is built from. Nothing in the app values a subscription
 * directly — "everything is a transaction" still holds.
 *
 * The INVARIANT is what stays fixed each period:
 *   - cash (income/expense/transfer) → always `amount` (₹500 Netflix every month).
 *   - assets → either `amount` (a ₹5,000 SIP buys however many units the NAV allows
 *     that day) or `units` (10 shares every month, costing whatever they cost).
 * The other side is derived from the price on the occurrence's own date.
 */
const subscriptionSchema = new mongoose.Schema({
  account:   { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  toAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },   // transfers

  type:     { type: String, required: true, enum: TRANSACTION_TYPES },
  category: { type: String, trim: true },
  notes:    { type: String, trim: true, maxlength: 100 },

  // ── Schedule ──────────────────────────────────────────────────────────────
  startDate: { type: Date, required: true },
  endDate:   { type: Date, default: null },        // null → ongoing
  frequency: { type: String, required: true, enum: FREQUENCIES },

  // ── Invariant ─────────────────────────────────────────────────────────────
  invariant: { type: String, enum: ['amount', 'units'], default: 'amount' },
  amount:    { type: Number },   // set when invariant === 'amount'
  units:     { type: Number },   // set when invariant === 'units'

  // ── Asset template (buy/sell only) ────────────────────────────────────────
  /**
   * A fallback price for assets nothing can quote — an EPF/NPS balance (₹1 a "unit"),
   * an FD, a property. Without it a schedule on such an asset would price to nothing
   * and skip every occurrence. A quotable asset ignores this and is priced on the day.
   */
  pricePerUnit:    { type: Number },
  assetSymbol:     { type: String, trim: true, uppercase: true },
  assetName:       { type: String, trim: true },
  assetType:       { type: String, enum: ASSET_TYPES },
  purity:          { type: String, trim: true },
  rate:            { type: Number },
  currency:        { type: String, trim: true, uppercase: true },
  usesCashBalance: { type: Boolean, default: false },

  // ── Bookkeeping ───────────────────────────────────────────────────────────
  // The last occurrence already materialised. Occurrence generation is exclusive of
  // this day, so a run can never double-book — it is the idempotency key.
  lastRunDate: { type: Date, default: null },
  active:      { type: Boolean, default: true },
}, { timestamps: true });

/** One doc per user, holding the array — as with the other per-user stores. */
const userSubscriptionsSchema = new mongoose.Schema({
  user:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  subscriptions: { type: [subscriptionSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', userSubscriptionsSchema);
