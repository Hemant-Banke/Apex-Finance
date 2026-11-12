import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { economyAPI, marketAPI } from '../lib/api';
import { formatPct, pnlColor } from '../lib/utils';
import { usdBn, ordinal, WORLD_BENCHMARKS } from '../lib/economy';
import { formatLevel, axisFormatFor, toChartSeries } from '../lib/markets';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import PriceGrapher from '../components/charts/PriceGrapher';
import StoryGrid, { StoryLede } from '../components/economy/StoryGrid';
import WorldMap from '../components/economy/WorldMap';
import CountryProfile from '../components/economy/CountryProfile';
import { CountryHeading } from '../components/economy/Flag';
import WorldStanding from '../components/economy/WorldStanding';
import PeerCompare from '../components/economy/PeerCompare';
import Production from '../components/economy/Production';
import Spending from '../components/economy/Spending';
import CapitalRotation from '../components/economy/CapitalRotation';
import FpiFlows from '../components/economy/FpiFlows';
import BopFlow from '../components/economy/BopFlow';
import BopHistory from '../components/economy/BopHistory';
import ReservesRupee from '../components/economy/ReservesRupee';
import SavingInvestment from '../components/economy/SavingInvestment';
import FundFlows from '../components/economy/FundFlows';
import BankCredit from '../components/economy/BankCredit';
import LiquidityMoney from '../components/economy/LiquidityMoney';
import { PageBar } from '../components/layout/TopBar';

// A chart the story links to; the margin keeps it clear of the fixed top bar.
const Anchor = ({ id, children }) => <div id={`econ-${id}`} style={{ scrollMarginTop: 84, display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</div>;

const Sub = ({ children }) => <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{children}</span>;

const Section = ({ title, sub }) => <SectionHeader title={title} sub={sub} style={{ marginTop: 16 }} />;

const Loading = ({ height = 220 }) => <Card><Spinner height={height} /></Card>;

const fetchIndia = (days, growth, opts) => marketAPI.ohlc('INDA', days, opts?.pad).then(r => toChartSeries(r.data?.candles, growth));
const fmtUsd = (v) => formatLevel(v, 'USD');

/** India against the world: what it makes, the capital it draws in and sends out, and what it does with it. */
export default function Economy() {
  const [headline, setHeadline] = useState(null);
  const [external, setExternal] = useState(null);
  const [world, setWorld] = useState(null);
  const [markets, setMarkets] = useState(null);
  const [production, setProduction] = useState(null);
  const [domestic, setDomestic] = useState(null);
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [params, setParams] = useSearchParams();
  const selected = (params.get('country') || 'IND').toUpperCase();
  const [countryData, setCountryData] = useState(null);
  // The URL carries the chosen country so it survives a reload; India is the default and is left out.
  const select = useCallback((iso) => setParams(p => {
    const next = new URLSearchParams(p);
    if (iso === 'IND') next.delete('country'); else next.set('country', iso);
    return next;
  }, { replace: true }), [setParams]);

  useEffect(() => {
    Promise.all([
      economyAPI.headline().then(r => setHeadline(r.data)),
      economyAPI.world().then(r => setWorld(r.data)),
    ]).catch(() => setFailed(true)).finally(() => setLoading(false));
    economyAPI.external().then(r => setExternal(r.data)).catch(() => setExternal({}));
    economyAPI.production().then(r => setProduction(r.data)).catch(() => setProduction({}));
    economyAPI.markets().then(r => setMarkets(r.data)).catch(() => setMarkets({ markets: [] }));
    economyAPI.domestic().then(r => setDomestic(r.data)).catch(() => setDomestic({}));
    economyAPI.story().then(r => setStory(r.data)).catch(() => setStory({ findings: [] }));
  }, []);

  useEffect(() => {
    if (selected === 'IND') return;
    let live = true;
    economyAPI.country(selected).then(r => live && setCountryData(r.data)).catch(() => live && setCountryData({ iso: selected, failed: true }));
    return () => { live = false; };
  }, [selected]);
  const country = countryData?.iso === selected ? countryData : null;

  // The chosen country's full series laid over the peers', so the comparison cards can draw it.
  const focusWorld = useMemo(() => {
    if (!world || !country?.imf) return null;
    const merge = (base, add) => Object.fromEntries([...new Set([...Object.keys(base || {}), ...Object.keys(add || {})])]
      .map(m => [m, { ...(base?.[m] || {}), ...(add?.[m] || {}) }]));
    return { ...world, imf: merge(world.imf, country.imf), wb: merge(world.wb, country.wb) };
  }, [world, country]);

  if (loading) return <Spinner />;

  const h = headline || {};
  const rupeeChange = h.usdinr?.change1y != null ? (1 / (1 + h.usdinr.change1y / 100) - 1) * 100 : null;
  const yr = world?.thisYear;
  const imfAt = (m, iso) => world?.imf?.[m]?.[iso]?.find(p => p.year === yr)?.value ?? null;
  const size = world?.sizeRank?.[yr];
  const contrib = world?.contributions?.[yr];
  const indContrib = contrib?.rows.find(r => r.iso === 'IND');
  const contribOrder = contrib ? contrib.rows.findIndex(r => r.iso === 'IND') + 1 : 0;
  const lastQ = production?.quarters?.[production.quarters.length - 1];
  const worldInvest = world?.wb?.invest?.WLD?.slice(-1)[0];

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader title="Economy"
        sub="The world's economies, where capital is going and how fast each grows; then one economy in full. India by default, or pick any country on the map" />
      <PageBar />

      {world?.map && (
        <WorldMap map={world.map} markets={markets?.markets} year={world.thisYear} selected={selected} onSelect={select} />
      )}

      {selected !== 'IND' ? (
        !country ? <Loading height={300} />
          : country.failed || !focusWorld ? <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No figures for this country yet.</p></Card>
            : <CountryProfile country={country} world={focusWorld} onBack={() => select('IND')} />
      ) : (<>
      <CountryHeading iso="IND" name="India"
        sub="Followed through its own statistics, release by release: output, spending, the money crossing its border and capital at home" />

      {h.gdp && (
        <Masthead
          lead={
            <>
              <p className="eyebrow" style={{ marginBottom: 12 }}>India · real GDP growth</p>
              <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
                {formatPct(h.gdp.real, 1).replace('+', '')}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                {h.gdp.quarter.months} on a year earlier
                {imfAt('growth', 'IND') != null && imfAt('growth', 'WLD') != null && (
                  <> · the IMF expects {imfAt('growth', 'IND').toFixed(1)}% for {yr}, the world {imfAt('growth', 'WLD').toFixed(1)}%</>
                )}
              </p>
            </>
          }
          band={
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 20 }}>
              {imfAt('gdpUsd', 'IND') != null && <MastheadFigure label="Size" value={`$${(imfAt('gdpUsd', 'IND') / 1000).toFixed(2)}T`}
                sub={<Sub>{size ? `${ordinal(size.rank)} largest, ${yr}` : `IMF, ${yr}`}</Sub>} />}
              {imfAt('pppShare', 'IND') != null && <MastheadFigure label="Share of world output" value={`${imfAt('pppShare', 'IND').toFixed(1)}%`}
                sub={<Sub>at purchasing power</Sub>} />}
              {indContrib && <MastheadFigure label="Share of world growth" value={`${Math.round(indContrib.share)}%`}
                sub={<Sub>{contribOrder === 1 ? 'the largest source' : `${ordinal(contribOrder)}, after ${contrib.rows.slice(0, contribOrder - 1).map(r => r.name).join(', ')}`}</Sub>} />}
              {lastQ?.spend?.gfcf?.share != null && <MastheadFigure label="Fixed investment" value={`${lastQ.spend.gfcf.share.toFixed(1)}%`}
                sub={<Sub>of GDP{worldInvest ? `; world ${worldInvest.value.toFixed(1)}%` : ''}</Sub>} />}
              {h.currentAccount && <MastheadFigure label="Current account"
                value={h.currentAccount.pctGdp != null ? formatPct(h.currentAccount.pctGdp, 1) : usdBn(h.currentAccount.value, { signed: true })}
                sub={<Sub>{h.currentAccount.pctGdp != null ? 'of GDP, ' : ''}{h.currentAccount.quarter.short}</Sub>} />}
              {h.usdinr && <MastheadFigure label="Rupee" value={`₹${h.usdinr.value.toFixed(2)}`}
                sub={<Sub>per ${rupeeChange != null && <>, <span style={{ color: pnlColor(rupeeChange) }}>{formatPct(rupeeChange, 1)}</span> in a year</>}</Sub>} />}
            </div>
          }
        />
      )}

      <SectionHeader title="What's happening" style={{ marginTop: 8 }}
        sub="Worked out from the latest figures below; each finding links to its chart." />
      {!story ? <Loading height={160} /> : (
        <>
          <StoryLede text={story.lede} />
          <StoryGrid story={story.findings} />
        </>
      )}

      <Section title="India in the world"
        sub="How big India is and how fast it grows, against the economies global capital chooses between" />
      {world?.imf ? (
        <Anchor id="world">
          <WorldStanding world={world} />
          <PeerCompare world={world} />
        </Anchor>
      ) : <Loading />}

      <Section title="What India makes, and what it does with it"
        sub="Output by industry, and how it is spent: by households, on investment, by the government, and abroad" />
      {!production ? <Loading /> : production.quarters?.length > 0 && (
        <>
          <Anchor id="production"><Production quarters={production.quarters} /></Anchor>
          <Anchor id="spending"><Spending quarters={production.quarters} /></Anchor>
        </>
      )}

      <Section title="Where global capital is going"
        sub="What each market has paid a dollar investor, what pulls money toward the dollar, and what foreign investors are doing in India" />
      {!markets ? <Loading /> : markets.markets?.length > 0 && (
        <Anchor id="rotation">
          <CapitalRotation data={markets} gsec10y={h.gsec10y} />
        </Anchor>
      )}
      <PriceGrapher symbol="INDA" title="Indian shares in dollars" valueLabel="INDA" formatValue={fmtUsd} axisFormat={axisFormatFor('USD')}
        fetchData={fetchIndia} growthCapable defaultView="growth" defaultRange="5Y" defaultCompare={['EEM', 'ACWI']} benchmarks={WORLD_BENCHMARKS}
        viewLabels={{ complete: 'Price', growth: 'vs the world', hint: 'Indexed to 100 at the start of the range, against other countries’ markets in dollars' }}
        emptyText="No price history for India's market" />
      {external?.fpi?.length > 0 && <Anchor id="fpi"><FpiFlows fpi={external.fpi} /></Anchor>}

      <Section title="Money crossing the border"
        sub="Everything India earns and pays abroad, the foreign capital that fills the gap, and the RBI's cushion" />
      {!external ? <Loading /> : (
        <>
          {external.quarters?.length > 0 && <Anchor id="bop"><BopFlow quarters={external.quarters} /><BopHistory quarters={external.quarters} /></Anchor>}
          {external.reserves?.length > 0 && <Anchor id="reserves"><ReservesRupee reserves={external.reserves} rupee={external.rupee || []} /></Anchor>}
        </>
      )}

      <Section title="Capital at home"
        sub={`Who saves, where households put their money, what banks lend and to whom, and how much cash the system has${h.repo ? ` · repo rate ${h.repo.value.toFixed(2)}%` : ''}`} />
      {production?.saving?.length > 0 && <Anchor id="saving"><SavingInvestment saving={production.saving} /></Anchor>}
      {!domestic ? <Loading /> : (
        <>
          {domestic.funds?.length > 0 && <Anchor id="funds"><FundFlows funds={domestic.funds} /></Anchor>}
          {domestic.banks?.length > 0 && <Anchor id="banks"><BankCredit banks={domestic.banks} credit={domestic.credit || []} /></Anchor>}
          {(domestic.liquidity?.length > 0 || domestic.money?.length > 0) && <Anchor id="liquidity"><LiquidityMoney liquidity={domestic.liquidity || []} money={domestic.money || []} /></Anchor>}
        </>
      )}

      </>)}

      {failed && (
        <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Some economic data could not be loaded. Try again shortly.</p></Card>
      )}

      {selected === 'IND' && <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        World figures from the IMF World Economic Outlook (growth, inflation, current account, size, share of world output; {yr} onward are projections)
        and the World Bank (investment, saving, manufacturing, FDI). GDP, output by industry, spending and saving from MoSPI (2022-23 base);
        the balance of payments, reserves, policy rates, bank credit, liquidity and money supply from the RBI; foreign portfolio flows from NSDL;
        mutual-fund flows from AMFI; India's 10-year yield from the OECD via FRED; markets, US yields, the dollar and the rupee from Yahoo Finance.
        Each figure is as of its own release: GDP and the balance of payments arrive about a quarter late, world figures yearly.
      </p>}
    </div>
  );
}
