import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, compactIfLarge, axisCompact, MONTHS_SHORT } from '../../lib/utils';

const DAY = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MAX_WEEKS = 53;
const LABEL_COL = 28;
const RHYTHM = 150;
const SIDE_GAP = 18;
const MIN_CELL = 9;
// Diverging scale around a typical day: three steps each side of a grey midpoint.
const INTENSITY = [30, 55, 82];
const LEGEND_RATIOS = [1 / 8, 1 / 3, 0.6, 1, 1.7, 3, 8];

const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekdayOf = (ms) => (new Date(ms).getUTCDay() + 6) % 7;   // Monday = 0

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Colour of a day against the typical (median) active day. Spending under it is green and
 * over it red; for income the poles swap. A day with nothing recorded stays neutral.
 */
function colorOf(v, typical, measure) {
  if (!v || !typical) return 'var(--color-bg-elevated)';
  const score = Math.log2(v / typical);
  if (Math.abs(score) < 0.25) return 'color-mix(in srgb, var(--color-text-muted) 38%, var(--color-bg-elevated))';
  const good = measure === 'in' ? score > 0 : score < 0;
  const step = Math.min(2, Math.floor(Math.abs(score)));
  const tone = good ? 'var(--color-success)' : 'var(--color-danger)';
  return `color-mix(in srgb, ${tone} ${INTENSITY[step]}%, var(--color-bg-elevated))`;
}

function dayTitle(ms) {
  const d = new Date(ms);
  return `${WEEKDAYS[weekdayOf(ms)]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Daily outflow (or income) as a calendar of weeks × weekdays, coloured against a typical
 * day, with the average per weekday beside the row it summarises. Clicking a day picks it.
 */
export default function SpendCalendar({ daily = [], from, to, activeDay, onSelectDay, measure = 'out' }) {
  const [hover, setHover] = useState(null);
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Measure before first paint, so the grid never draws once at a guessed size.
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    if (!to) return null;
    const end = parse(to);
    let start = from ? parse(from) : end - 89 * DAY;
    const gridStart = (ms) => ms - weekdayOf(ms) * DAY;
    let clipped = false;
    if ((end - gridStart(start)) / DAY / 7 > MAX_WEEKS) { start = end - (MAX_WEEKS * 7 - 1) * DAY; clipped = true; }
    const first = gridStart(start);
    const weeks = Math.floor((end - first) / DAY / 7) + 1;

    const byDay = new Map(daily.map(d => [d.date, d]));
    const cells = [];
    const actives = [];
    const wd = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
    for (let ms = first; ms <= end; ms += DAY) {
      const inside = ms >= start;
      const rec = byDay.get(iso(ms));
      const v = rec?.[measure] || 0;
      if (inside) {
        if (v) actives.push(v);
        wd[weekdayOf(ms)].total += v; wd[weekdayOf(ms)].days += 1;
      }
      cells.push({ ms, inside, v, count: rec?.count || 0,
        col: Math.floor((ms - first) / DAY / 7), row: weekdayOf(ms) });
    }

    // A month is named over the first column holding its 1st.
    const months = [];
    for (const c of cells) {
      const d = new Date(c.ms);
      if (c.inside && d.getUTCDate() === 1) months.push({ col: c.col, label: MONTHS_SHORT[d.getUTCMonth()] });
    }
    const avg = wd.map(w => (w.days ? w.total / w.days : 0));
    return { cells, weeks, months, avg, typical: median(actives), clipped };
  }, [daily, from, to, measure]);

  if (!model) return <div ref={boxRef} />;
  const { cells, weeks, months, avg, typical, clipped } = model;
  const avgMax = Math.max(...avg);
  const peak = avg.indexOf(avgMax);
  const gap = weeks > 30 ? 2 : 3;

  // Cells fill the width; when they would get too small beside the weekday column, it moves below.
  const besideFit = width ? Math.floor((width - LABEL_COL - SIDE_GAP - RHYTHM - gap * weeks) / weeks) : 14;
  const stacked = width > 0 && besideFit < MIN_CELL;
  const fit = stacked ? Math.floor((width - LABEL_COL - gap * weeks) / weeks) : besideFit;
  const cell = Math.max(4, Math.min(22, fit));
  const verb = measure === 'in' ? 'in' : 'out';
  const typicalRatio = hover?.v && typical ? hover.v / typical : null;

  return (
    <div>
      <div ref={boxRef} style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: SIDE_GAP, alignItems: stacked ? 'stretch' : 'flex-start', minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${LABEL_COL}px repeat(${weeks}, ${cell}px)`, gap, flexShrink: 0 }}>
          <span />
          {Array.from({ length: weeks }, (_, c) => {
            const m = months.find(x => x.col === c);
            return <span key={`m${c}`} style={{ color: 'var(--color-text-muted)', fontSize: 10, height: 14, whiteSpace: 'nowrap', overflow: 'visible' }}>{m?.label || ''}</span>;
          })}
          {WEEKDAYS.map((w, r) => (
            <Row key={w} r={r} label={r % 2 === 0 ? w : ''} weeks={weeks}
              cells={cells} cell={cell} typical={typical} measure={measure} activeDay={activeDay}
              onHover={setHover} onSelectDay={onSelectDay} />
          ))}
        </div>

        {/* Weekday rhythm: beside the grid, one bar per row it summarises; below it when narrow. */}
        <div style={stacked
          ? { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 }
          : { display: 'grid', gridTemplateRows: `14px repeat(7, ${cell}px)`, gap, minWidth: RHYTHM, maxWidth: 280, flex: 1 }}>
          {!stacked && <span className="col-head" style={{ fontSize: 9, lineHeight: '14px' }}>Avg / day</span>}
          {avg.map((a, r) => (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
              title={`${WEEKDAY_NAMES[r]}: ${formatCurrency(a)} ${verb} on an average ${WEEKDAY_NAMES[r]}`}>
              {stacked && <span style={{ fontSize: 10, color: 'var(--color-text-muted)', width: 24 }}>{WEEKDAYS[r]}</span>}
              <div style={{ flex: 1, height: stacked ? 6 : Math.max(4, cell - 9), borderRadius: 3, background: 'var(--color-bg-elevated)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, width: `${avgMax ? (a / avgMax) * 100 : 0}%`,
                  background: r === peak && a ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  opacity: r === peak && a ? 0.85 : 0.35,
                }} />
              </div>
              <span className="figure" style={{ fontSize: 10.5, color: 'var(--color-text-muted)', width: 40, textAlign: 'right', flexShrink: 0 }}>
                {a ? axisCompact(a, '₹') : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover readout and legend share one line, so the card never changes height. */}
      <div className="flex items-center" style={{ marginTop: 14, gap: 16, height: 18 }}>
        <p className="text-xs" style={{
          color: 'var(--color-text-muted)', flex: 1, minWidth: 0, height: 18, lineHeight: '18px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {hover
            ? <><span style={{ color: 'var(--color-text-secondary)' }}>{dayTitle(hover.ms)}</span>
                {' · '}{hover.v
                  ? <><span className="figure" style={{ color: 'var(--color-text-primary)' }}>{formatCurrency(hover.v)}</span> {verb}</>
                  : `nothing ${verb}`}
                {typicalRatio != null && <> · <span className="figure">{typicalRatio < 0.1 ? '<0.1' : typicalRatio >= 10 ? typicalRatio.toFixed(0) : typicalRatio.toFixed(1)}×</span> a typical day</>}
                {hover.count ? ` · ${hover.count} txn${hover.count === 1 ? '' : 's'}` : ''}</>
            : typical
              ? <>A typical day {measure === 'in' ? 'brings in' : 'costs'} <span className="figure">{compactIfLarge(Math.round(typical))}</span>;
                  {' '}{WEEKDAY_NAMES[peak]}s {measure === 'in' ? 'bring in' : 'cost'} the most.
                  {clipped ? ' Showing the last 12 months.' : ' Click a day to list it.'}</>
              : 'Nothing in this window yet.'}
        </p>
      </div>
    </div>
  );
}

/** The colour key, for the card header: kept out of the readout line so neither has to share it. */
export function CalendarLegend({ measure = 'out' }) {
  return (
    <div className="flex items-center" style={{ gap: 4, flexShrink: 0 }} aria-hidden>
      <span style={{ color: 'var(--color-text-muted)', marginRight: 4, fontSize: 10 }}>
        {measure === 'in' ? 'Less' : 'Under'}
      </span>
      {LEGEND_RATIOS.map((r, i) => (
        <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: colorOf(r, 1, measure) }} />
      ))}
      <span style={{ color: 'var(--color-text-muted)', marginLeft: 4, fontSize: 10 }}>
        {measure === 'in' ? 'More' : 'Over'}
      </span>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-bg-elevated)', marginLeft: 12, border: '1px solid var(--color-border-subtle)' }} />
      <span style={{ color: 'var(--color-text-muted)', marginLeft: 4, fontSize: 10 }}>None</span>
    </div>
  );
}

function Row({ r, label, weeks, cells, cell, typical, measure, activeDay, onHover, onSelectDay }) {
  const row = cells.filter(c => c.row === r);
  return (
    <>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: `${cell}px` }}>{label}</span>
      {Array.from({ length: weeks }, (_, col) => {
        const c = row.find(x => x.col === col);
        if (!c || !c.inside) return <span key={col} style={{ width: cell, height: cell }} />;
        const day = iso(c.ms);
        const on = day === activeDay;
        return (
          <button key={col} type="button"
            aria-label={`${dayTitle(c.ms)}: ${formatCurrency(c.v)}`}
            onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}
            onClick={() => onSelectDay?.(on ? null : day)}
            className="calendar-cell"
            style={{
              width: cell, height: cell, borderRadius: cell > 10 ? 3 : 2, padding: 0, cursor: 'pointer',
              background: colorOf(c.v, typical, measure),
              border: 'none',
              outline: on ? '1.5px solid var(--color-text-primary)' : 'none', outlineOffset: 1,
            }} />
        );
      })}
    </>
  );
}
