import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
    // legacy
    deposit: 'text-[var(--color-success)]',
    withdrawal: 'text-[var(--color-danger)]',
  };
  return colors[type] || 'text-[var(--color-text-secondary)]';
}

export function getTransactionSign(type) {
  const positive = ['income', 'sell', 'deposit'];
  const negative = ['expense', 'buy', 'withdrawal'];
  if (positive.includes(type)) return '+';
  if (negative.includes(type)) return '-';
  return ''; // transfer, adjustment: amount carries its own sign
}

export function getTransactionName(tx) {
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '';
  if (tx.type === 'income')  return `Income: ${cap(tx.category)}`;
  if (tx.type === 'expense') return `Expense: ${cap(tx.category)}`;
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

export const ACCOUNT_TYPES = [
  { value: 'bank', label: 'Bank Account' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'debt', label: 'Debt / Loan' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' }
];

export const TRANSACTION_TYPES = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'buy', label: 'Buy Asset' },
  { value: 'sell', label: 'Sell Asset' },
];

export const EXPENSE_CATEGORIES = [
  'rent', 'food', 'transportation', 'utilities', 'entertainment',
  'healthcare', 'education', 'shopping', 'insurance', 'subscriptions',
  'travel', 'personal', 'gifts', 'other'
];

export const INCOME_CATEGORIES = [
  'salary', 'freelance', 'business', 'rental', 'dividends',
  'interest', 'capital_gains', 'gifts', 'other'
];

export const ASSET_TYPES = [
  { value: 'stock', label: 'Stock' },
  { value: 'bond', label: 'Bond' },
  { value: 'mutual_fund', label: 'Mutual Fund' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'gold', label: 'Gold' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'epf_nps', label: 'EPF / NPS' },
  { value: 'fd', label: 'Fixed Deposit (FD)' },
  { value: 'other', label: 'Other' },
];

export const CHART_COLORS = [
  '#2dd4bf', '#f97316', '#60a5fa', '#a78bfa', '#22c55e',
  '#f472b6', '#fbbf24', '#38bdf8', '#ef4444', '#fb923c'
];
