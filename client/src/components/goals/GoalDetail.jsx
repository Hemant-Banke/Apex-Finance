import { useMemo } from 'react';
import Card from '../ui/Card';
import ShowMore from '../ui/ShowMore';
import Spinner from '../ui/Spinner';
import PlanAccount from './PlanAccount';
import { LeverEffects } from './PlanLevers';
import { GoalFanChart, GlidePathChart } from './GoalCharts';
import { compactIfLarge, formatCurrency, formatPoints, MONTHS_SHORT } from '../../lib/utils';
import {
  GOAL_TYPES, PRIORITIES, ASSETS, ASSET_KEYS, ASSET_COLORS, STRATEGIES, mixAt, mixReturn, addMonths, horizonLabel, oddsTone,
} from '../../lib/goals';

const money = (v) => compactIfLarge(Math.round(v || 0));
const monthYear = (iso) => `${MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`;

function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: 14, borderLeft: '1px solid var(--color-border-hover)' }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.1rem', fontWeight: 500, color: tone || 'var(--color-text-primary)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
}

const Row = ({ left, right, sub }) => (
  <div className="flex items-center justify-between" style={{ gap: 12, padding: '9px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
    <div style={{ minWidth: 0 }}>{left}{sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>{sub}</p>}</div>
    <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>{right}</span>
  </div>
);

/** Routes of one goal's monthly amount: split by its mix at the phase's start, each class to its home account. */
function routesFor(goal, months, amount, from, homes) {
  const mix = mixAt(goal.strategy, (months - from) / 12);
  const rows = {};
  for (const k of ASSET_KEYS) {
    if (amount * mix[k] < 1) continue;
    const h = homes[k];
    rows[h.id] = { account: h, amount: (rows[h.id]?.amount || 0) + amount * mix[k] };
  }
  return Object.values(rows).sort((a, b) => b.amount - a.amount);
}

/** One goal inside the whole plan: its odds, what it is given now and each month, where it is drawn from, and what moves it. */
export default function GoalDetail({ gm, gp, plan, levers, tone, names, colours }) {
  const { goal } = gm;
  const today = plan.today;
  const startYear = Number(today.slice(0, 4));
  const spread = goal.withdrawal?.mode === 'spread';
  const Icon = GOAL_TYPES[goal.type]?.icon || GOAL_TYPES.other.icon;
  const glide = useMemo(() => {
    const out = [];
    for (let y = 0; y * 12 < gm.months; y++) {
      const mix = mixAt(goal.strategy, (gm.months - y * 12) / 12);
      out.push({ ...mix, tick: `${startYear + y}`, label: `${startYear + y} · ${horizonLabel(Math.max(0, gm.months - y * 12))} to go` });
    }
    return out;
  }, [goal.strategy, gm.months, startYear]);

  if (gp.due) {
    return (
      <Card gilt>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{goal.name}</p>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>The date has arrived — move it forward to plan for it again.</p>
      </Card>
    );
  }

  const monthly = gp.monthly.filter(m => m.amount >= 1);
  const outs = plan.withdrawals.filter(w => w.goal === goal._id);
  const gap = gp.p50 - gp.required;

  return (
    <Card gilt>
      <div className="flex items-start justify-between" style={{ gap: 16, marginBottom: 22 }}>
        <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
          <span className="goal-detail-icon" style={{ '--tone': tone }}><Icon size={18} strokeWidth={1.8} /></span>
          <div style={{ minWidth: 0 }}>
            <p className="text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{goal.name}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 3 }}>
              {PRIORITIES[goal.priority]?.label} · {monthYear(goal.targetDate)}, in {horizonLabel(gm.months)} · {money(goal.amount)} today
              {spread ? `, drawn over ${goal.withdrawal.years} years` : ''} · costs rise {goal.inflation}% a year
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p className="figure" style={{ fontSize: '1.6rem', fontWeight: 500, color: oddsTone(gp), lineHeight: 1 }}>{Math.round(gp.odds * 100)}%</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>odds · target {Math.round(gp.target * 100)}%</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 18, marginBottom: 24 }}>
        <Stat label="Corpus needed" value={money(gp.required)} sub={spread ? `${money(gp.futureCost)} paid out in all` : `on ${monthYear(goal.targetDate)}`} />
        <Stat label="Set aside today" value={money(gp.earmark)}
          sub={goal.useExisting === false ? 'starts from scratch' : `${Math.round(gp.fundedNow * 100)}% of the way, on its own`} />
        <Stat label="Each month" value={monthly.length ? formatCurrency(Math.round(monthly[0].amount)) : '—'}
          sub={monthly.length ? (monthly[0].from > 0 ? `from ${monthYear(addMonths(today, monthly[0].from))}` : `rising ${plan.settings.capGrowth}% a year`) : 'nothing monthly'} />
        <Stat label="Middle outcome" value={money(gp.p50)} tone={gap >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
          sub={`${gap >= 0 ? 'ahead by' : 'short by'} ${money(Math.abs(gap))}`} />
        <Stat label="Average shortfall" value={money(gp.shortfall)} sub="across every simulated market, made-it counted as zero" />
      </div>

      <p className="col-head" style={{ marginBottom: 6 }}>Range of outcomes</p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>
        Under the plan: the band holds 8 in 10 simulated markets; the gold line is the middle one.
      </p>
      {gp.bands && <GoalFanChart bands={gp.bands} required={gp.required} startYear={startYear} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 28, marginTop: 28 }}>
        <div>
          <p className="col-head" style={{ marginBottom: 8 }}>Money in</p>
          {gp.earmark >= 1 && (
            <>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>Set aside today, from</p>
              <ShowMore items={gp.earmarkFrom} initial={4} noun="accounts"
                render={r => <Row key={r.account.id} left={<PlanAccount account={r.account} />} right={money(r.amount)} />} />
            </>
          )}
          {monthly.length > 0 && (
            <>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', margin: `${gp.earmark >= 1 ? 16 : 0}px 0 4px` }}>
                Each month, rising {plan.settings.capGrowth}% a year
              </p>
              {monthly.map(m => (
                <Row key={m.from}
                  left={<div className="flex items-center" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {routesFor(goal, gm.months, m.amount, m.from, plan.homes).map(r => (
                      <PlanAccount key={r.account.id} account={r.account} sub={formatCurrency(Math.round(r.amount))} />
                    ))}
                  </div>}
                  sub={`${monthYear(addMonths(today, m.from))} – ${monthYear(addMonths(today, Math.min(m.to, gm.months)))}`}
                  right={`${formatCurrency(Math.round(m.amount))}/mo`} />
              ))}
            </>
          )}
          {gp.earmark < 1 && !monthly.length && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              Nothing yet — higher-priority goals take the money first. The levers below show what would change that.
            </p>
          )}
        </div>

        <div>
          <p className="col-head" style={{ marginBottom: 8 }}>Money out</p>
          {outs.length ? (
            <ShowMore items={outs} initial={5} noun="payouts" render={w => (
              <Row key={w.month}
                left={<div className="flex items-center" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {w.routes.map(r => <PlanAccount key={r.account.id} account={r.account} sub={money(r.amount)} />)}
                </div>}
                sub={monthYear(w.date)} right={money(w.amount)} />
            )} />
          ) : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Nothing reaches the date in the middle outcome.</p>}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            {spread
              ? 'The middle outcome, drawn each year; what is not yet drawn stays in a debt-heavy mix.'
              : 'The middle outcome, drawn whole on the date from where the final year’s mix holds it.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 28, marginTop: 28 }}>
        <div>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 10, gap: 12 }}>
            <p className="col-head">Asset mix · {goal.strategy === 'auto' ? 'Apex’s glide path' : `${STRATEGIES[goal.strategy]?.label}, your preference`}</p>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              expected {(mixReturn(gm.mixNow, Object.fromEntries(ASSET_KEYS.map(k => [k, plan.settings.returns[k] / 100]))) * 100).toFixed(1)}% a year now
            </span>
          </div>
          <div className="flex" style={{ gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
            {ASSET_KEYS.map(k => (
              <span key={k} className="text-xs flex items-center" style={{ gap: 6, color: 'var(--color-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: ASSET_COLORS[k] }} />
                {ASSETS[k].label} <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{Math.round(gm.mixNow[k] * 100)}%</span>
              </span>
            ))}
          </div>
          {glide.length > 1
            ? <GlidePathChart rows={glide} />
            : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Under a year to go — it is held in debt.</p>}
        </div>

        <div>
          <p className="col-head" style={{ marginBottom: 6 }}>What moves it</p>
          {!levers ? <Spinner height={160} /> : levers.map(l => {
            const mine = l.delta[goal._id] ?? 0;
            return (
              <div key={l.key} className="plan-lever">
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
                <span className="flex items-center" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {Math.abs(mine) >= 2 && !l.crossed.includes(goal._id) && (
                    <span className="plan-lever-chip">its odds <span className="figure" style={{ color: mine > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatPoints(mine, 0)}</span></span>
                  )}
                  <LeverEffects lever={l} plan={plan} names={names} colours={colours} exclude={goal._id} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
