/**
 * calendarService — performance by CALENDAR day, for the calendar view on Analytics.
 *
 * One row per day from the first asset or cashflow day to today. The client rolls days up
 * into calendar months and years, so every granularity is built from the same rows and a
 * month always equals the sum (gain) or the compound (return) of its days.
 *
 *   value  — the asset book's value that day (Σ account assetTS; today from `markBook`, the
 *            same figure the portfolio headline shows). null before the first holding.
 *   flow   — money moved into the book that day (buys − sells, INR).
 *   gain   — value − previous value − flow: what the investments made, flows removed.
 *   ret    — gain / previous value; null when there was nothing invested the day before.
 *            The SAME daily step the growth chart chains (`tsService.toGrowthIndex`).
 *   inc / exp — income and expense booked that day.
 */

const Transaction = require('../models/Transaction');
const { assetTotalSeries } = require('./dailyValueService');
const { assetValuesByAccount } = require('./portfolioService');
const { assetFlowImpact } = require('../utils/transactionHelpers');
const { midnight, todayMs, toDateStr } = require('../utils/helpers');
const { DAY_MS } = require('../utils/constants');

async function getCalendar(userId, { live = false } = {}) {
  const today = todayMs();
  const [{ valuesTS, startMs }, now, txns] = await Promise.all([
    assetTotalSeries(userId),
    assetValuesByAccount(userId, { live }),
    Transaction.find({ user: userId, type: { $in: ['income', 'expense', 'buy', 'sell'] } })
      .select('type amount date').lean(),
  ]);

  const flowByDay = new Map();
  const incByDay  = new Map();
  const expByDay  = new Map();
  let firstMs = Infinity;
  for (const tx of txns) {
    const day = midnight(tx.date);
    if (day > today) continue;
    firstMs = Math.min(firstMs, day);
    const add = (m, v) => m.set(day, (m.get(day) || 0) + v);
    if (tx.type === 'income')  add(incByDay, tx.amount || 0);
    else if (tx.type === 'expense') add(expByDay, tx.amount || 0);
    else add(flowByDay, assetFlowImpact(tx));
  }

  // The asset series runs to T-1; today is the portfolio's own valuation on the asked basis.
  const valueAt = (day) => {
    if (startMs == null || day < startMs) return null;
    if (day === today) return now.total;
    const i = Math.round((day - startMs) / DAY_MS);
    return i < valuesTS.length ? valuesTS[i] : valuesTS[valuesTS.length - 1];
  };
  if (startMs != null) firstMs = Math.min(firstMs, startMs);
  if (!Number.isFinite(firstMs)) return { asof: now.asof, days: [] };

  const days = [];
  let prev = null;
  for (let day = firstMs; day <= today; day += DAY_MS) {
    const value = valueAt(day);
    const flow  = flowByDay.get(day) || 0;
    let gain = null, ret = null;
    if (value != null) {
      gain = value - (prev ?? 0) - flow;
      if (prev > 0) ret = gain / prev;
    }
    days.push({
      date: toDateStr(day),
      value, flow, gain, ret,
      inc: incByDay.get(day) || 0,
      exp: expByDay.get(day) || 0,
    });
    if (value != null) prev = value;
  }

  return { asof: now.asof, days };
}

module.exports = { getCalendar };
