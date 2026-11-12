import { useId, useMemo } from 'react';
import { ComposedChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, formatCrore, axisCompact, monthYearShort, dayLabel } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };
const SURPLUS = CHART_COLORS[2];
const DEFICIT = 'var(--color-chart-warm)';

/** The banking system's spare cash day by day, beside how fast money and cash in hand are growing. */
export default function LiquidityMoney({ liquidity, money }) {
  // RBI reports its own net injection; the system's surplus is the other side of it.
  const days = useMemo(() => liquidity.map((p, i) => {
    const win = liquidity.slice(Math.max(0, i - 29), i + 1);
    return { date: p.date, surplus: -p.value, avg: -win.reduce((a, q) => a + q.value, 0) / win.length };
  }), [liquidity]);
  const gid = useId();
  // Hard stop at zero: surplus above in teal, deficit below in amber.
  const vals = days.map(d => d.surplus);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const zeroAt = hi === lo ? 1 : hi / (hi - lo);
  const last = days[days.length - 1];
  const lastMoney = money[money.length - 1];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
      <Card>
        <SectionHeader eyebrow="Liquidity" size="sm" style={{ marginBottom: 16 }}
          sub={last ? `Banks ${last.surplus >= 0 ? 'parked' : 'borrowed'} ${formatCrore(Math.abs(last.surplus))} ${last.surplus >= 0 ? 'with' : 'from'} the RBI on ${dayLabel(last.date, true)} · above zero is a surplus` : 'Daily, RBI'} />
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zeroAt} stopColor={SURPLUS} />
                <stop offset={zeroAt} stopColor={DEFICIT} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} tickFormatter={monthYearShort} minTickGap={36} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={v => axisCompact(v)} />
            <ReferenceLine y={0} stroke="var(--color-border-hover)" />
            <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={v => formatCrore(v, { signed: true })} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            <Area dataKey="surplus" name="Each day" type="linear" stroke={`url(#${gid})`} strokeWidth={1} fill={`url(#${gid})`} fillOpacity={0.22} legendType="none" isAnimationActive={false} />
            <Line dataKey="avg" name="30-day average" stroke="var(--color-text-primary)" strokeOpacity={0.8} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionHeader eyebrow="Money supply" size="sm" style={{ marginBottom: 16 }}
          sub={lastMoney ? `Broad money (M3) ₹${(lastMoney.m3 / 1e5).toFixed(1)}L Cr, up ${lastMoney.m3YoY}% on a year · fortnightly, RBI` : 'Fortnightly, RBI'} />
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={money} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} tickFormatter={monthYearShort} minTickGap={36} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} tickFormatter={v => `${v}%`} />
            <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={v => `${v.toFixed(1)}%`} />} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
            <Line dataKey="m3YoY" name="Broad money (M3)" stroke={CHART_COLORS[1]} strokeWidth={1.75} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            <Line dataKey="currencyYoY" name="Currency with the public" stroke={CHART_COLORS[0]} strokeWidth={1.75} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
