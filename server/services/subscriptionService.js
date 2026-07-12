/**
 * subscriptionService — recurring transactions ("subscriptions").
 *
 * A subscription is a TEMPLATE. Nothing values it directly: each due occurrence is
 * materialised into a real `Transaction`, and the stores are built from those, so
 * "everything is a transaction" still holds.
 *
 * Two paths, and they differ deliberately:
 *
 *   CREATE — every occurrence already in the past fires immediately, and the created
 *            transactions go through the normal mutation path (`updateForTxns`), so
 *            the stores absorb them like any other back-dated entry.
 *
 *   ONGOING — future occurrences are materialised by `materializeDue`, which is called
 *            from `ensureUpToToday`. It only INSERTS transactions; it never touches a
 *            store. `ensureUpToToday` then extends the stores to today and merges these
 *            rows through `updateForTxns`, the same path every other transaction takes.
 *
 *            The order matters and is not interchangeable — see the contract on
 *            `dailyValueService.ensureUpToToday`.
 */

const Subscription = require('../models/Subscription');
const Transaction  = require('../models/Transaction');
const Account      = require('../models/Account');

const { fetchPriceOnDate, fetchFxRate } = require('./marketDataService');
const { occurrencesBetween }            = require('../utils/recurrence');
const { midnight, todayMs }             = require('../utils/helpers');
const { ASSET_TRANSACTION_TYPES }       = require('../utils/constants');
const { normalizeCurrency }             = require('../utils/currency');

const isAsset = (type) => ASSET_TRANSACTION_TYPES.includes(type);

// ─── Reads ───────────────────────────────────────────────────────────────────

async function getSubscriptions(userId) {
  const doc = await Subscription.findOne({ user: userId }).lean();
  return doc?.subscriptions || [];
}

// ─── Materialising an occurrence ─────────────────────────────────────────────

/**
 * Build the transaction a subscription produces on a given day.
 *
 * Cash: the amount is the invariant, so the row is a straight copy.
 * Assets: one side is fixed and the other is derived from the price ON THAT DAY —
 *   invariant 'units'  → a fixed 10 units, costing whatever they cost.
 *   invariant 'amount' → a fixed ₹5,000, buying however many units the price allows.
 *
 * Returns null when the asset cannot be priced for that day — the occurrence is
 * skipped rather than booked at a made-up price.
 */
async function buildOccurrence(sub, userId, dayMs) {
  const base = {
    user:      userId,
    account:   sub.account,
    type:      sub.type,
    date:      new Date(dayMs),
    notes:     sub.notes || undefined,
    category:  sub.category || undefined,
    toAccount: sub.toAccount || undefined,
  };

  if (!isAsset(sub.type)) {
    return { ...base, amount: sub.amount };
  }

  const quote = await fetchPriceOnDate(
    { assetSymbol: sub.assetSymbol, assetType: sub.assetType, purity: sub.purity },
    dayMs,
  );

  // Nothing quotes an EPF balance or an FD — such a schedule carries its own price
  // (₹1 a "unit" for a balance asset), so it still fires every period.
  const priceNative = quote?.price ?? sub.pricePerUnit;
  if (!priceNative) return null;

  const currency = normalizeCurrency(quote?.currency || sub.currency);
  const fxRate   = currency ? await fetchFxRate(currency, dayMs) : 1;
  if (!fxRate) return null;              // foreign asset with no rate — never guess


  const priceInr    = priceNative * fxRate;

  // The invariant fixes one side; the price fixes the other.
  const units = sub.invariant === 'units'
    ? sub.units
    : sub.amount / priceInr;             // a fixed ₹ outlay buys fractional units

  if (!units || !Number.isFinite(units)) return null;

  return {
    ...base,
    units,
    pricePerUnit:    priceNative,        // native; `amount` below is INR
    amount:          units * priceInr,
    currency,
    fxRate,
    assetSymbol:     sub.assetSymbol,
    assetName:       sub.assetName,
    assetType:       sub.assetType,
    purity:          sub.purity,
    rate:            sub.rate,
    usesCashBalance: !!sub.usesCashBalance,
  };
}

/**
 * Materialise every occurrence that has come due, up to `uptoMs` (default: today).
 *
 * **Inserts transactions only — deliberately does NOT touch any store.** The caller
 * (`ensureUpToToday`) extends the stores afterwards and replays these inside the
 * extension window.
 *
 * `lastRunDate` is the idempotency key: occurrence generation is exclusive of it, so
 * a second call in the same day produces nothing.
 *
 * @returns {Promise<Object[]>} the transactions created (lean objects)
 */
async function materializeDue(userId, uptoMs = todayMs()) {
  const doc = await Subscription.findOne({ user: userId });
  if (!doc?.subscriptions?.length) return [];

  const payloads = [];
  const ranBySub = new Map();   // subscription _id → last day materialised

  for (const sub of doc.subscriptions) {
    if (!sub.active) continue;

    const days = occurrencesBetween(
      midnight(sub.startDate),
      sub.frequency,
      uptoMs,
      sub.lastRunDate ? midnight(sub.lastRunDate) : null,
      sub.endDate ? midnight(sub.endDate) : null,
    );
    if (!days.length) continue;

    for (const day of days) {
      const tx = await buildOccurrence(sub, userId, day);
      if (tx) payloads.push(tx);
      // The day is marked run either way: an occurrence we could not price is skipped
      // for good, rather than retried on every session for the rest of time.
      ranBySub.set(String(sub._id), day);
    }
  }

  if (!ranBySub.size) return [];

  for (const sub of doc.subscriptions) {
    const day = ranBySub.get(String(sub._id));
    if (day != null) sub.lastRunDate = new Date(day);
  }
  await doc.save();

  if (!payloads.length) return [];
  const created = await Transaction.insertMany(payloads);
  return created.map(t => t.toObject());
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Create a subscription and fire everything already due.
 *
 * The back-dated transactions are returned so the route can push them through the
 * normal mutation path — a subscription starting last year must land in the stores
 * exactly as if the user had entered each transaction by hand.
 */
async function createSubscription(userId, data) {
  const account = await Account.findOne({ _id: data.account, user: userId }).lean();
  if (!account) throw new Error('Account not found');
  if (isAsset(data.type) && account.isDebt) throw new Error('Buy/Sell transactions are not available on debt accounts');

  const doc = await Subscription.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { upsert: true, new: true },
  );

  doc.subscriptions.push({
    ...data,
    // Cash flows are always fixed-amount; only an asset trade can be unit-invariant.
    invariant: isAsset(data.type) ? (data.invariant || 'amount') : 'amount',
    endDate:   data.endDate || null,     // null → ongoing
    lastRunDate: null,
    active: true,
  });
  await doc.save();

  const created = await materializeDue(userId);
  return { subscription: doc.subscriptions[doc.subscriptions.length - 1], created };
}

async function deleteSubscription(userId, subId) {
  const doc = await Subscription.findOne({ user: userId });
  if (!doc) return false;
  const before = doc.subscriptions.length;
  doc.subscriptions = doc.subscriptions.filter(s => String(s._id) !== String(subId));
  if (doc.subscriptions.length === before) return false;
  await doc.save();
  return true;
}

/** Pause / resume — stops future occurrences without discarding the history. */
async function setActive(userId, subId, active) {
  const doc = await Subscription.findOne({ user: userId });
  const sub = doc?.subscriptions?.id(subId);
  if (!sub) return null;
  sub.active = !!active;
  await doc.save();
  return sub;
}

/** Drop every subscription bound to a deleted account (cascade). */
async function deleteForAccount(userId, accountId) {
  const doc = await Subscription.findOne({ user: userId });
  if (!doc) return;
  doc.subscriptions = doc.subscriptions.filter(s =>
    String(s.account) !== String(accountId) && String(s.toAccount || '') !== String(accountId));
  await doc.save();
}

module.exports = {
  getSubscriptions,
  createSubscription,
  deleteSubscription,
  setActive,
  deleteForAccount,
  materializeDue,
  buildOccurrence,
};
