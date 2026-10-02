const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const DailyNetWorth = require('../models/DailyNetWorth');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings = require('../models/AccountHoldings');
const { protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { badRequest } = require('../utils/httpError');
const { holdingsToArray } = require('../services/holdingsService');
const { getPortfolio, getContribution, allocationByType } = require('../services/portfolioService');
const { getProfile } = require('../services/portfolioProfileService');
const { t1Str, t1Ms } = require('../utils/helpers');
const { DAY_MS } = require('../utils/constants');

const { spendClass } = require('../utils/spendClass');
const router = express.Router();
router.use(protect);

/**
 * Net worth `daysAgo` days before the end of the series, and the change since.
 *
 * `valuesTS` is one entry per day ending at T-1, so "30 days ago" is simply 30 entries
 * back. When the series is shorter than that, the earliest entry is used and `partial`
 * says so — a two-week-old account has no one-year change, and inventing one by
 * comparing against zero would report a spectacular fake gain.
 */
function netWorthChange(doc, daysAgo) {
  const ts = doc?.valuesTS || [];
  if (ts.length < 2) return null;

  const current = ts[ts.length - 1];
  const idx     = ts.length - 1 - daysAgo;
  const partial = idx < 0;
  const past    = ts[Math.max(0, idx)];

  const abs = current - past;
  return {
    abs,
    // Against a zero or negative base a percentage is meaningless (going from -1000 to
    // +500 is not "150% growth"), so it is simply withheld.
    pct: past > 0 ? (abs / past) * 100 : null,
    partial,
  };
}

// Months from the user's first income/expense to now, so a window never pads empty months.
async function monthsAvailable(userId) {
  const first = await Transaction.findOne({ user: userId, type: { $in: ['income', 'expense'] } })
    .sort({ date: 1 }).select('date').lean();
  if (!first) return 1;
  const f = new Date(first.date), now = new Date();
  return Math.max(1, (now.getFullYear() - f.getFullYear()) * 12 + (now.getMonth() - f.getMonth()) + 1);
}

const startOfMonthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

// @route   GET /api/dashboard/summary
// Reads the pre-computed stores rather than re-aggregating transactions per request.
// Assets = Σ account settledValue — T cash + the T-1 close.
router.get('/summary', asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [accounts, dailyBalances, holdingsDocs, nwDoc] = await Promise.all([
    Account.find({ user: userId }).lean(),
    DailyAccountBalance.find({ user: userId }).select('account settledValue lastCashValue').lean(),
    AccountHoldings.find({ user: userId }).select('holdings').lean(),
    DailyNetWorth.findOne({ user: userId }).lean(),
  ]);

  const settledByAccount = {};
  const cashByAccount    = {};
  dailyBalances.forEach(d => {
    settledByAccount[d.account.toString()] = d.settledValue  || 0;
    cashByAccount[d.account.toString()]    = d.lastCashValue || 0;
  });

  // Debt balances are already stored negative, so liabilities is just their sum flipped
  // for display (a positive "you owe"). Nothing is forced: an OVERPAID debt account
  // reports a negative liability, which is the truth.
  let totalAssets = 0, totalLiabilities = 0, totalCash = 0;
  accounts.forEach(acc => {
    const id = acc._id.toString();
    if (acc.isDebt) {
      totalLiabilities -= settledByAccount[id] || 0;
    } else {
      totalAssets += settledByAccount[id] || 0;
      totalCash   += cashByAccount[id]    || 0;
    }
  });

  const asof = t1Str();

  const symbolsSeen = new Set();
  holdingsDocs.forEach(doc => (doc.holdings || []).forEach(h => {
    if ((h.units || 0) > 0) symbolsSeen.add(h.assetSymbol);
  }));

  // Flows: this month, and the trailing 6 months for an average to compare it against.
  const [thisMonth, trailing, recentTransactions] = await Promise.all([
    Transaction.aggregate([
      { $match: { user: userId, date: { $gte: startOfMonthsAgo(0) }, type: { $in: ['income', 'expense'] } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { user: userId, date: { $gte: startOfMonthsAgo(6) }, type: { $in: ['income', 'expense'] } } },
      { $group: {
        _id: { type: '$type', m: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        total: { $sum: '$amount' },
      } },
    ]),
    Transaction.find({ user: userId })
      .populate('account',   'name type')
      .populate('toAccount', 'name type')
      .sort({ date: -1 })
      .limit(8),
  ]);

  const monthlyIncome  = thisMonth.find(f => f._id === 'income')?.total  || 0;
  const monthlyExpense = thisMonth.find(f => f._id === 'expense')?.total || 0;

  // Average per month over however many months actually have data — dividing by a fixed
  // 6 would halve the average of an account that is only three months old.
  const avgOf = (type) => {
    const rows = trailing.filter(r => r._id.type === type);
    if (!rows.length) return 0;
    const months = new Set(trailing.map(r => r._id.m)).size || 1;
    return rows.reduce((s, r) => s + r.total, 0) / months;
  };

  res.json({
    // Net worth is derived from the ACCOUNT stores, not from `DailyNetWorth.settledValue`.
    //
    // They are not the same figure. The net-worth series runs to T-1, so anything that
    // happened TODAY — an account opened, a salary credited — is not in it yet, while the
    // account stores carry cash to T. Reading the headline from the series while the tiles
    // beneath it read from the accounts made the page contradict itself: a ₹22L home loan
    // added today was missing from the headline and present in "Liabilities", so net worth
    // overstated by exactly the loan.
    //
    // `DailyNetWorth` remains the source for the CHART and for the changes below, where a
    // settled T-1 series is exactly what is wanted.
    netWorth:         totalAssets - totalLiabilities,
    asof,
    netWorthChange: {
      day:   netWorthChange(nwDoc, 1),
      week:  netWorthChange(nwDoc, 7),
      month: netWorthChange(nwDoc, 30),
      year:  netWorthChange(nwDoc, 365),
    },
    totalAssets,
    totalLiabilities,
    totalCash,

    monthlyIncome,
    monthlyExpense,
    monthlySavings:   monthlyIncome - monthlyExpense,
    // Share of income kept. Null with no income — dividing by zero would report either
    // an infinite savings rate or a misleading 0%.
    savingsRate:      monthlyIncome > 0 ? ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100 : null,
    avgMonthlyIncome:  avgOf('income'),
    avgMonthlyExpense: avgOf('expense'),

    accountCount:  accounts.length,
    holdingsCount: symbolsSeen.size,
    recentTransactions,
  });
}));

// @route   GET /api/dashboard/portfolio
// The book marked to market: per-holding value, unrealised & realised P&L, day change,
// weight — plus the same rolled up, and allocation by asset type at MARKET VALUE.
// Values are the last settled close (T-1), matching the stores.
// `?account=<id>` scopes it to one account (the account page's holdings).
router.get('/portfolio', asyncHandler(async (req, res) => {
  const { account } = req.query;
  if (account && !mongoose.Types.ObjectId.isValid(account)) throw badRequest('Invalid account id');
  const { holdings, totals } = await getPortfolio(req.user._id, { live: false, account: account || null });
  const profile = await getProfile(holdings).catch((e) => { console.error(e); return null; });
  res.json({ holdings, totals, allocation: allocationByType(holdings), profile });
}));

// @route   GET /api/dashboard/contribution?days=N
//
// Who made the money over the last N days — each holding's gain, and its share of the
// portfolio's return over that window in percentage points. `days` omitted (or 0) means
// the whole history, where the same formula degenerates into lifetime total gain with
// realised profits included, because a position closed inside the window still counts.
//
// This cannot be served from `/portfolio`: the AVCO cost basis carries no date, so every
// figure derived from it is lifetime by construction. See `getContribution`.
router.get('/contribution', asyncHandler(async (req, res) => {
  const days = Math.max(0, Math.min(parseInt(req.query.days) || 0, 3650));
  const { account } = req.query;
  if (account && !mongoose.Types.ObjectId.isValid(account)) throw badRequest('Invalid account id');
  const to   = t1Ms();
  res.json(await getContribution(req.user._id, {
    fromMs: days ? to - days * DAY_MS : null,
    toMs:   to,
    account: account || null,
  }));
}));

// @route   GET /api/dashboard/holdings
// The raw book at COST (no pricing, no network). `/portfolio` is what the UI wants for
// anything about performance; this stays for callers that only need the instrument list.
router.get('/holdings', asyncHandler(async (req, res) => {
  const holdingsDocs = await AccountHoldings.find({ user: req.user._id }).select('holdings').lean();

  const merged = {};
  holdingsDocs.forEach(doc => (doc.holdings || []).forEach(h => {
    const sym = h.assetSymbol;
    if (!sym) return;
    merged[sym] ??= {
      assetSymbol: sym, assetName: h.assetName, assetType: h.assetType,
      units: 0, totalInvested: 0,
      // How the asset is VALUED travels with it. The merge used to keep only the
      // quantities, so this route's answer said a physical gold holding had no purity
      // and a US stock no quote currency — facts about the instrument, identical in
      // every account that holds it, and the difference between re-opening a position
      // correctly and re-opening it as 22K rupees. First non-null wins; they cannot
      // disagree across accounts, because they describe the same asset.
      purity: null, rate: null, currency: null,
    };
    merged[sym].units         += h.units         || 0;
    merged[sym].totalInvested += h.totalInvested || 0;
    merged[sym].purity   ??= h.purity   ?? null;
    merged[sym].rate     ??= h.rate     ?? null;
    merged[sym].currency ??= h.currency ?? null;
  }));

  Object.values(merged).forEach(h => {
    h.avgPricePerUnit = h.units > 0 ? h.totalInvested / h.units : 0;
  });

  res.json(holdingsToArray(Object.values(merged)).filter(h => h.totalInvested > 0));
}));

// @route   GET /api/dashboard/income-expense?months=N
// Monthly income / expense / net, with EVERY month in the window present — a month with
// no transactions must still plot as a zero, or the chart silently closes the gap and
// draws a spend-free month as if it never happened.
router.get('/income-expense', asyncHandler(async (req, res) => {
  const months = Math.min(Math.max(1, Math.min(parseInt(req.query.months) || 6, 60)), await monthsAvailable(req.user._id));

  const rows = await Transaction.aggregate([
    { $match: {
      user: req.user._id,
      date: { $gte: startOfMonthsAgo(months - 1) },
      type: { $in: ['income', 'expense'] },
    } },
    { $group: {
      _id: { m: { $dateToString: { format: '%Y-%m', date: '$date' } }, type: '$type' },
      total: { $sum: '$amount' },
    } },
  ]);

  const byMonth = {};
  rows.forEach(r => {
    byMonth[r._id.m] ??= { income: 0, expense: 0 };
    byMonth[r._id.m][r._id.type] = r.total;
  });

  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d   = startOfMonthsAgo(i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const { income = 0, expense = 0 } = byMonth[key] || {};
    out.push({
      month: key,
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? ((income - expense) / income) * 100 : null,
    });
  }

  res.json(out);
}));

// @route   GET /api/dashboard/categories?type=expense|income&months=N
//
// Category totals for ONE direction of cashflow. Where the money goes is only half the
// question — where it comes from is the other half, and the aggregation is identical, so
// the direction is a parameter rather than a second route. (Was `/expense-categories`,
// which could only ever answer the half.)
//
// TWO windows, in ONE pass: the one asked for, and the equal-length one immediately
// before it. A category total on its own says how BIG something is and nothing about
// which way it is going — "₹42,000 on eating out" is only actionable next to what the
// same six months cost last time. Grouping by { category, month } gets both out of a
// single aggregation, and the month buckets double as the category's own series.
router.get('/categories', asyncHandler(async (req, res) => {
  const months = Math.min(Math.max(1, Math.min(parseInt(req.query.months) || 1, 60)), await monthsAvailable(req.user._id));
  const type   = req.query.type === 'income' ? 'income' : 'expense';

  const rows = await Transaction.aggregate([
    // Reaching back 2N months costs the same index scan; the previous window is simply
    // the buckets that fall outside the current one.
    { $match: { user: req.user._id, type, date: { $gte: startOfMonthsAgo(months * 2 - 1) } } },
    { $group: {
      _id: { c: '$category', m: { $dateToString: { format: '%Y-%m', date: '$date' } } },
      total: { $sum: '$amount' },
      count: { $sum: 1 },
    } },
  ]);

  // The month keys of the CURRENT window, oldest first. A month the category was left
  // alone must still carry a zero, or its series silently closes the gap and a habit
  // picked up last month looks like one held all year.
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = startOfMonthsAgo(i);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const at = new Map(keys.map((k, i) => [k, i]));

  const byCategory = new Map();
  for (const r of rows) {
    const code = r._id.c ?? null;              // an uncategorised row groups under null
    let entry = byCategory.get(code);
    if (!entry) {
      entry = { _id: code, total: 0, count: 0, prev: 0, series: new Array(months).fill(0) };
      byCategory.set(code, entry);
    }

    // Compare the key, don't just miss the map: a month is "previous" only when it is
    // BEFORE the window. A future-dated transaction also misses, and counting it as
    // last period's spending would be worse than the chart above, which drops it.
    const i = at.get(r._id.m);
    if (i !== undefined) {
      entry.total += r.total;
      entry.count += r.count;
      entry.series[i] += r.total;
    } else if (r._id.m < keys[0]) {
      entry.prev += r.total;
    }
  }

  // A category that appears ONLY in the previous window has nothing to rank in this one.
  // It is still not silence — the total it used to carry is gone from the window total,
  // which is the honest way that reads.
  res.json([...byCategory.values()]
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total));
}));

// @route   GET /api/dashboard/spending-profile?months=N
// Monthly averages of income and spending, spending split essential / discretionary / other
// (utils/spendClass) — the inputs the FIRE page plans from. Averaged over ACTIVE months.
router.get('/spending-profile', asyncHandler(async (req, res) => {
  const months = Math.min(Math.max(1, Math.min(parseInt(req.query.months) || 12, 60)), await monthsAvailable(req.user._id));
  const rows = await Transaction.aggregate([
    { $match: { user: req.user._id, type: { $in: ['income', 'expense'] }, date: { $gte: startOfMonthsAgo(months - 1) } } },
    { $group: {
      _id: { type: '$type', category: '$category', m: { $dateToString: { format: '%Y-%m', date: '$date' } } },
      total: { $sum: '$amount' },
    } },
  ]);
  const active = new Set(rows.map(r => r._id.m)).size || 1;
  const sum = { income: 0, expense: 0, essential: 0, discretionary: 0, other: 0 };
  for (const r of rows) {
    sum[r._id.type] += r.total;
    if (r._id.type === 'expense') sum[spendClass(r._id.category)] += r.total;
  }
  const avg = (v) => v / active;
  res.json({
    months, activeMonths: active,
    income: avg(sum.income), expense: avg(sum.expense),
    essential: avg(sum.essential), discretionary: avg(sum.discretionary), other: avg(sum.other),
  });
}));

module.exports = router;
