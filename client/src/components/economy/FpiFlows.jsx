import { useMemo } from 'react';
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import BandCursor from '../charts/BandCursor';
import { CHART_COLORS, formatCrore, pnlColor, axisCompact, monthYearShort } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const MONTHS_SHOWN = 36;

/** Foreign portfolio investors month by month, shares and bonds apart, with calendar-year totals. */
export default function FpiFlows({ fpi }) {
  const rows = useMemo(() => fpi.slice(-MONTHS_SHOWN).map(m => ({
    ...m, date: m.date.slice(0, 7), label: `${monthYearShort(m.date)}${m.partial ? ' (to date)' : ''}`,
    other: (m.hybrid || 0) + (m.other || 0),
  })), [fpi]);

  const years = useMemo(() => {
    const by = {};
    for (const m of fpi) {
      const y = m.date.slice(0, 4);
      const t = (by[y] ||= { year: y, equity: 0, debt: 0, total: 0, partial: false });
      t.equity += m.equity || 0; t.debt += m.debt || 0; t.total += m.total || 0;
      if (m.partial) t.partial = true;
    }
    return Object.values(by).sort((a, b) => b.year.localeCompare(a.year)).slice(0, 6);
  }, [fpi]);

  if (!rows.length) return null;

  return (
    <Card>
      <SectionHeader eyebrow="Foreign portfolio investors" size="sm" style={{ marginBottom: 18 }}
        sub="Net buying of Indian shares and bonds each month, every route included · NSDL, ₹ crore" />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: 28, alignItems: 'start' }}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={28} tickFormatter={l => l.replace(' (to date)', '')} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={v => axisCompact(v)} />
            <ReferenceLine y={0} stroke="var(--color-border-hover)" />
            <Tooltip isAnimationActive={false} cursor={<BandCursor count={rows.length} />}
              content={<ChartTooltip formatValue={v => formatCrore(v, { signed: true })} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            <Bar dataKey="equity" name="Equity" stackId="f" fill={CHART_COLORS[1]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="debt" name="Debt" stackId="f" fill={CHART_COLORS[0]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="other" name="Hybrid & funds" stackId="f" fill="var(--color-text-muted)" maxBarSize={14} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div>
          <div className="flex" style={{ gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head" style={{ flex: 1 }}>Year</span>
            {['Equity', 'Debt', 'Total'].map(h => <span key={h} className="col-head" style={{ width: 86, textAlign: 'right' }}>{h}</span>)}
          </div>
          {years.map(y => (
            <div key={y.year} className="flex items-center" style={{ gap: 10, padding: '9px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ flex: 1, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                {y.partial ? <span title={`${y.year} to date`}>YTD</span> : y.year}
              </span>
              {['equity', 'debt', 'total'].map(k => (
                <span key={k} className="figure text-xs" style={{ width: 86, textAlign: 'right', color: pnlColor(y[k]) }}>
                  {formatCrore(y[k], { signed: true })}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
