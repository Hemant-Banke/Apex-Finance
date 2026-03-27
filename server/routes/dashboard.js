const express = require('express');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const DailyNetWorth = require('../models/DailyNetWorth');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings = require('../models/AccountHoldings');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// @route   GET /api/dashboard/summary
// Uses pre-computed stores (DailyAccountBalance, AccountHoldings, DailyNetWorth)
// instead of re-aggregating transactions on every request.
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user._id;

    const [accounts, dailyBalances, holdingsDocs, nwDoc] = await Promise.all([
      Account.find({ user: userId }).lean(),
      DailyAccountBalance.find({ user: userId }).select('account lastValue').lean(),
      AccountHoldings.find({ user: userId }).lean(),
      DailyNetWorth.findOne({ user: userId }).select('lastValue').lean(),
    ]);

    // Cash balance per account from pre-computed store
    const cashByAccount = {};
    dailyBalances.forEach(d => { cashByAccount[d.account.toString()] = d.lastValue || 0; });

    // Book value of assets per account from holdings store
    const investedByAccount = {};
    holdingsDocs.forEach(doc => {
      const holdings = doc.holdings || {};
      const total = Object.values(holdings).reduce((sum, h) => sum + (h.totalInvested || 0), 0);
      investedByAccount[doc.account.toString()] = total;
    });

    let totalAssets      = 0;
    let totalLiabilities = 0;
    accounts.forEach(acc => {
      const id   = acc._id.toString();
      const cash = cashByAccount[id] || 0;
      if (acc.isDebt) {
        totalLiabilities += Math.abs(cash);
      } else {
        totalAssets += cash + (investedByAccount[id] || 0);
      }
    });

    // Holdings count — unique symbols with qty > 0 across all accounts
    const symbolsSeen = new Set();
    holdingsDocs.forEach(doc => {
      Object.entries(doc.holdings || {}).forEach(([sym, h]) => {
        if ((h.qty || 0) > 0) symbolsSeen.add(sym);
      });
    });

    // Monthly income/expense still comes from transactions (these aren't cached elsewhere)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [monthlyFlow, recentTransactions] = await Promise.all([
      Transaction.aggregate([
        { $match: { user: userId, date: { $gte: startOfMonth }, type: { $in: ['income', 'expense'] } } },
        { $group: { _id: '$type', total: { $sum: '$amount' } } }
      ]),
      Transaction.find({ user: userId })
        .populate('account',   'name type')
        .populate('toAccount', 'name type')
        .sort({ date: -1 })
        .limit(10)
    ]);

    const monthlyIncome  = monthlyFlow.find(f => f._id === 'income')?.total  || 0;
    const monthlyExpense = monthlyFlow.find(f => f._id === 'expense')?.total || 0;

    res.json({
      netWorth:         nwDoc?.lastValue ?? (totalAssets - totalLiabilities),
      totalAssets,
      totalLiabilities,
      monthlyIncome,
      monthlyExpense,
      monthlySavings:   monthlyIncome - monthlyExpense,
      accountCount:     accounts.length,
      holdingsCount:    symbolsSeen.size,
      recentTransactions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/dashboard/holdings
// Returns all holdings for the user across all accounts, merged by symbol.
router.get('/holdings', async (req, res) => {
  try {
    const holdingsDocs = await AccountHoldings.find({ user: req.user._id }).lean();

    const merged = {};
    holdingsDocs.forEach(doc => {
      Object.entries(doc.holdings || {}).forEach(([sym, h]) => {
        if (!merged[sym]) {
          merged[sym] = { symbol: sym, name: h.name, type: h.type, qty: 0, totalInvested: 0, avgCostPerUnit: 0 };
        }
        merged[sym].qty           += h.qty           || 0;
        merged[sym].totalInvested += h.totalInvested || 0;
      });
    });

    // Recompute blended avgCostPerUnit after merge
    Object.values(merged).forEach(h => {
      h.avgCostPerUnit = h.qty > 0 ? h.totalInvested / h.qty : 0;
    });

    res.json(Object.values(merged).filter(h => h.totalInvested > 0));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/dashboard/asset-allocation
// Returns holdings grouped by asset type from AccountHoldings (not transactions).
router.get('/asset-allocation', async (req, res) => {
  try {
    const holdingsDocs = await AccountHoldings.find({ user: req.user._id }).lean();

    const byType = {};
    holdingsDocs.forEach(doc => {
      Object.entries(doc.holdings || {}).forEach(([sym, h]) => {
        if ((h.totalInvested || 0) <= 0) return;
        const t = h.type || 'other';
        if (!byType[t]) byType[t] = { _id: t, totalInvested: 0, assets: new Set() };
        byType[t].totalInvested += h.totalInvested;
        byType[t].assets.add(sym);
      });
    });

    const allocation = Object.values(byType).map(x => ({
      _id:           x._id,
      totalInvested: x.totalInvested,
      assets:        Array.from(x.assets)
    }));

    res.json(allocation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/dashboard/income-expense
router.get('/income-expense', async (req, res) => {
  try {
    const userId = req.user._id;
    const { months = 6 } = req.query;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const data = await Transaction.aggregate([
      { $match: { user: userId, date: { $gte: startDate }, type: { $in: ['income', 'expense'] } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' }, total: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const monthlyData = {};
    data.forEach(entry => {
      const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
      if (!monthlyData[key]) monthlyData[key] = { month: key, income: 0, expense: 0 };
      monthlyData[key][entry._id.type] = entry.total;
    });

    res.json(Object.values(monthlyData));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/dashboard/expense-categories
router.get('/expense-categories', async (req, res) => {
  try {
    const userId = req.user._id;
    const { months = 1 } = req.query;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const categories = await Transaction.aggregate([
      { $match: { user: userId, type: 'expense', date: { $gte: startDate } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    res.json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
