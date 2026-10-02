import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPct, formatPoints, pnlColor } from '../../lib/utils';
import { stockPath } from '../../lib/markets';
import Card from '../ui/Card';
import ShowMore from '../ui/ShowMore';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import DivergingBar from '../ui/DivergingBar';
import AllocationBar from '../portfolio/AllocationBar';
import { StatGrid } from '../stock/PricePerformance';

/** An NSE index read like a fund: what it costs, how broad today's move is, and what it holds. */
export default function IndexProfile({ p, name, changePct }) {
  return (
    <>
      <Valuation p={p} />
      {p.composition && <Composition c={p.composition} name={name} changePct={changePct} />}
    </>
  );
}

function Valuation({ p }) {
  const b = p.breadth;
  const total = b ? (b.advances || 0) + (b.declines || 0) + (b.unchanged || 0) : 0;
  return (
    <Card>
      <SectionHeader eyebrow="Valuation & breadth" size="sm"
        sub="What the market pays for the index's earnings, and how many of its members moved with it today" style={{ marginBottom: 6 }} />
      <StatGrid initial={8} stats={[
        { label: 'P/E', value: p.pe?.toFixed(1), note: p.earningsYield != null ? `Earnings yield ${p.earningsYield.toFixed(1)}%` : null },
        { label: 'P/B', value: p.pb?.toFixed(2), note: 'Price against book value' },
        { label: 'Dividend yield', value: p.dy != null ? `${p.dy.toFixed(2)}%` : null, note: 'Trailing, before tax' },
        total > 0 && {
          label: 'Members up today', value: `${b.advances} of ${total}`,
          tone: b.advances > b.declines ? 'var(--color-success)' : b.advances < b.declines ? 'var(--color-danger)' : undefined,
          note: `${b.declines} down${b.unchanged ? ` · ${b.unchanged} flat` : ''}`,
        },
      ]} />
    </Card>
  );
}

const COLS = 'minmax(170px, 1.6fr) minmax(110px, 1fr) 64px 64px 64px minmax(130px, 1fr)';
const VIEWS = [{ key: 'weight', label: 'By weight' }, { key: 'movers', label: "Today's movers" }];

function Composition({ c, name, changePct }) {
  const [view, setView] = useState('weight');
  const movers = view === 'movers';
  const rows = movers
    ? [...c.holdings].sort((a, b) => (b.contrib1d ?? -Infinity) - (a.contrib1d ?? -Infinity))
    : c.holdings;
  const maxContrib = Math.max(...c.holdings.map(h => Math.abs(h.contrib1d || 0)), 0.0001);
  const sumContrib = c.holdings.reduce((a, h) => a + (h.contrib1d || 0), 0);
  const basis = c.sized === 'float' ? 'free-float market cap' : c.sized === 'cap' ? 'market cap' : 'equal weight (caps unavailable)';

  return (
    <Card>
      <SectionHeader eyebrow="What it holds" size="sm"
        sub={`${c.count} companies · the top 10 are ${c.top10}% of it · weighted by ${basis}, so close to NSE's official weights but not identical`}
        action={<SegmentedControl options={VIEWS} value={view} onChange={setView} ariaLabel="Order members" />}
        style={{ marginBottom: 18 }} />

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>By sector</p>
      <AllocationBar showValue={false} items={c.sectors.map(s => ({ name: s.name, value: s.weight, weight: s.weight }))} />

      {movers && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 20, lineHeight: 1.5 }}>
          Contribution is each member&apos;s weight times its move, in points of the index&apos;s return. Together they
          add to <span className="figure" style={{ color: pnlColor(sumContrib) }}>{formatPoints(sumContrib, 2)}</span>
          {changePct != null && <> against {name}&apos;s <span className="figure" style={{ color: pnlColor(changePct) }}>{formatPct(changePct, 2)}</span></>}.
        </p>
      )}

      <div style={{ overflowX: 'auto', marginTop: 20 }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '0 12px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">Company</span>
            <span className="col-head">Sector</span>
            {['Weight', 'Today', '1Y'].map(h => <span key={h} className="col-head" style={{ textAlign: 'right' }}>{h}</span>)}
            <span className="col-head" style={{ textAlign: 'center' }}>Contribution today</span>
          </div>
          <ShowMore key={view} items={rows} initial={10} ends={movers} noun="companies"
            render={(h) => <MemberRow key={h.symbol} h={h} max={maxContrib} />} />
        </div>
      </div>
    </Card>
  );
}

function MemberRow({ h, max }) {
  return (
    <Link to={stockPath(h.symbol)} className="sector-row"
      style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 12px', alignItems: 'center', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' }}>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{h.name}</span>
        <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{h.symbol}</span>
      </span>
      <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{h.sector}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{h.weight != null ? `${h.weight.toFixed(2)}%` : '—'}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(h.chg1d) }}>{formatPct(h.chg1d, 1)}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(h.chg1y) }}>{formatPct(h.chg1y, 1)}</span>
      <span style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: 8, alignItems: 'center' }}>
        <DivergingBar value={h.contrib1d} max={max} />
        <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(h.contrib1d) }}>{formatPoints(h.contrib1d, 2)}</span>
      </span>
    </Link>
  );
}
