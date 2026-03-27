const express = require('express');
const { body, validationResult } = require('express-validator');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings = require('../models/AccountHoldings');
const { protect } = require('../middleware/auth');
const { getAccountCashBalance } = require('../utils/balance');
const dv = require('../services/dailyValueService');
const holdingsService = require('../services/holdingsService');

const router = express.Router();
router.use(protect);

// @route   GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const accounts = await Account.find({ user: req.user._id }).sort({ createdAt: -1 });

    const accountsWithBalance = await Promise.all(
      accounts.map(async (account) => {
        const accountObj = account.toObject();
        accountObj.balance = await getAccountCashBalance(account._id);
        return accountObj;
      })
    );

    res.json(accountsWithBalance);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id });
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const accountObj = account.toObject();
    accountObj.balance = await getAccountCashBalance(account._id);

    // Asset holdings (only for non-debt accounts) — served from stored AccountHoldings document
    if (!account.isDebt) {
      let holdingsDoc = await AccountHoldings.findOne({ account: account._id }).lean();
      // const holdingsEmpty = !holdingsDoc || Object.keys(holdingsDoc.holdings || {}).length === 0;
      // if (holdingsEmpty) {
      //   // Lazy-init or fix stale empty doc from old Map-type serialisation bug
      //   await holdingsService.rebuildForAccount(account._id, req.user._id);
      //   holdingsDoc = await AccountHoldings.findOne({ account: account._id }).lean();
      // }
      accountObj.holdings = holdingsService.holdingsToArray(holdingsDoc);
    } else {
      accountObj.holdings = [];
    }

    res.json(accountObj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id/holdings
// Returns the full AccountHoldings document as an array (builds lazily if needed)
router.get('/:id/holdings', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });

    if (account.isDebt) return res.json([]);

    let holdingsDoc = await AccountHoldings.findOne({ account: req.params.id }).lean();
    // const holdingsEmpty = !holdingsDoc || Object.keys(holdingsDoc.holdings || {}).length === 0;
    // if (holdingsEmpty) {
    //   await holdingsService.rebuildForAccount(req.params.id, req.user._id);
    //   holdingsDoc = await AccountHoldings.findOne({ account: req.params.id }).lean();
    // }

    res.json(holdingsService.holdingsToArray(holdingsDoc));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id/daily?days=N
// Returns [{date, value}] for the account's daily cash balance history.
router.get('/:id/daily', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const doc = await DailyAccountBalance.findOne({ account: req.params.id }).lean();
    if (!doc || !doc.values.length) return res.json([]);

    const docStartMs = doc.startDate.getTime();
    let sliceStart   = 0;

    if (req.query.days) {
      const cutoffMs = doc.endDate.getTime() - (parseInt(req.query.days) - 1) * dv.DAY_MS;
      if (cutoffMs > docStartMs) {
        sliceStart = Math.round((cutoffMs - docStartMs) / dv.DAY_MS);
      }
    }

    const result = [];
    for (let i = Math.max(0, sliceStart); i < doc.values.length; i++) {
      result.push({ date: dv.toDateStr(new Date(docStartMs + i * dv.DAY_MS)), value: doc.values[i] });
    }

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/accounts
router.post('/', [
  body('name').trim().notEmpty().withMessage('Account name is required'),
  body('type').isIn(['bank', 'brokerage', 'retirement', 'debt', 'wallet', 'other']).withMessage('Invalid account type'),
  body('initialBalance').optional().isNumeric().withMessage('Initial balance must be a number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { initialBalance, ...accountData } = req.body;
    const account = await Account.create({ ...accountData, user: req.user._id });

    const initAmount = parseFloat(initialBalance);
    if (!isNaN(initAmount) && initAmount !== 0) {
      const adjustmentAmount = account.isDebt ? -Math.abs(initAmount) : initAmount;
      const openingTx = await Transaction.create({
        user:     req.user._id,
        account:  account._id,
        type:     'adjustment',
        amount:   adjustmentAmount,
        category: 'initial balance',
        notes:    'Opening balance',
        date:     new Date()
      });
      // Update both networth and account balance stores
      dv.onTransactionCreate(req.user._id, openingTx).catch(console.error);
    }

    res.status(201).json(account);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  try {
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    res.json(account);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    const account = await Account.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    await Promise.all([
      Transaction.deleteMany({ account: account._id }),
      DailyAccountBalance.deleteOne({ account: account._id }),
      AccountHoldings.deleteOne({ account: account._id }),
    ]);

    res.json({ message: 'Account and related data deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
