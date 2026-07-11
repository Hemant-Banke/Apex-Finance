/**
 * currency — everything in Apex is stored in INR.
 *
 * A foreign asset (a US stock, crypto quoted in USD) keeps its NATIVE
 * `pricePerUnit` on the transaction, alongside the `currency` it was quoted in
 * and the `fxRate` used. The transaction `amount`, the holdings cost basis, and
 * every time-series store are INR — so all aggregation stays single-currency and
 * no downstream code has to think about FX.
 *
 * Yahoo quotes a rate as `{CUR}INR=X` — the INR value of one unit of CUR.
 */

const BASE_CURRENCY = 'INR';

/** True when the quote needs no conversion (INR, or simply unknown). */
const isBaseCurrency = (currency) =>
  !currency || String(currency).toUpperCase() === BASE_CURRENCY;

/** Yahoo FX symbol giving INR per one unit of `currency`. */
const fxSymbol = (currency) => `${String(currency).toUpperCase()}${BASE_CURRENCY}=X`;

/** Normalize a currency code; base/unknown currencies collapse to undefined. */
const normalizeCurrency = (currency) =>
  isBaseCurrency(currency) ? undefined : String(currency).toUpperCase();

/** The distinct non-INR currencies across a set of holdings / transactions. */
function distinctCurrencies(items = []) {
  const set = new Set();
  for (const it of items) {
    const c = normalizeCurrency(it?.currency);
    if (c) set.add(c);
  }
  return [...set];
}

/**
 * INR value of a native-currency amount.
 * A missing rate means "not convertible" — callers must not silently treat a
 * foreign figure as INR, so this returns null rather than the input.
 */
function toInr(amount, fxRate = 1) {
  if (amount == null) return null;
  if (!fxRate) return null;
  return amount * fxRate;
}

module.exports = {
  BASE_CURRENCY,
  isBaseCurrency,
  fxSymbol,
  normalizeCurrency,
  distinctCurrencies,
  toInr,
};
