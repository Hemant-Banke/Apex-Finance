import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency, CHART_COLORS } from '../../lib/utils';

const TYPE_LABEL = {
  stock: 'Stock', etf: 'ETF', crypto: 'Crypto', mutual_fund: 'Mutual Fund',
  bond: 'Bond', commodity: 'Commodity', gold: 'Gold', fd: 'Fixed Deposit',
  epf_nps: 'EPF / NPS', other: 'Other'
};

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '';
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border-hover)',
      borderRadius: 8, padding: '10px 14px',
      fontSize: '0.8125rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
    }}>
      <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>{d.name}</p>
      <p style={{ color: d.payload.fill, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(d.value)}</p>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 2, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
        {d.payload.pct}% of total
      </p>
    </div>
  );
}

/**
 * HoldingsDonut
 *
 * Props:
 *   holdings  — array of { symbol, name, type, qty, totalInvested }
 *   title     — section title
 *   height    — chart height (default 220)
 */
export default function HoldingsDonut({ holdings = [], title = 'Holdings', height = 220 }) {
  const [view, setView] = useState('symbol'); // 'symbol' | 'type'

  // Filter to positive totalInvested
  const active = holdings.filter(h => (h.totalInvested || 0) > 0);
  if (active.length === 0) return null;

  const total = active.reduce((s, h) => s + h.totalInvested, 0);

  // Aggregate by type
  const byType = {};
  active.forEach(h => {
    const t = h.type || 'other';
    if (!byType[t]) byType[t] = { name: TYPE_LABEL[t] || cap(t), value: 0 };
    byType[t].value += h.totalInvested;
  });

  const symbolData = active
    .sort((a, b) => b.totalInvested - a.totalInvested)
    .map((h, i) => ({
      name:  h.symbol,
      label: h.name,
      value: h.totalInvested,
      pct:   ((h.totalInvested / total) * 100).toFixed(1),
      fill:  CHART_COLORS[i % CHART_COLORS.length]
    }));

  const typeData = Object.entries(byType)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([, v], i) => ({
      name:  v.name,
      value: v.value,
      pct:   ((v.value / total) * 100).toFixed(1),
      fill:  CHART_COLORS[i % CHART_COLORS.length]
    }));

  const chartData = view === 'symbol' ? symbolData : typeData;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p className="heading-sm">{title}</p>
        <div className="pill-group" style={{ scale: '0.9', transformOrigin: 'right' }}>
          <button type="button" onClick={() => setView('symbol')} className={`pill-item ${view === 'symbol' ? 'active' : ''}`}>By Asset</button>
          <button type="button" onClick={() => setView('type')}   className={`pill-item ${view === 'type'   ? 'active' : ''}`}>By Type</button>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Donut chart */}
        <div style={{ flex: '0 0 auto' }}>
          <ResponsiveContainer width={height} height={height}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%" cy="50%"
                innerRadius={height * 0.28}
                outerRadius={height * 0.44}
                paddingAngle={chartData.length > 1 ? 2 : 0}
                dataKey="value"
                stroke="none"
                isAnimationActive={false}
              >
                {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} isAnimationActive={false} wrapperStyle={{ transition: 'none' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
          {chartData.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.fill, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </p>
                  {view === 'symbol' && chartData[i]?.label && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {symbolData[i]?.label}
                    </p>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                  {formatCurrency(d.value)}
                </p>
                <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{d.pct}%</p>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Total invested</span>
            <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
