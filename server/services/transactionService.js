/**
 * transactionService — all transaction-aware store orchestration.
 */

const Transaction         = require('../models/Transaction');
const Account             = require('../models/Account');
const AccountHoldings     = require('../models/AccountHoldings');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const DailyNetWorth       = require('../models/DailyNetWorth');

const holdingsService         = require('./holdingsService');
const dvService               = require('./dailyValueService');
const { fetchHistoricPrices } = require('./marketDataService');
const { DAY_MS }              = require('../utils/constants');
const { midnight, todayMs, t1Ms } = require('../utils/helpers');
const { rawHoldings, symItems, flipTx } = require('../utils/transactionHelpers');


/**
 * Find Transactions for a user between start and end dates (inclusive).
 * 
 * @param {string} userId
 * @param {string} startDate          start of the processing window.
 * @param {string} endDate            end of the processing window.
 */
async function findTransactions(userId, startDate = '2000-01-01', endDate = '2100-01-01') {
  return await Transaction.find({
    user: userId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: 1 }).lean();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Called after a transaction is created in DB. */
async function onCreate(userId, tx) {
  const accountId = (tx.account?._id ?? tx.account)?.toString();
  const account   = await Account.findById(accountId).lean();
  if (!account) return;

  await dvService.updateForTxns(userId, [tx]);
}

/** Called after a transaction is deleted from DB. */
async function onDelete(userId, tx) {
  const accountId = (tx.account?._id ?? tx.account)?.toString();
  const account   = await Account.findById(accountId).lean();
  if (!account) return;

  await dvService.updateForTxns(userId, [flipTx(tx)]);
}

/** Called after a transaction is updated in DB. */
async function onUpdate(userId, oldTx, patch) {
  const accountId = (oldTx.account?._id ?? oldTx.account)?.toString();
  const account   = await Account.findById(accountId).lean();
  if (!account) return;

  const newTx   = { ...oldTx, ...patch };
  await dvService.updateForTxns(userId, [flipTx(oldTx), newTx]);
}

/**
 * Insert multiple transactions and update all stores in one pass.
 * More efficient than N×onCreate because all deltas are summed in one scan.
 */
async function bulkCreate(userId, txnData) {
  if (!txnData.length) return [];
  const createdTxns = await Transaction.insertMany(txnData.map(t => ({ ...t, user: userId })));
  await dvService.updateForTxns(userId, createdTxns);
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
