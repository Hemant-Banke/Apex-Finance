/**
 * series — pure helpers for daily price series and the returns read off them.
 *
 * A "day map" is `{ [utcMidnightMs]: value }` (what `marketDataService.closesByDay`
 * returns); a "sorted series" is the same as `[[dayMs, value], …]`, oldest first, which is
 * what every walk and lookup here wants. One implementation of each, shared by the market
 * board, the sector map and the company page, so a 1-year return cannot mean one thing
 * on one page and another on the next.
 */

const { DAY_MS } = require('./constants');

/** Round to `d` places; null and non-finite stay null (never 0). */
const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Percentage change from `then` to `now`. No base (null or 0) → null, never ±Infinity. */
const pctChange = (now, then) => (now != null && then ? (now / then - 1) * 100 : null);

/** A day map → sorted `[[dayMs, value], …]`. */
const toSorted = (dayMap) => Object.keys(dayMap || {}).map(Number).sort((a, b) => a - b).map(d => [d, dayMap[d]]);

/** The value on or before `dayMs` in a sorted series (binary search), or null. */
function valueAt(sorted, dayMs) {
  let lo = 0, hi = sorted.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid][0] <= dayMs) { best = sorted[mid][1]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Look-back windows, by key. `years` marks those that also get an annualised (CAGR) figure. */
const WINDOWS = {
  '1w':  { days: 7 },
  '1m':  { days: 30 },
  '3m':  { days: 91 },
  '6m':  { days: 182 },
  ytd:   { ytd: true },
  '1y':  { days: 365 },
  '3y':  { days: 3 * 365, years: 3 },
  '5y':  { days: 5 * 365, years: 5 },
};

/**
 * Point-to-point returns of a sorted series over each window, measured back from its LAST
 * close by calendar days and taking the close on or before that day (so a window starting
 * on a holiday still has a base).
 *
 * `1d` is the last close against the one before it, whatever day that was — Monday's is
 * against Friday. A window reaching back past the series' own start has NO return: not
 * one measured from the first close, which would pass a two-year-old listing off as a
 * five-year record. YTD is measured from the last close of the previous year.
 *
 * @returns {{ last, '1d', [window], [window+'Cagr'] }}
 */
function windowReturns(sorted, keys = Object.keys(WINDOWS)) {
  if (!sorted.length) return { last: null, '1d': null };
  const [lastDay, last] = sorted[sorted.length - 1];
  const out = { last, '1d': sorted.length > 1 ? pctChange(last, sorted[sorted.length - 2][1]) : null };
  for (const k of keys) {
    const w = WINDOWS[k];
    const from = w.ytd ? Date.UTC(new Date(lastDay).getUTCFullYear(), 0, 1) - DAY_MS : lastDay - w.days * DAY_MS;
    if (from < sorted[0][0]) { out[k] = null; continue; }
    const base = valueAt(sorted, from);
    out[k] = pctChange(last, base);
    if (w.years && out[k] != null) out[`${k}Cagr`] = ((last / base) ** (1 / w.years) - 1) * 100;
  }
  return out;
}

module.exports = { round, pctChange, toSorted, valueAt, windowReturns, WINDOWS };
