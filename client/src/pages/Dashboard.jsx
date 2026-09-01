import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatCurrency, compactIfLarge, formatDate, formatPct, pnlColor, CHART_COLORS,
} from '../lib/utils';
import { TrendingUp, TrendingDown, Wallet, ArrowRight, PiggyBank, Landmark } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import PriceGrapher from '../components/charts/PriceGrapher';
import ChartTooltip from '../components/charts/ChartTooltip';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import Delta from '../components/ui/Delta';
import Divider from '../components/ui/Divider';
import SectionHeader from '../components/ui/SectionHeader';
import TransactionRow from '../components/transactions/TransactionRow';
import AllocationBar from '../components/portfolio/AllocationBar';
import AssetIcon from '../components/market/AssetIcon';

// The net-worth series runs to T-1 (asset prices are not final until the close), so these
// measure settled day over settled day. Labelling the first one "today" would be a claim
// the data cannot support.
const RANGE_LABEL = { day: '1D', week: '1W', month: '1M', year: '1Y' };

/**
 * The headline: what you are worth, and which way it is going.
 *
 * A hero number rather than a tile — it is the one figure the page exists to deliver,
 * and the four period changes beneath it turn a static balance into a trajectory.
 */
function NetWorthHero({ summary }) {
  const changes = summary?.netWorthChange || {};

  return (
    <Card gilt style={{ padding: '28px 32px' }}>
      <p className="eyebrow" style={{ marginBottom: 14 }}>Net worth</p>
      <h1 className="display-number" style={{ color: 'var(--color-text-primary)' }}>
        {formatCurrency(summary?.netWorth || 0)}
      </h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', marginTop: 20 }}>
        {Object.entries(RANGE_LABEL).map(([key, label]) => {
          const c = changes[key];
          // A window longer than the account's own history has no honest answer.
          if (!c || c.partial) return null;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
              <Delta value={c.abs} pct={c.pct} compact />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** One headline figure with an optional change beneath it. */
function Metric({ label, value, sub, delta, icon: Icon, accent }) {
  return (
    <Card compact>
      <div className="flex items-start justify-between" style={{ marginBottom: 12 }}>
        <p className="heading-sm" style={{ letterSpacing: '0.1em' }}>{label}</p>
        {Icon && <Icon size={15} strokeWidth={1.75} style={{ color: accent || 'var(--color-text-muted)', opacity: accent ? 0.85 : 0.55 }} />}
      </div>
      <p className="figure" style={{ fontSize: '1.35rem', fontWeight: 500, lineHeight: 1.1, color: accent || 'var(--color-text-primary)' }}>
        {value}
      </p>
      <div style={{ marginTop: 6, minHeight: 18 }}>
        {delta ?? (sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>)}
      </div>
    </Card>
  );
}

/**
 * The day's biggest movers — the only holdings worth interrupting someone about.
 * Unpriced holdings are excluded outright: a book-value stand-in has a day change of
 * exactly zero, and listing it among the movers would be noise dressed as signal.
 */
function Movers({ holdings }) {
  const moved = holdings
    .filter(h => h.priced && h.dayChange !== 0)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
    .slice(0, 5);

  if (!moved.length) return null;

  return (
    <Card flush>
      <div style={{ padding: '22px 24px 4px' }}>
        <p className="eyebrow">Today's movers</p>
      </div>
      <div style={{ paddingTop: 12 }}>
        {moved.map(h => (
          <div key={h.symbol} className="data-row" style={{ padding: '12px 24px', cursor: 'default' }}>
            <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
              <AssetIcon symbol={h.symbol} type={h.type} size={28} />
              <div style={{ minWidth: 0 }}>
                <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{h.name}</p>
                <p className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {formatCurrency(h.price)}
                </p>
              </div>
            </div>
            <Delta value={h.dayChange} pct={h.dayChangePct} compact />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [summary,   setSummary]   = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [incExp,    setIncExp]    = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, p, ie] = await Promise.all([
        dashboardAPI.getSummary(),
        dashboardAPI.getPortfolio(),
        dashboardAPI.getIncomeExpense(6),
      ]);

      setSummary(s.data);
      setPortfolio(p.data);
      setIncExp(ie.data);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load dashboard'); }
    finally { setLoading(false); }
  };

  if (loading) return <Spinner />;

  const totals   = portfolio?.totals   || {};
  const holdings = portfolio?.holdings || [];
  const hasPortfolio = holdings.length > 0;

  const savings = summary?.monthlySavings || 0;
  const rate    = summary?.savingsRate;

  // This month against the trailing average — a number is only interesting next to the
  // one it should be compared with.
  const avgExpense = summary?.avgMonthlyExpense || 0;
  const vsAverage  = avgExpense ? (summary.monthlyExpense - avgExpense) : 0;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      <SectionHeader
        eyebrow="Overview"
        title={`Hello${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        sub={`${summary?.accountCount || 0} account${summary?.accountCount === 1 ? '' : 's'} · ${summary?.holdingsCount || 0} holding${summary?.holdingsCount === 1 ? '' : 's'}`}
      />

      <NetWorthHero summary={summary} />

      {/* The four figures that actually move: what it's worth, what it made, what's
          liquid, what's owed. */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
        <Metric
          label="Portfolio"
          value={compactIfLarge(totals.value || 0)}
          delta={hasPortfolio && <Delta value={totals.dayChange || 0} pct={totals.dayChangePct} compact />}
          sub="No holdings yet"
          icon={TrendingUp}
        />
        <Metric
          label="Unrealised P&L"
          value={compactIfLarge(totals.unrealisedPnl || 0)}
          accent={hasPortfolio ? pnlColor(totals.unrealisedPnl) : undefined}
          sub={hasPortfolio ? `on ${compactIfLarge(totals.invested || 0)} invested` : '—'}
          delta={hasPortfolio
            ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {formatPct(totals.unrealisedPnlPct, 1)} on {compactIfLarge(totals.invested || 0)} invested
              </p>
            : undefined}
          icon={totals.unrealisedPnl < 0 ? TrendingDown : TrendingUp}
        />
        <Metric
          label="Cash"
          value={compactIfLarge(summary?.totalCash || 0)}
          sub="Across all accounts"
          icon={Landmark}
        />
        <Metric
          label="Liabilities"
          value={compactIfLarge(summary?.totalLiabilities || 0)}
          accent={summary?.totalLiabilities > 0 ? 'var(--color-danger)' : undefined}
          sub={summary?.totalLiabilities > 0 ? 'Outstanding debt' : 'Debt free'}
          icon={TrendingDown}
        />
      </div>

      {/* Net worth over time */}
      <PriceGrapher height={260} growthCapable />

      {/* Allocation + movers */}
      {hasPortfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <Card>
            <SectionHeader
              eyebrow="Allocation"
              size="sm"
              style={{ marginBottom: 24 }}
              action={
                <Link to="/analytics" className="text-xs font-medium"
                  style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                  Details →
                </Link>
              }
            />
            <AllocationBar items={portfolio.allocation} />
          </Card>
          <Movers holdings={holdings} />
        </div>
      )}

      {/* Cashflow + recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        <Card>
          <SectionHeader
            eyebrow="Cashflow · 6 months"
            size="sm"
            style={{ marginBottom: 20 }}
            action={
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Net per month
              </span>
            }
          />
          {incExp.some(m => m.income || m.expense) ? (
            <ResponsiveContainer width="100%" height={200}>
              {/* One measure, one axis: the NET of each month. Income and expense as
                  paired bars invited reading the gap between two scales; the thing the
                  user actually wants to know is whether the month was up or down. */}
              <BarChart data={incExp} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
                  tickFormatter={m => m.slice(5)} />
                <YAxis tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} width={46} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} isAnimationActive={false} />
                <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} maxBarSize={30}>
                  {/* Colour states the sign — a surplus month and a deficit month are
                      different in kind, not just in magnitude. */}
                  {incExp.map((m, i) => (
                    <Cell key={i} fill={m.net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center" style={{ height: 200 }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No income or expenses yet</p>
            </div>
          )}

          <Divider gilt margin={20} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
            <div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>This month's saving</p>
              <p className="figure text-sm" style={{ color: pnlColor(savings), fontWeight: 500, marginTop: 4 }}>
                {compactIfLarge(savings)}
                {rate != null && <span style={{ opacity: 0.7 }}> · {rate.toFixed(0)}% of income</span>}
              </p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Spend vs 6-month average</p>
              <p className="figure text-sm" style={{ marginTop: 4, color: vsAverage > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                {avgExpense
                  ? <>{compactIfLarge(summary.monthlyExpense)} vs {compactIfLarge(avgExpense)}</>
                  : '—'}
              </p>
            </div>
          </div>
        </Card>

        <Card flush>
          <div className="flex items-center justify-between" style={{ padding: '22px 24px 4px' }}>
            <p className="eyebrow">Recent activity</p>
            <Link to="/transactions" className="text-xs font-medium"
              style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
              View all →
            </Link>
          </div>
          {summary?.recentTransactions?.length > 0 ? (
            <div style={{ paddingTop: 12 }}>
              {summary.recentTransactions.slice(0, 6).map(tx => (
                <TransactionRow
                  key={tx._id}
                  tx={tx}
                  subtitle={<>{tx.account?.name} · {formatDate(tx.date)}</>}
                />
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
