/**
 * Technical indicators for `PriceGrapher`, computed from the chart's own series.
 *
 * Every function takes the values in order (nulls allowed — a day with no quote) and
 * returns arrays aligned 1:1 with them, null until the indicator has enough history to
 * mean anything. All are scale-equivariant (RSI scale-free), so computing them on a
 * series and then rebasing it to 100 gives the same lines as rebasing first.
 */

/**
 * The indicator TYPES. A chart holds instances of them — `{ id, type, period, width? }` —
 * so any number of each can be drawn, each with its own settings (SMA 37 beside SMA 200).
 * `params` drive the editor: their bounds, step and default.
 */
const PERIOD = (dflt, max = 400) => ({ key: 'period', label: 'Period', min: 2, max, step: 1, default: dflt });

export const INDICATOR_TYPES = [
  { type: 'sma', label: 'SMA', name: 'Simple moving average',      group: 'Moving averages', kind: 'line',
    params: [PERIOD(50)], note: 'The plain average of the last N points' },
  { type: 'ema', label: 'EMA', name: 'Exponential moving average', group: 'Moving averages', kind: 'line',
    params: [PERIOD(20)], note: 'An average that weights recent points more' },
  { type: 'bb',  label: 'Bollinger', name: 'Bollinger Bands',      group: 'Volatility', kind: 'band',
    params: [PERIOD(20), { key: 'width', label: 'Width (σ)', min: 0.5, max: 4, step: 0.5, default: 2 }],
    note: 'An N-point average ± a number of standard deviations' },
  { type: 'rsi', label: 'RSI', name: 'Relative strength index',     group: 'Momentum', kind: 'pane',
    params: [PERIOD(14, 100)], note: '0–100 · over 70 stretched, under 30 washed out' },
];

export const indicatorTypeOf = (type) => INDICATOR_TYPES.find(t => t.type === type);

/** "SMA 50", "Bollinger 20 · 2σ", "RSI 14". */
export function indicatorLabel(ind) {
  const t = indicatorTypeOf(ind.type);
  if (!t) return '';
  return ind.type === 'bb' ? `${t.label} ${ind.period} · ${ind.width}σ` : `${t.label} ${ind.period}`;
}

/** A param value pulled inside its bounds and onto its step; anything unreadable falls back to the default. */
export function clampParam(param, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return param.default;
  const stepped = Math.round(v / param.step) * param.step;
  return Math.min(param.max, Math.max(param.min, +stepped.toFixed(4)));
}

let _seq = 0;
/** A new instance of `type` with its defaults; a moving average skips periods already on the chart. */
export function newIndicator(type, existing = []) {
  const t = indicatorTypeOf(type);
  const ind = { id: `${type}-${Date.now().toString(36)}-${++_seq}`, type };
  for (const p of t.params) ind[p.key] = p.default;
  if (t.kind === 'line') {
    const taken = new Set(existing.filter(e => e.type === type).map(e => e.period));
    ind.period = [ind.period, 20, 50, 100, 200, 10].find(n => !taken.has(n)) ?? ind.period;
  }
  return ind;
}

/** A chart fetcher's window plus its `{ pad }` of warm-up history, for a DAILY series (no window = all of it). */
export const paddedDays = (days, opts) => (days ? days + (opts?.pad || 0) : days);

/**
 * Calendar days of history to fetch ahead of a window so every indicator is warm from its
 * first point: trading sessions are ~5 in 7 calendar days, plus room for holidays. Rounded
 * UP to 50 days, so editing a period refetches only when it needs a longer run-up.
 */
export const lookbackDays = (inds) => {
  const n = Math.max(0, ...inds.map(i => (i.period || 0) + (i.type === 'rsi' ? 1 : 0)));
  return n ? Math.ceil((n * 1.5 + 10) / 50) * 50 : 0;
};

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  const win = [];
  values.forEach((v, i) => {
    if (v == null) return;
    win.push(v); sum += v; count++;
    if (win.length > n) { sum -= win.shift(); count--; }
    if (count === n) out[i] = sum / n;
  });
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null, seen = 0, seed = 0;
  values.forEach((v, i) => {
    if (v == null) return;
    seen++;
    // Seeded with the simple average of the first n points.
    if (prev == null) {
      seed += v;
      if (seen === n) { prev = seed / n; out[i] = prev; }
      return;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  });
  return out;
}

function bollinger(values, n = 20, width = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  const win = [];
  values.forEach((v, i) => {
    if (v == null) return;
    win.push(v);
    if (win.length > n) win.shift();
    if (mid[i] == null) return;
    const sd = Math.sqrt(win.reduce((s, x) => s + (x - mid[i]) ** 2, 0) / n);
    upper[i] = mid[i] + width * sd;
    lower[i] = mid[i] - width * sd;
  });
  return { upper, lower, mid };
}

/** Wilder's RSI. */
function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  let prev = null, gain = 0, loss = 0, steps = 0;
  values.forEach((v, i) => {
    if (v == null) return;
    if (prev == null) { prev = v; return; }
    const d = v - prev;
    prev = v;
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    steps++;
    if (steps <= n) {
      gain += g; loss += l;
      if (steps < n) return;
      gain /= n; loss /= n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  });
  return out;
}

/**
 * One indicator instance over `values` → `{ [seriesName]: number[] }`. A line has `line`,
 * a band `upper`/`lower`, the RSI pane `rsi`.
 */
export function computeIndicator(ind, values) {
  switch (ind.type) {
    case 'sma': return { line: sma(values, ind.period) };
    case 'ema': return { line: ema(values, ind.period) };
    case 'bb':  { const { upper, lower } = bollinger(values, ind.period, ind.width); return { upper, lower }; }
    case 'rsi': return { rsi: rsi(values, ind.period) };
    default:    return {};
  }
}
