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
    sell: 'text-[var(--color-success)]',
    expense: 'text-[var(--color-danger)]',
    buy: 'text-[var(--color-accent)]',
    transfer: 'text-[var(--color-chart-warm)]',
    adjustment: 'text-[var(--color-text-secondary)]',
  };
  return colors[type] || 'text-[var(--color-text-secondary)]';
}

export function getTransactionSign(type) {
  const positive = ['income', 'sell'];
  const negative = ['expense', 'buy'];
  if (positive.includes(type)) return '+';
  if (negative.includes(type)) return '-';
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
  '#2dd4bf', '#f97316', '#60a5fa', '#a78bfa', '#22c55e',
  '#f472b6', '#fbbf24', '#38bdf8', '#ef4444', '#fb923c'
];
