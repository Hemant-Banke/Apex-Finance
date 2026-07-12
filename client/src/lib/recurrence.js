/**
 * Recurrence vocabulary — mirrors server/utils/recurrence.js `FREQUENCIES`.
 *
 * Kept out of the component file so Fast Refresh still works there (a module that
 * exports both a component and constants is not refresh-safe).
 */

export const FREQUENCIES = [
  { value: 'daily',       label: 'Daily' },
  { value: 'weekly',      label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly',     label: 'Monthly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'yearly',      label: 'Yearly' },
];

/** A fresh, disabled recurrence state. */
export const emptyRecurrence = () => ({
  recurring: false,
  frequency: 'monthly',
  endDate:   '',
  ongoing:   true,
  invariant: 'amount',
});
