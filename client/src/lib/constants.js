/**
 * Shared client-side domain constants — the single source of truth for the
 * fixed type vocabularies (mirrors server/utils/constants.js).
 *
 * Each list is an array of { value, label } so it can drive <select>s, the
 * TypePicker, and label lookups uniformly. Import from here (or via lib/utils,
 * which re-exports these) rather than hard-coding option lists in components.
 */

export const ACCOUNT_TYPES = [
  { value: 'bank',       label: 'Bank Account', icon: 'Landmark' },
  { value: 'brokerage',  label: 'Brokerage',    icon: 'TrendingUp' },
  { value: 'retirement', label: 'Retirement',   icon: 'Shield' },
  { value: 'debt',       label: 'Debt / Loan',  icon: 'CreditCard' },
  { value: 'wallet',     label: 'Wallet',       icon: 'Wallet' },
  { value: 'other',      label: 'Other',        icon: 'Briefcase' },
];

export const TRANSACTION_TYPES = [
  { value: 'income',     label: 'Income' },
  { value: 'expense',    label: 'Expense' },
  { value: 'transfer',   label: 'Transfer' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'buy',        label: 'Buy Asset' },
  { value: 'sell',       label: 'Sell Asset' },
];

export const ASSET_TYPES = [
  { value: 'stock',       label: 'Stock' },
  { value: 'bond',        label: 'Bond' },
  { value: 'mutual_fund', label: 'Mutual Fund' },
  { value: 'etf',         label: 'ETF' },
  { value: 'crypto',      label: 'Crypto' },
  { value: 'gold',        label: 'Gold' },
  { value: 'commodity',   label: 'Commodity' },
  { value: 'epf_nps',     label: 'EPF / NPS' },
  { value: 'fd',          label: 'Fixed Deposit (FD)' },
  { value: 'other',       label: 'Other' },
];

/** Look up the display label for a value within an option list (falls back to the raw value). */
export function labelOf(list, value) {
  return list.find(o => o.value === value)?.label ?? value ?? '';
}

export const accountTypeLabel     = (v) => labelOf(ACCOUNT_TYPES, v);
export const transactionTypeLabel = (v) => labelOf(TRANSACTION_TYPES, v);
export const assetTypeLabel       = (v) => labelOf(ASSET_TYPES, v);
