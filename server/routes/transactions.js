const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

const { protect }                 = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/asyncHandler');
const { badRequest, notFound }     = require('../utils/httpError');
const { TRANSACTION_TYPES, ASSET_TRANSACTION_TYPES }     = require('../utils/constants');
const { midnight, todayMs }     = require('../utils/helpers');
const { normalizeCategory }     = require('../lib/categoryRules');
const { getAccountCashBalance } = require('../services/accountBalance');
const txService                 = require('../services/transactionService');
const categoryProfile           = require('../services/categoryProfileService');

/**
 * Record saved (user-confirmed) transactions into the user's category profile.
 *
 * Takes the WHOLE batch in one call. Firing it per row looked equivalent and was not:
 * `recordTransactions` reads the profile, folds the rows in, and writes it back, so
 * twenty concurrent calls all read the same starting state and the last write won —
 * nineteen rows' worth of learning silently discarded. On a fresh profile they also
 * raced to CREATE the document and lost on the unique `user` index with an E11000 that
 * only ever surfaced in the logs. An import is precisely when the profile has the most
 * to learn, so it was the worst possible place to drop it.
 */
function learnCategories(userId, rows) {
  if (!rows.length) return;
  categoryProfile.recordTransactions(userId, rows).catch(console.error);
}

const router = express.Router();
router.use(protect);

/**
 * Cast an id for the query. `find` would cast a string itself, but the summary
 * `aggregate` runs the SAME filter and Mongoose does not cast pipeline stages —
 * a string id there matches nothing, so the totals silently came back empty.
 * An unparseable id is left as-is and simply matches nothing, as before.
 */
const oid = (id) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;

/** Validate one row and return the document to insert. Throws a human-readable message. */
async function prepareTransaction(userId, body) {
  if (!body.account) throw new Error('Account is required');
  if (!TRANSACTION_TYPES.includes(body.type)) throw new Error('Invalid transaction type');

  // The time-series stores only run to today.
  if (body.date && midnight(body.date) > todayMs())
    throw new Error('Transaction date cannot be in the future');

  const account = await Account.findOne({ _id: body.account, user: userId }).lean();
  if (!account) throw new Error('Account not found');

  const isAsset = ASSET_TRANSACTION_TYPES.includes(body.type);
  if (isAsset && account.isDebt)
    throw new Error('Buy/Sell transactions are not available on debt accounts');

  if (!isAsset && (body.amount === undefined || body.amount === null || isNaN(Number(body.amount))))
    throw new Error('Amount is required');

  if (body.type === 'transfer') {
    if (!body.toAccount) throw new Error('Transfer requires a destination account');
    if (String(body.toAccount) === String(body.account)) throw new Error('Cannot transfer to the same account');
    const toAccount = await Account.findOne({ _id: body.toAccount, user: userId }).lean();
    if (!toAccount) throw new Error('Destination account not found');
  }

  const data = { ...body, user: userId };
  // A bare "Other" is a group, not a classification — file it under Other · Miscellaneous.
  data.category = normalizeCategory(data.category, data.type);
  await txService.applyAssetPricing(data);   // native price → INR `amount` at the trade date's FX
  return data;
}

/**
 * Create transactions. One or many — the only difference is the length of the array.
 * A row that fails validation is reported in `failed` rather than sinking the batch.
 */
async function createTransactions(userId, rows) {
  const prepared = [];
  const failed   = [];
  await Promise.all(rows.map(async (t, i) => {
    try   { prepared.push({ i, data: await prepareTransaction(userId, t), narration: t.narration }); }
    catch (e) { failed.push({ index: i, message: e.message }); }
  }));

  prepared.sort((a, b) => a.i - b.i);   // insert in request order
  const created = await txService.bulkCreate(userId, prepared.map(p => p.data));

  // Learn how this user categorizes (non-blocking) — one pass for the whole batch.
  learnCategories(userId, created.map((tx, n) => ({
    type: tx.type, category: tx.category, amount: tx.amount, date: tx.date,
    narration: prepared[n].narration,
  })));

  return { created, failed };
}


// GET /api/transactions
//
// `summary` totals the WHOLE filtered set, not the page being returned — "₹40,000 in,
// ₹32,000 out" has to describe the filter the user built, or it is a lie about page 1.
router.get('/', asyncHandler(async (req, res) => {
  const { account, type, category, search, startDate, endDate, limit = 50, page = 1 } = req.query;

  const filter = { user: req.user._id };
  if (type)      filter.type     = type;
  if (category)  filter.category = category;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate)   filter.date.$lte = new Date(endDate);
  }

  // Two independent `$or`s can live in one filter only under `$and` — the second
  // assignment would otherwise silently overwrite the first.
  const clauses = [];

  // An account's statement is every transaction that MOVED ITS MONEY, and a transfer
  // moves the destination's just as much as the source's. The cash store has always
  // credited both sides (see buildAccountTxnsMap); the list was the one place that
  // showed only the source, so an incoming transfer appeared as a balance rise with
  // no transaction to explain it.
  if (account) clauses.push({ $or: [{ account: oid(account) }, { toAccount: oid(account) }] });

  // Free text matches whatever the user would recognise the row by: its note, or the
  // asset it traded. Escaped — a stray "(" in the box must not throw a regex error.
  if (search?.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    clauses.push({ $or: [{ notes: rx }, { assetName: rx }, { assetSymbol: rx }] });
  }
  if (clauses.length) filter.$and = clauses;

  const [total, transactions, flows] = await Promise.all([
    Transaction.countDocuments(filter),
    Transaction.find(filter)
      .populate('account',   'name type')
      .populate('toAccount', 'name type')
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean(),
    Transaction.aggregate([
      { $match: filter },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const of = (t) => flows.find(f => f._id === t)?.total || 0;
  const income  = of('income');
  const expense = of('expense');

  res.json({
    transactions,
    total,
    page:  parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    summary: {
      income,
      expense,
      net:     income - expense,
      // Trades are reported separately: a buy is not an expense, and rolling it into
      // "out" would make an investment look like money burnt.
      invested: of('buy'),
      divested: of('sell'),
      count:    total,
    },
  });
}));

// POST /api/transactions
router.post('/', asyncHandler(async (req, res) => {
  const { created, failed } = await createTransactions(req.user._id, [req.body]);
  if (!created.length) throw badRequest(failed[0].message);

  const populated = await Transaction.findById(created[0]._id)
    .populate('account',   'name type')
    .populate('toAccount', 'name type');

  res.status(201).json(populated);
}));

// PUT /api/transactions/:id
router.put('/:id', asyncHandler(async (req, res) => {
  if (req.body.date && midnight(req.body.date) > todayMs())
    throw badRequest('Transaction date cannot be in the future');

  // The old state is needed to subtract its impact from the stores.
  const oldTx = await Transaction.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!oldTx) throw notFound('Transaction not found');

  // Re-book an asset trade's INR amount at the trade date's FX. A foreign trade with
  // no rate available throws a 400 of its own rather than booking a USD figure as INR.
  req.body.category = normalizeCategory(req.body.category, req.body.type);
  await txService.applyAssetPricing(req.body);

  const transaction = await Transaction.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true, runValidators: true }
  ).populate('account', 'name type').lean();

  // Update the stores before responding, so the client's refetch sees fresh data.
  await txService.onUpdate(req.user._id, oldTx, req.body).catch(console.error);
  learnCategories(req.user._id, [{
    type: transaction.type, category: transaction.category, amount: transaction.amount,
    date: transaction.date, narration: req.body.narration,
  }]);

  res.json(transaction);
}));

// DELETE /api/transactions/bulk
// Body: { ids: [ "txId1", "txId2", ... ] }
//
// MUST be declared before `/:id`. Express matches in declaration order, so with the
// parameterised route first this landed in it as `id === 'bulk'` and died casting that
// to an ObjectId — a 500 on a route that looked perfectly well defined.
router.delete('/bulk', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    throw badRequest('Transaction Ids array is required');
  }
  await txService.bulkDelete(req.user._id, ids);
  res.json({ message: `${ids.length} transaction(s) deleted` });
}));

// DELETE /api/transactions/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, user: req.user._id }).lean();
  if (!transaction) throw notFound('Transaction not found');

  await txService.onDelete(req.user._id, transaction).catch(console.error);

  res.json({ message: 'Transaction deleted' });
}));

// POST /api/transactions/bulk — the import path. One store pass for the whole batch.
// Body: { transactions: [ { account, type, amount, date, narration?, ... }, ... ] }
router.post('/bulk', asyncHandler(async (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || !transactions.length) {
    throw badRequest('Transactions array is required');
  }

  const { created, failed } = await createTransactions(req.user._id, transactions);
  if (!created.length) throw badRequest(failed[0].message, { failed });

  res.status(201).json({ count: created.length, transactions: created, failed });
}));


module.exports = router;
