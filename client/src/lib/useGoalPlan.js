import { useEffect, useMemo, useRef, useState } from 'react';
import { todayStr } from './utils';
import { withDefaults } from './goalPlan';

const KEY = 'apex_goal_plan';

/** The plan's assumptions, kept on this device like the Freedom Plan's. */
export function loadGoalPlanSettings() {
  try { return withDefaults(JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return withDefaults(); }
}
export function saveGoalPlanSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* per-device convenience only */ }
}

/** What the worker needs, and nothing else: it is copied across on every solve. */
export function goalPlanInput({ goals, accounts, portfolio, spending }) {
  return {
    goals: (goals || []).map(g => ({
      _id: g._id, name: g.name, priority: g.priority, amount: g.amount, targetDate: String(g.targetDate).slice(0, 10),
      inflation: g.inflation, withdrawal: g.withdrawal, strategy: g.strategy, useExisting: g.useExisting !== false,
    })),
    accounts: (accounts || []).map(a => ({ _id: a._id, name: a.name, type: a.type, isDebt: a.isDebt, cashBalance: a.cashBalance ?? a.balance ?? 0 })),
    holdings: (portfolio?.holdings || []).map(h => ({
      symbol: h.symbol, type: h.type, value: h.value,
      positions: (h.positions || []).map(p => ({ account: p.account, qty: p.qty })),
    })),
    members: (portfolio?.profile?.members || []).map(m => ({ symbol: m.symbol, cls: m.cls })),
    surplus: Math.max(0, (spending?.income || 0) - (spending?.expense || 0)),
    monthlySpend: spending?.expense || 0,
    today: todayStr(),
  };
}

/**
 * Solves the goal plan in a Web Worker. Returns the plan, the plan-wide levers, and the levers
 * of `focusId` once each arrives; a stale answer (inputs changed since) is dropped.
 */
export function useGoalPlan(input, settings, focusId) {
  const worker = useRef(null);
  const seq = useRef(0);
  const [state, setState] = useState({ plan: null, levers: null, goalLevers: {}, busy: false });
  const key = useMemo(() => (input ? JSON.stringify([input, settings]) : null), [input, settings]);

  useEffect(() => {
    const w = new Worker(new URL('./goalPlan.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.id !== seq.current) return;
      if (data.kind === 'plan') setState(s => ({ ...s, plan: data.plan, busy: false }));
      else if (data.kind === 'levers') setState(s => ({ ...s, levers: data.levers }));
      else if (data.kind === 'goalLevers') setState(s => ({ ...s, goalLevers: { ...s.goalLevers, [data.goalId]: data.levers } }));
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!key) return undefined;
    const id = ++seq.current;
    setState(s => ({ ...s, busy: true, levers: null, goalLevers: {} }));
    const t = setTimeout(() => worker.current?.postMessage({ id, kind: 'plan', input, settings }), 150);
    return () => clearTimeout(t);
    // `key` stands in for input and settings, which are fresh objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key || !focusId || state.goalLevers[focusId]) return;
    worker.current?.postMessage({ id: seq.current, kind: 'goalLevers', input, settings, goalId: focusId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focusId, state.goalLevers[focusId]]);

  return state;
}
