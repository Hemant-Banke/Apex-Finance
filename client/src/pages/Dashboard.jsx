import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { dashboardAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  formatCurrency, compactIfLarge, formatDate, formatPct, formatSigned, pnlColor, monthLabel,
} from '../lib/utils';
import { getCategoryMap, describeCategory } from '../lib/categoryNames';
import { Wallet, ArrowUpRight } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import CashflowChart from '../components/charts/CashflowChart';
import Card from '../components/ui/Card';
import GardenEmpty from '../components/ui/GardenEmpty';
import Spinner from '../components/ui/Spinner';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import TransactionRow from '../components/transactions/TransactionRow';
import AllocationBar from '../components/portfolio/AllocationBar';
import AssetIcon from '../components/market/AssetIcon';
import HoldingLink from '../components/portfolio/HoldingLink';
import CategoryBreakdown from '../components/charts/CategoryBreakdown';
import { portfolioStyle } from '../lib/portfolioStyle';
import { planModel, loadPlanSettings } from '../lib/planModel';
import IndependenceCard from '../components/plan/IndependenceCard';

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
                <Delta value={c.abs} pct={c.pct} compact stacked />
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
            <MastheadFigure stackPct
              label="Portfolio"
              value={compactIfLarge(invested)}
              swatch="var(--color-accent)"
              pct={shareOfAssets(invested)}
              sub={hasPortfolio ? undefined
                : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No holdings yet</p>}
            />
            <MastheadFigure stackPct
              label="Cash"
              value={compactIfLarge(cash)}
              swatch="var(--color-text-muted)"
              pct={shareOfAssets(cash)}
            />
            <MastheadFigure stackPct
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

/** The last session's best and worst holdings, side by side. Unpriced holdings never qualify. */
function Movers({ holdings }) {
  const moved = holdings.filter(h => h.priced && h.dayChange !== 0 && h.dayChangePct != null);
  const gainers = moved.filter(h => h.dayChange > 0).sort((a, b) => b.dayChangePct - a.dayChangePct).slice(0, 4);
  const losers  = moved.filter(h => h.dayChange < 0).sort((a, b) => a.dayChangePct - b.dayChangePct).slice(0, 4);
  if (!gainers.length && !losers.length) return null;

  const column = (title, rows, empty) => (
    <div style={{ minWidth: 0 }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{title}</p>
      {rows.length ? rows.map(h => (
        <div key={h.symbol} className="flex items-center" style={{ gap: 9, padding: '7px 0', borderTop: '1px solid var(--color-border-subtle)' }}
          title={`${formatSigned(Math.round(h.dayChange), compactIfLarge)} on your position`}>
          <AssetIcon symbol={h.symbol} type={h.type} size={20} />
          <p className="text-sm truncate" style={{ flex: 1, minWidth: 0, color: 'var(--color-text-secondary)' }}><HoldingLink h={h}>{h.name}</HoldingLink></p>
          <Delta value={h.dayChange} pct={h.dayChangePct} amount={false} />
        </div>
      )) : <p className="text-xs" style={{ color: 'var(--color-text-muted)', padding: '8px 0', borderTop: '1px solid var(--color-border-subtle)' }}>{empty}</p>}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18 }}>
      {column('Gainers · 1D', gainers, 'Nothing rose')}
      {column('Losers · 1D', losers, 'Nothing fell')}
    </div>
  );
}

/**
 * The whole picture in one strip: how the investments have done, what kind of book it is,
 * how much is kept, how long the cash lasts, and this month so far. Each opens its page.
 */
function VitalSigns({ totals, profile, summary, incExp }) {
  const style = portfolioStyle(profile);
  const active = incExp.filter(m => m.income || m.expense);
  const inc = active.reduce((s, m) => s + m.income, 0);
  const exp = active.reduce((s, m) => s + m.expense, 0);
  const rate = inc > 0 ? ((inc - exp) / inc) * 100 : null;
  const avgExp = active.length ? exp / active.length : 0;
  const avgKept = active.length ? (inc - exp) / active.length : 0;
  const runway = avgExp > 0 && summary?.totalCash > 0 ? summary.totalCash / avgExp : null;

  const tiles = [
    totals?.holdingsCount > 0 && {
      to: '/analytics', label: 'Investment gain',
      value: formatSigned(Math.round(totals.totalGain || 0), compactIfLarge), tone: pnlColor(totals.totalGain),
      sub: totals.xirr != null ? `${formatPct(totals.xirr, 1)} a year (XIRR)` : 'unrealised + realised',
    },
    style && {
      to: '/analytics', label: 'Portfolio style', value: style.label, text: true,
      sub: `${style.growth.toFixed(0)}% in growth assets`,
    },
    rate != null && {
      to: '/analytics', label: 'Savings rate', value: `${rate.toFixed(0)}%`, tone: rate < 0 ? 'var(--color-danger)' : undefined,
      sub: `${compactIfLarge(Math.round(avgKept))} kept a month`,
    },
    runway != null && {
      to: '/plan', label: 'Cash runway', value: runway >= 24 ? '24+ mo' : `${runway.toFixed(1)} mo`,
      sub: `at ${compactIfLarge(Math.round(avgExp))} a month`,
    },
    avgExp > 0 && {
      to: '/transactions', label: 'Spent this month', value: compactIfLarge(Math.round(summary?.monthlyExpense || 0)),
      sub: `typical month ${compactIfLarge(Math.round(avgExp))}`,
    },
  ].filter(Boolean);
  if (!tiles.length) return null;

  return (
    <Card flush>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
        {tiles.map((t, i) => (
          <Link key={t.label} to={t.to} className="vital-tile" style={{ borderLeft: i ? '1px solid var(--color-border-subtle)' : 'none' }}>
            <span className="flex items-center justify-between" style={{ gap: 8 }}>
              <span className="col-head">{t.label}</span>
              <ArrowUpRight size={12} className="vital-arrow" />
            </span>
            <span className={t.text ? undefined : 'figure'} style={{ display: 'block', fontSize: '1.2rem', fontWeight: 500, marginTop: 10, color: t.tone || 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
              {t.value}
            </span>
            <span className="text-xs" style={{ display: 'block', color: 'var(--color-text-muted)', marginTop: 4 }}>{t.sub}</span>
          </Link>
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
  const [spend,     setSpend]     = useState([]);
  const [spending,  setSpending]  = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, p, ie, cats, catMap, sp] = await Promise.all([
        dashboardAPI.getSummary(),
        dashboardAPI.getPortfolio(),
        dashboardAPI.getIncomeExpense(6),
        dashboardAPI.getCategoryTotals('expense', 3).catch(() => ({ data: [] })),
        getCategoryMap().catch(() => null),
        dashboardAPI.getSpendingProfile(12).catch(() => null),
      ]);

      setSummary(s.data);
      setPortfolio(p.data);
      setIncExp(ie.data);
      setSpending(sp?.data || null);
      setSpend(cats.data.map(c => ({
        ...c,
        name:  c._id ? describeCategory(c._id, catMap || undefined).label : 'Uncategorised',
        emoji: c._id ? describeCategory(c._id, catMap || undefined).emoji : '',
      })));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load dashboard'); }
    finally { setLoading(false); }
  };

  if (loading) return <Spinner />;

  const totals   = portfolio?.totals   || {};
  const holdings = portfolio?.holdings || [];
  const hasPortfolio = holdings.length > 0;

  // A typical month over the months with activity — the cashflow card's figures.
  const flowMonths = incExp.filter(m => m.income || m.expense);
  const flowIn = flowMonths.reduce((t, m) => t + m.income, 0);
  const flowOut = flowMonths.reduce((t, m) => t + m.expense, 0);
  const bestMonth = flowMonths.length > 1 ? [...flowMonths].sort((a, b) => (b.income - b.expense) - (a.income - a.expense))[0] : null;
  const flow = {
    totalIn: flowIn, totalOut: flowOut,
    avgIn: flowMonths.length ? flowIn / flowMonths.length : 0,
    avgOut: flowMonths.length ? flowOut / flowMonths.length : 0,
    rate: flowIn > 0 ? ((flowIn - flowOut) / flowIn) * 100 : null,
    best: bestMonth ? monthLabel(bestMonth.month) : null,
  };

  const planSettings = loadPlanSettings();
  const plan = spending ? planModel({ summary, portfolio, spending }, planSettings) : null;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      <SectionHeader
        eyebrow="Overview"
        title={`Hello${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        sub={`${summary?.accountCount || 0} account${summary?.accountCount === 1 ? '' : 's'} · ${summary?.holdingsCount || 0} holding${summary?.holdingsCount === 1 ? '' : 's'} · everything in one place`}
      />

      <NetWorthMasthead summary={summary} totals={totals} hasPortfolio={hasPortfolio} />

      {/* Net worth over time */}
      <PriceGrapher height={220} growthCapable />

      <VitalSigns totals={totals} profile={portfolio?.profile} summary={summary} incExp={incExp} />

      {/* What the money is in, and where it goes. */}
      {(hasPortfolio || spend.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: hasPortfolio && spend.length ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 16, alignItems: 'stretch' }}>
          {hasPortfolio && (
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
              <div className="flex items-start justify-between" style={{ gap: 16, marginBottom: 18 }}>
                <div>
                  <p className="figure" style={{ fontSize: '1.35rem', fontWeight: 500, color: pnlColor(totals.unrealisedPnl) }}>
                    {formatSigned(Math.round(totals.unrealisedPnl || 0), compactIfLarge)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>
                    <span className="figure" style={{ color: pnlColor(totals.unrealisedPnl) }}>{formatPct(totals.unrealisedPnlPct, 1)}</span>
                    {' '}unrealised on <span className="figure">{compactIfLarge(totals.invested || 0)}</span>
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 4 }} title="The latest session's move">1D</p>
                  <Delta value={Math.round(totals.dayChange || 0)} pct={totals.dayChangePct} compact stacked />
                </div>
              </div>
              <AllocationBar items={portfolio.allocation} />
              <div style={{ marginTop: 20 }}><Movers holdings={holdings} /></div>
            </Card>
          )}
          {spend.length > 0 && (
            <CategoryBreakdown title="Where it went" rows={spend} months={Math.min(3, incExp.length || 3)} invert trend={false}
              emptyText="Nothing spent in this period" />
          )}
        </div>
      )}

      {/* Cashflow, and where it is all heading. */}
      <div style={{ display: 'grid', gridTemplateColumns: plan ? 'minmax(0, 1.5fr) minmax(0, 1fr)' : '1fr', gap: 16, alignItems: 'stretch' }}>
        <Card>
          <SectionHeader
            eyebrow={`Cashflow · ${flowMonths.length || 6} months`}
            size="sm"
            style={{ marginBottom: 18 }}
            action={
              <Link to="/analytics" className="text-xs font-medium"
                style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>
                Details →
              </Link>
            }
          />
          {flowMonths.length ? (
            <>
              {/* A typical month, in four figures, before the shape of the months. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 18 }}>
                <MastheadFigure tight label="Income / mo" value={compactIfLarge(Math.round(flow.avgIn))} accent="var(--color-success)"
                  sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{compactIfLarge(Math.round(flow.totalIn))} total</span>} />
                <MastheadFigure tight label="Spending / mo" value={compactIfLarge(Math.round(flow.avgOut))} accent="var(--color-danger)"
                  sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{compactIfLarge(Math.round(flow.totalOut))} total</span>} />
                <MastheadFigure tight label="Net / mo" value={formatSigned(Math.round(flow.avgIn - flow.avgOut), compactIfLarge)} accent={pnlColor(flow.avgIn - flow.avgOut)}
                  sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{flow.best ? `best ${flow.best}` : ''}</span>} />
                <MastheadFigure tight label="Saved" value={flow.rate == null ? '—' : `${flow.rate.toFixed(0)}%`}
                  sub={<span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>of income kept</span>} />
              </div>
              <CashflowChart rows={incExp} height={220} />
            </>
          ) : (
            <GardenEmpty card={false} compact title="No income or expenses yet"
              text="Record a transaction or import a statement to see what comes in and goes out." style={{ minHeight: 240, borderRadius: 12 }} />
          )}
        </Card>

        {plan && <IndependenceCard m={plan} s={planSettings} />}
      </div>

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
            {summary.recentTransactions.slice(0, 5).map(tx => (
              <TransactionRow
                key={tx._id}
                tx={tx}
                subtitle={<>{tx.account?.name} · {formatDate(tx.date)}</>}
              />
            ))}
          </div>
        ) : (
          <GardenEmpty card={false} compact icon={Wallet} title="No transactions yet"
            text="Everything in Apex is a transaction — your latest five land here." />
        )}
      </Card>
    </div>
  );
}
