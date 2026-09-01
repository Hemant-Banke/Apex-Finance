const express = require('express');
const { body, validationResult } = require('express-validator');
const Account             = require('../models/Account');
const Transaction         = require('../models/Transaction');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings     = require('../models/AccountHoldings');
const DailyNetworth       = require('../models/DailyNetWorth');

const { protect }                       = require('../middleware/auth');
const { asyncHandler }                  = require('../middleware/asyncHandler');
const { notFound }                      = require('../utils/httpError');
const { DAY_MS, ACCOUNT_TYPES }         = require('../utils/constants');
const { midnight, toDateStr, todayStr } = require('../utils/helpers');
const { sliceStartIndex }               = require('../utils/tsHelpers');
const { getAccountBalance, getAccountAssetBalance, accountSparkline } = require('../services/accountBalance');
const txService           = require('../services/transactionService');
const dvService           = require('../services/dailyValueService');
const { holdingsToArray } = require('../services/holdingsService');
const subService          = require('../services/subscriptionService');

const router = express.Router();
router.use(protect);

/** The user's account, or a 404. */
async function findAccount(req) {
  const account = await Account.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!account) throw notFound('Account not found');
  return account;
}

// @route   GET /api/accounts
//
// Every account's store document is loaded ONCE here and handed to `getAccountBalance`,
// which would otherwise fetch each one itself — an N+1 that was already being paid, and
// paid for two numbers per document. Having the doc in hand also makes the list's
// sparkline free: the shape is in the same array the balance was read off.
router.get('/', asyncHandler(async (req, res) => {
  const accounts       = await Account.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
  const fetchLatestBal = req.query.fetchLatestBal === 'true';

  const storeDocs = await DailyAccountBalance.find({
    user: req.user._id,
    account: { $in: accounts.map(a => a._id) },
  }).lean();
  const storeByAccount = new Map(storeDocs.map(d => [d.account.toString(), d]));

  res.json(await Promise.all(accounts.map(async account => {
    const doc = storeByAccount.get(account._id.toString()) ?? null;
    return {
      ...account,
      ...(await getAccountBalance(account, req.user, fetchLatestBal, doc)),
      spark: accountSparkline(doc),
    };
  })));
}));

// @route   GET /api/accounts/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const account = await findAccount(req);

  const [acctBalanceDoc, holdingsDoc] = await Promise.all([
    DailyAccountBalance.findOne({ account: account._id, user: req.user._id }).lean(),
    account.isDebt ? null : AccountHoldings.findOne({ account: account._id, user: req.user._id }).lean(),
  ]);

  const rawHoldings   = holdingsDoc?.holdings || [];
  const balanceDetail = await getAccountBalance(
    account, req.user, req.query.fetchLatestBal === 'true', acctBalanceDoc, rawHoldings,
  );

  res.json({
    ...account,
    ...balanceDetail,
    holdings:        account.isDebt ? [] : holdingsToArray(rawHoldings),
    accountBalances: acctBalanceDoc ?? null,   // pre-computed series, for charting
  });
}));

// @route   GET /api/accounts/:id/holdings
router.get('/:id/holdings', asyncHandler(async (req, res) => {
  const account = await findAccount(req);
  if (account.isDebt) return res.json([]);

  const holdingsDoc = await AccountHoldings.findOne({ account: account._id, user: req.user._id }).lean();
  res.json(holdingsToArray(holdingsDoc?.holdings));
}));

// @route   GET /api/accounts/:id/daily?days=N&fetchLatestBal=true&growth=true
// Returns [{ date, cashValue, assetValue, totalValue }] for the account's balance history.
// cashTS (length N) runs startDate → T; assetTS (length N-1) runs startDate → T-1, so the
// settled series stops a day short. Today is only appended when fetchLatestBal asks for
// live prices — otherwise there is no asset value for it yet.
//
// `growth=true` swaps `totalValue` for a growth-only index (base 100 at the account's own
// first day) — the complete series with every later deposit/withdrawal/uncashed trade
// subtracted back out, so what is left is what the money itself did. `cashValue`/
// `assetValue` are nulled out in this mode — the split stops meaning anything once the
// series is an index rather than rupees. See dailyValueService.computeGrowthIndex.
router.get('/:id/daily', asyncHandler(async (req, res) => {
  const account = await findAccount(req);

  const [doc, holdingsDoc] = await Promise.all([
    DailyAccountBalance.findOne({ account: account._id, user: req.user._id }).lean(),
    account.isDebt ? null : AccountHoldings.findOne({ account: account._id, user: req.user._id }).lean(),
  ]);
  if (!doc || !(doc.cashTS?.length || doc.assetTS?.length)) return res.json([]);

  const cashTS     = doc.cashTS  || [];
  const assetTS    = doc.assetTS || [];
  const docStartMs = midnight(doc.startDate);
  const from       = sliceStartIndex(docStartMs, midnight(doc.endDate), req.query.days);

  const result = [];
  for (let i = from; i < cashTS.length - 1; i++) {
    const cashValue  = cashTS[i] ?? 0;
    const assetValue = assetTS[i] ?? null;
    result.push({
      date:       toDateStr(docStartMs + i * DAY_MS),
      cashValue,
      assetValue,
      totalValue: cashValue + (assetValue ?? 0),
    });
  }

  if (req.query.fetchLatestBal === 'true' && !account.isDebt) {
    const { value: assetValue } = await getAccountAssetBalance(
      account, req.user, true, doc, holdingsDoc?.holdings || [],
    );
    const cashValue = cashTS[cashTS.length - 1];
    result.push({ date: todayStr(), cashValue, assetValue, totalValue: cashValue + assetValue });
  }

  if (req.query.growth === 'true' && cashTS.length > 1) {
    // Always the FULL settled history (startDate → T-1), regardless of the `days`
    // window being displayed — zooming in shows where the index sits today, not a
    // rebase to 100 for that window.
    const fullValuesTS = [];
    for (let i = 0; i < cashTS.length - 1; i++) {
      fullValuesTS.push((cashTS[i] ?? 0) + (assetTS[i] ?? 0));
    }
    const endMs    = docStartMs + (fullValuesTS.length - 1) * DAY_MS;
    const growthTS = await dvService.computeGrowthIndex(
      req.user._id, docStartMs, endMs, fullValuesTS, account._id,
    );
    for (const row of result) {
      const idx = Math.round((midnight(row.date) - docStartMs) / DAY_MS);
      row.totalValue = idx >= 0 && idx < growthTS.length ? (growthTS[idx] ?? null) : null;
      row.cashValue  = null;
      row.assetValue = null;
    }
  }

  res.json(result);
}));

// @route   POST /api/accounts
router.post('/', [
  body('name').trim().notEmpty().withMessage('Account name is required'),
  body('type').isIn(ACCOUNT_TYPES).withMessage('Invalid account type'),
  body('initialBalance').optional().isNumeric().withMessage('Initial balance must be a number'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { initialBalance, ...accountData } = req.body;
  const account = await Account.create({ ...accountData, user: req.user._id });

  await Promise.all([
    DailyAccountBalance.create({ account: account._id, user: req.user._id, startDate: new Date(), endDate: new Date() }),
    AccountHoldings.create({ account: account._id, user: req.user._id }),
  ]);

  const nwDoc = await DailyNetworth.findOne({ user: req.user._id }).select('user').lean();
  if (!nwDoc) await DailyNetworth.create({ user: req.user._id, startDate: new Date(), endDate: new Date() });

  // The opening balance is stored exactly as given — a debt account is simply opened
  // with a negative one, never negated here.
  const initAmount = parseFloat(initialBalance);
  if (!isNaN(initAmount) && initAmount !== 0) {
    const openingTx = await Transaction.create({
      user:     req.user._id,
      account:  account._id,
      type:     'adjustment',
      amount:   initAmount,
      category: 'initial balance',
      notes:    'Opening balance',
      date:     new Date(),
    });
    // Awaited so the opening balance is in the stores before the client refetches.
    await txService.onCreate(req.user._id, openingTx).catch(console.error);
  }

  res.status(201).json(account);
}));

// @route   PUT /api/accounts/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const account = await Account.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    req.body,
    { new: true, runValidators: true },
  );
  if (!account) throw notFound('Account not found');
  res.json(account);
}));

// @route   DELETE /api/accounts/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const account = await Account.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!account) throw notFound('Account not found');

  await Promise.all([
    Transaction.deleteMany({ account: account._id }),
    DailyAccountBalance.deleteOne({ account: account._id, user: req.user._id }),
    AccountHoldings.deleteOne({ account: account._id, user: req.user._id }),
    // Recurring transactions bound to this account (either side of a transfer) would
    // otherwise keep firing into an account that no longer exists.
    subService.deleteForAccount(req.user._id, account._id),
  ]);

  dvService.rebuildNW(req.user._id).catch(console.error);

  res.json({ message: 'Account and related data deleted' });
}));

module.exports = router;
