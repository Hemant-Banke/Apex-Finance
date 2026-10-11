import {
  ASSETS, ASSET_KEYS, PRIORITIES, STRATEGIES, STRATEGY_ORDER, PAYOUT_MIX,
  mixAt, mixReturn, monthsBetween, withdrawals, addMonths,
} from './goalMath';

/**
 * The plan across ALL goals: how much of the money already held each goal can claim, what to
 * invest for each every month, which accounts that money goes into, and what is drawn from where.
 *
 * A stochastic programme solved by greedy marginal allocation on a sample-average approximation.
 * Seeded markets are simulated month by month per asset class; with each goal's pot rebalanced to
 * its glide path, a goal's value on its date is LINEAR in what is put in, so every scenario's
 * outcome is a sum of precomputed growth factors and the optimiser only ever adds arrays.
 *
 * Utility, per goal and scenario: λ·[made it] + (1−λ)·[share of the corpus reached] — odds, and
 * how short when it misses. Priority tiers are strict: a tier is funded until each of its goals
 * reaches the tier's target odds (or money runs out) before the next tier sees a rupee. Inside a
 * tier the next rupee goes where it adds the most utility, so equal goals share a shortfall.
 *
 * Pure: no DOM, no React — it runs in `goalPlan.worker.js`.
 */

export const PLAN_DEFAULTS = {
  cap: null,           // ₹ a month for goals; null = the monthly surplus
  capGrowth: 5,        // % the monthly amount rises each year
  inflationShift: 0,   // points added to every goal's own inflation
  returns: { equity: 12, debt: 7, gold: 9 },
  reserveMonths: 6,    // months of spending kept back as an emergency reserve
  confidence: { essential: 90, important: 75, aspirational: 60 },
  excluded: [],        // account ids the plan may not draw on
};

const SIMS = 400;
const LEVER_SIMS = 200;
const LAMBDA = 0.6;    // weight on making it, against how close
const KAPPA = 0.08;    // width of the "made it" step, as a share of the corpus
const STEPS = 120;     // a pool is handed out in 1/STEPS chunks
const MAX_PRICE = 2;   // the most a contested pool is priced up by
const SEARCH = 4;      // bisection rounds on that price

// The optimiser's fixed constants, for the page that explains it.
export const PLAN_METHOD = { sims: SIMS, leverSims: LEVER_SIMS, lambda: LAMBDA, kappa: KAPPA, steps: STEPS, maxPrice: MAX_PRICE, search: SEARCH, seed: 17 };

// Holding types valued without a market: money that cannot be moved at will.
const LOCKED_TYPES = new Set(['fd', 'epf_nps', 'bond', 'other']);
const NEW_HOME = { equity: 'Equity mutual fund', debt: 'Debt mutual fund', gold: 'Gold ETF' };

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (R) => Math.sqrt(-2 * Math.log(R() || 1e-12)) * Math.cos(2 * Math.PI * R());

export function withDefaults(settings = {}) {
  return {
    ...PLAN_DEFAULTS, ...settings,
    returns: { ...PLAN_DEFAULTS.returns, ...settings.returns },
    confidence: { ...PLAN_DEFAULTS.confidence, ...settings.confidence },
    excluded: settings.excluded || [],
  };
}

/** A holding's value by plan class: crypto counts as equity, metals as gold, the rest as debt. */
function holdingClasses(cls, type) {
  if (cls) {
    const equity = (cls.equity || 0) + (cls.crypto || 0);
    const gold = (cls.gold || 0) + (cls.silver || 0) + (cls.commodity || 0);
    return { equity, gold, debt: Math.max(0, 1 - equity - gold) };
  }
  if (type === 'gold' || type === 'silver') return { equity: 0, debt: 0, gold: 1 };
  if (['stock', 'etf', 'mutual_fund', 'crypto'].includes(type)) return { equity: 1, debt: 0, gold: 0 };
  return { equity: 0, debt: 1, gold: 0 };
}

/**
 * The money the plan may use, per account: liquid holdings by class plus cash, less an
 * emergency reserve taken from included cash, largest balance first.
 */
export function fundingSources({ accounts, holdings, members, monthlySpend }, settings) {
  const cls = new Map((members || []).map(m => [m.symbol, m.cls]));
  const byAcc = {};
  for (const h of holdings || []) {
    if (LOCKED_TYPES.has(h.type) || !(h.value > 0)) continue;
    const pos = (h.positions || []).filter(p => p.account && p.qty > 0);
    const qty = pos.reduce((t, p) => t + p.qty, 0);
    if (!qty) continue;
    const c = holdingClasses(cls.get(h.symbol), h.type);
    for (const p of pos) {
      const a = (byAcc[p.account] ??= { equity: 0, debt: 0, gold: 0 });
      for (const k of ASSET_KEYS) a[k] += h.value * (p.qty / qty) * c[k];
    }
  }
  const excluded = new Set(settings.excluded);
  const list = (accounts || []).filter(a => !a.isDebt).map(a => {
    const inv = byAcc[a._id] || { equity: 0, debt: 0, gold: 0 };
    const cash = Math.max(0, a.cashBalance ?? 0);
    return { id: a._id, name: a.name, type: a.type, cash, ...inv, total: cash + inv.equity + inv.debt + inv.gold, included: !excluded.has(a._id), reserved: 0 };
  });
  const reserve = Math.max(0, (settings.reserveMonths || 0) * (monthlySpend || 0));
  let left = reserve;
  for (const a of list.filter(a => a.included).sort((x, y) => y.cash - x.cash)) {
    a.reserved = Math.min(a.cash, left);
    left -= a.reserved;
  }
  for (const a of list) a.available = a.included ? a.total - a.reserved : 0;
  return { accounts: list, reserve, reserveShort: left, available: list.reduce((t, a) => t + a.available, 0) };
}

/** Where each class is held: the account holding most of it, else the largest brokerage, else a new one. */
function classHomes(accounts) {
  const inc = accounts.filter(a => a.included);
  const brokerage = inc.filter(a => a.type === 'brokerage').sort((x, y) => y.total - x.total)[0];
  return Object.fromEntries(ASSET_KEYS.map(k => {
    const holder = inc.filter(a => a[k] > 1).sort((x, y) => y[k] - x[k])[0];
    const home = holder || brokerage;
    return [k, home ? { id: home.id, name: home.name, type: home.type } : { id: `new:${k}`, name: NEW_HOME[k], type: 'new', isNew: true }];
  }));
}

const quantile = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))];

/** The plan. `input` holds goals, accounts, holdings, members, surplus, monthlySpend and today. */
export function buildPlan(input, rawSettings, { sims = SIMS, detail = true, search = SEARCH } = {}) {
  const s = withDefaults(rawSettings);
  const today = input.today;
  const rets = Object.fromEntries(ASSET_KEYS.map(k => [k, (s.returns[k] ?? ASSETS[k].ret * 100) / 100]));
  const cap0 = Math.max(0, s.cap ?? input.surplus ?? 0);
  const growth = (s.capGrowth || 0) / 100;
  const payoutRet = mixReturn(PAYOUT_MIX, rets);
  const sources = fundingSources(input, s);
  const S = sims;

  const items = (input.goals || []).map(g => {
    const goal = { ...g, inflation: (g.inflation ?? 6) + (s.inflationShift || 0) };
    const T = monthsBetween(today, g.targetDate);
    const draws = withdrawals(goal, T);
    const R = draws.reduce((t, w, k) => t + w / Math.pow(1 + payoutRet, k), 0);
    return {
      id: g._id, goal, T, draws, R, futureCost: draws.reduce((t, w) => t + w, 0),
      tier: PRIORITIES[g.priority]?.rank ?? 1, useExisting: g.useExisting !== false,
      target: (s.confidence[g.priority] ?? 75) / 100,
    };
  });
  const live = items.filter(it => it.T > 0 && it.R > 0);
  const H = live.reduce((m, it) => Math.max(m, it.T), 0);

  // Seeded monthly returns per class, lognormal with the class's expected annual return.
  const R0 = rng(PLAN_METHOD.seed);
  const ret = {};
  for (const k of ASSET_KEYS) {
    const mu = Math.log(1 + rets[k]) / 12, sd = ASSETS[k].vol / Math.sqrt(12);
    const arr = new Float32Array(S * H);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.exp(mu - sd * sd / 2 + sd * gauss(R0)) - 1;
    ret[k] = arr;
  }

  // Phases run between goal dates; a goal's monthly amount may change only where one ends.
  const bounds = [0, ...[...new Set(live.map(it => it.T))].sort((a, b) => a - b)];
  const P = bounds.length - 1;
  const gamma = (t) => Math.pow(1 + growth, Math.floor(t / 12));
  const pv = Array.from({ length: P }, (_, p) => {
    let v = 0;
    for (let t = bounds[p]; t < bounds[p + 1]; t++) v += gamma(t) / Math.pow(1 + rets.debt, t / 12);
    return v;
  });

  // Growth factor from month t to the goal date, per scenario, under each goal's glide path.
  for (const it of live) {
    const T = it.T, W = T + 1;
    it.mixes = Array.from({ length: T }, (_, t) => mixAt(it.goal.strategy, (T - t) / 12));
    const G = new Float32Array(S * W);
    for (let sc = 0; sc < S; sc++) {
      const base = sc * W, rb = sc * H;
      G[base + T] = 1;
      for (let t = T - 1; t >= 0; t--) {
        const m = it.mixes[t];
        const g = 1 + m.equity * ret.equity[rb + t] + m.debt * ret.debt[rb + t] + m.gold * ret.gold[rb + t];
        G[base + t] = g * G[base + t + 1];
      }
    }
    it.G0 = new Float64Array(S);
    for (let sc = 0; sc < S; sc++) it.G0[sc] = G[sc * W];
    it.F = Array.from({ length: P }, (_, p) => {
      if (bounds[p] >= T) return null;
      const f = new Float64Array(S), end = Math.min(bounds[p + 1], T);
      for (let sc = 0; sc < S; sc++) {
        let v = 0;
        for (let t = bounds[p]; t < end; t++) v += gamma(t) * G[sc * W + t];
        f[sc] = v;
      }
      return f;
    });
    it.V = new Float64Array(S);
    it.W0 = 0;
    it.X = new Float64Array(P);
    it.odds = 0;
  }

  const oddsOf = (it) => { let n = 0; for (let sc = 0; sc < S; sc++) if (it.V[sc] >= it.R) n++; return n / S; };
  const d = new Float64Array(S);
  const slope = (it) => {
    const w = KAPPA * it.R;
    for (let sc = 0; sc < S; sc++) {
      const z = (it.V[sc] - it.R) / w, e = Math.exp(-Math.abs(z));
      d[sc] = LAMBDA * (e / ((1 + e) * (1 + e))) / w + (it.V[sc] < it.R ? (1 - LAMBDA) / it.R : 0);
    }
  };
  const mean = (a, b) => { let v = 0; for (let sc = 0; sc < S; sc++) v += a[sc] * b[sc]; return v / S; };

  // Greedy allocation, tier by tier, each step a chunk of one pool to its best use per rupee of present value.
  const chunkL = Math.max(1000, sources.available / STEPS), chunkM = Math.max(100, cap0 / STEPS);
  const usable = (it) => it.F.filter(Boolean).length + (it.useExisting ? 1 : 0);
  let lump, capLeft;
  // `binding` prices pools up by how much lower tiers lean on them, so a higher tier spends what nobody else needs first.
  const allocate = (binding, alpha = 0) => {
    lump = sources.available;
    capLeft = new Float64Array(P).fill(cap0);
    for (const it of live) { it.V.fill(0); it.W0 = 0; it.X.fill(0); it.odds = 0; }
    for (const tier of [0, 1, 2]) {
      const group = live.filter(it => it.tier === tier);
      const lower = live.filter(it => it.tier > tier);
      const lean = (has) => 1 + alpha * lower.reduce((t, j) => t + (has(j) ? 1 / usable(j) : 0), 0);
      const pressureL = binding?.lump ? lean(j => j.useExisting) : 1;
      const pressure = Array.from({ length: P }, (_, p) => (binding?.phases.has(p) ? lean(j => j.F[p]) : 1));
      for (let guard = 0; group.length && guard < 6000; guard++) {
        let best = null, score = 1e-15;
        for (const it of group) {
          if (it.odds >= it.target) continue;
          slope(it);
          if (it.useExisting && lump > 1) {
            const v = mean(d, it.G0) / pressureL;
            if (v > score) { score = v; best = { it, pool: -1 }; }
          }
          for (let p = 0; p < P; p++) {
            if (!it.F[p] || capLeft[p] <= 1) continue;
            const v = mean(d, it.F[p]) / (pv[p] * pressure[p]);
            if (v > score) { score = v; best = { it, pool: p }; }
          }
        }
        if (!best) break;
        const { it, pool } = best;
        const f = pool < 0 ? it.G0 : it.F[pool];
        let amt = pool < 0 ? Math.min(chunkL, lump) : Math.min(chunkM, capLeft[pool]);
        // A step that would carry the goal past its target is cut back to just reach it.
        const oddsWith = (x) => { let n = 0; for (let sc = 0; sc < S; sc++) if (it.V[sc] + x * f[sc] >= it.R) n++; return n / S; };
        if (oddsWith(amt) > it.target + 0.005) {
          let lo = 0, hi = amt;
          for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (oddsWith(mid) >= it.target) hi = mid; else lo = mid; }
          amt = hi;
        }
        for (let sc = 0; sc < S; sc++) it.V[sc] += amt * f[sc];
        if (pool < 0) { it.W0 += amt; lump -= amt; } else { it.X[pool] += amt; capLeft[pool] -= amt; }
        it.odds = oddsOf(it);
      }
    }
    // Tier by tier, how close each tier came to its targets; then the money left over.
    return {
      tiers: [0, 1, 2].map(t => live.filter(it => it.tier === t).reduce((a, it) => a + Math.min(1, it.odds / it.target), 0)),
      spare: lump + capLeft.reduce((a, c, p) => a + c * pv[p], 0),
    };
  };
  const better = (a, b) => {
    for (let t = 0; t < 3; t++) if (Math.abs(a.tiers[t] - b.tiers[t]) > 1e-6) return a.tiers[t] > b.tiers[t];
    return a.spare > b.spare;
  };
  const snapshot = () => ({ lump, capLeft: capLeft.slice(), goals: live.map(it => ({ V: it.V.slice(), W0: it.W0, X: it.X.slice(), odds: it.odds })) });
  const restore = (snap) => {
    lump = snap.lump; capLeft = snap.capLeft;
    live.forEach((it, i) => { const g = snap.goals[i]; it.V = g.V; it.W0 = g.W0; it.X = g.X; it.odds = g.odds; });
  };

  // Spend freely first. Only if a lower tier then falls short is the money it lost repriced, and
  // only as dearly as needed: the smallest price that still serves the tiers best leaves the most spare.
  let best = allocate(null), snap = snapshot();
  if (live.some(it => it.odds < it.target)) {
    const binding = { lump: lump < chunkL, phases: new Set([...capLeft.keys()].filter(p => capLeft[p] < chunkM)) };
    const keep = (score) => { if (better(score, best)) { best = score; snap = snapshot(); } };
    const top = allocate(binding, MAX_PRICE);
    keep(top);
    let lo = 0, hi = MAX_PRICE;
    for (let i = 0; i < search; i++) {
      const mid = (lo + hi) / 2, score = allocate(binding, mid);
      keep(score);
      const asGood = score.tiers.every((v, t) => v >= top.tiers[t] - 1e-6);
      if (asGood) hi = mid; else lo = mid;
    }
  }
  restore(snap);

  const goals = {};
  for (const it of items) {
    const base = { id: it.id, months: it.T, required: it.R, futureCost: it.futureCost, draws: it.draws, tier: it.tier, target: it.target };
    if (!it.mixes) { goals[it.id] = { ...base, due: true, odds: null, earmark: 0, monthly: [], monthlyNow: 0 }; continue; }
    const sorted = Float64Array.from(it.V).sort();
    let short = 0;
    for (let sc = 0; sc < S; sc++) short += Math.max(0, it.R - it.V[sc]);
    const g0 = quantile(Float64Array.from(it.G0).sort(), 0.5);
    goals[it.id] = {
      ...base, due: false, odds: it.odds, earmark: it.W0,
      fundedNow: Math.min(1, (it.W0 * g0) / it.R),
      monthly: Array.from(it.X).map((x, p) => ({ from: bounds[p], to: bounds[p + 1], amount: x })).filter(r => r.from < it.T),
      monthlyNow: it.X[0] || 0,
      p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9),
      shortfall: short / S,
    };
  }

  const clean = (v) => (v < 1 ? 0 : v);
  const totals = {
    earmarked: clean(sources.available - lump),
    unusedLump: clean(lump),
    monthlyNow: clean(P ? cap0 - capLeft[0] : 0),
    freeNow: clean(P ? capLeft[0] : cap0),
    cap: cap0,
    onTarget: live.filter(it => it.odds >= it.target).length,
    count: live.length,
    headroom: clean(best.spare),   // present value of every rupee the plan leaves unused
  };
  const out = { today, cap0, growth, settings: s, goals, totals, phases: [], sources };
  if (!detail) return out;

  // Year-by-year spread of each pot under the plan, for the fan chart.
  for (const it of live) {
    const marks = [];
    for (let t = 0; t <= it.T; t += 12) marks.push(t);
    if (marks[marks.length - 1] !== it.T) marks.push(it.T);
    const at = marks.map(() => new Float64Array(S));
    const phaseOf = (t) => { let p = 0; while (p < P - 1 && bounds[p + 1] <= t) p++; return p; };
    const contrib = Array.from({ length: it.T }, (_, t) => it.X[phaseOf(t)] * gamma(t));
    for (let sc = 0; sc < S; sc++) {
      let v = it.W0, k = 0;
      if (marks[0] === 0) at[k++][sc] = v;
      for (let t = 0; t < it.T; t++) {
        const m = it.mixes[t], rb = sc * H + t;
        v = (v + contrib[t]) * (1 + m.equity * ret.equity[rb] + m.debt * ret.debt[rb] + m.gold * ret.gold[rb]);
        if (marks[k] === t + 1) at[k++][sc] = v;
      }
    }
    goals[it.id].bands = marks.map((m, k) => {
      const q = at[k].sort();
      return { month: m, p10: quantile(q, 0.1), p50: quantile(q, 0.5), p90: quantile(q, 0.9) };
    });
  }

  // Routing: classes to accounts.
  const homes = classHomes(sources.accounts);
  out.homes = homes;
  const byClass = (amounts) => {
    const rows = {};
    for (const k of ASSET_KEYS) {
      if (amounts[k] < 1) continue;
      const h = homes[k];
      const r = (rows[h.id] ??= { account: h, amount: 0, classes: {} });
      r.amount += amounts[k];
      r.classes[k] = (r.classes[k] || 0) + amounts[k];
    }
    return Object.values(rows).sort((a, b) => b.amount - a.amount);
  };

  // Each month: per phase, every goal's amount split by its mix at the phase's start.
  out.phases = Array.from({ length: P }, (_, p) => {
    const amounts = { equity: 0, debt: 0, gold: 0 }, byGoal = {};
    for (const it of live) {
      if (!it.X[p]) continue;
      byGoal[it.id] = it.X[p];
      const m = mixAt(it.goal.strategy, (it.T - bounds[p]) / 12);
      for (const k of ASSET_KEYS) amounts[k] += it.X[p] * m[k];
    }
    return {
      from: bounds[p], to: bounds[p + 1], start: addMonths(today, bounds[p]), end: addMonths(today, bounds[p + 1]),
      total: cap0 - capLeft[p], free: capLeft[p], byGoal, routes: byClass(amounts),
    };
  }).filter(ph => ph.total > 1 || ph.free > 1);

  // Now: each goal's earmark is drawn from money already in the class its mix wants, then from cash,
  // and only then from other holdings — the fewest accounts touched and the fewest moves.
  const pools = sources.accounts.filter(a => a.available > 1).map(a => ({
    account: { id: a.id, name: a.name, type: a.type },
    cash: Math.max(0, a.cash - a.reserved), equity: a.equity, debt: a.debt, gold: a.gold,
  }));
  const moves = {};
  const takeFrom = (cls, need, onTake) => {
    for (const pl of [...pools].sort((x, y) => y[cls] - x[cls])) {
      if (need <= 1) break;
      const amt = Math.min(need, pl[cls]);
      if (amt <= 1) continue;
      pl[cls] -= amt; need -= amt; onTake(pl, amt);
    }
    return need;
  };
  for (const it of [...live].sort((a, b) => a.T - b.T)) {
    const from = {};
    const add = (pl, amt) => { from[pl.account.id] = { account: pl.account, amount: (from[pl.account.id]?.amount || 0) + amt }; };
    const mix = mixAt(it.goal.strategy, it.T / 12);
    for (const k of ASSET_KEYS) {
      let need = it.W0 * mix[k];
      need = takeFrom(k, need, add);
      for (const src of ['cash', ...ASSET_KEYS.filter(c => c !== k)]) {
        need = takeFrom(src, need, (pl, amt) => {
          add(pl, amt);
          const to = homes[k], key = `${pl.account.id}>${to.id}>${src}>${k}`;
          (moves[key] ??= { from: pl.account, fromClass: src, to, cls: k, amount: 0 }).amount += amt;
        });
      }
    }
    goals[it.id].earmarkFrom = Object.values(from).filter(r => r.amount >= 1).sort((a, b) => b.amount - a.amount);
  }
  const minMove = Math.max(1000, totals.earmarked * 0.005);
  out.moves = Object.values(moves).filter(m => m.amount >= minMove).sort((a, b) => b.amount - a.amount);

  // Out: each payout drawn from where its money sits — the final mix, then the payout mix.
  out.withdrawals = [];
  for (const it of live) {
    const scale = Math.min(1, goals[it.id].p50 / it.R);
    it.draws.forEach((w, k) => {
      const m = k === 0 ? mixAt(it.goal.strategy, 0) : PAYOUT_MIX;
      const amt = w * scale;
      if (amt < 1) return;
      out.withdrawals.push({
        goal: it.id, month: it.T + 12 * k, date: addMonths(today, it.T + 12 * k), amount: amt, planned: w,
        routes: byClass(Object.fromEntries(ASSET_KEYS.map(c => [c, amt * m[c]]))),
      });
    });
  }
  out.withdrawals.sort((a, b) => a.month - b.month);
  return out;
}

const shiftYear = (iso, n) => `${Number(String(iso).slice(0, 4)) + n}${String(iso).slice(4, 10)}`;

/** Plan-wide levers: each re-solves the whole plan with one assumption moved. */
export function planLevers(input, settings) {
  const s = withDefaults(settings);
  const cap = s.cap ?? input.surplus ?? 0;
  const list = [
    { key: 'save-more', label: 'Put 25% more a month towards goals', set: { cap: cap * 1.25 } },
    { key: 'save-less', label: 'Put 25% less a month towards goals', set: { cap: cap * 0.75 } },
    { key: 'grow', label: 'Raise the monthly amount 5 points faster', set: { capGrowth: s.capGrowth + 5 } },
    { key: 'returns', label: 'Markets return 2 points less', set: { returns: Object.fromEntries(ASSET_KEYS.map(k => [k, s.returns[k] - 2])) } },
    { key: 'inflation', label: 'Costs rise 1 point faster', set: { inflationShift: s.inflationShift + 1 } },
    { key: 'reserve', label: 'Keep 3 more months as a reserve', set: { reserveMonths: s.reserveMonths + 3 } },
  ];
  return runLevers(input, s, list.map(l => ({ ...l, run: () => buildPlan(input, { ...s, ...l.set }, { sims: LEVER_SIMS, detail: false, search: 2 }) })));
}

/** One goal's levers: its date, its size, its mix, and whether it may use money already held. */
export function goalLevers(input, settings, goalId) {
  const s = withDefaults(settings);
  const goal = input.goals.find(g => g._id === goalId);
  if (!goal) return [];
  const swap = (patch) => () => buildPlan({ ...input, goals: input.goals.map(g => (g._id === goalId ? { ...g, ...patch } : g)) }, s, { sims: LEVER_SIMS, detail: false, search: 2 });
  const idx = STRATEGY_ORDER.indexOf(goal.strategy);
  const bolder = idx >= 0 && idx < STRATEGY_ORDER.length - 1 ? STRATEGY_ORDER[idx + 1] : null;
  const list = [
    { key: 'later', label: 'Push it back a year', run: swap({ targetDate: shiftYear(goal.targetDate, 1) }) },
    { key: 'trim', label: 'Trim it by 10%', run: swap({ amount: goal.amount * 0.9 }) },
    goal.useExisting !== false
      ? { key: 'scratch', label: 'Start it from scratch', run: swap({ useExisting: false }) }
      : { key: 'existing', label: 'Let it use money already held', run: swap({ useExisting: true }) },
  ];
  if (bolder) list.push({ key: 'bolder', label: `Switch it to the ${STRATEGIES[bolder].label.toLowerCase()} mix`, run: swap({ strategy: bolder }) });
  return runLevers(input, s, list);
}

function runLevers(input, s, list) {
  const base = buildPlan(input, s, { sims: LEVER_SIMS, detail: false, search: 2 });
  return list.map(l => {
    const r = l.run();
    const odds = {}, delta = {};
    for (const [id, g] of Object.entries(r.goals)) {
      if (g.odds == null) continue;
      odds[id] = g.odds;
      delta[id] = (g.odds - (base.goals[id]?.odds ?? 0)) * 100;
    }
    return {
      key: l.key, label: l.label, odds, delta, onTarget: r.totals.onTarget, baseOnTarget: base.totals.onTarget, count: r.totals.count,
      headroom: r.totals.headroom - base.totals.headroom, baseHeadroom: base.totals.headroom,
      crossed: Object.keys(odds).filter(id => (odds[id] >= r.goals[id].target) !== ((base.goals[id]?.odds ?? 0) >= r.goals[id].target)),
    };
  });
}

