import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, ACTIVE_DOT, formatPoints } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };
const LINES = [
  { iso: 'IND', name: 'India', color: CHART_COLORS[0] },
  { iso: 'CHN', name: 'China', color: CHART_COLORS[3] },
  { iso: 'USA', name: 'United States', color: CHART_COLORS[1] },
];

/**
 * India's weight in the world: its share of world output since 2000 against China and the US, IMF projections
 * dashed; and who supplies the world's growth in a year.
 */
export default function WorldStanding({ world }) {
  const { imf, contributions, thisYear } = world;
  const years = Object.keys(contributions).map(Number).sort();
  const [year, setYear] = useState(years.includes(thisYear) ? thisYear : years[years.length - 1]);
  const c = contributions[year];

  // Two keys per country: the record up to last year, then IMF projections joined to it.
  const rows = useMemo(() => {
    const all = [...new Set(LINES.flatMap(l => (imf.pppShare?.[l.iso] || []).map(p => p.year)))].sort();
    return all.map(y => {
      const row = { label: String(y) };
      for (const l of LINES) {
        const v = imf.pppShare?.[l.iso]?.find(p => p.year === y)?.value ?? null;
        if (y < thisYear) row[l.iso] = v;
        if (y >= thisYear - 1) row[`${l.iso}p`] = v;
      }
      return row;
    });
  }, [imf, thisYear]);

  const max = Math.max(...(c?.rows || []).map(r => r.share), 1);

  return (
    <Card>
      <SectionHeader eyebrow="India's weight in the world" size="sm" style={{ marginBottom: 18 }}
        sub="Share of world output at purchasing power (what each economy's output would buy at local prices), and who supplies the world's growth · IMF World Economic Outlook"
        action={years.length > 1 && <SegmentedControl size="sm" ariaLabel="Year" value={year} onChange={setYear} options={years.map(y => ({ key: y, label: String(y) }))} />} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)', gap: 32, alignItems: 'start' }}>
        <div>
          <p className="col-head" style={{ marginBottom: 10 }}>Share of world output · dashed from {thisYear} is the IMF's projection</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={24} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} tickFormatter={v => `${v}%`} />
              <ReferenceLine x={String(thisYear)} stroke="var(--color-border-hover)" strokeDasharray="2 3" />
              <Tooltip isAnimationActive={false} cursor={RULE}
                content={({ payload, ...p }) => <ChartTooltip {...p} payload={(payload || []).filter((x, i, a) => x.value != null && a.findIndex(y => y.name === x.name && y.value != null) === i)} formatValue={v => `${v.toFixed(1)}%`} />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7}
                payload={LINES.map(l => ({ value: l.name, type: 'circle', color: l.color, id: l.iso }))} />
              {LINES.map(l => <Line key={l.iso} dataKey={l.iso} name={l.name} stroke={l.color} strokeWidth={l.iso === 'IND' ? 2.25 : 1.5} dot={false} activeDot={ACTIVE_DOT} isAnimationActive={false} />)}
              {LINES.map(l => <Line key={`${l.iso}p`} dataKey={`${l.iso}p`} name={l.name} stroke={l.color} strokeWidth={l.iso === 'IND' ? 2.25 : 1.5} strokeDasharray="4 4" dot={false} activeDot={ACTIVE_DOT} legendType="none" isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {c && (
          <div>
            <p className="col-head" style={{ marginBottom: 10 }}>Who adds the world's {c.world != null ? `${c.world.toFixed(1)}% ` : ''}growth · {year}</p>
            {c.rows.map(r => {
              const india = r.iso === 'IND';
              return (
                <div key={r.iso} style={{ padding: '7px 0', borderBottom: '1px solid var(--color-border-subtle)' }}
                  title={`${r.name} adds ${formatPoints(r.pp, 2)} to world growth`}>
                  <div className="flex items-baseline justify-between" style={{ gap: 10, marginBottom: 5 }}>
                    <span className="text-sm" style={{ color: india ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: india ? 500 : 400 }}>{r.name}</span>
                    <span className="figure text-xs" style={{ color: india ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{r.share.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--color-bg-input)' }}>
                    <div style={{ width: `${Math.max(0, r.share / max) * 100}%`, height: '100%', borderRadius: 3, background: india ? CHART_COLORS[0] : 'var(--color-text-muted)' }} />
                  </div>
                </div>
              );
            })}
            {c.rest?.count > 0 && (
              <div className="flex items-baseline justify-between" style={{ gap: 10, padding: '9px 0' }}>
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{c.rest.count} other countries</span>
                <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.rest.share.toFixed(1)}%</span>
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
              Each country's share of world output times its own growth, as a share of the total. {year >= thisYear ? 'IMF projection.' : ''}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
