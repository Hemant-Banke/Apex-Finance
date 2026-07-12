const { DAY_MS } = require('../utils/constants');

/** UTC-midnight timestamp (integer) for any date-like value. */
function midnight(date) {
  const t = date.getTime();
  return t - (t % DAY_MS);
}

function midnight_from_ms(t) {
  return t - (t % DAY_MS);
}

/** YYYY-MM-DD string for API output. */
function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateStr_from_ms(t) {
  const date = new Date(t);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** UTC-midnight ms for today (T). */
function todayMs() { return midnight(new Date()); }

/** UTC-now ms for today (T). */
function nowMs() { return new Date().getTime(); }

/** UTC-midnight ms for yesterday (T-1, the last settled day). */
function t1Ms() { return midnight(new Date()) - DAY_MS; }

/** UTC-midnight string for today (T). */
function todayStr() { return toDateStr_from_ms(todayMs()); }

/** UTC-midnight string for yesterday (T-1, the last settled day). */
function t1Str() { return toDateStr_from_ms(t1Ms()); }

function mapQuoteType(quoteType) {
  const map = {
    EQUITY:         'stock',
    ETF:            'etf',
    CRYPTOCURRENCY: 'crypto',
    MUTUALFUND:     'mutual_fund',
    BOND:           'bond',
    FUTURE:         'commodity',
    CURRENCY:       'other',
    INDEX:          'other'
  };
  return map[quoteType] || 'other';
}

/**
 * Display name for a Yahoo search quote.
 *
 * Indian mutual funds come back with `shortname` set to the ticker itself
 * ("0P0001RO8V.BO") and the real fund name only in `longname`, so a plain
 * `shortname || longname` shows the user an opaque code.
 *
 * We still prefer `shortname` when it is a genuine name: for US funds it is the
 * only field carrying the share class (VFIAX / VFINX / VFFSX all share the
 * longname "Vanguard 500 Index Fund"). So `longname` is used only when
 * `shortname` is missing or merely repeats the symbol.
 */
function resolveQuoteName({ symbol = '', shortname = '', longname = '' } = {}) {
  const sym  = symbol.trim().toUpperCase();
  // Compare against the bare ticker too — "0P0001RO8V" vs "0P0001RO8V.BO".
  const base = sym.split('.')[0];
  const short = shortname.trim();
  const isPlaceholder = !short
    || short.toUpperCase() === sym
    || short.toUpperCase() === base;

  return (isPlaceholder ? (longname.trim() || symbol) : short);
}

module.exports = {
  midnight,
  midnight_from_ms,
  toDateStr,
  toDateStr_from_ms,
  todayMs,
  nowMs,
  t1Ms,
  todayStr,
  t1Str,
  mapQuoteType,
  resolveQuoteName,
};