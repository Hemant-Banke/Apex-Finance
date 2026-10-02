import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { marketsAPI, marketAPI, dashboardAPI } from '../lib/api';
import { formatPct, pnlColor, formatCrore, dayLabel, fiscalQuarter, fiscalYear, formatCount } from '../lib/utils';
import { formatLevel, rupeeLevel, stockPath, MARKET_RANGES, toChartSeries } from '../lib/markets';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import Delta from '../components/ui/Delta';
import BackLink from '../components/ui/BackLink';
import ShowMore from '../components/ui/ShowMore';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import PriceGrapher from '../components/charts/PriceGrapher';
import Ownership from '../components/stock/Ownership';
import CompanyFinancials from '../components/stock/CompanyFinancials';
import { StatGrid, RangeBar, Performance } from '../components/stock/PricePerformance';
import PositionCard from '../components/portfolio/PositionCard';

/**
 * One company, in full: the share, the business, and how both compare.
 *
 * Read top to bottom it answers, in order: what is it worth and how did it move today
 * (masthead), how has the SHARE done against the market (chart, returns, risk), how has
 * the BUSINESS done (revenue, profit, margins), what does the market pay for that and
 * can the company carry it (valuation, health), what do analysts expect, who owns it,
 * and how it stands among its sector peers. The profile closes the page rather than
 * opening it — anyone who reached a company page knows roughly what the company does.
 *
 * Every figure that has a natural yardstick is printed AGAINST it — a return against the
 * Nifty, a P/E against the sector's median — because a number alone ("P/E 25") cannot be
 * judged, and a judgement is what the page is for.
 */

/** Every money figure on this page arrives in ₹ crore (see stockService). */
const fmtCr = (v) => (v == null ? '—' : formatCrore(v));

// ── Valuation & health ──────────────────────────────────────────────────────────

function Valuation({ v, h }) {
  /** "29% below its sector's median" — the only way a P/E can be judged. */
  const vsMedian = (x, m) => (x != null && m ? (x / m - 1) * 100 : null);
  const relNote = (gap, m, what) => (gap == null ? null
    : `${Math.abs(gap).toFixed(0)}% ${gap < 0 ? 'below' : 'above'} the sector median of ${m.toFixed(1)} — ${gap < 0 ? 'cheaper' : 'dearer'} ${what}`);
  const de = h?.debtToEquity;
  // The filings' dates, so "latest quarter" and "last balance sheet" say WHICH.
  const q = fiscalQuarter(h?.latestQuarter)?.fq;
  const fy = h?.balanceSheetDate ? fiscalYear(h.balanceSheetDate) : null;

  return (
    <Card>
      <SectionHeader eyebrow="Valuation & health" size="sm" sub="What the market pays for the business, and whether the business can carry it" style={{ marginBottom: 6 }} />
      <StatGrid initial={8} stats={[
        { label: 'P/E (trailing)', value: v.pe?.toFixed(1), note: relNote(vsMedian(v.pe, v.sectorMedianPe), v.sectorMedianPe, 'per rupee of profit') },
        // Forward P/E below trailing means the forward EPS estimate is ABOVE the
        // trailing one (same price, smaller multiple).
        { label: 'P/E (forward)', value: v.forwardPe?.toFixed(1),
          note: v.forwardPe && v.pe ? (v.forwardPe < v.pe ? 'Analysts expect earnings to rise' : 'Analysts expect earnings to fall') : null },
        { label: 'Price to book', value: v.pb?.toFixed(2), note: relNote(vsMedian(v.pb, v.sectorMedianPb), v.sectorMedianPb, 'per rupee of net assets') },
        { label: 'Return on equity', value: h?.roe != null ? `${h.roe.toFixed(1)}%` : null, note: fy ? `${fy}, on average equity` : null },
        { label: 'Operating margin', value: h?.operatingMargin != null ? `${h.operatingMargin.toFixed(1)}%` : null,
          note: h?.netMargin != null ? `Net margin ${h.netMargin.toFixed(1)}% · last four quarters` : null },
        { label: 'Debt to equity', value: de != null ? de.toFixed(2) : null,
          note: de == null ? null : `${de < 0.5 ? 'Lightly' : de < 1.5 ? 'Moderately' : 'Heavily'} borrowed · ${fy}` },
        { label: 'Revenue growth', value: h?.revenueGrowth != null ? formatPct(h.revenueGrowth, 1) : null, tone: pnlColor(h?.revenueGrowth), note: q ? `${q}, year on year` : null },
        { label: 'Profit growth', value: h?.profitGrowth != null ? formatPct(h.profitGrowth, 1) : null, tone: pnlColor(h?.profitGrowth), note: q ? `${q}, year on year` : null },
        { label: 'Dividend yield', value: v.dividendYield != null ? `${v.dividendYield.toFixed(2)}%` : null,
          note: v.payoutRatio != null ? `Pays out ${v.payoutRatio.toFixed(0)}% of profit` : null },
        { label: 'EV / EBITDA', value: v.evEbitda?.toFixed(1), note: v.ev ? `Enterprise value ${fmtCr(v.ev)}` : null },
        { label: 'EPS (trailing)', value: v.eps != null ? `₹${v.eps.toFixed(1)}` : null, note: v.bookValue ? `Book value ₹${formatLevel(v.bookValue)} a share` : null },
        { label: 'Cash · borrowings', value: h?.cash != null && h?.debt != null ? `${fmtCr(h.cash)} · ${fmtCr(h.debt)}` : null,
          note: h?.cash != null && h?.debt != null ? (h.cash >= h.debt ? 'Holds more cash than it owes' : 'Owes more than it holds in cash') : null },
      ]} />
    </Card>
  );
}

// ── Analysts, earnings, ownership ───────────────────────────────────────────────

const RATINGS = [
  ['strongBuy', 'Strong buy', 'var(--color-success)', 1],
  ['buy', 'Buy', 'var(--color-success)', 0.6],
  ['hold', 'Hold', 'var(--color-text-muted)', 0.7],
  ['sell', 'Sell', 'var(--color-danger)', 0.6],
  ['strongSell', 'Strong sell', 'var(--color-danger)', 1],
];

/** "2026-06-30" → "Apr–Jun 2026 · Q1 FY27" (see `fiscalQuarter`). */
function quarterName(iso) {
  const q = fiscalQuarter(iso);
  return q && <>{q.months} <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>· {q.fq}</span></>;
}

function Analysts({ a, price, earnings }) {
  const total = a?.trend ? RATINGS.reduce((s, [k]) => s + (a.trend[k] || 0), 0) : 0;
  const lo = a?.targetLow, hi = a?.targetHigh;
  // One scale for every marker — the analysts' range AND today's price — padded a little
  // either side so a marker on the edge is still visible. The old bar printed "Low",
  // "Today" and "High" evenly spaced beneath it whatever their values, so a price below
  // the lowest target sat over the word "Low".
  const lowEnd  = lo != null ? Math.min(lo, price) : 0;
  const highEnd = hi != null ? Math.max(hi, price) : 0;
  const pad = (highEnd - lowEnd) * 0.06 || 1;
  const at = (x) => ((x - (lowEnd - pad)) / (highEnd - lowEnd + 2 * pad)) * 100;
  const where = lo == null || hi == null ? null
    : price < lo ? 'below even the lowest target'
    : price > hi ? 'above even the highest target'
    : 'inside the analysts’ range';
  const surprises = earnings?.surprises || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
      {a && (
        <Card>
          <SectionHeader eyebrow="Analysts" size="sm" sub={`${a.count} analysts · consensus “${(a.key || '').replace(/_/g, ' ')}”`} style={{ marginBottom: 18 }} />
          {total > 0 && (
            <>
              <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 2 }}>
                {RATINGS.map(([k, , c, o]) => a.trend[k] ? (
                  <div key={k} title={`${a.trend[k]} ${k}`} style={{ flex: a.trend[k], background: c, opacity: o }} />
                ) : null)}
              </div>
              <div className="flex text-xs" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap', color: 'var(--color-text-muted)' }}>
                {RATINGS.map(([k, l]) => a.trend[k] ? <span key={k}>{l} <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>{a.trend[k]}</span></span> : null)}
              </div>
            </>
          )}
          {lo != null && hi != null && (
            <div style={{ marginTop: 24 }}>
              <div className="flex justify-between" style={{ alignItems: 'baseline', gap: 12 }}>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>12-month price target</p>
                <p className="figure text-sm" style={{ color: 'var(--color-text-primary)' }}>
                  ₹{formatLevel(a.targetMean)} <span style={{ color: pnlColor(a.upside), fontSize: '0.75rem' }}>{formatPct(a.upside, 1)}</span>
                </p>
              </div>

              <div style={{ position: 'relative', height: 52, marginTop: 8 }}>
                {/* Today's price, labelled ABOVE its own marker — kept inside the card
                    when the marker sits near either edge. */}
                <span className="figure text-xs" style={{
                  position: 'absolute', top: 0, whiteSpace: 'nowrap', color: 'var(--color-text-primary)',
                  left: `${at(price)}%`,
                  transform: at(price) < 15 ? 'translateX(-2px)' : at(price) > 85 ? 'translateX(calc(-100% + 2px))' : 'translateX(-50%)',
                }}>Today ₹{formatLevel(price)}</span>
                <div style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 2, borderRadius: 99, background: 'var(--color-bg-elevated)' }} />
                <div title={`Analysts' range ₹${formatLevel(lo)} – ₹${formatLevel(hi)}`} style={{
                  // Strong enough to read as a SPAN against the track — the dim accent
                  // all but vanished into it, leaving the average tick floating alone.
                  position: 'absolute', top: 28, height: 6, borderRadius: 99,
                  background: 'color-mix(in srgb, var(--color-accent) 42%, transparent)',
                  left: `${at(lo)}%`, width: `${at(hi) - at(lo)}%`,
                }} />
                <div title={`Average target ₹${formatLevel(a.targetMean)}`} style={{ position: 'absolute', top: 24, height: 14, width: 2, borderRadius: 2, left: `calc(${at(a.targetMean)}% - 1px)`, background: 'var(--color-accent-strong)' }} />
                <div title="Today" style={{ position: 'absolute', top: 18, height: 24, width: 2, borderRadius: 2, left: `calc(${at(price)}% - 1px)`, background: 'var(--color-text-primary)' }} />
              </div>

              {/* The figures as a key, not pinned under the bar — three labels at their
                  true positions overprint whenever two targets sit close together. */}
              <div className="flex text-xs" style={{ gap: 18, flexWrap: 'wrap', color: 'var(--color-text-muted)', marginTop: 4 }}>
                <span>Low <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>₹{formatLevel(lo)}</span></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 2, height: 10, background: 'var(--color-accent-strong)', borderRadius: 2 }} />
                  Average <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>₹{formatLevel(a.targetMean)}</span>
                </span>
                <span>High <span className="figure" style={{ color: 'var(--color-text-secondary)' }}>₹{formatLevel(hi)}</span></span>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)', marginTop: 10 }}>
                Today&apos;s price is {where}.
              </p>
            </div>
          )}
        </Card>
      )}

      {surprises.length > 0 && (
        <Card>
          <SectionHeader eyebrow="Earnings" size="sm"
            sub={`Earnings per share — the quarter's profit for each share, in ₹ — against what analysts expected${earnings.next ? ` · next results ${dayLabel(earnings.next, true)}` : ''}`}
            style={{ marginBottom: 14 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 76px 70px', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">Quarter</span>
            <span className="col-head" style={{ textAlign: 'right' }}>Reported</span>
            <span className="col-head" style={{ textAlign: 'right' }}>Expected</span>
            <span className="col-head" style={{ textAlign: 'right' }}>Surprise</span>
          </div>
          {[...surprises].reverse().map(e => (
            <div key={e.periodEnd} style={{ display: 'grid', gridTemplateColumns: '1fr 76px 76px 70px', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)', alignItems: 'baseline' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {quarterName(e.periodEnd) || e.periodEnd}
              </span>
              <span className="figure text-sm" style={{ textAlign: 'right', color: 'var(--color-text-primary)' }}>₹{e.actual?.toFixed(1) ?? '—'}</span>
              <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>₹{e.estimate?.toFixed(1) ?? '—'}</span>
              <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(e.surprisePct) }}>{formatPct(e.surprisePct, 1)}</span>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            Surprise is how far the reported figure beat (+) or missed (−) the analysts&apos; average estimate.
          </p>
        </Card>
      )}
    </div>
  );
}

// ── Peers ───────────────────────────────────────────────────────────────────────

const PEER_COLS = 'minmax(160px, 1.6fr) 96px 64px 64px 70px 70px';

function PeerRow({ p, self }) {
  const cells = (
    <>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="text-sm truncate" style={{ color: self ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{p.name}</span>
        <span className="figure text-xs" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{p.symbol}</span>
      </span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{fmtCr(p.cap)}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{p.pe?.toFixed(1) ?? '—'}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: 'var(--color-text-secondary)' }}>{p.pb?.toFixed(1) ?? '—'}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(p.chg1m) }}>{formatPct(p.chg1m, 1)}</span>
      <span className="figure text-xs" style={{ textAlign: 'right', color: pnlColor(p.chg1y) }}>{formatPct(p.chg1y, 1)}</span>
    </>
  );
  // Rows carry their own inline padding so a highlighted or hovered row's wash has room
  // around its text instead of running flush to the first and last figures.
  const style = { display: 'grid', gridTemplateColumns: PEER_COLS, gap: 12, padding: '10px 12px', alignItems: 'baseline', borderBottom: '1px solid var(--color-border-subtle)', textDecoration: 'none' };
  return self
    ? <div style={{ ...style, borderRadius: 8, background: 'color-mix(in srgb, var(--color-accent) 7%, transparent)' }}>{cells}</div>
    : <Link to={stockPath(p.symbol)} className="sector-row" style={style}>{cells}</Link>;
}

function Peers({ peers }) {
  if (!peers?.items?.length) return null;
  const self = peers.items.find(p => p.self);
  const others = peers.items.filter(p => !p.self);
  return (
    <Card>
      <SectionHeader eyebrow="Sector peers" size="sm"
        sub={`${peers.sector.label} · ${peers.count} Nifty 500 companies · #${peers.rank} by market cap · sector ${formatPct(peers.sector.chg1y, 1)} over a year`}
        style={{ marginBottom: 16 }} />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div style={{ display: 'grid', gridTemplateColumns: PEER_COLS, gap: 12, padding: '0 12px 9px', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <span className="col-head">Company</span>
            {['Market cap', 'P/E', 'P/B', '1M', '1Y'].map(h => <span key={h} className="col-head" style={{ textAlign: 'right' }}>{h}</span>)}
          </div>
          {/* This company is pinned on top, so it is always there to compare against —
              however far down the size ranking it sits. The rest fold. */}
          {self && <PeerRow p={self} self />}
          <ShowMore items={others} initial={6} noun="peers" render={(p) => <PeerRow key={p.symbol} p={p} />} />
        </div>
      </div>
    </Card>
  );
}

// ── About ───────────────────────────────────────────────────────────────────────

function About({ profile }) {
  const [open, setOpen] = useState(false);
  if (!profile?.description && !profile?.website) return null;
  return (
    <Card>
      <SectionHeader eyebrow="About the company" size="sm" style={{ marginBottom: 14 }} />
      {profile.description && (
        <>
          {/* Three lines until asked — a business summary runs to paragraphs. */}
          <p className="text-sm" style={{
            color: 'var(--color-text-secondary)', lineHeight: 1.65,
            ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
          }}>{profile.description}</p>
          {/* Padded so its hover wash has room around the words, and pulled left by the
              same amount so the words still line up with the paragraph above. */}
          <button type="button" className="show-more text-xs" onClick={() => setOpen(o => !o)}
            style={{ width: 'auto', padding: '6px 12px', marginLeft: -12, justifyContent: 'flex-start' }}>
            {open ? 'Show less' : 'Read more'}
          </button>
        </>
      )}
      <StatGrid initial={4} style={{ marginTop: 4 }} stats={[
        { label: 'Industry', value: profile.industry, text: true },
        { label: 'Employees', value: profile.employees != null ? formatCount(profile.employees) : null },
        { label: 'Headquarters', value: profile.city, text: true },
        { label: 'Website', text: true, value: profile.website && (
          <a href={profile.website} target="_blank" rel="noreferrer" className="stock-link" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {profile.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} <ExternalLink size={11} />
          </a>
        ) },
      ]} />
      {profile.officers?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>Leadership</p>
          {profile.officers.map(o => (
            <p key={o.name} className="text-sm" style={{ color: 'var(--color-text-secondary)', marginTop: 3 }}>
              {o.name.replace(/\s+/g, ' ')} <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>· {o.title}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Stock() {
  const { symbol } = useParams();
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [holding, setHolding] = useState(null);

  useEffect(() => {
    let live = true;
    marketsAPI.stock(symbol)
      .then(r => { if (live) { setData(r.data); setError(null); } })
      .catch(e => live && setError(e.response?.status === 404 ? 'notfound' : 'failed'));
    // Your own position, if you hold it — quietly absent if you do not, or if the
    // holdings call fails; it is a courtesy, not part of the page's answer.
    dashboardAPI.getHoldings()
      .then(r => live && setHolding((r.data || []).find(h => h.symbol?.toUpperCase() === `${symbol.toUpperCase()}.NS`) || null))
      .catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  // The price chart fetches its own candles per range (memoised on the symbol, or
  // PriceGrapher's fetch effect would re-run on every render).
  const ysym = `${symbol.toUpperCase()}.NS`;
  const fetchPrice = useCallback((days, growth) => marketAPI.ohlc(ysym, days).then(r => toChartSeries(r.data?.candles, growth)), [ysym]);
  const fetchOHLC  = useCallback((days) => marketAPI.ohlc(ysym, days).then(r => r.data?.candles || []), [ysym]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <BackLink to="/markets">Markets</BackLink>
        <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {error === 'notfound' ? `No NSE-listed company found for “${symbol}”.` : 'This company could not be loaded right now. Try again shortly.'}
        </p></Card>
      </div>
    );
  }
  if (!data || data.symbol !== symbol.toUpperCase()) return <Spinner />;

  const { quote, profile, valuation, health, performance, analysts, earnings, ownership, peers, financials } = data;
  const sameDay = quote.change != null ? quote.change : null;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <BackLink to="/markets">Markets</BackLink>

      <SectionHeader
        eyebrow={[profile.sector, profile.industry].filter(Boolean).join(' · ') || 'Company'}
        title={data.name}
        sub={`NSE: ${data.symbol}${data.asof ? ` · as of ${dayLabel(data.asof, true)}` : ''}`}
      />

      <Masthead
        lead={
          <>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Share price</p>
            <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
              ₹{formatLevel(quote.price)}
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
              {quote.dayLow != null && <>Today ₹{formatLevel(quote.dayLow)} – ₹{formatLevel(quote.dayHigh)}</>}
              {quote.volume != null && quote.avgVolume ? <> · volume {(quote.volume / quote.avgVolume).toFixed(1)}× its average</> : null}
            </p>
          </>
        }
        action={
          <div style={{ textAlign: 'right' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 5 }}>Today</p>
            <Delta value={sameDay ?? quote.changePct} pct={quote.changePct} amount={sameDay != null} size="md" />
          </div>
        }
        band={
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, alignItems: 'start' }}>
            <MastheadFigure label="Market cap" value={fmtCr(quote.marketCap)}
              sub={peers?.rank ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>#{peers.rank} of {peers.count} in {peers.sector.label}</p> : null} />
            <MastheadFigure label="P/E" value={valuation.pe?.toFixed(1) ?? '—'}
              sub={valuation.sectorMedianPe ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Sector median {valuation.sectorMedianPe.toFixed(1)}</p> : null} />
            <MastheadFigure label="Dividend yield" value={valuation.dividendYield != null ? `${valuation.dividendYield.toFixed(2)}%` : '—'} />
            <div style={{ minWidth: 0 }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>52-week range</p>
              <RangeBar low={performance.yearLow} high={performance.yearHigh} value={quote.price} />
            </div>
          </div>
        }
      />

      {holding && quote.price != null && (
        <PositionCard unitLabel="Shares"
          positions={[{ qty: holding.qty, invested: holding.totalInvested, value: holding.qty * quote.price }]} />
      )}

      {/* The app's one price chart: price or candles, and its growth view against the
          Nifty 50 (already overlaid) or any other benchmark via "+". */}
      <PriceGrapher key={data.symbol} title="Share price" valueLabel="Close" formatValue={rupeeLevel}
        fetchData={fetchPrice} fetchOHLC={fetchOHLC} ranges={MARKET_RANGES} defaultRange="1Y"
        growthCapable viewLabels={{ complete: 'Price', growth: 'vs market', hint: 'Indexed to 100 at the start of the range, against the benchmarks you add' }}
        defaultCompare={['^NSEI']} emptyText="No price history for this stock" />
      {performance?.returns && <Performance perf={performance} name={data.symbol} />}
      <CompanyFinancials financials={financials} />
      <Valuation v={valuation} h={health} />
      {(analysts || earnings?.surprises?.length > 0) && <Analysts a={analysts} price={quote.price} earnings={earnings} />}
      <Ownership ownership={ownership} />
      <Peers peers={peers} />
      <About profile={profile} />

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Prices, company data and analyst estimates from Yahoo Finance; sector and peers from NSE&apos;s Nifty 500 classification.
        Returns, volatility, beta and drawdowns are computed from daily closes. Not investment advice.
      </p>
    </div>
  );
}
