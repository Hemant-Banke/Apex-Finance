import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisCompact, compactIfLarge } from '../../lib/utils';
import { TooltipPanel } from '../charts/ChartTooltip';

function Tip({ active, payload, fireNumber }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipPanel minWidth={180}>
      <div style={{ padding: '6px 12px', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Age {p.age} · {p.retired ? 'drawing down' : 'building'}</span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        <p className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{compactIfLarge(Math.round(p.value))}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
          {fireNumber ? `${Math.round((p.value / fireNumber) * 100)}% of the FIRE number` : ''}
        </p>
      </div>
    </TooltipPanel>
  );
}

/** The corpus by age in today's rupees: built until retirement, drawn on after. */
export default function ProjectionChart({ points, fireNumber, marks = [], endAge }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={points} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Ages are read off the journey strip beneath, so the axis itself is hidden. */}
        <XAxis dataKey="age" type="number" domain={[points[0]?.age ?? 'dataMin', endAge ?? 'dataMax']} hide />
        <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} width={56} orientation="left"
          tickFormatter={v => axisCompact(v, '₹')} />
        <Tooltip content={<Tip fireNumber={fireNumber} />} cursor={{ stroke: 'var(--color-border-hover)' }} isAnimationActive={false} />
        {Number.isFinite(fireNumber) && (
          <ReferenceLine y={fireNumber} stroke="var(--color-accent)" strokeDasharray="4 4" strokeOpacity={0.7}
            label={{ value: 'FIRE number', position: 'insideTopLeft', fill: '#C9A96A', fontSize: 10 }} />
        )}
        {/* One line per milestone; it continues into the journey strip below and ends on its dot. */}
        {marks.slice(1).map(mk => (
          <ReferenceLine key={mk.label} x={mk.age} stroke={mk.tone} strokeOpacity={0.55} strokeDasharray="3 3" ifOverflow="extendDomain" />
        ))}
        <Area dataKey="value" type="monotone" stroke="var(--color-accent)" strokeWidth={1.8} fill="url(#planFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
