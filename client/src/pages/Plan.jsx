import { useEffect, useMemo, useState } from 'react';
import { dashboardAPI } from '../lib/api';
import { compactIfLarge, formatCurrency, pnlColor } from '../lib/utils';
import { planModel, loadPlanSettings, journeyMarks, PLAN_DEFAULTS, PLAN_STORE_KEY } from '../lib/planModel';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import SectionHeader from '../components/ui/SectionHeader';
import FreedomHero from '../components/plan/FreedomHero';
import Journey from '../components/plan/Journey';
import PlanControls from '../components/plan/PlanControls';
import RunwayTiers from '../components/plan/RunwayTiers';
import ProjectionChart from '../components/plan/ProjectionChart';
import SensitivityGrid from '../components/plan/SensitivityGrid';
import { useToast } from '../context/ToastContext';

const money = (v) => compactIfLarge(Math.round(v || 0));
const yrs = (y) => (y == null ? '70+ years' : y < 1 ? `${Math.max(1, Math.round(y * 12))} months` : `${y.toFixed(1)} years`);

function ProgressBar({ pct, tone = 'var(--color-accent)' }) {
  return (
    <div style={{ height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden', marginTop: 8 }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: tone, borderRadius: 99, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: 14, borderLeft: '1px solid var(--color-border-hover)' }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.15rem', fontWeight: 500, color: tone || 'var(--color-text-primary)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.45 }}>{sub}</p>}
    </div>
  );
}

export default function Plan() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [s, setS] = useState(loadPlanSettings);

  useEffect(() => {
    Promise.all([dashboardAPI.getSummary(), dashboardAPI.getPortfolio(), dashboardAPI.getSpendingProfile(12)])
      .then(([sum, p, sp]) => setData({ summary: sum.data, portfolio: p.data, spending: sp.data }))
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load your plan'));
  }, [toast]);

  const set = (patch) => setS(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(PLAN_STORE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const reset = () => { try { localStorage.removeItem(PLAN_STORE_KEY); } catch { /* storage unavailable */ } setS(PLAN_DEFAULTS); };

  const m = useMemo(() => planModel(data, s), [data, s]);

  if (!m) return <Spinner />;

  const surplus = m.atRetire - m.needed;
  const lastsTo = m.path.depletedAt;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader eyebrow="Plan" title="Independence"
        sub="When work becomes optional — from what you have, what you spend and what you put away" />

      <FreedomHero m={m} s={s} />

      <PlanControls s={s} set={set} reset={reset} m={m} />

      <Card>
        <SectionHeader eyebrow="Your path" size="sm" style={{ marginBottom: 18 }}
          sub={`Your money by age in today's rupees · ${money(m.contribution)} a month until ${s.retireAge}, then ${money(m.spend)} a month drawn`} />
        <ProjectionChart points={m.path.points} fireNumber={m.target} marks={journeyMarks(m, s)} endAge={s.endAge} />
        <Journey m={m} s={s} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card>
          <SectionHeader eyebrow={`Retiring at ${s.retireAge}`} size="sm" style={{ marginBottom: 20 }}
            sub={`Funding ${money(m.spend)} a month from ${s.retireAge} to ${s.endAge}`} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
            <Stat label="You'll have" value={money(m.atRetire)} sub={`in ${m.toRetire} years, today's rupees`} />
            <Stat label="You'll need" value={money(m.needed)} sub={`to last ${s.endAge - s.retireAge} years`} />
            <Stat label={surplus >= 0 ? 'Surplus' : 'Shortfall'} value={money(Math.abs(surplus))} tone={pnlColor(surplus)}
              sub={surplus >= 0 ? 'more than the plan needs' : 'the plan comes up short by this'} />
            <Stat label="Money lasts until"
              value={lastsTo == null ? `${s.endAge}+` : `age ${lastsTo.toFixed(0)}`}
              tone={lastsTo == null ? 'var(--color-success)' : 'var(--color-danger)'}
              sub={lastsTo == null ? 'never runs out within the plan' : `${(s.endAge - lastsTo).toFixed(0)} years before age ${s.endAge}`} />
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 20, lineHeight: 1.6, paddingTop: 16, borderTop: '1px solid var(--color-border-subtle)' }}>
            {m.sipToClose > 0
              ? <>To retire at {s.retireAge} on this budget, invest <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{formatCurrency(Math.round(m.sipToClose))}</span> a month — {m.sipToClose > m.contribution ? <><span className="figure">{money(m.sipToClose - m.contribution)}</span> more than now.</> : 'already within what you put away.'}</>
              : <>What you have today already covers retiring at {s.retireAge}, with nothing more invested.</>}
          </p>
        </Card>

        <RunwayTiers spend={m.spend} sources={m.sources} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Card>
          <SectionHeader eyebrow="Sensitivity" size="sm" style={{ marginBottom: 18 }}
            sub="The age you reach FIRE at other withdrawal rates and returns · yours is the light square" />
          <SensitivityGrid corpus={m.corpus} contribution={m.contribution} annualSpend={m.annualSpend}
            inflation={s.inflation} age={s.age} swr={s.swr} ret={s.ret} />
        </Card>

        <Card>
          <SectionHeader eyebrow="Levers" size="sm" style={{ marginBottom: 14 }}
            sub="What each change does to your FIRE date" />
          {m.levers.map(l => (
            <div key={l.label} className="flex items-center justify-between" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{l.label}</span>
              <span className="figure text-sm" style={{ color: l.saved > 0.05 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {l.saved == null ? '—' : l.saved > 0.05 ? `${yrs(l.saved)} sooner` : 'no change'}
              </span>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 14, lineHeight: 1.6 }}>
            Based on {m.spending.activeMonths} month{m.spending.activeMonths === 1 ? '' : 's'} of your spending
            ({money(m.spending.expense)} a month, {money(m.spendOptions.lean)} of it essential) and
            a real return of {(m.accReal * 100).toFixed(1)}% a year.
          </p>
        </Card>
      </div>
    </div>
  );
}
