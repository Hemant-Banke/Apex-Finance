import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, ACTIVE_DOT } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };
const pct = (v) => `${v.toFixed(1)}%`;
const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

// What each measure says about an economy, and where it comes from.
const METRICS = [
  { key: 'growth', src: 'imf', label: 'Growth', fmt: pct, sub: 'Real GDP growth. The pace capital is buying into.' },
  { key: 'invest', src: 'wb', label: 'Investment', fmt: pct, sub: 'Gross fixed capital formation, % of GDP: how much of its output an economy spends building more.' },
  { key: 'savings', src: 'wb', label: 'Savings', fmt: pct, sub: 'Gross national saving, % of GDP: the money it has of its own to invest. Investing more than this needs foreign money.' },
  { key: 'manufacturing', src: 'wb', label: 'Manufacturing', fmt: pct, sub: 'Manufacturing, % of GDP: how much of the economy is factories.' },
  { key: 'fdiPct', src: 'wb', label: 'FDI', fmt: pct, sub: 'Foreign direct investment received, net, % of GDP: long-term foreign capital choosing the country.' },
  { key: 'ca', src: 'imf', label: 'Current account', fmt: pct, sub: 'Current account, % of GDP. Below zero the economy spends more abroad than it earns and must borrow or attract the difference.' },
  { key: 'inflation', src: 'imf', label: 'Inflation', fmt: pct, sub: 'Consumer price inflation, average for the year.' },
  { key: 'perCapita', src: 'imf', label: 'Income', fmt: usd, sub: 'GDP per person in US dollars: how far an economy still has to grow.' },
];
const HISTORY = [
  { iso: 'IND', color: CHART_COLORS[0], width: 2.25 },
  { iso: 'CHN', color: CHART_COLORS[3] },
  { iso: 'USA', color: CHART_COLORS[1] },
  { iso: 'EME', color: CHART_COLORS[2] },
  { iso: 'WLD', color: 'var(--color-text-secondary)' },
];

/** India beside the economies global capital chooses between, one measure at a time, now and over time. */
export default function PeerCompare({ world }) {
  const [key, setKey] = useState('growth');
  const m = METRICS.find(x => x.key === key);
  const src = useMemo(() => world[m.src]?.[key] || {}, [world, m, key]);
  const names = useMemo(() => Object.fromEntries([...world.peers, ...world.groups].map(p => [p.iso, p.name])), [world]);
  const year = world.thisYear;

  // IMF figures are this year's (estimate); World Bank figures are each economy's latest year.
  const rows = useMemo(() => Object.keys(names).map(iso => {
    const arr = src[iso] || [];
    const p = m.src === 'imf' ? arr.find(x => x.year === year) : arr[arr.length - 1];
    return p ? { iso, name: names[iso], value: p.value, year: p.year, group: world.groups.some(g => g.iso === iso) } : null;
  }).filter(Boolean).sort((a, b) => b.value - a.value), [src, m, year, names, world]);

  const history = useMemo(() => {
    const years = [...new Set(HISTORY.flatMap(h => (src[h.iso] || []).map(p => p.year)))].sort();
    return years.map(y => ({ label: String(y), ...Object.fromEntries(HISTORY.map(h => [h.iso, src[h.iso]?.find(p => p.year === y)?.value ?? null])) }));
  }, [src]);

  const signed = rows.some(r => r.value < 0);
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-9);
  const latestYears = [...new Set(rows.map(r => r.year))].sort();
  const india = rows.find(r => r.iso === 'IND');
  const rank = rows.filter(r => !r.group).findIndex(r => r.iso === 'IND') + 1;
  const ranked = rows.filter(r => !r.group).length;

  return (
    <Card>
      <SectionHeader eyebrow="India against its peers" size="sm" style={{ marginBottom: 14 }}
        sub={`${m.sub} ${m.src === 'imf' ? `IMF, ${year} estimate.` : `World Bank, latest year (${latestYears.length > 1 ? `${latestYears[0]}–${latestYears[latestYears.length - 1]}` : latestYears[0]}).`}`} />
      <SegmentedControl size="sm" ariaLabel="Measure" value={key} onChange={setKey}
        options={METRICS.map(x => ({ key: x.key, label: x.label }))} style={{ marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 2fr) minmax(0, 3fr)', gap: 32, alignItems: 'start' }}>
        <div>
          {india && <p className="col-head" style={{ marginBottom: 10 }}>India ranks {rank} of {ranked}</p>}
          {rows.map(r => {
            const w = Math.abs(r.value) / max * (signed ? 50 : 100);
            const isIndia = r.iso === 'IND';
            return (
              <div key={r.iso} className="flex items-center" style={{ gap: 12, padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}
                title={`${r.name}: ${m.fmt(r.value)} (${r.year})`}>
                <span className="text-sm" style={{
                  width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: isIndia ? 'var(--color-text-primary)' : r.group ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                  fontWeight: isIndia ? 500 : 400, fontStyle: r.group ? 'italic' : 'normal',
                }}>{r.name}</span>
                <div style={{ flex: 1, position: 'relative', height: 6 }}>
                  {signed && <span style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--color-border-hover)' }} />}
                  <span style={{
                    position: 'absolute', top: 0, height: '100%', borderRadius: 3,
                    left: signed ? (r.value >= 0 ? '50%' : `${50 - w}%`) : 0, width: `${Math.max(w, 0.6)}%`,
                    // India solid gold, a group as an outline, every other economy a quiet fill.
                    background: isIndia ? CHART_COLORS[0] : r.group ? 'transparent' : 'color-mix(in srgb, var(--color-text-muted) 55%, transparent)',
                    boxShadow: r.group ? 'inset 0 0 0 1px var(--color-text-muted)' : 'none',
                  }} />
                </div>
                <span className="figure text-xs" style={{ width: 64, textAlign: 'right', color: isIndia ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{m.fmt(r.value)}</span>
              </div>
            );
          })}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            Groups in italics: {m.src === 'imf' ? 'the IMF’s advanced and emerging & developing economies' : 'the World Bank’s high and low & middle income economies'}.
          </p>
        </div>
        <div>
          <p className="col-head" style={{ marginBottom: 10 }}>Over time{m.src === 'imf' ? ` · from ${year} the IMF's projection` : ''}</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={24} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={m.key === 'perCapita' ? 56 : 40} domain={['auto', 'auto']}
                tickFormatter={v => (m.key === 'perCapita' ? `$${(v / 1000).toFixed(0)}k` : `${v}%`)} />
              {signed && <ReferenceLine y={0} stroke="var(--color-border-hover)" />}
              {m.src === 'imf' && <ReferenceLine x={String(year)} stroke="var(--color-border-hover)" strokeDasharray="2 3" />}
              <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={m.fmt} />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
              {HISTORY.filter(h => src[h.iso]).map(h => (
                <Line key={h.iso} dataKey={h.iso} name={names[h.iso]} stroke={h.color} strokeWidth={h.width || 1.5}
                  dot={false} activeDot={ACTIVE_DOT} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}
