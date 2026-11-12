import { useCallback } from 'react';
import { marketAPI } from '../../lib/api';
import { formatPct } from '../../lib/utils';
import { usdBn, usdSize, ordinal, WORLD_BENCHMARKS } from '../../lib/economy';
import { formatLevel, axisFormatFor, toChartSeries } from '../../lib/markets';
import SectionHeader from '../ui/SectionHeader';
import Masthead, { MastheadFigure } from '../ui/Masthead';
import Button from '../ui/Button';
import PriceGrapher from '../charts/PriceGrapher';
import PeerCompare from './PeerCompare';
import Flag, { CountryHeading } from './Flag';

const Sub = ({ children }) => <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{children}</span>;
const fmtUsd = (v) => formatLevel(v, 'USD');

/**
 * Any economy but India, from what the IMF and World Bank publish for every country: its headline figures,
 * how it compares with India and the peers over time, and its stock market in dollars.
 */
export default function CountryProfile({ country, world, onBack }) {
  const s = country.standing;
  const yr = world.thisYear;
  const fetchFund = useCallback((days, growth, opts) => marketAPI.ohlc(s.etf, days, opts?.pad).then(r => toChartSeries(r.data?.candles, growth)),
    [s.etf]);
  const indGrowth = world.imf?.growth?.IND?.find(p => p.year === yr)?.value;
  const wldGrowth = world.imf?.growth?.WLD?.find(p => p.year === yr)?.value;

  return (
    <>
      <CountryHeading iso={country.iso} name={country.name}
        sub="What the IMF and World Bank publish for every economy: its size and growth, prices, the money crossing its border, and its stock market"
        action={<Button variant="secondary" size="sm" onClick={onBack}><Flag iso="IND" height={12} style={{ marginRight: 8 }} />Back to India</Button>} />
      <Masthead
        lead={
          <>
            <p className="eyebrow" style={{ marginBottom: 12 }}>{country.name} · real GDP growth, {yr}</p>
            <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
              {s.growth != null ? formatPct(s.growth, 1).replace('+', '') : '—'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
              The IMF’s estimate{wldGrowth != null && <> · the world {wldGrowth.toFixed(1)}%</>}{indGrowth != null && <>, India {indGrowth.toFixed(1)}%</>}
            </p>
          </>
        }
        band={
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 20 }}>
            {s.gdpUsd != null && <MastheadFigure label="Size" value={usdSize(s.gdpUsd)} sub={<Sub>{ordinal(s.sizeRank)} of {s.sizeOf}, {yr}</Sub>} />}
            {s.pppShare != null && <MastheadFigure label="Share of world output" value={`${s.pppShare.toFixed(s.pppShare < 1 ? 2 : 1)}%`} sub={<Sub>at purchasing power</Sub>} />}
            {s.growthShare != null && <MastheadFigure label="Share of world growth" value={`${s.growthShare.toFixed(Math.abs(s.growthShare) < 1 ? 1 : 0)}%`}
              sub={<Sub>{s.growthOrder === 1 ? 'the largest source' : `${ordinal(s.growthOrder)} largest source`}</Sub>} />}
            {s.perCapita != null && <MastheadFigure label="Income per head" value={`$${Math.round(s.perCapita).toLocaleString('en-US')}`} sub={<Sub>GDP per person</Sub>} />}
            {s.inflation != null && <MastheadFigure label="Inflation" value={`${s.inflation.toFixed(1)}%`} sub={<Sub>consumer prices, {yr}</Sub>} />}
            {s.ca != null && <MastheadFigure label="Current account" value={formatPct(s.ca, 1)}
              sub={<Sub>of GDP; {s.ca < 0 ? 'filled by foreign capital' : 'sent abroad as capital'}</Sub>} />}
            {s.debt != null && <MastheadFigure label="Government debt" value={`${Math.round(s.debt)}%`} sub={<Sub>of GDP</Sub>} />}
            {s.fdiUsd != null && <MastheadFigure label="FDI received" value={usdBn(s.fdiUsd, { signed: s.fdiUsd < 0 })} sub={<Sub>net, {s.fdiUsdYear}</Sub>} />}
            {s.exportsUsd != null && <MastheadFigure label="Exports" value={usdBn(s.exportsUsd, { digits: 0 })} sub={<Sub>goods & services, {s.exportsUsdYear}</Sub>} />}
            {s.remitUsd != null && s.remitUsd >= 1 && <MastheadFigure label="Remittances" value={usdBn(s.remitUsd)} sub={<Sub>received, {s.remitUsdYear}</Sub>} />}
          </div>
        }
      />

      <SectionHeader title={`${country.name} in the world`} style={{ marginTop: 16 }}
        sub="One measure at a time, against India, the economies global capital chooses between, and the world" />
      <PeerCompare world={world} focus={country.iso} focusName={country.name} />

      {s.etf && (
        <>
          <SectionHeader title={`${country.name}’s market, in dollars`} style={{ marginTop: 16 }}
            sub={`What its shares have paid a dollar investor, through the US-listed fund that tracks them (${s.etf}), against the world’s markets and India’s`} />
          <PriceGrapher key={s.etf} symbol={s.etf} title={`${country.name} in dollars`} valueLabel={s.etf} formatValue={fmtUsd} axisFormat={axisFormatFor('USD')}
            fetchData={fetchFund} growthCapable defaultView="growth" defaultRange="5Y" defaultCompare={['ACWI', 'INDA']} benchmarks={WORLD_BENCHMARKS}
            viewLabels={{ complete: 'Price', growth: 'vs the world', hint: 'Indexed to 100 at the start of the range, against other markets in dollars' }}
            emptyText={`No price history for ${s.etf}`} />
        </>
      )}

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        India is followed through its own statistics, release by release; every other economy through what the IMF and World Bank publish for all countries:
        the IMF World Economic Outlook for growth, size, inflation, the current account and debt ({yr} onward are projections), the World Bank for investment,
        saving, FDI, exports and remittances, each at its latest year. Markets from Yahoo Finance.
      </p>
    </>
  );
}
