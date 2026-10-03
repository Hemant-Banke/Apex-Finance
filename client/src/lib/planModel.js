import {
  realRate, fireNumber, yearsToTarget, coastNumber, requiredMonthly, corpusForYears, project,
} from './fire';
import { compactIfLarge } from './utils';

// Lean, regular, fat: the house gold for the plan you chose, quiet ink for the others.
export const VARIANT_TONE = { lean: 'var(--color-text-secondary)', current: 'var(--color-accent)', fat: 'var(--color-text-secondary)' };

/** The FIRE plan, shared by the Plan page and the Dashboard so both read the same numbers. */
export const PLAN_STORE_KEY = 'apex_plan';
export const PLAN_DEFAULTS = {
  age: 30, retireAge: 50, endAge: 85,
  basis: 'current', customSpend: 50000,
  swr: 3.5, ret: 12, drawRet: 8, inflation: 6,
  monthly: null,
  include: { cash: true, liquid: true, illiquid: true, debts: true },
};

export function loadPlanSettings() {
  try { return { ...PLAN_DEFAULTS, ...JSON.parse(localStorage.getItem(PLAN_STORE_KEY) || '{}') }; }
  catch { return PLAN_DEFAULTS; }
}

const money = (v) => compactIfLarge(Math.round(v || 0));

/** Everything the plan derives from `{ summary, portfolio, spending }` under settings `s`. */
export function planModel(data, s) {
  if (!data?.spending) return null;
  const { summary, portfolio, spending } = data;
  const profile = portfolio?.profile;
  const holdingsValue = portfolio?.totals?.value || 0;
  const sources = {
    cash: Math.max(0, summary?.totalCash || 0),
    liquid: profile ? profile.liquid : holdingsValue,
    illiquid: profile ? profile.locked : 0,
    debts: Math.max(0, summary?.totalLiabilities || 0),
  };
  const corpus = (s.include.cash ? sources.cash : 0) + (s.include.liquid ? sources.liquid : 0)
    + (s.include.illiquid ? sources.illiquid : 0) - (s.include.debts ? sources.debts : 0);

  const spendOptions = {
    lean: spending.essential + spending.other,
    current: spending.expense,
    fat: spending.expense * 1.5,
  };
  const spend = s.basis === 'custom' ? (s.customSpend || 0) : spendOptions[s.basis];
  const annualSpend = spend * 12;
  const historicMonthly = Math.max(0, spending.income - spending.expense);
  const contribution = s.monthly ?? historicMonthly;

  const accReal = realRate(s.ret, s.inflation);
  const drawReal = realRate(s.drawRet, s.inflation);
  const target = fireNumber(annualSpend, s.swr);
  const yearsFI = yearsToTarget(corpus, contribution, accReal, target);
  const fiAge = yearsFI == null ? null : s.age + yearsFI;
  const toRetire = Math.max(0, s.retireAge - s.age);

  const coast = coastNumber(target, accReal, toRetire);
  const atRetire = corpus * Math.pow(1 + accReal, toRetire)
    + (contribution * 12) * (accReal ? (Math.pow(1 + accReal, toRetire) - 1) / accReal : toRetire);
  const needed = corpusForYears(annualSpend, drawReal, Math.max(0, s.endAge - s.retireAge));
  const sipToClose = requiredMonthly(needed, corpus, accReal, toRetire);
  const path = project({
    start: corpus, contribution, accReal, drawReal, annualSpend,
    ageNow: s.age, retireAge: s.retireAge, endAge: s.endAge,
  });

  // Tiers around the CHOSEN spend, so they move with it: lean trims to your essentials' share, fat is 1.5×.
  const leanShare = spending.expense > 0 ? Math.min(1, spendOptions.lean / spending.expense) : 0.7;
  const tierSpend = { lean: spend * leanShare, current: spend, fat: spend * 1.5 };
  const variants = ['lean', 'current', 'fat'].map(k => {
    const t = fireNumber(tierSpend[k] * 12, s.swr);
    const y = yearsToTarget(corpus, contribution, accReal, t);
    return { k, label: { lean: 'Lean FIRE', current: 'FIRE', fat: 'Fat FIRE' }[k], spend: tierSpend[k], target: t, years: y, pct: t ? (corpus / t) * 100 : 0 };
  });

  // Levers: what moves the date most.
  const lever = (y) => (yearsFI != null && y != null ? yearsFI - y : null);
  const levers = [
    { label: `Invest ${money(10000)} more a month`, saved: lever(yearsToTarget(corpus, contribution + 10000, accReal, target)) },
    { label: 'Spend 10% less', saved: lever(yearsToTarget(corpus, contribution + spend * 0.1, accReal, fireNumber(annualSpend * 0.9, s.swr))) },
    { label: 'Earn 1% more a year', saved: lever(yearsToTarget(corpus, contribution, realRate(s.ret + 1, s.inflation), target)) },
    { label: 'Withdraw 0.5% more', saved: lever(yearsToTarget(corpus, contribution, accReal, fireNumber(annualSpend, s.swr + 0.5))) },
  ];

  return {
    sources, corpus, spend, spendOptions, annualSpend, historicMonthly, contribution, accReal, target,
    yearsFI, fiAge, toRetire, coast, atRetire, needed, sipToClose, path, variants, levers,
    progress: target ? (corpus / target) * 100 : 0, spending,
  };
}

/**
 * Milestones on the path, by WHOLE age — the chart plots one point a year, so its hover snaps
 * to whole ages and a line at 43.8 would sit between steps. Shared by the chart and the strip.
 */
export function journeyMarks(m, s) {
  return rawMarks(m, s).map(mk => ({ ...mk, age: Math.round(mk.age) }));
}

function rawMarks(m, s) {
  const from = s.age, to = s.endAge;
  const retire = Math.min(to, Math.max(from, s.retireAge));
  return [
    { age: from, label: 'Today', tone: 'var(--color-text-secondary)' },
    ...m.variants.filter(v => v.years != null && v.years > 0 && from + v.years < to)
      .map(v => ({ age: from + v.years, label: v.label, tone: VARIANT_TONE[v.k] })),
    { age: retire, label: `Retire ${s.retireAge}`, tone: 'var(--color-text-primary)', major: true },
    m.path.depletedAt != null
      ? { age: m.path.depletedAt, label: `Runs out ${m.path.depletedAt.toFixed(0)}`, tone: 'var(--color-danger)' }
      : { age: to, label: `Still funded at ${to}`, tone: 'var(--color-success)' },
  ].sort((a, b) => a.age - b.age);
}
