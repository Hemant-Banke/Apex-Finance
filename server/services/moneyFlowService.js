const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { todayMs } = require('../utils/helpers');
const { spendClass } = require('../utils/spendClass');

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Month keys, oldest first, ending with the app's current month. */
function monthKeys(count) {
  const t = new Date(todayMs());
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(monthKey(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1))));
  return keys;
}

const emptyRow = (month) => ({
  month, income: 0, sold: 0, fromOutside: 0,
  spent: 0, essential: 0, discretionary: 0, otherSpend: 0, invested: 0, toOutside: 0,
  cash: 0, debt: 0, cashByType: {},
});

/**
 * Where each month's money came from and where it went, from transactions alone.
 * Balanced by construction: income + sold + fromOutside = spent + invested + toOutside + cash + debt,
 * where `cash` / `debt` are the net flow into non-debt cash and into debt accounts. Adjustments
 * (opening balances, corrections) are not money moving, so they are left out.
 */
async function getMoneyFlow(userId, requested = 12) {
  const first = await Transaction.findOne({ user: userId, type: { $in: ['income', 'expense', 'transfer', 'buy', 'sell'] } })
    .sort({ date: 1 }).select('date').lean();
  if (!first) return { months: [], prev: null };

  const t = new Date(todayMs()), f = new Date(first.date);
  const available = Math.max(1, (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1);
  const months = Math.min(Math.max(1, Math.min(parseInt(requested, 10) || 12, 60)), available);

  // Twice the window, so the one before it can be compared.
  const keys = monthKeys(months * 2);
  const [y, m] = keys[0].split('-').map(Number);
  const [accounts, txns] = await Promise.all([
    Account.find({ user: userId }).select('type isDebt').lean(),
    Transaction.find({
      user: userId, date: { $gte: new Date(Date.UTC(y, m - 1, 1)) },
      type: { $in: ['income', 'expense', 'transfer', 'buy', 'sell'] },
    }).select('type amount date account toAccount category usesCashBalance').lean(),
  ]);
  const typeOf = new Map(accounts.map(a => [String(a._id), a.isDebt || a.type === 'debt' ? 'debt' : a.type]));

  const rows = new Map(keys.map(k => [k, emptyRow(k)]));
  for (const tx of txns) {
    const row = rows.get(monthKey(new Date(tx.date)));
    if (!row) continue;                       // future-dated
    const a = Math.abs(tx.amount || 0);
    const credit = (acct, v) => {
      const type = typeOf.get(String(acct));
      if (!type) return;
      if (type === 'debt') row.debt += v;
      else { row.cash += v; row.cashByType[type] = (row.cashByType[type] || 0) + v; }
    };
    switch (tx.type) {
      case 'income':  row.income += a; credit(tx.account, a); break;
      case 'expense': {
        row.spent += a;
        const c = spendClass(tx.category);
        row[c === 'other' ? 'otherSpend' : c] += a;
        credit(tx.account, -a);
        break;
      }
      case 'transfer':
        credit(tx.account, -a);
        if (tx.toAccount && typeOf.has(String(tx.toAccount))) credit(tx.toAccount, a); else row.toOutside += a;
        break;
      case 'buy':
        row.invested += a;
        if (tx.usesCashBalance) credit(tx.account, -a); else row.fromOutside += a;
        break;
      case 'sell':
        row.sold += a;
        if (tx.usesCashBalance) credit(tx.account, a); else row.toOutside += a;
        break;
      default: break;
    }
  }

  const all = [...rows.values()];
  const before = all.slice(0, months);
  const window = all.slice(months);
  const hasPrev = before.some(r => r.income || r.spent || r.invested || r.sold);
  const prev = hasPrev ? before.reduce((s, r) => {
    for (const k of Object.keys(s)) if (typeof r[k] === 'number') s[k] += r[k];
    return s;
  }, { ...emptyRow('prev'), cashByType: undefined }) : null;
  if (prev) { delete prev.cashByType; prev.months = before.filter(r => r.income || r.spent || r.invested || r.sold).length; }

  return { months: window, prev };
}

module.exports = { getMoneyFlow };
