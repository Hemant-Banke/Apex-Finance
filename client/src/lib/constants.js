/**
 * Shared client-side domain constants — the single source of truth for the
 * fixed type vocabularies (mirrors server/utils/constants.js).
 *
 * Each list is an array of { value, label } so it can drive <select>s, the
 * TypePicker, and label lookups uniformly. Import from here (or via lib/utils,
 * which re-exports these) rather than hard-coding option lists in components.
 */

// Icons for these live in lib/accountPickerOptions, which maps each type to a real
// lucide component — a name string here would just be a second list to keep in step.
export const ACCOUNT_TYPES = [
  { value: 'bank',       label: 'Bank Account' },
  { value: 'brokerage',  label: 'Brokerage' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'debt',       label: 'Debt / Loan' },
  { value: 'wallet',     label: 'Wallet' },
  { value: 'other',      label: 'Other' },
];

// Everything a growth view can be compared against (PriceGrapher / CompareIndexDialog) —
// one catalogue for every chart, so net worth, an account, the Markets board and a company
// page all offer the same yardsticks. Any symbol `/market/index-series` serves: Yahoo
// symbols verified on /v8/finance/chart, plus `_METAL:gold|silver` — DOMESTIC metal in
// ₹/g, because COMEX gold in dollars would chart the rupee's move as gold's. `INR:<symbol>`
// is a foreign index converted at each day's rupee rate, so it compounds the index's growth
// AND the dollar's: what an Indian investor holding it actually earned, beside the plain
// index that says how that market did. `group` is the heading the dialog files it under.
// Kept curated rather than open search: a benchmark is a yardstick, not a holding.
export const BENCHMARKS = [
  { symbol: '^NSEI',             label: 'Nifty 50',         group: 'Indian indices' },
  { symbol: '^CNX100',           label: 'Nifty 100',        group: 'Indian indices' },
  { symbol: '^CRSLDX',           label: 'Nifty 500',        group: 'Indian indices' },
  { symbol: '^NSEMDCP50',        label: 'Nifty Midcap 50',  group: 'Indian indices' },
  { symbol: 'NIFTYMIDCAP150.NS', label: 'Nifty Midcap 150', group: 'Indian indices' },
  { symbol: '^NSEBANK',          label: 'Nifty Bank',       group: 'Indian indices' },
  { symbol: '^CNXIT',            label: 'Nifty IT',         group: 'Indian indices' },
  { symbol: '^BSESN',            label: 'Sensex',           group: 'Indian indices' },
  { symbol: '^GSPC',             label: 'S&P 500',          group: 'Global' },
  { symbol: '^IXIC',             label: 'Nasdaq Composite', group: 'Global' },
  { symbol: 'INR:^GSPC',         label: 'S&P 500 in ₹',     group: 'Global, in rupees' },
  { symbol: 'INR:^IXIC',         label: 'Nasdaq in ₹',      group: 'Global, in rupees' },
  { symbol: '_METAL:gold',       label: 'Gold',             group: 'Assets' },
  { symbol: '_METAL:silver',     label: 'Silver',           group: 'Assets' },
  { symbol: 'BTC-INR',           label: 'Bitcoin',          group: 'Assets' },
  { symbol: 'USDINR=X',          label: 'US dollar',        group: 'Assets' },
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

/**
 * Does anything quote this holding, or does the user price it themselves?
 *
 * Asked of a holding the user already owns, where the question is whether re-opening it
 * should auto-fetch a price. `isManualSymbol` cannot answer it: that reads the PREFIX of
 * the catalogue seed a manual asset was created from, and a user-named one keeps no such
 * prefix — "Mumbai Apartment" is stored as `MUMBAI-APARTMENT`, which matches nothing on
 * that list. The TYPE is the honest signal, since it is what every valuation path already
 * branches on. `commodity` is excluded because there is no manual commodity to confuse it
 * with — the seeds are only ever gold, silver, fd, epf_nps, bond and other — and an
 * `AMFI:` code is a fund, whatever else it says.
 *
 * Physical metal still says true here and is still auto-priced: it has no market symbol
 * but IS quotable by type and purity, which the form handles separately.
 */
export const isSelfPricedHolding = ({ symbol = '', type } = {}) =>
  !isMarketAsset(type) && type !== 'commodity' && !String(symbol).startsWith('AMFI:');

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
