import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, ComposedChart,
  usePlotArea, useYAxisScale
} from 'recharts';
import { TrendingUp, TrendingDown, Plus, Calendar } from 'lucide-react';
import { networthAPI, marketAPI } from '../../lib/api';
import { formatCurrency, compactIfLarge, formatPct, CHART_COLORS, MONTHS_SHORT as MONTHS, todayStr, ACTIVE_DOT } from '../../lib/utils';
import { indicatorTypeOf, indicatorLabel, computeIndicator, lookbackDays, paddedDays } from '../../lib/indicators';
import { DateRangePicker } from '../forms/DatePicker';
import { BENCHMARKS } from '../../lib/constants';
import { loadStudies, saveIndicators, saveCompareChange } from '../../lib/chartStudies';
import ChartTooltip from './ChartTooltip';
import CompareIndexDialog from './CompareIndexDialog';
import SegmentedControl from '../ui/SegmentedControl';
import Spinner from '../ui/Spinner';

// ── Default config ────────────────────────────────────────────────────────────

// The one set of ranges every price chart offers. YTD's length is resolved per day (`ytd`).
const DEFAULT_RANGES = [
  { label: '1M',  days: 30   },
  { label: '3M',  days: 91   },
  { label: '6M',  days: 182  },
  { label: 'YTD', ytd: true  },
  { label: '1Y',  days: 365  },
  { label: '5Y',  days: 1825 },
  { label: 'All', days: null },
];


// ── Helpers ───────────────────────────────────────────────────────────────────

/** Actual span in days between first and last data point. */
function computeSpan(data) {
  if (data.length < 2) return 0;
  const a = new Date(data[0].date.slice(0, 10));
  const b = new Date(data[data.length - 1].date.slice(0, 10));
  return Math.max(1, (b - a) / 864e5);
}

/**
 * Y-axis tick formatter.
 * Compact for large values, precise for small values — no raw floats.
 */
function fmtY(v) {
  const a = Math.abs(v);
  if (a >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (a >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (a >= 1_000)       return `₹${(v / 1_000).toFixed(1)}K`;
  if (a >= 100)         return `₹${Math.round(v)}`;
  if (a >= 10)          return `₹${v.toFixed(1)}`;
  if (a >= 0.1)         return `₹${v.toFixed(2)}`;
  if (a >  0)           return `₹${v.toFixed(4)}`;
  return '₹0';
}

/** Y-axis tick formatter for a growth index — a plain number, no currency. */
function fmtYIndex(v) {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 10)   return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * X-axis tick selection for line charts.
 * Handles both daily ("YYYY-MM-DD") and intraday ("YYYY-MM-DDTHH:MM") dates.
 * Density is driven by actual data span so Max range auto-adapts.
 */
function getTicks(data) {
  if (!data.length) return [];

  // Intraday timestamps → ~7 evenly-spaced ticks showing time
  if (data[0]?.date?.includes('T')) {
    const step = Math.max(1, Math.floor(data.length / 7));
    return data.filter((_, i) => i % step === 0).map(d => d.date);
  }

  const span = computeSpan(data);

  // Long (> ~18 months): one tick per year
  if (span > 450) {
    const seen = new Set();
    return data
      .filter(({ date }) => seen.has(date.slice(0, 4)) ? false : (seen.add(date.slice(0, 4)), true))
      .map(d => d.date);
  }

  // Medium (> 2 months): one tick per month
  if (span > 60) {
    const seen = new Set();
    return data
      .filter(({ date }) => seen.has(date.slice(0, 7)) ? false : (seen.add(date.slice(0, 7)), true))
      .map(d => d.date);
  }

  // Short daily: all points (≤10d) or roughly 10 evenly-spaced points
  if (span <= 10) return data.map(d => d.date);
  const step = Math.max(1, Math.floor(span / 10));
  return data.filter((_, i) => i % step === 0).map(d => d.date);
}

/**
 * X-axis tick label for line charts.
 * span — actual data span in days (determines format).
 */
function formatTick(dateStr, span) {
  if (!dateStr) return '';

  // Intraday: show "HH:MM"
  if (dateStr.includes('T')) return dateStr.split('T')[1]?.slice(0, 5) || '';

  const [y, m, d] = dateStr.split('-');
  const mon = MONTHS[parseInt(m, 10) - 1];
  const mo  = parseInt(m, 10);

  if (span > 450) return y;                                         // "2024"
  if (span > 182) return mo === 1 ? `${mon} '${y.slice(2)}` : mon; // "Jan '24" / "Jun"
  if (span > 60)  return mon;                                       // "Jan"
  return `${mon} ${parseInt(d, 10)}`;                               // "Jan 5"
}

/** A growth index has no currency and no lakh/crore compacting — a plain number around 100. */
const formatIndex = (v) => (v == null ? '—' : v.toFixed(2));

/** Every growth view opens at 100: scale the series by its first real value. */
function rebaseTo100(rows) {
  const base = rows.find(d => d.value != null && d.value !== 0)?.value;
  return base ? rows.map(d => (d.value == null ? d : { ...d, value: (d.value / base) * 100 })) : rows;
}

/** Pad single-point data to 2 points so Recharts renders a line. */
function nextDayStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Most points drawn at once. A long history is cut to each bucket's low and high, so the shape survives.
const LOD_POINTS = 600;

/** Indices of the rows to draw, or null when the series is short enough to draw whole. */
function lodIndices(rows) {
  const n = rows.length;
  if (n <= LOD_POINTS) return null;
  const buckets = Math.floor((LOD_POINTS - 2) / 2);
  const size = (n - 2) / buckets;
  const out = [0];
  for (let b = 0; b < buckets; b++) {
    const s = 1 + Math.floor(b * size), e = Math.min(n - 1, 1 + Math.floor((b + 1) * size));
    let lo = -1, hi = -1;
    for (let i = s; i < e; i++) {
      const v = rows[i].value;
      if (v == null) continue;
      if (lo < 0 || v < rows[lo].value) lo = i;
      if (hi < 0 || v > rows[hi].value) hi = i;
    }
    if (lo < 0) { if (s < e) out.push(s); continue; }
    if (lo === hi) out.push(lo); else out.push(Math.min(lo, hi), Math.max(lo, hi));
  }
  out.push(n - 1);
  return out;
}

/** Min and max of several arrays, skipping nulls — no spread, so a long history cannot overflow the stack. */
function extent(arrays) {
  let min = Infinity, max = -Infinity;
  for (const arr of arrays) for (const v of arr) {
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? [0, 0] : [min, max];
}

// ── Benchmark comparison (growth view) ──────────────────────────────────────

/**
 * Colour and label lookups for the overlays. Each picked benchmark holds a palette SLOT
 * from the moment it is picked until it is removed — the lowest free one — so adding or
 * removing a line never recolours the others, and eight lines are always eight hues.
 * An unpicked benchmark has no colour (`null`); the picker draws it neutral.
 */
function assignSlots(slots, selected) {
  for (const sym of Object.keys(slots)) if (!selected.includes(sym)) delete slots[sym];
  const used = new Set(Object.values(slots));
  for (const sym of selected) {
    if (sym in slots) continue;
    let i = 0;
    while (used.has(i)) i++;
    slots[sym] = i; used.add(i);
  }
  return slots;
}

const benchmarkLookups = (list, slots) => ({
  colorOf: (symbol) => (symbol in slots ? CHART_COLORS[slots[symbol] % CHART_COLORS.length] : null),
  labelOf: (symbol) => list.find(b => b.symbol === symbol)?.label ?? symbol,
});

// Chips shown on the chart's one row of selected lines before the rest fold into "+N".
const MAX_CHIPS = 3;

/** The Recharts dataKey a benchmark's rebased series is merged into. */
const cmpKey = (symbol) => `cmp:${symbol}`;

/** Indicators hold palette slots alongside benchmarks under this prefix, so no two lines share a hue. */
const indSlot = (key) => `ind:${key}`;

const DAY = 86400000;
/** "2026-01-03" days before today (the app's day), inclusive of both ends. */
const daysSince = (iso) => Math.max(1, Math.round((Date.parse(todayStr()) - Date.parse(iso)) / DAY) + 1);
const isoDaysAgo = (n) => new Date(Date.parse(todayStr()) - n * DAY).toISOString().slice(0, 10);
/** "3 Jan – 15 Mar '26" for a custom range's button. */
const shortDate = (iso) => { const [y, m, d] = iso.split('-'); return `${+d} ${MONTHS[+m - 1]} '${y.slice(2)}`; };

/** Vertical room a label needs before it collides with its neighbour. */
const END_LABEL_GAP = 14;

/**
 * Each line's percentage, printed where the line ENDS.
 *
 * Comparing four series against a colour-chip legend means holding a colour in your
 * head, finding it in the chart, and only then learning what it did. Labelling a line
 * at its own terminus removes both steps: the answer is where your eye already is.
 *
 * One component for ALL the labels rather than a per-series `LabelList`, because they
 * have to be placed as a set — two lines finishing a hair apart would print their
 * percentages on top of each other, and a series can only ever see itself. Here they
 * are sorted by height, pushed apart, then pulled back inside the plot.
 *
 * Geometry comes from Recharts 3's hooks (`usePlotArea` / `useYAxisScale`), and this
 * renders as a plain child of the chart. Recharts 3 lets any element render inside a
 * chart and has deprecated `Customized` for removal in 4.0; the v2 route — reading
 * `yAxisMap` and `offset` off the props `Customized` handed down — no longer carries
 * them at all, and would have failed silently as "no labels ever appear".
 *
 * Percentages come from the same `base` the tooltip and the benchmark rebasing use, so
 * every figure on this chart is measured from one instant.
 */
function EndLabels({ series = [], base }) {
  const plot  = usePlotArea();
  const scale = useYAxisScale();
  if (!plot || !scale || !base) return null;

  const items = series
    .map(s => ({ ...s, y: scale(s.value), pct: (s.value / base - 1) * 100 }))
    .filter(s => Number.isFinite(s.y) && Number.isFinite(s.pct))
    .sort((a, b) => a.y - b.y);
  if (!items.length) return null;

  // Push down through the stack, then correct back up so the last one still fits.
  for (let i = 1; i < items.length; i++) {
    items[i].y = Math.max(items[i].y, items[i - 1].y + END_LABEL_GAP);
  }
  const bottom = plot.y + plot.height;
  for (let i = items.length - 1; i >= 0; i--) {
    items[i].y = Math.min(items[i].y, bottom - (items.length - 1 - i) * END_LABEL_GAP);
  }
  for (let i = 0; i < items.length; i++) {
    items[i].y = Math.max(items[i].y, plot.y + i * END_LABEL_GAP);
  }

  const x = plot.x + plot.width + 7;

  return (
    <g style={{ pointerEvents: 'none' }}>
      {items.map(s => (
        <text
          key={s.key} x={x} y={s.y} dy={3.5} fill={s.color}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '-0.02em' }}
        >
          {formatPct(s.pct, 1)}
        </text>
      ))}
    </g>
  );
}

// ── Animated value hook ───────────────────────────────────────────────────────

// `null` means no figure yet: the first real one appears at once instead of counting up from 0.
function useAnimatedValue(target, duration = 380) {
  const [value, setValue] = useState(target);
  const frameRef = useRef();
  const fromRef  = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    const to   = target;
    if (from === to) return;
    if (from == null || to == null) {
      fromRef.current = to;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => setValue(to));
      return () => cancelAnimationFrame(frameRef.current);
    }

    const start = performance.now();
    const tick  = (now) => {
      const t     = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (to - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else       fromRef.current  = to;
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return target == null ? null : value ?? target;
}

// ── Drag-selection summary label ───────────────────────────────────────────────

/**
 * Floating summary for a drag-selected range, placed OUTSIDE the selected band so both
 * of its edges stay visible — beyond the anchored edge, away from the one being dragged.
 * Recharts injects `viewBox` (the selected band's pixel box); the box itself is HTML,
 * portalled into the chart's wrapper (`host`) and clamped to its width.
 *
 * When benchmarks are on the chart it measures ALL of them over the same window, not
 * just the primary line. Dragging a range with three indices overlaid used to answer
 * for exactly one of the four series drawn through it — the one question the comparison
 * exists to ask ("did I beat it over THIS stretch?") was the one it would not answer.
 *
 * Each benchmark row carries its own return AND the gap: your return minus its own, in
 * percentage POINTS. That is the figure being sought, and subtracting two percentages
 * in your head while a chart moves under the cursor is not a reasonable thing to ask.
 * `pp` is spelled out because a gap between two percentages is not itself a percentage.
 */
const SEL_ROW_H = 15;

// HTML in a portal over the chart, not inside the SVG: there, the series painted over it
// whenever benchmark lines were on the chart.
function SelectionLabel(props) {
  if (!props.viewBox || !props.host) return null;
  return <SelectionBox {...props} />;
}

const SEL_GAP = 10;

function SelectionBox({ viewBox, pct, abs, pos, benchmarks, formatValue, host, name, movingRight }) {
  const boxRef = useRef(null);
  const L = viewBox.x, R = viewBox.x + viewBox.width;
  // Needs the box's own width, so it is placed after layout. Try beyond the anchored edge,
  // then beyond the moving one, else the chart corner farthest from the moving edge.
  useLayoutEffect(() => {
    const el = boxRef.current;
    const w = el.offsetWidth, W = host.clientWidth;
    const before = L - SEL_GAP - w >= 4 ? L - SEL_GAP - w : null;
    const after  = R + SEL_GAP + w <= W - 4 ? R + SEL_GAP : null;
    const x = (movingRight ? before ?? after : after ?? before) ?? (movingRight ? 4 : W - w - 4);
    el.style.transform = `translate3d(${Math.round(Math.max(4, x))}px, 0, 0)`;
    el.style.visibility = 'visible';
  });
  const color   = pos ? '#22c55e' : '#ef4444';
  const sign    = pos ? '+' : '−';
  const mono    = { fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' };
  const muted   = 'rgba(255,255,255,0.62)';
  const head    = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(255,255,255,0.4)', ...mono };

  return createPortal(
    <div ref={boxRef} style={{
      position: 'absolute', top: (viewBox.y ?? 0) + 6, left: 0, zIndex: 5, pointerEvents: 'none', willChange: 'transform',
      visibility: 'hidden',
    }}>
      <div style={{
        background: 'var(--color-bg-popover)',
        border: '1px solid var(--color-border-hover)',
        borderRadius: 9, padding: '6px 11px', whiteSpace: 'nowrap',
        boxShadow: 'var(--shadow-popover)',
      }}>
        <p style={{ ...head, margin: '0 0 3px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name ? `${name} · period change` : 'Period change'}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1, ...mono }}>
            {sign}{Math.abs(pct).toFixed(2)}%
          </span>
          {abs != null && (
            <span style={{ fontSize: 12, fontWeight: 500, color, lineHeight: 1, ...mono }}>
              {sign}{formatValue(Math.abs(abs))}
            </span>
          )}
        </div>

        {benchmarks?.length > 0 && (
          <div style={{ marginTop: 7, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.09)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: SEL_ROW_H }}>
              <span style={{ ...head, flex: 1 }} />
              <span style={{ ...head, width: 58, textAlign: 'right' }}>Return</span>
              <span style={{ ...head, width: 64, textAlign: 'right' }}>Gap</span>
            </div>
            {benchmarks.map(b => {
              const ahead = b.gap >= 0;
              return (
                <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, height: SEL_ROW_H }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                  <span title={b.label} style={{ fontSize: 10.5, color: muted, flex: 1, minWidth: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.label}
                  </span>
                  <span style={{ fontSize: 10.5, color: muted, width: 58, textAlign: 'right', ...mono }}>
                    {b.pct >= 0 ? '+' : '−'}{Math.abs(b.pct).toFixed(2)}%
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: ahead ? '#22c55e' : '#ef4444', width: 64, textAlign: 'right', ...mono }}>
                    {ahead ? '+' : '−'}{Math.abs(b.gap).toFixed(2)} pp
                  </span>
                </div>
              );
            })}
            {/* The gap is a fact about the main line, so the key says whose it is. */}
            <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', margin: '5px 0 0', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Gap = {name || 'this line'}’s return − each line’s, in points
            </p>
          </div>
        )}
      </div>
    </div>,
    host,
  );
}

// One row of removable chips for the chart's selected lines; the overflow folds into "+N".
function ChipRow({ chips, onMore }) {
  const shown = chips.length > MAX_CHIPS ? chips.slice(0, MAX_CHIPS - 1) : chips;
  const rest = chips.slice(shown.length);
  return (
    <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'flex-end', gap: 5, maxWidth: 320 }}>
      {shown.map(c => (
        <button
          key={c.key}
          onClick={c.remove}
          title={`${c.label} · ${c.title}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
            padding: '2px 7px 2px 6px', borderRadius: 999, cursor: 'pointer',
            border: c.dashed ? '1px dashed var(--color-border-hover)' : '1px solid var(--color-border-subtle)',
            background: c.dashed ? 'transparent' : 'var(--color-bg-elevated)',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
          <span style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 96 }}>
            {c.label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1 }}>×</span>
        </button>
      ))}
      {rest.length > 0 && (
        <button
          onClick={onMore}
          title={rest.map(c => c.label).join(', ')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
            border: rest[0].dashed ? '1px dashed var(--color-border-hover)' : '1px solid var(--color-border-subtle)',
            background: rest[0].dashed ? 'transparent' : 'var(--color-bg-elevated)',
          }}
        >
          <span style={{ display: 'flex', gap: 2 }}>
            {rest.slice(0, 4).map(c => (
              <span key={c.key} style={{ width: 5, height: 5, borderRadius: '50%', background: c.color }} />
            ))}
          </span>
          <span className="figure" style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>+{rest.length}</span>
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Reusable stock-style chart component.
 *
 * Props:
 *   fetchData(days, growth) — async fn returning [{date,value}]. Defaults to networthAPI.
 *                             `growth` is only ever passed through when `growthCapable`.
 *   staticData              — static [{date,value}] array; bypasses fetching.
 *   title                   — small label above the current value.
 *   valueLabel              — label shown in the tooltip (default: 'Value').
 *   formatValue(n)          — number formatter (default: formatCurrency).
 *   showCard                — wraps in a card (default true). Set false for embed use.
 *   height                  — chart pixel height (default 280).
 *   axisFormat              — y-axis tick formatter for the price view (default: compact ₹).
 *   emptyText               — shown when there's no data.
 *   ranges                  — array of {label, days} (default: DEFAULT_RANGES).
 *   defaultRange            — label string for the initial range (default '1Y').
 *   refreshKey              — increment this to trigger a data refetch without remounting.
 *   benchmarks              — the overlay catalogue [{symbol, label}] (default:
 *                             BENCHMARKS). Any symbol `/market/index-series`
 *                             serves — including `_METAL:gold|silver`.
 *   defaultView             — 'complete' | 'growth' — the view to open on.
 *   defaultCompare          — symbols overlaid from the start (growth view).
 *   viewLabels              — { complete, growth, hint? } names for the two views (a
 *                             share's "complete" view is its Price) and the growth
 *                             button's tooltip.
 *   symbol                  — the charted instrument, so a saved comparison never overlays it on itself.
 *   saveStudies             — load and save the shared indicators/comparisons (market charts only, not your own money).
 *   growthCapable           — show the Complete / Growth toggle. Growth strips every
 *                             external inflow/outflow out of the series and reindexes
 *                             it to 100 at its own first day, so what is plotted is
 *                             what the money itself did, not how much of it there was.
 *                             Growth mode also enables the "+" benchmark-comparison
 *                             overlay (Nifty 50, S&P 500, …) — comparing an index
 *                             against raw rupee values makes no sense, only against
 *                             another base-100 index.
 */
export default function PriceGrapher({
  fetchData        = null,
  staticData       = null,
  title            = null,
  valueLabel       = 'Value',
  formatValue      = formatCurrency,
  axisFormat       = fmtY,
  showCard         = true,
  height           = 280,
  emptyText        = 'No data available',
  ranges           = DEFAULT_RANGES,
  defaultRange     = '1Y',
  refreshKey       = 0,
  growthCapable    = false,
  benchmarks       = BENCHMARKS,
  defaultView      = 'complete',
  defaultCompare   = [],
  viewLabels       = { complete: 'Complete', growth: 'Growth' },
  symbol           = null,
  saveStudies      = false,
}) {
  // ── Unique gradient IDs — prevents cross-instance bleed when multiple
  //    PriceGraphers share the same SVG defs namespace ────────────────────────
  const uid        = useId().replace(/:/g, '-');
  const pgStrokeId   = `pgS${uid}`;
  const pgFillId     = `pgF${uid}`;
  const pgFlatFillId = `pgFF${uid}`;

  const initRange = ranges.find(r => r.label === defaultRange) ?? ranges[ranges.length - 2] ?? ranges[0];
  const [range,       setRange]       = useState(initRange);
  const [custom,      setCustom]      = useState(null);    // { from, to } — dates picked on the calendar
  const [draft,       setDraft]       = useState({ from: null, to: null });
  const [view,        setView]        = useState(defaultView); // 'complete' | 'growth'
  const [rawData,     setRawData]     = useState([]);      // as fetched, incl. any warm-up history
  const [loading,     setLoading]     = useState(!staticData);
  // Indicators and comparisons are shared by every chart (lib/chartStudies); the page's own default is added on top.
  const [saved] = useState(() => (saveStudies ? loadStudies() : { indicators: [], compare: [], added: [] }));
  const [indicators,  setIndicators]  = useState(saved.indicators); // [{ id, type, period, width? }] — see lib/indicators
  useEffect(() => { if (saveStudies) saveIndicators(indicators); }, [saveStudies, indicators]);

  // The window on screen: a preset, or the calendar's dates (fetched as "since `from`").
  const win = useMemo(() => (custom
    ? { label: 'Custom', days: daysSince(custom.from), from: custom.from, to: custom.to }
    // YTD opens on the last day of the previous year, so it reads as the change since year end.
    : range.ytd ? { ...range, days: daysSince(`${todayStr().slice(0, 4)}-01-01`) }
    : range), [custom, range]);

  // ── Benchmark comparison (growth view only) ───────────────────────────────
  const [compareOpen,    setCompareOpen]    = useState(false);
  const [compareSymbols, setCompareSymbols] = useState(() => [...new Set([...defaultCompare, ...saved.compare.filter(s => s !== symbol)])]);
  const [compareSeries,  setCompareSeries]  = useState({});       // symbol -> [{date,close}]
  // Any ticker or fixed rate the user brought, plus saved lines this chart's catalogue lacks.
  const [addedBenchmarks, setAddedBenchmarks] = useState(() => saved.added.filter(b =>
    b.symbol !== symbol && saved.compare.includes(b.symbol) && !benchmarks.some(x => x.symbol === b.symbol)));
  const allBenchmarks = useMemo(() => [...addedBenchmarks, ...benchmarks], [addedBenchmarks, benchmarks]);
  const catalogueRef = useRef(allBenchmarks);
  catalogueRef.current = allBenchmarks;
  // Every add/remove is also applied to the shared saved set.
  const changeCompare = useCallback((next, extra = []) => {
    setCompareSymbols(prev => {
      const n = typeof next === 'function' ? next(prev) : next;
      if (saveStudies) saveCompareChange(prev, n, [...extra, ...catalogueRef.current]);
      return n;
    });
  }, [saveStudies]);
  const addBenchmark = useCallback((b) => {
    setAddedBenchmarks(list => (list.some(x => x.symbol === b.symbol) || benchmarks.some(x => x.symbol === b.symbol) ? list : [b, ...list]));
    changeCompare(sel => (sel.includes(b.symbol) ? sel : [...sel, b.symbol]), [b]);
    setView('growth');   // a comparison only means something rebased
  }, [benchmarks, changeCompare]);
  const slotsRef = useRef({});
  const { colorOf: benchmarkColor, labelOf: benchmarkLabel } = useMemo(
    () => benchmarkLookups(allBenchmarks, { ...assignSlots(slotsRef.current, [...compareSymbols, ...indicators.map(i => indSlot(i.id))]) }),
    [allBenchmarks, compareSymbols, indicators]);

  const growth = growthCapable && view === 'growth';

  // Warm-up history ahead of the window, so a 200-day average runs from the first point
  // on screen. Not for intraday windows (hourly points) or All (nothing comes before it).
  const warmup = win.days > 2 ? lookbackDays(indicators) : 0;

  // Only the latest request may land: a slow Complete response arriving after Growth
  // was picked painted rupees under the index.
  const fetchSeq = useRef(0);
  const doFetch = useCallback(async (r, isGrowth, padDays) => {
    if (staticData) { setRawData(staticData); setLoading(false); return; }
    const seq = ++fetchSeq.current;
    setLoading(true);
    // A custom window ends where the calendar says, not today.
    const inWindow = (rows) => (r.to ? rows.filter(d => d.date.slice(0, 10) <= r.to) : rows);
    try {
      // The default series is net worth: T cash + the T-1 close, with today's row
      // always appended (see networthAPI.getDaily).
      const fn  = fetchData ?? ((d, g, o) => networthAPI.getDaily(paddedDays(d, o), g).then(res => res.data));
      const res = await fn(r.days, isGrowth, { pad: padDays });
      if (seq === fetchSeq.current) setRawData(inWindow(res ?? []));
    } catch {
      if (seq === fetchSeq.current) setRawData([]);
    } finally { if (seq === fetchSeq.current) setLoading(false); }
  }, [fetchData, staticData]);

  useEffect(() => { doFetch(win, growth, warmup); }, [win, doFetch, refreshKey, growth, warmup]);

  // The first day ON SCREEN — rows before it are warm-up history for the indicators.
  const windowFrom = win.from || (warmup && win.days ? isoDaysAgo(win.days) : null);
  const firstShown = useMemo(() => {
    if (!windowFrom) return 0;
    const i = rawData.findIndex(d => d.date.slice(0, 10) >= windowFrom);
    return i < 0 ? rawData.length : i;
  }, [rawData, windowFrom]);

  // Every growth view opens at 100 at the window's first point; `scale` carries that
  // same factor to the indicators, which were computed on the unscaled series.
  const { data, scale } = useMemo(() => {
    const shown = rawData.slice(firstShown);
    if (!growth) return { data: shown, scale: 1 };
    const base = shown.find(d => d.value != null && d.value !== 0)?.value;
    return base ? { data: rebaseTo100(shown), scale: 100 / base } : { data: shown, scale: 1 };
  }, [rawData, firstShown, growth]);

  // Fetch every selected benchmark's raw close series over (roughly) the same window
  // as the primary series — re-based against it client-side once fetched (see
  // `compareRebased` below), so this only ever needs the RAW prices, not an index.
  // Reaches back to the window's own first point, wherever a custom or All range put it.
  const firstDate = data[0]?.date?.slice(0, 10);
  useEffect(() => {
    if (!growth || !compareSymbols.length || !firstDate) { setCompareSeries({}); return; }
    let cancelled = false;
    const days = daysSince(firstDate) + 10; // +10: buffer for the anchor day
    Promise.all(compareSymbols.map(sym =>
      marketAPI.indexSeries(sym, days).then(res => [sym, res.data ?? []]).catch(() => [sym, []])
    )).then(entries => { if (!cancelled) setCompareSeries(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [growth, compareSymbols, firstDate]);

  // ── Drag-to-measure selection ─────────────────────────────────────────────
  // A click-drag across the plot highlights a range and shows its change. The live drag
  // lives in a ref and reaches state at most once a frame, and only when the day under
  // the cursor changes; the chart itself is memoised (see `chartBody`), so a drag
  // re-renders the band and its label, never the thousands of points beneath them.
  const [sel, setSel] = useState(null);           // { a, b } — each { label (date), x (px) }
  const [selecting, setSelecting] = useState(false);
  const dragRef = useRef(null);
  const rafRef  = useRef(0);
  const chartAreaRef = useRef(null);

  const clearSelection = useCallback(() => {
    dragRef.current = null;
    cancelAnimationFrame(rafRef.current); rafRef.current = 0;
    setSelecting(false);
    setSel(null);
  }, []);

  const pointOf = (e) => (e && e.activeLabel != null && e.activeCoordinate
    ? { label: e.activeLabel, x: e.activeCoordinate.x } : null);
  // The day under a page x, pinned to the first/last day past the plot's edges, so a drag
  // keeps tracking once the cursor leaves the chart. The x axis is a point scale with no padding.
  const rowsRef = useRef([]);
  useEffect(() => { rowsRef.current = chartData; });
  const pointAtX = (clientX) => {
    const host = chartAreaRef.current, rows = rowsRef.current;
    const svg = host?.querySelector('svg.recharts-surface');
    const clip = svg?.querySelector('clipPath rect');
    if (!clip || rows.length < 2) return null;
    const left = +clip.getAttribute('x'), width = +clip.getAttribute('width');
    const step = width / (rows.length - 1);
    const i = Math.min(rows.length - 1, Math.max(0, Math.round((clientX - svg.getBoundingClientRect().left - left) / step)));
    return { label: rows[i].date, x: left + i * step };
  };
  const listenersRef = useRef(null);
  const detach = () => {
    const l = listenersRef.current;
    if (!l) return;
    window.removeEventListener('mousemove', l.move);
    window.removeEventListener('mouseup', l.up);
    listenersRef.current = null;
  };
  const handleSelectDown = useCallback((e, ev) => {
    // Recharts' active point is throttled to a frame, so on a fast press it is still where
    // the cursor WAS; anchor on the press itself.
    const p = (ev?.clientX != null && pointAtX(ev.clientX)) || pointOf(e);
    if (!p) return;
    dragRef.current = { a: p, b: p };
    setSelecting(true);
    setSel({ a: p, b: p });
    // Tracked on the window while the button is down: leaving the chart must not end or freeze the drag.
    detach();
    const move = (ev) => {
      const d = dragRef.current, q = pointAtX(ev.clientX);
      if (!d || !q || q.label === d.b.label) return;
      d.b = q;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const cur = dragRef.current;
        if (cur) setSel({ a: cur.a, b: cur.b });
      });
    };
    const up = (ev) => {
      detach();
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      cancelAnimationFrame(rafRef.current); rafRef.current = 0;
      const end = pointAtX(ev.clientX) || d.b;
      setSelecting(false);
      // A plain click (no drag) clears any selection instead of leaving a zero-width band.
      setSel(end.label === d.a.label ? null : { a: d.a, b: end });
    };
    listenersRef.current = { move, up };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); detach(); }, []);

  // ── Pad single point so Recharts renders a line ───────────────────────────
  const displayData = useMemo(() => (
    data.length === 1
      ? [data[0], { ...data[0], date: nextDayStr(data[0].date) }]
      : data
  ), [data]);

  // ── Benchmark comparison: rebase each selected index's raw close series
  //    against the primary series' OWN first visible value — so the overlay
  //    starts exactly level with the primary line (wherever that happens to
  //    sit) and both trace relative performance from there. `cmp:<symbol>` is
  //    merged onto a copy of displayData so ONE data array drives every series
  //    Recharts renders, which is what keeps the tooltip in sync across all of
  //    them at a given x — a separate `data` prop per line (the old single-
  //    compare-line design) does not synchronize that way.
  const compareRebased = useMemo(() => {
    if (!growth || !compareSymbols.length || !displayData.length) return {};
    const anchorValue = displayData[0]?.value;
    if (!anchorValue) return {};

    const out = {};
    for (const sym of compareSymbols) {
      const series = compareSeries[sym];
      if (!series?.length) continue;
      const byDate = new Map(series.map(p => [p.date, p.close]));
      const anchorClose = byDate.get(displayData[0].date);
      if (!anchorClose) continue;
      out[sym] = displayData.map(row => {
        const close = byDate.get(row.date);
        return close != null ? (anchorValue * close) / anchorClose : null;
      });
    }
    return out;
  }, [growth, compareSymbols, compareSeries, displayData]);

  // ── Indicators: computed over the whole fetched series (warm-up included), then cut
  //    to the window and scaled like the line they describe. Each becomes one or more
  //    `ind:<key>:<part>` columns on the chart data; RSI goes to its own pane.
  const indicatorLines = useMemo(() => {
    if (!indicators.length || !rawData.length) return [];
    const values = rawData.map(d => d.value);
    const lines = [];
    for (const ind of indicators) {
      const meta = indicatorTypeOf(ind.type);
      if (!meta) continue;
      for (const [part, arr] of Object.entries(computeIndicator(ind, values))) {
        const shown = arr.slice(firstShown);
        lines.push({
          id: ind.id, part, meta,
          dataKey: `ind:${ind.id}:${part}`,
          name: meta.kind === 'band' ? `${indicatorLabel(ind)} ${part}` : indicatorLabel(ind),
          pane: meta.kind === 'pane',
          // RSI is scale-free; everything else moves with the line it sits on.
          values: meta.kind === 'pane' ? shown : shown.map(v => (v == null ? null : v * scale)),
        });
      }
    }
    return lines;
  }, [indicators, rawData, firstShown, scale]);
  const overlays  = useMemo(() => indicatorLines.filter(l => !l.pane), [indicatorLines]);
  const paneLines = useMemo(() => indicatorLines.filter(l => l.pane), [indicatorLines]);

  // Level of detail: everything is computed on the full series, only the drawn rows are thinned.
  const lod = useMemo(() => lodIndices(displayData), [displayData]);
  const lodData = useMemo(() => (lod ? lod.map(i => displayData[i]) : displayData), [lod, displayData]);
  const chartData = useMemo(() => {
    const symbols = Object.keys(compareRebased);
    if (!symbols.length && !indicatorLines.length) return lodData;
    const merge = (i) => {
      const extra = {};
      for (const sym of symbols) extra[cmpKey(sym)] = compareRebased[sym][i];
      for (const l of indicatorLines) extra[l.dataKey] = l.values[i] ?? null;
      return { ...displayData[i], ...extra };
    };
    return lod ? lod.map(merge) : displayData.map((_, i) => merge(i));
  }, [displayData, lod, lodData, compareRebased, indicatorLines]);

  // ── Derived values ────────────────────────────────────────────────────────
  // An index has no currency and no compacting to lakhs/crores — it is a plain
  // number centred on 100, so it gets its own formatter rather than reusing
  // whatever the caller passes for rupee figures.
  // The value every growth percentage is measured from. Null/0 would make the ratio
  // meaningless, so the tooltip simply omits the percentage in that case.
  const growthBase   = displayData.find(d => d.value != null && d.value !== 0)?.value ?? null;
  const effFormatValue = growth ? formatIndex : formatValue;
  const effValueLabel  = growth ? 'Growth index' : valueLabel;
  const comparing = growth && Object.keys(compareRebased).length > 0;


  // Nulls (a growth series with no meaningful base) are dropped before min/max —
  // Math.max/min coerce `null` to 0, which would otherwise skew the Y domain.
  // The Y domain must also fit any comparison line, or it renders clipped.
  const [minVal, maxVal] = useMemo(() => extent([
    data.map(d => d.value), ...Object.values(compareRebased), ...overlays.map(l => l.values),
  ]), [data, compareRebased, overlays]);
  // A missing point is not a zero: read the ends off the first and last real values.
  const firstReal = data.find(d => d.value != null)?.value;
  const lastReal  = data.findLast(d => d.value != null)?.value;
  const openVal = firstReal ?? 0;
  const lastVal = lastReal ?? 0;
  const absChng = lastVal - openVal;
  const pctChng = openVal !== 0 ? (absChng / Math.abs(openVal)) * 100 : 0;
  const isPos   = absChng >= 0;
  const isFlat  = data.length > 0 && maxVal === minVal;

  // Animated stats
  const has   = data.length > 0;
  const aLast = useAnimatedValue(has ? lastVal : null);
  const aAbs  = useAnimatedValue(has ? absChng : null);
  const aPct  = useAnimatedValue(has ? pctChng : null);

  // Resolve the drag selection into ordered endpoints + change metrics.
  //
  // EVERY line on the chart is measured over the window, not just the primary one. The
  // whole reason to put a benchmark on the chart is to ask "how did I do against it",
  // and the answer was being given for exactly one of the lines drawn: the box said
  // "+12.34%" while three other series ran through the same band, unmeasured. Each
  // benchmark reports its own change AND the gap — the portfolio's return minus its own,
  // in percentage POINTS, which is the number the comparison exists to produce.
  //
  // Rebasing does not affect any of this: a rebased series is the raw closes scaled by a
  // constant, and a constant cancels in a ratio.
  const selection = useMemo(() => {
    if (!sel) return null;
    const iA = displayData.findIndex(d => d.date === sel.a.label);
    const iB = displayData.findIndex(d => d.date === sel.b.label);
    if (iA < 0 || iB < 0 || iA === iB) return null;
    const lo = Math.min(iA, iB), hi = Math.max(iA, iB);
    const startVal = displayData[lo].value;
    const endVal   = displayData[hi].value;
    const abs = endVal - startVal;
    const pct = startVal !== 0 ? (abs / Math.abs(startVal)) * 100 : 0;

    // The nearest real quote inward from each edge. A market shut on the boundary day
    // has no close there, and "no data" is not a return of zero — it just means this
    // index's window starts a day later than yours, which is the honest reading.
    const edge = (arr, from, to, step) => {
      for (let i = from; step > 0 ? i <= to : i >= to; i += step) if (arr[i] != null) return arr[i];
      return null;
    };

    const measured = Object.keys(compareRebased).map(sym => {
      const arr = compareRebased[sym];
      const a = edge(arr, lo, hi, 1);
      const b = edge(arr, hi, lo, -1);
      if (a == null || b == null || a === 0) return null;
      const bPct = (b / a - 1) * 100;
      return {
        key:   sym,
        label: benchmarkLabel(sym),
        color: benchmarkColor(sym),
        pct:   bPct,
        gap:   pct - bPct,
      };
    }).filter(Boolean);

    return {
      left: Math.min(sel.a.x, sel.b.x), right: Math.max(sel.a.x, sel.b.x),
      movingRight: sel.b.x >= sel.a.x, abs, pct, pos: abs >= 0, benchmarks: measured,
    };
  }, [sel, displayData, compareRebased, benchmarkColor, benchmarkLabel]);

  // ── Line chart: Y domain + gradient stop at opening price ─────────────────
  const pad  = (maxVal - minVal) * 0.05 || Math.abs(maxVal) * 0.02 || 1;
  // A price (or an index of one) is never below zero, so neither is its axis: the 5% pad
  // must not invent negative ticks. A net worth that really is negative still gets them.
  const nonNegative = data.every(d => d.value == null || d.value >= 0);
  const yMin = nonNegative ? Math.max(0, minVal - pad) : minVal - pad;
  const yMax = maxVal + pad;
  // The green/red split must sit exactly on the opening-value reference line.
  // A gradient's 0–100% spans the bounding box of the ELEMENT it paints, not the
  // axis domain, so each element needs its own offset:
  //   - the stroke's box is the primary line's own [min, max]. Benchmark overlays
  //     widen the axis but not this path, so measuring against the comparison-wide
  //     range dragged the split below the reference line whenever an index fell
  //     further than the primary series did.
  //   - the fill's box runs from the line down to the Area's baseline, which Recharts
  //     puts at the domain floor (clamped to 0 when the domain straddles it).
  const [pMin, pMax] = useMemo(() => extent([data.map(d => d.value)]), [data]);
  const fillBase = yMax <= 0 ? yMax : Math.max(yMin, 0);
  // Green wins the exact open-line pixel: begin red a hair BELOW the split so a
  // value sitting on the previous close renders green, not a red/green blend.
  const splitAt = (lo, hi) => {
    const pct = hi > lo ? (1 - (openVal - lo) / (hi - lo)) * 100 : 50;
    return `${Math.max(0, Math.min(100, pct + 0.6)).toFixed(2)}%`;
  };
  const stopOffsetRed  = splitAt(pMin, pMax);
  const fillOffsetRed  = splitAt(Math.min(pMin, fillBase), Math.max(pMax, fillBase));

  const strokeColor = isFlat ? '#C9A96A' : `url(#${pgStrokeId})`;
  const fillColor   = isFlat ? `url(#${pgFlatFillId})` : `url(#${pgFillId})`;

  // ── X-axis ticks + span (computed from actual data, not just range.days) ──
  const ticks     = useMemo(() => getTicks(lodData), [lodData]);
  const lineSpan  = useMemo(() => computeSpan(displayData), [displayData]);

  // ── Misc ──────────────────────────────────────────────────────────────────
  const Icon           = isPos ? TrendingUp : TrendingDown;
  const clr            = isFlat ? '#C9A96A' : isPos ? 'var(--color-success)' : 'var(--color-danger)';
  const activeEmpty    = data.length === 0;
  // Each line's LAST real value, for the end-of-line labels. Read backwards rather
  // than taking `chartData.at(-1)`: a benchmark whose market was shut on the final day
  // is null there (the line is drawn with `connectNulls`), and labelling it "—" while
  // its line clearly reaches the right edge would be a worse answer than its last
  // actual close.
  const endLabelSeries = useMemo(() => {
    if (!comparing || !chartData.length) return [];

    const lastOf = (key) => {
      for (let i = chartData.length - 1; i >= 0; i--) {
        const v = chartData[i][key];
        if (v != null) return v;
      }
      return null;
    };

    // The primary takes the direction colour its own headline figure uses, not the
    // line's gradient — a vertical green-to-red gradient poured into 5 characters of
    // text is unreadable.
    return [
      { key: 'value', value: lastOf('value'), color: clr },
      ...Object.keys(compareRebased).map(sym => ({
        key: sym, value: lastOf(cmpKey(sym)), color: benchmarkColor(sym),
      })),
    ].filter(s => s.value != null);
  }, [comparing, chartData, compareRebased, clr, benchmarkColor]);

  // ── The chart itself, memoised: nothing a drag changes is in here (only `measuring`,
  //    which flips at its start and end), so dragging never re-renders the plot.
  const measuring = selecting || !!sel;
  const chartBody = useMemo(() => (
    <>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={chartData}
            syncId={`pgsync${uid}`}
            margin={{ top: 4, right: comparing ? 58 : 16, bottom: 0, left: 0 }}
            onMouseDown={handleSelectDown}
          >
            <defs>
              {/* Faint dot lattice for the plot background */}
              <pattern id={`${pgFillId}-dots`} width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgba(180,196,220,0.10)" />
              </pattern>
              {/* Stroke gradient: green above the period-open price, red below.
                  Red starts a hair below the split so green wins the open pixel. */}
              <linearGradient id={pgStrokeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={stopOffsetRed} stopColor="#22c55e" />
                <stop offset={stopOffsetRed} stopColor="#ef4444" />
              </linearGradient>
              {/* Fill gradient: tinted green above open, tinted red below */}
              <linearGradient id={pgFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"            stopColor="#22c55e" stopOpacity={0.13} />
                <stop offset={fillOffsetRed} stopColor="#22c55e" stopOpacity={0.02} />
                <stop offset={fillOffsetRed} stopColor="#ef4444" stopOpacity={0.02} />
                <stop offset="100%"          stopColor="#ef4444" stopOpacity={0.10} />
              </linearGradient>
              {/* Flat fill: neutral teal tint */}
              <linearGradient id={pgFlatFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#C9A96A" stopOpacity={0.10} />
                <stop offset="100%" stopColor="#C9A96A" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              horizontal={false}
              fill={`url(#${pgFillId}-dots)`}
              fillOpacity={1}
            />

            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={d => formatTick(d, lineSpan)}
              tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[yMin, yMax]}
              allowDataOverflow
              tickFormatter={growth ? fmtYIndex : axisFormat}
              tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false}
              width={56} tickCount={5}
            />

            {/* Point tooltip — suppressed while a range is being measured. When
                comparing, each series carries its own `name` (set below) instead
                of one shared label, so `valueLabel` is left unset and ChartTooltip
                falls back to per-series names. */}
            {!measuring && (
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={effFormatValue}
                    valueLabel={comparing || overlays.length ? undefined : effValueLabel}
                    // Growth only. The anchor is the first VISIBLE point, which is also
                    // what every benchmark overlay was rebased to — so the primary line
                    // and its comparisons all report percentages from the same instant.
                    percentBase={growth ? growthBase : undefined}
                  />
                }
                cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.75, strokeDasharray: '3 3' }}
                // With several lines, pin it to the top edge and hold it clear of the cursor so it covers less.
                {...(comparing || overlays.length ? { position: { y: 0 }, offset: 28 } : {})}
                isAnimationActive={false}
                wrapperStyle={{ transition: 'none', outline: 'none' }}
              />
            )}

            {/* Reference line at the period's opening value */}
            {data.length > 1 && !isFlat && (
              <ReferenceLine
                y={openVal}
                stroke="rgba(255,255,255,0.18)"
                strokeDasharray="4 4"
                strokeWidth={0.75}
              />
            )}

            <Area
              type="monotone" dataKey="value"
              name={effValueLabel}
              stroke={strokeColor} strokeWidth={1.75}
              fill={fillColor}
              dot={false}
              activeDot={measuring ? false : (props) => {
                // Colour the hover dot by the region it sits in (above/below the
                // opening reference line), matching the line's own colour there.
                // Suppressed while measuring so it never covers the selection box.
                const v = props?.payload?.value;
                const color = isFlat ? '#C9A96A' : (v >= openVal ? '#22c55e' : '#ef4444');
                return <circle cx={props.cx} cy={props.cy} r={ACTIVE_DOT.r} fill={color} stroke={ACTIVE_DOT.stroke} strokeWidth={ACTIVE_DOT.strokeWidth} />;
              }}
              isAnimationActive={true}
              animationDuration={350}
              animationEasing="ease-out"
            />

            {/* Benchmark comparison overlays — plain lines (not filled areas, or
                overlapping fills would muddy the primary series' own fill), each
                re-based to start level with the primary line (see compareRebased). */}
            {Object.keys(compareRebased).map(sym => (
              <Line
                key={sym}
                type="monotone"
                dataKey={cmpKey(sym)}
                name={benchmarkLabel(sym)}
                stroke={benchmarkColor(sym)}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={true}
                animationDuration={350} activeDot={ACTIVE_DOT} />
            ))}

            {/* Indicators — thin lines in their own palette slot: averages solid (EMA
                dashed), Bollinger's two bands dotted. Never filled, never animated. */}
            {overlays.map(l => (
              <Line
                key={l.dataKey}
                type="monotone"
                dataKey={l.dataKey}
                name={l.name}
                stroke={benchmarkColor(indSlot(l.id))}
                strokeWidth={l.meta.kind === 'band' ? 1 : 1.25}
                strokeDasharray={l.meta.kind === 'band' ? '2 3' : l.meta.type === 'ema' ? '5 3' : undefined}
                strokeOpacity={0.9}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}

            {/* Each line's percentage, at the line's own end. Last child so it paints
                over the series rather than under them. */}
            {comparing && endLabelSeries.length > 0 && (
              <EndLabels series={endLabelSeries} base={growthBase} />
            )}

          </AreaChart>
        </ResponsiveContainer>
        {/* RSI in its own pane: a 0–100 oscillator cannot share the price axis. Same
            margins and data as the chart above, synced to it, so its points line up. */}
        {paneLines.length > 0 && (
          <div style={{ position: 'relative', borderTop: '1px solid var(--color-border-subtle)', marginTop: 6 }}>
            <span className="text-xs" style={{ position: 'absolute', top: 4, left: 60, color: 'var(--color-text-muted)', pointerEvents: 'none', zIndex: 1 }}>
              {paneLines.map(l => l.name).join(' · ')}
            </span>
            <ResponsiveContainer width="100%" height={84}>
              <ComposedChart data={chartData} syncId={`pgsync${uid}`} margin={{ top: 8, right: comparing ? 58 : 16, bottom: 4, left: 0 }}>
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} ticks={[30, 70]} width={56}
                  tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <ReferenceLine y={70} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
                <Tooltip isAnimationActive={false} position={{ y: 0 }}
                  cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.75, strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    const vals = active ? (payload || []).filter(p => p.value != null) : [];
                    return vals.length ? (
                      <span className="figure" style={{ fontSize: 11, color: 'var(--color-text-primary)', background: 'var(--color-bg-popover)', border: '1px solid var(--color-border-hover)', borderRadius: 6, padding: '2px 7px' }}>
                        {vals.map(p => p.value.toFixed(1)).join(' · ')}
                      </span>
                    ) : null;
                  }} />
                {paneLines.map(l => (
                  <Line key={l.dataKey} type="monotone" dataKey={l.dataKey} name={l.name} stroke={benchmarkColor(indSlot(l.id))}
                    strokeWidth={1.25} dot={false} activeDot={ACTIVE_DOT} connectNulls isAnimationActive={false} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
    </>
  ), [axisFormat, benchmarkColor, benchmarkLabel, chartData, compareRebased, comparing, data.length,
    effFormatValue, effValueLabel, endLabelSeries, fillColor, fillOffsetRed, growth, growthBase,
    handleSelectDown, height, isFlat, lineSpan, measuring, openVal,
    overlays, paneLines, pgFillId, pgFlatFillId, pgStrokeId, stopOffsetRed, strokeColor, ticks, uid,
    yMax, yMin]);

  const wrapStyle = showCard ? {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 16,
    overflow: 'hidden',
  } : { overflow: 'hidden' };

  return (
    <div style={wrapStyle}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

        {/* Left: value + change */}
        <div>
          {title && (
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 6 }}>
              {title}
            </p>
          )}
          <p className="figure" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-text-primary)', lineHeight: 1, marginBottom: 8 }}>
            {/* No series yet (loading, or empty): hold the line's height rather than print a 0. */}
            {aLast == null ? '\u00A0' : growth ? effFormatValue(aLast) : compactIfLarge(aLast, formatValue)}
          </p>
          {data.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* percentage · trend icon · absolute change — all equal weight */}
              <span className="figure" style={{ fontSize: 13, fontWeight: 600, color: clr }}>
                {isFlat ? '0.00%' : `${aPct >= 0 ? '+' : '−'}${Math.abs(aPct).toFixed(2)}%`}
              </span>
              {!isFlat && <Icon size={14} strokeWidth={2.5} style={{ color: clr, flexShrink: 0 }} />}
              {/* A growth index starts at 100, so its points change only restates the percentage. */}
              {!growth && (
                <span className="figure" style={{ fontSize: 13, fontWeight: 500, color: clr }}>
                  {isFlat ? '—' : `${aAbs >= 0 ? '+' : '−'}${compactIfLarge(Math.abs(aAbs), formatValue)}`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: complete/growth toggle + chart-type toggle + range selector + compare */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>

          {/* Complete vs growth view — growth reindexes to 100 at the series' own
              first day, with every deposit/withdrawal after that subtracted back
              out, so it plots what the money did rather than how much there was.
              The "+" opens benchmarks and indicators; a benchmark flips to growth. */}
          {growthCapable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SegmentedControl size="sm" ariaLabel="View" value={view} onChange={setView} options={[
                { key: 'complete', label: viewLabels.complete },
                { key: 'growth', label: viewLabels.growth, title: viewLabels.hint || 'Growth of the money itself, with deposits and withdrawals removed' },
              ]} />
              <button
                onClick={() => setCompareOpen(true)}
                title="Compare against a benchmark, or add an indicator"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: comparing || indicators.length ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
                  color: comparing || indicators.length ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                <Plus size={13} />
              </button>
            </div>
          )}

          {/* Selected lines — indicators on one row, comparisons on the next, each folding
              past MAX_CHIPS into a "+N" chip that opens the picker. */}
          {indicators.length > 0 && (
            <ChipRow onMore={() => setCompareOpen(true)} chips={indicators.map(ind => ({
              key: ind.id, dashed: true, color: benchmarkColor(indSlot(ind.id)), label: indicatorLabel(ind),
              title: 'Remove indicator (edit it from +)', remove: () => setIndicators(s => s.filter(x => x.id !== ind.id)),
            }))} />
          )}
          {growth && compareSymbols.length > 0 && (
            <ChipRow onMore={() => setCompareOpen(true)} chips={compareSymbols.map(sym => ({
              key: sym, color: benchmarkColor(sym), label: benchmarkLabel(sym),
              title: 'Remove from comparison', remove: () => changeCompare(s => s.filter(x => x !== sym)),
            }))} />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

            {/* Range selector — a preset, or any dates from the calendar beside it. */}
            <SegmentedControl size="sm" ariaLabel="Range" value={custom ? null : range.label}
              onChange={l => { setRange(ranges.find(r => r.label === l)); setCustom(null); clearSelection(); }}
              options={ranges.map(r => ({ key: r.label, label: r.label }))}>
              <DateRangePicker
                value={draft}
                max={todayStr()}
                onChange={(v) => {
                  setDraft(v);
                  clearSelection();
                  // Clear goes back to the preset; a From alone runs to today; reversed dates swap.
                  if (!v.from && !v.to) { setCustom(null); return; }
                  if (!v.from) return;
                  const to = v.to || todayStr();
                  setCustom(v.from <= to ? { from: v.from, to } : { from: to, to: v.from });
                }}
                trigger={({ toggle }) => (
                  <button type="button" onClick={toggle} role="radio" aria-checked={!!custom}
                    className={`pill-item${custom ? ' active' : ''}`}
                    title={custom ? 'Change the dates' : 'Pick custom dates'} aria-label="Custom date range">
                    <span className="pill-label">
                      <Calendar size={12} strokeWidth={2} />
                      {custom && <span className="figure">{shortDate(custom.from)} – {shortDate(custom.to)}</span>}
                    </span>
                  </button>
                )}
              />
            </SegmentedControl>
          </div>
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      {loading ? (
        <Spinner height={height} />
      ) : activeEmpty ? (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
        </div>
      ) : (

        /* ── Line / area chart ──────────────────────────────────────────── */
        <div ref={chartAreaRef} style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', WebkitUserSelect: 'none' }}>
        {chartBody}
        {/* The measured range: an HTML band and label over the memoised chart, so a drag
            never re-renders the chart beneath it. Spans the plot's height (below the top
            margin, above the x-axis). */}
        {selection && (
          <>
            {/* Own layer, moved by transform on whole pixels: a band repositioned by `left` at
                fractional x left trails of its edges in Chrome on a fast drag. */}
            <div style={{
              position: 'absolute', pointerEvents: 'none', top: 4, left: 0, height: height - 34,
              transform: `translate3d(${Math.round(selection.left)}px, 0, 0)`, willChange: 'transform',
              width: Math.max(1, Math.round(selection.right) - Math.round(selection.left)),
              background: selection.pos ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
              borderLeft: `1px solid ${selection.pos ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'}`,
              borderRight: `1px solid ${selection.pos ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'}`,
            }} />
            <SelectionLabel
              viewBox={{ x: selection.left, width: selection.right - selection.left, y: 4 }}
              pct={selection.pct}
              abs={growth ? null : selection.abs}
              pos={selection.pos}
              movingRight={selection.movingRight}
              benchmarks={selection.benchmarks}
              formatValue={effFormatValue}
              host={chartAreaRef.current}
              name={valueLabel !== 'Value' ? valueLabel : null}
            />
          </>
        )}
        {/* Discoverability hint for the drag-to-measure gesture — top-right so
            it clears the x-axis labels along the bottom. Prompts to measure when
            idle, and to release once a range is selected. Kept mounted and driven
            by opacity so it fades in/out instead of jumping; the label swap
            happens while it's hidden (mid-drag), so there's no visible text jump. */}
        <div style={{
          position: 'absolute', top: -12, right: 14, pointerEvents: 'none',
          fontSize: 9.5, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          opacity: (data.length > 1 && !selecting) ? 0.5 : 0,
          transition: 'opacity 0.28s ease',
        }}>
          {selection ? 'Click to release' : 'Drag to measure'}
        </div>
        </div>
      )}

      {growthCapable && (
        <CompareIndexDialog
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          selected={compareSymbols}
          onChange={(next) => {
            // A comparison only means something rebased: picking one from Price view switches to growth.
            if (next.length > compareSymbols.length) setView('growth');
            changeCompare(next);
          }}
          colorOf={benchmarkColor}
          options={allBenchmarks}
          onAdd={addBenchmark}
          indicators={indicators}
          onIndicatorsChange={setIndicators}
          indicatorColorOf={(id) => benchmarkColor(indSlot(id))}
          initialTab={growth ? 'list' : 'indicators'}
        />
      )}
    </div>
  );
}
