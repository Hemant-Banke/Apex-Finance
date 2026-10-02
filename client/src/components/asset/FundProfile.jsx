import { Link } from 'react-router-dom';
import { formatCurrency, dayLabel } from '../../lib/utils';
import { assetPath } from '../../lib/markets';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import { StatGrid } from '../stock/PricePerformance';

/** What the scheme is — house, category, plan — what it is judged against, and its sibling plans. */
export default function FundProfile({ p, benchmark }) {
  const category = p.category?.replace(/^[^-]+-\s*/, '') || p.category;
  return (
    <Card>
      <SectionHeader eyebrow="The scheme" size="sm"
        sub={benchmark ? `Judged against the ${benchmark.label}, the index for its category` : 'No index fits this category fairly, so it is shown on its own'}
        style={{ marginBottom: 6 }} />
      <StatGrid initial={6} stats={[
        { label: 'Fund house', value: p.fundHouse, text: true },
        { label: 'Category', value: category, text: true, note: p.category !== category ? p.category : null },
        { label: 'Plan', value: p.plan, text: true,
          note: p.plan === 'Direct' ? 'Bought from the AMC, no distributor commission' : p.plan === 'Regular' ? 'Includes a distributor commission in its expenses' : null },
        { label: 'Option', value: p.option, text: true,
          note: p.option === 'Growth' ? 'Gains stay in the NAV' : p.option === 'IDCW' ? 'Pays out income; the NAV drops by each payout' : null },
        { label: 'ISIN', value: p.isin },
        { label: 'AMFI code', value: p.schemeCode },
      ]} />

      {p.plans?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>Other plans of this fund</p>
          {p.plans.map(pl => (
            <Link key={pl.symbol} to={assetPath(pl.symbol)} className="sector-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '10px 12px', alignItems: 'baseline', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-primary)', minWidth: 0 }}>{pl.name}</span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                NAV {formatCurrency(pl.nav)}{pl.navDate && <span style={{ color: 'var(--color-text-muted)' }}> · {dayLabel(pl.navDate)}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
