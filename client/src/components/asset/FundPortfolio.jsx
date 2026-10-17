import { Link } from 'react-router-dom';
import { formatCrore, dayLabel } from '../../lib/utils';
import { stockPath, globalStockPath } from '../../lib/markets';
import Card from '../ui/Card';
import ShowMore from '../ui/ShowMore';
import SectionHeader from '../ui/SectionHeader';
import AllocationBar from '../portfolio/AllocationBar';
import { StatGrid } from '../stock/PricePerformance';

const COLS = 'minmax(180px, 1.8fr) minmax(110px, 1fr) minmax(150px, 1fr)';

/** What a fund, ETF or foreign index holds: its terms, asset mix, sectors and holdings. */
export default function FundPortfolio({ p, name }) {
  const f = p.facts || {};
  const pct = (v, d = 2) => (v != null ? `${Number(v).toFixed(d)}%` : null);
  const maxW = Math.max(...p.holdings.map(h => h.weight), 0.01);
  const hasHoldings = p.holdings.length > 0;

  return (
    <Card>
      <SectionHeader eyebrow="What it holds" size="sm" sub={summary(p, name)} style={{ marginBottom: 6 }} />

      <StatGrid initial={8} noun="facts" stats={[
        { label: 'Expense ratio', value: pct(f.expenseRatio), note: 'Taken from the fund every year' },
        { label: 'Fund size', value: f.aumCr != null ? formatCrore(f.aumCr) : null, note: 'Assets under management' },
        { label: 'Tracking error', value: pct(f.trackingError), note: 'How far it strays from its index' },
        { label: 'P/E', value: f.pe != null ? Number(f.pe).toFixed(1) : null, note: 'Of the stocks it holds' },
        { label: 'P/B', value: f.pb != null ? Number(f.pb).toFixed(2) : null, note: 'Price against book value' },
        { label: 'Turnover', value: pct(f.turnover, 0), note: 'Share of the portfolio traded in a year' },
        { label: 'Benchmark', value: f.benchmark, text: true },
        { label: 'Category', value: f.category, text: true },
        { label: 'Managed by', value: f.managers?.length ? f.managers.join(', ') : null, text: true },
        { label: 'Fund house', value: f.family, text: true },
        { label: 'Since', value: f.launched, text: true },
      ]} />

      {p.mix?.length > 1 && (
        <div style={{ marginTop: 22 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>By asset class</p>
          <AllocationBar showValue={false} items={p.mix.map(m => ({ name: m.name, value: m.weight, weight: m.weight }))} />
        </div>
      )}

      {p.sectors?.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 10 }}>
            By sector{p.mix?.length > 1 ? ' · of the equity it holds' : ''}
          </p>
          <AllocationBar showValue={false} items={p.sectors.map(s => ({ name: s.name, value: s.weight, weight: s.weight }))} />
        </div>
      )}

      {hasHoldings && (
        <div style={{ overflowX: 'auto', marginTop: 22 }}>
          <div style={{ minWidth: 520 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '0 12px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="col-head">Holding</span>
              <span className="col-head">{p.holdings.some(h => h.sector) ? 'Sector' : ''}</span>
              <span className="col-head" style={{ textAlign: 'right' }}>Weight</span>
            </div>
            <ShowMore items={p.holdings} initial={10} noun="holdings"
              render={(h, i) => <HoldingRow key={`${h.name}-${i}`} h={h} max={maxW} />} />
          </div>
        </div>
      )}
    </Card>
  );
}

function summary(p, name) {
  const asof = p.asof ? ` · portfolio as of ${dayLabel(p.asof, true)}` : '';
  if (!p.holdings.length) return `${name} publishes no line-by-line portfolio, so only its terms are shown · source ${p.source}`;
  const via = p.via ? `The basket it tracks, as held by ${p.via.label} · ` : '';
  const size = p.count != null
    ? `${p.count} holdings · the top 10 are ${p.top10}% of it`
    : `Its ten largest holdings, ${p.top10}% of it`;
  return `${via}${size}${asof} · source ${p.source}`;
}

function HoldingRow({ h, max }) {
  const to = h.symbol ? stockPath(h.symbol) : h.ticker ? globalStockPath(h.ticker) : null;
  const body = (
    <>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{h.name}</span>
        {(h.symbol || h.ticker) && <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{h.symbol || h.ticker}</span>}
      </span>
      <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{h.sector || (h.kind && h.kind !== 'Equity' ? h.kind : '')}</span>
      <span style={{ display: 'grid', gridTemplateColumns: '1fr 56px', gap: 10, alignItems: 'center' }}>
        <span style={{ height: 6, borderRadius: 99, background: 'var(--color-border-subtle)', overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${(h.weight / max) * 100}%`, borderRadius: 99, background: 'var(--color-accent)' }} />
        </span>
        <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{h.weight.toFixed(2)}%</span>
      </span>
    </>
  );
  const style = { display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 12px', alignItems: 'center', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' };
  return to
    ? <Link to={to} className="sector-row" style={style}>{body}</Link>
    : <div style={style}>{body}</div>;
}
