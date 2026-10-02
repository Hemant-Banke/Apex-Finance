const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { DAY_MS } = require('../utils/constants');
const { midnight, toDateStr, todayMs } = require('../utils/helpers');

// Mongoose casts ids in `find` but not in `aggregate`; cast once so both see the same filter.
const oid = (id) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

/** The one filter every transaction read shares: list, summary and insights see the same set. */
function buildFilter(userId, q = {}, { withDates = true } = {}) {
  const filter = { user: oid(userId) };
  const clauses = [];

  const types = list(q.type);
  if (types.length) filter.type = types.length === 1 ? types[0] : { $in: types };

  // Any number of codes; a group code ("tp_food") matches every category under it.
  const cats = list(q.category);
  if (cats.length) filter.category = { $in: cats.map(c => new RegExp(`^${escapeRx(c)}(/|$)`)) };

  if (withDates && (q.startDate || q.endDate)) {
    filter.date = {};
    if (q.startDate) filter.date.$gte = new Date(midnight(q.startDate));
    // Inclusive of the whole end day: some rows carry a time of day, which `$lte midnight` dropped.
    if (q.endDate)   filter.date.$lt  = new Date(midnight(q.endDate) + DAY_MS);
  }

  const min = parseFloat(q.minAmount), max = parseFloat(q.maxAmount);
  if (!isNaN(min) || !isNaN(max)) {
    filter.amount = {};
    if (!isNaN(min)) filter.amount.$gte = min;
    if (!isNaN(max)) filter.amount.$lte = max;
  }

  // An account's statement includes transfers INTO it as well as out of it.
  if (q.account) clauses.push({ $or: [{ account: oid(q.account) }, { toAccount: oid(q.account) }] });

  // Free text matches the note, the asset, or a category whose NAME matched (codes resolved client-side).
  if (q.search?.trim()) {
    const rx = new RegExp(escapeRx(q.search.trim()), 'i');
    const or = [{ notes: rx }, { assetName: rx }, { assetSymbol: rx }];
    const codes = list(q.searchCategories);
    if (codes.length) or.push({ category: { $in: codes.map(c => new RegExp(`^${escapeRx(c)}(/|$)`)) } });
    clauses.push({ $or: or });
  }

  if (clauses.length) filter.$and = clauses;
  return filter;
}

const SORTS = {
  date:   { date: -1, _id: -1 },
  amount: { amount: -1, date: -1 },
};

async function flowsOf(filter) {
  const rows = await Transaction.aggregate([
    { $match: filter },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const of = (t) => rows.find(r => r._id === t) || { total: 0, count: 0 };
  const income = of('income').total, expense = of('expense').total;
  return {
    income, expense, net: income - expense,
    invested: of('buy').total, divested: of('sell').total,
    count: rows.reduce((s, r) => s + r.count, 0),
    byType: Object.fromEntries(rows.map(r => [r._id, r.count])),
  };
}

/** One page of the filtered list plus totals over the WHOLE filtered set. */
async function listTransactions(userId, q) {
  const filter = buildFilter(userId, q);
  const limit = Math.min(parseInt(q.limit) || 50, 5000);
  const page  = Math.max(parseInt(q.page) || 1, 1);

  const [transactions, summary] = await Promise.all([
    Transaction.find(filter)
      .populate('account',   'name type')
      .populate('toAccount', 'name type')
      .sort(SORTS[q.sort] || SORTS.date)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    flowsOf(filter),
  ]);

  return { transactions, total: summary.count, page, pages: Math.ceil(summary.count / limit), summary };
}

/**
 * What the filtered set says, beyond its totals: daily in/out, categories, the largest
 * outflows, and the same totals for the equal window before (when the window is bounded).
 */
async function getInsights(userId, q) {
  const filter = buildFilter(userId, q);
  const cashTypes = q.type ? list(q.type).filter(t => t === 'income' || t === 'expense') : ['income', 'expense'];
  const cashOf = (f) => ({ ...f, type: { $in: cashTypes } });
  const cash = cashOf(filter);
  // Categories ignore the category filter, so the chosen one is highlighted among the rest, not alone.
  const cashAllCats = cashOf(buildFilter(userId, { ...q, category: undefined }));

  let prevFilter = null;
  if (q.startDate && q.endDate) {
    const start = midnight(q.startDate), end = midnight(q.endDate);
    const span = end - start + DAY_MS;
    prevFilter = buildFilter(userId, q, { withDates: false });
    prevFilter.date = { $gte: new Date(start - span), $lt: new Date(start) };
  }

  const [summary, allTypes, daily, categories, largest, prev, earliest] = await Promise.all([
    flowsOf(filter),
    // Counts per type ignore the type filter, so every type chip can say what it holds.
    flowsOf(buildFilter(userId, { ...q, type: undefined })),
    Transaction.aggregate([
      { $match: cash },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        in:    { $sum: { $cond: [{ $eq: ['$type', 'income'] },  '$amount', 0] } },
        out:   { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
        count: { $sum: 1 },
      } },
      { $sort: { _id: 1 } },
    ]),
    Transaction.aggregate([
      { $match: cashAllCats },
      { $group: { _id: { type: '$type', category: '$category' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Transaction.find({ ...cash, type: 'expense' })
      .populate('account', 'name type')
      .sort({ amount: -1, date: -1 }).limit(5).lean(),
    prevFilter ? flowsOf(prevFilter) : null,
    // The first matching income/expense ever, so the calendar starts no earlier than the record.
    Transaction.findOne(cashOf(buildFilter(userId, q, { withDates: false }))).sort({ date: 1 }).select('date').lean(),
  ]);

  const cats = (type) => categories
    .filter(c => c._id.type === type)
    .map(c => ({ _id: c._id.category, total: c.total, count: c.count }));

  return {
    summary,
    typeCounts: allTypes.byType,
    daily: daily.map(d => ({ date: d._id, in: d.in, out: d.out, count: d.count })),
    first: daily[0]?._id || null,
    since: earliest ? toDateStr(earliest.date) : null,
    today: toDateStr(todayMs()),
    expenseCategories: cats('expense'),
    incomeCategories:  cats('income'),
    largest,
    prev,
  };
}

module.exports = { buildFilter, listTransactions, getInsights };
