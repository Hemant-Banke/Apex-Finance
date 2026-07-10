import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import Popover from '../ui/Popover';

/**
 * DatePicker — value is a "YYYY-MM-DD" string.
 *
 * On touch devices (phones/tablets) it renders the native <input type="date">,
 * whose OS picker is already excellent. On desktop (fine pointer) it renders a
 * styled calendar popover.
 *
 * Props: { value, onChange, min, max, placeholder, disabled }  (min/max: "YYYY-MM-DD")
 *
 * DateRangePicker — a range variant. value is { from, to } (either may be null);
 * onChange receives the same shape. It opens a popover holding two ordinary
 * DatePickers (From / To) — clearer than a single dual-cursor calendar. Accepts
 * an optional `trigger` render-prop ({ open, toggle }) => node so callers can
 * supply their own anchor (e.g. an inline "from – to" summary with an edit icon).
 */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['S','M','T','W','T','F','S'];

const pad = n => String(n).padStart(2, '0');
const toISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-indexed
function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
function todayParts() {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
function fmtDisplay(iso) {
  const p = parseISO(iso);
  if (!p) return '';
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}, ${p.y}`;
}

// Detect coarse pointer (touch) once — desktop gets the custom calendar.
function useIsTouch() {
  const [touch] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  );
  return touch;
}

export default function DatePicker({ value, onChange, min, max, placeholder = 'Select date', disabled = false }) {
  const isTouch = useIsTouch();

  // ── Native picker on touch devices ──────────────────────────────────────────
  if (isTouch) {
    return (
      <input
        type="date"
        className="input-field"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  return <DesktopCalendar {...{ value, onChange, min, max, placeholder, disabled }} />;
}

export function DateRangePicker({ value, onChange, min, max, disabled = false, trigger }) {
  const isTouch = useIsTouch();
  const val = value || {};
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toggle = () => { if (!disabled) setOpen(o => !o); };

  // ── Native inputs on touch devices ──────────────────────────────────────────
  if (isTouch) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="date" className="input-field" value={val.from || ''} min={min} max={val.to || max}
          disabled={disabled} onChange={e => onChange({ from: e.target.value, to: val.to })} />
        <span style={{ color: 'var(--color-text-muted)' }}>–</span>
        <input type="date" className="input-field" value={val.to || ''} min={val.from || min} max={max}
          disabled={disabled} onChange={e => onChange({ from: val.from, to: e.target.value })} />
      </div>
    );
  }

  const rangeLabel = val.from || val.to
    ? `${val.from ? fmtDisplay(val.from) : '…'} – ${val.to ? fmtDisplay(val.to) : '…'}`
    : 'Select range';

  return (
    <div style={{ position: 'relative' }}>
      {trigger ? (
        <span ref={ref} style={{ display: 'inline-flex', minWidth: 0 }}>
          {trigger({ open, toggle })}
        </span>
      ) : (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          disabled={disabled}
          className="input-field"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', gap: 8,
            ...(open ? { borderColor: 'var(--color-accent)', background: 'var(--color-bg-secondary)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28), var(--shadow-md), 0 0 0 3px var(--color-accent-dim)' } : null),
          }}
        >
          <span style={{ flex: 1, color: (val.from || val.to) ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontSize: '0.875rem' }}>{rangeLabel}</span>
          <Calendar size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        </button>
      )}

      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={288} maxHeight={440}>
        <div style={{ background: 'var(--color-bg-popover)', border: '1px solid var(--color-border-hover)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-popover)', padding: 14, width: 288, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label className="label">From</label>
            <DatePicker value={val.from || ''} onChange={v => onChange({ from: v, to: val.to })} min={min} max={val.to || max} placeholder="Start date" />
          </div>
          <div className="field">
            <label className="label">To</label>
            <DatePicker value={val.to || ''} onChange={v => onChange({ from: val.from, to: v })} min={val.from || min} max={max} placeholder="End date" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, borderTop: '1px solid var(--color-border-subtle)', marginTop: 2 }}>
            <button type="button" onClick={() => onChange({ from: null, to: null })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.75rem', fontFamily: 'inherit', fontWeight: 500, paddingTop: 8 }}>
              Clear
            </button>
            <button type="button" onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.75rem', fontFamily: 'inherit', fontWeight: 600, paddingTop: 8 }}>
              Done
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function DesktopCalendar({ value, onChange, min, max, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('days'); // 'days' | 'months' | 'years'
  const selected = parseISO(value);
  const [view, setView] = useState(() => selected || todayParts()); // { y, m }
  const ref = useRef(null);

  // Re-centre the calendar on the selected month, then open (no setState-in-effect).
  const openCal = () => {
    if (disabled) return;
    setView(parseISO(value) || todayParts());
    setMode('days');
    setOpen(true);
  };

  const minP = parseISO(min);
  const maxP = parseISO(max);
  const cmp = (a, b) => (a.y - b.y) || (a.m - b.m) || ((a.d ?? 1) - (b.d ?? 1));
  const outOfRange = (y, m, d) => {
    const p = { y, m, d };
    if (minP && cmp(p, minP) < 0) return true;
    if (maxP && cmp(p, maxP) > 0) return true;
    return false;
  };
  // A whole month / year is unreachable if it falls entirely beyond min/max.
  const monthDisabled = (y, m) =>
    (maxP && (y > maxP.y || (y === maxP.y && m > maxP.m))) ||
    (minP && (y < minP.y || (y === minP.y && m < minP.m)));
  const yearDisabled = (y) =>
    (maxP && y > maxP.y) || (minP && y < minP.y);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth  = new Date(view.y, view.m + 1, 0).getDate();
  const today = todayParts();

  const shiftMonth = (delta) => {
    let m = view.m + delta, y = view.y;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setView({ y, m });
  };
  const shiftYear   = (delta) => setView(v => ({ ...v, y: v.y + delta }));
  const yearBlock   = view.y - (((view.y % 12) + 12) % 12); // first year of the 12-year grid

  const pick = (d) => {
    if (outOfRange(view.y, view.m, d)) return;
    onChange(toISO(view.y, view.m, d));
    setOpen(false);
  };

  const cell = (content, key, extra = {}) => (
    <div key={key} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', ...extra }}>{content}</div>
  );

  // Header ‹ › step depends on the active view.
  const headerPrev  = () => (mode === 'days' ? shiftMonth(-1) : mode === 'months' ? shiftYear(-1) : shiftYear(-12));
  const headerNext  = () => (mode === 'days' ? shiftMonth(1)  : mode === 'months' ? shiftYear(1)  : shiftYear(12));
  const headerLabel = mode === 'days' ? `${MONTHS[view.m]} ${view.y}`
                    : mode === 'months' ? `${view.y}`
                    : `${yearBlock} – ${yearBlock + 11}`;
  const headerClick = () => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'years');

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={ref}
        type="button"
        onClick={() => open ? setOpen(false) : openCal()}
        disabled={disabled}
        className="input-field"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', gap: 8,
          ...(open ? { borderColor: 'var(--color-accent)', background: 'var(--color-bg-secondary)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28), var(--shadow-md), 0 0 0 3px var(--color-accent-dim)' } : null),
        }}
      >
        <span style={{ flex: 1, color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          {value ? fmtDisplay(value) : placeholder}
        </span>
        <Calendar size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>

      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={264} maxHeight={360}>
        <div style={{ background: 'var(--color-bg-popover)', border: '1px solid var(--color-border-hover)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-popover)', padding: 12, width: 264 }}>

          {/* Header — ‹ [clickable label] › ; label drills days → months → years */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={headerPrev} style={navBtn}><ChevronLeft size={15} /></button>
            <button
              type="button"
              onClick={headerClick}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', padding: '4px 10px', borderRadius: 7 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {headerLabel}
            </button>
            <button type="button" onClick={headerNext} style={navBtn}><ChevronRight size={15} /></button>
          </div>

          {/* ── Days view ── */}
          {mode === 'days' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
                {WEEKDAYS.map((w, i) => cell(
                  <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{w}</span>,
                  `wd${i}`
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
                {Array.from({ length: firstWeekday }).map((_, i) => cell(null, `blank${i}`))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const isSel   = selected && selected.y === view.y && selected.m === view.m && selected.d === d;
                  const isToday = today.y === view.y && today.m === view.m && today.d === d;
                  const disabledDay = outOfRange(view.y, view.m, d);
                  return cell(
                    <button
                      type="button"
                      disabled={disabledDay}
                      onClick={() => pick(d)}
                      style={{
                        width: 28, height: 28, borderRadius: 7, border: isToday && !isSel ? '1px solid var(--color-border-hover)' : '1px solid transparent',
                        background: isSel ? 'var(--color-accent)' : 'transparent',
                        color: disabledDay ? 'var(--color-text-muted)' : isSel ? '#0B0D10' : 'var(--color-text-primary)',
                        fontSize: '0.8125rem', cursor: disabledDay ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        opacity: disabledDay ? 0.35 : 1, transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!isSel && !disabledDay) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {d}
                    </button>,
                    `d${d}`
                  );
                })}
              </div>
            </>
          )}

          {/* ── Months view ── */}
          {mode === 'months' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {MONTHS.map((mName, m) => {
                const isSel  = selected && selected.y === view.y && selected.m === m;
                const isCur  = today.y === view.y && today.m === m;
                const dis    = monthDisabled(view.y, m);
                return (
                  <button key={m} type="button" disabled={dis}
                    onClick={() => { setView({ y: view.y, m }); setMode('days'); }}
                    style={gridCellStyle(isSel, isCur, dis)}
                    onMouseEnter={e => { if (!isSel && !dis) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                    {mName.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Years view ── */}
          {mode === 'years' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {Array.from({ length: 12 }).map((_, i) => {
                const y = yearBlock + i;
                const isSel = selected && selected.y === y;
                const isCur = today.y === y;
                const dis   = yearDisabled(y);
                return (
                  <button key={y} type="button" disabled={dis}
                    onClick={() => { setView(v => ({ ...v, y })); setMode('months'); }}
                    style={gridCellStyle(isSel, isCur, dis)}
                    onMouseEnter={e => { if (!isSel && !dis) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          {/* Footer: Today shortcut */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { if (!outOfRange(today.y, today.m, today.d)) { onChange(toISO(today.y, today.m, today.d)); setOpen(false); } }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: '0.75rem', fontFamily: 'inherit', fontWeight: 500 }}
            >
              Today
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

const navBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 7, border: 'none', cursor: 'pointer',
  background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)',
};

// Shared cell style for the month & year grids.
function gridCellStyle(isSel, isCur, dis) {
  return {
    height: 36, borderRadius: 8,
    border: isCur && !isSel ? '1px solid var(--color-border-hover)' : '1px solid transparent',
    background: isSel ? 'var(--color-accent)' : 'transparent',
    color: dis ? 'var(--color-text-muted)' : isSel ? '#0B0D10' : 'var(--color-text-primary)',
    fontSize: '0.8125rem', fontFamily: 'inherit', fontWeight: 500,
    cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? 0.35 : 1, transition: 'background 0.1s',
  };
}
