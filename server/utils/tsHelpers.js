const { DAY_MS } = require("../utils/constants");

/**
 * Add two time series arrays together, element-wise. Merges TS with their different start dates and end dates, filling missing values with 0.
 * @param {number[]} ts1 - First time series array.
 * @param {number[]} ts2 - Second time series array.
 * @param {number} startMs1 - Start time for the first time series.
 * @param {number} startMs2 - Start time for the second time series.
 * @param {number} endMs1 - End time for the first time series.
 * @param {number} endMs2 - End time for the second time series.
 * @returns {{ result: number[], startMs: number, endMs: number }} - The resulting time series array and its bounds.
 */
function tsAdder(ts1, ts2, startMs1, startMs2, endMs1, endMs2) {
  const startMs = Math.min(startMs1, startMs2);
  const endMs = Math.max(endMs1, endMs2);
  const length = Math.round((endMs - startMs) / DAY_MS) + 1;
  const result = new Array(length).fill(0);

  const offset1 = Math.round((startMs1 - startMs) / DAY_MS);
  const offset2 = Math.round((startMs2 - startMs) / DAY_MS);

  for (let i = 0; i < ts1.length; i++) {
    const index = offset1 + i;
    (index >= 0 && index < length) && (result[index] += ts1[i]);
  }

  for (let i = 0; i < ts2.length; i++) {
    const index = offset2 + i;
    (index >= 0 && index < length) && (result[index] += ts2[i]);
  }

  return { result, startMs, endMs };
}

/**
 * Concatenate two time series arrays together. Filles intermidiary values with 0 delta.
 * @param {number[]} ts1 - First time series array.
 * @param {number[]} ts2 - Second time series array.
 * @param {number} startMs1 - Start time for the first time series.
 * @param {number} startMs2 - Start time for the second time series.
 * @param {number} endMs1 - End time for the first time series.
 * @param {number} endMs2 - End time for the second time series.
 * @returns {{ result: number[], startMs: number, endMs: number }} - The resulting time series array and its bounds.
 */
function tsConcat(ts1, ts2, startMs1, startMs2, endMs1, endMs2) {
  const lastCash1 = ts1[ts1.length - 1] ?? 0;
  const daysBetween = Math.round((startMs2 - endMs1) / DAY_MS) - 1;
  const filler = daysBetween > 0 ? new Array(daysBetween).fill(lastCash1) : [];

  return { 
    result: ts1.concat(filler, ts2), 
    startMs: Math.min(startMs1, startMs2), 
    endMs: Math.max(endMs1, endMs2) 
  };
}

module.exports = {
  tsAdder,
  tsConcat
};