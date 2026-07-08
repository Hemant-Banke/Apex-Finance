/**
 * transactionService — single-transaction & bulk lifecycle orchestration.
 *
 * Routes call these entry points only; all store math lives in dailyValueService.
 */

const Transaction = require('../models/Transaction');
const Account     = require('../models/Account');

const dvService     = require('./dailyValueService');
const { flipTx }    = require('../utils/transactionHelpers');

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
  findTransactions,
  onCreate,
  onDelete,
  onUpdate,
  bulkCreate,
  bulkDelete,
};
