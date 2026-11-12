import { useEffect, useState } from 'react';
import { economyAPI, marketsAPI } from '../lib/api';
import { formatPct, pnlColor, monthLabel } from '../lib/utils';
import { usdBn } from '../lib/economy';
import Spinner from '../components/ui/Spinner';
import Card from '../components/ui/Card';
import SectionHeader from '../components/ui/SectionHeader';
import Masthead, { MastheadFigure } from '../components/ui/Masthead';
import BopFlow from '../components/economy/BopFlow';
import BopHistory from '../components/economy/BopHistory';
import ReservesRupee from '../components/economy/ReservesRupee';
import FpiFlows from '../components/economy/FpiFlows';
import FlowsPanel from '../components/markets/FlowsPanel';
import FundFlows from '../components/economy/FundFlows';
import BankCredit from '../components/economy/BankCredit';
import LiquidityMoney from '../components/economy/LiquidityMoney';
import StoryGrid, { StoryLede } from '../components/economy/StoryGrid';
import { PageBar } from '../components/layout/TopBar';

// A chart the story links to; the margin keeps it clear of the fixed top bar.
const Anchor = ({ id, children }) => <div id={`econ-${id}`} style={{ scrollMarginTop: 84 }}>{children}</div>;

const Sub = ({ children }) => <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{children}</span>;

/** India's economy: the state of the country, then the money crossing its border and who moves it. */
export default function Economy() {
  const [headline, setHeadline] = useState(null);
  const [external, setExternal] = useState(null);
  const [flows, setFlows] = useState(null);
  const [domestic, setDomestic] = useState(null);
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([
      economyAPI.headline().then(r => setHeadline(r.data)),
      economyAPI.external().then(r => setExternal(r.data)),
    ]).catch(() => setFailed(true)).finally(() => setLoading(false));
    marketsAPI.flows(60).then(r => setFlows(r.data)).catch(() => setFlows({ daily: [] }));
    economyAPI.domestic().then(r => setDomestic(r.data)).catch(() => setDomestic({}));
    economyAPI.story().then(r => setStory(r.data)).catch(() => setStory({ findings: [] }));
  }, []);

  if (loading) return <Spinner />;

  const h = headline || {};
  const rupeeChange = h.usdinr?.change1y != null ? (1 / (1 + h.usdinr.change1y / 100) - 1) * 100 : null;

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader title="Economy" sub="How India is growing, and how money moves into, out of and around the country" />
      <PageBar />

      {h.gdp && (
        <Masthead
          lead={
            <>
              <p className="eyebrow" style={{ marginBottom: 12 }}>Real GDP growth</p>
              <h1 className="display-number" style={{ fontSize: 'clamp(1.6rem, 4vw, 2rem)', color: 'var(--color-text-primary)' }}>
                {formatPct(h.gdp.real, 1).replace('+', '')}
              </h1>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                {h.gdp.quarter.short} ({h.gdp.quarter.months}) on a year earlier
                {h.gdp.nominal != null && <> · nominal {formatPct(h.gdp.nominal, 1).replace('+', '')}</>}
              </p>
            </>
          }
          band={
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20 }}>
              {h.repo && <MastheadFigure label="Repo rate" value={`${h.repo.value.toFixed(2)}%`}
                sub={<Sub>CRR {h.repo.crr}% · SLR {h.repo.slr}%</Sub>} />}
              {h.gsec10y && <MastheadFigure label="10Y G-Sec yield" value={`${h.gsec10y.value.toFixed(2)}%`}
                sub={<Sub>{monthLabel(h.gsec10y.date)} avg{h.gsec10y.spread != null && ` · ${h.gsec10y.spread.toFixed(2)} pp over repo`}</Sub>} />}
              {h.usdinr && <MastheadFigure label="Rupee" value={`₹${h.usdinr.value.toFixed(2)} / $`}
                sub={rupeeChange != null && <Sub><span style={{ color: pnlColor(rupeeChange) }}>{formatPct(rupeeChange, 1)}</span> against the dollar in a year</Sub>} />}
              {h.reserves && <MastheadFigure label="Forex reserves" value={usdBn(h.reserves.value)}
                sub={<Sub>{h.reserves.importCover != null && `${h.reserves.importCover} months of imports`}{h.reserves.change1y != null && ` · ${usdBn(h.reserves.change1y, { signed: true })} in a year`}</Sub>} />}
              {h.currentAccount && <MastheadFigure label="Current account"
                value={h.currentAccount.pctGdp != null ? `${formatPct(h.currentAccount.pctGdp, 1)} of GDP` : usdBn(h.currentAccount.value, { signed: true })}
                sub={<Sub>{usdBn(h.currentAccount.value, { signed: true })} · {h.currentAccount.quarter.short}</Sub>} />}
            </div>
          }
        />
      )}

      <SectionHeader title="What's happening" style={{ marginTop: 8 }}
        sub="Worked out from the latest figures below; each finding links to its chart." />
      {!story ? <Card><Spinner height={160} /></Card> : (
        <>
          <StoryLede text={story.lede} />
          <StoryGrid story={story.findings} />
        </>
      )}

      <SectionHeader title="Money crossing the border" style={{ marginTop: 16 }}
        sub="What India earns, spends and borrows abroad, how the RBI cushions it, and what foreign investors are doing" />
      {external?.quarters?.length > 0 && <Anchor id="bop"><BopFlow quarters={external.quarters} /></Anchor>}
      {external?.quarters?.length > 0 && <BopHistory quarters={external.quarters} />}
      {external?.reserves?.length > 0 && <Anchor id="reserves"><ReservesRupee reserves={external.reserves} rupee={external.rupee || []} /></Anchor>}
      {external?.fpi?.length > 0 && <Anchor id="fpi"><FpiFlows fpi={external.fpi} /></Anchor>}

      {flows ? <FlowsPanel flows={flows} /> : <Card><Spinner height={200} /></Card>}

      <SectionHeader title="Money inside the country" style={{ marginTop: 16 }}
        sub="What households save, what banks lend and to whom, and how much cash the system has" />
      {!domestic ? <Card><Spinner height={200} /></Card> : (
        <>
          {domestic.funds?.length > 0 && <Anchor id="funds"><FundFlows funds={domestic.funds} /></Anchor>}
          {domestic.banks?.length > 0 && <Anchor id="banks"><BankCredit banks={domestic.banks} credit={domestic.credit || []} /></Anchor>}
          {(domestic.liquidity?.length > 0 || domestic.money?.length > 0) && <Anchor id="liquidity"><LiquidityMoney liquidity={domestic.liquidity || []} money={domestic.money || []} /></Anchor>}
        </>
      )}

      {failed && (
        <Card><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Some economic data could not be loaded. Try again shortly.</p></Card>
      )}

      <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        GDP from MoSPI (2022-23 base); the balance of payments, forex reserves, policy rates, bank credit, liquidity and money supply
        from the RBI; foreign portfolio flows from NSDL; mutual-fund flows from AMFI; the 10-year yield from the OECD via FRED; the rupee from Yahoo Finance. Each figure is as of its own release:
        GDP and the balance of payments arrive about a quarter late, reserves a week late.
      </p>
    </div>
  );
}
