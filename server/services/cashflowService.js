const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { todayMs, toDateStr, midnight } = require('../utils/helpers');
const { DAY_MS } = require('../utils/constants');
const { spendClass } = require('../utils/spendClass');

const INVESTMENT_TYPES = new Set(['brokerage', 'retirement']);
const MONTH_MS = 30.44 * DAY_MS;

const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
// Coefficient of variation: spread relative to the typical size. Null when there is too little to judge.
const cv = (xs) => {
  if (xs.length < 3) return null;
  const m = mean(xs);
  return m > 0 ? Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / m : null;
};

// Merchant-ish key from a note: lower-case words, digits and refs dropped.
const noteKey = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 3).join(' ');

/** Category totals for the window plus the equal window before — the `/dashboard/categories` shape. */
function categoryTotals(rows, keys) {
  const at = new Map(keys.map((k, i) => [k, i]));
  const by = new Map();
  for (const t of rows) {
    const code = t.category ?? null;
    let e = by.get(code);
    if (!e) by.set(code, e = { _id: code, total: 0, count: 0, prev: 0, series: new Array(keys.length).fill(0) });
    const i = at.get(t.month);
    if (i !== undefined) { e.total += t.amount; e.count += 1; e.series[i] += t.amount; }
    else if (t.month < keys[0]) e.prev += t.amount;
  }
  return [...by.values()].filter(c => c.total > 0).sort((a, b) => b.total - a.total);
}

/** Payments that come back month after month at about the same size: rent, EMIs, subscriptions. */
function findRecurring(expenses) {
  const groups = new Map();
  for (const t of expenses) {
    const key = noteKey(t.notes) || `cat:${t.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const out = [];
  for (const rows of groups.values()) {
    const months = new Set(rows.map(r => r.month));
    // At least three distinct months, and roughly once a month — not a weekly grocery run.
    if (months.size < 3 || rows.length > months.size * 1.5) continue;
    const amounts = rows.map(r => r.amount);
    const spread = cv(amounts);
    if (spread == null || spread > 0.25) continue;

    const dates = rows.map(r => r.dateMs).sort((a, b) => a - b);
    const gaps = dates.slice(1).map((d, i) => d - dates[i]);
    const gap = median(gaps);
    const last = dates.at(-1);
    const typical = median(amounts);
    out.push({
      label: rows.at(-1).notes || null,
      category: rows.at(-1).category,
      typical,
      // Monthly equivalent from its own cadence, so a quarterly bill counts at a third.
      monthly: gap ? typical * Math.min(1, MONTH_MS / gap) : typical,
      months: months.size,
      lastDate: toDateStr(last),
      nextDate: gap ? toDateStr(last + gap) : null,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** The largest income source: how regularly it lands, and on which day of the month. */
function incomeRhythm(incomes, activeMonths) {
  const byCat = new Map();
  for (const t of incomes) {
    if (!byCat.has(t.category)) byCat.set(t.category, []);
    byCat.get(t.category).push(t);
  }
  const top = [...byCat.entries()]
    .map(([category, rows]) => ({ category, rows, total: rows.reduce((s, r) => s + r.amount, 0) }))
    .sort((a, b) => b.total - a.total)[0];
  if (!top) return null;

  const months = new Set(top.rows.map(r => r.month));
  const perMonth = [...months].map(m => top.rows.filter(r => r.month === m).reduce((s, r) => s + r.amount, 0));
  const incomeTotal = incomes.reduce((s, r) => s + r.amount, 0);
  return {
    category: top.category,
    share: incomeTotal ? top.total / incomeTotal : 0,
    months: months.size,
    of: activeMonths,
    day: months.size >= 2 ? Math.round(median(top.rows.map(r => new Date(r.dateMs).getUTCDate()))) : null,
    typical: median(perMonth),
    spread: cv(perMonth),
  };
}

/**
 * For each discretionary category: what a typical month costs, against the leaner months
 * you have already lived. Evidence from the user's own record, not a target.
 */
function savingPotential(expenseCats, spanStart) {
  const items = [];
  for (const c of expenseCats) {
    if (spendClass(c._id) !== 'discretionary') continue;
    const values = c.series.slice(spanStart);
    const spent = values.filter(v => v > 0);
    if (values.length < 3 || spent.length < 3) continue;
    const typical = mean(values);
    // A lean month when you did spend, at the frequency you usually spend.
    const lean = quantile(spent, 0.25) * (spent.length / values.length);
    const potential = typical - lean;
    if (potential > 0) items.push({ _id: c._id, typical, lean, potential, months: spent.length });
  }
  items.sort((a, b) => b.potential - a.potential);
  return { monthly: items.reduce((s, i) => s + i.potential, 0), items };
}

/**
 * One account's cashflow over the last `months` calendar months (this one included):
 * monthly flows, where money came from and went, categories against the window before,
 * daily in/out, recurring payments, the main income's rhythm and saving potential.
 */
async function getCashflow(userId, account, requested) {
  const today = new Date(todayMs());
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const id = String(account._id);
  const mine = { user: userId, $or: [{ account: account._id }, { toAccount: account._id }] };

  // The window never reaches back past the account's first month.
  const firstTx = await Transaction.findOne(mine).sort({ date: 1 }).select('date').lean();
  const firstMs = firstTx ? new Date(firstTx.date).getTime() : todayMs();
  const fd = new Date(firstMs);
  const available = Math.max(1, (y - fd.getUTCFullYear()) * 12 + (m - fd.getUTCMonth()) + 1);
  const months = Math.min(requested, available);

  const keys = Array.from({ length: months }, (_, i) => monthKey(Date.UTC(y, m - (months - 1) + i, 1)));
  const startMs = Date.UTC(y, m - (months - 1), 1);
  const prevStartMs = Date.UTC(y, m - (2 * months - 1), 1);

  const [txns, accounts] = await Promise.all([
    Transaction.find({
      ...mine,
      date: { $gte: new Date(prevStartMs) },
      type: { $in: ['income', 'expense', 'transfer', 'buy', 'sell'] },
    }).select('type category amount date notes account toAccount usesCashBalance').lean(),
    Account.find({ user: userId }).select('name type').lean(),
  ]);
  const accountById = new Map(accounts.map(a => [String(a._id), a]));

  const rows = txns.map(t => ({ ...t, dateMs: new Date(t.date).getTime(), month: monthKey(new Date(t.date).getTime()) }));
  const inWindow = rows.filter(r => r.dateMs >= startMs);
  const incomes  = inWindow.filter(r => r.type === 'income'  && String(r.account) === id);
  const expenses = inWindow.filter(r => r.type === 'expense' && String(r.account) === id);

  const monthly = keys.map(month => ({ month, income: 0, expense: 0, transferIn: 0, transferOut: 0, invested: 0, divested: 0 }));
  const byMonth = new Map(monthly.map(r => [r.month, r]));
  const sources = new Map(), destinations = new Map();
  const daily = new Map();
  const tally = (map, aid, amount) => {
    const a = accountById.get(aid);
    const e = map.get(aid) || { account: aid, name: a?.name || 'Unknown account', type: a?.type || null, total: 0, count: 0 };
    e.total += amount; e.count += 1;
    map.set(aid, e);
  };

  for (const r of inWindow) {
    const row = byMonth.get(r.month);
    if (!row) continue;   // future-dated
    const own = String(r.account) === id;
    if (r.type === 'income' && own) row.income += r.amount;
    else if (r.type === 'expense' && own) row.expense += r.amount;
    else if (r.type === 'transfer') {
      if (own) { row.transferOut += r.amount; tally(destinations, String(r.toAccount), r.amount); }
      else     { row.transferIn  += r.amount; tally(sources, String(r.account), r.amount); }
    }
    else if (own && r.usesCashBalance && r.type === 'buy')  row.invested += r.amount;
    else if (own && r.usesCashBalance && r.type === 'sell') row.divested += r.amount;

    if (own && (r.type === 'income' || r.type === 'expense')) {
      const d = toDateStr(r.dateMs);
      const e = daily.get(d) || { date: d, in: 0, out: 0, count: 0 };
      e[r.type === 'income' ? 'in' : 'out'] += r.amount; e.count += 1;
      daily.set(d, e);
    }
  }

  for (const r of monthly) {
    r.net = r.income - r.expense;
    r.savingsRate = r.income > 0 ? (r.net / r.income) * 100 : null;
  }

  const sum = (k) => monthly.reduce((s, r) => s + r[k], 0);
  const totals = {
    income: sum('income'), expense: sum('expense'),
    transferIn: sum('transferIn'), transferOut: sum('transferOut'),
    invested: sum('invested'), divested: sum('divested'),
  };
  for (const [aid, e] of destinations) e.investment = INVESTMENT_TYPES.has(accountById.get(aid)?.type);

  // Months the account was actually in use: from its first movement in the window onwards.
  const isActive = (r) => r.income || r.expense || r.transferIn || r.transferOut || r.invested || r.divested;
  const spanStart = Math.max(0, monthly.findIndex(isActive));
  const active = monthly.filter(isActive);

  const spend = { essential: 0, discretionary: 0, other: 0 };
  for (const t of expenses) spend[spendClass(t.category)] += t.amount;

  // Where in the month the spending lands.
  const thirds = [0, 0, 0];
  for (const t of expenses) {
    const day = new Date(t.dateMs).getUTCDate();
    thirds[day <= 10 ? 0 : day <= 20 ? 1 : 2] += t.amount;
  }

  const ownCash = rows.filter(r => String(r.account) === id);
  const expenseCats = categoryTotals(ownCash.filter(r => r.type === 'expense'), keys);
  const incomeCats  = categoryTotals(ownCash.filter(r => r.type === 'income'), keys);

  return {
    months: monthly,
    window: { from: toDateStr(Math.max(startMs, midnight(firstMs))), to: toDateStr(todayMs()), months, available, activeMonths: active.length },
    first: firstTx ? toDateStr(firstTx.date) : null,
    totals,
    averages: {
      income:  active.length ? totals.income  / active.length : 0,
      expense: active.length ? totals.expense / active.length : 0,
    },
    spendSpread: cv(active.map(r => r.expense).filter(v => v > 0)),
    spend,
    timeOfMonth: thirds,
    sources: [...sources.values()].sort((a, b) => b.total - a.total),
    destinations: [...destinations.values()].sort((a, b) => b.total - a.total),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    categories: { expense: expenseCats, income: incomeCats },
    recurring: findRecurring(expenses),
    incomeRhythm: incomeRhythm(incomes, active.length),
    savingPotential: savingPotential(expenseCats, spanStart),
  };
}

module.exports = { getCashflow };
