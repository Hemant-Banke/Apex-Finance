const express = require('express');
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

const { protect }               = require('../middleware/auth');
const { TRANSACTION_TYPES, ASSET_TRANSACTION_TYPES }     = require('../utils/constants');
const { getAccountCashBalance } = require('../services/accountBalance');
const txService                 = require('../services/transactionService');

const router = express.Router();
router.use(protect);

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
router.post('/', [
  body('account').notEmpty().withMessage('Account is required'),
  body('type').isIn(TRANSACTION_TYPES).withMessage('Invalid transaction type'),
  body('amount').custom((value, { req }) => {
    if (ASSET_TRANSACTION_TYPES.includes(req.body.type)) return true;
    if (value === undefined || value === null || String(value).trim() === '')
      throw new Error('Amount is required');
    if (isNaN(Number(value)))
      throw new Error('Amount must be a number');
    return true;
  }),
  body('date').optional().isISO8601().withMessage('Invalid date format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const account = await Account.findOne({ _id: req.body.account, user: req.user._id });
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const { type } = req.body;
    if (ASSET_TRANSACTION_TYPES.includes(type) && account.isDebt)
      return res.status(400).json({ message: 'Buy/Sell transactions are not available on debt accounts' });

    if (type === 'transfer') {
      if (!req.body.toAccount)
        return res.status(400).json({ message: 'Transfer requires a destination account (toAccount)' });
      if (req.body.toAccount === req.body.account)
        return res.status(400).json({ message: 'Cannot transfer to the same account' });
      const toAccount = await Account.findOne({ _id: req.body.toAccount, user: req.user._id });
      if (!toAccount) return res.status(404).json({ message: 'Destination account not found' });
    }

    // Asset Transaction Amount
    let transactionData = { ...req.body, user: req.user._id };
    if (ASSET_TRANSACTION_TYPES.includes(type) && req.body.units && req.body.pricePerUnit)
      transactionData.amount = parseFloat(req.body.units) * parseFloat(req.body.pricePerUnit);

    // Transaction Amount Checks
    // const amount = parseFloat(transactionData.amount);
    // if (type === 'buy' && transactionData.usesCashBalance) {
    //   const cashBalance = await getAccountCashBalance(account, req.user);
    //   if (amount > cashBalance)
    //     return res.status(400).json({ message: `Insufficient cash balance. Available: ${cashBalance.toFixed(2)}` });
    // }

    // if (type === 'adjustment' && !account.isDebt) {
    //   const cashBalance = await getAccountCashBalance(account, req.user);
    //   if (cashBalance + amount < 0)
    //     return res.status(400).json({ message: `Adjustment would result in negative cash balance. Current: ${cashBalance.toFixed(2)}` });
    // }

    const transaction = (await Transaction.create(transactionData));

    // Update stores before responding so the client's refetch sees fresh data.
    // A store failure is logged but does not undo the committed transaction.
    try { await txService.onCreate(req.user._id, transaction); } catch (e) { console.error(e); }

    const populated = await Transaction.findById(transaction._id)
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
    // Fetch old state before update for net worth delta calculation
    const oldTx = await Transaction.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!oldTx) return res.status(404).json({ message: 'Transaction not found' });

    // Recompute Transaction Amount for Asset Txn
    if (ASSET_TRANSACTION_TYPES.includes(req.body.type) && req.body.units && req.body.pricePerUnit)
      req.body.amount = parseFloat(req.body.units) * parseFloat(req.body.pricePerUnit);

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    ).populate('account', 'name type').lean();

    // Update stores before responding so the client's refetch sees fresh data.
    try { await txService.onUpdate(req.user._id, oldTx, req.body); } catch (e) { console.error(e); }

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

// POST /api/transactions/bulk
// Insert multiple transactions and rebuild affected stores in one batch pass.
// Body: { transactions: [ { account, type, amount, date, ... }, ... ] }
router.post('/bulk', async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ message: 'Transactions array is required' });
    }
    const created = await txService.bulkCreate(req.user._id, transactions);
    res.status(201).json({ count: created.length, transactions: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
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
