import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import ChartTooltip from '../charts/ChartTooltip';
import { CHART_COLORS, monthYearShort, monthLabel, dayLabel, formatPoints, ACTIVE_DOT } from '../../lib/utils';

const AXIS = { fill: '#878D97', fontSize: 11 };
const RULE = { stroke: 'var(--color-text-primary)', strokeOpacity: 0.14, strokeWidth: 1, strokeDasharray: '3 3' };

const SECTORS = [
  { key: 'nonfood', label: 'All non-food credit', total: true },
  { key: 'personal', label: 'Personal loans' },
  { key: 'services', label: 'Services' },
  { key: 'industry', label: 'Industry' },
  { key: 'agriculture', label: 'Agriculture' },
];

/** Where the banks' money goes: deposit against credit growth, and credit growth by sector against a year ago. */
export default function BankCredit({ banks, credit }) {
  const last = banks[banks.length - 1];
  const latest = credit[credit.length - 1];
  const yearAgo = latest && credit.find(r => r.date.slice(0, 7) === `${+latest.date.slice(0, 4) - 1}${latest.date.slice(4, 7)}`);
  const top = Math.max(1, ...SECTORS.map(s => Math.max(latest?.[s.key] ?? 0, yearAgo?.[s.key] ?? 0)));
  if (!last) return null;

  return (
    <Card>
      <SectionHeader eyebrow="Banks" size="sm" style={{ marginBottom: 18 }}
        sub={`Deposits ₹${(last.deposits / 1e5).toFixed(1)}L Cr, loans ₹${(last.credit / 1e5).toFixed(1)}L Cr: ₹${Math.round(last.cd)} lent for every ₹100 deposited · ${dayLabel(last.date, true)}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 2fr)', gap: 32, alignItems: 'start' }}>
        <div>
          <p className="col-head" style={{ marginBottom: 10 }}>Growth on a year earlier, fortnightly</p>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={banks} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} dy={8} tickFormatter={monthYearShort} minTickGap={36} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} tickFormatter={v => `${v}%`} />
              <Tooltip isAnimationActive={false} cursor={RULE} content={<ChartTooltip formatValue={v => `${v.toFixed(1)}%`} />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 12 }} iconType="circle" iconSize={7} />
              <Line dataKey="creditYoY" name="Bank credit" stroke={CHART_COLORS[0]} strokeWidth={1.75} dot={false} activeDot={ACTIVE_DOT} connectNulls isAnimationActive={false} />
              <Line dataKey="depositsYoY" name="Deposits" stroke={CHART_COLORS[1]} strokeWidth={1.75} dot={false} activeDot={ACTIVE_DOT} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
            The fall in July 2024 is the HDFC merger leaving the comparison: a year after it, the merged loans stopped counting as growth.
          </p>
        </div>
        {latest && (
          <div>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 10, gap: 12 }}>
              <p className="col-head">By sector · {monthLabel(latest.date)}</p>
              {yearAgo && <p className="col-head">vs 1Y ago</p>}
            </div>
            {SECTORS.map(s => {
              const now = latest[s.key];
              const then = yearAgo?.[s.key];
              return (
                <div key={s.key} style={{ padding: '9px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-baseline justify-between" style={{ gap: 10, marginBottom: 6 }}>
                    <span className="text-sm" style={{ color: s.total ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{s.label}</span>
                    <span className="figure text-xs" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                      {now != null ? `${now.toFixed(1)}%` : '—'}
                      {now != null && then != null && <span style={{ color: 'var(--color-text-muted)' }}> · {formatPoints(now - then)}</span>}
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--color-bg-input)' }}
                    title={then != null ? `A year ago: ${then.toFixed(1)}%` : undefined}>
                    <div style={{ width: `${Math.max(0, (now ?? 0) / top) * 100}%`, height: '100%', borderRadius: 3, background: s.total ? 'var(--color-text-secondary)' : CHART_COLORS[0] }} />
                    {then != null && <div style={{ position: 'absolute', top: -3, left: `calc(${Math.max(0, then / top) * 100}% - 1px)`, width: 2, height: 12, borderRadius: 1, background: 'var(--color-text-primary)', opacity: 0.55 }} />}
                  </div>
                </div>
              );
            })}
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10 }}>The tick marks a year ago.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
