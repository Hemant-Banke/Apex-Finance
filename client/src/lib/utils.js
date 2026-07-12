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

export function getTransactionSign(type) {
  // Only cash flows carry a direction sign. Buy/sell move value between cash and
  // assets (net-neutral), so they show no +/−.
  if (type === 'income') return '+';
  if (type === 'expense') return '−';
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
export function getTransactionName(tx, describe) {
  switch (tx.type) {
    case 'income':
    case 'expense': {
      const kind  = tx.type === 'income' ? 'Income' : 'Expense';
      const label = describe?.(tx.category);
      return label ? `${kind}: ${label}` : kind;
    }
    case 'transfer':   return 'Transfer';
    case 'adjustment': return 'Adjustment';
    case 'buy':        return `Buy Asset: ${tx.assetName || tx.assetSymbol || 'Unknown'}`;
    case 'sell':       return `Sell Asset: ${tx.assetName || tx.assetSymbol || 'Unknown'}`;
    default:           return tx.type;
  }
}

export const CHART_COLORS = [
  '#C9A96A', '#60a5fa', '#3fbf9a', '#a78bfa', '#22c55e',
  '#f0a04b', '#f472b6', '#38bdf8', '#e0607a', '#8ea0b8'
];
