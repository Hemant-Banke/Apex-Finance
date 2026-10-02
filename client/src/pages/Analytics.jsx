import { useState, useEffect } from 'react';
import { dashboardAPI } from '../lib/api';
import { getCategoryMap, describeCategory } from '../lib/categoryNames';
import {
  formatCurrency, compactIfLarge, formatPct, pnlColor, CHART_COLORS,
  monthLabel,
} from '../lib/utils';
import { assetTypeLabel } from '../lib/constants';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import Divider from '../components/ui/Divider';
import SegmentedControl from '../components/ui/SegmentedControl';
import ShowMore from '../components/ui/ShowMore';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import CashflowChart from '../components/charts/CashflowChart';
import CategoryBreakdown from '../components/charts/CategoryBreakdown';
import HoldingsTable from '../components/portfolio/HoldingsTable';
import AllocationBar from '../components/portfolio/AllocationBar';
import ContributionBreakdown from '../components/portfolio/ContributionBreakdown';

/**
 * The month ranges, picked ON the section they govern (a `SegmentedControl` in the
 * cashflow card). They used to live in the page header, which read as though they scoped
 * the whole page — but they never touched the portfolio, whose holdings and P&L are a
 * position as of now, not a window. They only drive the cashflow and the breakdowns.
 */
const RANGES = [6, 12, 24].map(m => ({ key: String(m), label: `${m}M` }));

/**
 * The months, one line each — what came in, what went out, what was kept.
 *
 * The chart above draws the SHAPE of the window; it cannot tell you that March was
 * exactly ₹1,24,300. That was the gap the page filled with a strip of five stat tiles —
 * two averages, a rate, a best month and a worst month — five figures standing in for a
 * table nobody had written, and the "best"/"worst" pair was a ranking of rows the reader
 * could not see. A ledger says all of it and says which month, so the tiles are gone and
 * only the marker survives, on the row it is actually about.
 *
 * It ends on its own summary line: what a TYPICAL month in this window looks like. A
 * total tells you the size of the window; an average tells you the size of a month,
 * which is the one you can act on — and it is averaged over the months with ACTIVITY,
 * not the whole window, or a brand-new account padded with empty months would report a
 * spending habit half its real size.
 */
const COL = { money: 108, rate: 62 };

function LedgerHead() {
  return (
    <div className="flex items-center" style={{ gap: 16, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="col-head" style={{ flex: 1, minWidth: 96 }}>Month</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>In</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>Out</span>
      <span className="col-head" style={{ width: COL.money, textAlign: 'right', flexShrink: 0 }}>Net</span>
      <span className="col-head" style={{ width: COL.rate,  textAlign: 'right', flexShrink: 0 }}>Saved</span>
    </div>
  );
}

function MonthlyLedger({ rows, avgIncome, avgExpense, overallRate }) {
  // Only worth naming a best and a worst when there is more than one month to rank.
  const byNet = [...rows].sort((a, b) => b.net - a.net);
  const best  = byNet.length > 1 ? byNet[0].month : null;
  const worst = byNet.length > 1 ? byNet[byNet.length - 1].month : null;

  // Newest first: a ledger is read from the month you are living in, backwards.
  const ordered = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const avgNet  = avgIncome - avgExpense;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 480 }}>
        <LedgerHead />

        {/* The latest six months open; the rest of the window is a click away. The
            summary line stays put beneath whatever is showing — it is the ledger's
            answer, and it describes the WHOLE window either way. */}
        <ShowMore items={ordered} initial={6} noun="months"
          // `body`, not `rows`: the summary below counts the ledger's own `rows` (every
          // active month), and a parameter of that name would silently count the six
          // rows on screen instead.
          wrap={(body) => (
            <>
              {body}
          {/* The totals line of a ledger, in the app's own accent so it reads as the
              summary OF the rows above rather than one more of them. */}
          <div className="flex items-center"
            style={{ gap: 16, padding: '13px 0 0', marginTop: 2, borderTop: '1px solid var(--color-accent-dim)' }}>
            <span className="text-sm" style={{ flex: 1, minWidth: 96, color: 'var(--color-accent)' }}>
              Average month
              <span className="text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                over {rows.length} active month{rows.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-primary)' }}>
              {compactIfLarge(avgIncome)}
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-primary)' }}>
              {compactIfLarge(avgExpense)}
            </span>
            <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(avgNet) }}>
              {compactIfLarge(avgNet)}
            </span>
            <span className="figure text-sm" style={{ width: COL.rate, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-muted)' }}>
              {overallRate == null ? '—' : `${overallRate.toFixed(0)}%`}
            </span>
          </div>
            </>
          )}
          render={(m) => (
            <div key={m.month} className="flex items-center"
              style={{ gap: 16, padding: '11px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <span className="text-sm" style={{ flex: 1, minWidth: 96, color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                <span className="truncate">{monthLabel(m.month)}</span>
                {/* The ranking, on the row it is about — where "Best month · ₹42k" in a
                    tile could only ever be a claim about a row you then had to find. */}
                {(m.month === best || m.month === worst) && (
                  <span className="text-xs" style={{ flexShrink: 0, opacity: 0.85, color: m.month === best ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {m.month === best ? 'best' : 'worst'}
                  </span>
                )}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}>
                {compactIfLarge(m.income)}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}>
                {compactIfLarge(m.expense)}
              </span>
              <span className="figure text-sm" style={{ width: COL.money, textAlign: 'right', flexShrink: 0, fontWeight: 500, color: pnlColor(m.net) }}>
                {compactIfLarge(m.net)}
              </span>
              {/* A month with no income has no rate at all — that is not the same as
                  having kept none of it, so it prints as nothing rather than 0%. */}
              <span className="figure text-sm" style={{ width: COL.rate, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-muted)' }}>
                {m.savingsRate == null ? '—' : `${m.savingsRate.toFixed(0)}%`}
              </span>
            </div>
          )} />
      </div>
    </div>
  );
}

function Empty({ text, height = 220 }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{text}</p>
    </div>
  );
}

/**
 * Where the money went in vs what it is worth now, per asset type.
 *
 * Allocation drifts: you may have put 40% into equity and be sitting at 55% because it
 * ran. Showing cost and value side by side is the only way that drift is visible — an
 * allocation chart drawn from cost alone (which is what this app used to do) reports the
 * portfolio you INTENDED, not the one you have.
 */
function AllocationDrift({ allocation }) {
  if (!allocation.length) return null;
  const totalCost  = allocation.reduce((s, a) => s + a.invested, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 24 }}>
      {/* Four columns of figures with nothing naming them: "₹8L → ₹9.3L" is guessable,
          "+3.2" beside a weight is not. The header costs one line and turns the block
          from a wall of numbers into a table. */}
      <div className="flex items-center justify-between" style={{ gap: 16, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
        <span className="col-head" style={{ flex: 1 }}>Asset type</span>
        <span className="col-head" style={{ width: 150, textAlign: 'right', flexShrink: 0 }}>Cost → Value</span>
        <span className="col-head" style={{ width: 110, textAlign: 'right', flexShrink: 0 }}>P&L</span>
        <span className="col-head" style={{ width: 92,  textAlign: 'right', flexShrink: 0 }}>Weight · drift</span>
      </div>

      {/* Largest weights first (the order the portfolio service ranks them in); the
          small asset types fold away. */}
      <ShowMore items={allocation} initial={5} noun="asset types" render={(a, i) => {
        const costWeight = totalCost ? (a.invested / totalCost) * 100 : 0;
        const drift      = a.weight - costWeight;
        const pnl        = a.value - a.invested;

        return (
          <div key={a.type} className="flex items-center justify-between" style={{ gap: 16 }}>
            <div className="flex items-center gap-2.5" style={{ minWidth: 0, flex: 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {assetTypeLabel(a.type)}
              </span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {a.symbols.length}
              </span>
            </div>

            <div className="figure text-xs" style={{ color: 'var(--color-text-muted)', width: 150, textAlign: 'right', flexShrink: 0 }}>
              {compactIfLarge(a.invested)} → {compactIfLarge(a.value)}
            </div>

            <div className="figure text-sm" style={{ color: pnlColor(pnl), width: 110, textAlign: 'right', flexShrink: 0 }}>
              {compactIfLarge(pnl)}
            </div>

            {/* Drift from the cost-basis weight: what the market did to your mix.
                Percentage POINTS, so it is deliberately printed without a % sign —
                "55% · +3.2" reads as a position and how far it has moved, where
                "+3.2%" would be read as a return. */}
            <div className="figure text-xs" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}
              title={`${a.weight.toFixed(1)}% of the book by value · ${drift >= 0 ? 'up' : 'down'} ${Math.abs(drift).toFixed(1)} points against its share of cost`}>
              {a.weight.toFixed(1)}%
              <span style={{ color: pnlColor(drift), marginLeft: 6, opacity: 0.85 }}>
                {drift >= 0 ? '+' : '−'}{Math.abs(drift).toFixed(1)}
              </span>
            </div>
          </div>
        );
      }} />
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
  useEffect(() => { loadPortfolio(); }, []);
  useEffect(() => { loadFlows(); },     [months]);

  const loadPortfolio = async () => {
    try {
      const p = await dashboardAPI.getPortfolio();
      setPortfolio(p.data);
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
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 5 }}>Today</p>
              <Delta value={totals.dayChange} pct={totals.dayChangePct} compact />
            </div>
          }
          band={
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
                <MastheadFigure
                  label="Invested"
                  value={compactIfLarge(totals.invested)}
                  sub={<p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Cost basis</p>}
                />
                <MastheadFigure
                  label="Unrealised P&L"
                  value={compactIfLarge(totals.unrealisedPnl)}
                  accent={pnlColor(totals.unrealisedPnl)}
                  sub={<p className="figure text-xs" style={{ color: pnlColor(totals.unrealisedPnl) }}>
                    {formatPct(totals.unrealisedPnlPct, 1)}
                  </p>}
                />
                <MastheadFigure
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
          <Card flush>
            <div style={{ padding: '22px 24px 8px' }}>
              <p className="eyebrow">Holdings</p>
            </div>
            <HoldingsTable holdings={holdings} />
          </Card>

          {/* Which holdings actually produced the number in the masthead. The book above
              lists what each one returned; this says what each one CONTRIBUTED, which is
              a different ranking — and the only one that adds up to the headline. */}
          <ContributionBreakdown />

          <Card>
            <SectionHeader
              eyebrow="Allocation"
              size="sm"
              sub="Weights are market value, not cost — the mix you have, not the one you chose"
              style={{ marginBottom: 24 }}
            />
            <AllocationBar items={allocation} />
            <AllocationDrift allocation={allocation} />
          </Card>
        </>
      ) : (
        <Card><Empty text="No holdings yet — add an asset to see performance" /></Card>
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
          sub={`Income, spending and the net cashflow between them · last ${months} months`}
          style={{ marginBottom: 20 }}
          action={<SegmentedControl options={RANGES} value={String(months)} onChange={k => setMonths(Number(k))} ariaLabel="Months" />}
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
            months={months}
            // Spending up is not a gain: the arrow still points up, the colour says red.
            invert
            emptyText="Nothing spent in this period"
          />
          <CategoryBreakdown
            title="Where it comes from"
            rows={icat}
            months={months}
            emptyText="No income in this period"
          />
        </div>
      )}
    </div>
  );
}
