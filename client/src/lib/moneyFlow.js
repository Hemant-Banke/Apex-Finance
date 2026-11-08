import { CHART_COLORS } from './utils';

// Cash in muted ink, as on the Accounts page; drawing on it and adding to it are one thing in two directions.
const CASH = 'var(--color-text-muted)';

// Each flow has a fixed hue. Debt and outside money take the same hue on both sides, because they are the same thing.
export const SOURCES = [
  { key: 'income',      label: 'Income',            color: CHART_COLORS[1] },
  { key: 'sold',        label: 'Sold investments',  color: CHART_COLORS[2] },
  { key: 'drewCash',    label: 'Drawn from cash',   color: CASH },
  { key: 'borrowed',    label: 'Borrowed',          color: CHART_COLORS[3] },
  { key: 'fromOutside', label: 'Paid from outside', color: CHART_COLORS[6], hint: 'Buys paid from an account Apex does not track' },
];
export const USES = [
  { key: 'essential',     label: 'Essentials',     color: CHART_COLORS[4] },
  { key: 'discretionary', label: 'Lifestyle',      color: CHART_COLORS[5] },
  { key: 'otherSpend',    label: 'Other spending', color: CHART_COLORS[7] },
  { key: 'invested',      label: 'Invested',       color: CHART_COLORS[0] },
  { key: 'keptCash',      label: 'Kept as cash',   color: CASH },
  { key: 'paidDebt',      label: 'Debt repaid',    color: CHART_COLORS[3] },
  { key: 'toOutside',     label: 'Moved out',      color: CHART_COLORS[6], hint: 'Sent to accounts Apex does not track' },
];

/** A month's (or a sum's) flows, with net cash and debt split into the side each one falls on. */
export function flowValues(r) {
  return {
    income: r.income, sold: r.sold, fromOutside: r.fromOutside,
    drewCash: Math.max(0, -r.cash), borrowed: Math.max(0, -r.debt),
    essential: r.essential, discretionary: r.discretionary, otherSpend: r.otherSpend,
    invested: r.invested, toOutside: r.toOutside,
    keptCash: Math.max(0, r.cash), paidDebt: Math.max(0, r.debt),
  };
}

export const isActive = (r) => !!(r.income || r.spent || r.invested || r.sold);

const NUMERIC = ['income', 'sold', 'fromOutside', 'spent', 'essential', 'discretionary', 'otherSpend', 'invested', 'toOutside', 'cash', 'debt'];

/** Field-by-field sum of months, divided by `div` (1 for a total, the active-month count for an average). */
export function sumRows(rows, div = 1) {
  const out = Object.fromEntries(NUMERIC.map(k => [k, 0]));
  out.cashByType = {};
  for (const r of rows) {
    for (const k of NUMERIC) out[k] += (r[k] || 0) / div;
    for (const [t, v] of Object.entries(r.cashByType || {})) out.cashByType[t] = (out.cashByType[t] || 0) + v / div;
  }
  return out;
}

const share = (a, b) => (b > 0 ? (a / b) * 100 : null);

/** The window's ratios, and the same ratios for the window before when there is one. */
export function flowRatios(t) {
  if (!t) return null;
  return {
    savings:  share(t.income - t.spent, t.income),
    invest:   share(t.invested - t.sold, t.income),
    lifestyle: share(t.discretionary, t.spent),
  };
}
