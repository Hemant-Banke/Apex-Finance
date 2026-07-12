const { DAY_MS } = require('../utils/constants');

/**
 * Add two time-series arrays element-wise, aligning them by their absolute start
 * dates and filling any non-overlapping days with 0.
 *
 * All *Ms arguments are UTC-midnight millisecond timestamps.
 *
 * @returns {{ result: number[], startMs: number, endMs: number }}
 */
function tsAdder(ts1 = [], ts2 = [], startMs1, startMs2, endMs1, endMs2) {
  ts1 = ts1 || [];
  ts2 = ts2 || [];

  // Derive missing bounds from array lengths where possible.
  if (startMs1 == null) startMs1 = startMs2;
  if (startMs2 == null) startMs2 = startMs1;
  if (endMs1 == null) endMs1 = startMs1 + Math.max(0, ts1.length - 1) * DAY_MS;
  if (endMs2 == null) endMs2 = startMs2 + Math.max(0, ts2.length - 1) * DAY_MS;

  const startMs = Math.min(startMs1, startMs2);
  const endMs   = Math.max(endMs1, endMs2);
  const length  = Math.round((endMs - startMs) / DAY_MS) + 1;
  const result  = new Array(length).fill(0);

  const offset1 = Math.round((startMs1 - startMs) / DAY_MS);
  const offset2 = Math.round((startMs2 - startMs) / DAY_MS);

  for (let i = 0; i < ts1.length; i++) {
    const index = offset1 + i;
    if (index >= 0 && index < length) result[index] += ts1[i];
  }
  for (let i = 0; i < ts2.length; i++) {
    const index = offset2 + i;
    if (index >= 0 && index < length) result[index] += ts2[i];
  }

  return { result, startMs, endMs };
}

/**
 * Concatenate two time-series arrays in chronological order, carrying the last
 * value of ts1 forward across any gap between the two ranges.
 *
 * @returns {{ result: number[], startMs: number, endMs: number }}
 */
function tsConcat(ts1 = [], ts2 = [], startMs1, startMs2, endMs1, endMs2) {
  ts1 = ts1 || [];
  ts2 = ts2 || [];

  // If one side is empty, the other simply wins.
  if (!ts1.length) return { result: ts2.slice(), startMs: startMs2, endMs: endMs2 };
  if (!ts2.length) return { result: ts1.slice(), startMs: startMs1, endMs: endMs1 };

  if (endMs1 == null) endMs1 = startMs1 + (ts1.length - 1) * DAY_MS;

  const lastValue    = ts1[ts1.length - 1] ?? 0;
  const daysBetween  = Math.round((startMs2 - endMs1) / DAY_MS) - 1;
  const filler       = daysBetween > 0 ? new Array(daysBetween).fill(lastValue) : [];

  return {
    result: ts1.concat(filler, ts2),
    startMs: Math.min(startMs1, startMs2),
    endMs:   Math.max(endMs1, endMs2),
  };
}

/**
 * Index into a store's series at which a `?days=N` window begins.
 *
 * The window is the last N days *of the store*, counted back from its own endDate —
 * not from today — so a store that has not been extended yet still returns N entries.
 * 0 when the store is shorter than the window, or when no window was asked for.
 */
function sliceStartIndex(startMs, endMs, days) {
  const n = parseInt(days, 10);
  if (!n || n < 1) return 0;

  const cutoffMs = endMs - (n - 1) * DAY_MS;
  if (cutoffMs <= startMs) return 0;
  return Math.round((cutoffMs - startMs) / DAY_MS);
}

module.exports = {
  tsAdder,
  tsConcat,
  sliceStartIndex,
};
