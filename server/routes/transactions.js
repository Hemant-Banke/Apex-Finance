const express = require('express');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

const { protect }               = require('../middleware/auth');
const { TRANSACTION_TYPES, ASSET_TRANSACTION_TYPES }     = require('../utils/constants');
const { midnight, todayMs }     = require('../utils/helpers');
const { normalizeCategory }     = require('../lib/categoryRules');
const { getAccountCashBalance } = require('../services/accountBalance');
const txService                 = require('../services/transactionService');
const categoryProfile           = require('../services/categoryProfileService');

/** Record a saved (user-confirmed) transaction into the user's category profile. */
function learnCategory(userId, tx, narration) {
  categoryProfile.recordTransactions(userId, [{
    type: tx.type, category: tx.category, amount: tx.amount, date: tx.date, narration,
  }]).catch(console.error);
}

const router = express.Router();
router.use(protect);

/** Validate one row and return the document to insert. Throws a human-readable message. */
async function prepareTransaction(userId, body) {
  if (!body.account) throw new Error('Account is required');
  if (!TRANSACTION_TYPES.includes(body.type)) throw new Error('Invalid transaction type');

  // The time-series stores only run to today.
  if (body.date && midnight(new Date(body.date)) > todayMs())
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

  // Learn how this user categorizes (non-blocking).
  created.forEach((tx, n) => learnCategory(userId, tx, prepared[n].narration));

  return { created, failed };
}


// GET /api/transactions
router.get('/', async (req, res) => {
  try {
    const { account, type, category, startDate, endDate, limit = 50, page = 1 } = req.query;

    const filter = { user: req.user._id };
    if (account)   filter.account  = account;
    if (type)      filter.type     = type;
    if (category)  filter.category = category;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate)   filter.date.$lte = new Date(endDate);
    }

    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .populate('account',   'name type')
      .populate('toAccount', 'name type')
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    res.json({ transactions, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transactions
router.post('/', async (req, res) => {
  try {
    const { created, failed } = await createTransactions(req.user._id, [req.body]);
    if (!created.length) return res.status(400).json({ message: failed[0].message });

    const populated = await Transaction.findById(created[0]._id)
      .populate('account',   'name type')
      .populate('toAccount', 'name type');

    res.status(201).json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/transactions/:id
router.put('/:id', async (req, res) => {
  try {
    if (req.body.date && midnight(new Date(req.body.date)) > todayMs())
      return res.status(400).json({ message: 'Transaction date cannot be in the future' });

    // Fetch old state before update for net worth delta calculation
    const oldTx = await Transaction.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!oldTx) return res.status(404).json({ message: 'Transaction not found' });

    // Recompute Transaction Amount for Asset Txn (re-books INR at the trade date's FX).
    req.body.category = normalizeCategory(req.body.category, req.body.type);
    try {
      await txService.applyAssetPricing(req.body);
    } catch (e) {
      return res.status(400).json({ message: e.message });
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    ).populate('account', 'name type').lean();

    // Update stores before responding so the client's refetch sees fresh data.
    try { await txService.onUpdate(req.user._id, oldTx, req.body); } catch (e) { console.error(e); }

    // Learn from a re-categorization (non-blocking).
    learnCategory(req.user._id, transaction, req.body.narration);

    res.json(transaction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, user: req.user._id }).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    // Update stores before responding so the client's refetch sees fresh data.
    try { await txService.onDelete(req.user._id, transaction); } catch (e) { console.error(e); }

    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transactions/bulk — the import path. One store pass for the whole batch.
// Body: { transactions: [ { account, type, amount, date, narration?, ... }, ... ] }
router.post('/bulk', async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ message: 'Transactions array is required' });
    }

    const { created, failed } = await createTransactions(req.user._id, transactions);
    if (!created.length) return res.status(400).json({ message: failed[0].message, failed });

    res.status(201).json({ count: created.length, transactions: created, failed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/transactions/bulk
// Body: { ids: [ "txId1", "txId2", ... ] }
router.delete('/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'Transaction Ids array is required' });
    }
    await txService.bulkDelete(req.user._id, ids);
    res.json({ message: `${ids.length} transaction(s) deleted` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
