import { useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, monthYearShort, dayLabel } from '../../lib/utils';
import { usdBn } from '../../lib/economy';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };

/** The RBI's war chest (weekly, by what it holds) beside the rupee it defends. */
export default function ReservesRupee({ reserves, rupee }) {
  const rows = useMemo(() => reserves.map(r => ({
    date: r.date,
    fca: r.fca != null ? r.fca / 1000 : null,
    gold: r.gold != null ? r.gold / 1000 : null,
    other: ((r.sdr || 0) + (r.imf || 0)) / 1000,
  })), [reserves]);
  const last = reserves[reserves.length - 1];
  const goldShare = last?.gold && last?.total ? (last.gold / last.total) * 100 : null;
  const lastRupee = rupee[rupee.length - 1];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
      <Card>
        <SectionHeader eyebrow="Forex reserves" size="sm" style={{ marginBottom: 16 }}
          sub={last ? `${usdBn(last.total / 1000)} on ${dayLabel(last.date, true)}${goldShare ? ` · ${goldShare.toFixed(1)}% in gold` : ''} · weekly, RBI` : 'Weekly, RBI'} />
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} tickFormatter={monthYearShort} minTickGap={36} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={x => `$${x}B`} />
            <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={x => usdBn(x)} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            <Area dataKey="fca" name="Foreign currency" stackId="r" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.25} isAnimationActive={false} />
            <Area dataKey="gold" name="Gold" stackId="r" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.35} isAnimationActive={false} />
            <Area dataKey="other" name="SDRs & IMF" stackId="r" stroke="var(--color-text-muted)" fill="var(--color-text-muted)" fillOpacity={0.2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionHeader eyebrow="The rupee" size="sm" style={{ marginBottom: 16 }}
          sub={lastRupee ? `₹${lastRupee.value.toFixed(2)} per US dollar · higher is a weaker rupee` : 'Rupees per US dollar'} />
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={rupee} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} tickFormatter={monthYearShort} minTickGap={36} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} tickFormatter={x => `₹${x}`} />
            <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={x => `₹${x.toFixed(2)}`} valueLabel="₹ per $" />} />
            <Line dataKey="value" stroke={CHART_COLORS[2]} strokeWidth={1.75} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
