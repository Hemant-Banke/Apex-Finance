import { Link } from 'react-router-dom';
import { compactIfLarge, pnlColor } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';

const money = (v) => compactIfLarge(Math.round(v || 0));
const span = (months) => (months < 24 ? `${months.toFixed(1)} mo` : `${(months / 12).toFixed(1)} yrs`);

function Line({ label, value, tone, sub }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span className="figure text-sm" style={{ color: tone || 'var(--color-text-primary)', fontWeight: 500 }}>{value}</span>
        {sub && <span className="text-xs" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</span>}
      </span>
    </div>
  );
}

/** The FIRE plan in brief, on the assumptions saved on the Plan page. */
export default function IndependenceCard({ m, s }) {
  if (!m) return null;
  const pct = Math.min(999, m.progress);
  const surplus = m.atRetire - m.needed;
  const all = m.sources.cash + m.sources.liquid + m.sources.illiquid - m.sources.debts;
  return (
    <Card style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHeader eyebrow="Independence" size="sm" style={{ marginBottom: 18 }}
        action={<Link to="/plan" className="text-xs font-medium" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Plan →</Link>} />

      <div className="flex items-baseline" style={{ gap: 10 }}>
        <span className="figure" style={{ fontSize: '1.6rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{pct.toFixed(0)}%</span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>of <span className="figure">{money(m.target)}</span> FIRE number</span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden', margin: '12px 0 16px' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, borderRadius: 99, background: 'linear-gradient(90deg, var(--color-accent-muted, var(--color-accent)), var(--color-accent))' }} />
      </div>

      <Line label="Independent at"
        value={m.yearsFI === 0 ? 'Now' : m.fiAge != null ? `age ${m.fiAge.toFixed(0)}` : '—'}
        sub={m.yearsFI ? `in ${m.yearsFI.toFixed(1)} years` : null} />
      <Line label="Coast FIRE" value={m.corpus >= m.coast ? 'Reached' : `${money(m.coast - m.corpus)} to go`}
        tone={m.corpus >= m.coast ? 'var(--color-success)' : undefined} />
      <Line label={`Retiring at ${s.retireAge}`} value={`${money(Math.abs(surplus))} ${surplus >= 0 ? 'surplus' : 'short'}`} tone={pnlColor(surplus)} />
      <Line label="Runway" value={m.spend > 0 ? span(Math.max(0, all) / m.spend) : '—'}
        sub={m.spend > 0 ? `${span(m.sources.cash / m.spend)} on cash alone` : null} />

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 'auto', paddingTop: 12 }}>
        At {money(m.spend)} a month, {s.swr}% withdrawal, {s.ret}% return
      </p>
    </Card>
  );
}
