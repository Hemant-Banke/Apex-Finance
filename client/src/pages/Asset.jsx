import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { marketsAPI, marketAPI, dashboardAPI } from '../lib/api';
import { formatPct, pnlColor, dayLabel, formatCurrency } from '../lib/utils';
import { formatLevel, axisFormatFor, MARKET_RANGES, toChartSeries, backTarget } from '../lib/markets';
import { BENCHMARKS } from '../lib/constants';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import Delta from '../components/ui/Delta';
import BackLink from '../components/ui/BackLink';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import PriceGrapher from '../components/charts/PriceGrapher';
import AssetIcon from '../components/market/AssetIcon';
import { RangeBar, Performance } from '../components/stock/PricePerformance';
import PositionCard from '../components/portfolio/PositionCard';
import IndexProfile from '../components/asset/IndexProfile';
import FundProfile from '../components/asset/FundProfile';
import MetalProfile from '../components/asset/MetalProfile';
import ReturnSplit from '../components/asset/ReturnSplit';
import HoldingExperience from '../components/asset/HoldingExperience';

/**
 * Any instrument that is not an NSE company — an index, gold or silver, a coin, a US
 * share, an ETF, an Indian mutual fund — read from its price alone.
 *
 * It is the price half of the company page, in the same order and drawn by the same
 * components: what it is worth and how it moved today, your own position if you hold it,
 * the chart (its growth view already against its benchmark, "+" for any other), then
 * returns over every window against that benchmark and the risk measures. Then what each
 * kind is asked about: an index's valuation and members, a fund's scheme and plans, a
 * metal's purities and rupee split, and for all of them SIP and rolling returns.
 *
 * Every price is printed in the instrument's own unit (`levelFormatter`): an index in
 * points, gold in ₹ a gram, Apple in dollars. Your position is in rupees, because that
 * is what it is worth to you.
 */

const TYPE_LABELS = {
  index: 'Index', gold: 'Precious metal', silver: 'Precious metal', crypto: 'Crypto',
  mutual_fund: 'Mutual fund', etf: 'ETF', stock: 'Stock', commodity: 'Commodity',
  currency: 'Currency', bond: 'Bond', other: 'Instrument',
};

/** A price in the instrument's own unit — points, ₹, $, or ₹ a gram. */
const levelFormatter = (currency, unit) => (v) => (v == null ? '—' : `${formatLevel(v, currency)}${unit ? `/${unit}` : ''}`);

/** The symbol as a reader would know it: our namespaces are plumbing, not names. */
const displaySymbol = (symbol) => (symbol.startsWith('AMFI:') ? `AMFI ${symbol.slice(5)}`
  : symbol.startsWith('_METAL:') ? null : symbol);

/** Yahoo serves candles; a fund's NAV and the domestic metal price are close-only series. */
const isYahoo = (symbol) => !symbol.startsWith('AMFI:') && !symbol.startsWith('_METAL:');

export default function Asset() {
  const { symbol } = useParams();
  const back = backTarget(useLocation().state);
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [positions, setPositions] = useState([]);

  useEffect(() => {
    let live = true;
    marketsAPI.asset(symbol)
      .then(r => { if (live) { setData(r.data); setError(null); } })
      .catch(e => live && setError(e.response?.status === 404 ? 'notfound' : 'failed'));
    // Your own position, if any — a courtesy, quietly absent when the call fails.
    const metal = /^_METAL:(gold|silver)$/.exec(symbol)?.[1];
    dashboardAPI.getPortfolio()
      .then(r => live && setPositions((r.data?.holdings || []).filter(h =>
        metal ? h.type === metal : h.symbol?.toUpperCase() === symbol.toUpperCase())))
      .catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  // Memoised on the symbol, or PriceGrapher's fetch effect re-runs every render.
  const fetchPrice = useCallback((days, growth) => (isYahoo(symbol)
    ? marketAPI.ohlc(symbol, days).then(r => toChartSeries(r.data?.candles, growth))
    : marketAPI.indexSeries(symbol, days).then(r => toChartSeries(r.data, growth))), [symbol]);
  const fetchOHLC = useCallback((days) => marketAPI.ohlc(symbol, days).then(r => r.data?.candles || []), [symbol]);

  // Every benchmark but itself, plus the payload's own (a fund's category index) if the catalogue lacks it.
  const bench = data?.benchmark;
  const benchmarks = useMemo(() => {
    const list = BENCHMARKS.filter(b => b.symbol !== symbol);
    return bench && !list.some(b => b.symbol === bench.symbol) ? [bench, ...list] : list;
  }, [symbol, bench]);

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <BackLink to={back.to}>{back.label}</BackLink>
        <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {error === 'notfound' ? `No price history found for “${symbol}”.` : 'This could not be loaded right now. Try again shortly.'}
        </p></Card>
      </div>
    );
  }
  if (!data || data.symbol !== symbol) return <Spinner />;

  const { quote, performance: perf, benchmark, profile, currencyLens: lens } = data;
  const fmt = levelFormatter(data.currency, data.unit);
  const typeLabel = TYPE_LABELS[data.type] || 'Instrument';
  const ticker = displaySymbol(data.symbol);
  const r1y = perf?.returns?.['1y'];

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <BackLink to={back.to}>{back.label}</BackLink>

      <SectionHeader
        eyebrow={typeLabel}
        title={data.name}
        sub={[ticker, data.sub, data.asof && `as of ${dayLabel(data.asof, true)}`].filter(Boolean).join(' · ')}
      />

      <Masthead
        lead={
          <div className="flex items-center" style={{ gap: 16 }}>
            <AssetIcon symbol={data.symbol} name={data.name} type={data.type} size={44} nudge={false} />
            <div>
              <p className="eyebrow" style={{ marginBottom: 10 }}>{data.type === 'index' ? 'Level' : data.type === 'mutual_fund' ? 'NAV' : 'Price'}</p>
              <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
                {fmt(quote.price)}
              </h1>
            </div>
          </div>
        }
        action={
          <div style={{ textAlign: 'right' }}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: 5 }}>
              {data.type === 'mutual_fund' ? 'Last NAV move' : 'Today'}
            </p>
            {/* An index's move is in points and a foreign price in its own currency, so
                the chip states only the percentage — the one figure in no unit at all. */}
            <Delta value={quote.changePct} pct={quote.changePct} amount={false} size="md" />
          </div>
        }
        band={
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, alignItems: 'start' }}>
            <MastheadFigure label="1 year" value={r1y?.stock != null ? formatPct(r1y.stock, 1) : '—'} accent={pnlColor(r1y?.stock)}
              sub={r1y?.nifty != null && benchmark ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{benchmark.label} {formatPct(r1y.nifty, 1)}</p> : null} />
            <MastheadFigure label="From 52-week high" value={perf.fromHigh != null ? formatPct(perf.fromHigh, 1) : '—'} accent={pnlColor(perf.fromHigh)} />
            <MastheadFigure label="Volatility (1Y)" value={perf.volatility != null ? `${perf.volatility.toFixed(1)}%` : '—'} />
            <div style={{ minWidth: 0 }}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>52-week range</p>
              <RangeBar low={perf.yearLow} high={perf.yearHigh} value={quote.price} fmt={fmt} />
            </div>
          </div>
        }
      />

      <PositionCard unitLabel={data.unit === 'g' ? 'Grams' : 'Units'}
        positions={positions.map(h => ({ qty: h.qty, invested: h.invested, value: h.value, pnl: h.unrealisedPnl, dayChange: h.dayChange }))} />

      <PriceGrapher key={data.symbol} title={typeLabel === 'Index' ? 'Level' : 'Price'} valueLabel={data.type === 'mutual_fund' ? 'NAV' : 'Close'}
        formatValue={fmt} axisFormat={axisFormatFor(data.currency)} fetchData={fetchPrice} fetchOHLC={isYahoo(data.symbol) ? fetchOHLC : null}
        ranges={MARKET_RANGES} defaultRange="1Y"
        growthCapable benchmarks={benchmarks} defaultCompare={benchmark ? [benchmark.symbol] : []}
        viewLabels={{ complete: data.type === 'index' ? 'Level' : 'Price', growth: 'vs market', hint: 'Indexed to 100 at the start of the range, against the benchmarks you add' }}
        emptyText="No price history for this instrument" />

      {perf?.returns && (
        <Performance perf={perf} name={data.name} fmt={fmt} benchLabel={benchmark?.label ?? null}
          sub={`Its return over each window${benchmark ? `, against the ${benchmark.label}` : ''}${data.currency && data.currency !== 'INR' ? ` · in ${data.currency}` : ''}`} />
      )}

      {profile?.kind === 'index' && <IndexProfile p={profile} name={data.name} changePct={quote.changePct} />}
      {profile?.kind === 'metal' && <MetalProfile p={profile} name={data.name} />}
      {lens && (
        <ReturnSplit split={lens.split} currency={lens.currency} assetLabel={data.name}
          sub={`What it did in ${lens.currency}, what the rupee did against the ${lens.currency}, and what that made for a rupee investor. Today it is about ${formatCurrency(lens.inrPrice)} in rupees.`} />
      )}
      <HoldingExperience exp={data.experience} name={data.name} benchmark={benchmark} currency={data.currency} />
      {profile?.kind === 'fund' && <FundProfile p={profile} benchmark={benchmark} />}
    </div>
  );
}
