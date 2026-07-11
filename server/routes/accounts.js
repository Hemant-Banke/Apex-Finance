const express = require('express');
const { body, validationResult } = require('express-validator');
const Account             = require('../models/Account');
const Transaction         = require('../models/Transaction');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings     = require('../models/AccountHoldings');
const DailyNetworth       = require('../models/DailyNetWorth');

const { protect }             = require('../middleware/auth');
const { DAY_MS, ACCOUNT_TYPES }              = require('../utils/constants');
const { midnight, toDateStr_from_ms, todayStr } = require('../utils/helpers');
const { getAccountBalance, getAccountAssetBalance }   = require('../services/accountBalance');
const txService               = require('../services/transactionService');
const dvService               = require('../services/dailyValueService');
const { holdingsToArray }     = require('../services/holdingsService');

const router = express.Router();
router.use(protect);

// @route   GET /api/accounts
router.get('/', async (req, res) => {
  try {
    const accounts       = await Account.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
    const fetchLatestBal = req.query.fetchLatestBal === 'true';

    const withBalances = await Promise.all(accounts.map(async account => {
      const balanceDetail = await getAccountBalance(account, req.user, fetchLatestBal);
      return { ...account, ...balanceDetail };
    }));

    res.json(withBalances);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // Fetch both balance-related docs in parallel
    const [acctBalanceDoc, holdingsDoc] = await Promise.all([
      DailyAccountBalance.findOne({ account: account._id, user: req.user._id }).lean(),
      account.isDebt ? null : AccountHoldings.findOne({ account: account._id, user: req.user._id }).lean(),
    ]);

    const rawHoldings = holdingsDoc?.holdings || [];
    const fetchLatestBal = req.query.fetchLatestBal === 'true';
    const balanceDetail  = await getAccountBalance(account, req.user, fetchLatestBal, acctBalanceDoc, rawHoldings);

    const obj = {
      ...account,
      ...balanceDetail,
      // Holdings in client-facing shape (non-debt accounts only)
      holdings: account.isDebt ? [] : holdingsToArray(rawHoldings),
      // Pre-computed balance time series for charting
      accountBalances: acctBalanceDoc ?? null,
    };

    res.json(obj);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id/holdings
router.get('/:id/holdings', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });
    if (account.isDebt) return res.json([]);

    const holdingsDoc = await AccountHoldings.findOne({ account: req.params.id, user: req.user._id }).lean();
    res.json(holdingsToArray(holdingsDoc?.holdings));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/accounts/:id/daily?days=N&fetchLatestBal=true
// Returns [{ date, cashValue, assetValue, totalValue }] for the account balance history.
// cashTS (length N) covers startDate → T (today).
// assetTS (length N-1) covers startDate → T-1 (yesterday, settled).
// The last entry (today) always has cashValue from cashTS; assetValue is:
//   - null           if fetchLatestBal is not set (no settled prices for today yet)
//   - live price sum if fetchLatestBal=true
router.get('/:id/daily', async (req, res) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const [doc, holdingsDoc] = await Promise.all([
      DailyAccountBalance.findOne({ account: req.params.id, user: req.user._id }).lean(),
      account.isDebt ? null : AccountHoldings.findOne({ account: req.params.id, user: req.user._id }).lean(),
    ]);
    if (!doc || !(doc.cashTS?.length || doc.assetTS?.length)) return res.json([]);

    const cashTS     = doc.cashTS  || [];
    const assetTS    = doc.assetTS || [];
    const docStartMs = midnight(doc.startDate);
    const totalDays  = cashTS.length; // N entries, last = T

    let sliceStart = 0;
    if (req.query.days) {
      const cutoffMs = midnight(doc.endDate) - (parseInt(req.query.days) - 1) * DAY_MS;
      if (cutoffMs > docStartMs) {
        sliceStart = Math.round((cutoffMs - docStartMs) / DAY_MS);
      }
    }

    const todayStrVal = todayStr();
    const result      = [];
    for (let i = Math.max(0, sliceStart); i < totalDays - 1; i++) {
      const dateStr   = toDateStr_from_ms(docStartMs + i * DAY_MS);
      const assetValue = assetTS[i] ?? null;
      const cashValue = cashTS[i] ?? 0;

      result.push({
        date:       dateStr,
        cashValue,
        assetValue,
        totalValue: cashValue + (assetValue ?? 0),
      });
    }

    // Live asset value for today (T), if requested
    if (req.query.fetchLatestBal === 'true' && !account.isDebt) {
      const live = await getAccountAssetBalance(account, req.user, true, doc, holdingsDoc?.holdings || []);
      const liveAssetValueToday = live.value;

      result.push({
        date:       todayStr(),
        cashValue:  cashTS[totalDays-1],
        assetValue: liveAssetValueToday,
        totalValue: cashTS[totalDays-1] + liveAssetValueToday,
      });
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
  body('type').isIn(ACCOUNT_TYPES).withMessage('Invalid account type'),
  body('initialBalance').optional().isNumeric().withMessage('Initial balance must be a number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { initialBalance, ...accountData } = req.body;
    const account = await Account.create({ ...accountData, user: req.user._id });

    // Create related stores
    await Promise.all([
      DailyAccountBalance.create({ account: account._id, user: req.user._id, startDate: new Date(), endDate: new Date() }),
      AccountHoldings.create({ account: account._id, user: req.user._id }),
    ]);

    // Create NetWorth store if it doesn't already exist
    const nwDoc = await DailyNetworth.findOne({ user: req.user._id }).select('user').lean();
    if (!nwDoc) await DailyNetworth.create({ user: req.user._id, startDate: new Date(), endDate: new Date() });

    // Make initial transaction. The amount is stored exactly as given — a debt
    // account is simply opened with a negative balance, never negated here.
    const initAmount = parseFloat(initialBalance);
    if (!isNaN(initAmount) && initAmount !== 0) {
      const openingTx = await Transaction.create({
        user:     req.user._id,
        account:  account._id,
        type:     'adjustment',
        amount:   initAmount,
        category: 'initial balance',
        notes:    'Opening balance',
        date:     new Date()
      });
      // Await so the opening balance is reflected before the client refetches.
      try { await txService.onCreate(req.user._id, openingTx); } catch (e) { console.error(e); }
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
    if (!account) return res.status(404).json({ message: 'Account not found' });
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
    if (!account) return res.status(404).json({ message: 'Account not found' });

    await Promise.all([
      Transaction.deleteMany({ account: account._id }),
      DailyAccountBalance.deleteOne({ account: account._id, user: req.user._id }),
      AccountHoldings.deleteOne({ account: account._id, user: req.user._id }),
    ]);

    // Re-aggregate net worth without the deleted account (non-blocking).
    dvService.rebuildNW(req.user._id).catch(console.error);

    res.json({ message: 'Account and related data deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
