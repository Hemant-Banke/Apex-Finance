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
const { toDateStr } = require('./helpers');

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

/** A window may start up to this far before the series' first close (a weekend, a holiday). */
const START_SLACK_MS = 7 * DAY_MS;

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
    if (from < sorted[0][0] - START_SLACK_MS) { out[k] = null; continue; }
    const base = valueAt(sorted, from) ?? sorted[0][1];
    out[k] = pctChange(last, base);
    if (w.years && out[k] != null) out[`${k}Cagr`] = ((last / base) ** (1 / w.years) - 1) * 100;
  }
  return out;
}

/** Annualised internal rate of return of dated cash flows `[[dayMs, amount], …]`, in %. */
function xirr(flows) {
  if (flows.length < 2) return null;
  const t0 = flows[0][0];
  const npv = (r) => flows.reduce((a, [d, v]) => a + v / (1 + r) ** ((d - t0) / (365 * DAY_MS)), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * A monthly SIP of `amount` over the last `years`, bought at the first close on or after
 * each monthly date. Null when the series does not reach back that far.
 */
function sipReturns(sorted, years, amount = 10000) {
  if (sorted.length < 2) return null;
  const [lastDay, last] = sorted[sorted.length - 1];
  const start = new Date(lastDay - years * 365 * DAY_MS);
  if (start.getTime() < sorted[0][0] - START_SLACK_MS) return null;

  const flows = [];
  let units = 0, i = 0;
  for (let m = 0; ; m++) {
    const y = start.getUTCFullYear(), mo = start.getUTCMonth() + m;
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const day = Date.UTC(y, mo, Math.min(start.getUTCDate(), dim));
    if (day > lastDay) break;
    while (i < sorted.length && sorted[i][0] < day) i++;
    if (i >= sorted.length) break;
    units += amount / sorted[i][1];
    flows.push([sorted[i][0], -amount]);
  }
  if (!flows.length) return null;
  const value = units * last;
  return {
    years,
    installments: flows.length,
    invested: flows.length * amount,
    value: round(value, 0),
    xirr: round(xirr([...flows, [lastDay, value]])),
  };
}

/**
 * Every `years`-long holding period inside the series, one ending on each close: the
 * worst, median and best (annualised past a year), how often it made money, and — given
 * a benchmark — how often it beat that benchmark over the very same days.
 */
function rollingReturns(sorted, years, bench = null) {
  if (sorted.length < 2) return null;
  const span = Math.round(years * 365) * DAY_MS;
  const first = sorted[0][0];
  const ann = (r) => (years > 1 ? ((1 + r / 100) ** (1 / years) - 1) * 100 : r);
  const rows = [];
  let beat = 0, paired = 0;
  for (const [d, v] of sorted) {
    if (d - span < first) continue;
    const r = ann(pctChange(v, valueAt(sorted, d - span)));
    if (r == null || !Number.isFinite(r)) continue;
    rows.push([d, r]);
    if (bench?.length && d - span >= bench[0][0]) {
      const rb = ann(pctChange(valueAt(bench, d), valueAt(bench, d - span)));
      if (rb != null) { paired++; if (r > rb) beat++; }
    }
  }
  if (rows.length < 20) return null;
  const sortedR = [...rows].sort((a, b) => a[1] - b[1]);
  const mid = sortedR[Math.floor(sortedR.length / 2)][1];
  return {
    years,
    periods: rows.length,
    worst: round(sortedR[0][1]), worstEnd: sortedR[0][0],
    median: round(mid),
    best: round(sortedR[sortedR.length - 1][1]), bestEnd: sortedR[sortedR.length - 1][0],
    positive: round((rows.filter(([, r]) => r > 0).length / rows.length) * 100, 0),
    beat: paired >= 20 ? round((beat / paired) * 100, 0) : null,
  };
}

/** SIP outcomes (1/3/5Y) and rolling 1Y/3Y returns, each against benchmark `b` when given. */
function holdingExperience(s, b = []) {
  const sip = [1, 3, 5].map(y => {
    const a = sipReturns(s, y);
    return a && { ...a, benchXirr: b.length ? sipReturns(b, y)?.xirr ?? null : null };
  }).filter(Boolean);
  const rolling = [1, 3].map(y => {
    const r = rollingReturns(s, y, b.length ? b : null);
    return r && { ...r, worstEnd: toDateStr(r.worstEnd), bestEnd: toDateStr(r.bestEnd) };
  }).filter(Boolean);
  return { sip, rolling };
}

module.exports = { round, pctChange, toSorted, valueAt, windowReturns, WINDOWS, xirr, sipReturns, rollingReturns, holdingExperience };
