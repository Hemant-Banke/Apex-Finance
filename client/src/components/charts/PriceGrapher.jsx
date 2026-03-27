import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, ComposedChart, Bar
} from 'recharts';
import { TrendingUp, TrendingDown, Layers, Activity, CandlestickChart } from 'lucide-react';
import { networthAPI } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import ChartTooltip from './ChartTooltip';

// ── Default config ────────────────────────────────────────────────────────────

export const DEFAULT_RANGES = [
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
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.38)', margin: 0 }}>
          {formatOhlcDate(d.date)}
        </p>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color }}>
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
  const displayData = data.length === 1
    ? [data[0], { ...data[0], date: nextDayStr(data[0].date) }]
    : data;

  // ── Line chart: Y domain + gradient stop at opening price ─────────────────
  const pad  = (maxVal - minVal) * 0.05 || Math.abs(maxVal) * 0.02 || 1;
  const yMin = minVal - pad;
  const yMax = maxVal + pad;
  const yRng = yMax - yMin;
  // stopOffset = vertical % where opening value sits in [yMin,yMax].
  // 0% = top (max value), 100% = bottom (min value).
  const stopOffset = yRng > 0
    ? `${((1 - (openVal - yMin) / yRng) * 100).toFixed(2)}%`
    : '50%';

  const strokeColor = isFlat ? '#2dd4bf' : `url(#${pgStrokeId})`;
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
  const clr            = isFlat ? '#2dd4bf' : isPos ? 'var(--color-success)' : 'var(--color-danger)';
  const hexClr         = isFlat ? '#2dd4bf' : isPos ? '#22c55e' : '#ef4444';
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
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-text-primary)', lineHeight: 1, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
            {formatValue(aLast)}
          </p>
          {(chartMode === 'line' ? data.length > 1 : ohlcData.length > 1) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: clr, fontVariantNumeric: 'tabular-nums' }}>
                {isFlat ? '—' : `${aAbs >= 0 ? '+' : ''}${formatValue(aAbs)}`}
              </span>
              {!isFlat && <Icon size={13} strokeWidth={2.5} style={{ color: clr, flexShrink: 0 }} />}
              {!isFlat && (
                <span style={{ fontSize: 12, fontWeight: 500, color: clr, opacity: 0.8 }}>
                  {Math.abs(aPct).toFixed(2)}%
                </span>
              )}
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
                  onClick={() => setChartMode('line')}
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
                  onClick={() => setChartMode('candle')}
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
                  onClick={() => setRange(r)}
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
          <ComposedChart data={ohlcData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="0" />
            <XAxis
              dataKey="date"
              ticks={ohlcTicks}
              tickFormatter={d => formatOhlcTick(d, ohlcSpan)}
              tick={{ fill: '#555', fontSize: 10 }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[ohlcYMin, ohlcYMax]}
              tickFormatter={fmtY}
              tick={{ fill: '#555', fontSize: 10 }}
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
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={displayData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              {/* Stroke gradient: green above the period-open price, red below */}
              <linearGradient id={pgStrokeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={stopOffset} stopColor="#22c55e" />
                <stop offset={stopOffset} stopColor="#ef4444" />
              </linearGradient>
              {/* Fill gradient: tinted green above open, tinted red below */}
              <linearGradient id={pgFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"         stopColor="#22c55e" stopOpacity={0.13} />
                <stop offset={stopOffset} stopColor="#22c55e" stopOpacity={0.02} />
                <stop offset={stopOffset} stopColor="#ef4444" stopOpacity={0.02} />
                <stop offset="100%"       stopColor="#ef4444" stopOpacity={0.10} />
              </linearGradient>
              {/* Flat fill: neutral teal tint */}
              <linearGradient id={pgFlatFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#2dd4bf" stopOpacity={0.10} />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="0" />

            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={d => formatTick(d, lineSpan)}
              tick={{ fill: '#555', fontSize: 10 }}
              axisLine={false} tickLine={false} dy={8}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={fmtY}
              tick={{ fill: '#555', fontSize: 10 }}
              axisLine={false} tickLine={false}
              width={56} tickCount={5}
            />

            <Tooltip
              content={<ChartTooltip formatValue={formatValue} valueLabel={valueLabel} />}
              cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.75, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              wrapperStyle={{ transition: 'none', outline: 'none' }}
            />

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
              activeDot={{ r: 3, fill: hexClr, strokeWidth: 0 }}
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
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
