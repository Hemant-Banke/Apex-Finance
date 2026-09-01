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

/** Formatter that condenses only when the magnitude is large (≥ ₹1L). */
export function compactIfLarge(amount, formatValue = formatCurrency) {
  return Math.abs(amount) >= 1_00_000 ? formatCompact(amount) : formatValue(amount);
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

/** A signed percentage: "+14.4%". Null (no meaningful base) renders as an em dash. */
export function formatPct(pct, digits = 2) {
  if (pct == null || isNaN(pct)) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}
