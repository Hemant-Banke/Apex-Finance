import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import { marketsAPI, marketAPI } from '../lib/api';
import { formatPct, pnlColor, formatCount } from '../lib/utils';
import { assetPath, formatLevel, MARKET_RANGES, toChartSeries, viewPathFor } from '../lib/markets';
import { BENCHMARKS } from '../lib/constants';
import { useToast } from '../context/ToastContext';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import Delta from '../components/ui/Delta';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import QuoteTile from '../components/markets/QuoteTile';
import Button from '../components/ui/Button';
import PriceGrapher from '../components/charts/PriceGrapher';
import SectorMap from '../components/markets/SectorMap';
import FlowsPanel from '../components/markets/FlowsPanel';
import MarketSearch from '../components/market/MarketSearch';
import Modal from '../components/ui/Modal';

/**
 * The Indian market — not the user's money, the market's.
 *
 * Read top to bottom it answers, in order: how is the market doing (the masthead and
 * the board), how has each asset class done against the others (growth), where inside
 * equities the money is moving (sectors), and who is moving it (flows). Each section is
 * fed by its own request, so a slow or failed source costs its section and nothing else.
 */
/** The Nifty 50's closes as a chart series — the growth chart's primary line. */
// Every benchmark but the line it would be compared against. Module-level, so the
// chart's colour/label lookups are not rebuilt every render.
const NIFTY_BENCHMARKS = BENCHMARKS.filter(b => b.symbol !== '^NSEI');
const fetchNifty = (days, growth) => marketAPI.indexSeries('^NSEI', days).then(r => toChartSeries(r.data, growth));

/** Anything with a market to show — a company, an index, a metal, a coin, a fund. A
 *  self-priced asset (an FD, a flat) has none, so the search does not offer it. */
const isViewable = (s) => viewPathFor(s) != null;

export default function Markets() {
  const toast = useToast();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [flows, setFlows]       = useState(null);
  const [loading, setLoading]   = useState(true);
  // Bumped by the refresh button. Each section re-fetches on it with `fresh`, keeping
  // what is on screen until the new figures land — a refresh that blanks the page to a
  // spinner reads as "something broke".
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt]   = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const load = useCallback((fresh) => Promise.all([
    marketsAPI.overview(fresh)
      .then(r => setOverview(r.data))
      .catch(e => toast.error(e.response?.data?.message || 'Market data is unavailable right now')),
    marketsAPI.flows(60, fresh)
      .then(r => setFlows(r.data))
      .catch(() => setFlows(prev => prev || { daily: [] })),
  ]).finally(() => { setLoading(false); setUpdatedAt(new Date()); }), [toast]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(false); }, []);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey(k => k + 1);
    load(true).finally(() => setRefreshing(false));
  };

  if (loading) return <Spinner />;

  const headline = overview?.headline || [];
  const nifty    = headline.find(h => h.key === 'nifty50');
  const board    = headline.filter(h => h.key !== 'nifty50');
  const breadth  = overview?.breadth;
  const bTotal   = breadth ? (breadth.advances || 0) + (breadth.declines || 0) + (breadth.unchanged || 0) : 0;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader
        eyebrow="Markets"
        title="India"
        sub={`Indices, asset classes, sectors and where the money is going${overview?.asof ? ` · NSE as of ${overview.asof} IST` : ''}`}
        action={
          <div className="flex items-center" style={{ gap: 8 }}>
            {/* Search is the page's call to action — a gold button with its word — and
                opens the same Find-an-asset dialog the Add-asset flow uses, here offering
                indices too. Refresh stays a quiet icon beside it. */}
            <Button variant="gold" icon={Search} onClick={() => setSearchOpen(true)}
              title="Find a company, index, metal, coin or fund">
              Search
            </Button>
            <button type="button" onClick={refresh} disabled={refreshing} className="refresh-btn"
              aria-label="Refresh"
              title={refreshing ? 'Refreshing…' : updatedAt ? `Refresh · last updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}>
              <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        }
      />
      {updatedAt && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: -14, textAlign: 'right' }}>
          Updated {updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* ── Masthead: the market's one number, and how broad the move under it is ──
          The Nifty says what the fifty largest did; breadth says whether the rest of the
          market went with them — a flat Nifty over 2,700 advancers and 6,800 decliners
          is a falling market wearing a calm face. */}
      {nifty && (
        <Masthead to={nifty.symbol ? assetPath(nifty.symbol) : undefined} title="Open Nifty 50"
          lead={
            <>
              <p className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                Nifty 50 {nifty.symbol && <ArrowUpRight size={12} style={{ opacity: 0.7 }} />}
              </p>
              <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
                {formatLevel(nifty.last)}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                {nifty.pe != null && <>P/E {nifty.pe.toFixed(1)}</>}
                {nifty.yearHigh != null && <> · {formatPct((nifty.last / nifty.yearHigh - 1) * 100, 1)} from its 52-week high</>}
              </p>
            </>
          }
          action={
            <div style={{ textAlign: 'right' }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 5 }}>Today</p>
              <Delta value={nifty.chg1d} pct={nifty.chg1d} amount={false} size="md" />
            </div>
          }
          band={
            <>
              {bTotal > 0 && (
                <>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 8 }}>Breadth · every NSE-listed stock today</p>
                  <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', gap: 2, marginBottom: 16 }}
                    title={`${breadth.advances} advancing · ${breadth.unchanged} unchanged · ${breadth.declines} declining`}>
                    <div style={{ width: `${(breadth.advances / bTotal) * 100}%`, background: 'var(--color-success)' }} />
                    <div style={{ width: `${(breadth.unchanged / bTotal) * 100}%`, background: 'var(--color-text-muted)' }} />
                    <div style={{ flex: 1, background: 'var(--color-danger)' }} />
                  </div>
                </>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 20 }}>
                {breadth && <MastheadFigure label="Advancing" swatch="var(--color-success)" value={formatCount(breadth.advances)} pct={bTotal ? (breadth.advances / bTotal) * 100 : null} />}
                {breadth && <MastheadFigure label="Declining" swatch="var(--color-danger)" value={formatCount(breadth.declines)} pct={bTotal ? (breadth.declines / bTotal) * 100 : null} />}
                <MastheadFigure label="This month"
                  value={formatPct(nifty.chg1m, 1)} accent={pnlColor(nifty.chg1m)} />
                <MastheadFigure label="This year"
                  value={formatPct(nifty.chg1y, 1)} accent={pnlColor(nifty.chg1y)} />
              </div>
            </>
          }
        />
      )}

      {/* ── The board ───────────────────────────────────────────────────────── */}
      {board.length > 0 && (
        <section>
          <p className="eyebrow" style={{ marginBottom: 14 }}>Indices</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {board.map(q => <QuoteTile key={q.key} q={q} />)}
          </div>
        </section>
      )}

      {overview?.assets?.length > 0 && (
        <section>
          <p className="eyebrow" style={{ marginBottom: 14 }}>Other asset classes</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {overview.assets.map(q => <QuoteTile key={q.key} q={q} />)}
          </div>
        </section>
      )}

      {/* How each asset class has grown against the Nifty — the app's one price chart,
          opened on its growth view with gold, midcaps and silver already overlaid. "+"
          adds any of the other benchmarks. */}
      <PriceGrapher title="Nifty 50" valueLabel="Nifty 50" formatValue={formatLevel}
        fetchData={fetchNifty} ranges={MARKET_RANGES} defaultRange="1Y" refreshKey={refreshKey}
        growthCapable defaultView="growth" viewLabels={{ complete: 'Level', growth: 'Growth', hint: 'Every line indexed to 100 at the start of the range' }}
        benchmarks={NIFTY_BENCHMARKS} defaultCompare={['_METAL:gold', '^NSEMDCP50', '_METAL:silver']}
        emptyText="Index history is unavailable right now" />

      <SectorMap refreshKey={refreshKey} />

      {flows ? <FlowsPanel flows={flows} /> : <Card><Spinner height={200} /></Card>}

      {!overview && (
        <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>The market board could not be loaded. Try again shortly.</p></Card>
      )}

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Indices and participant positioning from NSE; history, gold, silver, the rupee, crude and bitcoin from Yahoo Finance;
        mutual-fund and historical FII/DII flows as reported to SEBI. Gold and silver are domestic prices, including import duty and GST.
        Flows are provisional and in ₹ crore.
      </p>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)}
        align="top" wide className="modal-fade-down"
        eyebrow="Markets" title="Find an asset"
        subtitle="Companies, indices, gold and silver, crypto, ETFs and mutual funds.">
        <MarketSearch browse filter={isViewable}
          placeholder="Search a company, index, metal, coin or fund…"
          onSelect={sec => { setSearchOpen(false); navigate(viewPathFor(sec)); }} />
      </Modal>
    </div>
  );
}
