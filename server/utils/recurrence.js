/**
 * recurrence — pure schedule maths for subscriptions (recurring transactions).
 *
 * A subscription fires on a fixed cadence from its `startDate`. Occurrences are
 * always derived from the START date, never by stepping off the previous one, so a
 * monthly SIP set up on the 31st keeps landing on the 31st (clamped in short months)
 * instead of drifting earlier and earlier — stepping month-by-month from a clamped
 * Feb 28th would pin every later month to the 28th.
 */

const { DAY_MS } = require('./constants');
const { midnight_from_ms } = require('./helpers');

const FREQUENCIES = ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

/** Last day of a month, so a 31st-of-the-month schedule clamps to 28/30. */
const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * The n-th occurrence of a schedule, as UTC-midnight ms. n = 0 is the start date.
 */
function occurrenceAt(startMs, frequency, n) {
  const start = new Date(midnight_from_ms(startMs));

  switch (frequency) {
    case 'daily':       return startMs + n * DAY_MS;
    case 'weekly':      return startMs + n * 7 * DAY_MS;
    case 'fortnightly': return startMs + n * 14 * DAY_MS;

    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      const step  = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
      const day   = start.getUTCDate();
      const total = start.getUTCMonth() + n * step;
      const year  = start.getUTCFullYear() + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12;
      return Date.UTC(year, month, Math.min(day, daysInMonth(year, month)));
    }

    default:
      return NaN;
  }
}

/**
 * Every occurrence in (afterMs, uptoMs], inclusive of `uptoMs`.
 *
 * `afterMs` is exclusive so it can be fed the subscription's `lastRunDate` directly:
 * the run that already happened is not repeated.
 *
 * @param {number} startMs   schedule anchor (UTC-midnight ms)
 * @param {string} frequency one of FREQUENCIES
 * @param {number} uptoMs    inclusive upper bound (usually today)
 * @param {number|null} afterMs  exclusive lower bound (usually lastRunDate), or null
 * @param {number|null} endMs    the schedule's own end date (null = ongoing)
 * @returns {number[]} occurrence days, ascending
 */
function occurrencesBetween(startMs, frequency, uptoMs, afterMs = null, endMs = null) {
  if (!FREQUENCIES.includes(frequency)) return [];

  const ceiling = endMs != null ? Math.min(uptoMs, endMs) : uptoMs;
  const out = [];

  // Bounded: a daily schedule over a decade is ~3650 iterations, and anything longer
  // than this is a mis-entered date rather than a real subscription.
  for (let n = 0; n < 5000; n++) {
    const day = occurrenceAt(startMs, frequency, n);
    if (!Number.isFinite(day) || day > ceiling) break;
    if (afterMs == null || day > afterMs) out.push(day);
  }
  return out;
}

module.exports = {
  FREQUENCIES,
  occurrenceAt,
  occurrencesBetween,
};
