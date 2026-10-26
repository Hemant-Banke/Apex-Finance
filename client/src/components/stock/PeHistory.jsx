import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import { MastheadFigure } from '../ui/Masthead';
import ChartTooltip from '../charts/ChartTooltip';
import { RangeBar } from './PricePerformance';
import { monthYearShort } from '../../lib/utils';

/**
 * Is the share cheap or dear against its OWN past? Weekly P/E (close ÷ trailing EPS known
 * that week, `valuation.history` from stockService), its average over the window with a
 * ±1 standard-deviation band, and where today sits. Cheap/dear is not coloured as good or bad.
 */

const WINDOWS = [['1y', '1Y', 1], ['3y', '3Y', 3], ['5y', '5Y', 5], ['10y', '10Y', 10]];
const muted = 'var(--color-text-muted)';
const times = (v) => (v == null ? '—' : `${v.toFixed(1)}×`);

function verdict(name, cur, w, years) {
  if (cur == null || w?.vsAvg == null) return null;
  const span = `${years}-year`;
  const gap = Math.abs(w.vsAvg).toFixed(0);
  const where = Math.abs(w.vsAvg) < 5 ? `in line with its ${span} average of ${times(w.avg)}`
    : `${gap}% ${w.vsAvg < 0 ? 'below' : 'above'} its ${span} average of ${times(w.avg)}`;
  const rank = w.percentile <= 0 ? `the lowest it has been in ${years} year${years > 1 ? 's' : ''}`
    : w.percentile >= 100 ? `the highest it has been in ${years} year${years > 1 ? 's' : ''}`
    : `higher than on ${w.percentile}% of weeks in that time`;
  return `At ${times(cur)}, ${name} trades ${where} — ${rank}.`;
}

export default function PeHistory({ history, name }) {
  const available = WINDOWS.filter(([k]) => history?.windows?.[k]);
  const [k, setK] = useState(() => (available.find(([x]) => x === '5y') || available[available.length - 1])?.[0]);
  const win = available.find(([x]) => x === k) || available[available.length - 1];

  const data = useMemo(() => {
    if (!history || !win) return [];
    const from = new Date();
    from.setFullYear(from.getFullYear() - win[2]);
    const cut = from.toISOString().slice(0, 10);
    return history.series.filter(p => p.date >= cut);
  }, [history, win]);

  if (!history || !win) return null;
  const w = history.windows[win[0]];
  const cur = history.current;
  const line = verdict(name, cur, w, win[2]);

  return (
    <Card>
      <SectionHeader eyebrow="Historical P/E" size="sm"
        sub="Price ÷ the last 12 months' earnings, week by week — cheap or dear against its own past"
        action={available.length > 1 && <SegmentedControl size="sm" ariaLabel="P/E window" value={win[0]} onChange={setK} options={available.map(([key, label]) => ({ key, label }))} />}
        style={{ marginBottom: 18 }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, alignItems: 'start', marginBottom: 18 }}>
        <MastheadFigure label="P/E today" value={times(cur)} />
        <MastheadFigure label={`${win[1]} average`} value={times(w.avg)}
          sub={<p className="text-xs" style={{ color: muted }}>Median {times(w.median)}</p>} />
        <MastheadFigure label="Versus average" value={w.vsAvg == null ? '—' : `${w.vsAvg > 0 ? '+' : '−'}${Math.abs(w.vsAvg).toFixed(0)}%`}
          sub={<p className="text-xs" style={{ color: muted }}>{w.vsAvg == null ? '' : w.vsAvg < 0 ? 'Cheaper than usual' : 'Dearer than usual'}</p>} />
        <div style={{ minWidth: 0 }}>
          <p className="text-xs" style={{ color: muted }}>{win[1]} range</p>
          <RangeBar low={w.min} high={w.max} value={Math.min(Math.max(cur ?? w.min, w.min), w.max)} fmt={times} />
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
            tickFormatter={monthYearShort} minTickGap={48} />
          <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} width={40}
            domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}×`} />
          {/* The usual range: one standard deviation either side of the average. */}
          <ReferenceArea y1={w.avg - w.sd} y2={w.avg + w.sd} fill="var(--color-text-primary)" fillOpacity={0.04} stroke="none" ifOverflow="hidden" />
          <ReferenceLine y={w.avg} stroke="var(--color-text-muted)" strokeDasharray="4 4"
            label={{ value: `Avg ${times(w.avg)}`, position: 'insideTopLeft', fill: '#878D97', fontSize: 11 }} />
          <Tooltip cursor={{ stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeDasharray: '3 3' }} isAnimationActive={false}
            content={<ChartTooltip formatValue={times} valueLabel="P/E" />} />
          <Line dataKey="pe" name="P/E" type="monotone" stroke="var(--color-accent)" strokeWidth={2} dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-bg-card)' }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

      {line && <p className="text-sm" style={{ color: 'var(--color-text-secondary)', marginTop: 14, lineHeight: 1.55 }}>{line}</p>}
      <p className="text-xs" style={{ color: muted, marginTop: 6, lineHeight: 1.5 }}>
        The shaded band is the usual range — one standard deviation either side of the average. Each week uses the earnings filed by then; weeks after a loss have no P/E.
      </p>
    </Card>
  );
}
