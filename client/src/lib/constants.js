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
  { value: 'silver',      label: 'Silver' },
  { value: 'commodity',   label: 'Commodity' },
  { value: 'epf_nps',     label: 'EPF / NPS' },
  { value: 'fd',          label: 'Fixed Deposit (FD)' },
  { value: 'other',       label: 'Other' },
];

/**
 * Symbols for assets the user holds off-market. They are never listed anywhere,
 * so they have no quote to look up and no brand logo to fetch — the catalogue
 * seeds below, and a user-named manual asset keeps the prefix it was created from.
 */
export const MANUAL_SYMBOL_PREFIXES = ['REAL-', 'FIXED-', 'EPF-', 'PHYS-', 'PRIVATE-', 'UNLISTED-', 'OTHER-'];

export const isManualSymbol = (symbol) =>
  MANUAL_SYMBOL_PREFIXES.some(p => (symbol || '').startsWith(p));

// ─── Asset valuation metadata (mirrors server/utils/assetPricing.js) ─────────

/** Physical metals: priced per gram of pure metal, then scaled by purity. */
export const PURITY_ASSET_TYPES = ['gold', 'silver'];

/** Types whose annual rate is a contractual coupon rather than an estimate. */
export const COUPON_ASSET_TYPES = ['bond', 'fd', 'epf_nps'];

/** Types the market prices for us — no purity, no rate needed. */
export const MARKET_ASSET_TYPES = ['stock', 'etf', 'mutual_fund', 'crypto'];

/** Selectable purities per metal; `factor` is the fraction of pure metal. */
export const PURITY_OPTIONS = {
  gold: [
    { value: '24K', label: '24K (999)', factor: 0.999 },
    { value: '22K', label: '22K (916)', factor: 0.916 },
    { value: '18K', label: '18K (750)', factor: 0.750 },
    { value: '14K', label: '14K (585)', factor: 0.585 },
  ],
  silver: [
    { value: '999', label: 'Fine (999)',     factor: 0.999 },
    { value: '925', label: 'Sterling (925)', factor: 0.925 },
    { value: '900', label: 'Coin (900)',     factor: 0.900 },
  ],
};

export const isPurityAsset = (t) => PURITY_ASSET_TYPES.includes(t);
export const isMarketAsset = (t) => MARKET_ASSET_TYPES.includes(t);

/** Unlisted assets carry an annual rate so they can be valued over time. */
export const isRateAsset = (t) => !isMarketAsset(t) && !isPurityAsset(t);

/** Field label for the annual rate, by what it means for this asset type. */
export const rateLabel = (t) =>
  COUPON_ASSET_TYPES.includes(t) ? 'Coupon rate (% p.a.)' : 'Expected return (% p.a.)';

/** Look up the display label for a value within an option list (falls back to the raw value). */
export function labelOf(list, value) {
  return list.find(o => o.value === value)?.label ?? value ?? '';
}

export const accountTypeLabel     = (v) => labelOf(ACCOUNT_TYPES, v);
export const transactionTypeLabel = (v) => labelOf(TRANSACTION_TYPES, v);
export const assetTypeLabel       = (v) => labelOf(ASSET_TYPES, v);
