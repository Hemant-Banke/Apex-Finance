import { useEffect, useMemo, useState } from 'react';
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import ShowMore from '../ui/ShowMore';
import Card from '../ui/Card';
import SectionHeader from '../ui/SectionHeader';
import Spinner from '../ui/Spinner';
import SegmentedControl from '../ui/SegmentedControl';
import DivergingBar from '../ui/DivergingBar';
import { TooltipPanel } from '../charts/ChartTooltip';
import { marketsAPI } from '../../lib/api';
import { formatPct, pnlColor, formatCrore, formatPoints as pp } from '../../lib/utils';
import { WINDOWS, windowOf, formatLevel, stockPath } from '../../lib/markets';

/**
 * Where the money is moving — between sectors, and inside each one.
 *
 * Built from the Nifty 500 stock by stock (see sectorService), which is what makes two
 * things possible that a board of sector INDICES could not do:
 *
 *  - **Drilling in.** Click a sector and the same map redraws for its stocks — each box a
 *    company, its area the company's market cap, its colour how it moved. "Auto fell 9%"
 *    becomes "Auto fell 9%, and it was the two-wheeler makers".
 *  - **Naming names.** Every sector row carries its best and worst stock over the window,
 *    so the leaders and laggards are read off the page instead of hovered for.
 *
 * Two views of one window at each level, because they answer different questions:
 * the MAP (size and move at once — a 6% fall in media is a rounding error, a 2% fall in
 * private banks is the day's story) and the RANKING beneath it, measured against the
 * level above — a sector against the whole 500, a stock against its own sector. On a day
 * everything fell, the map is a field of red; the ranking still shows who fell least,
 * which is the money finding somewhere to hide. That gap is in points (`pp`): the
 * difference of two returns is not itself a return.
 *
 * The colour is a diverging scale with a NEUTRAL middle — flat is grey, not faintly
 * green — that saturates at a cap growing with the window (3% is a big day and an
 * ordinary year) and is wider for single stocks than for sectors, which average their
 * members' moves away. The figure is always printed, so colour never carries direction
 * alone.
 */
const CAP = {
  sector: { '1d': 2, '1w': 4, '1m': 8,  '1y': 25 },
  stock:  { '1d': 4, '1w': 8, '1m': 15, '1y': 50 },
};

function tone(r, cap) {
  if (r == null) return 'var(--color-bg-elevated)';
  const t = Math.min(Math.abs(r) / cap, 1);
  const pct = Math.round(10 + t * 58);
  return `color-mix(in srgb, var(--color-${r >= 0 ? 'success' : 'danger'}) ${pct}%, var(--color-bg-elevated))`;
}

/** Market cap in rupees → "₹12.4L Cr" / "₹8,240 Cr". */
const capLabel = (rupees) => (rupees ? formatCrore(rupees / 1e7) : '—');

/** Fit a label to a box's width: ~6.4px a character at 11px, an ellipsis past that. */
const fit = (text, width) => {
  const max = Math.floor((width - 14) / 6.4);
  return text.length <= max ? text : max > 3 ? `${text.slice(0, max - 1)}…` : '';
};

/**
 * One box. Recharts hands each node's own fields to the custom content; `onPick` and
 * `scale` ride along on the element. (`scale`, not `cap`: every node carries its market
 * `cap`, and a node field of the same name would silently replace the colour scale.)
 *
 * A box tall enough for two lines gets its NAME and its move — a bare "−4.1%" with nothing
 * saying of what is a figure the reader has to hover to decode. Only boxes too small for
 * any name fall back to the figure alone (the tooltip still names them).
 */
function Box(props) {
  const { x, y, width, height, depth, tag, ret, scale, onPick, id } = props;
  if (depth !== 1 || width <= 0 || height <= 0) return null;
  const name     = fit(tag || '', width);
  const twoLines = width > 44 && height > 40 && name;
  const oneLine  = width > 40 && height > 22;
  return (
    <g onClick={onPick ? () => onPick(id) : undefined} style={{ cursor: onPick ? 'pointer' : 'default' }}>
      <rect x={x} y={y} width={width} height={height} rx={4}
        style={{ fill: tone(ret, scale), stroke: 'var(--color-bg-card)', strokeWidth: 2 }} />
      {twoLines ? (
        <>
          <text x={x + 8} y={y + 18} style={{ fill: 'var(--color-text-primary)', fontSize: 11, fontWeight: 500, pointerEvents: 'none' }}>{name}</text>
          <text x={x + 8} y={y + 34} style={{ fill: 'var(--color-text-primary)', fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.85, pointerEvents: 'none' }}>
            {formatPct(ret, 1)}
          </text>
        </>
      ) : oneLine && (
        <text x={x + 6} y={y + height / 2 + 4} style={{ fill: 'var(--color-text-primary)', fontSize: 10, fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
          {formatPct(ret, 1)}
        </text>
      )}
    </g>
  );
}

function TipRow({ k, v }) {
  return (
    <div className="flex justify-between text-xs" style={{ gap: 18, marginTop: 3 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
      <span className="figure" style={{ color: 'var(--color-text-secondary)', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function MoverLine({ s, field }) {
  return (
    <div className="flex justify-between text-xs" style={{ gap: 14, marginTop: 3 }}>
      <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{s.name}</span>
      <span className="figure" style={{ color: pnlColor(s[field]), flexShrink: 0 }}>{formatPct(s[field], 1)}</span>
    </div>
  );
}

function MapTip({ active, payload, w, level }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <TooltipPanel minWidth={220} style={{ padding: '10px 12px' }}>
      <p className="text-xs" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{level === 'sector' ? d.label : d.title}</p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 7 }}>
        {level === 'sector'
          ? `${d.count} stock${d.count === 1 ? '' : 's'} · ${capLabel(d.cap)}`
          : `${d.symbol} · ₹${formatLevel(d.last)} · ${capLabel(d.cap)}`}
      </p>
      <TipRow k={`Change ${w.long}`} v={<span style={{ color: pnlColor(d.ret) }}>{formatPct(d.ret, 2)}</span>} />
      <TipRow k={level === 'sector' ? 'Against the Nifty 500' : 'Against its sector'} v={<span style={{ color: pnlColor(d.rel) }}>{pp(d.rel)}</span>} />
      {level === 'sector' && (d.best?.length > 0) && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 9, letterSpacing: '0.06em', fontSize: '0.625rem' }}>LEADERS</p>
          {d.best.map(s => <MoverLine key={s.symbol} s={s} field={w.field} />)}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 8, letterSpacing: '0.06em', fontSize: '0.625rem' }}>LAGGARDS</p>
          {d.worst.map(s => <MoverLine key={s.symbol} s={s} field={w.field} />)}
          <p className="text-xs" style={{ color: 'var(--color-accent)', marginTop: 9 }}>Click to see every stock</p>
        </>
      )}
      {level === 'stock' && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-accent)', marginTop: 9 }}>Click for the company</p>
        </>
      )}
    </TooltipPanel>
  );
}



/** A mover in a row: name and move, never colour alone — and a way into the stock. */
function Mover({ s, field, dir }) {
  if (!s) return <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>—</span>;
  return (
    <Link to={stockPath(s.symbol)} onClick={e => e.stopPropagation()} className="stock-link text-xs"
      style={{ display: 'inline-flex', gap: 6, minWidth: 0, alignItems: 'baseline' }} title={`${s.name} (${s.symbol}) — open`}>
      <span style={{ color: pnlColor(dir), flexShrink: 0 }}>{dir > 0 ? '▲' : '▼'}</span>
      <span className="truncate">{s.name}</span>
      <span className="figure" style={{ color: pnlColor(s[field]), flexShrink: 0 }}>{formatPct(s[field], 1)}</span>
    </Link>
  );
}

const SECTOR_COLS = 'minmax(130px, 1.1fr) minmax(90px, 1fr) 70px 64px minmax(150px, 1.3fr) minmax(150px, 1.3fr)';
const STOCK_COLS  = 'minmax(150px, 1.6fr) minmax(90px, 1fr) 70px 64px 90px 96px';

function SectorTable({ items, field, onPick }) {
  const ranked = [...items].sort((a, b) => (b.rel ?? -Infinity) - (a.rel ?? -Infinity));
  const max = ranked.reduce((m, i) => Math.max(m, Math.abs(i.rel || 0)), 0);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 760 }}>
        <div style={{ display: 'grid', gridTemplateColumns: SECTOR_COLS, gap: 14, padding: '0 10px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="col-head">Sector</span>
          <span className="col-head" style={{ textAlign: 'center' }}>Against the market</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Gap</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Return</span>
          <span className="col-head">Best stock</span>
          <span className="col-head">Worst stock</span>
        </div>
        {/* The leaders and the laggards stay on the page; the middle of the ranking —
            the sectors doing roughly what the market did — folds away. */}
        <ShowMore items={ranked} ends initial={8} noun="sectors" render={(i) => (
          // A row is a way into its sector; the best/worst names inside it are links of
          // their own, which is why the row is not itself a <button>.
          <div key={i.id} onClick={() => onPick(i.id)} className="sector-row"
            style={{
              display: 'grid', gridTemplateColumns: SECTOR_COLS, gap: 14, alignItems: 'center',
              padding: '9px 10px', borderBottom: '1px solid var(--color-border-subtle)', cursor: 'pointer',
            }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onPick(i.id); }} className="text-sm truncate"
              style={{ color: 'var(--color-text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
              {i.label}
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)' }}>{i.count}</span>
            </button>
            <DivergingBar value={i.rel} max={max} />
            <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(i.rel) }}>{pp(i.rel)}</span>
            <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(i.ret) }}>{formatPct(i.ret, 1)}</span>
            <Mover s={i.best?.[0]} field={field} dir={1} />
            <Mover s={i.worst?.[0]} field={field} dir={-1} />
          </div>
        )} />
      </div>
    </div>
  );
}

function StockTable({ items }) {
  const ranked = [...items].sort((a, b) => (b.ret ?? -Infinity) - (a.ret ?? -Infinity));
  const max = ranked.reduce((m, i) => Math.max(m, Math.abs(i.rel || 0)), 0);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: 'grid', gridTemplateColumns: STOCK_COLS, gap: 14, padding: '0 10px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <span className="col-head">Stock</span>
          <span className="col-head" style={{ textAlign: 'center' }}>Against the sector</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Gap</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Return</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Price</span>
          <span className="col-head" style={{ textAlign: 'right' }}>Market cap</span>
        </div>
        <ShowMore items={ranked} ends initial={8} noun="stocks" render={(s, idx) => (
          <Link key={s.symbol} to={stockPath(s.symbol)} className="sector-row"
            style={{ display: 'grid', gridTemplateColumns: STOCK_COLS, gap: 14, alignItems: 'center', padding: '9px 10px', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' }}>
            <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{s.name}</span>
              <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{s.symbol}</span>
              {/* The ranking, on the rows it is about. */}
              {ranked.length > 3 && idx === 0 && <span className="text-xs" style={{ color: 'var(--color-success)', flexShrink: 0 }}>best</span>}
              {ranked.length > 3 && idx === ranked.length - 1 && s.ret != null && <span className="text-xs" style={{ color: 'var(--color-danger)', flexShrink: 0 }}>worst</span>}
            </span>
            <DivergingBar value={s.rel} max={max} />
            <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(s.rel) }}>{pp(s.rel)}</span>
            <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(s.ret) }}>{formatPct(s.ret, 1)}</span>
            <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>₹{formatLevel(s.last)}</span>
            <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{capLabel(s.cap)}</span>
          </Link>
        )} />
      </div>
    </div>
  );
}

const MOVERS = 3;

export default function SectorMap({ refreshKey = 0 }) {
  const navigate = useNavigate();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(false);
  const [win, setWin]     = useState('1m');
  const [focus, setFocus] = useState(null);   // sector key, or null for the whole market
  const w = windowOf(win);

  // Re-fetched (fresh) when the page's refresh button bumps `refreshKey`; the map that
  // is showing stays until the new one arrives.
  useEffect(() => {
    marketsAPI.sectors(refreshKey > 0)
      .then(r => { setData(r.data); setError(false); })
      .catch(() => setData(prev => { if (!prev) setError(true); return prev; }));
  }, [refreshKey]);

  // Everything for the current window, at both levels, from the one payload.
  const { sectorItems, stockItems, focused } = useMemo(() => {
    if (!data?.sectors?.length) return { sectorItems: [], stockItems: [], focused: null };
    const f = w.field;
    const bySector = {};
    for (const s of data.stocks) (bySector[s.sector] ??= []).push(s);

    const sectorItems = data.sectors.map(sec => {
      const members = (bySector[sec.key] || []).filter(s => s[f] != null).sort((a, b) => b[f] - a[f]);
      const base = data.market?.[f];
      return {
        ...sec, id: sec.key, tag: sec.label, ret: sec[f],
        rel: sec[f] != null && base != null ? sec[f] - base : null,
        best:  members.slice(0, MOVERS),
        // Worst first, and never overlapping the leaders in a sector of five or fewer.
        worst: members.slice(Math.max(MOVERS, members.length - MOVERS)).reverse(),
      };
    });

    const focused = focus ? sectorItems.find(s => s.id === focus) : null;
    // `title`, not `name`: Recharts overwrites every node's `name` with its `nameKey`
    // (the ticker drawn in the box), which put "EXIDEIND · EXIDEIND" in the tooltip.
    // Largest first, so the squarified layout opens on the companies that move the sector.
    const stockItems = focused ? (bySector[focus] || []).map(s => ({
      ...s, id: s.symbol, tag: s.symbol, title: s.name, ret: s[f],
      rel: s[f] != null && focused.ret != null ? s[f] - focused.ret : null,
    })).sort((a, b) => (b.weight || 0) - (a.weight || 0)) : [];

    return { sectorItems, stockItems, focused };
  }, [data, focus, w.field]);

  const level = focused ? 'stock' : 'sector';
  const mapItems = focused ? stockItems : sectorItems;

  const header = focused ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button onClick={() => setFocus(null)} className="text-sm"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-accent)' }}>
        All sectors
      </button>
      <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
      <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{focused.label}</span>
      <span className="figure text-sm" style={{ color: pnlColor(focused.ret), marginLeft: 6 }}>{formatPct(focused.ret, 1)}</span>
      <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {' '}{w.long} · {focused.count} stocks · {pp(focused.rel)} against the Nifty 500
      </span>
    </span>
  ) : (
    `${sectorItems.length} sectors of the Nifty 500, sized by market cap and coloured by the move ${w.long}`
      + (data?.market?.[w.field] != null ? ` · the 500 together ${formatPct(data.market[w.field], 1)}` : '')
  );

  return (
    <Card>
      <SectionHeader
        eyebrow="Sector rotation"
        size="sm"
        sub={header}
        style={{ marginBottom: 20 }}
        action={<SegmentedControl options={WINDOWS} value={win} onChange={setWin} ariaLabel="Window" />}
      />

      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', padding: '80px 0', textAlign: 'center' }}>
          Sector data is unavailable right now.
        </p>
      ) : !data ? <Spinner height={420} /> : !sectorItems.length ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)', padding: '80px 0', textAlign: 'center' }}>
          The Nifty 500 could not be loaded from NSE right now.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={focused ? 400 : 440}>
            {/* Keyed by level, so drilling in draws a fresh layout instead of morphing
                twenty-six sector boxes into a sector's stocks. */}
            <Treemap key={focus || 'all'} data={mapItems} dataKey="weight" nameKey="tag" aspectRatio={16 / 9}
              isAnimationActive={false}
              content={<Box scale={CAP[level][win]} onPick={focused ? (sym) => navigate(stockPath(sym)) : setFocus} />}>
              <Tooltip content={<MapTip w={w} level={level} />} isAnimationActive={false} />
            </Treemap>
          </ResponsiveContainer>

          <div style={{ height: 24 }} />
          {focused
            ? <StockTable items={stockItems} />
            : <SectorTable items={sectorItems} field={w.field} onPick={setFocus} />}

          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 16 }}>
            {focused ? 'Click a stock for its full company page, or "All sectors" to go back. ' : 'Click a sector to see its stocks, or a stock name to open its company page. '}
            Read from price, not order flow. Sectors are NSE&apos;s industry classification of the Nifty 500, with banks,
            capital markets, insurance, defence and travel split out using NSE&apos;s own sub-indices; each return is cap-weighted.
            {data.sized === 'equal' && ' Market caps are unavailable right now, so boxes are drawn equal in size.'}
          </p>
        </>
      )}
    </Card>
  );
}
