import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, compactIfLarge, formatDate, getTransactionColor, getTransactionSign, getTransactionName } from '../lib/utils';
import { TrendingUp, TrendingDown, ArrowUpRight, Wallet, BarChart3, ArrowRight } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PriceGrapher from '../components/charts/PriceGrapher';
import ChartTooltip from '../components/charts/ChartTooltip';
import AssetPricePanel from '../components/charts/AssetPricePanel';
import Card from '../components/ui/Card';
import StatTile from '../components/ui/StatTile';
import SectionHeader from '../components/ui/SectionHeader';
import Divider from '../components/ui/Divider';

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
      <SectionHeader
        eyebrow="Overview"
        title={`Hello${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        sub={`Your complete picture · ${summary?.accountCount || 0} account${summary?.accountCount === 1 ? '' : 's'}`}
      />

      {/* Stat Cards */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <StatTile label="Assets"          value={compactIfLarge(summary?.totalAssets || 0)}      sub={`${summary?.holdingsCount || 0} holdings`} icon={TrendingUp} highlight />
        <StatTile label="Liabilities"     value={compactIfLarge(summary?.totalLiabilities || 0)} accent="var(--color-danger)"  icon={TrendingDown} />
        <StatTile label="Monthly Income"  value={compactIfLarge(summary?.monthlyIncome || 0)}    accent="var(--color-success)" icon={ArrowUpRight} />
        <StatTile label="Monthly Expense" value={compactIfLarge(summary?.monthlyExpense || 0)}   accent="var(--color-chart-warm)" icon={BarChart3} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>

        {/* Net worth — daily store */}
        <PriceGrapher height={240} />

        {/* Income vs Expense */}
        <Card>
          <SectionHeader eyebrow="Income vs Expense" size="sm" style={{ marginBottom: 20 }} />
          {incExp.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={incExp} barGap={4}>
                <XAxis dataKey="month" tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} width={42} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} isAnimationActive={false} wrapperStyle={{ transition: 'none' }} />
                <Bar dataKey="income"  name="Income"  fill="#22c55e" radius={[4,4,0,0]} maxBarSize={22} />
                <Bar dataKey="expense" name="Expense" fill="#f0a04b" radius={[4,4,0,0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center" style={{ height: 240 }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
            </div>
          )}
        </Card>
      </div>

      {/* Asset Prices */}
      {holdings.length > 0 && (
        <AssetPricePanel holdings={holdings} title="Asset Prices" height={260} />
      )}

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 }}>

        {/* Snapshot */}
        <Card>
          <SectionHeader eyebrow="Snapshot" size="sm" style={{ marginBottom: 20 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Monthly Savings', value: compactIfLarge(savings), color: savings >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
              { label: 'Savings Rate',    value: summary?.monthlyIncome ? `${((savings / summary.monthlyIncome) * 100).toFixed(0)}%` : '—', color: savings >= 0 ? 'var(--color-success)' : 'var(--color-danger)' },
              { label: 'Total Accounts',  value: summary?.accountCount || 0 },
              { label: 'Total Holdings',  value: summary?.holdingsCount || 0 },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
                <span className="figure text-sm" style={{ fontWeight: 500, color: color || 'var(--color-text-primary)' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          <Divider gilt margin={20} />
          <Link to="/accounts" className="flex items-center gap-1.5 text-sm font-medium group"
            style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
            View accounts
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Card>

        {/* Recent transactions */}
        <Card flush>
          <div className="flex items-center justify-between" style={{ padding: '22px 24px 4px' }}>
            <p className="eyebrow">Recent Transactions</p>
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
                  <span className={`figure text-sm ${getTransactionColor(tx.type)}`}
                    style={{ marginLeft: 16, fontWeight: 500 }}>
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
        </Card>
      </div>
    </div>
  );
}
