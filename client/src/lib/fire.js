/**
 * FIRE / retirement maths. Everything is in TODAY's rupees: growth uses the real return
 * (nominal net of inflation), so a FIRE number never needs inflating by hand. Monthly
 * compounding throughout.
 */

/** Real annual rate (fraction) from nominal and inflation percentages. */
export const realRate = (nominalPct, inflationPct) => (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;

const monthly = (annual) => Math.pow(1 + annual, 1 / 12) - 1;

/** The corpus that funds `annualSpend` forever at a `swrPct` withdrawal rate. */
export const fireNumber = (annualSpend, swrPct) => (swrPct > 0 ? annualSpend / (swrPct / 100) : Infinity);

/** Years until `start` plus `contribution`/month reaches `target`; null if not within `maxYears`. */
export function yearsToTarget(start, contribution, annualReal, target, maxYears = 70) {
  if (start >= target) return 0;
  const r = monthly(annualReal);
  let v = start;
  for (let m = 1; m <= maxYears * 12; m++) {
    v = v * (1 + r) + contribution;
    if (v >= target) return m / 12;
  }
  return null;
}

/** What is needed TODAY to coast to `target` by `years` with no further contributions. */
export const coastNumber = (target, annualReal, years) => target / Math.pow(1 + annualReal, Math.max(0, years));

/** Monthly contribution that takes `start` to `target` in `years`; 0 if already on course. */
export function requiredMonthly(target, start, annualReal, years) {
  const n = Math.round(Math.max(0, years) * 12);
  if (!n) return Math.max(0, target - start);
  const r = monthly(annualReal);
  const gap = target - start * Math.pow(1 + r, n);
  if (gap <= 0) return 0;
  return r ? (gap * r) / (Math.pow(1 + r, n) - 1) : gap / n;
}

/** Corpus needed at retirement to fund `annualSpend` for `years` at `annualReal` (annuity PV). */
export function corpusForYears(annualSpend, annualReal, years) {
  const n = Math.round(Math.max(0, years) * 12);
  const r = monthly(annualReal), pay = annualSpend / 12;
  return r ? pay * (1 - Math.pow(1 + r, -n)) / r : pay * n;
}

/**
 * Year-by-year path of the corpus: contributions until `retireAge`, then withdrawals of
 * `annualSpend` until `endAge` or until it runs out. Returns { points, depletedAt }.
 */
export function project({ start, contribution, accReal, drawReal, annualSpend, ageNow, retireAge, endAge }) {
  const rA = monthly(accReal), rD = monthly(drawReal);
  const points = [{ age: ageNow, value: Math.max(0, start) }];
  let v = start, depletedAt = null;
  for (let age = ageNow; age < endAge; age++) {
    for (let m = 0; m < 12; m++) {
      if (age < retireAge) v = v * (1 + rA) + contribution;
      else v = v * (1 + rD) - annualSpend / 12;
      if (v <= 0 && depletedAt == null && age >= retireAge) { depletedAt = age + (m + 1) / 12; v = 0; }
    }
    points.push({ age: age + 1, value: Math.max(0, v), retired: age + 1 > retireAge });
    if (depletedAt != null) break;
  }
  return { points, depletedAt };
}
