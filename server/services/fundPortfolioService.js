/**
 * fundPortfolioService — what a fund, ETF or foreign index actually HOLDS, in one shape.
 * Indian funds and ETFs come from Groww (keyed by AMFI code / NSE symbol), anything abroad from Yahoo topHoldings.
 */
const { round } = require('../utils/series');
const { toDateStr } = require('../utils/helpers');
const { fetchYahooAuthed } = require('./marketDataService');
const { _get } = require('./indiaMarketService');
const sectorService = require('./sectorService');
const mfService = require('./mfService');

const TTL_MS = 12 * 60 * 60 * 1000;   // portfolios are disclosed monthly
const MIN_WEIGHT = 0.01;              // drops arbitrage hedges booked at ~0%
const GROWW = 'https://groww.in';

// A foreign index has no published composition; the ETF that tracks it does.
const INDEX_PROXY = {
  '^GSPC': { symbol: 'SPY', label: 'SPDR S&P 500 ETF' },
  '^NDX':  { symbol: 'QQQ', label: 'Invesco QQQ' },
  '^IXIC': { symbol: 'ONEQ', label: 'Fidelity Nasdaq Composite ETF' },
  '^DJI':  { symbol: 'DIA', label: 'SPDR Dow Jones ETF' },
  '^RUT':  { symbol: 'IWM', label: 'iShares Russell 2000 ETF' },
};

// An overseas ETF's benchmark, read off its name, to the US ETF that publishes the same basket.
const BENCHMARK_PROXY = [
  [/nasdaq\s*-?\s*100/i, { symbol: 'QQQ', label: 'Invesco QQQ (Nasdaq-100)' }],
  [/s\s*&\s*p\s*500/i,  { symbol: 'SPY', label: 'SPDR S&P 500 ETF' }],
];

const NATURE = { EQUITY: 'Equity', DEBT: 'Debt', CASH: 'Cash & equivalents', REALEST: 'Real estate', MF: 'Fund units', GOLD: 'Gold', COMMODITY: 'Commodities' };

const YAHOO_SECTORS = {
  realestate: 'Real estate', consumer_cyclical: 'Consumer cyclical', basic_materials: 'Basic materials',
  consumer_defensive: 'Consumer defensive', technology: 'Technology', communication_services: 'Communication',
  financial_services: 'Financial services', utilities: 'Utilities', industrials: 'Industrials', energy: 'Energy', healthcare: 'Healthcare',
};

const _memo = new Map();

/** Group rows by a key into weight-sorted `{ name, weight }`. */
function _sum(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (k) m.set(k, (m.get(k) || 0) + r.weight);
  }
  return [...m].map(([name, weight]) => ({ name, weight: round(weight, 2) })).sort((a, b) => b.weight - a.weight);
}

/** Sector weights as shares of the equity alone, so they always add to 100. */
function _toHundred(sectors) {
  const total = sectors.reduce((a, x) => a + (x.weight > 0 ? x.weight : 0), 0);
  return total > 0 ? sectors.filter(x => x.weight > 0).map(x => ({ ...x, weight: round((x.weight / total) * 100, 2) })) : [];
}

function _shape({ source, asof, via = null, holdings, sectors, mix, facts, count }) {
  const kept = holdings.filter(h => h.weight >= MIN_WEIGHT).sort((a, b) => b.weight - a.weight);
  return {
    source, asof, via,
    count: count === undefined ? kept.length : count,
    top10: round(kept.slice(0, 10).reduce((a, h) => a + h.weight, 0), 1),
    holdings: kept.map(h => ({ ...h, weight: round(h.weight, 2) })),
    sectors: _toHundred(sectors ?? _sum(kept, h => h.sector)),
    mix: mix ?? null,
    facts,
  };
}

async function _growwSearch(query) {
  const j = await _get(`${GROWW}/v1/api/search/v3/query/global/st_query?page=0&size=6&web=true&query=${encodeURIComponent(query)}`);
  return j?.data?.content || [];
}

const _growwScheme = (id) => _get(`${GROWW}/v1/api/data/mf/web/v4/scheme/search/${encodeURIComponent(id)}`, { timeoutMs: 12000 });

// "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" → "Parag Parikh Flexi Cap Fund"
const _fundName = (name) => String(name || '')
  .replace(/\b(direct|regular)\b.*$/i, '').replace(/\b(growth|idcw|dividend|bonus)\b.*$/i, '')
  .replace(/[-–(]+\s*$/, '').trim();

/** The Groww scheme whose AMFI code is this one — direct or regular plan of the same fund. */
async function _findGrowwScheme(code, name) {
  const hits = (await _growwSearch(_fundName(name))).filter(c => c.entity_type === 'Scheme').slice(0, 3);
  for (const hit of hits) {
    const d = await _growwScheme(hit.search_id);
    if (!d) continue;
    if (String(d.scheme_code) === code || String(d.direct_scheme_code) === code) return d;
    if (d.regular_search_id) {
      const r = await _growwScheme(d.regular_search_id);
      if (r && String(r.scheme_code) === code) return r;
    }
  }
  return null;
}

async function _amfiPortfolio(symbol) {
  const code = mfService.schemeCodeOf(symbol);
  const scheme = (await mfService.getSchemes([code]))[code];
  const d = await _findGrowwScheme(code, scheme?.name);
  if (!d?.holdings?.length) return null;

  const rows = await Promise.all(d.holdings.map(async (h) => {
    const indian = h.nature_name === 'EQUITY' && h.instrument_name === 'Equity';
    return {
      name: h.company_name,
      symbol: indian ? await sectorService.matchUniverseName(h.company_name) : null,
      weight: Number(h.corpus_per) || 0,
      sector: h.nature_name === 'EQUITY' ? h.sector_name : (h.instrument_name || null),
      kind: NATURE[h.nature_name] || h.nature_name,
      instrument: h.instrument_name,
    };
  }));
  const equity = rows.filter(r => r.kind === 'Equity' && r.weight >= MIN_WEIGHT);
  const managers = String(d.fund_manager || '').split(/,\s*/).filter(Boolean);
  return _shape({
    source: 'Groww',
    asof: d.holdings[0]?.portfolio_date ? toDateStr(d.holdings[0].portfolio_date) : null,
    holdings: rows,
    sectors: _sum(equity.length ? equity : rows.filter(r => r.weight >= MIN_WEIGHT), r => r.sector),
    mix: _sum(rows.filter(r => r.weight >= MIN_WEIGHT), r => r.kind),
    facts: {
      aumCr: d.aum != null ? round(d.aum, 0) : null,
      expenseRatio: d.expense_ratio != null ? Number(d.expense_ratio) : null,
      turnover: d.portfolio_turnover ?? null,
      benchmark: d.benchmark_name || null,
      managers,
      launched: d.launch_date || null,
      exitLoad: d.exit_load || null,
    },
  });
}

async function _growwEtf(symbol) {
  const nse = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  const hit = (await _growwSearch(nse)).find(c => c.entity_type === 'ETF' && String(c.nse_scrip_code).toUpperCase() === nse);
  if (!hit) return null;
  const html = await _get(`${GROWW}/etfs/${encodeURIComponent(hit.search_id)}`, { as: 'text', timeoutMs: 12000 });
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return null;
  let pp;
  try { pp = JSON.parse(m[1])?.props?.pageProps; } catch { return null; }
  const held = pp?.etfHoldingsData?.holdings || [];
  const heads = pp?.companyHeadersByIsin || {};
  const sectors = (pp?.sectorsData?.etfSectorSummary?.sectors || [])
    .map(s => ({ name: s.sectorName, weight: round(s.sectorSharePercentage, 2) }));
  const info = pp?.etfInfoData || {};
  const f = pp?.fundamentalsData || {};
  const facts = {
    aumCr: f.aumInCrores != null ? round(f.aumInCrores, 0) : null,
    expenseRatio: f.expenseRatio ?? null,
    trackingError: f.trackingError ?? null,
    pe: f.peRatio ?? null,
    pb: f.pbRatio ?? null,
    benchmark: info.benchmarkIndex || null,
    managers: info.fundManagers || [],
    launched: info.foundationDate || null,
  };

  if (!held.length && !sectors.length) {
    // No line-by-line holdings (gold, overseas): borrow a foreign index's basket, else facts alone.
    const proxy = BENCHMARK_PROXY.find(([re]) => re.test(`${info.benchmarkIndex || ''} ${info.description || ''}`))?.[1];
    const basket = proxy ? await _yahooPortfolio(proxy.symbol, proxy).catch(() => null) : null;
    if (basket) return { ...basket, facts };
    return info.isin ? _shape({ source: 'Groww', asof: null, holdings: [], count: null, facts }) : null;
  }

  return _shape({
    source: 'Groww',
    asof: null,
    count: info.totalUnderlyingStocks || undefined,
    holdings: held.map(h => ({
      name: heads[h.isin]?.displayName || h.isin,
      symbol: heads[h.isin]?.nseScriptCode || null,
      weight: Number(h.holdingSharePercentage) || 0,
      sector: null,
    })),
    sectors,
    facts,
  });
}

const _raw = (v) => (v && typeof v === 'object' ? v.raw : v);
// Yahoo states a fund's P/E and P/B as their inverses (earnings and book yield).
const _ratio = (v) => { const x = _raw(v); return x > 0 && x < 1 ? round(1 / x, 2) : (x ?? null); };

async function _yahooPortfolio(symbol, via = null) {
  const j = await fetchYahooAuthed(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings,fundProfile`);
  const r = j?.quoteSummary?.result?.[0];
  const th = r?.topHoldings;
  if (!th?.holdings?.length && !th?.sectorWeightings?.length) return null;

  const pct = (v) => (_raw(v) != null ? _raw(v) * 100 : null);
  const sectors = (th.sectorWeightings || []).flatMap(o => Object.entries(o))
    .map(([k, v]) => ({ name: YAHOO_SECTORS[k] || k, weight: round(pct(v), 2) }))
    .filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const mix = [
    ['Equity', th.stockPosition], ['Bonds', th.bondPosition], ['Cash', th.cashPosition],
    ['Preferred', th.preferredPosition], ['Convertible', th.convertiblePosition], ['Other', th.otherPosition],
  ].map(([name, v]) => ({ name, weight: round(pct(v), 2) })).filter(x => x.weight > 0.05);
  const eq = th.equityHoldings || {};
  const fees = r?.fundProfile?.feesExpensesInvestment || {};
  return _shape({
    source: 'Yahoo Finance',
    asof: null,
    via,
    count: null,   // Yahoo lists only the top 10
    holdings: th.holdings.map(h => ({ name: h.holdingName, symbol: null, ticker: h.symbol, weight: pct(h.holdingPercent) || 0, sector: null })),
    sectors,
    mix,
    facts: {
      expenseRatio: pct(fees.annualReportExpenseRatio) != null ? round(pct(fees.annualReportExpenseRatio), 2) : null,
      turnover: pct(fees.annualHoldingsTurnover) != null ? round(pct(fees.annualHoldingsTurnover), 0) : null,
      pe: _ratio(eq.priceToEarnings),
      pb: _ratio(eq.priceToBook),
      category: r?.fundProfile?.categoryName || null,
      family: r?.fundProfile?.family || null,
    },
  });
}

async function _load(symbol, type) {
  if (mfService.isMfSymbol(symbol)) return _amfiPortfolio(symbol);
  if (INDEX_PROXY[symbol]) return _yahooPortfolio(INDEX_PROXY[symbol].symbol, INDEX_PROXY[symbol]);
  if (type === 'etf' && /\.(NS|BO)$/i.test(symbol)) return _growwEtf(symbol);
  if (type === 'etf' || type === 'mutual_fund') return _yahooPortfolio(symbol);
  return null;
}

/** A fund/ETF/foreign index's holdings, sectors and asset mix — or null when nobody publishes them. */
async function getPortfolio(symbol, type) {
  const hit = _memo.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await _load(symbol, type).catch(() => null);
  if (data || !hit) _memo.set(symbol, { at: Date.now(), data });
  return data ?? hit?.data ?? null;
}

module.exports = { getPortfolio, INDEX_PROXY };
