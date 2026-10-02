import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import ChartTooltip from './ChartTooltip';
import { MONTHS_SHORT, axisCompact, pnlColor } from '../../lib/utils';

/** "2026-03" → "Mar" (and "Jan 26" at a year's turn, so a 24-month axis stays legible). */
const monthTick = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return key;
  return m[2] === '01' ? `Jan ${m[1].slice(2)}` : MONTHS_SHORT[+m[2] - 1];
};

/** A net-cashflow point, coloured by its sign: kept is a gain, overspent is a loss. */
function NetDot({ cx, cy, payload }) {
  if (cx == null || cy == null || payload?.net == null) return null;
  if (!payload.income && !payload.expense) return null;   // an empty month is not "broke even"
  return <circle cx={cx} cy={cy} r={3} fill={pnlColor(payload.net, { flat: 'var(--color-text-secondary)' })}
    stroke="var(--color-bg-card)" strokeWidth={1.5} />;
}

/**
 * The hovered month, as a soft band behind its bars rather than a line through them.
 *
 * In a ComposedChart Recharts draws the tooltip cursor as a full-height hairline, which
 * cut straight through the bars and the net line and read as a fourth series. A band the
 * width of the month's slot says "this month" without drawing over the data. `count` is
 * the number of slots, so the band's width follows the category spacing.
 */
function MonthBand({ points, top, height, left, width, count }) {
  const x = points?.[0]?.x;
  if (x == null || !count) return null;
  const slot = width / count;
  const w = Math.max(14, slot * 0.78);
  // Clamped into the plot so the first and last months' bands do not overhang it.
  const bx = Math.min(Math.max(x - w / 2, left), left + width - w);
  return <rect x={bx} y={top} width={w} height={height} rx={6}
    fill="var(--color-text-primary)" fillOpacity={0.045} pointerEvents="none" />;
}

/**
 * Monthly cashflow: income and expense bars with net cashflow as a line on the SAME axis.
 * Shared by Analytics (above its month-by-month ledger) and the Dashboard.
 *
 * `rows` are `/dashboard/income-expense` months. A month with no activity has no
 * cashflow at all, not a cashflow of zero: as 0, the month you are a day into dragged
 * the net line down to the axis as if it had broken even; as null the line stops.
 */
export default function CashflowChart({ rows, height = 260 }) {
  const chartRows = rows.map(m => (m.income || m.expense ? m : { ...m, net: null }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartRows} barGap={4} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
          tickFormatter={monthTick} interval="preserveStartEnd" />
        <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false}
          tickFormatter={v => axisCompact(v, '₹')} width={50} />
        <Tooltip cursor={<MonthBand count={chartRows.length} />} content={<ChartTooltip />} isAnimationActive={false} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
        {/* A month that spent more than it earned has a NEGATIVE cashflow, so the
            zero line is drawn — without it a dot below the bars' floor reads as
            "small", not "in the red". */}
        <ReferenceLine y={0} stroke="var(--color-border-hover)" />
        {/* Income and expense are the same measure on one scale, so they share an
            axis honestly. Green/red here are STATUS, not category identity. */}
        <Bar dataKey="income"  name="Income"  fill="var(--color-success)" radius={[4,4,0,0]} maxBarSize={22} />
        <Bar dataKey="expense" name="Expense" fill="var(--color-danger)"  radius={[4,4,0,0]} maxBarSize={22} />
        {/* Net cashflow is the SAME unit (rupees a month) as the bars, so — unlike the
            savings-rate line this card once carried on a second axis — it rides the
            one axis already there. Neutral ink, so it reads as the difference OF the
            two bars rather than a third thing; each dot takes the sign's colour. */}
        <Line dataKey="net" name="Net cashflow" type="monotone" stroke="var(--color-text-primary)"
          strokeWidth={1.5} strokeOpacity={0.75} isAnimationActive={false}
          dot={<NetDot />} activeDot={{ r: 4, fill: 'var(--color-text-primary)', strokeWidth: 0 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
