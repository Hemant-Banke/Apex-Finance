import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ShowMore from '../ui/ShowMore';
import { marketsAPI } from '../../lib/api';
import { formatPct, pnlColor } from '../../lib/utils';
import { stockPath, globalStockPath, companyMoney } from '../../lib/markets';

/**
 * The company among its peers: size, valuation and share price from the page payload, and
 * average revenue and profit growth from every peer's filings (`/markets/stocks/:symbol/growth`,
 * loaded apart — a first read fetches a dozen companies' filings).
 */

const WINDOWS = [
  { key: '3y', label: '3Y', head: 'Annual growth · 3Y' },
  { key: '5y', label: '5Y', head: 'Annual growth · 5Y' },
  { key: 'ttm', label: '12M', head: 'Growth · last 12M' },
];

// Rank · company | cap · P/E · P/B | 1M · 1Y | revenue · profit. Groups are set apart by a wider gap.
const COLS = '24px minmax(190px, 1fr) 96px 56px 56px 20px 64px 64px 20px 72px 72px';
const GROUPS = [
  { label: 'Valuation', span: '3 / 6' },
  { label: 'Share price', span: '7 / 9' },
  { label: null, span: '10 / 12' },
];

function median(xs) {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const muted = 'var(--color-text-muted)';
const rowGrid = { display: 'grid', gridTemplateColumns: COLS, columnGap: 10, alignItems: 'center' };

const Num = ({ v, color = 'var(--color-text-secondary)' }) => (
  <span className="figure text-xs" style={{ textAlign: 'right', color: v == null ? muted : color }}>{v ?? '—'}</span>
);
const Pct = ({ v, loading }) => <Num v={loading ? '…' : v == null ? null : formatPct(v, 1)} color={pnlColor(v)} />;

function Row({ p, rank, g, loading, money, global, kind }) {
  const cap = p.cap == null ? null : global ? companyMoney({ unit: 'unit', currency: p.currency }).big(p.cap) : money.big(p.cap);
  const cells = (
    <>
      <span className="figure text-xs" style={{ color: muted }}>{rank ?? ''}</span>
      <span style={{ minWidth: 0 }}>
        <span className="text-sm truncate" style={{ display: 'block', color: kind === 'median' ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', fontWeight: kind === 'self' ? 500 : 400 }}>{p.name}</span>
        {kind !== 'median' && <span className="figure text-xs" style={{ color: muted }}>{p.symbol}</span>}
      </span>
      <Num v={cap} />
      <Num v={p.pe?.toFixed(1)} />
      <Num v={p.pb?.toFixed(1)} />
      <span />
      <Pct v={p.chg1m} />
      <Pct v={p.chg1y} />
      <span />
      <Pct v={g?.revenue} loading={loading} />
      <Pct v={g?.profit} loading={loading} />
    </>
  );
  const style = { ...rowGrid, padding: '9px 12px', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' };
  // This company is raised like a selected row — never gold.
  if (kind === 'self') return <div style={{ ...style, borderBottom: 'none', borderRadius: 8, background: 'var(--color-bg-elevated)', boxShadow: 'var(--shadow-sm)', margin: '4px 0' }}>{cells}</div>;
  if (kind === 'median') return <div style={{ ...style, borderBottom: 'none', borderTop: '1px solid var(--color-border)' }}>{cells}</div>;
  return <Link to={global ? globalStockPath(p.symbol) : stockPath(p.symbol)} className="sector-row" style={style}>{cells}</Link>;
}

/** A small "label · value" chip for the standing line. */
const Standing = ({ label, value }) => value ? (
  <span className="text-xs" style={{ padding: '5px 10px', borderRadius: 99, background: 'var(--color-bg-elevated)', color: muted }}>
    {label} <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
  </span>
) : null;

export default function Peers({ peers, symbol, global, money, sectorMedianPe }) {
  const [growth, setGrowth] = useState(null);
  const [w, setW] = useState('3y');

  useEffect(() => {
    let live = true;
    marketsAPI.growth(symbol, global).then(r => { if (live) setGrowth(r.data); }).catch(() => { if (live) setGrowth(false); });
    return () => { live = false; };
  }, [symbol, global]);

  if (!peers?.items?.length) return null;
  const self = peers.items.find(p => p.self);
  const others = peers.items.filter(p => !p.self);
  const loading = growth === null;

  const rows = growth?.rows || [];
  const bySym = Object.fromEntries(rows.map(r => [r.symbol, r]));
  const covered = (k) => rows.some(r => !r.self && (r[k]?.revenue != null || r[k]?.profit != null));
  const windows = growth ? WINDOWS.filter(x => covered(x.key)) : WINDOWS.slice(0, 1);
  const win = windows.find(x => x.key === w) || windows[0] || WINDOWS[0];
  const k = win.key;
  const g = (sym) => bySym[sym]?.[k];
  const med = growth?.median?.[k] || {};

  // Where this company ranks on each measure, among every company with a figure.
  const rankBy = (vals, mine, desc = true) => {
    if (mine == null) return null;
    const xs = vals.filter(v => v != null).sort((a, b) => (desc ? b - a : a - b));
    return `#${xs.indexOf(mine) + 1} of ${xs.length}`;
  };
  const mineG = g(self?.symbol) || {};
  const medianRow = {
    name: 'Median',
    pe: sectorMedianPe ?? median(others.map(p => p.pe)), pb: median(others.map(p => p.pb)),
    chg1m: median(others.map(p => p.chg1m)), chg1y: median(others.map(p => p.chg1y)),
  };
  const grown = rows.length ? rows.length - 1 : 0;
  const rankOf = new Map(peers.items.map((p, i) => [p.symbol, i + 1]));

  return (
    <Card>
      <SectionHeader eyebrow={global ? 'Often compared with' : 'Sector peers'} size="sm"
        sub={global
          ? 'The companies investors most often look at alongside it'
          : `${peers.sector.label} · ${peers.count} Nifty 500 companies · sector ${formatPct(peers.sector.chg1y, 1)} over a year`}
        action={windows.length > 1 && <SegmentedControl size="sm" ariaLabel="Growth window" value={k} onChange={setW} options={windows.map(x => ({ key: x.key, label: x.label }))} />}
        style={{ marginBottom: 14 }} />

      {self && (
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Standing label="Market cap" value={`#${peers.rank} of ${peers.count}`} />
          <Standing label="1Y return" value={rankBy(peers.items.map(p => p.chg1y), self.chg1y)} />
          {!loading && <Standing label={`Revenue growth · ${win.label}`} value={rankBy(rows.map(r => r[k]?.revenue), mineG.revenue)} />}
          {!loading && <Standing label={`Profit growth · ${win.label}`} value={rankBy(rows.map(r => r[k]?.profit), mineG.profit)} />}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 820 }}>
          {/* Two header rows: the group, then its columns. */}
          {/* Each group label sits centred over a hairline spanning exactly its columns. */}
          <div style={{ ...rowGrid, padding: '0 12px 8px' }}>
            {GROUPS.map(gr => (
              <span key={gr.span} className="col-head" style={{ gridColumn: gr.span, textAlign: 'center', paddingBottom: 6, borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                {gr.label ?? win.head}
              </span>
            ))}
          </div>
          <div style={{ ...rowGrid, padding: '0 12px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">#</span>
            <span className="col-head">Company</span>
            {['Market cap', 'P/E', 'P/B', '', '1M', '1Y', '', 'Revenue', 'Profit'].map((h, i) => <span key={i} className="col-head" style={{ textAlign: 'right' }}>{h}</span>)}
          </div>
          {/* This company is pinned on top, so it is always there to compare against; the rest fold. */}
          {self && <Row p={self} rank={rankOf.get(self.symbol)} g={g(self.symbol)} loading={loading} money={money} global={global} kind="self" />}
          <ShowMore items={others} initial={8} noun="peers"
            render={(p) => <Row key={p.symbol} p={p} rank={rankOf.get(p.symbol)} g={g(p.symbol)} loading={loading} money={money} global={global} />} />
          <Row p={medianRow} g={growth ? med : null} loading={loading} money={money} global={global} kind="median" />
        </div>
      </div>
      <p className="text-xs" style={{ color: muted, marginTop: 12, lineHeight: 1.55 }}>
        Ranked by market cap. Growth is revenue and net profit from each company’s own filings{grown && others.length > grown ? `, for the ${grown} largest peers` : ''}; withheld where either end of the window is a loss.
        {!global && ' The P/E median is the whole sector’s.'}
      </p>
    </Card>
  );
}
