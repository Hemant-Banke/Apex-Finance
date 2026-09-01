import { useState, useEffect } from 'react';
import { dashboardAPI, accountsAPI } from '../lib/api';
import { getCategoryMap, describeCategory } from '../lib/categoryNames';
import {
  formatCurrency, compactIfLarge, formatPct, pnlColor, CHART_COLORS,
} from '../lib/utils';
import { assetTypeLabel } from '../lib/constants';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import { useToast } from '../context/ToastContext';
import PriceGrapher from '../components/charts/PriceGrapher';
import ChartTooltip from '../components/charts/ChartTooltip';
import AssetPricePanel from '../components/charts/AssetPricePanel';
import HoldingsTable from '../components/portfolio/HoldingsTable';
import AllocationBar from '../components/portfolio/AllocationBar';
import SellHoldingModal from '../components/portfolio/SellHoldingModal';

const RANGES = [6, 12, 24];

/**
 * The month range, placed ON the section it governs.
 *
 * It used to live in the page header, which read as though it scoped the whole page —
 * but it has never touched the portfolio, whose holdings and P&L are a position as of
 * now, not a window. It only ever drove the cashflow and the expense breakdown, so it
 * belongs on those.
 */
function RangePicker({ months, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {RANGES.map(r => (
        <button key={r} onClick={() => onChange(r)}
          className="text-xs font-medium"
          style={{
            padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
            border: '1px solid ' + (months === r ? 'var(--color-accent-dim)' : 'var(--color-border-subtle)'),
            background: months === r ? 'var(--color-accent-dim)' : 'transparent',
            color: months === r ? 'var(--color-accent)' : 'var(--color-text-muted)',
          }}>
          {r}M
        </button>
      ))}
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

/** A headline figure, plain. */
function Figure({ label, value, accent, sub }) {
  return (
    <div>
      <p className="heading-sm" style={{ letterSpacing: '0.1em', marginBottom: 10 }}>{label}</p>
      <p className="figure" style={{ fontSize: '1.35rem', fontWeight: 500, lineHeight: 1.1, color: accent || 'var(--color-text-primary)' }}>
        {value}
      </p>
      {sub && <div style={{ marginTop: 6 }}>{sub}</div>}
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
      {allocation.map((a, i) => {
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

            {/* Drift from the cost-basis weight: what the market did to your mix. */}
            <div className="figure text-xs" style={{ width: 92, textAlign: 'right', flexShrink: 0, color: 'var(--color-text-secondary)' }}>
              {a.weight.toFixed(1)}%
              <span style={{ color: pnlColor(drift), marginLeft: 6, opacity: 0.85 }}>
                {drift >= 0 ? '+' : '−'}{Math.abs(drift).toFixed(1)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Analytics() {
  const toast = useToast();
  const [months,    setMonths]    = useState(12);
  const [portfolio, setPortfolio] = useState(null);
  const [ie,        setIe]        = useState([]);
  const [ec,        setEc]        = useState([]);
  const [loading,   setLoading]   = useState(true);
  // Selling from the book. `sellHolding` doubles as the modal's open flag; `accounts`
  // is only needed to name the account a sale draws from, so it loads alongside.
  const [accounts,    setAccounts]    = useState([]);
  const [sellHolding, setSellHolding] = useState(null);

  // The portfolio is a position as of NOW; the flows are a window. They are refetched on
  // different triggers, so changing the range does not re-price the whole book.
  useEffect(() => { loadPortfolio(); }, []);
  useEffect(() => { loadFlows(); },     [months]);
  useEffect(() => { accountsAPI.getAll().then(r => setAccounts(r.data)).catch(() => {}); }, []);

  const loadPortfolio = async () => {
    try {
      const p = await dashboardAPI.getPortfolio();
      setPortfolio(p.data);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load portfolio'); }
    finally { setLoading(false); }
  };

  const loadFlows = async () => {
    try {
      const [b, d, cats] = await Promise.all([
        dashboardAPI.getIncomeExpense(months),
        dashboardAPI.getExpenseCategories(months),
        getCategoryMap(),
      ]);
      setIe(b.data);
      // A category code is an internal handle, not a label — look up the real name.
      setEc(d.data.map(x => ({
        ...x,
        name:  x._id ? describeCategory(x._id, cats).label : 'Uncategorised',
        emoji: x._id ? describeCategory(x._id, cats).emoji : '',
      })));
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load cashflow'); }
  };

  if (loading) return <Spinner />;

  const totals     = portfolio?.totals   || {};
  const holdings   = portfolio?.holdings || [];
  const allocation = portfolio?.allocation || [];
  const hasPortfolio = holdings.length > 0;

  const flowMonths = ie.filter(m => m.income || m.expense);
  const totalIncome  = ie.reduce((s, m) => s + m.income, 0);
  const totalExpense = ie.reduce((s, m) => s + m.expense, 0);
  const overallRate  = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null;

  const topExpense = ec.slice(0, 10);
  const maxExpense = Math.max(...topExpense.map(c => c.total), 0);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      <SectionHeader
        eyebrow="Analytics"
        title="Performance"
        sub="How the portfolio and the cashflow have actually done"
      />

      {/* Sell straight from the book. The holding carries its per-account split, so the
          form can offer the account the units actually sit in. */}
      <SellHoldingModal
        holding={sellHolding}
        accounts={accounts}
        onClose={() => setSellHolding(null)}
        onSuccess={() => { setSellHolding(null); loadPortfolio(); }}
      />

      <PriceGrapher height={280} emptyText="Add transactions to see your net worth trend" growthCapable />

      {/* ── Portfolio ─────────────────────────────────────────────────────── */}
      {hasPortfolio ? (
        <>
          <Card>
            <SectionHeader eyebrow="Portfolio" size="sm" style={{ marginBottom: 24 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 24 }}>
              <Figure label="Invested" value={compactIfLarge(totals.invested)} />
              <Figure
                label="Market value"
                value={compactIfLarge(totals.value)}
                sub={<Delta value={totals.dayChange} pct={totals.dayChangePct} compact />}
              />
              <Figure
                label="Unrealised P&L"
                value={compactIfLarge(totals.unrealisedPnl)}
                accent={pnlColor(totals.unrealisedPnl)}
                sub={<p className="figure text-xs" style={{ color: pnlColor(totals.unrealisedPnl) }}>
                  {formatPct(totals.unrealisedPnlPct, 1)}
                </p>}
              />
              <Figure
                label="Realised P&L"
                value={compactIfLarge(totals.realisedPnl)}
                accent={pnlColor(totals.realisedPnl)}
                sub={<p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Booked on sales</p>}
              />
            </div>

            {!totals.priced && (
              <p className="text-xs" style={{ color: 'var(--color-chart-warm)', marginTop: 20 }}>
                Some holdings have no live quote and are shown at cost — their P&L is unknown, not zero.
              </p>
            )}
          </Card>

          <Card flush>
            <div style={{ padding: '22px 24px 8px' }}>
              <p className="eyebrow">Holdings</p>
            </div>
            <HoldingsTable holdings={holdings} onSell={setSellHolding} />
          </Card>

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

          <AssetPricePanel holdings={holdings} title="Asset prices" height={300} />
        </>
      ) : (
        <Card><Empty text="No holdings yet — add an asset to see performance" /></Card>
      )}

      {/* ── Cashflow ──────────────────────────────────────────────────────── */}
      <Card>
        <SectionHeader
          eyebrow="Income vs expense"
          size="sm"
          style={{ marginBottom: 20 }}
          action={
            <div className="flex items-center" style={{ gap: 16 }}>
              {overallRate != null && (
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Saved <span className="figure" style={{ color: pnlColor(overallRate) }}>{overallRate.toFixed(0)}%</span> of income
                </span>
              )}
              <RangePicker months={months} onChange={setMonths} />
            </div>
          }
        />
        {flowMonths.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ie} barGap={4} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false} dy={8}
                tickFormatter={m => m.slice(5)} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#626873', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => `₹${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} width={46} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} isAnimationActive={false} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#626873', paddingTop: 12 }} iconType="circle" iconSize={7} />
              {/* Income and expense are the same measure on one scale, so they share an
                  axis honestly. Green/red here are STATUS, not category identity. */}
              <Bar dataKey="income"  name="Income"  fill="var(--color-success)" radius={[4,4,0,0]} maxBarSize={22} />
              <Bar dataKey="expense" name="Expense" fill="var(--color-danger)"  radius={[4,4,0,0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty text="No income or expenses in this period" height={260} />}
      </Card>

      {/* Where it goes */}
      {topExpense.length > 0 && (
        <Card>
          <SectionHeader
            eyebrow={`Where it goes · top ${topExpense.length}`}
            size="sm"
            sub={`Over the last ${months} months`}
            style={{ marginBottom: 24 }}
            action={
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {compactIfLarge(totalExpense)} total
              </span>
            }
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {topExpense.map((cat, i) => (
              <div key={cat._id || i}>
                <div className="flex items-center justify-between" style={{ marginBottom: 7, gap: 12 }}>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {cat.emoji && <span>{cat.emoji}</span>}
                    <span className="truncate">{cat.name}</span>
                    <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      ×{cat.count}
                    </span>
                  </span>
                  <span className="figure text-sm" style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>
                    {formatCurrency(cat.total)}
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      {totalExpense ? ((cat.total / totalExpense) * 100).toFixed(0) : 0}%
                    </span>
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 99, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: `${maxExpense ? (cat.total / maxExpense) * 100 : 0}%`,
                    background: CHART_COLORS[i % CHART_COLORS.length],
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
