/**
 * Vocabulary for the Markets and company pages. Kept apart from the components (a module
 * exporting both is not Fast-Refresh-safe — see lib/recurrence.js). Date and axis
 * formatting live in lib/utils with every other page's.
 */

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

/** A rupee price at market precision — the `fmt` for share prices. */
export const rupeeLevel = (v) => formatLevel(v, 'INR');

/** The company page for an NSE symbol. Under /markets so the sidebar keeps Markets lit. */
export const stockPath = (symbol) => `/markets/stocks/${encodeURIComponent(symbol)}`;

/** The price page for any other instrument — an index, a metal, a coin, a fund. */
export const assetPath = (symbol) => `/markets/assets/${encodeURIComponent(symbol)}`;

/**
 * Where picking a security in Markets takes you, or null if it has no market to show.
 *
 * An NSE-listed company has a full company page; everything else with a price history
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
  return nse ? stockPath(nse) : assetPath(sec.symbol);
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
