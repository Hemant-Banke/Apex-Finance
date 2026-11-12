import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import DivergingBar from '../ui/DivergingBar';
import ShowMore from '../ui/ShowMore';
import Sparkline from '../ui/Sparkline';
import { CHART_COLORS, formatPoints, monthLabel, pnlColor } from '../../lib/utils';
import { assetPath } from '../../lib/markets';
import { signedPct } from '../../lib/economy';

const WINDOWS = [
  { key: '1m', label: '1M' }, { key: '3m', label: '3M' }, { key: '6m', label: '6M' }, { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' }, { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' },
];
const COLS = 'minmax(0, 1fr) 76px minmax(140px, 1.1fr) 64px';

function Pull({ label, value, sub, series, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</p>
      <div className="flex items-end justify-between" style={{ gap: 12 }}>
        <div>
          <p className="figure" style={{ fontSize: '1.15rem', color: 'var(--color-text-primary)' }}>{value}</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>{sub}</p>
        </div>
        {series?.length > 1 && <Sparkline values={series} width={110} height={34} tone={tone} title={label} />}
      </div>
    </div>
  );
}

/**
 * Where the world's equity money has done best: each country's market in US dollars (what a global investor
 * actually earns) against the world, and the dollar's pull on all of them.
 */
export default function CapitalRotation({ data, gsec10y }) {
  const [win, setWin] = useState('1y');
  const world = data.markets.find(m => m.iso === 'WLD');
  const rows = useMemo(() => data.markets.filter(m => m.returns[win] != null)
    .map(m => ({ ...m, r: m.returns[win], gap: world?.returns[win] != null ? m.returns[win] - world.returns[win] : null }))
    .sort((a, b) => b.r - a.r), [data, win, world]);
  const max = Math.max(...rows.map(r => Math.abs(r.gap ?? 0)), 0.1);
  const cagr = win === '3y' || win === '5y';

  const { us10y, dxy } = data.pull || {};
  // India's 10-year against the US 10-year averaged over the same month: the extra yield for holding rupee debt.
  let gap = null;
  if (gsec10y && us10y?.series?.length) {
    const month = gsec10y.date.slice(0, 7);
    const same = us10y.series.filter(p => p.date.startsWith(month));
    const us = same.length ? same.reduce((s, p) => s + p.value, 0) / same.length : null;
    if (us != null) gap = { india: gsec10y.value, us, v: gsec10y.value - us, month: gsec10y.date };
  }

  return (
    <Card>
      <SectionHeader eyebrow="Markets, in dollars" size="sm" style={{ marginBottom: 18 }}
        sub="Each country's stock market as a dollar investor holds it (the US-listed fund that tracks it), so the currency's move is in the return. Ranked by return; the bar is the gap to the world's market." />

      {(us10y || dxy || gap) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24, padding: '16px 18px', marginBottom: 22, borderRadius: 12, background: 'var(--color-bg-input)' }}>
          {us10y && <Pull label="US 10-year yield" value={`${us10y.value.toFixed(2)}%`} tone={CHART_COLORS[1]}
            series={us10y.series.map(p => p.value)}
            sub={us10y.yearAgo != null ? `${formatPoints(us10y.value - us10y.yearAgo, 2)} in a year. Higher draws money to the dollar.` : 'What the world earns risk-free in dollars'} />}
          {dxy && <Pull label="Dollar index" value={dxy.value.toFixed(1)} tone={CHART_COLORS[1]}
            series={dxy.series.map(p => p.value)}
            sub={dxy.yearAgo != null ? `${signedPct((dxy.value / dxy.yearAgo - 1) * 100)} in a year against six major currencies` : 'Against six major currencies'} />}
          {gap && <Pull label="India's yield premium" value={formatPoints(gap.v, 2)}
            sub={`India 10Y ${gap.india.toFixed(2)}% against US ${gap.us.toFixed(2)}%, ${monthLabel(gap.month)} average. The extra a foreigner earns for holding rupee bonds.`} />}
        </div>
      )}

      <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 10 }}>
        <p className="col-head">Return in US dollars{cagr ? ' · and a year, compounded' : ''}</p>
        <SegmentedControl size="sm" ariaLabel="Window" value={win} onChange={setWin} options={WINDOWS} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span className="col-head">Market</span>
        <span className="col-head" style={{ textAlign: 'right' }}>Return</span>
        <span className="col-head" style={{ textAlign: 'center' }}>Against the world</span>
        <span className="col-head" style={{ textAlign: 'right' }}>Gap</span>
      </div>
      <ShowMore items={rows} initial={14} ends noun="markets" render={(m) => {
        const india = m.iso === 'IND';
        return (
          <div key={m.iso} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <Link to={assetPath(m.symbol)} className="text-sm" style={{
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: india ? 'var(--color-text-primary)' : m.group ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              fontWeight: india ? 500 : 400, fontStyle: m.group ? 'italic' : 'normal',
            }}>
              {india && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: CHART_COLORS[0], marginRight: 8, verticalAlign: 'middle' }} />}
              {m.name} <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>{m.symbol}</span>
            </Link>
            <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(m.r) }}>
              {signedPct(m.r)}
              {cagr && m.cagr?.[win] != null && <span style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 2 }}>{signedPct(m.cagr[win])}/yr</span>}
            </span>
            {m.iso === 'WLD' ? <span /> : <DivergingBar value={m.gap} max={max} height={6} muted={m.group} />}
            <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{m.iso === 'WLD' ? '' : formatPoints(m.gap)}</span>
          </div>
        );
      }} />
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        Price returns of US-listed country funds (INDA for India, SPY for the US, ACWI for the world, EEM for emerging markets; iShares and Global X funds elsewhere) through {data.through}. Prices, not money flows: no free source tracks money moving between countries day by day.
      </p>
    </Card>
  );
}
