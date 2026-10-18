import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { dashboardAPI } from '../../lib/api';
import { axisCompact, formatCurrency, formatPct, formatSigned, pnlColor, signedTone, MONTHS_SHORT } from '../../lib/utils';
import {
  rollUp, metricOf, periodStats, cashTotals, byWeekday, byCalendarMonth, scaleCap, periodLabel, maxDrawdown,
} from '../../lib/calendar';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import Spinner from '../ui/Spinner';
import GardenEmpty from '../ui/GardenEmpty';
import DivergingBar from '../ui/DivergingBar';
import { MastheadFigure } from '../ui/Masthead';
import { TooltipPanel } from '../charts/ChartTooltip';

/**
 * Performance by calendar period — the book's return and gain, and the cashflow, per day,
 * month and year. Every period is rolled up from the same daily rows, so a year is
 * exactly its months and a month exactly its days.
 */

const MEASURES = [{ key: 'assets', label: 'Investments' }, { key: 'cash', label: 'Cashflow' }];
const GRAINS = [{ key: 'day', label: 'Daily' }, { key: 'month', label: 'Monthly' }, { key: 'year', label: 'Yearly' }];
const METRICS = {
  assets: [{ key: 'ret', label: 'Return %' }, { key: 'gain', label: 'Gain ₹' }],
  cash:   [{ key: 'net', label: 'Net ₹' }, { key: 'saved', label: 'Saved %' }],
};
const NOUN = { day: ['day', 'days'], month: ['month', 'months'], year: ['year', 'years'] };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isPct = (m) => m === 'ret' || m === 'saved';

const full = (v, m) => (v == null ? '—' : isPct(m) ? formatPct(v, 2) : formatSigned(Math.round(v)));
const cell = (v, m) => {
  if (v == null) return '';
  if (isPct(m)) return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
  return `${v > 0 ? '+' : ''}${axisCompact(Math.round(v), '₹')}`;
};

function Tip({ hover, measure, today }) {
  if (!hover) return null;
  const { p, x, y } = hover;
  const partial = p.key.length < 10 && p.to === today;
  const rows = measure === 'assets'
    ? [['Return', formatPct(p.ret, 2), pnlColor(p.ret)], ['Gain', formatSigned(Math.round(p.gain)), pnlColor(p.gain)],
       ...(Math.abs(p.flow) >= 1 ? [['Bought − sold', formatSigned(Math.round(p.flow))]] : []),
       ...(p.value != null ? [['Book value', formatCurrency(Math.round(p.value))]] : [])]
    : [['In', formatCurrency(p.inc)], ['Out', formatCurrency(p.exp)],
       ['Net', formatSigned(Math.round(p.net)), pnlColor(p.net)], ['Saved', p.saved == null ? '—' : formatPct(p.saved, 1)]];
  const left = Math.min(x + 14, window.innerWidth - 230);
  return createPortal(
    <div style={{ position: 'fixed', left, top: y + 14, zIndex: 60, pointerEvents: 'none' }}>
      <TooltipPanel minWidth={200}>
        <div style={{ padding: '10px 12px' }}>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            {periodLabel(p.key)}{partial ? (p.key.length === 4 ? ' · YTD' : ' · MTD') : ''}
          </p>
          {measure === 'assets' && !p.invested
            ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Nothing invested yet</p>
            : rows.map(([k, v, c]) => (
              <div key={k} className="flex justify-between" style={{ gap: 16, padding: '2px 0' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{k}</span>
                <span className="figure text-xs" style={{ color: c || 'var(--color-text-primary)' }}>{v}</span>
              </div>
            ))}
        </div>
      </TooltipPanel>
    </div>,
    document.body,
  );
}

function Stats({ measure, metric, grain, scope, scopeLabel, days }) {
  const st = periodStats(scope, metric);
  if (!st) return null;
  const [one, many] = NOUN[grain];
  const muted = (t) => <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t}</span>;
  const moved = st.up + st.down;
  const streak = st.current ? `now ${Math.abs(st.current)} ${st.current > 0 ? 'up' : 'down'}` : 'no run going';
  const figs = [];

  if (measure === 'assets') {
    const total = metric === 'ret'
      ? (scope.some(p => p.ret != null) ? (scope.reduce((g, p) => g * (1 + (p.ret ?? 0) / 100), 1) - 1) * 100 : null)
      : scope.reduce((s, p) => s + (p.invested ? p.gain : 0), 0);
    figs.push([metric === 'ret' ? `Return · ${scopeLabel}` : `Gain · ${scopeLabel}`, full(total, metric), pnlColor(total),
      muted(metric === 'ret' ? 'time-weighted, flows removed' : 'buys and sells netted out')]);
  } else {
    const t = cashTotals(scope);
    figs.push([`Net · ${scopeLabel}`, formatSigned(Math.round(t.net)), pnlColor(t.net),
      muted(t.saved == null ? 'no income' : `${t.saved.toFixed(1)}% of ${formatCurrency(Math.round(t.inc))} kept`)]);
  }
  figs.push([`Best ${one}`, full(st.best.v, metric), pnlColor(st.best.v), muted(periodLabel(st.best.p.key))]);
  figs.push([`Worst ${one}`, full(st.worst.v, metric), pnlColor(st.worst.v), muted(periodLabel(st.worst.p.key))]);
  figs.push([measure === 'assets' ? `Up ${many}` : `${many[0].toUpperCase()}${many.slice(1)} in surplus`,
    `${st.up} of ${moved || st.n}`, null, muted(moved ? `${Math.round((st.up / moved) * 100)}%${st.flat ? ` · ${st.flat} flat` : ''}` : 'none moved')]);
  figs.push([`Average ${one}`, full(st.mean, metric), pnlColor(st.mean), muted(`median ${full(st.median, metric)}`)]);
  if (st.sd != null) figs.push(['Typical swing', isPct(metric) ? `±${st.sd.toFixed(2)}%` : `±${formatCurrency(Math.round(st.sd))}`, null, muted(`std. deviation per ${one}`)]);
  figs.push(['Longest run', `${st.longestUp} up · ${st.longestDown} down`, null, muted(streak)]);
  if (measure === 'assets') {
    const dd = maxDrawdown(days);
    if (dd) figs.push(['Deepest fall', formatPct(dd.pct, 1), 'var(--color-danger)', muted(`${periodLabel(dd.from).slice(5)} → ${periodLabel(dd.to).slice(5)}`)]);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 20, marginBottom: 26 }}>
      {figs.map(([label, value, accent, sub]) => <MastheadFigure key={label} tight label={label} value={value} accent={accent || undefined} sub={sub} />)}
    </div>
  );
}

// Today is marked with a dot, not a ring: an inset ring on a fractional-width cell renders unevenly.
const TodayDot = ({ corner }) => (
  <span aria-hidden style={{
    position: 'absolute', width: 4, height: 4, borderRadius: 99, background: 'var(--color-text-primary)',
    ...(corner ? { top: 4, right: 4 } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
  }} />
);

function Square({ p, v, cap, today, onHover, onClick }) {
  return (
    <button type="button" onClick={onClick}
      onMouseMove={e => onHover({ p, x: e.clientX, y: e.clientY })} onMouseLeave={() => onHover(null)}
      aria-label={periodLabel(p.key)}
      style={{
        position: 'relative', aspectRatio: '1', borderRadius: 4, border: 0, padding: 0, cursor: 'default',
        background: v == null ? 'var(--color-bg-elevated)' : signedTone(v, cap),
      }}>
      {p.key === today && <TodayDot />}
    </button>
  );
}

function DailyView({ days, metric, measure, year, today, onHover }) {
  const byKey = useMemo(() => new Map(days.map(p => [p.key, p])), [days]);
  const months = useMemo(() => rollUp(days.map(p => ({ ...p.raw })), 'month'), [days]);
  const cap = scaleCap(days.map(p => metricOf(p, metric)));
  const weekdays = byWeekday(days, metric);
  const wdMax = Math.max(0, ...weekdays.map(w => Math.abs(w.mean ?? 0)));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: '22px 20px' }}>
        {months.map(m => {
          const mi = +m.key.slice(5, 7) - 1;
          const first = Date.UTC(+year, mi, 1);
          const lead = (new Date(first).getUTCDay() + 6) % 7;
          const n = new Date(Date.UTC(+year, mi + 1, 0)).getUTCDate();
          const mv = metricOf(m, metric);
          return (
            <div key={m.key}>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 7 }}>
                <span className="col-head">{MONTHS_SHORT[mi]}</span>
                <span className="figure text-xs" style={{ color: pnlColor(mv) }}>{mv == null ? '' : full(mv, metric)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {WEEKDAYS.map(w => <span key={w} className="text-center" style={{ fontSize: 9, color: 'var(--color-text-muted)', paddingBottom: 2 }}>{w[0]}</span>)}
                {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: n }, (_, i) => {
                  const key = `${m.key}-${String(i + 1).padStart(2, '0')}`;
                  const p = byKey.get(key);
                  if (!p) return <span key={key} style={{ aspectRatio: '1', borderRadius: 4, boxShadow: 'inset 0 0 0 1px var(--color-border-subtle)' }} />;
                  return <Square key={key} p={p} v={metricOf(p, metric)} cap={cap} today={today} onHover={onHover} />;
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28 }}>
        <p className="col-head" style={{ marginBottom: 10 }}>By weekday · average {measure === 'assets' ? (metric === 'ret' ? 'return' : 'gain') : (metric === 'net' ? 'net' : 'saved')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 12 }}>
          {weekdays.map(w => (
            <div key={w.weekday} title={`${w.n} ${WEEKDAYS[w.weekday]}s with a figure`}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>{WEEKDAYS[w.weekday]}</p>
              <DivergingBar value={w.mean} max={wdMax} height={6} />
              <p className="figure text-xs" style={{ marginTop: 6, color: pnlColor(w.mean) }}>{w.mean == null ? '—' : full(w.mean, metric)}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MonthlyView({ months, years, metric, today, onHover, onPick }) {
  const byKey = new Map(months.map(p => [p.key, p]));
  const cap = scaleCap(months.map(p => metricOf(p, metric)));
  const yearCap = scaleCap(years.map(p => metricOf(p, metric)));
  const season = byCalendarMonth(months, metric);
  const th = { padding: '0 4px 8px', textAlign: 'center', fontWeight: 500 };
  const box = (bg) => ({ height: 32, padding: '0 4px', borderRadius: 5, textAlign: 'center', background: bg, whiteSpace: 'nowrap' });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, minWidth: 760 }}>
        <thead>
          <tr>
            <th className="col-head" style={{ ...th, textAlign: 'left' }}>Year</th>
            {MONTHS_SHORT.map(m => <th key={m} className="col-head" style={th}>{m}</th>)}
            <th className="col-head" style={th}>Year</th>
          </tr>
        </thead>
        <tbody>
          {[...years].reverse().map(y => (
            <tr key={y.key}>
              <td className="figure text-xs" style={{ paddingRight: 8, color: 'var(--color-text-secondary)' }}>{y.key}</td>
              {MONTHS_SHORT.map((_, i) => {
                const p = byKey.get(`${y.key}-${String(i + 1).padStart(2, '0')}`);
                const v = p ? metricOf(p, metric) : null;
                return (
                  <td key={i} className="figure text-xs"
                    onMouseMove={p ? e => onHover({ p, x: e.clientX, y: e.clientY }) : undefined}
                    onMouseLeave={() => onHover(null)} onClick={p ? () => onPick(y.key) : undefined}
                    style={{ ...box(p ? signedTone(v, cap) : 'transparent'), position: 'relative', cursor: p ? 'pointer' : 'default', color: 'var(--color-text-primary)',
                      boxShadow: !p ? 'inset 0 0 0 1px var(--color-border-subtle)' : undefined }}>
                    {cell(v, metric)}
                    {p?.to === today && <TodayDot corner />}
                  </td>
                );
              })}
              <td className="figure text-xs"
                onMouseMove={e => onHover({ p: y, x: e.clientX, y: e.clientY })} onMouseLeave={() => onHover(null)}
                style={{ ...box(signedTone(metricOf(y, metric), yearCap)), fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {cell(metricOf(y, metric), metric)}
              </td>
            </tr>
          ))}
        </tbody>
        {years.length > 1 && (
          <tfoot>
            <tr>
              <td className="text-xs" style={{ paddingTop: 6, color: 'var(--color-text-muted)' }} title="Each calendar month averaged across the years">Average</td>
              {season.map(s => (
                <td key={s.month} className="figure text-xs" title={`${s.n} year${s.n === 1 ? '' : 's'}`}
                  style={{ paddingTop: 6, textAlign: 'center', color: pnlColor(s.mean) }}>{cell(s.mean, metric)}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function YearlyView({ years, measure, metric, today, onHover, onPick }) {
  const max = Math.max(0, ...years.map(y => Math.abs(metricOf(y, metric) ?? 0)));
  const cols = measure === 'assets'
    ? [['Return', y => full(y.ret, 'ret'), y => pnlColor(y.ret)], ['Gain', y => full(y.invested ? y.gain : null, 'gain'), y => pnlColor(y.gain)],
       ['Bought − sold', y => formatSigned(Math.round(y.flow))], ['Value at end', y => (y.value == null ? '—' : formatCurrency(Math.round(y.value)))]]
    : [['In', y => formatCurrency(Math.round(y.inc))], ['Out', y => formatCurrency(Math.round(y.exp))],
       ['Net', y => formatSigned(Math.round(y.net)), y => pnlColor(y.net)], ['Saved', y => (y.saved == null ? '—' : formatPct(y.saved, 1)), y => pnlColor(y.saved)]];
  const grid = `72px minmax(120px, 1.4fr) repeat(${cols.length}, minmax(90px, 1fr))`;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, columnGap: 16, paddingBottom: 8 }}>
          <span className="col-head">Year</span><span />
          {cols.map(([h]) => <span key={h} className="col-head" style={{ textAlign: 'right' }}>{h}</span>)}
        </div>
        {[...years].reverse().map(y => (
          <div key={y.key} onClick={() => onPick(y.key)}
            onMouseMove={e => onHover({ p: y, x: e.clientX, y: e.clientY })} onMouseLeave={() => onHover(null)}
            style={{ display: 'grid', gridTemplateColumns: grid, columnGap: 16, alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--color-border-subtle)', cursor: 'pointer' }}>
            <span className="figure text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {y.key}{y.to === today && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}> · YTD</span>}
            </span>
            <DivergingBar value={metricOf(y, metric)} max={max} height={7} />
            {cols.map(([h, f, c]) => (
              <span key={h} className="figure text-sm" style={{ textAlign: 'right', color: c ? c(y) : 'var(--color-text-primary)' }}>{f(y)}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalendarPerformance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [measure, setMeasure] = useState('assets');
  const [grain, setGrain] = useState('month');
  const [metric, setMetric] = useState('ret');
  const [year, setYear] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    dashboardAPI.getCalendar()
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const model = useMemo(() => {
    const raw = data?.days || [];
    if (!raw.length) return null;
    const days = rollUp(raw, 'day').map((p, i) => ({ ...p, raw: raw[i] }));
    return { raw, days, months: rollUp(raw, 'month'), years: rollUp(raw, 'year'), today: raw[raw.length - 1].date };
  }, [data]);

  const pickMeasure = (m) => { setMeasure(m); setMetric(METRICS[m][0].key); };
  const pickYear = (y) => { setYear(y); setGrain('day'); };

  const body = () => {
    if (loading) return <Spinner height={260} />;
    if (!model) return <GardenEmpty compact icon={CalendarDays} title="Nothing on the calendar yet" text="Record income, spending or an investment and each day, month and year fills in here." />;
    // Only the years this measure has anything in: no cashflow was recorded before the first
    // income or expense, and nothing was invested before the first buy.
    const years = model.years.filter(y => (measure === 'assets' ? y.invested : y.active));
    if (!years.length) return <GardenEmpty compact icon={CalendarDays} title={measure === 'assets' ? 'Nothing invested yet' : 'No cashflow recorded yet'} text="As soon as there is, every day, month and year fills in here." />;
    const yearKeys = years.map(y => y.key);
    const yr = year && yearKeys.includes(year) ? year : yearKeys[yearKeys.length - 1];
    const yearDays = model.days.filter(p => p.key.startsWith(yr));
    const scope = grain === 'day' ? yearDays : grain === 'month' ? model.months.filter(m => yearKeys.includes(m.key.slice(0, 4))) : years;
    const scopeLabel = grain === 'day' ? yr : 'all time';
    const ddDays = (grain === 'day' ? model.raw.filter(d => d.date.startsWith(yr)) : model.raw);

    return (
      <>
        <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
          <SegmentedControl options={GRAINS} value={grain} onChange={setGrain} size="sm" ariaLabel="Granularity" />
          <SegmentedControl options={METRICS[measure]} value={metric} onChange={setMetric} size="sm" ariaLabel="Figure" />
          {grain === 'day' && yearKeys.length > 1 && (
            <SegmentedControl options={yearKeys.map(k => ({ key: k, label: k }))} value={yr} onChange={setYear} size="sm" ariaLabel="Year" style={{ marginLeft: 'auto' }} />
          )}
        </div>

        <Stats measure={measure} metric={metric} grain={grain} scope={scope} scopeLabel={scopeLabel} days={ddDays} />

        {grain === 'day' && <DailyView days={yearDays} metric={metric} measure={measure} year={yr} today={model.today} onHover={setHover} />}
        {grain === 'month' && <MonthlyView months={model.months} years={years} metric={metric} today={model.today} onHover={setHover} onPick={pickYear} />}
        {grain === 'year' && <YearlyView years={years} measure={measure} metric={metric} today={model.today} onHover={setHover} onPick={pickYear} />}

        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 20 }}>
          {measure === 'assets'
            ? 'Return is time-weighted: each day’s move on what was invested that morning, compounded — buys and sells never count as gains. Gain is in rupees, with the same flows removed; the days add up to the months and the months to the years.'
            : 'Income and spending as recorded, by the date on each transaction. Transfers between your own accounts and investment trades are not cashflow.'}
        </p>
        <Tip hover={hover} measure={measure} today={model.today} />
      </>
    );
  };

  return (
    <Card>
      <SectionHeader eyebrow="Calendar" size="sm" style={{ marginBottom: 20 }}
        sub="Every day, month and year — what the investments did, and what the cashflow was"
        action={<SegmentedControl options={MEASURES} value={measure} onChange={pickMeasure} ariaLabel="Measure" />} />
      {body()}
    </Card>
  );
}
