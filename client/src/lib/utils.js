import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Domain type vocabularies live in one place; re-exported here for convenience
// so existing `import { ACCOUNT_TYPES } from '../lib/utils'` call sites keep working.
export {
  ACCOUNT_TYPES, TRANSACTION_TYPES, ASSET_TYPES,
  labelOf, accountTypeLabel, transactionTypeLabel, assetTypeLabel,
} from './constants';

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

export function formatCategoryCode(code) {
  if (!code || code === 'general') return '';
  // Strip prefix (tp_, ts_, tpu_, tsu_) from the most specific part
  const last = code.split('/').pop();
  const clean = last.replace(/^t[sp]u?_/, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1).replace(/_/g, ' ');
}

export function getTransactionName(tx) {
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '';
  if (tx.type === 'income')  return `Income: ${formatCategoryCode(tx.category) || cap(tx.category)}`;
  if (tx.type === 'expense') return `Expense: ${formatCategoryCode(tx.category) || cap(tx.category)}`;
  if (tx.type === 'transfer')   return 'Transfer';
  if (tx.type === 'adjustment') return 'Adjustment';
  if (tx.type === 'buy')  return `Buy Asset: ${cap(tx.assetSymbol || tx.assetName || 'Unknown')}`;
  if (tx.type === 'sell') return `Sell Asset: ${cap(tx.assetName || tx.assetSymbol || 'Unknown')}`;
  return cap(tx.type);
}

export function getAccountIcon(type) {
  const icons = {
    bank: 'Landmark',
    brokerage: 'TrendingUp',
    retirement: 'Shield',
    debt: 'CreditCard',
    wallet: 'Wallet',
    other: 'Briefcase'
  };
  return icons[type] || 'Briefcase';
}

export const CHART_COLORS = [
  '#C9A96A', '#60a5fa', '#3fbf9a', '#a78bfa', '#22c55e',
  '#f0a04b', '#f472b6', '#38bdf8', '#e0607a', '#8ea0b8'
];
