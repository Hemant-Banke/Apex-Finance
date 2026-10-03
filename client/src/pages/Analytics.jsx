import { LineChart } from 'lucide-react';
import { useState, useEffect } from 'react';
import { dashboardAPI, accountsAPI } from '../lib/api';
import { getCategoryMap, describeCategory } from '../lib/categoryNames';
import {
  formatCurrency, compactIfLarge, formatPct, pnlColor,
} from '../lib/utils';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import GardenEmpty from '../components/ui/GardenEmpty';
import Divider from '../components/ui/Divider';
import SegmentedControl from '../components/ui/SegmentedControl';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import CashflowChart from '../components/charts/CashflowChart';
import CategoryBreakdown from '../components/charts/CategoryBreakdown';
import MonthlyLedger from '../components/charts/MonthlyLedger';
import HoldingsBook from '../components/portfolio/HoldingsBook';
import AllocationPanel from '../components/portfolio/AllocationPanel';
import PerformancePanel from '../components/portfolio/PerformancePanel';

/**
 * The month ranges, picked ON the section they govern (a `SegmentedControl` in the
 * cashflow card). They used to live in the page header, which read as though they scoped
 * the whole page — but they never touched the portfolio, whose holdings and P&L are a
 * position as of now, not a window. They only drive the cashflow and the breakdowns.
 */
const RANGES = [6, 12, 24];

function Empty({ text, height = 220 }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{text}</p>
    </div>
  );
}

export default function Analytics() {
  const toast = useToast();
  const [months,    setMonths]    = useState(12);
  const [portfolio, setPortfolio] = useState(null);
  const [ie,        setIe]        = useState([]);
  const [ec,        setEc]        = useState([]);   // where it goes
  const [icat,      setIcat]      = useState([]);   // where it comes from
  const [loading,   setLoading]   = useState(true);

  // The portfolio is a position as of NOW; the flows are a window. They are refetched on
  // different triggers, so changing the range does not re-price the whole book.
  const [accountNames, setAccountNames] = useState(null);
  useEffect(() => { loadPortfolio(); }, []);
  useEffect(() => { loadFlows(); },     [months]);

  const loadPortfolio = async () => {
    try {
      const [p, a] = await Promise.all([
        dashboardAPI.getPortfolio(),
        accountsAPI.getAll().catch(() => null),
      ]);
      setPortfolio(p.data);
      // Names where a position is held, when it spans accounts.
      if (a) setAccountNames(Object.fromEntries(a.data.map(x => [x._id, x.name])));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load portfolio'); }
    finally { setLoading(false); }
  };

  const loadFlows = async () => {
    try {
      const [b, out, inc, cats] = await Promise.all([
        dashboardAPI.getIncomeExpense(months),
        dashboardAPI.getCategoryTotals('expense', months),
        dashboardAPI.getCategoryTotals('income', months),
        getCategoryMap(),
      ]);
      setIe(b.data);
      // A category code is an internal handle, not a label — look up the real name.
      const named = (rows) => rows.map(x => ({
        ...x,
        name:  x._id ? describeCategory(x._id, cats).label : 'Uncategorised',
        emoji: x._id ? describeCategory(x._id, cats).emoji : '',
      }));
      setEc(named(out.data));
      setIcat(named(inc.data));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load cashflow'); }
  };

  if (loading) return <Spinner />;

  const totals     = portfolio?.totals   || {};
  const holdings   = portfolio?.holdings || [];
  const allocation = portfolio?.allocation || [];
  const hasPortfolio = holdings.length > 0;

  const flowMonths = ie.filter(m => m.income || m.expense);
  // The server starts the window at the first income/expense month; a shorter answer means
  // that is all the history there is, so longer ranges would only repeat it.
  const span = ie.length || months;
  const ranges = RANGES.filter((m, i) => i === 0 || span >= months || RANGES[i - 1] < span)
    .map(m => ({ key: String(m), label: `${m}M` }));
  const picked = String(span < months ? (RANGES.find(m => m >= span) ?? months) : months);
  // A month with no activity has no cashflow at all — not a cashflow of zero. Left as 0,
  // the month you are only a day into dragged the net line down to the axis as if it had
  // broken exactly even; as null, the line simply stops where the record does.
  const totalIncome  = ie.reduce((s, m) => s + m.income, 0);
  const totalExpense = ie.reduce((s, m) => s + m.expense, 0);
  const overallRate  = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null;


  // Averaged over the months that actually have activity, not the whole window — a
  // brand-new account padded with empty months would otherwise report a spending habit
  // half its real size.
  const avgIncome  = flowMonths.length ? totalIncome  / flowMonths.length : 0;
  const avgExpense = flowMonths.length ? totalExpense / flowMonths.length : 0;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      <SectionHeader
        eyebrow="Analytics"
        title="Performance"
        sub="How the portfolio and the cashflow have actually done"
      />

      {/* ── Masthead ──────────────────────────────────────────────────────────
          A page header, then a card of four equal figures — so "Performance" and
          "Invested" carried the same weight, and the page's actual answer (what the
          book is worth, and what it has made) was one cell among four. The same shape
          the rest of the app uses now: the figure, then what it is made of. */}
      {hasPortfolio ? (
        <Masthead
          lead={
            <>
              <p className="eyebrow" style={{ marginBottom: 12 }}>Portfolio value</p>
              <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
                {formatCurrency(totals.value || 0)}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                {' · '}{allocation.length} asset {allocation.length === 1 ? 'type' : 'types'}
              </p>
            </>
          }
          action={
            <div style={{ textAlign: 'right' }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 5 }} title="The latest session's move">1D</p>
              <Delta value={totals.dayChange} pct={totals.dayChangePct} compact stacked />
            </div>
          }
          band={
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
                <MastheadFigure tight
                  label="Invested"
                  value={compactIfLarge(totals.invested)}
                  sub={<p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Cost basis</p>}
                />
                <MastheadFigure tight
                  label="Unrealised P&L"
                  value={compactIfLarge(totals.unrealisedPnl)}
                  accent={pnlColor(totals.unrealisedPnl)}
                  sub={<p className="figure text-xs" style={{ color: pnlColor(totals.unrealisedPnl) }}>
                    {formatPct(totals.unrealisedPnlPct, 1)}
                  </p>}
                />
                <MastheadFigure tight
                  label="Realised P&L"
                  value={compactIfLarge(totals.realisedPnl)}
                  accent={pnlColor(totals.realisedPnl)}
                  sub={<p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Booked on sales</p>}
                />
              </div>

              {!totals.priced && (
                <p className="text-xs" style={{ color: 'var(--color-chart-warm)', marginTop: 18 }}>
                  Some holdings have no live quote and are shown at cost — their P&L is unknown, not zero.
                </p>
              )}
            </>
          }
        />
      ) : null}

      <PriceGrapher height={280} emptyText="Add transactions to see your net worth trend" growthCapable />

      {/* ── Portfolio ─────────────────────────────────────────────────────── */}
      {hasPortfolio ? (
        <>
          <AllocationPanel holdings={holdings} accountNames={accountNames} profile={portfolio?.profile} />

          {/* What the book has made, then which holdings made it. */}
          <PerformancePanel totals={totals} sub="What your investments have made — on paper, booked, and per year" />

          <Card flush>
            <div style={{ padding: '22px 24px 16px' }}>
              <SectionHeader eyebrow="Holdings" size="sm" sub="Marked to market · click a holding for the full numbers" />
            </div>
            <HoldingsBook holdings={holdings} accountNames={accountNames} />
          </Card>
        </>
      ) : (
        <GardenEmpty compact icon={LineChart} title="No holdings yet" text="Add an asset to an account and its performance, allocation and contribution appear here." />
      )}

      {/* ── Cashflow ──────────────────────────────────────────────────────────
          Two things, in the order you want them: the SHAPE of the window, then the
          months themselves.

          The card had grown a third: a savings-rate line riding a second right-hand
          axis over the bars. Two units in one plot is a chart you have to be told how
          to read — the line crossed the bars, borrowed the app's accent from the very
          series it was not part of, and the same fact ("what fraction was kept") is
          plainly stated as a column in the ledger below, where it is a number instead
          of a slope. And the strip of five stat tiles under it — two averages, a rate,
          a best month and a worst month — was a table nobody had written; it is now
          written, with the averages as its summary line. */}
      <Card>
        <SectionHeader
          eyebrow="Cashflow"
          size="sm"
          sub={`Income, spending and the net cashflow between them · last ${span} month${span === 1 ? '' : 's'}`}
          style={{ marginBottom: 20 }}
          action={ranges.length > 1 && <SegmentedControl options={ranges} value={picked} onChange={k => setMonths(Number(k))} ariaLabel="Months" />}
        />

        {flowMonths.length ? (
          <>
            <CashflowChart rows={ie} />

            <Divider gilt margin={22} />

            <p className="eyebrow" style={{ marginBottom: 14 }}>Month by month</p>
            <MonthlyLedger
              rows={flowMonths}
              avgIncome={avgIncome}
              avgExpense={avgExpense}
              overallRate={overallRate}
            />
          </>
        ) : <Empty text="No income or expenses in this period" height={260} />}
      </Card>

      {/* Both directions, side by side. Spending was the only half ever shown, which
          made the page an account of what you lose. The whole ranking goes in — the
          component does its own top-N and folds the rest into "Other", so the list it
          draws always reconciles to the total it prints. */}
      {(ec.length > 0 || icat.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <CategoryBreakdown
            title="Where it goes"
            rows={ec}
            months={span}
            // Spending up is not a gain: the arrow still points up, the colour says red.
            invert
            emptyText="Nothing spent in this period"
          />
          <CategoryBreakdown
            title="Where it comes from"
            rows={icat}
            months={span}
            emptyText="No income in this period"
          />
        </div>
      )}
    </div>
  );
}
