import { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ArrowLeftRight, X } from 'lucide-react';
import { dashboardAPI } from '../../lib/api';
import { formatCurrency, compactIfLarge, axisCompact, formatPoints, formatPct, formatSigned, pnlColor, monthLabel, MONTHS_SHORT, CHART_COLORS } from '../../lib/utils';
import { SOURCES, USES, flowValues, sumRows, isActive, flowRatios } from '../../lib/moneyFlow';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import Spinner from '../ui/Spinner';
import GardenEmpty from '../ui/GardenEmpty';
import Divider from '../ui/Divider';
import BandCursor from './BandCursor';
import { TooltipPanel } from './ChartTooltip';

const CASH_HOME = { bank: 'bank accounts', brokerage: 'brokerage accounts', retirement: 'retirement accounts', wallet: 'wallets', other: 'other accounts' };

const RANGES = [6, 12, 24].map(m => ({ key: String(m), label: `${m}M` }));

const monthTick = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return key;
  return m[2] === '01' ? `Jan ${m[1].slice(2)}` : MONTHS_SHORT[+m[2] - 1];
};

/** One side of the ledger: its total, a bar of its parts, and the parts themselves. */
function Side({ title, parts, total }) {
  const shown = parts.filter(p => p.value > 0.5);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <p className="col-head">{title}</p>
        <p className="figure" style={{ fontSize: '1.0625rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{formatCurrency(total)}</p>
      </div>
      <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 99, overflow: 'hidden', margin: '12px 0 14px', background: 'var(--color-bg-elevated)' }}>
        {shown.map(p => <span key={p.key} title={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      {shown.map(p => (
        <div key={p.key} title={p.hint} style={{ display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) auto 46px', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
          <span className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>{formatCurrency(p.value)}</span>
          <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', textAlign: 'right' }}>{((p.value / total) * 100).toFixed(0)}%</span>
        </div>
      ))}
      {!shown.length && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Nothing moved.</p>}
    </div>
  );
}

function FlowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const uses = USES.filter(u => row[u.key] > 0.5);
  return (
    <TooltipPanel minWidth={200}>
      <div style={{ padding: '6px 12px', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <p className="figure" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', margin: 0 }}>{monthLabel(`${label}-01`)}</p>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[{ key: 'income', label: 'Income', color: CHART_COLORS[1] }, ...uses].map(p => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color }} />
            <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{p.label}</span>
            <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{compactIfLarge(row[p.key])}</span>
          </div>
        ))}
        {(row.invested > 0.5 || row.sold > 0.5) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 5, marginTop: 2 }}>
            <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>Net invested</span>
            <span className="figure" style={{ color: 'var(--color-text-primary)' }}>{formatSigned(row.invested - row.sold, compactIfLarge)}</span>
          </div>
        )}
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>Click to see this month in full</p>
      </div>
    </TooltipPanel>
  );
}

function Insight({ label, figure, change, invertChange, note, children }) {
  return (
    <div style={{ minWidth: 0, padding: '14px 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{label}</p>
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
        <span className="figure" style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>{figure}</span>
        {change != null && Math.abs(change) >= 0.05 && (
          <span className="figure text-xs" style={{ color: pnlColor(invertChange ? -change : change) }}>{formatPoints(change)} on the period before</span>
        )}
        {note}
      </p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 5, lineHeight: 1.45 }}>{children}</p>
    </div>
  );
}

const pct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`);
const diff = (a, b) => (a == null || b == null ? null : a - b);
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Where each month's money came from and where it went: the months, one month (or the average) in full, and what it adds up to. */
export default function MoneyFlow() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [focus, setFocus] = useState(null);   // a month key, or null for the average month

  useEffect(() => {
    let live = true;
    dashboardAPI.getMoneyFlow(months)
      .then(r => live && setData(r.data))
      .catch(() => live && setData({ months: [], prev: null }));
    return () => { live = false; };
  }, [months]);

  const rows = useMemo(() => data?.months || [], [data]);
  const active = useMemo(() => rows.filter(isActive), [rows]);
  const chartRows = useMemo(() => rows.map(r => ({ month: r.month, ...flowValues(r) })), [rows]);

  if (!data) return <Card><Spinner height={260} /></Card>;

  const header = (
    <SectionHeader eyebrow="Money flow" size="sm" style={{ marginBottom: 20 }}
      sub={`Where each month's money came from, and where it went · last ${rows.length} month${rows.length === 1 ? '' : 's'}`}
      action={<SegmentedControl options={RANGES} value={String(months)} onChange={k => { setFocus(null); setMonths(Number(k)); }} ariaLabel="Months" />} />
  );
  if (!active.length) {
    return <Card>{header}<GardenEmpty card={false} compact icon={ArrowLeftRight} title="No money has moved yet" text="Income, spending, transfers and trades appear here month by month." /></Card>;
  }

  const total = sumRows(active);
  const focused = focus ? rows.find(r => r.month === focus) : null;
  const shown = flowValues(focused || sumRows(active, active.length));
  const sources = SOURCES.map(s => ({ ...s, value: shown[s.key] }));
  const uses = USES.map(u => ({ ...u, value: shown[u.key] }));
  const sideTotal = sources.reduce((s, p) => s + p.value, 0);

  // ── What the window adds up to ──
  const now = flowRatios(total), before = flowRatios(data.prev);
  const investedMonths = active.filter(r => r.invested - r.sold > 0).length;
  const over = active.filter(r => r.spent > r.income);
  const cover = sumRows(over.map(r => ({ ...r, cash: Math.min(0, r.cash), debt: Math.min(0, r.debt) })));
  const covers = [
    cover.cash < 0 && `drawing ${compactIfLarge(-cover.cash)} from cash`,
    cover.sold > 0 && `selling ${compactIfLarge(cover.sold)} of investments`,
    cover.debt < 0 && `borrowing ${compactIfLarge(-cover.debt)}`,
  ].filter(Boolean);
  const avgSpend = total.spent / active.length;
  const cashTypes = Object.entries(total.cashByType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const netInvested = total.invested - total.sold;
  const netAvg = netInvested / active.length;
  const prevNetAvg = data.prev?.months ? (data.prev.invested - data.prev.sold) / data.prev.months : null;
  const netChange = prevNetAvg > 0 ? ((netAvg - prevNetAvg) / prevNetAvg) * 100 : null;
  const shownNet = shown.invested - shown.sold;

  return (
    <Card>
      {header}

      <div style={{ width: '100%', cursor: 'pointer' }}>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            onClick={(e) => e?.activeLabel && setFocus(f => (f === e.activeLabel ? null : e.activeLabel))}>
            <XAxis dataKey="month" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} tickFormatter={monthTick} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => axisCompact(v, '₹')} width={50} />
            <Tooltip cursor={<BandCursor count={chartRows.length} />} content={<FlowTooltip />} isAnimationActive={false} />
            <ReferenceLine y={0} stroke="var(--color-border-hover)" />
            {USES.map((u, i) => (
              <Bar key={u.key} dataKey={u.key} name={u.label} stackId="uses" fill={u.color} maxBarSize={26}
                radius={i === USES.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false}
                fillOpacity={focus ? 0.35 : 1} activeBar={false} />
            ))}
            {/* Income against the stack: a stack above the line was paid for by cash, sales or borrowing. */}
            <Line dataKey="income" name="Income" type="monotone" stroke={CHART_COLORS[1]} strokeWidth={1.75}
              dot={{ r: 2.5, fill: CHART_COLORS[1], strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
            {focus && <ReferenceLine x={focus} stroke="var(--color-text-secondary)" strokeDasharray="3 3" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12 }}>
        {[{ key: 'income', label: 'Income (line)', color: CHART_COLORS[1] }, ...USES].map(p => (
          <span key={p.key} className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color }} />{p.label}
          </span>
        ))}
      </div>

      <Divider margin={22} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <p className="eyebrow">{focused ? monthLabel(`${focused.month}-01`) : `Average month · over ${active.length}`}</p>
        {focused
          ? <button type="button" onClick={() => setFocus(null)} className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={12} /> Back to the average</button>
          : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Click a month on the chart to see it alone</p>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px 40px' }}>
        <Side title="Came from" parts={sources} total={sideTotal} />
        <Side title="Went to" parts={uses} total={sideTotal} />
      </div>
      {(shown.invested > 0.5 || shown.sold > 0.5) && (
        <p className="text-sm" style={{ marginTop: 16, color: 'var(--color-text-muted)' }}>
          Net invested{focused ? ' this month' : ' a month'}{' '}
          <span className="figure" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{formatSigned(shownNet, compactIfLarge)}</span>
          {' '}· {compactIfLarge(shown.invested)} bought − {compactIfLarge(shown.sold)} sold
        </p>
      )}

      <Divider margin={22} />

      <p className="eyebrow" style={{ marginBottom: 4 }}>What it adds up to</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', columnGap: 40 }}>
        <Insight label="Savings rate" figure={pct(now.savings)} change={diff(now.savings, before?.savings)}>
          Of {compactIfLarge(total.income)} earned, {compactIfLarge(total.spent)} was spent and {compactIfLarge(Math.max(0, total.income - total.spent))} kept.
        </Insight>
        <Insight label="Net invested" figure={formatSigned(netInvested, compactIfLarge)}
          note={netChange != null && Math.abs(netChange) >= 0.5 && (
            <span className="figure text-xs" style={{ color: pnlColor(netChange) }}>{formatPct(netChange, 0)} a month on the period before</span>
          )}>
          {compactIfLarge(total.invested)} bought, {compactIfLarge(total.sold)} sold · {formatSigned(netAvg, compactIfLarge)} a month on average.
        </Insight>
        <Insight label="Invested from income" figure={pct(now.invest)} change={diff(now.invest, before?.invest)}>
          {netInvested >= 0
            ? <>{compactIfLarge(netInvested)} went into investments{total.sold > 0 ? <>, after {compactIfLarge(total.sold)} sold</> : null}.</>
            : <>You took {compactIfLarge(-netInvested)} more out of investments than you put in.</>}
        </Insight>
        <Insight label="Months you invested" figure={`${investedMonths} of ${active.length}`}>
          {investedMonths === active.length ? 'Money went into investments every month.'
            : investedMonths === 0 ? 'Nothing net went into investments in this period.'
            : `${active.length - investedMonths} month${active.length - investedMonths === 1 ? '' : 's'} put nothing net into investments.`}
        </Insight>
        <Insight label="Months spending beat income" figure={`${over.length} of ${active.length}`}>
          {over.length ? <>Those months were covered by {covers.length ? joinAnd(covers) : 'money from outside'}.</> : 'Every month’s spending was paid for out of that month’s income.'}
        </Insight>
        <Insight label={total.cash >= 0 ? 'Added to cash' : 'Drawn from cash'} figure={compactIfLarge(Math.abs(total.cash))}>
          {total.cash >= 0
            ? <>{avgSpend > 0 ? `${(total.cash / avgSpend).toFixed(1)} months of spending` : 'Cash'} left uninvested{cashTypes.length ? <>, mostly in {CASH_HOME[cashTypes[0][0]] || 'your accounts'}</> : null}.</>
            : <>Cash balances fell by {avgSpend > 0 ? `${(-total.cash / avgSpend).toFixed(1)} months of spending` : 'this much'} over the period.</>}
        </Insight>
        <Insight label="Lifestyle share of spending" figure={pct(now.lifestyle)} change={diff(now.lifestyle, before?.lifestyle)} invertChange>
          {compactIfLarge(total.discretionary)} on wants, {compactIfLarge(total.essential)} on essentials{total.otherSpend > 0 ? <>, {compactIfLarge(total.otherSpend)} unclassified</> : null}.
        </Insight>
      </div>
    </Card>
  );
}
