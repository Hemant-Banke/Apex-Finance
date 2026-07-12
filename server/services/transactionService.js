/**
 * transactionService — single-transaction & bulk lifecycle orchestration.
 *
 * Routes call these entry points only; all store math lives in dailyValueService.
 */

const Transaction = require('../models/Transaction');
const Account     = require('../models/Account');

const dvService     = require('./dailyValueService');
const { flipTx }    = require('../utils/transactionHelpers');
const { fetchFxRate } = require('./marketDataService');
const { midnight, todayMs } = require('../utils/helpers');
const { normalizeCurrency } = require('../utils/currency');
const { ASSET_TRANSACTION_TYPES } = require('../utils/constants');

/**
 * Book an asset transaction's money fields.
 *
 * `pricePerUnit` stays in the asset's native currency; `amount` is always INR,
 * converted at the rate on the transaction's own date (not today's) so a trade is
 * booked at the FX it actually happened at. The rate is stored alongside it.
 *
 * Mutates and returns `data`. Throws when a foreign trade has no rate available —
 * booking a USD figure as though it were INR would silently corrupt every store.
 */
async function applyAssetPricing(data) {
  if (!ASSET_TRANSACTION_TYPES.includes(data.type)) return data;
  if (!data.units || !data.pricePerUnit) return data;

  const units    = parseFloat(data.units);
  const price    = parseFloat(data.pricePerUnit);
  const currency = normalizeCurrency(data.currency);

  if (!currency) {
    data.currency = undefined;
    data.fxRate   = 1;
    data.amount   = units * price;
    return data;
  }

  const dateMs = data.date ? midnight(new Date(data.date)) : todayMs();
  const fxRate = await fetchFxRate(currency, dateMs);
  if (!fxRate) throw new Error(`Exchange rate for ${currency} is unavailable — cannot book this trade`);

  data.currency = currency;
  data.fxRate   = fxRate;
  data.amount   = units * price * fxRate;
  return data;
}

/**
 * Find a user's transactions within a date window (inclusive), sorted ascending.
 */
async function findTransactions(userId, startDate = '2000-01-01', endDate = '2100-01-01') {
  return Transaction.find({
    user: userId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) },
  }).sort({ date: 1 }).lean();
}

// ─── Single-transaction lifecycle ──────────────────────────────────────────────

/** Called after a transaction is created in the DB. */
async function onCreate(userId, tx) {
  const account = await Account.findById(tx.account).lean();
  if (!account) return;
  await dvService.updateForTxns(userId, [tx]);
}

/**
 * Called after transactions have ALREADY been inserted by someone else (a subscription
 * firing its back-dated occurrences). Same store merge as `bulkCreate`, without the
 * insert — the rows exist, they just need to reach the stores.
 */
async function onCreateMany(userId, txns) {
  if (!txns?.length) return;
  await dvService.updateForTxns(userId, txns);
}

/** Called after a transaction is deleted from the DB. */
async function onDelete(userId, tx) {
  const account = await Account.findById(tx.account).lean();
  if (!account) return;
  await dvService.updateForTxns(userId, [flipTx(tx)]);
}

/** Called after a transaction is updated in the DB (old state + applied patch). */
async function onUpdate(userId, oldTx, patch) {
  const account = await Account.findById(oldTx.account).lean();
  if (!account) return;
  const newTx = { ...oldTx, ...patch };
  await dvService.updateForTxns(userId, [flipTx(oldTx), newTx]);
}

// ─── Bulk lifecycle ────────────────────────────────────────────────────────────

/**
 * Insert multiple transactions and update all stores in one pass.
 * More efficient than N×onCreate because all deltas are summed in a single scan.
 * @returns {Object[]} the created transaction docs
 */
async function bulkCreate(userId, txnData) {
  if (!txnData.length) return [];
  const created = await Transaction.insertMany(txnData.map(t => ({ ...t, user: userId })));
  await dvService.updateForTxns(userId, created.map(d => d.toObject()));
  return created;
}

/** Delete multiple transactions and update all stores in one pass. */
async function bulkDelete(userId, txIds) {
  if (!txIds.length) return;
  const toDelete = await Transaction.find({ _id: { $in: txIds }, user: userId }).lean();
  if (!toDelete.length) return;

  await Transaction.deleteMany({ _id: { $in: txIds }, user: userId });
  await dvService.updateForTxns(userId, toDelete.map(flipTx));
}

module.exports = {
  applyAssetPricing,
  findTransactions,
  onCreate,
  onCreateMany,
  onDelete,
  onUpdate,
  bulkCreate,
  bulkDelete,
};
