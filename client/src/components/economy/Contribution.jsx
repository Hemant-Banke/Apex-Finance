import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Legend } from 'recharts';
import ChartTooltip from '../charts/ChartTooltip';
import BandCursor from '../charts/BandCursor';
import DivergingBar from '../ui/DivergingBar';
import { formatPoints } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const LINE = 'var(--color-text-primary)';

/**
 * Growth taken apart, quarter by quarter: each part's contribution in percentage points, stacked, with the
 * total's growth as the line. Clicking a quarter selects it for the table beneath.
 */
export function ContributionChart({ rows, parts, line, selected, onSelect, height = 270 }) {
  const pick = (e) => { if (e?.activeTooltipIndex != null) onSelect?.(+e.activeTooltipIndex); };
  const sel = rows[selected]?.label;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 0 }} onClick={pick} style={{ cursor: onSelect ? 'pointer' : undefined }}>
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} dy={8} minTickGap={14} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
        {sel && <ReferenceArea x1={sel} x2={sel} fill="var(--color-text-primary)" fillOpacity={0.06} ifOverflow="visible" />}
        <ReferenceLine y={0} stroke="var(--color-border-hover)" />
        <Tooltip isAnimationActive={false} cursor={<BandCursor count={rows.length} />}
          content={<ChartTooltip formatValue={v => formatPoints(v, 2)} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
        {parts.map(p => <Bar key={p.key} dataKey={p.key} name={p.name} stackId="c" fill={p.color} maxBarSize={26} isAnimationActive={false} />)}
        <Line dataKey={line.key} name={line.name} stroke={LINE} strokeWidth={1.5}
          dot={{ r: 2.5, strokeWidth: 0, fill: LINE }} activeDot={{ r: 4, strokeWidth: 0 }} /* no ring: it cuts into the bars */ isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const COLS = '1fr 64px 64px 150px';

/** One quarter's parts as a ledger: share, own growth, and contribution as a bar from a shared zero. Rows sum to the total. */
export function ContributionTable({ rows, total, shareLabel = 'Share', growthLabel = 'Growth' }) {
  const max = Math.max(...rows.map(r => Math.abs(r.contrib ?? 0)), 0.01);
  const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span className="col-head" />
        <span className="col-head" style={{ textAlign: 'right' }}>{shareLabel}</span>
        <span className="col-head" style={{ textAlign: 'right' }}>{growthLabel}</span>
        <span className="col-head" style={{ textAlign: 'right' }}>Added to growth</span>
      </div>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
          </span>
          <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{pct(r.share)}</span>
          <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{pct(r.yoy)}</span>
          <span style={{ display: 'grid', gridTemplateColumns: '1fr 62px', gap: 8, alignItems: 'center' }}>
            <DivergingBar value={r.contrib} max={max} height={6} />
            <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{r.contrib == null ? '—' : formatPoints(r.contrib, 2)}</span>
          </span>
        </div>
      ))}
      {total && (
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '10px 0' }}>
          <span className="text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{total.label}</span>
          <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{total.share != null ? pct(total.share) : ''}</span>
          <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{pct(total.yoy)}</span>
          <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>{formatPoints(total.contrib, 2)}</span>
        </div>
      )}
    </div>
  );
}
