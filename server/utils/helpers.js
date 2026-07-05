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
};