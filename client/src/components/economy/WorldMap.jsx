import { memo, useMemo, useRef, useState } from 'react';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import SegmentedControl from '../ui/SegmentedControl';
import TypePicker from '../forms/TypePicker';
import { TooltipPanel } from '../charts/ChartTooltip';
import Flag from './Flag';
import { CHART_COLORS, signedTone } from '../../lib/utils';
import { signedPct } from '../../lib/economy';
import GEO from '../../lib/worldMap.json';

// The geometry's ISO code where the IMF uses its own (Kosovo, West Bank and Gaza).
const GEO_ALIAS = { XKX: 'UVK', PSE: 'WBG' };
const isoOf = (geoIso) => GEO_ALIAS[geoIso] || geoIso;
// Shares of GDP are dominated by tiny economies, so the leaders strip only ranks those of this size ($bn).
const LEADER_MIN_GDP = 200;
const NO_DATA = 'var(--color-bg-elevated)';

// Capital moving is identity (in vs out), not gain or loss, so it takes blue and amber, never green and red.
const flowTone = (v, cap) => {
  if (v == null) return NO_DATA;
  const t = cap ? Math.min(Math.abs(v) / cap, 1) : 0;
  return `color-mix(in srgb, ${v >= 0 ? CHART_COLORS[1] : 'var(--color-chart-warm)'} ${Math.round(12 + t * 66)}%, var(--color-bg-elevated))`;
};
const goldTone = (v, cap) => {
  if (v == null) return NO_DATA;
  const t = Math.min(Math.log10(Math.max(v, 300) / 300) / Math.log10(cap / 300), 1);
  return `color-mix(in srgb, ${CHART_COLORS[0]} ${Math.round(8 + t * 72)}%, var(--color-bg-elevated))`;
};
const usdK = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`);

const METRICS = [
  {
    key: 'capital', label: 'Capital in / out', tone: flowTone, signed: true, poles: ['Sends abroad', 'Draws in'],
    value: (r) => (r.ca != null ? -r.ca : null), fmt: (v) => `${signedPct(v)} of GDP`,
    sub: (y) => `Foreign money an economy draws in (blue) or sends abroad (amber), as a share of its output: the mirror of its current account. A country spending more abroad than it earns must be financed by capital arriving. IMF, ${y}.`,
    top: ['Draws in most', 'Sends out most'],
  },
  {
    key: 'fdi', label: 'Direct investment', tone: flowTone, signed: true, poles: ['Net outflow', 'Inflow'],
    value: (r) => r.fdiPct ?? null, fmt: (v) => `${signedPct(v)} of GDP`, year: (r) => r.fdiPctYear,
    sub: () => 'Foreign direct investment received, net, as a share of GDP: long-term capital choosing to build in a country. World Bank, each country’s latest year.',
    top: ['Most received', 'Least received'],
  },
  {
    key: 'markets', label: 'Markets 1Y', tone: signedTone, signed: true, poles: ['Fell', 'Rose'],
    value: (r) => r.market ?? null, fmt: (v) => `${signedPct(v)} in $`,
    sub: () => 'What each country’s stock market paid a dollar investor over the last year, through the US-listed fund that tracks it. Only markets with such a fund are coloured.',
    top: ['Best', 'Worst'],
  },
  {
    key: 'growth', label: 'Growth', tone: signedTone, signed: true, poles: ['Shrinking', 'Growing'],
    value: (r) => r.growth ?? null, fmt: (v) => signedPct(v), sub: (y) => `Real GDP growth, the IMF's estimate for ${y}.`,
    top: ['Fastest', 'Slowest'],
  },
  {
    key: 'income', label: 'Income', tone: goldTone, signed: false, poles: ['Poorer', 'Richer'],
    value: (r) => r.perCapita ?? null, fmt: usdK, sub: (y) => `GDP per person in US dollars: how far an economy still has to grow. IMF, ${y}. Log scale.`,
    top: ['Richest', 'Poorest'],
  },
];

/** The scale's cap: the 75th-percentile magnitude, so one outlier does not wash every other country out. */
function capOf(values, signed) {
  const mags = values.map(v => (signed ? Math.abs(v) : v)).sort((a, b) => a - b);
  return mags.length ? mags[Math.floor((mags.length - 1) * 0.75)] || 1 : 1;
}

// The countries themselves; drawn once per metric, never on hover.
const Shapes = memo(function Shapes({ fills, onHover, onPick }) {
  return (
    <g>
      {Object.entries(GEO.shapes).map(([geo, d]) => (
        <path key={geo} d={d} fill={fills[isoOf(geo)] || NO_DATA} stroke="var(--color-bg-card)" strokeWidth={0.6}
          style={{ cursor: fills[isoOf(geo)] ? 'pointer' : 'default' }}
          onMouseEnter={() => onHover(isoOf(geo))} onClick={() => onPick(isoOf(geo))} />
      ))}
      {Object.entries(GEO.dots).filter(([geo]) => fills[isoOf(geo)]).map(([geo, [x, y]]) => (
        <g key={geo} onMouseEnter={() => onHover(isoOf(geo))} onClick={() => onPick(isoOf(geo))} style={{ cursor: 'pointer' }}>
          <circle cx={x} cy={y} r={7} fill="transparent" />
          <circle cx={x} cy={y} r={2.8} fill={fills[isoOf(geo)]} stroke="var(--color-bg-card)" strokeWidth={0.8} />
        </g>
      ))}
    </g>
  );
});

function Outline({ iso, color, width }) {
  const geo = Object.keys(GEO_ALIAS).find(k => GEO_ALIAS[k] === iso) || iso;
  if (GEO.shapes[geo]) return <path d={GEO.shapes[geo]} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" pointerEvents="none" />;
  const dot = GEO.dots[geo];
  return dot ? <circle cx={dot[0]} cy={dot[1]} r={5} fill="none" stroke={color} strokeWidth={width} pointerEvents="none" /> : null;
}

function Leaders({ title, rows, m, onPick, selected }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className="col-head" style={{ marginBottom: 6 }}>{title}</p>
      {rows.map(r => (
        <button key={r.iso} type="button" onClick={() => onPick(r.iso)} className="flex items-center w-full"
          style={{ gap: 10, padding: '5px 0', borderBottom: '1px solid var(--color-border-subtle)', textAlign: 'left' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: m.tone(r.v, r.cap), flexShrink: 0 }} />
          <span className="text-sm" style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: r.iso === selected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: r.iso === selected ? 500 : 400,
          }}>{r.name}</span>
          <span className="figure text-xs" style={{ color: 'var(--color-text-secondary)' }}>{m.fmt(r.v).replace(' of GDP', '').replace(' in $', '')}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The world as one choropleth: where capital is going and how fast each economy grows. Clicking a country
 * (or picking it) makes it the page's subject; the figures below follow it.
 */
export default function WorldMap({ map, markets, year, selected, onSelect }) {
  const [key, setKey] = useState('capital');
  const [hover, setHover] = useState(null);
  const [pos, setPos] = useState(null);
  const wrap = useRef(null);
  const m = METRICS.find(x => x.key === key);

  const rows = useMemo(() => {
    const ret = Object.fromEntries((markets || []).filter(x => !x.group).map(x => [x.iso, x.returns?.['1y']]));
    return Object.entries(map || {}).map(([iso, r]) => ({ iso, ...r, market: ret[iso] ?? null }));
  }, [map, markets]);

  const { fills, cap, values } = useMemo(() => {
    const values = Object.fromEntries(rows.map(r => [r.iso, m.value(r)]).filter(([, v]) => v != null && Number.isFinite(v)));
    const cap = m.key === 'income' ? Math.max(...Object.values(values), 1000) : capOf(Object.values(values), m.signed);
    return { values, cap, fills: Object.fromEntries(Object.entries(values).map(([iso, v]) => [iso, m.tone(v, cap)])) };
  }, [rows, m]);

  const leaders = useMemo(() => {
    const ranked = rows.filter(r => values[r.iso] != null && (m.key === 'markets' || (r.gdpUsd ?? 0) >= LEADER_MIN_GDP))
      .map(r => ({ iso: r.iso, name: r.name, v: values[r.iso], cap })).sort((a, b) => b.v - a.v);
    return [ranked.slice(0, 5), ranked.slice(-5).reverse()];
  }, [rows, values, m, cap]);

  const options = useMemo(() => rows.filter(r => r.gdpUsd != null).sort((a, b) => a.name.localeCompare(b.name))
    .map(r => ({ value: r.iso, label: r.name, icon: <Flag iso={r.iso} /> })), [rows]);

  const onPick = useMemo(() => (iso) => { if (map?.[iso]) onSelect(iso); }, [map, onSelect]);
  const onHover = useMemo(() => (iso) => setHover(iso), []);
  const h = hover && map?.[hover];
  const hv = hover ? values[hover] : null;
  const steps = m.signed ? [-1, -0.6, -0.25, 0, 0.25, 0.6, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1];

  return (
    <Card>
      <SectionHeader eyebrow="The world’s economies" size="sm" style={{ marginBottom: 14 }} sub={m.sub(year)}
        action={<div style={{ width: 220 }}><TypePicker options={options} value={selected} onChange={onPick} searchable showIcon placeholder="Find a country" /></div>} />
      <SegmentedControl size="sm" ariaLabel="Map measure" value={key} onChange={setKey}
        options={METRICS.map(x => ({ key: x.key, label: x.label }))} style={{ marginBottom: 12 }} />

      <div ref={wrap} style={{ position: 'relative' }}
        onMouseMove={(e) => { const b = wrap.current.getBoundingClientRect(); setPos({ x: e.clientX - b.left, y: e.clientY - b.top, w: b.width }); }}
        onMouseLeave={() => { setHover(null); setPos(null); }}>
        <svg viewBox={`0 0 ${GEO.w} ${GEO.h}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
          aria-label={`World map coloured by ${m.label.toLowerCase()}`}>
          <Shapes fills={fills} onHover={onHover} onPick={onPick} />
          {hover && hover !== selected && <Outline iso={hover} color="var(--color-text-secondary)" width={1} />}
          {selected && <Outline iso={selected} color="var(--color-text-primary)" width={1.6} />}
        </svg>
        {h && pos && (
          <div style={{ position: 'absolute', left: Math.min(pos.x + 14, pos.w - 200), top: pos.y + 14, pointerEvents: 'none', zIndex: 2 }}>
            <TooltipPanel minWidth={180}>
              <div style={{ padding: '10px 12px' }}>
                <p className="flex items-center text-sm" style={{ gap: 8, color: 'var(--color-text-primary)', fontWeight: 500 }}><Flag iso={hover} height={12} />{h.name}</p>
                <p className="figure text-xs" style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
                  {hv != null ? `${m.fmt(hv)}${m.year?.(h) ? ` · ${m.year(h)}` : ''}` : 'No figure'}
                </p>
                {m.key !== 'growth' && h.growth != null && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>Growing {signedPct(h.growth)} in {year}</p>}
                {hover !== selected && <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>Click for its economy</p>}
              </div>
            </TooltipPanel>
          </div>
        )}
      </div>

      <div className="flex items-center" style={{ gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.poles[0]}</span>
        <div className="flex" style={{ gap: 2 }}>
          {steps.map(s => <span key={s} style={{ width: 22, height: 8, borderRadius: 2, background: m.tone(m.key === 'income' ? 300 * (cap / 300) ** s : s * cap, cap) }} />)}
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{m.poles[1]}</span>
        <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>
          {m.signed ? `full colour at ±${m.fmt(cap).replace(/^[+−]/, '')}` : `full colour at ${m.fmt(cap)}`}
        </span>
        <span className="flex items-center text-xs" style={{ gap: 6, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          <span style={{ width: 10, height: 8, borderRadius: 2, background: NO_DATA, boxShadow: 'inset 0 0 0 1px var(--color-border-hover)' }} />No figure
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 28, marginTop: 20 }}>
        <Leaders title={m.top[0]} rows={leaders[0]} m={m} onPick={onPick} selected={selected} />
        <Leaders title={m.top[1]} rows={leaders[1]} m={m} onPick={onPick} selected={selected} />
      </div>
      {m.key !== 'markets' && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>Ranked among economies above ${LEADER_MIN_GDP}B, so a small island does not top every share of GDP.</p>
      )}
    </Card>
  );
}
