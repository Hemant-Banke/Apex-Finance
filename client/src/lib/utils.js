import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Formatting and display helpers. The domain type vocabularies (ACCOUNT_TYPES,
// TRANSACTION_TYPES, …) live in ./constants — import them from there.

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * A figure in a foreign asset's own currency (e.g. a US stock's "$200.00" average
 * cost). Uses that currency's own conventions — `en-IN` would group dollars into
 * lakhs — and always shows paise/cents, since native prices are quoted precisely.
 * Falls back to INR formatting when there is no foreign currency.
 */
export function formatNativeCurrency(amount, currency) {
  if (!currency || currency === 'INR') return formatCurrency(amount);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown/!ISO currency code — show the code rather than throwing.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/**
 * Condense large INR amounts into Indian units (L / Cr) so they don't overflow
 * tight UI like tooltips. Below ₹1L the full formatted value is kept.
 */
export function formatCompact(amount) {
  if (amount == null || isNaN(amount)) return '—';
  const a = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (a >= 1_00_00_000) return `${sign}₹${+(a / 1_00_00_000).toFixed(2)}Cr`;
  if (a >= 1_00_000)    return `${sign}₹${+(a / 1_00_000).toFixed(2)}L`;
  return formatCurrency(amount);
}

/**
 * An amount already in ₹ CRORE — the unit the exchanges publish institutional flows in.
 * Converting to rupees only to shrink them back would print eleven digits on the way;
 * past a lakh crore it steps up to "₹2.38L Cr" (no space before the L, matching "₹12.5L"), which is how the figure is spoken in India.
 */
export function formatCrore(cr, { signed = false } = {}) {
  if (cr == null || isNaN(cr)) return '—';
  const a = Math.abs(cr);
  const sign = cr < 0 ? '−' : signed && cr > 0 ? '+' : '';
  if (a >= 1_00_000) return `${sign}₹${+(a / 1_00_000).toFixed(2)}L Cr`;
  return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
}

/** Formatter that condenses only when the magnitude is large (≥ ₹1L). */
export function compactIfLarge(amount, formatValue = formatCurrency) {
  return Math.abs(amount) >= 1_00_000 ? formatCompact(amount) : formatValue(amount);
}

/**
 * The app's day turns over at 12:00 AM IST — see `server/utils/helpers.todayMs`.
 *
 * The client has to agree with the server about which date is "today", or between
 * midnight and 05:30 IST the date pickers cap at yesterday and refuse a transaction
 * the server would happily accept.
 *
 * Computed explicitly rather than read off the browser's clock: `toISOString()` is UTC
 * (the bug this replaces), and local getters would be right only for a viewer who
 * happens to be in India. The day belongs to the portfolio, not to where it is opened.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for today, in IST. */
export function todayStr() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0];
}

/**
 * A stored date (ISO string, Date or ms) → "YYYY-MM-DD" for a date input, read in UTC
 * like every stored date. Empty → today.
 */
export function toDateInput(date) {
  if (!date) return todayStr();
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return new Date(date).toISOString().slice(0, 10);
}

// ── Period labels ────────────────────────────────────────────────────────────
// One set, used by every chart, ledger and tooltip — there were five copies of the
// month list and three ways of writing a quarter. All read a "YYYY-MM[-DD]" string
// directly (no Date parsing, so no time-zone can shift a month-end into the next month).

export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const _ymd = (iso) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || '');
  return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null } : null;
};

/** "2026-03" / "2026-03-31" → "Mar 2026". */
export function monthLabel(iso) {
  const p = _ymd(iso);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.y}` : iso || '';
}

/** "2026-09-30" → "30 Sep", or "30 Sep 2026" with the year. */
export function dayLabel(iso, withYear = false) {
  const p = _ymd(iso);
  if (!p) return iso || '';
  return `${p.d ?? ''} ${MONTHS_SHORT[p.m - 1]}${withYear ? ` ${p.y}` : ''}`.trim();
}

/** Axis label across years: "2026-09-30" → "Sep 26". */
export function monthYearShort(iso) {
  const p = _ymd(iso);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${String(p.y).slice(2)}` : iso || '';
}

/**
 * The Indian financial year a date falls in, named by the year it ENDS: April 2025 to
 * March 2026 is FY26. "2026-03-31" → "FY26", "2026-06-30" → "FY27".
 */
export function fiscalYear(iso) {
  const p = _ymd(iso);
  return p ? `FY${String(p.m <= 3 ? p.y : p.y + 1).slice(2)}` : '';
}

const QUARTER_OF_MONTH_END = { 3: ['Jan–Mar', 4], 6: ['Apr–Jun', 1], 9: ['Jul–Sep', 2], 12: ['Oct–Dec', 3] };

/**
 * A quarter-end date → its months and its place in the fiscal year:
 * "2026-06-30" → { months: 'Apr–Jun 2026', fq: 'Q1 FY27', short: "Jun '26" }.
 */
export function fiscalQuarter(iso) {
  const p = _ymd(iso);
  const q = p && QUARTER_OF_MONTH_END[p.m];
  if (!q) return null;
  return { months: `${q[0]} ${p.y}`, fq: `Q${q[1]} ${fiscalYear(iso)}`, short: `${MONTHS_SHORT[p.m - 1]} '${String(p.y).slice(2)}` };
}

/**
 * A compact axis tick in Indian units — "1.8L", "90k", "−3.2k", "450" — with an optional
 * prefix ("₹"). For axes only: it drops precision a reader of a tick does not need.
 */
export function axisCompact(v, prefix = '') {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1_00_00_000) return `${s}${prefix}${+(a / 1_00_00_000).toFixed(1)}Cr`;
  if (a >= 1_00_000)    return `${s}${prefix}${+(a / 1_00_000).toFixed(1)}L`;
  if (a >= 1000)        return `${s}${prefix}${+(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `${s}${prefix}${+a.toFixed(a >= 10 ? 0 : 1)}`;
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatDateShort(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric'
  });
}

export function getTransactionColor(type) {
  const colors = {
    income: 'text-[var(--color-success)]',
    buy: 'text-[var(--color-success)]',
    expense: 'text-[var(--color-danger)]',
    sell: 'text-[var(--color-danger)]',
    transfer: 'text-[var(--color-chart-warm)]',
    adjustment: 'text-[var(--color-text-secondary)]',
  };
  return colors[type] || 'text-[var(--color-text-secondary)]';
}

export function getTransactionSign(type, incoming) {
  // Only cash flows carry a direction sign. Buy/sell move value between cash and
  // assets (net-neutral), so they show no +/−.
  if (type === 'income') return '+';
  if (type === 'expense') return '−';
  // A transfer has no direction in the abstract — it only acquires one when read
  // FROM an account. In an account's own statement it plainly is money in or out,
  // so the caller says which side this row is being read from.
  if (type === 'transfer' && incoming != null) return incoming ? '+' : '−';
  return '';
}

/**
 * What a transaction is called in a list.
 *
 * A category CODE is an internal handle ("tp_other_exp/ts_misc_exp") — de-slugging it
 * yields garbage ("Misc exp"), so the real name has to be looked up in the taxonomy.
 * `describe` is `label` from `useCategoryNames()`; without it (or before the taxonomy
 * loads) an income/expense falls back to its bare type, which is at least not wrong.
 */
export function getTransactionName(tx, describe, incoming) {
  switch (tx.type) {
    case 'income':
    case 'expense': {
      const kind  = tx.type === 'income' ? 'Income' : 'Expense';
      const label = describe?.(tx.category);
      return label ? `${kind}: ${label}` : kind;
    }
    case 'transfer':   return incoming == null ? 'Transfer' : (incoming ? 'Transfer in' : 'Transfer out');
    case 'adjustment': return 'Adjustment';
    case 'buy':        return `Buy Asset: ${tx.assetName || tx.assetSymbol || 'Unknown'}`;
    case 'sell':       return `Sell Asset: ${tx.assetName || tx.assetSymbol || 'Unknown'}`;
    default:           return tx.type;
  }
}

/**
 * The categorical palette — for encoding IDENTITY (which asset type, which category).
 *
 * Assigned in fixed order and never cycled: a 9th series folds into "Other" rather than
 * reusing slot 1, or two different things end up the same colour.
 *
 * Green and red are absent on purpose. They are this app's STATUS colours (gain/loss,
 * buy/sell) and reusing them for "series 4" would make a category look like a profit.
 * That overlap was also the old palette's worst defect: its warm orange and its success
 * green sat at ΔE 5.8 under protanopia — indistinguishable to a red-blind reader.
 *
 * Validated against the card surface (#13171C) for lightness band, chroma floor,
 * colour-blind separation of adjacent pairs, and contrast. Do not edit by eye.
 */
export const CHART_COLORS = [
  '#B8853A', // gold      — the brand hue, deepened for a data mark
  '#3B82F6', // blue
  '#14A085', // teal
  '#8B5CF6', // purple
  '#D7743A', // orange
  '#DB4F92', // pink
  '#2E92B8', // cyan
  '#8A9A3F', // olive
];

/** Gain / loss / flat, as a text colour token. Never the categorical palette. */
export function pnlColor(v, { flat = 'var(--color-text-secondary)' } = {}) {
  if (!v) return flat;
  return v > 0 ? 'var(--color-success)' : 'var(--color-danger)';
}

/** A signed money figure: "+₹12,400" / "−₹3,100". */
export function formatSigned(amount, format = formatCurrency) {
  if (amount == null || isNaN(amount)) return '—';
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${format(Math.abs(amount))}`;
}

/**
 * A signed difference between two percentages — "+3.2 pp". The gap between two returns,
 * or a shift in a shareholding, is measured in percentage POINTS, not percent: a stake
 * going from 20% to 18% moved −2 points, which is not "−10%".
 */
export function formatPoints(v, digits = 1, unit = 'pp') {
  if (v == null || isNaN(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(digits)} ${unit}`;
}

/** A signed percentage: "+14.4%". Null (no meaningful base) renders as an em dash. */
export function formatPct(pct, digits = 2) {
  if (pct == null || isNaN(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

/** Percentage change from `before` to `now`; null when there is no positive base to measure from. */
export const pctChange = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);

/** A plain count or quantity in Indian grouping ("1,23,456.5"). Null renders as an em dash. */
export function formatCount(v, maxDigits = 0) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-IN', { maximumFractionDigits: maxDigits });
}
