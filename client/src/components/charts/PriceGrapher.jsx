import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, CartesianGrid, ComposedChart, Bar,
  usePlotArea, useYAxisScale
} from 'recharts';
import { TrendingUp, TrendingDown, Plus, Activity, CandlestickChart } from 'lucide-react';
import { networthAPI, marketAPI } from '../../lib/api';
import { formatCurrency, compactIfLarge, formatPct, CHART_COLORS, MONTHS_SHORT as MONTHS } from '../../lib/utils';
import { BENCHMARKS } from '../../lib/constants';
import ChartTooltip, { TooltipPanel } from './ChartTooltip';
import CompareIndexDialog from './CompareIndexDialog';
import SegmentedControl from '../ui/SegmentedControl';

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_RANGES = [
  { label: '1D',  days: 2   },
  { label: '5D',  days: 5   },
  { label: '1M',  days: 30  },
  { label: '6M',  days: 182 },
  { label: '1Y',  days: 365 },
  { label: 'Max', days: null },
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

/**
 * X-axis tick selection for OHLC data.
 * Handles both hourly ("YYYY-MM-DDTHH:MM") and daily dates.
 */
function getOhlcTicks(data) {
  if (!data.length) return [];
  if (data[0]?.date?.includes('T')) {
    // Hourly: ~7 evenly-spaced ticks
    const step = Math.max(1, Math.floor(data.length / 7));
    return data.filter((_, i) => i % step === 0).map(d => d.date);
  }
  return getTicks(data);
}

/**
 * X-axis tick label for OHLC data.
 */
function formatOhlcTick(dateStr, span) {
  if (!dateStr) return '';
  if (dateStr.includes('T')) return dateStr.split('T')[1]?.slice(0, 5) || '';
  return formatTick(dateStr, span);
}

/**
 * Full human-readable date/time label for the OHLC tooltip header.
 * "2024-01-15"         → "Jan 15, 2024"
 * "2024-01-15T09:30"   → "Jan 15, 2024 · 09:30"
 */
function formatOhlcDate(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('T')) {
    const [datePart, timePart] = dateStr.split('T');
    const [y, m, d] = datePart.split('-');
    return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y} · ${timePart.slice(0, 5)}`;
  }
  const [y, m, d] = dateStr.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

/** Pad single-point data to 2 points so Recharts renders a line. */
function nextDayStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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

/** The Recharts dataKey a benchmark's rebased series is merged into. */
const cmpKey = (symbol) => `cmp:${symbol}`;

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

// ── Candlestick shape factory ─────────────────────────────────────────────────

/**
 * Returns a Recharts Bar shape that draws OHLC candlesticks.
 * yMinVal — YAxis domain minimum (passed via closure for pixel-scale math).
 *
 * Recharts gives us:
 *   y      = pixel y-coordinate of `close` (bar top, since baseline = yMin)
 *   height = pixel distance from yMin to close
 * Therefore: scale = height / (close − yMin)
 *            yAt(p) = y + (close − p) × scale
 */
function makeCandleShape(yMinVal) {
  return function CandleShape({ x, y, width, height, payload }) {
    if (!payload || height <= 0) return null;
    const { open, high, low, close } = payload;
    if (close == null) return null;

    const isUp  = close >= open;
    const color = isUp ? '#22c55e' : '#ef4444';
    const scale = height / Math.max(close - yMinVal, 1e-9);
    const yAt   = (v) => y + (close - v) * scale;

    const yH      = yAt(high);
    const yL      = yAt(low);
    const yO      = yAt(open);
    const bodyTop = Math.min(yO, y);        // y = yAt(close)
    const bodyH   = Math.max(1, Math.abs(yO - y));
    const bw      = Math.max(2, width - 2);
    const wickX   = x + width / 2;

    return (
      <g>
        <line x1={wickX} y1={yH} x2={wickX} y2={yL} stroke={color} strokeWidth={1} />
        <rect x={x + (width - bw) / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
      </g>
    );
  };
}

// ── OHLC tooltip ──────────────────────────────────────────────────────────────

function OhlcTooltip({ active, payload, formatValue }) {
  if (!active || !payload?.[0]?.payload) return null;
  const d    = payload[0].payload;
  const isUp = d.close >= d.open;
  const rows = [
    { label: 'Open',  value: d.open,  color: 'var(--color-text-secondary)' },
    { label: 'High',  value: d.high,  color: 'var(--color-success)' },
    { label: 'Low',   value: d.low,   color: 'var(--color-danger)' },
    { label: 'Close', value: d.close, color: isUp ? 'var(--color-success)' : 'var(--color-danger)' },
  ];
  return (
    <TooltipPanel minWidth={175}>
      <div style={{ padding: '6px 12px', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
          {formatOhlcDate(d.date)}
        </p>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', color, whiteSpace: 'nowrap' }}>
              {formatValue(value)}
            </span>
          </div>
        ))}
      </div>
    </TooltipPanel>
  );
}

// ── Animated value hook ───────────────────────────────────────────────────────

function useAnimatedValue(target, duration = 380) {
  const [value, setValue] = useState(target);
  const frameRef = useRef();
  const fromRef  = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    const to   = target;
    if (from === to) return;

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

  return value;
}

// ── Drag-selection summary label ───────────────────────────────────────────────

/**
 * Floating summary for a drag-selected range, at the top-centre of the selection.
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

function SelectionBox({ viewBox, pct, abs, pos, benchmarks, formatValue, host, name }) {
  const boxRef = useRef(null);
  const centre = viewBox.x + viewBox.width / 2;
  // Centre on the selection, clamped inside the chart — needs the box's own width, so it
  // is placed after layout.
  useLayoutEffect(() => {
    const el = boxRef.current;
    const w = el.offsetWidth, W = host.clientWidth;
    el.style.left = `${Math.max(4, Math.min(centre - w / 2, W - w - 4))}px`;
    el.style.visibility = 'visible';
  });
  const color   = pos ? '#22c55e' : '#ef4444';
  const sign    = pos ? '+' : '−';
  const mono    = { fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' };
  const muted   = 'rgba(255,255,255,0.62)';
  const head    = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(255,255,255,0.4)', ...mono };

  return createPortal(
    <div ref={boxRef} style={{
      position: 'absolute', top: (viewBox.y ?? 0) + 6, left: 0, zIndex: 5, pointerEvents: 'none',
      visibility: 'hidden',
    }}>
      <div style={{
        background: 'var(--color-bg-popover)',
        border: '1px solid var(--color-border-hover)',
        borderRadius: 9, padding: '6px 11px', whiteSpace: 'nowrap',
        boxShadow: 'var(--shadow-popover)',
      }}>
        <p style={{ ...head, margin: '0 0 3px' }}>{name ? `${name} · period change` : 'Period change'}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color, lineHeight: 1, ...mono }}>
            {sign}{Math.abs(pct).toFixed(2)}%
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color, lineHeight: 1, ...mono }}>
            {sign}{formatValue(Math.abs(abs))}
          </span>
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
                  <span style={{ fontSize: 10.5, color: muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
            <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', margin: '5px 0 0' }}>
              Gap = {name || 'this line'}’s return − each line’s, in points
            </p>
          </div>
        )}
      </div>
    </div>,
    host,
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
 *   fetchOHLC(days)         — async fn returning [{date,open,high,low,close}]. Enables candlestick toggle.
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
  fetchOHLC        = null,
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
}) {
  // ── Unique gradient IDs — prevents cross-instance bleed when multiple
  //    PriceGraphers share the same SVG defs namespace ────────────────────────
  const uid        = useId().replace(/:/g, '-');
  const pgStrokeId   = `pgS${uid}`;
  const pgFillId     = `pgF${uid}`;
  const pgFlatFillId = `pgFF${uid}`;

  const initRange = ranges.find(r => r.label === defaultRange) ?? ranges[ranges.length - 2] ?? ranges[0];
  const [range,       setRange]       = useState(initRange);
  const [chartMode,   setChartMode]   = useState('line');  // 'line' | 'candle'
  const [view,        setView]        = useState(defaultView); // 'complete' | 'growth'
  const [data,        setData]        = useState([]);
  const [ohlcData,    setOhlcData]    = useState([]);
  const [loading,     setLoading]     = useState(!staticData);

  // ── Benchmark comparison (growth view only) ───────────────────────────────
  const [compareOpen,    setCompareOpen]    = useState(false);
  const [compareSymbols, setCompareSymbols] = useState(defaultCompare); // selected symbols
  const [compareSeries,  setCompareSeries]  = useState({});       // symbol -> [{date,close}]
  const slotsRef = useRef({});
  const { colorOf: benchmarkColor, labelOf: benchmarkLabel } = useMemo(
    () => benchmarkLookups(benchmarks, { ...assignSlots(slotsRef.current, compareSymbols) }),
    [benchmarks, compareSymbols]);

  const growth = growthCapable && view === 'growth';

  const doFetch = useCallback(async (r, mode, isGrowth) => {
    if (staticData) { setData(staticData); setLoading(false); return; }
    setLoading(true);
    try {
      if (mode === 'candle' && fetchOHLC) {
        const res = await fetchOHLC(r.days);
        setOhlcData(res ?? []);
      } else {
        // The default series is net worth: T cash + the T-1 close, with today's row
        // always appended (see networthAPI.getDaily).
        const fn  = fetchData ?? ((d, g) => networthAPI.getDaily(d, g).then(res => res.data));
        const res = await fn(r.days, isGrowth);
        setData(res ?? []);
      }
    } catch {
      if (mode === 'candle') setOhlcData([]);
      else setData([]);
    } finally { setLoading(false); }
  }, [fetchData, fetchOHLC, staticData]);

  useEffect(() => { doFetch(range, chartMode, growth); }, [range, doFetch, refreshKey, chartMode, growth]);

  // Fetch every selected benchmark's raw close series over (roughly) the same window
  // as the primary series — re-based against it client-side once fetched (see
  // `compareRebased` below), so this only ever needs the RAW prices, not an index.
  useEffect(() => {
    if (!growth || !compareSymbols.length) { setCompareSeries({}); return; }
    let cancelled = false;
    const days = range.days ? range.days + 10 : 3650; // +10: buffer for the anchor day
    Promise.all(compareSymbols.map(sym =>
      marketAPI.indexSeries(sym, days).then(res => [sym, res.data ?? []]).catch(() => [sym, []])
    )).then(entries => { if (!cancelled) setCompareSeries(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [growth, compareSymbols, range]);

  // ── Drag-to-measure selection (line mode) ─────────────────────────────────
  // A click-drag across the plot highlights a range and shows its % / absolute
  // change. Refs mirror the live drag so mouse-up logic never reads stale state.
  const [selStart, setSelStart] = useState(null); // x-label (date) where drag began
  const [selEnd,   setSelEnd]   = useState(null); // x-label under the cursor
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  const dragStartRef = useRef(null);
  const chartAreaRef = useRef(null);

  const clearSelection = useCallback(() => {
    selectingRef.current = false;
    dragStartRef.current = null;
    setSelecting(false);
    setSelStart(null);
    setSelEnd(null);
  }, []);

  const handleSelectDown = (e) => {
    if (chartMode !== 'line' || !e || e.activeLabel == null) return;
    selectingRef.current = true;
    dragStartRef.current = e.activeLabel;
    setSelecting(true);
    setSelStart(e.activeLabel);
    setSelEnd(e.activeLabel);
  };
  const handleSelectMove = (e) => {
    if (!selectingRef.current || !e || e.activeLabel == null) return;
    setSelEnd(e.activeLabel);
  };
  const handleSelectUp = (e) => {
    if (!selectingRef.current) return;
    selectingRef.current = false;
    setSelecting(false);
    const end = e && e.activeLabel != null ? e.activeLabel : selEnd;
    // A plain click (no drag) clears any existing selection instead of leaving
    // a zero-width band.
    if (end == null || end === dragStartRef.current) clearSelection();
    else setSelEnd(end);
  };

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

  const chartData = useMemo(() => {
    const symbols = Object.keys(compareRebased);
    if (!symbols.length) return displayData;
    return displayData.map((row, i) => {
      const extra = {};
      for (const sym of symbols) extra[cmpKey(sym)] = compareRebased[sym][i];
      return { ...row, ...extra };
    });
  }, [displayData, compareRebased]);

  // ── Derived values ────────────────────────────────────────────────────────
  // An index has no currency and no compacting to lakhs/crores — it is a plain
  // number centred on 100, so it gets its own formatter rather than reusing
  // whatever the caller passes for rupee figures.
  const formatIndex  = (v) => (v == null ? '—' : v.toFixed(2));
  // The value every growth percentage is measured from. Null/0 would make the ratio
  // meaningless, so the tooltip simply omits the percentage in that case.
  const growthBase   = displayData.find(d => d.value != null && d.value !== 0)?.value ?? null;
  const effFormatValue = growth ? formatIndex : formatValue;
  const effValueLabel  = growth ? 'Growth index' : valueLabel;
  const comparing = growth && Object.keys(compareRebased).length > 0;


  // Nulls (a growth series with no meaningful base) are dropped before min/max —
  // Math.max/min coerce `null` to 0, which would otherwise skew the Y domain.
  // The Y domain must also fit any comparison line, or it renders clipped.
  const values  = [
    ...data.map(d => d.value),
    ...Object.values(compareRebased).flat(),
  ].filter(v => v != null);
  const openVal = chartMode === 'candle' ? (ohlcData[0]?.open ?? 0)                    : (data[0]?.value ?? 0);
  const lastVal = chartMode === 'candle' ? (ohlcData[ohlcData.length - 1]?.close ?? 0) : (data[data.length - 1]?.value ?? 0);
  const absChng = lastVal - openVal;
  const pctChng = openVal !== 0 ? (absChng / Math.abs(openVal)) * 100 : 0;
  const isPos   = absChng >= 0;
  const maxVal  = values.length ? Math.max(...values) : 0;
  const minVal  = values.length ? Math.min(...values) : 0;
  const isFlat  = data.length > 0 && maxVal === minVal && chartMode === 'line';

  // Animated stats
  const aLast = useAnimatedValue(lastVal);
  const aAbs  = useAnimatedValue(absChng);
  const aPct  = useAnimatedValue(pctChng);

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
    if (selStart == null || selEnd == null) return null;
    const iA = displayData.findIndex(d => d.date === selStart);
    const iB = displayData.findIndex(d => d.date === selEnd);
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

    return { x1: displayData[lo].date, x2: displayData[hi].date, abs, pct, pos: abs >= 0, benchmarks: measured };
  }, [selStart, selEnd, displayData, compareRebased, benchmarkColor, benchmarkLabel]);

  // ── Line chart: Y domain + gradient stop at opening price ─────────────────
  const pad  = (maxVal - minVal) * 0.05 || Math.abs(maxVal) * 0.02 || 1;
  const yMin = minVal - pad;
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
  const primary  = data.map(d => d.value).filter(v => v != null);
  const pMin     = primary.length ? Math.min(...primary) : 0;
  const pMax     = primary.length ? Math.max(...primary) : 0;
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

  // ── OHLC Y domain ─────────────────────────────────────────────────────────
  const ohlcMinRaw = ohlcData.length ? Math.min(...ohlcData.map(d => d.low))  : 0;
  const ohlcMaxRaw = ohlcData.length ? Math.max(...ohlcData.map(d => d.high)) : 1;
  const ohlcPad    = (ohlcMaxRaw - ohlcMinRaw) * 0.05 || Math.abs(ohlcMaxRaw) * 0.02 || 1;
  const ohlcYMin   = ohlcMinRaw - ohlcPad;
  const ohlcYMax   = ohlcMaxRaw + ohlcPad;

  // Memoised candle shape (changes only when ohlcYMin changes)
  const candleShape = useMemo(() => makeCandleShape(ohlcYMin), [ohlcYMin]);

  // ── X-axis ticks + span (computed from actual data, not just range.days) ──
  const ticks     = getTicks(displayData);
  const ohlcTicks = getOhlcTicks(ohlcData);
  const lineSpan  = useMemo(() => computeSpan(displayData), [displayData]);
  const ohlcSpan  = useMemo(() => computeSpan(ohlcData),    [ohlcData]);

  // ── Misc ──────────────────────────────────────────────────────────────────
  const Icon           = isPos ? TrendingUp : TrendingDown;
  const clr            = isFlat ? '#C9A96A' : isPos ? 'var(--color-success)' : 'var(--color-danger)';
  const activeEmpty    = chartMode === 'candle' ? ohlcData.length === 0 : data.length === 0;
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
            {growth ? effFormatValue(aLast) : compactIfLarge(aLast, formatValue)}
          </p>
          {(chartMode === 'line' ? data.length > 1 : ohlcData.length > 1) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* percentage · trend icon · absolute change — all equal weight */}
              <span className="figure" style={{ fontSize: 13, fontWeight: 600, color: clr }}>
                {isFlat ? '0.00%' : `${aPct >= 0 ? '+' : '−'}${Math.abs(aPct).toFixed(2)}%`}
              </span>
              {!isFlat && <Icon size={14} strokeWidth={2.5} style={{ color: clr, flexShrink: 0 }} />}
              <span className="figure" style={{ fontSize: 13, fontWeight: 500, color: clr }}>
                {isFlat ? '—' : `${aAbs >= 0 ? '+' : '−'}${growth ? effFormatValue(Math.abs(aAbs)) : compactIfLarge(Math.abs(aAbs), formatValue)}`}
              </span>
            </div>
          )}
        </div>

        {/* Right: complete/growth toggle + chart-type toggle + range selector + compare */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>

          {/* Complete vs growth view — growth reindexes to 100 at the series' own
              first day, with every deposit/withdrawal after that subtracted back
              out, so it plots what the money did rather than how much there was.
              The "+" (growth only) opens the benchmark-comparison picker. */}
          {growthCapable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SegmentedControl size="sm" ariaLabel="View" value={view} onChange={setView} options={[
                { key: 'complete', label: viewLabels.complete },
                { key: 'growth', label: viewLabels.growth, title: viewLabels.hint || 'Growth of the money itself, with deposits and withdrawals removed' },
              ]} />
              {growth && (
                <button
                  onClick={() => setCompareOpen(true)}
                  title="Compare against an index"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: comparing ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
                    color: comparing ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
          )}

          {/* Selected benchmarks — colour-matched chips, each removable without
              reopening the picker. */}
          {growth && compareSymbols.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 220 }}>
              {compareSymbols.map(sym => (
                <button
                  key={sym}
                  onClick={() => setCompareSymbols(s => s.filter(x => x !== sym))}
                  title="Remove from comparison"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '2px 7px 2px 6px', borderRadius: 999, cursor: 'pointer',
                    border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-elevated)',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: benchmarkColor(sym), flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                    {benchmarkLabel(sym)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1 }}>×</span>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

            {/* Chart type toggle (only when OHLC data source provided) */}
            {fetchOHLC && (
              <SegmentedControl size="sm" ariaLabel="Chart type" value={chartMode}
                onChange={m => { setChartMode(m); clearSelection(); }}
                options={[
                  { key: 'line',   icon: Activity,         title: 'Line chart' },
                  { key: 'candle', icon: CandlestickChart, title: 'Candlestick chart' },
                ]} />
            )}

            {/* Range selector */}
            <SegmentedControl size="sm" ariaLabel="Range" value={range.label}
              onChange={l => { setRange(ranges.find(r => r.label === l)); clearSelection(); }}
              options={ranges.map(r => ({ key: r.label, label: r.label }))} />
          </div>
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
        </div>
      ) : activeEmpty ? (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
        </div>
      ) : chartMode === 'candle' ? (

        /* ── Candlestick chart ──────────────────────────────────────────── */
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={ohlcData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <pattern id={`${pgFillId}-dots-c`} width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="rgba(180,196,220,0.10)" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} horizontal={false} fill={`url(#${pgFillId}-dots-c)`} fillOpacity={1} />
            <XAxis
              dataKey="date"
              ticks={ohlcTicks}
              tickFormatter={d => formatOhlcTick(d, ohlcSpan)}
              tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[ohlcYMin, ohlcYMax]}
              tickFormatter={axisFormat}
              tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false}
              width={56} tickCount={5}
            />
            <Tooltip
              content={<OhlcTooltip formatValue={formatValue} />}
              cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.75, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              wrapperStyle={{ transition: 'none', outline: 'none' }}
            />
            <Bar
              dataKey="close"
              shape={candleShape}
              maxBarSize={20}
              minPointSize={1}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

      ) : (

        /* ── Line / area chart ──────────────────────────────────────────── */
        <div ref={chartAreaRef} style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: comparing ? 58 : 16, bottom: 0, left: 0 }}
            onMouseDown={handleSelectDown}
            onMouseMove={handleSelectMove}
            onMouseUp={handleSelectUp}
            onMouseLeave={handleSelectUp}
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
              tickFormatter={growth ? fmtYIndex : axisFormat}
              tick={{ fill: '#878D97', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false}
              width={56} tickCount={5}
            />

            {/* Point tooltip — suppressed while a range is being measured. When
                comparing, each series carries its own `name` (set below) instead
                of one shared label, so `valueLabel` is left unset and ChartTooltip
                falls back to per-series names. */}
            {!selecting && !selection && (
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={effFormatValue}
                    valueLabel={comparing ? undefined : effValueLabel}
                    // Growth only. The anchor is the first VISIBLE point, which is also
                    // what every benchmark overlay was rebased to — so the primary line
                    // and its comparisons all report percentages from the same instant.
                    percentBase={growth ? growthBase : undefined}
                  />
                }
                cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.75, strokeDasharray: '3 3' }}
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
              activeDot={(selecting || selection) ? false : (props) => {
                // Colour the hover dot by the region it sits in (above/below the
                // opening reference line), matching the line's own colour there.
                // Suppressed while measuring so it never covers the selection box.
                const v = props?.payload?.value;
                const color = isFlat ? '#C9A96A' : (v >= openVal ? '#22c55e' : '#ef4444');
                return <circle cx={props.cx} cy={props.cy} r={3} fill={color} stroke="none" />;
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
                animationDuration={350}
              />
            ))}

            {/* Each line's percentage, at the line's own end. Last child so it paints
                over the series rather than under them. */}
            {comparing && endLabelSeries.length > 0 && (
              <EndLabels series={endLabelSeries} base={growthBase} />
            )}

            {/* Drag-selected range — tinted band + change summary */}
            {selection && (
              <ReferenceArea
                x1={selection.x1}
                x2={selection.x2}
                fill={selection.pos ? '#22c55e' : '#ef4444'}
                fillOpacity={0.1}
                stroke={selection.pos ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'}
                strokeWidth={1}
                isAnimationActive={false}
                label={(
                  <SelectionLabel
                    pct={selection.pct}
                    abs={selection.abs}
                    pos={selection.pos}
                    benchmarks={selection.benchmarks}
                    formatValue={effFormatValue}
                    host={chartAreaRef.current}
                    name={valueLabel !== 'Value' ? valueLabel : null}
                  />
                )}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
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
          onChange={setCompareSymbols}
          colorOf={benchmarkColor}
          options={benchmarks}
        />
      )}
    </div>
  );
}
