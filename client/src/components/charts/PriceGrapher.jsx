import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, CartesianGrid, ComposedChart, Bar
} from 'recharts';
import { TrendingUp, TrendingDown, Layers, Activity, CandlestickChart } from 'lucide-react';
import { networthAPI } from '../../lib/api';
import { formatCurrency, compactIfLarge } from '../../lib/utils';
import ChartTooltip from './ChartTooltip';

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_RANGES = [
  { label: '1D',  days: 2   },
  { label: '5D',  days: 5   },
  { label: '1M',  days: 30  },
  { label: '6M',  days: 182 },
  { label: '1Y',  days: 365 },
  { label: 'Max', days: null },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
    { label: 'Open',  value: d.open,  color: 'rgba(255,255,255,0.75)' },
    { label: 'High',  value: d.high,  color: '#22c55e' },
    { label: 'Low',   value: d.low,   color: '#ef4444' },
    { label: 'Close', value: d.close, color: isUp ? '#22c55e' : '#ef4444' },
  ];
  return (
    <div style={{
      background: 'rgba(10,10,10,0.88)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      overflow: 'hidden',
      minWidth: 175,
    }}>
      <div style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.38)', margin: 0, fontFamily: 'var(--font-mono)' }}>
          {formatOhlcDate(d.date)}
        </p>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', color, whiteSpace: 'nowrap' }}>
              {formatValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
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
 * Floating summary for a drag-selected range, drawn inside the chart SVG at the
 * top-centre of the selection. Recharts injects `viewBox` (the selected band's
 * pixel box); `chartW` clamps it so the box never spills past the chart edge.
 */
function SelectionLabel({ viewBox, pct, abs, pos, formatValue, chartW }) {
  if (!viewBox) return null;
  // A wide frame centred on the selection; the box inside sizes to its content
  // (nowrap) so full, un-condensed numbers extend it instead of overflowing.
  const FRAME_W = 260, FRAME_H = 56;
  const centre  = viewBox.x + viewBox.width / 2 - FRAME_W / 2;
  const maxX    = (chartW || viewBox.x + viewBox.width) - FRAME_W - 4;
  const x       = Math.max(4, Math.min(centre, maxX));
  const y       = (viewBox.y ?? 0) + 6;
  const color   = pos ? '#22c55e' : '#ef4444';
  const sign    = pos ? '+' : '−';

  return (
    <foreignObject x={x} y={y} width={FRAME_W} height={FRAME_H} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: 'rgba(10,10,10,0.9)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 9, padding: '6px 11px', whiteSpace: 'nowrap',
          boxShadow: '0 8px 24px -10px rgba(0,0,0,0.7)',
        }}>
          <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(255,255,255,0.4)', margin: '0 0 3px', fontFamily: 'var(--font-mono)' }}>
            Period change
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {sign}{Math.abs(pct).toFixed(2)}%
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {sign}{formatValue(Math.abs(abs))}
            </span>
          </div>
        </div>
      </div>
    </foreignObject>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Reusable stock-style chart component.
 *
 * Props:
 *   fetchData(days)        — async fn returning [{date,value}]. Defaults to networthAPI.
 *   staticData             — static [{date,value}] array; bypasses fetching.
 *   fetchCompareData(days) — async fn for a second comparison line.
 *   fetchOHLC(days)        — async fn returning [{date,open,high,low,close}]. Enables candlestick toggle.
 *   compareLabel           — label for the compare button.
 *   onCompare              — called when Compare is clicked (for external handling).
 *   title                  — small label above the current value.
 *   valueLabel             — label shown in the tooltip (default: 'Value').
 *   formatValue(n)         — number formatter (default: formatCurrency).
 *   showCard               — wraps in a card (default true). Set false for embed use.
 *   height                 — chart pixel height (default 280).
 *   emptyText              — shown when there's no data.
 *   ranges                 — array of {label, days} (default: DEFAULT_RANGES).
 *   defaultRange           — label string for the initial range (default '1Y').
 *   refreshKey             — increment this to trigger a data refetch without remounting.
 */
export default function PriceGrapher({
  fetchData        = null,
  staticData       = null,
  fetchCompareData = null,
  fetchOHLC        = null,
  compareLabel     = 'Compare',
  onCompare        = null,
  title            = null,
  valueLabel       = 'Value',
  formatValue      = formatCurrency,
  showCard         = true,
  height           = 280,
  emptyText        = 'No data available',
  ranges           = DEFAULT_RANGES,
  defaultRange     = '1Y',
  refreshKey       = 0,
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
  const [data,        setData]        = useState([]);
  const [ohlcData,    setOhlcData]    = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [comparing,   setComparing]   = useState(false);
  const [loading,     setLoading]     = useState(!staticData);

  const doFetch = useCallback(async (r, mode) => {
    if (staticData) { setData(staticData); setLoading(false); return; }
    setLoading(true);
    try {
      if (mode === 'candle' && fetchOHLC) {
        const res = await fetchOHLC(r.days);
        setOhlcData(res ?? []);
      } else {
        const fn  = fetchData ?? ((d) => networthAPI.getDaily(d).then(res => res.data));
        const res = await fn(r.days);
        setData(res ?? []);
      }
    } catch {
      if (mode === 'candle') setOhlcData([]);
      else setData([]);
    } finally { setLoading(false); }
  }, [fetchData, fetchOHLC, staticData]);

  useEffect(() => { doFetch(range, chartMode); }, [range, doFetch, refreshKey, chartMode]);

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

  // ── Derived values ────────────────────────────────────────────────────────
  const values  = data.map(d => d.value);
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

  // ── Pad single point so Recharts renders a line ───────────────────────────
  const displayData = useMemo(() => (
    data.length === 1
      ? [data[0], { ...data[0], date: nextDayStr(data[0].date) }]
      : data
  ), [data]);

  // Resolve the drag selection into ordered endpoints + change metrics.
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
    return { x1: displayData[lo].date, x2: displayData[hi].date, abs, pct, pos: abs >= 0 };
  }, [selStart, selEnd, displayData]);

  // ── Line chart: Y domain + gradient stop at opening price ─────────────────
  const pad  = (maxVal - minVal) * 0.05 || Math.abs(maxVal) * 0.02 || 1;
  const yMin = minVal - pad;
  const yMax = maxVal + pad;
  // The green/red split must sit exactly on the opening-value reference line.
  // SVG gradients map to the RENDERED PATH's bounding box ([minVal,maxVal]), not
  // the padded axis domain — so compute the offset in data-range space, or the
  // colour break drifts off the reference line by `pad`.
  const dataRng = maxVal - minVal;
  const stopPct  = dataRng > 0 ? (1 - (openVal - minVal) / dataRng) * 100 : 50;
  // Green wins the exact open-line pixel: begin red a hair BELOW the split so a
  // value sitting on the previous close renders green, not a red/green blend.
  const stopOffsetRed = `${Math.min(100, stopPct + 0.6).toFixed(2)}%`;

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
  const showCompareBtn = !!(onCompare || fetchCompareData);
  const activeEmpty    = chartMode === 'candle' ? ohlcData.length === 0 : data.length === 0;

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
            {compactIfLarge(aLast, formatValue)}
          </p>
          {(chartMode === 'line' ? data.length > 1 : ohlcData.length > 1) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* percentage · trend icon · absolute change — all equal weight */}
              <span className="figure" style={{ fontSize: 13, fontWeight: 600, color: clr }}>
                {isFlat ? '0.00%' : `${aPct >= 0 ? '+' : '−'}${Math.abs(aPct).toFixed(2)}%`}
              </span>
              {!isFlat && <Icon size={14} strokeWidth={2.5} style={{ color: clr, flexShrink: 0 }} />}
              <span className="figure" style={{ fontSize: 13, fontWeight: 500, color: clr }}>
                {isFlat ? '—' : `${aAbs >= 0 ? '+' : '−'}${compactIfLarge(Math.abs(aAbs), formatValue)}`}
              </span>
            </div>
          )}
        </div>

        {/* Right: chart-type toggle + range selector + compare */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

            {/* Chart type toggle (only when OHLC data source provided) */}
            {fetchOHLC && (
              <div style={{ display: 'flex', gap: 2, background: 'var(--color-bg-elevated)', borderRadius: 8, padding: 2 }}>
                <button
                  onClick={() => { setChartMode('line'); clearSelection(); }}
                  title="Line chart"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: chartMode === 'line' ? 'var(--color-bg-card)' : 'transparent',
                    color: chartMode === 'line' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  <Activity size={12} />
                </button>
                <button
                  onClick={() => { setChartMode('candle'); clearSelection(); }}
                  title="Candlestick chart"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: chartMode === 'candle' ? 'var(--color-bg-card)' : 'transparent',
                    color: chartMode === 'candle' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  <CandlestickChart size={12} />
                </button>
              </div>
            )}

            {/* Range selector */}
            <div className="pill-group" style={{ display: 'flex' }}>
              {ranges.map(r => (
                <button
                  key={r.label}
                  onClick={() => { setRange(r); clearSelection(); }}
                  className={`pill-item${range.label === r.label ? ' active' : ''}`}
                  style={{ fontSize: 11, padding: '3px 9px' }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {showCompareBtn && (
            <button
              className="btn-ghost"
              style={{ fontSize: 11, padding: '3px 10px', gap: 5, opacity: comparing ? 1 : 0.55 }}
              onClick={() => {
                if (comparing) { setComparing(false); setCompareData(null); }
                else if (onCompare) { onCompare(range); }
              }}
            >
              <Layers size={11} /> {compareLabel}
            </button>
          )}
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
              tick={{ fill: '#626873', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[ohlcYMin, ohlcYMax]}
              tickFormatter={fmtY}
              tick={{ fill: '#626873', fontSize: 10, fontFamily: 'var(--font-mono)' }}
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
            data={displayData}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
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
                <stop offset={stopOffsetRed} stopColor="#22c55e" stopOpacity={0.02} />
                <stop offset={stopOffsetRed} stopColor="#ef4444" stopOpacity={0.02} />
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
              tick={{ fill: '#626873', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={fmtY}
              tick={{ fill: '#626873', fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false} tickLine={false}
              width={56} tickCount={5}
            />

            {/* Point tooltip — suppressed while a range is being measured */}
            {!selecting && !selection && (
              <Tooltip
                content={<ChartTooltip formatValue={formatValue} valueLabel={valueLabel} />}
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

            {compareData && (
              <Area
                data={compareData}
                type="monotone" dataKey="value"
                stroke="#f59e0b" strokeWidth={1.25}
                fill="none" dot={false}
                isAnimationActive={true}
                animationDuration={350}
              />
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
                    formatValue={formatValue}
                    chartW={chartAreaRef.current?.clientWidth || 0}
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
    </div>
  );
}
