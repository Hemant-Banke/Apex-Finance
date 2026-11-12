import { useMemo, useState } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ChartTooltip from '../charts/ChartTooltip';
import BandCursor from '../charts/BandCursor';
import { MastheadFigure } from '../ui/Masthead';
import { CHART_COLORS, formatCrore, axisCompact, monthYearShort, monthLabel } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const MONTHS_SHOWN = 36;

const CLASSES = [
  { key: 'equity', name: 'Active equity', color: CHART_COLORS[1] },
  { key: 'passive', name: 'Index & ETFs', color: CHART_COLORS[2] },
  { key: 'hybrid', name: 'Hybrid', color: CHART_COLORS[4] },
  { key: 'metals', name: 'Gold & silver ETFs', color: CHART_COLORS[0] },
  { key: 'debt', name: 'Debt', color: CHART_COLORS[3], debt: true },
  { key: 'other', name: 'Other', color: 'var(--color-text-muted)', debt: true },
];

const crore = (v) => `${(v / 1e7).toFixed(2)} Cr`;

/** Household money arriving through mutual funds, by asset class (AMFI). Debt is optional: it is mostly corporate treasury cash and swamps the rest. */
export default function FundFlows({ funds }) {
  const [view, setView] = useState('long');
  const rows = useMemo(() => funds.slice(-MONTHS_SHOWN).map(m => ({ ...m, date: m.date.slice(0, 7) })), [funds]);
  const shown = CLASSES.filter(c => view === 'all' || !c.debt);

  const last = funds[funds.length - 1];
  const year = funds.slice(-12);
  const equity12 = year.reduce((s, m) => s + (m.equity || 0) + (m.passive || 0), 0);
  const yearAgo = funds[funds.length - 13];
  if (!rows.length || !last) return null;

  return (
    <Card>
      <SectionHeader eyebrow="Household money into funds" size="sm" style={{ marginBottom: 18 }}
        sub={`Net inflows into mutual funds each month by asset class, SIPs included · AMFI, ₹ crore · to ${monthLabel(last.date)}`}
        action={<SegmentedControl size="sm" ariaLabel="Fund classes" value={view} onChange={setView}
          options={[{ key: 'long', label: 'Long-term money' }, { key: 'all', label: 'With debt funds' }]} />} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, marginBottom: 20 }}>
        <MastheadFigure label="Into equity, last 12 months" value={formatCrore(equity12)} sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>active funds, index funds and ETFs</span>} />
        <MastheadFigure label="Industry assets" value={formatCrore(last.aum)}
          sub={yearAgo?.aum && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>+{((last.aum / yearAgo.aum - 1) * 100).toFixed(1)}% in a year</span>} />
        <MastheadFigure label="Equity fund assets" value={formatCrore(last.equityAum)} />
        <MastheadFigure label="Investor accounts (folios)" value={crore(last.folios)}
          sub={yearAgo?.folios && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>+{crore(last.folios - yearAgo.folios)} in a year</span>} />
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={28} tickFormatter={monthYearShort} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={v => axisCompact(v)} />
          <ReferenceLine y={0} stroke="var(--color-border-hover)" />
          <Tooltip isAnimationActive={false} cursor={<BandCursor count={rows.length} />}
            content={<ChartTooltip formatValue={v => formatCrore(v, { signed: true })} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
          {shown.map(c => <Bar key={c.key} dataKey={c.key} name={c.name} stackId="f" fill={c.color} maxBarSize={14} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
