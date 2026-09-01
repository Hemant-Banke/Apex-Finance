const { DAY_MS, IST_OFFSET_MS } = require('./constants');

/**
 * UTC-midnight timestamp for any date-like value: a Date, an ms number, or a date
 * string. Every day index in the stores is one of these — the whole codebase keys
 * days by UTC midnight, so this is the only way a day is derived.
 *
 * This truncates whatever instant it is GIVEN; it does not know about time zones. A
 * transaction dated "2026-08-10" is the 10th, full stop. Only the question of which
 * date is *today* is a zone question — see `todayMs`.
 */
function midnight(date) {
  const t = date instanceof Date ? date.getTime()
          : typeof date === 'number' ? date
          : new Date(date).getTime();
  return t - (t % DAY_MS);
}

/**
 * YYYY-MM-DD for any date-like value. Read in UTC to match `midnight` — reading a
 * UTC-midnight timestamp with local getters lands on the previous day west of
 * Greenwich, which would shift every date the API emits.
 */
function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year  = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today (T) — the IST calendar date, keyed as a UTC midnight.
 *
 * Two different things are going on here and they must not be confused:
 *
 *   - WHICH CALENDAR DATE is "today" is an IST question. This is a rupee app for an
 *     Indian user, so the day turns over at 12:00 AM IST, not at 05:30 AM IST — which
 *     is what `midnight(new Date())` meant, since it truncated the current instant in
 *     UTC. For those five and a half hours the whole app believed it was yesterday:
 *     the portfolio's day change went on reporting the previous session's move as if
 *     it were today's, the stores refused to extend, and the transaction form rejected
 *     today's date as being in the future.
 *   - HOW a day is ENCODED is still UTC midnight, unchanged. Every store index, every
 *     price key and every stored `startDate` is a UTC-midnight timestamp, and they
 *     stay that way — shifting the encoding by 5h30m would leave day differences that
 *     are no longer whole multiples of `DAY_MS` and silently corrupt every series.
 *
 * So: add the offset to the CLOCK, then truncate in UTC. 01:00 IST on the 2nd (which
 * is 19:30 UTC on the 1st) becomes 01:00 UTC on the 2nd, and truncates to the 2nd.
 */
const todayMs = () => midnight(Date.now() + IST_OFFSET_MS);

/** UTC-midnight ms for yesterday (T-1, the last settled day), IST reckoning. */
const t1Ms = () => todayMs() - DAY_MS;

/** Now, in ms. */
const nowMs = () => Date.now();

/** YYYY-MM-DD for today (T). */
const todayStr = () => toDateStr(todayMs());

/** YYYY-MM-DD for yesterday (T-1, the last settled day). */
const t1Str = () => toDateStr(t1Ms());

/** Yahoo's quoteType vocabulary → ours. */
function mapQuoteType(quoteType) {
  const map = {
    EQUITY:         'stock',
    ETF:            'etf',
    CRYPTOCURRENCY: 'crypto',
    MUTUALFUND:     'mutual_fund',
    BOND:           'bond',
    FUTURE:         'commodity',
    CURRENCY:       'other',
    INDEX:          'other',
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
 * We still prefer `shortname` when it is a genuine name: for US funds it is the only
 * field carrying the share class (VFIAX / VFINX / VFFSX all share the longname
 * "Vanguard 500 Index Fund"). So `longname` is used only when `shortname` is missing
 * or merely repeats the symbol.
 */
function resolveQuoteName({ symbol = '', shortname = '', longname = '' } = {}) {
  const sym   = symbol.trim().toUpperCase();
  const base  = sym.split('.')[0];   // compare against the bare ticker too
  const short = shortname.trim();

  const isPlaceholder = !short
    || short.toUpperCase() === sym
    || short.toUpperCase() === base;

  return isPlaceholder ? (longname.trim() || symbol) : short;
}

module.exports = {
  midnight,
  toDateStr,
  todayMs,
  t1Ms,
  nowMs,
  todayStr,
  t1Str,
  mapQuoteType,
  resolveQuoteName,
};
