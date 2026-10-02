import { CHART_COLORS, compactIfLarge } from '../../lib/utils';
import AllocationBar, { CASH_TONE, OTHER_TONE } from '../portfolio/AllocationBar';
import { Figure } from '../portfolio/PortfolioProfile';

// Savings rate → band, on a −20…60% scale.
const BANDS = [
  { max: 0,   short: 'Overspending' },
  { max: 10,  short: 'Break-even' },
  { max: 25,  short: 'Saving' },
  { max: 40,  short: 'Strong' },
  { max: 999, short: 'Exceptional' },
];
const SCALE = { lo: -20, hi: 60 };
const toX = (v) => ((Math.min(SCALE.hi, Math.max(SCALE.lo, v)) - SCALE.lo) / (SCALE.hi - SCALE.lo)) * 100;

const pct = (v, d = 0) => `${v.toFixed(d)}%`;
const money = (v) => compactIfLarge(Math.round(v));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What kind of account the flows say this is — read from where money comes from and goes. */
function roleOf(d, isDebt) {
  const t = d.totals;
  const inflow  = t.income + t.transferIn + t.divested;
  const outflow = t.expense + t.transferOut + t.invested;
  if (isDebt) {
    const repaid = t.income + t.transferIn;
    if (!t.expense) return { label: 'Dormant card', inflow, outflow };
    const r = repaid / t.expense;
    return { label: r >= 0.98 ? 'Paid in full' : r >= 0.5 ? 'Partly repaid' : 'Balance building', inflow, outflow, repaidRatio: r };
  }
  const salaried = d.incomeRhythm?.category?.startsWith('tp_employment');
  const label =
      salaried && t.income >= inflow * 0.5                          ? 'Salary account'
    : t.transferIn >= inflow * 0.6 && t.expense >= outflow * 0.6    ? 'Spending account'
    : t.transferOut + t.invested >= outflow * 0.6                   ? 'Pass-through account'
    : inflow > 0 && (inflow - outflow) / inflow >= 0.4              ? 'Savings account'
    : 'Everyday account';
  return { label, inflow, outflow };
}

function spreadWord(s) {
  if (s == null) return null;
  return s < 0.2 ? 'Spending steady month to month' : s < 0.45 ? 'Spending varies month to month' : 'Spending swings widely month to month';
}

function SavingsScale({ rate }) {
  const lows = [SCALE.lo, ...BANDS.slice(0, -1).map(b => b.max)];
  return (
    <div title={`${rate.toFixed(1)}% of income kept`}>
      <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-danger) 70%, transparent), color-mix(in srgb, var(--color-text-muted) 40%, transparent) 30%, color-mix(in srgb, var(--color-success) 70%, transparent))' }}>
        {BANDS.slice(0, -1).map(b => (
          <span key={b.max} style={{ position: 'absolute', left: `${toX(b.max)}%`, top: -2, bottom: -2, width: 2, background: 'var(--color-bg-card)' }} />
        ))}
        <span style={{
          position: 'absolute', left: `${toX(rate)}%`, top: '50%', width: 14, height: 14, borderRadius: '50%',
          transform: 'translate(-50%, -50%)', background: 'var(--color-text-primary)',
          boxShadow: '0 0 0 3px var(--color-bg-card), var(--shadow-sm)',
        }} />
      </div>
      <div style={{ position: 'relative', height: 16, marginTop: 10 }}>
        {BANDS.map((b, i) => {
          const on = rate >= lows[i] && rate < b.max;
          const mid = (toX(lows[i]) + toX(Math.min(b.max, SCALE.hi))) / 2;
          return (
            <span key={b.max} className="text-xs" style={{
              position: 'absolute', left: `${mid}%`, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
              color: on ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontWeight: on ? 600 : 400,
            }}>{b.short}</span>
          );
        })}
      </div>
    </div>
  );
}

function Flow({ title, items, note }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return null;
  const withWeights = items.filter(i => i.value > 0).map(i => ({ ...i, value: Math.round(i.value), weight: (i.value / total) * 100 }));
  return (
    <div style={{ minWidth: 0 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 12 }}>
        <p className="col-head">{title}</p>
        <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{money(total)}</span>
      </div>
      <AllocationBar items={withWeights} height={10} />
      {note && <p className="text-xs" style={{ color: 'var(--color-chart-warm)', marginTop: 12 }}>{note}</p>}
    </div>
  );
}

/**
 * The cash-account counterpart of `PortfolioProfile`: what kind of account this is, a
 * typical month in figures, and where the money came from and went.
 */
export default function CashflowProfile({ data, balance = 0, isDebt, label }) {
  const t = data.totals;
  const role = roleOf(data, isDebt);
  const avgIn = data.averages.income, avgOut = data.averages.expense;
  const rate = !isDebt && t.income > 0 ? ((t.income - t.expense) / t.income) * 100 : null;
  const spendTotal = data.spend.essential + data.spend.discretionary + data.spend.other;
  const committed = data.recurring.reduce((s, r) => s + r.monthly, 0);
  const toInvest = data.destinations.filter(x => x.investment).reduce((s, x) => s + x.total, 0) + t.invested;
  const rhythm = data.incomeRhythm;

  const traits = [
    !isDebt && rhythm?.months >= 3 && rhythm.share >= 0.4 && rhythm.day && `${label(rhythm.category).split(' · ').pop()} lands around the ${ordinal(rhythm.day)} · ${rhythm.months} of ${rhythm.of} months`,
    !isDebt && role.inflow > 0 && toInvest / role.inflow >= 0.05 && `${pct((toInvest / role.inflow) * 100)} of inflow moved to investments`,
    isDebt && role.repaidRatio != null && `${pct(role.repaidRatio * 100)} of charges repaid in the window`,
    spreadWord(data.spendSpread),
  ].filter(Boolean);

  // Where it came from: income by source category, then each account that funded it.
  const incomeCats = data.categories.income;
  const cameFrom = [
    ...incomeCats.slice(0, 3).map((c, i) => ({ key: `i:${c._id}`, name: label(c._id).split(' · ').pop() || (isDebt ? 'Inflows' : 'Income'), value: c.total, color: CHART_COLORS[i] })),
    ...(incomeCats.length > 3 ? [{ key: 'i:rest', name: isDebt ? 'Other inflows' : 'Other income', value: incomeCats.slice(3).reduce((s, c) => s + c.total, 0), color: OTHER_TONE }] : []),
    ...data.sources.slice(0, 3).map((s, i) => ({ key: `s:${s.account}`, name: `From ${s.name}`, value: s.total, color: CHART_COLORS[4 + i] })),
    { key: 'sold', name: 'Investments sold', value: t.divested, color: CHART_COLORS[7] },
  ];

  const kept = role.inflow - role.outflow;
  const wentTo = [
    { key: 'ess',   name: 'Essentials',     value: data.spend.essential,     color: CHART_COLORS[1] },
    { key: 'disc',  name: 'Discretionary',  value: data.spend.discretionary, color: CHART_COLORS[3] },
    { key: 'oth',   name: 'Other spending', value: data.spend.other,         color: CHART_COLORS[5] },
    ...data.destinations.slice(0, 3).map((x, i) => ({ key: `d:${x.account}`, name: `To ${x.name}`, value: x.total, color: [CHART_COLORS[0], CHART_COLORS[2], CHART_COLORS[6]][i] })),
    { key: 'bought', name: 'Investments bought', value: t.invested, color: CHART_COLORS[7] },
    { key: 'kept', name: isDebt ? 'Paid down' : 'Kept', value: Math.max(0, kept), color: CASH_TONE },
  ];
  const shortfall = kept < 0 && role.inflow > 0
    ? (isDebt ? `Balance grew by ${money(-kept)} over the window` : `${money(-kept)} more went out than came in — drawn from the balance`)
    : null;

  const runway = !isDebt && avgOut > 0 && balance > 0 ? balance / avgOut : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ display: 'grid', gridTemplateColumns: rate != null ? 'minmax(0, 1fr) minmax(0, 1.3fr)' : '1fr', gap: 32, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <p className="col-head" style={{ marginBottom: 8 }}>Account profile</p>
          <p className="heading-lg" style={{ color: 'var(--color-text-primary)' }}>{role.label}</p>
          {traits.length > 0 && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>{traits.join(' · ')}</p>
          )}
        </div>
        {rate != null && <SavingsScale rate={rate} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 18 }}>
        {isDebt ? (
          <>
            <Figure label="Charged / month" value={money(avgOut)} sub={`over ${plural(data.window.activeMonths, 'active month')}`} />
            <Figure label="Inflows / month" value={money((t.transferIn + t.income) / Math.max(1, data.window.activeMonths))} sub="payments and refunds" />
          </>
        ) : (
          <>
            <Figure label="Earned / month" value={money(avgIn)} sub={`over ${plural(data.window.activeMonths, 'active month')}`} />
            <Figure label="Spent / month" value={money(avgOut)}
              sub={spendTotal ? `${pct((data.spend.essential / spendTotal) * 100)} on essentials` : 'nothing spent'} />
            {rate != null && (
              <Figure label="Saved" value={pct(rate)} sub={`${money(avgIn - avgOut)} a month`}
                title="Income less spending, as a share of income. Transfers out are not spending." />
            )}
            {runway != null && (
              <Figure label="Runway" value={runway >= 24 ? '24+ mo' : `${runway.toFixed(1)} mo`} sub="balance at this spending"
                title="Today's cash balance divided by an average month's spending from this account." />
            )}
          </>
        )}
        {committed > 0 && (
          <Figure label="Committed" value={money(committed)}
            sub={avgOut ? `${pct((committed / avgOut) * 100)} of spending` : plural(data.recurring.length, 'payment')}
            title="Payments that came back at about the same size month after month, as a monthly figure." />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 28 }}>
        <Flow title="Where it came from" items={cameFrom} />
        <Flow title="Where it went" items={wentTo} note={shortfall} />
      </div>
    </div>
  );
}
