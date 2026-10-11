import { Home, GraduationCap, Car, Heart, Plane, ShieldCheck, Briefcase, Sunset, Target } from 'lucide-react';
import { todayStr, CHART_COLORS } from './utils';
import { monthsBetween, withdrawals, requiredCorpus, mixAt, addMonths } from './goalMath';

/**
 * Goals for the UI: types with their icons, colours, defaults, and one goal's own figures.
 * The maths lives in `goalMath` (shared with the plan worker); the plan across goals in `goalPlan`.
 */
export {
  PRIORITIES, PRIORITY_ORDER, ASSETS, ASSET_KEYS, STRATEGIES, STRATEGY_ORDER, PAYOUT_MIX,
  mixAt, mixReturn, withdrawals, requiredCorpus, addMonths, horizonLabel,
} from './goalMath';

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

// Gold takes the gold slot; equity and debt the next two hues, fixed so every goal agrees.
export const ASSET_COLORS = { gold: CHART_COLORS[0], equity: CHART_COLORS[1], debt: CHART_COLORS[2] };

export const monthsUntil = (dateIso, from = todayStr()) => monthsBetween(from, dateIso);

/** One goal's own figures, independent of the plan: what it costs, when, and the corpus it needs. */
export function goalModel(goal) {
  const months = monthsUntil(goal.targetDate);
  const draws = withdrawals(goal, months);
  return {
    goal, months, years: months / 12, draws,
    required: requiredCorpus(goal, months),
    futureCost: draws.reduce((s, w) => s + w, 0),
    mixNow: mixAt(goal.strategy, months / 12),
  };
}

/** Made it, close, or short: a goal's planned odds against its tier's target. */
export function oddsTone(gp) {
  if (!gp || gp.odds == null) return 'var(--color-text-muted)';
  if (gp.odds >= gp.target) return 'var(--color-success)';
  if (gp.odds >= gp.target * 0.7) return 'var(--color-chart-warm)';
  return 'var(--color-danger)';
}

/** Colour per goal id: creation order, never rank; past the palette it is neutral. */
export function goalColours(goals) {
  const order = [...goals].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return Object.fromEntries(order.map((g, i) => [g._id, CHART_COLORS[i] ?? 'var(--color-text-muted)']));
}

export const GOAL_DEFAULTS = (type = 'other') => {
  const t = GOAL_TYPES[type];
  return {
    name: '', type, priority: 'important', amount: null, targetDate: addMonths(todayStr(), 60),
    inflation: t.inflation, withdrawal: { mode: t.mode, years: t.years || 1 }, strategy: 'auto', useExisting: true, notes: '',
  };
};
