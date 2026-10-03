import { Home, GraduationCap, Car, Heart, Plane, ShieldCheck, Briefcase, Sunset, Target } from 'lucide-react';
import { todayStr, CHART_COLORS } from './utils';

/**
 * Goal maths — pure, client-side, like `fire.js`. Goals are DATED, so everything here is in
 * NOMINAL rupees: a goal's cost is entered in today's money and inflated to its own date.
 * Monthly compounding; the asset mix glides toward safety as the date nears.
 */

export const GOAL_TYPES = {
  home:       { label: 'Home',       icon: Home,          inflation: 7,  mode: 'lump' },
  education:  { label: 'Education',  icon: GraduationCap, inflation: 10, mode: 'spread', years: 4 },
  car:        { label: 'Car',        icon: Car,           inflation: 5,  mode: 'lump' },
  wedding:    { label: 'Wedding',    icon: Heart,         inflation: 8,  mode: 'lump' },
  travel:     { label: 'Travel',     icon: Plane,         inflation: 7,  mode: 'lump' },
  emergency:  { label: 'Emergency',  icon: ShieldCheck,   inflation: 6,  mode: 'lump' },
  business:   { label: 'Business',   icon: Briefcase,     inflation: 6,  mode: 'lump' },
  retirement: { label: 'Retirement', icon: Sunset,        inflation: 6,  mode: 'spread', years: 25 },
  other:      { label: 'Other',      icon: Target,        inflation: 6,  mode: 'lump' },
};

export const PRIORITIES = {
  essential:    { label: 'Essential',    rank: 0, hint: 'Must happen' },
  important:    { label: 'Important',    rank: 1, hint: 'Should happen' },
  aspirational: { label: 'Aspirational', rank: 2, hint: 'Would be nice' },
};

// Long-run nominal assumptions per asset class (annual return, volatility).
export const ASSETS = {
  equity: { label: 'Equity', ret: 0.12, vol: 0.17 },
  debt:   { label: 'Debt',   ret: 0.07, vol: 0.03 },
  gold:   { label: 'Gold',   ret: 0.09, vol: 0.14 },
};
export const ASSET_KEYS = ['equity', 'debt', 'gold'];
// Gold takes the gold slot; equity and debt the next two hues, fixed so every goal agrees.
export const ASSET_COLORS = { gold: CHART_COLORS[0], equity: CHART_COLORS[1], debt: CHART_COLORS[2] };

export const STRATEGIES = {
  auto:         { label: 'Auto',         hint: 'Glides with the horizon' },
  conservative: { label: 'Conservative', mix: { equity: 0.2, debt: 0.75, gold: 0.05 } },
  balanced:     { label: 'Balanced',     mix: { equity: 0.45, debt: 0.45, gold: 0.1 } },
  growth:       { label: 'Growth',       mix: { equity: 0.65, debt: 0.25, gold: 0.1 } },
  aggressive:   { label: 'Aggressive',   mix: { equity: 0.85, debt: 0.1, gold: 0.05 } },
};
const STRATEGY_ORDER = ['conservative', 'balanced', 'growth', 'aggressive'];

// Where the money sits once the goal starts paying out.
const PAYOUT_MIX = { equity: 0.2, debt: 0.75, gold: 0.05 };
const DERISK_YEARS = 3;
const SIMS = 500;

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

export const mixReturn = (mix) => ASSET_KEYS.reduce((s, k) => s + mix[k] * ASSETS[k].ret, 0);
// Classes treated as uncorrelated — an approximation, and a slightly generous one for equity+gold.
export const mixVol = (mix) => Math.sqrt(ASSET_KEYS.reduce((s, k) => s + (mix[k] * ASSETS[k].vol) ** 2, 0));

const toMonthly = (annual) => Math.pow(1 + annual, 1 / 12) - 1;

export function monthsUntil(dateIso, from = todayStr()) {
  const [y1, m1, d1] = from.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(dateIso).slice(0, 10).split('-').map(Number);
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
export function requiredCorpus(goal, months) {
  const r = mixReturn(PAYOUT_MIX);
  return withdrawals(goal, months).reduce((s, w, k) => s + w / Math.pow(1 + r, k), 0);
}

const contributionAt = (monthly, stepUp, m) => monthly * Math.pow(1 + stepUp / 100, Math.floor(m / 12));

/** Expected (no-volatility) value on the goal date of `start` plus contributions. */
function expectedValue(goal, months, start, monthly, stepUp) {
  let v = start;
  for (let m = 0; m < months; m++) {
    const r = toMonthly(mixReturn(mixAt(goal.strategy, (months - m) / 12)));
    v = v * (1 + r) + contributionAt(monthly, stepUp, m);
  }
  return v;
}

/** The first-year monthly contribution (rising by the goal's step-up) that meets `target` on the expected path. */
export function requiredMonthly(goal, months, target, stepUp = goal.stepUp || 0) {
  const base = expectedValue(goal, months, goal.saved || 0, 0, 0);
  if (base >= target) return 0;
  if (!months) return Infinity;
  return (target - base) / expectedValue(goal, months, 0, 1, stepUp);
}

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (R) => Math.sqrt(-2 * Math.log(R() || 1e-12)) * Math.cos(2 * Math.PI * R());

/**
 * Monte Carlo of the build-up. Seeded, so the same goal always reads the same. Returns the
 * value of every path on the goal date and, per year, the 10th/50th/90th percentiles.
 */
export function simulate(goal, months, { monthly = goal.monthly || 0, stepUp = goal.stepUp || 0, strategy = goal.strategy, sims = SIMS } = {}) {
  const R = rng(17);
  const steps = Array.from({ length: months }, (_, m) => {
    const mix = mixAt(strategy, (months - m) / 12);
    return { mu: toMonthly(mixReturn(mix)), sd: mixVol(mix) / Math.sqrt(12), c: contributionAt(monthly, stepUp, m) };
  });
  const checkpoints = [];
  for (let m = 0; m <= months; m += 12) checkpoints.push(m);
  if (checkpoints[checkpoints.length - 1] !== months) checkpoints.push(months);
  const byPoint = checkpoints.map(() => new Float64Array(sims));
  const finals = new Float64Array(sims);
  for (let i = 0; i < sims; i++) {
    let v = goal.saved || 0, p = 0;
    if (checkpoints[0] === 0) byPoint[p++][i] = v;
    for (let m = 0; m < months; m++) {
      const st = steps[m];
      v = Math.max(0, v * (1 + st.mu + st.sd * gauss(R)) + st.c);
      if (checkpoints[p] === m + 1) byPoint[p++][i] = v;
    }
    finals[i] = v;
  }
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
  const bands = checkpoints.map((m, k) => {
    const s = byPoint[k].sort();
    return { month: m, p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) };
  });
  return { finals, bands };
}

export const successRate = (finals, target) => {
  if (!finals.length) return 0;
  let n = 0;
  for (const v of finals) if (v >= target) n++;
  return (n / finals.length) * 100;
};

export function goalStatus(prob) {
  if (prob >= 80) return { key: 'on', label: 'On track', tone: 'var(--color-success)' };
  if (prob >= 50) return { key: 'risk', label: 'At risk', tone: 'var(--color-chart-warm)' };
  return { key: 'off', label: 'Off track', tone: 'var(--color-danger)' };
}

// Until the optimiser lands, Apex suggests the monthly amount that meets the goal 8 times in 10.
export const PLAN_CONFIDENCE = 80;

/** The monthly contribution that reaches `confidence`% of paths — bisection on the seeded simulation. */
function confidenceMonthly(goal, months, required, confidence) {
  if (!months) return null;
  const odds = (monthly) => successRate(simulate(goal, months, { monthly, sims: 300 }).finals, required);
  if (odds(0) >= confidence) return 0;
  const need = requiredMonthly(goal, months, required);
  let lo = 0, hi = Math.max(1000, need * 3);
  while (odds(hi) < confidence && hi < 1e9) hi *= 2;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (odds(mid) >= confidence) hi = mid; else lo = mid;
  }
  return hi;
}

/** Everything the overview needs about one goal. The contribution plan is Apex's, not the user's. */
export function goalModel(input) {
  const months = monthsUntil(input.targetDate);
  const base = { ...input, saved: 0, stepUp: 0, monthly: 0 };
  const draws = withdrawals(base, months);
  const required = requiredCorpus(base, months);
  const need = requiredMonthly(base, months, required);
  const monthly = confidenceMonthly(base, months, required, PLAN_CONFIDENCE) ?? 0;
  const goal = { ...base, monthly };
  const { finals, bands } = simulate(goal, months);
  const prob = months ? successRate(finals, required) : 0;
  return {
    goal, months, years: months / 12, draws, required, bands, prob, need, monthly,
    expected: expectedValue(goal, months, 0, monthly, 0),
    status: goalStatus(prob),
    futureCost: draws.reduce((s, w) => s + w, 0),
    mixNow: mixAt(goal.strategy, months / 12),
  };
}

export const monthlyForConfidence = (gm, confidence = PLAN_CONFIDENCE) =>
  confidenceMonthly(gm.goal, gm.months, gm.required, confidence);

/** What each change does to the odds. */
export function goalLevers(gm) {
  const { goal, months, required, prob } = gm;
  const odds = (opts, target = required, m = months) => successRate(simulate(goal, m, { ...opts, sims: 300 }).finals, target);
  const later = { ...goal, targetDate: shiftYear(goal.targetDate, 1) };
  const idx = STRATEGY_ORDER.indexOf(goal.strategy);
  const bolder = idx >= 0 && idx < STRATEGY_ORDER.length - 1 ? STRATEGY_ORDER[idx + 1] : null;
  const list = [
    { label: 'Invest 25% more a month', p: odds({ monthly: (goal.monthly || 0) * 1.25 || 1000 }) },
    { label: 'Raise it 10% every year', p: odds({ stepUp: (goal.stepUp || 0) + 10 }) },
    { label: 'Push the date back a year', p: odds({}, requiredCorpus(later, months + 12), months + 12) },
    { label: 'Trim the goal by 10%', p: odds({}, required * 0.9) },
  ];
  if (bolder) list.push({ label: `Switch to the ${STRATEGIES[bolder].label.toLowerCase()} mix`, p: odds({ strategy: bolder }) });
  return list.map(l => ({ ...l, delta: l.p - prob }));
}

function shiftYear(dateIso, n) {
  const s = String(dateIso).slice(0, 10);
  return `${Number(s.slice(0, 4)) + n}${s.slice(4)}`;
}

/** Year-by-year contribution plan on the expected path. */
export function contributionPlan(gm) {
  const { goal, months } = gm;
  const rows = [];
  let v = goal.saved || 0, paid = 0;
  for (let m = 0; m < months; m++) {
    const r = toMonthly(mixReturn(mixAt(goal.strategy, (months - m) / 12)));
    const c = contributionAt(goal.monthly || 0, goal.stepUp || 0, m);
    v = v * (1 + r) + c; paid += c;
    if ((m + 1) % 12 === 0 || m === months - 1) {
      rows.push({ year: Math.ceil((m + 1) / 12), monthly: c, paid, value: v, mix: mixAt(goal.strategy, (months - m - 1) / 12) });
    }
  }
  return rows;
}

/** Year-by-year payout on the expected path, the rest kept in the payout mix. */
export function withdrawalPlan(gm) {
  const r = mixReturn(PAYOUT_MIX);
  let v = gm.expected;
  return gm.draws.map((w, k) => {
    const start = v;
    v = Math.max(0, (v - w) * (1 + r));
    return { year: k + 1, draw: w, start, end: v, short: start < w };
  });
}

/**
 * Priority first, then date: who the monthly surplus pays for, and where it runs out.
 * `need` is each goal's suggested monthly contribution.
 */
export function fundingWaterfall(models, surplus) {
  const order = [...models].sort((a, b) =>
    PRIORITIES[a.goal.priority].rank - PRIORITIES[b.goal.priority].rank || a.months - b.months);
  let left = Math.max(0, surplus);
  return order.map(gm => {
    const need = gm.monthly || 0;
    const covered = Math.min(need, left);
    left -= covered;
    return { gm, need, covered, short: need - covered, leftAfter: left };
  });
}

export const GOAL_DEFAULTS = (type = 'other') => {
  const t = GOAL_TYPES[type];
  return {
    name: '', type, priority: 'important', amount: null, targetDate: addMonths(todayStr(), 60),
    inflation: t.inflation, withdrawal: { mode: t.mode, years: t.years || 1 }, strategy: 'auto', notes: '',
  };
};

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
