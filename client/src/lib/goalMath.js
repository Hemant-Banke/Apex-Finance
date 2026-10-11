/**
 * Goal maths with no imports, so the plan's Web Worker can load it without React or icons.
 * NOMINAL rupees: a goal's cost is entered in today's money and inflated to its own date.
 */

export const PRIORITIES = {
  essential:    { label: 'Essential',    rank: 0, hint: 'Must happen' },
  important:    { label: 'Important',    rank: 1, hint: 'Should happen' },
  aspirational: { label: 'Aspirational', rank: 2, hint: 'Would be nice' },
};
export const PRIORITY_ORDER = ['essential', 'important', 'aspirational'];

// Long-run nominal assumptions per asset class (annual return, volatility).
export const ASSETS = {
  equity: { label: 'Equity', ret: 0.12, vol: 0.17 },
  debt:   { label: 'Debt',   ret: 0.07, vol: 0.03 },
  gold:   { label: 'Gold',   ret: 0.09, vol: 0.14 },
};
export const ASSET_KEYS = ['equity', 'debt', 'gold'];

export const STRATEGIES = {
  auto:         { label: 'Auto',         hint: 'Glides with the horizon' },
  conservative: { label: 'Conservative', mix: { equity: 0.2, debt: 0.75, gold: 0.05 } },
  balanced:     { label: 'Balanced',     mix: { equity: 0.45, debt: 0.45, gold: 0.1 } },
  growth:       { label: 'Growth',       mix: { equity: 0.65, debt: 0.25, gold: 0.1 } },
  aggressive:   { label: 'Aggressive',   mix: { equity: 0.85, debt: 0.1, gold: 0.05 } },
};
export const STRATEGY_ORDER = ['conservative', 'balanced', 'growth', 'aggressive'];

// Where the money sits once a goal starts paying out.
export const PAYOUT_MIX = { equity: 0.2, debt: 0.75, gold: 0.05 };
const DERISK_YEARS = 3;

/** Equity share by years left: none in the final year, ~9 points more per year, capped at 85%. */
function autoMix(yearsLeft) {
  const equity = Math.min(0.85, Math.max(0, (yearsLeft - 1) * 0.09));
  const gold = yearsLeft > DERISK_YEARS ? 0.1 : 0.05;
  return { equity, debt: 1 - equity - gold, gold };
}

/** The mix held `yearsLeft` before the goal. A fixed strategy is held until the last 3 years, then de-risks. */
export function mixAt(strategy, yearsLeft) {
  const auto = autoMix(yearsLeft);
  const fixed = STRATEGIES[strategy]?.mix;
  if (!fixed) return auto;
  if (yearsLeft > DERISK_YEARS || fixed.equity <= auto.equity) return fixed;
  return auto;
}

/** Annual return of a mix; `rets` overrides the class returns (fractions). */
export const mixReturn = (mix, rets) => ASSET_KEYS.reduce((s, k) => s + mix[k] * (rets?.[k] ?? ASSETS[k].ret), 0);

/** Whole months from `from` to `to` (ISO dates), never negative. */
export function monthsBetween(from, to) {
  const [y1, m1, d1] = String(from).slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(to).slice(0, 10).split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** Withdrawals in nominal rupees, one per payout year, starting on the goal date. */
export function withdrawals(goal, months) {
  const infl = (goal.inflation ?? 6) / 100;
  const years = goal.withdrawal?.mode === 'spread' ? Math.max(1, goal.withdrawal.years || 1) : 1;
  const each = goal.amount / years;
  return Array.from({ length: years }, (_, k) => each * Math.pow(1 + infl, months / 12 + k));
}

/** Corpus needed on the goal date: the withdrawals discounted at the payout mix's return. */
export function requiredCorpus(goal, months, rets) {
  const r = mixReturn(PAYOUT_MIX, rets);
  return withdrawals(goal, months).reduce((s, w, k) => s + w / Math.pow(1 + r, k), 0);
}

/** `iso` moved forward by `n` calendar months, clamped to the month's last day. */
export function addMonths(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** "8 mo", "3 yrs", "4 yrs 5 mo". */
export function horizonLabel(months) {
  const y = Math.floor(months / 12), m = months % 12;
  if (!y) return `${m} mo`;
  return `${y} yr${y === 1 ? '' : 's'}${m ? ` ${m} mo` : ''}`;
}
