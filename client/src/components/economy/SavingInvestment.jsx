import { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import BandCursor from '../charts/BandCursor';
import { CHART_COLORS, formatPoints } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const PARTS = [
  { key: 'households', name: 'Households', color: CHART_COLORS[1] },
  { key: 'companies', name: 'Private companies', color: CHART_COLORS[2] },
  { key: 'state', name: 'Government & public sector', color: CHART_COLORS[4] },
];

/** Who in India saves, against what the country invests in fixed capital. The difference is what must come from abroad. */
export default function SavingInvestment({ saving }) {
  const rows = useMemo(() => saving.map(y => ({
    label: y.fy, households: y.households,
    companies: (y.corporates ?? 0) + (y.finCorporates ?? 0),
    state: (y.publicCorps ?? 0) + (y.publicFin ?? 0) + (y.government ?? 0),
    total: y.total, invest: y.invest,
  })), [saving]);
  const last = rows[rows.length - 1];
  if (!last) return null;
  const r1 = (v) => Math.round(v * 10) / 10;

  return (
    <Card>
      <SectionHeader eyebrow="Who saves, against what is invested" size="sm" style={{ marginBottom: 18 }}
        sub="Gross saving by sector and fixed investment, each as a share of GDP, by fiscal year · MoSPI. Investment beyond what the country saves has to be met by foreign money." />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 2fr)', gap: 32, alignItems: 'start' }}>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
            <ReferenceLine y={0} stroke="var(--color-border-hover)" />
            <Tooltip isAnimationActive={false} cursor={<BandCursor count={rows.length} />}
              content={<ChartTooltip formatValue={v => `${v.toFixed(1)}% of GDP`} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            {PARTS.map(p => <Bar key={p.key} dataKey={p.key} name={p.name} stackId="s" fill={p.color} maxBarSize={48} isAnimationActive={false} />)}
            <Line dataKey="invest" name="Fixed investment" stroke="var(--color-text-primary)" strokeWidth={1.5}
              dot={{ r: 3, strokeWidth: 0, fill: 'var(--color-text-primary)' }} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 72px 72px', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
            {['', 'Saved', 'Invested', 'Spare'].map(h => <span key={h} className="col-head" style={{ textAlign: h ? 'right' : 'left' }}>{h}</span>)}
          </div>
          {[...rows].reverse().map(y => (
            <div key={y.label} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 72px 72px', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{y.label}</span>
              <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{y.total?.toFixed(1)}%</span>
              <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{y.invest?.toFixed(1)}%</span>
              <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{y.total != null && y.invest != null ? formatPoints(y.total - y.invest) : '—'}</span>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
            In {last.label} households saved {r1(last.households)}% of GDP, {Math.round(last.households / last.total * 100)}% of all saving; the government {last.state < 0 ? 'and public sector together dissaved' : 'and public sector saved'} {r1(Math.abs(last.state))}%.
            Spare is saving left after fixed investment; inventories and valuables (gold) take part of it, so it is not the current account.
          </p>
        </div>
      </div>
    </Card>
  );
}
