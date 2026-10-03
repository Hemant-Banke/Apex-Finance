import { useMemo } from 'react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ShowMore from '../ui/ShowMore';
import { compactIfLarge, formatCurrency, formatPoints, todayStr } from '../../lib/utils';
import {
  ASSETS, ASSET_KEYS, STRATEGIES, contributionPlan, withdrawalPlan, goalLevers, mixReturn, ASSET_COLORS,
} from '../../lib/goals';
import { GoalFanChart, GlidePathChart } from './GoalCharts';

const money = (v) => compactIfLarge(Math.round(v || 0));

function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: 14, borderLeft: '1px solid var(--color-border-hover)' }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.1rem', fontWeight: 500, color: tone || 'var(--color-text-primary)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
}

const TH = ({ children, right }) => <th className="col-head" style={{ textAlign: right ? 'right' : 'left', padding: '0 0 8px', fontWeight: 500 }}>{children}</th>;
const TD = ({ children, right, tone, mono = true }) => (
  <td className={mono ? 'figure text-xs' : 'text-xs'} style={{ textAlign: right ? 'right' : 'left', padding: '8px 0', borderTop: '1px solid var(--color-border-subtle)', color: tone || 'var(--color-text-secondary)' }}>{children}</td>
);

/** One goal in full: the range of outcomes, the plan in and out, the mix, and what moves the odds. */
export default function GoalDetail({ gm }) {
  const { goal } = gm;
  const startYear = Number(todayStr().slice(0, 4));
  const goalYear = Number(String(goal.targetDate).slice(0, 4));
  const contrib = useMemo(() => contributionPlan(gm), [gm]);
  const payout = useMemo(() => withdrawalPlan(gm), [gm]);
  const levers = useMemo(() => goalLevers(gm), [gm]);
  const glide = contrib.map(r => ({ ...r.mix, tick: `${startYear + r.year}`, label: `${startYear + r.year} · ${Math.max(0, Math.ceil(gm.years - r.year))} yrs to go` }));
  const spread = goal.withdrawal?.mode === 'spread';
  const surplus = gm.expected - gm.required;
  const mixNow = gm.mixNow;

  return (
    <Card gilt>
      <SectionHeader eyebrow={goal.name} size="sm" style={{ marginBottom: 20 }}
        sub={`${money(goal.amount)} in today's rupees${spread ? `, drawn over ${goal.withdrawal.years} years` : ''} · needed ${goalYear} · costs assumed to rise ${goal.inflation}% a year`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 18, marginBottom: 24 }}>
        <Stat label="Costs by then" value={money(gm.futureCost)} sub={`${money(goal.amount)} today, inflated`} />
        <Stat label="Corpus needed" value={money(gm.required)} sub={spread ? 'on the date — the rest earns while drawn' : 'on the date'} />
        <Stat label="Apex suggests" tone="var(--color-accent)" value={gm.months ? formatCurrency(Math.round(gm.monthly)) : '—'}
          sub={gm.months ? 'a month, for 8 in 10 odds' : 'the date has arrived'} />
        <Stat label="Middle path" value={Number.isFinite(gm.need) ? formatCurrency(Math.round(gm.need)) : '—'}
          sub="a month — gets there half the time" />
        <Stat label="Expected" value={money(gm.expected)} tone={surplus >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}
          sub={`${surplus >= 0 ? 'surplus' : 'short'} ${money(Math.abs(surplus))} at the suggested amount`} />
      </div>

      <p className="col-head" style={{ marginBottom: 6 }}>Range of outcomes</p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>
        The band holds 8 in 10 simulated markets; the gold line is the middle one.
      </p>
      <GoalFanChart bands={gm.bands} required={gm.required} startYear={startYear} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 28, marginTop: 28 }}>
        <div>
          <p className="col-head" style={{ marginBottom: 12 }}>Suggested contributions</p>
          {contrib.length ? (
            <ShowMore items={contrib} initial={6} noun="years" wrap={body => (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><TH>Year</TH><TH right>A month</TH><TH right>Paid in</TH><TH right>Expected</TH></tr></thead>
                <tbody>{body}</tbody>
              </table>
            )}
                render={r => (
                  <tr key={r.year}>
                    <TD>{startYear + r.year}</TD>
                    <TD right>{formatCurrency(Math.round(r.monthly))}</TD>
                    <TD right>{money(r.paid)}</TD>
                    <TD right tone="var(--color-text-primary)">{money(r.value)}</TD>
                  </tr>
                )} />
          ) : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>The date has arrived.</p>}
        </div>

        <div>
          <p className="col-head" style={{ marginBottom: 12 }}>Withdrawal plan</p>
          <ShowMore items={payout} initial={6} noun="years" wrap={body => (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><TH>Year</TH><TH right>Drawn</TH><TH right>Left after</TH></tr></thead>
              <tbody>{body}</tbody>
            </table>
          )}
              render={r => (
                <tr key={r.year}>
                  <TD>{goalYear + r.year - 1}</TD>
                  <TD right>{money(r.draw)}</TD>
                  <TD right tone={r.short ? 'var(--color-danger)' : 'var(--color-text-primary)'}>{r.short ? 'runs short' : money(r.end)}</TD>
                </tr>
              )} />
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            {spread
              ? 'Each year’s cost grows with inflation; what is not yet drawn stays in a debt-heavy mix.'
              : 'Drawn whole on the date. Hold it in debt or cash from the final year.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 28, marginTop: 28 }}>
        <div>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 10, gap: 12 }}>
            <p className="col-head">Asset mix · {goal.strategy === 'auto' ? 'Apex’s glide path' : `${STRATEGIES[goal.strategy]?.label}, your preference`}</p>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>expected {(mixReturn(mixNow) * 100).toFixed(1)}% a year now</span>
          </div>
          <div className="flex" style={{ gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
            {ASSET_KEYS.map(k => (
              <span key={k} className="text-xs flex items-center" style={{ gap: 6, color: 'var(--color-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: ASSET_COLORS[k] }} />
                {ASSETS[k].label} <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{Math.round(mixNow[k] * 100)}%</span>
              </span>
            ))}
          </div>
          {glide.length > 1
            ? <GlidePathChart rows={glide} />
            : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Under a year to go — keep it all in debt or cash.</p>}
        </div>

        <div>
          <p className="col-head" style={{ marginBottom: 6 }}>What moves the odds</p>
          {levers.map(l => (
            <div key={l.label} className="flex items-center justify-between" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
              <span className="figure text-sm" style={{ color: l.delta > 0.5 ? 'var(--color-success)' : l.delta < -0.5 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                {Math.abs(l.delta) < 0.5 ? 'no change' : `${l.p.toFixed(0)}% · ${formatPoints(l.delta, 0)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
