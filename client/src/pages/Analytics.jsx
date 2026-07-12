import { useState, useEffect } from 'react';
import { dashboardAPI } from '../lib/api';
import { getCategoryMap, describeCategory } from '../lib/categoryNames';
import { formatCurrency, CHART_COLORS } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import ChartTooltip from '../components/charts/ChartTooltip';
import HoldingsDonut from '../components/charts/HoldingsDonut';
import AssetPricePanel from '../components/charts/AssetPricePanel';


function Empty({ text }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 260 }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{text}</p>
    </div>
  );
}

export default function Analytics() {
  const toast = useToast();
  const [ie,       setIe]       = useState([]);
  const [aa,       setAa]       = useState([]);
  const [ec,       setEc]       = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const range = 12;

  useEffect(() => { load(); }, [range]);

  const load = async () => {
    setLoading(true);
    try {
      const [b, c, d, h, cats] = await Promise.all([
        dashboardAPI.getIncomeExpense(range),
        dashboardAPI.getAssetAllocation(),
        dashboardAPI.getExpenseCategories(range),
        dashboardAPI.getHoldings(),
        getCategoryMap(),
      ]);
      setIe(b.data);
      // Asset allocation groups by asset TYPE (a plain slug), so de-slugging is right.
      setAa(c.data.map(x => ({
        ...x,
        name: x._id ? x._id.replace('_', ' ').replace(/\b\w/g, ch => ch.toUpperCase()) : 'Other',
      })));
      // Expense categories group by category CODE. A code is an internal handle, not a
      // label — prettifying it printed "Tp other exp/ts misc exp". Look up the real name.
      setEc(d.data.map(x => ({
        ...x,
        name: x._id ? describeCategory(x._id, cats).label : 'Uncategorised',
        emoji: x._id ? describeCategory(x._id, cats).emoji : '',
      })));
      setHoldings(h.data);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load analytics'); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: '60vh' }}>
      <div className="spinner" />
    </div>
  );

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="heading-sm mb-2">Analytics</p>
          <h1 className="heading-lg">Financial Insights</h1>
        </div>
      </div>

      {/* Net Worth — daily store, full width */}
      <PriceGrapher height={300} emptyText="Add transactions to see your net worth trend" />

      {/* Portfolio Holdings Donut */}
      {holdings.length > 0 && (
        <HoldingsDonut holdings={holdings} title="Portfolio Holdings" height={240} />
      )}

      {/* Asset Prices */}
      {holdings.length > 0 && (
        <AssetPricePanel holdings={holdings} title="Asset Prices" height={300} />
      )}

      {/* Two-col charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Income vs Expense */}
        <div className="card">
          <p className="heading-sm" style={{ marginBottom: 20 }}>Income vs Expenses</p>
          {ie.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ie} barGap={4}>
                <XAxis dataKey="month" tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} width={42} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} isAnimationActive={false} wrapperStyle={{ transition: 'none' }} />
                <Bar dataKey="income"  name="Income"  fill="#22c55e" radius={[4,4,0,0]} maxBarSize={24} />
                <Bar dataKey="expense" name="Expense" fill="#f0a04b" radius={[4,4,0,0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text="No data yet" />}
        </div>

        {/* Asset Allocation */}
        <div className="card">
          <p className="heading-sm" style={{ marginBottom: 20 }}>Asset Allocation</p>
          {aa.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={aa} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                    paddingAngle={3} dataKey="totalInvested" nameKey="name" stroke="none">
                    {aa.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} isAnimationActive={false} wrapperStyle={{ transition: 'none' }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                {aa.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{item.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                      {formatCurrency(item.totalInvested)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty text="No assets yet" />}
        </div>
      </div>

      {/* Expense breakdown */}
      {ec.length > 0 && (
        <div className="card">
          <p className="heading-sm" style={{ marginBottom: 20 }}>Expense Breakdown</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 20 }}>
            {ec.map((cat, i) => {
              const max = Math.max(...ec.map(c => c.total));
              const pct = (cat.total / max) * 100;
              return (
                <div key={cat._id}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {cat.emoji && <span>{cat.emoji}</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                      {formatCurrency(cat.total)}
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: CHART_COLORS[i % CHART_COLORS.length], transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
