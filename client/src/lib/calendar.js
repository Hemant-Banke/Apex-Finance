// Calendar performance: daily rows from `/dashboard/calendar` rolled up into calendar
// months and years, plus the statistics the calendar view reports. Pure functions.

import { MONTHS_SHORT } from './utils';

export const UNITS = { day: 10, month: 7, year: 4 };   // key length of each period's date prefix

/** One period per calendar day / month / year, oldest first. */
export function rollUp(days, unit) {
  const len = UNITS[unit];
  const out = [];
  let cur = null;
  for (const d of days) {
    const key = d.date.slice(0, len);
    if (!cur || cur.key !== key) {
      cur = { key, from: d.date, to: d.date, gain: 0, growth: 1, hasRet: false, invested: false, flow: 0, inc: 0, exp: 0, value: null };
      out.push(cur);
    }
    cur.to = d.date;
    if (d.gain != null) { cur.gain += d.gain; cur.invested = true; }
    if (d.ret != null) { cur.growth *= 1 + d.ret; cur.hasRet = true; }
    if (d.value != null) cur.value = d.value;
    cur.flow += d.flow || 0;
    cur.inc  += d.inc || 0;
    cur.exp  += d.exp || 0;
  }
  for (const p of out) {
    p.ret   = p.hasRet ? (p.growth - 1) * 100 : null;   // time-weighted, flows removed
    p.net   = p.inc - p.exp;
    p.saved = p.inc > 0 ? (p.net / p.inc) * 100 : null;
    p.active = p.inc > 0 || p.exp > 0;
  }
  return out;
}

/** The figure a period is coloured and ranked by. Null = nothing to say about it. */
export function metricOf(p, metric) {
  switch (metric) {
    case 'ret':   return p.ret;
    case 'gain':  return p.invested ? p.gain : null;
    case 'net':   return p.active ? p.net : null;
    case 'saved': return p.saved;
    default:      return null;
  }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Streaks of consecutive up / down periods. A flat period (a weekend for stocks) neither
 * extends nor breaks a run; a period with no figure breaks it.
 */
function streaks(values) {
  let longestUp = 0, longestDown = 0, run = 0;
  for (const v of values) {
    if (v == null) { run = 0; continue; }
    if (Math.abs(v) < 1e-9) continue;
    const up = v > 0;
    if (run === 0 || (run > 0) !== up) run = up ? 1 : -1;
    else run += up ? 1 : -1;
    if (run > 0) longestUp = Math.max(longestUp, run); else longestDown = Math.max(longestDown, -run);
  }
  return { longestUp, longestDown, current: run };
}

/** Deepest fall of the compounded book from a previous high, in % (from daily returns). */
export function maxDrawdown(days) {
  let idx = 1, peak = 1, worst = 0, peakDate = null, troughDate = null, at = null;
  for (const d of days) {
    if (d.ret == null) continue;
    idx *= 1 + d.ret;
    if (idx > peak) { peak = idx; at = d.date; }
    const dd = idx / peak - 1;
    if (dd < worst) { worst = dd; troughDate = d.date; peakDate = at; }
  }
  return worst < 0 ? { pct: worst * 100, from: peakDate, to: troughDate } : null;
}

/** Headline statistics over a set of periods for one metric. */
export function periodStats(periods, metric) {
  const rows = periods.map(p => ({ p, v: metricOf(p, metric) }));
  const vals = rows.filter(r => r.v != null);
  const xs = vals.map(r => r.v);
  if (!xs.length) return null;
  const best  = vals.reduce((a, b) => (b.v > a.v ? b : a));
  const worst = vals.reduce((a, b) => (b.v < a.v ? b : a));
  const avg = mean(xs);
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (xs.length - 1)) : null;
  const moved = xs.filter(x => Math.abs(x) >= 1e-9);
  return {
    n: xs.length,
    up: moved.filter(x => x > 0).length,
    down: moved.filter(x => x < 0).length,
    flat: xs.length - moved.length,
    best, worst,
    mean: avg,
    median: median(xs),
    sd,
    ...streaks(rows.map(r => r.v)),
  };
}

/** Cashflow totals over a set of periods. */
export function cashTotals(periods) {
  const inc = periods.reduce((s, p) => s + p.inc, 0);
  const exp = periods.reduce((s, p) => s + p.exp, 0);
  const active = periods.filter(p => p.active).length;
  return { inc, exp, net: inc - exp, saved: inc > 0 ? ((inc - exp) / inc) * 100 : null, active, avgNet: active ? (inc - exp) / active : null };
}

/** Average of a metric by weekday (Mon = 0) over daily periods. */
export function byWeekday(dayPeriods, metric) {
  const buckets = Array.from({ length: 7 }, () => []);
  for (const p of dayPeriods) {
    const v = metricOf(p, metric);
    if (v == null) continue;
    const w = (new Date(`${p.key}T00:00:00Z`).getUTCDay() + 6) % 7;
    buckets[w].push(v);
  }
  return buckets.map((xs, i) => ({ weekday: i, mean: mean(xs), n: xs.length }));
}

/** Average of a metric by calendar month (Jan = 0) across years — the seasonality row. */
export function byCalendarMonth(monthPeriods, metric) {
  const buckets = Array.from({ length: 12 }, () => []);
  for (const p of monthPeriods) {
    const v = metricOf(p, metric);
    if (v != null) buckets[+p.key.slice(5, 7) - 1].push(v);
  }
  return buckets.map((xs, i) => ({ month: i, mean: mean(xs), n: xs.length }));
}

/** Colour scale cap: the 90th percentile of magnitudes, so one outlier cannot wash out the rest. */
export function scaleCap(values) {
  const a = values.filter(v => v != null).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return 1;
  return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] || a[a.length - 1] || 1;
}

/** "Oct 2026" / "2026" / "Sat, 17 Oct 2026" for a period key. */
export function periodLabel(key) {
  if (key.length === 4) return key;
  const m = MONTHS_SHORT[+key.slice(5, 7) - 1];
  if (key.length === 7) return `${m} ${key.slice(0, 4)}`;
  const d = new Date(`${key}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]}, ${+key.slice(8)} ${m} ${key.slice(0, 4)}`;
}
