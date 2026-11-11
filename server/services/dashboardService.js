/**
 * dashboardService — the Dashboard's figures, shared by its routes and the assistant's tools,
 * so the two can never report different numbers.
 */

const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const DailyNetWorth = require('../models/DailyNetWorth');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings = require('../models/AccountHoldings');
const { holdingsToArray } = require('./holdingsService');
const { assetValuesByAccount } = require('./portfolioService');
const { todayMs, midnight } = require('../utils/helpers');
const { DAY_MS } = require('../utils/constants');
const { spendClass } = require('../utils/spendClass');

// Against a zero or negative base a percentage is meaningless, so it is withheld.
const change = (current, past, partial) => ({
  abs: current - past,
  pct: past > 0 ? ((current - past) / past) * 100 : null,
  partial,
});

/**
 * Net worth `daysAgo` days before today and the change since. `valuesTS` ends at T-1, so
 * N entries back is exactly N days before today: the day the chart's N-day range opens on.
 * A series shorter than that uses its first entry and says so (`partial`).
 */
function netWorthChange(doc, daysAgo, current) {
  const ts = doc?.valuesTS || [];
  if (ts.length < 2) return null;
  const idx = ts.length - daysAgo;
  return change(current, ts[Math.max(0, idx)], idx < 0);
}

/**
 * Net worth's 1D = the portfolio's 1D + today's cash flows, so the two can never disagree.
 * Not read off the stored series: a late close would put its T-1 point on a different price.
 */
function netWorthDayChange(cashDocs, current, values) {
  const today = todayMs();
  let flows = 0;
  for (const d of cashDocs) {
    const ts = d.cashTS || [];
    if (!ts.length) continue;
    const end = midnight(d.startDate) + (d.cashLen - 1) * DAY_MS;   // last cash day
    const t1Cash = end >= today ? (ts.length > 1 ? ts[ts.length - 2] : 0) : ts[ts.length - 1];
    flows += (d.lastCashValue || 0) - t1Cash;
  }
  const abs = (values.dayChange || 0) + flows;
  return change(current, current - abs, false);
}

// Months from the user's first income/expense to now, so a window never pads empty months.
async function monthsAvailable(userId) {
  const first = await Transaction.findOne({ user: userId, type: { $in: ['income', 'expense'] } })
    .sort({ date: 1 }).select('date').lean();
  if (!first) return 1;
  const f = new Date(first.date), now = new Date(todayMs());
  return Math.max(1, (now.getUTCFullYear() - f.getUTCFullYear()) * 12 + (now.getUTCMonth() - f.getUTCMonth()) + 1);
}

// The first day of the month n months before the app's today (IST), as UTC midnight.
// Built in one step: setMonth on the 31st rolled into the wrong month.
const startOfMonthsAgo = (n) => {
  const d = new Date(todayMs());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
};
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const clampMonths = async (userId, requested, fallback) =>
  Math.min(Math.max(1, Math.min(parseInt(requested) || fallback, 60)), await monthsAvailable(userId));

/**
 * The headline. Net worth is T cash + the book from `assetValuesByAccount`, not the T-1
 * series: anything that happened today is in the accounts but not yet in the series.
 * The series stays the source for the 1W/1M/1Y changes.
 */
async function getSummary(userId, { live = false } = {}) {
  const [accounts, dailyBalances, holdingsDocs, nwDoc, values] = await Promise.all([
    Account.find({ user: userId }).lean(),
    DailyAccountBalance.aggregate([
      { $match: { user: userId } },
      { $project: { account: 1, lastCashValue: 1, startDate: 1, cashLen: { $size: { $ifNull: ['$cashTS', []] } }, cashTS: { $slice: [{ $ifNull: ['$cashTS', []] }, -2] } } },
    ]),
    AccountHoldings.find({ user: userId }).select('holdings').lean(),
    DailyNetWorth.findOne({ user: userId }).lean(),
    assetValuesByAccount(userId, { live }),
  ]);

  const cashByAccount = {};
  dailyBalances.forEach(d => { cashByAccount[d.account.toString()] = d.lastCashValue || 0; });

  // Debt is stored negative; liabilities is its sum flipped, so an overpaid debt reads negative.
  let totalLiabilities = 0, totalCash = 0, totalInvestments = 0;
  accounts.forEach(acc => {
    const id = acc._id.toString();
    if (acc.isDebt) totalLiabilities -= cashByAccount[id] || 0;
    else {
      totalCash        += cashByAccount[id] || 0;
      totalInvestments += values.byAccount[id] || 0;
    }
  });
  const totalAssets = totalCash + totalInvestments;
  const netWorth = totalAssets - totalLiabilities;

  const symbolsSeen = new Set();
  holdingsDocs.forEach(doc => (doc.holdings || []).forEach(h => {
    if (Math.abs(h.units || 0) > 1e-9) symbolsSeen.add(h.assetSymbol);
  }));

  const [thisMonth, recentTransactions] = await Promise.all([
    Transaction.aggregate([
      { $match: { user: userId, date: { $gte: startOfMonthsAgo(0) }, type: { $in: ['income', 'expense'] } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    Transaction.find({ user: userId })
      .populate('account', 'name type')
      .populate('toAccount', 'name type')
      .sort({ date: -1 }).limit(5).lean(),
  ]);

  return {
    netWorth,
    asof: values.asof,
    netWorthChange: {
      day: netWorthDayChange(dailyBalances, netWorth, values),
      ...Object.fromEntries([['week', 7], ['month', 30], ['year', 365]].map(([k, n]) =>
        [k, netWorthChange(nwDoc, n, netWorth)])),
    },
    totalAssets,
    totalLiabilities,
    totalCash,
    totalInvestments,
    monthlyIncome:  thisMonth.find(f => f._id === 'income')?.total  || 0,
    monthlyExpense: thisMonth.find(f => f._id === 'expense')?.total || 0,
    accountCount:  accounts.length,
    holdingsCount: symbolsSeen.size,
    recentTransactions,
  };
}

/** The raw book at COST, merged across accounts with its valuation metadata (first non-null wins). */
async function getHoldingsAtCost(userId) {
  const holdingsDocs = await AccountHoldings.find({ user: userId }).select('holdings').lean();
  const merged = {};
  holdingsDocs.forEach(doc => (doc.holdings || []).forEach(h => {
    const sym = h.assetSymbol;
    if (!sym) return;
    merged[sym] ??= {
      assetSymbol: sym, assetName: h.assetName, assetType: h.assetType,
      units: 0, totalInvested: 0, purity: null, rate: null, currency: null,
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
  return holdingsToArray(Object.values(merged)).filter(h => h.totalInvested > 0);
}

/** Monthly income / expense / net with EVERY month present, so an empty month plots as zero. */
async function getIncomeExpense(userId, requested) {
  const months = await clampMonths(userId, requested, 6);
  const rows = await Transaction.aggregate([
    { $match: { user: userId, date: { $gte: startOfMonthsAgo(months - 1) }, type: { $in: ['income', 'expense'] } } },
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
    const key = monthKey(startOfMonthsAgo(i));
    const { income = 0, expense = 0 } = byMonth[key] || {};
    out.push({ month: key, income, expense, net: income - expense, savingsRate: income > 0 ? ((income - expense) / income) * 100 : null });
  }
  return out;
}

/**
 * Category totals for one direction of cashflow, with the equal window before (`prev`) and
 * a zero-filled monthly `series`, from ONE aggregation reaching back 2N months.
 */
async function getCategoryTotals(userId, { type = 'expense', months: requested } = {}) {
  const months = await clampMonths(userId, requested, 1);
  const dir = type === 'income' ? 'income' : 'expense';
  const rows = await Transaction.aggregate([
    { $match: { user: userId, type: dir, date: { $gte: startOfMonthsAgo(months * 2 - 1) } } },
    { $group: {
      _id: { c: '$category', m: { $dateToString: { format: '%Y-%m', date: '$date' } } },
      total: { $sum: '$amount' },
      count: { $sum: 1 },
    } },
  ]);

  const keys = [];
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(startOfMonthsAgo(i)));
  const at = new Map(keys.map((k, i) => [k, i]));

  const byCategory = new Map();
  for (const r of rows) {
    const code = r._id.c ?? null;
    let entry = byCategory.get(code);
    if (!entry) {
      entry = { _id: code, total: 0, count: 0, prev: 0, series: new Array(months).fill(0) };
      byCategory.set(code, entry);
    }
    // A month is "previous" only when BEFORE the window; a future-dated row also misses the map.
    const i = at.get(r._id.m);
    if (i !== undefined) {
      entry.total += r.total;
      entry.count += r.count;
      entry.series[i] += r.total;
    } else if (r._id.m < keys[0]) {
      entry.prev += r.total;
    }
  }
  return [...byCategory.values()].filter(c => c.total > 0).sort((a, b) => b.total - a.total);
}

/** Monthly averages of income and spending (essential / discretionary / other), over ACTIVE months. */
async function getSpendingProfile(userId, requested) {
  const months = await clampMonths(userId, requested, 12);
  const rows = await Transaction.aggregate([
    { $match: { user: userId, type: { $in: ['income', 'expense'] }, date: { $gte: startOfMonthsAgo(months - 1) } } },
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
  return {
    months, activeMonths: active,
    income: avg(sum.income), expense: avg(sum.expense),
    essential: avg(sum.essential), discretionary: avg(sum.discretionary), other: avg(sum.other),
  };
}

module.exports = {
  getSummary, getHoldingsAtCost, getIncomeExpense, getCategoryTotals, getSpendingProfile,
  startOfMonthsAgo, monthKey,
};
