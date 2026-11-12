import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ChartTooltip from '../charts/ChartTooltip';
import { ContributionChart, ContributionTable } from './Contribution';
import { CHART_COLORS, ACTIVE_DOT } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };

const PARTS = [
  { key: 'pfce', label: 'Household spending', color: CHART_COLORS[1] },
  { key: 'gfcf', label: 'Investment in fixed capital', color: CHART_COLORS[0] },
  { key: 'gfce', label: 'Government spending', color: CHART_COLORS[2] },
  { key: 'net', label: 'Net exports', color: CHART_COLORS[4] },
  { key: 'other', label: 'Stocks, valuables & discrepancies', color: 'var(--color-text-muted)' },
];

const VIEWS = [{ key: 'growth', label: 'Sources of growth' }, { key: 'shares', label: 'Shares of GDP' }];

/** What the output is spent on: households, investment, government and the rest of the world. */
export default function Spending({ quarters }) {
  const [view, setView] = useState('growth');
  const rows = useMemo(() => quarters.map(q => ({
    label: q.short, total: q.gdpYoY,
    ...Object.fromEntries(PARTS.map(p => [p.key, q.spend[p.key]?.contrib ?? null])),
    ...Object.fromEntries(PARTS.map(p => [`${p.key}Share`, q.spend[p.key]?.share ?? null])),
  })), [quarters]);
  const [sel, setSel] = useState(rows.length - 1);
  const q = quarters[sel] || quarters[quarters.length - 1];
  if (!q) return null;
  const table = PARTS.map(p => ({ ...p, ...q.spend[p.key] }));
  const sum = table.reduce((s, r) => s + (r.contrib ?? 0), 0);

  return (
    <Card>
      <SectionHeader eyebrow="What the output is spent on" size="sm" style={{ marginBottom: 18 }}
        sub={view === 'growth'
          ? 'Real GDP by who spends it. Each bar is what a use added to growth on a year earlier; the line is GDP growth. Investment is the money that builds tomorrow’s output.'
          : 'Each use as a share of GDP, over the four quarters to each date, at current prices. Net exports below zero means India buys more abroad than it sells.'}
        action={<SegmentedControl size="sm" ariaLabel="Spending view" value={view} onChange={setView} options={VIEWS} />} />
      {view === 'growth' ? (
        <ContributionChart rows={rows} parts={PARTS.map(p => ({ key: p.key, name: p.label, color: p.color }))}
          line={{ key: 'total', name: 'GDP growth' }} selected={sel} onSelect={setSel} />
      ) : (
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={rows.filter(r => r.pfceShare != null)} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={14} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
            <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={v => `${v.toFixed(1)}%`} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            {PARTS.filter(p => p.key !== 'other').map(p => (
              <Line key={p.key} dataKey={`${p.key}Share`} name={p.label} stroke={p.color} strokeWidth={1.75} dot={false} activeDot={ACTIVE_DOT} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div style={{ marginTop: 26 }}>
        <p className="col-head" style={{ marginBottom: 10 }}>{q.months}</p>
        <ContributionTable rows={table} shareLabel="Of GDP" growthLabel="Growth"
          total={{ label: `GDP, ${q.short}`, yoy: q.gdpYoY, contrib: Math.round(sum * 100) / 100 }} />
      </div>
    </Card>
  );
}
