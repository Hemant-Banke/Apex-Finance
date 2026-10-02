import { compactIfLarge } from '../../lib/utils';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';

const span = (months) => (months == null ? '—' : months < 24 ? `${months.toFixed(1)} months` : `${(months / 12).toFixed(1)} years`);

/** How long the money lasts with no income at all, reaching for one more layer each time. */
export default function RunwayTiers({ spend, sources }) {
  const tiers = [
    { key: 'cash', label: 'Cash', sub: 'In the bank, today', value: sources.cash, tone: 'color-mix(in srgb, var(--color-garden-light) 35%, var(--color-bg-elevated))' },
    { key: 'liquid', label: '+ Liquid investments', sub: 'Sellable on a market within days', value: sources.cash + sources.liquid, tone: 'color-mix(in srgb, var(--color-garden) 70%, var(--color-bg-elevated))' },
    { key: 'all', label: '+ Locked-in assets', sub: 'EPF, FDs, bonds, property…', value: sources.cash + sources.liquid + sources.illiquid, tone: 'var(--color-garden)' },
    { key: 'net', label: 'Net of debts', sub: 'After paying back what you owe', value: sources.cash + sources.liquid + sources.illiquid - sources.debts, tone: 'var(--color-garden-light)' },
  ].map(t => ({ ...t, months: spend > 0 ? Math.max(0, t.value) / spend : null }));
  const max = Math.max(...tiers.map(t => t.months || 0), 1);

  return (
    <Card>
      <SectionHeader eyebrow="Runway" size="sm" style={{ marginBottom: 22 }}
        sub={`If income stopped today, at ${compactIfLarge(Math.round(spend))} a month — no returns assumed`} />
      <div style={{ display: 'grid', gap: 16 }}>
        {tiers.map(t => (
          <div key={t.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 0.9fr) 2fr minmax(96px, auto)', gap: 16, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t.label}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{t.sub}</p>
            </div>
            <div style={{ height: 10, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((t.months || 0) / max) * 100}%`, minWidth: t.months ? 6 : 0, borderRadius: 99, background: t.tone, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{span(t.months)}</p>
              <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{compactIfLarge(Math.round(t.value))}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
