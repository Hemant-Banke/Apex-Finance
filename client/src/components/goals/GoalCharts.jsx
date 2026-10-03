import { Area, Bar, BarChart, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisCompact, compactIfLarge, CHART_COLORS } from '../../lib/utils';
import { ASSETS, ASSET_KEYS } from '../../lib/goals';
import { TooltipPanel } from '../charts/ChartTooltip';

const money = (v) => compactIfLarge(Math.round(v || 0));
const AXIS = { fill: '#878D97', fontSize: 11 };

// Gold takes the gold slot; equity and debt the next two hues, fixed so every goal agrees.
export const ASSET_COLORS = { gold: CHART_COLORS[0], equity: CHART_COLORS[1], debt: CHART_COLORS[2] };

function Head({ children }) {
  return (
    <div style={{ padding: '6px 12px', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{children}</span>
    </div>
  );
}

function Line2({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: 14, marginTop: 3 }}>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="figure text-xs" style={{ color: tone || 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );
}

function FanTip({ active, payload, required }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipPanel minWidth={200}>
      <Head>{p.label}</Head>
      <div style={{ padding: '8px 12px' }}>
        <Line2 label="Good markets (1 in 10)" value={money(p.p90)} />
        <Line2 label="Middle outcome" value={money(p.p50)} tone="var(--color-accent)" />
        <Line2 label="Poor markets (1 in 10)" value={money(p.p10)} />
        {p.last && <Line2 label="Needed" value={money(required)} />}
      </div>
    </TooltipPanel>
  );
}

/** The range of outcomes year by year: 10th–90th percentile band, the median, and the corpus needed. */
export function GoalFanChart({ bands, required, startYear }) {
  const data = bands.map((b, i) => ({
    ...b, band: [b.p10, b.p90], last: i === bands.length - 1,
    x: b.month / 12, label: b.month === 0 ? 'Today' : `${startYear + Math.round(b.month / 12)} · year ${+(b.month / 12).toFixed(1)}`,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <XAxis dataKey="x" type="number" domain={[0, 'dataMax']} tick={AXIS} axisLine={false} tickLine={false}
          tickFormatter={v => (v === 0 ? 'Now' : `${startYear + Math.round(v)}`)} allowDecimals={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={v => axisCompact(v, '₹')} />
        <Tooltip content={<FanTip required={required} />} cursor={{ stroke: 'var(--color-border-hover)' }} isAnimationActive={false} />
        <ReferenceLine y={required} stroke="var(--color-text-secondary)" strokeDasharray="4 4" strokeOpacity={0.8}
          label={{ value: 'Needed', position: 'insideTopLeft', fill: '#878D97', fontSize: 10 }} ifOverflow="extendDomain" />
        <Area dataKey="band" stroke="none" fill="var(--color-accent)" fillOpacity={0.14} isAnimationActive={false} />
        <Line dataKey="p50" stroke="var(--color-accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function MixTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipPanel minWidth={170}>
      <Head>{p.label}</Head>
      <div style={{ padding: '8px 12px' }}>
        {ASSET_KEYS.map(k => <Line2 key={k} label={ASSETS[k].label} value={`${Math.round(p[k] * 100)}%`} />)}
      </div>
    </TooltipPanel>
  );
}

/** The asset mix year by year — the glide path from growth toward safety. */
export function GlidePathChart({ rows }) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={rows} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
        <XAxis dataKey="tick" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={v => `${v * 100}%`} />
        <Tooltip content={<MixTip />} cursor={{ fill: 'var(--color-bg-elevated)', opacity: 0.4 }} isAnimationActive={false} />
        {ASSET_KEYS.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="mix" fill={ASSET_COLORS[k]} isAnimationActive={false}
            radius={i === ASSET_KEYS.length - 1 ? [3, 3, 0, 0] : 0} stroke="var(--color-bg-card)" strokeWidth={1} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function NeedTip({ active, payload, goals }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows = goals.filter(g => p[g.id] > 0);
  return (
    <TooltipPanel minWidth={190}>
      <Head>{p.year}</Head>
      <div style={{ padding: '8px 12px' }}>
        {rows.map(g => <Line2 key={g.id} label={g.name} value={money(p[g.id])} />)}
        {rows.length > 1 && <Line2 label="Total" value={money(p.total)} tone="var(--color-accent)" />}
      </div>
    </TooltipPanel>
  );
}

/** When the money is needed: each payout year, stacked by goal in its own colour. */
export function NeedsChart({ data, goals }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
        <XAxis dataKey="year" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={v => axisCompact(v, '₹')} />
        <Tooltip content={<NeedTip goals={goals} />} cursor={{ fill: 'var(--color-bg-elevated)', opacity: 0.4 }} isAnimationActive={false} />
        {goals.map(g => (
          <Bar key={g.id} dataKey={g.id} stackId="need" fill={g.color} isAnimationActive={false}
            stroke="var(--color-bg-card)" strokeWidth={1} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
