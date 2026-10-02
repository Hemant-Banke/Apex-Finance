/**
 * Vocabulary for the Markets and company pages. Kept apart from the components (a module
 * exporting both is not Fast-Refresh-safe — see lib/recurrence.js). Date and axis
 * formatting live in lib/utils with every other page's.
 */

import { formatCrore, formatCompactNative, formatNativeCurrency, axisCompact } from './utils';

/** The look-back windows NSE reports every index over, and the field each one reads. */
export const WINDOWS = [
  { key: '1d', label: '1D', field: 'chg1d', long: 'today' },
  { key: '1w', label: '1W', field: 'chg1w', long: 'this week' },
  { key: '1m', label: '1M', field: 'chg1m', long: 'this month' },
  { key: '1y', label: '1Y', field: 'chg1y', long: 'this year' },
];
export const windowOf = (key) => WINDOWS.find(w => w.key === key) || WINDOWS[0];

/** The ranges every market price chart (a `PriceGrapher`) offers — Markets and a company alike. */
export const MARKET_RANGES = [
  { label: '1M', days: 30 },  { label: '3M', days: 91 },  { label: '6M', days: 182 },
  { label: '1Y', days: 365 }, { label: '3Y', days: 1095 }, { label: '5Y', days: 1825 },
];

/**
 * Closes → the `[{date, value}]` a `PriceGrapher` draws. In its growth view the series is
 * indexed to 100 at its first point — the base its benchmark overlays are rebased onto.
 */
export function toChartSeries(rows, growth, pick = r => r.close) {
  const pts = (rows || []).map(r => ({ date: r.date, value: pick(r) })).filter(p => p.value != null);
  if (!growth || !pts.length) return pts;
  const base = pts[0].value;
  return pts.map(p => ({ date: p.date, value: (p.value / base) * 100 }));
}

/**
 * An index level or a price, in the unit it is quoted in. Index points are not rupees,
 * so they carry no ₹; a quote in dollars says so.
 */
export function formatLevel(v, currency) {
  if (v == null || isNaN(v)) return '—';
  const digits = Math.abs(v) >= 10_000 ? 0 : 2;
  const n = v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (currency === 'USD') return `$${n}`;
  if (currency === 'INR') return `₹${n}`;
  return currency ? `${n} ${currency}` : n;
}

/** A compact y-axis tick in a price's own unit: ₹ (null → the chart's default), index points, or a foreign currency. */
export const axisFormatFor = (currency) => (currency === 'INR' ? undefined
  : (v) => formatCompactNative(v, currency || undefined));

/** A rupee price at market precision — the `fmt` for share prices. */
export const rupeeLevel = (v) => formatLevel(v, 'INR');

/** The company page for an NSE symbol. Under /markets so the sidebar keeps Markets lit. */
export const stockPath = (symbol) => `/markets/stocks/${encodeURIComponent(symbol)}`;

// Where an instrument page's back link returns: the page that linked to it (via router
// state `from`), else Markets.
const BACK_LABELS = [
  [/^\/accounts\/[^/]+/, 'Account'], [/^\/accounts/, 'Accounts'], [/^\/analytics/, 'Analytics'],
  [/^\/transactions/, 'Transactions'], [/^\/$/, 'Dashboard'],
];
export function backTarget(state) {
  const from = state?.from;
  const hit = from && BACK_LABELS.find(([re]) => re.test(from.split('?')[0]));
  return hit ? { to: from, label: hit[1] } : { to: '/markets', label: 'Markets' };
}

/** The company page for a stock listed abroad, by its Yahoo symbol (AAPL, 7203.T). */
export const globalStockPath = (symbol) => `/markets/world/${encodeURIComponent(symbol)}`;

/**
 * Formatters for a company page's money (`data.money`): ₹ crore at home, the company's
 * own currency compacted abroad. `big` is the quote currency (market cap, EV); `fin` the
 * currency its statements are filed in, which can differ for a cross-listing.
 */
export function companyMoney(m) {
  const home = !m || m.unit === 'crore';
  const fin = m?.financialCurrency || m?.currency;
  return {
    home,
    unitLabel: home ? '₹ crore' : fin,
    big:      home ? (v) => formatCrore(v) : (v) => formatCompactNative(v, m.currency),
    fin:      home ? (v) => formatCrore(v) : (v) => formatCompactNative(v, fin),
    axis:     home ? (v) => axisCompact(v) : (v) => formatCompactNative(v),
    price:    home ? (v) => formatLevel(v, 'INR') : (v) => (v == null ? '—' : formatNativeCurrency(v, m.currency)),
    perShare: home ? (v) => (v == null ? '—' : `₹${v.toFixed(2)}`) : (v) => (v == null ? '—' : formatNativeCurrency(v, fin)),
  };
}

/** The price page for any other instrument — an index, a metal, a coin, a fund. */
export const assetPath = (symbol) => `/markets/assets/${encodeURIComponent(symbol)}`;

/**
 * Where picking a security in Markets takes you, or null if it has no market to show.
 *
 * A listed company (NSE or abroad) has a full company page; everything else with a price history
 * gets the asset page. Physical gold and silver are the DOMESTIC metal price per gram —
 * the same figure the holding is valued at — whatever the user named the holding. A
 * self-priced asset (an FD, a flat) has no market at all.
 */
export function viewPathFor(sec) {
  if (!sec?.symbol) return null;
  if (sec.type === 'gold' || sec.type === 'silver') {
    return sec.isManual || sec.symbol.startsWith('_METAL:') ? assetPath(`_METAL:${sec.type}`) : assetPath(sec.symbol);
  }
  if (sec.isManual) return null;
  const nse = sec.type === 'stock' && nseSymbolOf(sec.symbol);
  if (nse) return stockPath(nse);
  // A company listed abroad gets the company page too; a BSE listing stays on the price page.
  if (sec.type === 'stock' && !/\.BO$/i.test(sec.symbol)) return globalStockPath(sec.symbol);
  return assetPath(sec.symbol);
}

/**
 * The NSE symbol behind a Yahoo ticker, or null — only Indian listed equities have a
 * company page. "RELIANCE.NS" → "RELIANCE"; a BSE listing ("500325.BO") is numeric and
 * maps to nothing we can look up.
 */
export function nseSymbolOf(symbol) {
  const m = /^([A-Z0-9&-]+)\.NS$/i.exec(symbol || '');
  return m ? m[1].toUpperCase() : null;
}
