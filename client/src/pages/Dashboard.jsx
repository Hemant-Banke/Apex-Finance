import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatCurrency, compactIfLarge, formatDate, formatPct, pnlColor,
} from '../lib/utils';
import { Wallet } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import CashflowChart from '../components/charts/CashflowChart';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import TransactionRow from '../components/transactions/TransactionRow';
import AllocationBar from '../components/portfolio/AllocationBar';
import AssetIcon from '../components/market/AssetIcon';
import HoldingLink from '../components/portfolio/HoldingLink';

// The net-worth series runs to T-1 (asset prices are not final until the close), so these
// measure settled day over settled day. Labelling the first one "today" would be a claim
// the data cannot support.
const RANGE_LABEL = { day: '1D', week: '1W', month: '1M', year: '1Y' };

/**
 * What you are worth, which way it is going, and what it is made of.
 *
 * This was three stacked things — a greeting header, a hero card, and a row of four
 * bordered metric tiles — so the page opened with four competing surfaces and the one
 * figure it exists to deliver had no more weight than "Cash". Now one masthead: the
 * figure, its trajectory, and its components in the band beneath.
 *
 * The band carries only what net worth is actually MADE of — portfolio + cash − what is
 * owed. Unrealised P&L used to sit among them, which read as a fourth component; it is
 * a performance fact, not a part of the total, so it has moved to the Portfolio card
 * where the rest of the performance lives.
 *
 * ONE composition bar, not three share rules. Each figure used to draw its own little
 * rule of its own share, so the band carried three separate baselines that could not be
 * compared with each other — three drawings of one composition. The accounts list had
 * already settled this: a single Assets bar split cash | invested, and the figures
 * beneath naming their share as a plain percentage. Same shape here, so the two pages
 * teach the same colour language (muted ink = cash, gold = invested) exactly once.
 */
function NetWorthMasthead({ summary, totals, hasPortfolio }) {
  const changes = summary?.netWorthChange || {};
  const liabilities = summary?.totalLiabilities || 0;
  const invested = totals.value || 0;
  const cash     = summary?.totalCash || 0;

  // Portfolio and cash are shares of the ASSET side, which is what they add up to — and
  // what the bar above them draws. Liabilities are measured against those same assets:
  // "you owe 22% of what you own" is the sentence a debt figure is trying to say, and it
  // is not a slice of the same pie. Same convention as the accounts page, so a share
  // means one thing app-wide.
  const assets = invested + cash;
  const shareOfAssets = (v) => (assets ? (Math.abs(v) / assets) * 100 : null);
  // Magnitudes, so an overdrawn account cannot push the bar past its own width.
  const gross   = Math.abs(cash) + Math.abs(invested);
  const cashPct = gross ? (Math.abs(cash) / gross) * 100 : 0;

  return (
    <Masthead
      lead={
        <>
          <p className="eyebrow" style={{ marginBottom: 12 }}>Net worth</p>
          <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
            {formatCurrency(summary?.netWorth || 0)}
          </h1>
        </>
      }
      action={
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px 22px' }}>
          {Object.entries(RANGE_LABEL).map(([key, label]) => {
            const c = changes[key];
            // A window longer than the account's own history has no honest answer.
            if (!c || c.partial) return null;
            return (
              <div key={key} style={{ textAlign: 'right' }}>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</p>
                <Delta value={c.abs} pct={c.pct} compact />
              </div>
            );
          })}
        </div>
      }
      band={
        <>
          {/* How much is liquid versus at work — the one thing a sum of balances cannot
              tell you, and the same bar the accounts list opens with. */}
          {assets > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <p className="heading-sm" style={{ letterSpacing: '0.12em' }}>Assets</p>
                <p className="figure text-sm" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {formatCurrency(assets)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 2, height: 6, borderRadius: 99, overflow: 'hidden' }}>
                <div title={`Cash · ${formatCurrency(cash)}`}
                  style={{ width: `${cashPct}%`, background: 'var(--color-text-muted)', opacity: 0.55 }} />
                <div title={`Portfolio · ${formatCurrency(invested)}`}
                  style={{ width: `${100 - cashPct}%`, background: 'var(--color-accent)' }} />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 20 }}>
            <MastheadFigure
              label="Portfolio"
              value={compactIfLarge(invested)}
              swatch="var(--color-accent)"
              pct={shareOfAssets(invested)}
              sub={hasPortfolio ? undefined
                : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No holdings yet</p>}
            />
            <MastheadFigure
              label="Cash"
              value={compactIfLarge(cash)}
              swatch="var(--color-text-muted)"
              pct={shareOfAssets(cash)}
            />
            <MastheadFigure
              label="Liabilities"
              value={compactIfLarge(liabilities)}
              accent={liabilities > 0 ? 'var(--color-danger)' : undefined}
              pct={liabilities > 0 ? shareOfAssets(liabilities) : null}
              sub={liabilities > 0 ? undefined
                : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Debt free</p>}
            />
          </div>
        </>
      }
    />
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
                <p className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}><HoldingLink h={h}>{h.name}</HoldingLink></p>
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

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      <SectionHeader
        eyebrow="Overview"
        title={`Hello${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        sub={`${summary?.accountCount || 0} account${summary?.accountCount === 1 ? '' : 's'} · ${summary?.holdingsCount || 0} holding${summary?.holdingsCount === 1 ? '' : 's'} · everything in one place`}
      />

      <NetWorthMasthead summary={summary} totals={totals} hasPortfolio={hasPortfolio} />

      {/* Net worth over time */}
      <PriceGrapher height={260} growthCapable />

      {/* Allocation + movers */}
      {hasPortfolio && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <Card>
            <SectionHeader
              eyebrow="Portfolio"
              size="sm"
              style={{ marginBottom: 18 }}
              action={
                <Link to="/analytics" className="text-xs font-medium"
                  style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                  Details →
                </Link>
              }
            />

            {/* Performance lives HERE, not in the masthead band. Net worth is made of
                portfolio + cash − debt; a gain is not a fourth ingredient of it, it is
                how one of those three has done. Beside the mix that produced it, it
                finally has something to be read against — and the day's move belongs
                with the lifetime one, not stranded under a component of the total. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="figure" style={{ fontSize: '1.35rem', fontWeight: 500, color: pnlColor(totals.unrealisedPnl) }}>
                {compactIfLarge(totals.unrealisedPnl || 0)}
              </span>
              <span className="figure text-sm" style={{ color: pnlColor(totals.unrealisedPnl) }}>
                {formatPct(totals.unrealisedPnlPct, 1)}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                unrealised on <span className="figure">{compactIfLarge(totals.invested || 0)}</span> invested
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Today</span>
              <Delta value={totals.dayChange || 0} pct={totals.dayChangePct} compact />
            </div>

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
              <Link to="/analytics" className="text-xs font-medium"
                style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                Details →
              </Link>
            }
          />
          {/* The same chart Analytics opens its cashflow card with; the month-by-month
              ledger stays there. */}
          {incExp.some(m => m.income || m.expense) ? (
            <CashflowChart rows={incExp} height={240} />
          ) : (
            <div className="flex items-center justify-center" style={{ height: 240 }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No income or expenses yet</p>
            </div>
          )}
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
