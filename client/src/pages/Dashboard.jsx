import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate, getTransactionColor, getTransactionSign, getTransactionName } from '../lib/utils';
import { TrendingUp, TrendingDown, ArrowUpRight, Wallet, BarChart3, ArrowRight } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PriceGrapher from '../components/charts/PriceGrapher';
import ChartTooltip from '../components/charts/ChartTooltip';
import AssetPricePanel from '../components/charts/AssetPricePanel';

function StatCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="card card-compact">
      <div className="flex items-start justify-between mb-3">
        <p className="label">{label}</p>
        <Icon size={15} style={{ color: color || 'var(--color-text-muted)', opacity: 0.6 }} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums" style={{ color: color || 'var(--color-text-primary)' }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [summary,  setSummary]  = useState(null);
  const [incExp,   setIncExp]   = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, ie, h] = await Promise.all([
        dashboardAPI.getSummary(),
        dashboardAPI.getIncomeExpense(6),
        dashboardAPI.getHoldings(),
      ]);
      setSummary(s.data);
      setIncExp(ie.data);
      setHoldings(h.data);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load dashboard'); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center" style={{ height: '60vh' }}>
      <div className="spinner" />
    </div>
  );

  const savings = (summary?.monthlyIncome || 0) - (summary?.monthlyExpense || 0);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Header */}
      <div>
        <p className="heading-sm mb-2">Overview</p>
        <h1 className="display-number" style={{ color: 'var(--color-text-primary)' }}>
          Hello{user ? `, ${user.name.split(' ')[0]}` : ''}!
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
          Total net worth · {summary?.accountCount || 0} accounts
        </p>
      </div>

      {/* Stat Cards */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <StatCard label="Assets"          value={formatCurrency(summary?.totalAssets || 0)}      sub={`${summary?.holdingsCount || 0} holdings`} icon={TrendingUp} />
        <StatCard label="Liabilities"     value={formatCurrency(summary?.totalLiabilities || 0)} color="var(--color-danger)"  icon={TrendingDown} />
        <StatCard label="Monthly Income"  value={formatCurrency(summary?.monthlyIncome || 0)}    color="var(--color-success)" icon={ArrowUpRight} />
        <StatCard label="Monthly Expense" value={formatCurrency(summary?.monthlyExpense || 0)}   color="var(--color-chart-warm)" icon={BarChart3} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>

        {/* Net worth — daily store */}
        <PriceGrapher height={240} />

        {/* Income vs Expense */}
        <div className="card">
          <p className="heading-sm" style={{ marginBottom: 20 }}>Income vs Expense</p>
          {incExp.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={incExp} barGap={4}>
                <XAxis dataKey="month" tick={{ fill: '#636363', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fill: '#636363', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} width={42} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} isAnimationActive={false} wrapperStyle={{ transition: 'none' }} />
                <Bar dataKey="income"  name="Income"  fill="#22c55e" radius={[4,4,0,0]} maxBarSize={22} />
                <Bar dataKey="expense" name="Expense" fill="#f97316" radius={[4,4,0,0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center" style={{ height: 240 }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Asset Prices */}
      {holdings.length > 0 && (
        <AssetPricePanel holdings={holdings} title="Asset Prices" height={260} />
      )}

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 }}>

        {/* Snapshot */}
        <div className="card">
          <p className="heading-sm mb-5">Snapshot</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Monthly Savings', value: formatCurrency(savings), color: savings >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
              { label: 'Savings Rate',    value: summary?.monthlyIncome ? `${((savings / summary.monthlyIncome) * 100).toFixed(0)}%` : '—', color: savings >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
              { label: 'Total Accounts',  value: summary?.accountCount || 0 },
              { label: 'Total Holdings',  value: summary?.holdingsCount || 0 },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: color || 'var(--color-text-primary)' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <div className="divider" style={{ margin: '20px 0 16px' }} />
          <Link to="/accounts" className="flex items-center gap-1.5 text-sm font-medium group"
            style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
            View accounts
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Recent transactions */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between" style={{ padding: '20px 24px 0' }}>
            <p className="heading-sm">Recent Transactions</p>
            <Link to="/transactions" className="text-xs font-medium"
              style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
              View all →
            </Link>
          </div>
          {summary?.recentTransactions?.length > 0 ? (
            <div style={{ paddingTop: 12 }}>
              {summary.recentTransactions.slice(0, 6).map(tx => (
                <div key={tx._id} className="data-row" style={{ padding: '12px 24px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {getTransactionName(tx)}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {tx.account?.name} · {formatDate(tx.date)}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${getTransactionColor(tx.type)}`}
                    style={{ marginLeft: 16 }}>
                    {getTransactionSign(tx.type)}{formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center" style={{ padding: '48px 24px' }}>
              <div className="text-center">
                <Wallet size={20} style={{ color: 'var(--color-text-muted)', opacity: 0.4, margin: '0 auto 8px' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No transactions yet</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
