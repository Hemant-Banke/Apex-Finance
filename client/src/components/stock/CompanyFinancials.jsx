import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import ShowMore from '../ui/ShowMore';
import ChartTooltip from '../charts/ChartTooltip';
import {
  CHART_COLORS, formatCrore, formatPct, pnlColor, axisCompact, fiscalYear, fiscalQuarter,
} from '../../lib/utils';

/**
 * How the BUSINESS has done, as opposed to the share — from the company's own filings.
 *
 * Three questions, each asked of the years and of the quarters:
 *   - **Revenue & profit** — is it growing, and is the growth reaching the bottom line?
 *   - **Debt** — how much does it owe against what it owns, and can it carry it?
 *   - **Cash flow** — do the profits turn into cash?
 *
 * The chart and the table under it answer the SAME question: switching the measure
 * switches both, so a column of figures never sits under a chart about something else.
 *
 * Indian companies publish results every quarter but their balance sheet and cash-flow
 * statement only every half-year and year. So the QUARTERLY debt and cash-flow views
 * show the nearest measures the quarterly results do carry — what the debt COSTS
 * (interest, and how many times operating profit covers it), and operating profit as the
 * quarter's cash engine — and each says so in a line, rather than pretending a quarterly
 * balance sheet exists.
 *
 * Every figure is computed on the server from the filings (`stockService`); this only
 * lays them out. Money is ₹ crore. Growth is year on year in both views — a quarter
 * against the same quarter a year earlier, never the one before it.
 */

const cr = (v) => formatCrore(v);
const signed = (v) => (v == null ? '—' : formatPct(v, 1));
const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const times = (v, d = 1) => (v == null ? '—' : `${v.toFixed(d)}×`);
const rupees = (v) => (v == null ? '—' : `₹${v.toFixed(2)}`);

/** Each column: label, the row field, how it prints, and whether its colour is gain/loss. */
const col = (label, field, fmt, toned = false) => ({ label, field, fmt, toned });

/**
 * The views, per measure and period. `bars` are the chart's two series (one unit, one
 * axis); `cols` the table; `note` the honest caveat where the filing does not exist.
 */
function viewFor(measure, period, isBank) {
  const q = period === 'quarterly';
  if (measure === 'pl') return {
    bars: [['revenue', 'Revenue'], ['netIncome', 'Net profit']],
    cols: [
      col('Revenue', 'revenue', cr), col('YoY', 'revenueGrowth', signed, true),
      col('Net profit', 'netIncome', cr, true), col('YoY', 'profitGrowth', signed, true),
      col('Net margin', 'netMargin', pct),
      ...(isBank ? [] : [col('Op. margin', 'operatingMargin', pct)]),
      col('EPS', 'eps', rupees),
    ],
  };

  if (measure === 'debt') {
    if (isBank) return {
      bars: q ? [['interest', 'Interest paid'], ['netIncome', 'Net profit']] : [['equity', "Shareholders' equity"], ['debt', 'Borrowings']],
      cols: q
        ? [col('Interest paid', 'interest', cr), col('Net profit', 'netIncome', cr, true), col('Net margin', 'netMargin', pct)]
        : [col('Equity', 'equity', cr), col('Borrowings', 'debt', cr), col('ROE', 'roe', pct)],
      note: 'For a bank, borrowing is the business — deposits and borrowings are its raw material — so debt-to-equity and interest cover do not apply.',
    };
    return q ? {
      bars: [['operatingProfit', 'Operating profit'], ['interest', 'Interest']],
      cols: [col('Operating profit', 'operatingProfit', cr, true), col('Interest', 'interest', cr), col('Interest cover', 'interestCover', times), col('Net profit', 'netIncome', cr, true)],
      note: 'Balance sheets are published half-yearly, so a quarter has no debt figure. What each quarter does show is what the debt costs — interest — and how many times operating profit covers it.',
    } : {
      bars: [['equity', "Shareholders' equity"], ['debt', 'Borrowings']],
      cols: [col('Equity', 'equity', cr), col('Borrowings', 'debt', cr), col('Debt / equity', 'debtToEquity', v => times(v, 2)), col('ROE', 'roe', pct), col('Interest cover', 'interestCover', times)],
    };
  }

  // Cash flow
  return q ? {
    bars: isBank ? [['netIncome', 'Net profit']] : [['operatingProfit', 'Operating profit'], ['netIncome', 'Net profit']],
    cols: isBank
      ? [col('Net profit', 'netIncome', cr, true), col('Net margin', 'netMargin', pct)]
      : [col('Operating profit', 'operatingProfit', cr, true), col('Op. margin', 'operatingMargin', pct), col('Net profit', 'netIncome', cr, true), col('Net margin', 'netMargin', pct)],
    note: 'Cash-flow statements are published half-yearly, so quarters carry none. Operating profit — earnings before interest, tax, depreciation and amortisation — is the quarter’s nearest measure of the cash the business generates.',
  } : {
    bars: [['ocf', 'Operating cash flow'], ['fcf', 'Free cash flow']],
    cols: [col('Operating cash', 'ocf', cr, true), col('Free cash', 'fcf', cr, true), col('Net profit', 'netIncome', cr, true),
      // Cash conversion: how much of the reported profit arrived as free cash.
      col('FCF / profit', 'cashConversion', v => (v == null ? '—' : `${v.toFixed(0)}%`))],
  };
}

const MEASURES = [
  { key: 'pl', label: 'Revenue & profit' },
  { key: 'debt', label: 'Debt' },
  { key: 'cash', label: 'Cash flow' },
];
const PERIODS = [{ key: 'annual', label: 'Annual' }, { key: 'quarterly', label: 'Quarterly' }];

export default function CompanyFinancials({ financials }) {
  const [period, setPeriod] = useState('annual');
  const [measure, setMeasure] = useState('pl');
  if (!financials?.annual?.length && !financials?.quarterly?.length) return null;

  const isBank = financials.kind === 'bank';
  const view = viewFor(measure, period, isBank);
  const label = period === 'annual' ? (d) => fiscalYear(d) : (d) => fiscalQuarter(d)?.short || d;

  const rows = (financials[period] || []).map(r => ({
    ...r,
    cashConversion: r.fcf != null && r.netIncome > 0 ? (r.fcf / r.netIncome) * 100 : null,
  }));
  const chartRows = rows.map(r => Object.fromEntries([['date', label(r.date)], ...view.bars.map(([k]) => [k, r[k]])]));
  const grid = `${period === 'annual' ? 64 : 116}px repeat(${view.cols.length}, minmax(80px, 1fr))`;

  return (
    <Card>
      <SectionHeader
        eyebrow="Company performance"
        size="sm"
        sub={`${financials.consolidated ? 'Consolidated' : 'Standalone'} filings · ₹ crore · growth is year on year`}
        style={{ marginBottom: 16 }}
        action={<SegmentedControl ariaLabel="Period" value={period} onChange={setPeriod} options={PERIODS} />}
      />
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl ariaLabel="Measure" value={measure} onChange={setMeasure} options={MEASURES} />
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartRows} barGap={3} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#878D97', fontSize: 11 }} axisLine={false} tickLine={false} width={46} tickFormatter={v => axisCompact(v)} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} isAnimationActive={false}
            content={<ChartTooltip formatValue={v => formatCrore(v)} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#878D97', paddingTop: 10 }} iconType="circle" iconSize={7} />
          {view.bars.map(([key, name], i) => (
            <Bar key={key} dataKey={key} name={name} fill={CHART_COLORS[i === 0 ? 1 : 0]} radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {view.note && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.55 }}>{view.note}</p>
      )}

      <div style={{ overflowX: 'auto', marginTop: 18 }}>
        <div style={{ minWidth: 140 + view.cols.length * 92 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, paddingBottom: 9, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">{period === 'annual' ? 'Year' : 'Quarter'}</span>
            {/* Keyed by FIELD: two columns share the label "YoY", and duplicate keys left
                stale cells behind when the measure switched. */}
            {view.cols.map(c => <span key={c.field} className="col-head" style={{ textAlign: 'right' }}>{c.label}</span>)}
          </div>
          {/* Newest first — the period being judged is the one just reported; the rest
              of the history folds. */}
          <ShowMore items={[...rows].reverse()} initial={5} noun={period === 'annual' ? 'years' : 'quarters'} render={(r) => (
            <div key={r.date} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {period === 'annual' ? fiscalYear(r.date) : fiscalQuarter(r.date)?.fq || r.date}
              </span>
              {view.cols.map(c => (
                <span key={c.field} className="figure text-xs" style={{
                  textAlign: 'right',
                  color: r[c.field] == null ? 'var(--color-text-muted)' : c.toned ? pnlColor(r[c.field]) : 'var(--color-text-secondary)',
                }}>
                  {c.fmt(r[c.field])}
                </span>
              ))}
            </div>
          )} />
        </div>
      </div>
    </Card>
  );
}
