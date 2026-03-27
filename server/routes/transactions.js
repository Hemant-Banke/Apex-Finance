const express = require('express');
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { protect } = require('../middleware/auth');
const { getAccountCashBalance } = require('../utils/balance');
const dv = require('../services/dailyValueService');
const holdings = require('../services/holdingsService');

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
      .skip((parseInt(page) - 1) * parseInt(limit));

    res.json({ transactions, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/transactions
router.post('/', [
  body('account').notEmpty().withMessage('Account is required'),
  body('type').isIn(['income', 'expense', 'transfer', 'adjustment', 'buy', 'sell']).withMessage('Invalid transaction type'),
  body('amount').custom((value, { req }) => {
    if (['buy', 'sell'].includes(req.body.type)) return true;
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

    if (['buy', 'sell'].includes(type) && account.isDebt)
      return res.status(400).json({ message: 'Buy/Sell transactions are not available on debt accounts' });

    if (type === 'transfer') {
      if (!req.body.toAccount)
        return res.status(400).json({ message: 'Transfer requires a destination account (toAccount)' });
      if (req.body.toAccount === req.body.account)
        return res.status(400).json({ message: 'Cannot transfer to the same account' });
      const toAccount = await Account.findOne({ _id: req.body.toAccount, user: req.user._id });
      if (!toAccount) return res.status(404).json({ message: 'Destination account not found' });
    }

    let transactionData = { ...req.body, user: req.user._id };
    if (['buy', 'sell'].includes(type) && req.body.units && req.body.pricePerUnit)
      transactionData.amount = parseFloat(req.body.units) * parseFloat(req.body.pricePerUnit);

    const amount = parseFloat(transactionData.amount);

    if (type === 'buy') {
      const cashBalance = await getAccountCashBalance(account._id);
      if (amount > cashBalance)
        return res.status(400).json({ message: `Insufficient cash balance. Available: ${cashBalance.toFixed(2)}` });
    }

    if (type === 'adjustment' && !account.isDebt) {
      const cashBalance = await getAccountCashBalance(account._id);
      if (cashBalance + amount < 0)
        return res.status(400).json({ message: `Adjustment would result in negative cash balance. Current: ${cashBalance.toFixed(2)}` });
    }

    const transaction = await Transaction.create(transactionData);

    // Update daily net worth store (non-blocking — errors are logged, not surfaced)
    dv.onTransactionCreate(req.user._id, transaction).catch(console.error);

    // Update holdings for buy/sell (incremental if possible, full rebuild as fallback)
    if (['buy', 'sell'].includes(type)) {
      holdings.applyTransaction(account._id, req.user._id, transaction).catch(console.error);
    }

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

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    ).populate('account', 'name type');

    // Update daily net worth store
    dv.onTransactionUpdate(req.user._id, oldTx, req.body).catch(console.error);

    // Rebuild holdings if the old or new type involves assets
    if (['buy', 'sell'].includes(oldTx.type) || ['buy', 'sell'].includes(req.body.type)) {
      holdings.rebuildForAccount(oldTx.account, req.user._id).catch(console.error);
    }

    res.json(transaction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    // Update daily net worth store
    dv.onTransactionDelete(req.user._id, transaction).catch(console.error);

    // Rebuild holdings if it was a buy/sell
    if (['buy', 'sell'].includes(transaction.type)) {
      holdings.rebuildForAccount(transaction.account, req.user._id).catch(console.error);
    }

    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
