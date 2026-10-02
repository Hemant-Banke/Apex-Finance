/**
 * stockService — one Indian listed company, in full, for its page.
 *
 * Four kinds of fact, each from the source that has it:
 *
 *  - **The share** — five years of daily closes for it and the Nifty 50 (Yahoo chart),
 *    from which every PERFORMANCE and RISK figure is computed here rather than read off a
 *    feed: window returns (`utils/series.windowReturns`, the same definition the market
 *    board uses), volatility, beta, drawdowns, moving averages, the 52-week range.
 *  - **The business** — the company's own filings via Screener (`screenerService`):
 *    quarterly results, annual P&L, balance sheet and cash flows, and the quarterly
 *    shareholding pattern. Every ratio derived from them — growth, margins, coverage,
 *    debt-to-equity, return on equity — is computed HERE, once, from those filings, so
 *    the page shows numbers it did not have to calculate and cannot calculate differently.
 *  - **The market's view** — valuation multiples, analyst targets and ratings, and
 *    earnings-per-share surprises (Yahoo `quoteSummary`, crumb-gated).
 *  - **Its peers** — from `sectorService`, so the company page and the sector map agree
 *    on who is in which sector and how they did.
 *
 * ALL money in the response is ₹ CRORE (the unit Indian results are filed in), per-share
 * figures are ₹, ratios are plain numbers, percentages are percent. Every block is
 * optional: the page draws what came back.
 *
 * A company listed ABROAD (`global: true`, a Yahoo symbol such as AAPL or 7203.T) gets the
 * same page from Yahoo alone: statements from its fundamentals timeseries, holders from
 * `quoteSummary`, peers from Yahoo's "often compared" list, measured against its home
 * index. Its money is in native units of its own currency (`money` says which).
 */

const { DAY_MS } = require('../utils/constants');
const { toDateStr } = require('../utils/helpers');
const { notFound } = require('../utils/httpError');
const { round, pctChange, toSorted, windowReturns, holdingExperience } = require('../utils/series');
const { fetchChart, closesByDay, fetchYahooAuthed } = require('./marketDataService');
const sectorService = require('./sectorService');
const screenerService = require('./screenerService');

const TTL_MS = 15 * 60 * 1000;
const _memo = new Map();   // symbol → { at, data }

const raw = (o) => (o && typeof o === 'object' ? (o.raw ?? null) : (o ?? null));
const fraction = (x) => (x == null ? null : x * 100);            // Yahoo ratios are fractions
const crore = (rupees) => (rupees == null ? null : round(rupees / 1e7, 0));

// ── Risk ───────────────────────────────────────────────────────────────────────

/** Largest peak-to-trough fall in a sorted series, with the days it ran between. */
function _maxDrawdown(s) {
  if (!s.length) return null;
  let peak = s[0], worst = { pct: 0, peak: null, trough: null };
  for (const pt of s) {
    if (pt[1] > peak[1]) peak = pt;
    const dd = (pt[1] / peak[1] - 1) * 100;
    if (dd < worst.pct) worst = { pct: dd, peak: peak[0], trough: pt[0] };
  }
  return { pct: round(worst.pct), peakDate: worst.peak && toDateStr(worst.peak), troughDate: worst.trough && toDateStr(worst.trough) };
}

/** Daily simple returns keyed by day, for pairing two series on the days both traded. */
function _dailyReturns(s) {
  const out = new Map();
  for (let i = 1; i < s.length; i++) out.set(s[i][0], s[i][1] / s[i - 1][1] - 1);
  return out;
}

const _sma = (s, n) => (s.length >= n ? s.slice(-n).reduce((a, [, v]) => a + v, 0) / n : null);

/** Sessions in an Indian trading year — the annualisation factor for daily volatility. */
const TRADING_DAYS = 248;

/**
 * Risk and trend over the last YEAR of trading — long enough to mean something, short
 * enough to describe the stock as it is now.
 */
function _risk(stock, index) {
  const lastDay = stock[stock.length - 1][0];
  const year = stock.filter(([d]) => d >= lastDay - 365 * DAY_MS);
  const rs = _dailyReturns(year);
  const ri = _dailyReturns(index.filter(([d]) => d >= lastDay - 366 * DAY_MS));

  // Sample standard deviation of daily returns, annualised by √(sessions a year).
  const xs = [...rs.values()];
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;

  // Beta = cov(stock, index) / var(index), over the days BOTH traded — a suspended stock
  // must not be paired with the index's moves from the week it did not trade.
  const pairs = [];
  for (const [day, r] of rs) if (ri.has(day)) pairs.push([r, ri.get(day)]);
  let beta = null, correlation = null;
  if (pairs.length > 60) {
    const ma = pairs.reduce((a, [x]) => a + x, 0) / pairs.length;
    const mb = pairs.reduce((a, [, y]) => a + y, 0) / pairs.length;
    let cov = 0, vb = 0, va = 0;
    for (const [x, y] of pairs) { cov += (x - ma) * (y - mb); vb += (y - mb) ** 2; va += (x - ma) ** 2; }
    beta = vb ? cov / vb : null;
    correlation = va && vb ? cov / Math.sqrt(va * vb) : null;
  }

  const last = stock[stock.length - 1][1];
  const closes = year.map(([, v]) => v);
  const yearHigh = Math.max(...closes), yearLow = Math.min(...closes);
  const sma50 = _sma(stock, 50), sma200 = _sma(stock, 200);

  return {
    volatility: round(volatility, 1),
    beta: round(beta), correlation: round(correlation),
    maxDrawdown1y: _maxDrawdown(year),
    maxDrawdown5y: _maxDrawdown(stock),
    // The 52-week range of CLOSES — the same series every other figure here is read
    // from (an intraday high is a print, not a price anyone held overnight).
    yearHigh: round(yearHigh), yearLow: round(yearLow),
    fromHigh: round(pctChange(last, yearHigh), 1),
    rangePosition: yearHigh > yearLow ? round(((last - yearLow) / (yearHigh - yearLow)) * 100, 0) : null,
    sma50: round(sma50), sma200: round(sma200),
    vsSma50: round(pctChange(last, sma50), 1),
    vsSma200: round(pctChange(last, sma200), 1),
    upDays: xs.length ? round((xs.filter(x => x > 0).length / xs.length) * 100, 0) : null,
  };
}

// ── The business (Screener filings) ────────────────────────────────────────────

/** The row exactly one year before `date` ("2026-06-30" → the 2025-06 row), if filed. */
const _yearBefore = (rows, date) => {
  const prev = `${+date.slice(0, 4) - 1}${date.slice(4, 7)}`;
  return rows.find(r => r.date.startsWith(prev)) || null;
};

/**
 * Filings → the rows the page draws, with every derived figure attached.
 *
 * Growth is YEAR ON YEAR in both views: an annual row against the year before, and a
 * quarter against the SAME quarter a year earlier — never the quarter before, which for a
 * seasonal business mostly measures the season. A row whose comparison period was not
 * filed (the first year shown, a new listing) has no growth, not a growth of zero.
 */
function _shapeFinancials(co) {
  const isBank = co.kind === 'bank';
  const shape = (rows, annual) => rows.map(r => {
    const prev = _yearBefore(rows, r.date);
    const out = {
      date: r.date,
      revenue: r.revenue, netIncome: r.netIncome, eps: r.eps, interest: r.interest,
      revenueGrowth: round(pctChange(r.revenue, prev?.revenue), 1),
      // A loss in the base period makes a percentage meaningless ("+150%" from −₹100 Cr).
      profitGrowth: prev?.netIncome > 0 ? round(pctChange(r.netIncome, prev.netIncome), 1) : null,
      netMargin: r.revenue > 0 && r.netIncome != null ? round((r.netIncome / r.revenue) * 100, 1) : null,
      // Operating profit and interest cover describe a business that BORROWS to operate;
      // a lender's interest is its cost of goods, so for a bank they are withheld.
      operatingProfit: isBank ? null : r.operatingProfit,
      // From the rupee figures — the filed OPM % is rounded to a whole percent.
      operatingMargin: isBank || !(r.revenue > 0) || r.operatingProfit == null ? null : round((r.operatingProfit / r.revenue) * 100, 1),
      interestCover: !isBank && r.interest > 0 && r.operatingProfit != null ? round(r.operatingProfit / r.interest, 1) : null,
    };
    // Balance sheet and cash flow: every annual row, and quarters where they are filed (abroad).
    if (annual || r.debt != null || r.equity != null || r.ocf != null) {
      Object.assign(out, {
        debt: r.debt ?? null, equity: r.equity ?? null, ocf: r.ocf ?? null, fcf: r.fcf ?? null,
        debtToEquity: !isBank && r.debt != null && r.equity > 0 ? round(r.debt / r.equity, 2) : null,
      });
    }
    if (annual) {
      // Return on the AVERAGE equity of the year — profit is earned across the year, on
      // the capital that was there through it, not on the closing balance alone.
      const avgEquity = r.equity != null && prev?.equity != null ? (r.equity + prev.equity) / 2 : null;
      out.roe = avgEquity > 0 && r.netIncome != null ? round((r.netIncome / avgEquity) * 100, 1) : null;
    }
    return out;
  });
  return { quarterly: shape(co.quarterly, false), annual: shape(co.annual, true) };
}

/** The headline health figures, all from the filings — trailing twelve months where possible. */
function _health(fin, isBank) {
  const q = fin.quarterly, a = fin.annual;
  const last4 = q.slice(-4);
  const ttm = (f) => (last4.length === 4 && last4.every(r => r[f] != null) ? last4.reduce((s, r) => s + r[f], 0) : null);
  const revenueTtm = ttm('revenue'), profitTtm = ttm('netIncome'), opTtm = isBank ? null : ttm('operatingProfit');
  const latestQ = q[q.length - 1] || {};
  const latestA = [...a].reverse().find(r => r.equity != null) || {};
  return {
    revenueTtm, profitTtm,
    latestQuarter: latestQ.date || null,
    revenueGrowth: latestQ.revenueGrowth ?? null,
    profitGrowth: latestQ.profitGrowth ?? null,
    operatingMargin: revenueTtm > 0 && opTtm != null ? round((opTtm / revenueTtm) * 100, 1) : null,
    netMargin: revenueTtm > 0 && profitTtm != null ? round((profitTtm / revenueTtm) * 100, 1) : null,
    balanceSheetDate: latestA.date || null,
    roe: latestA.roe ?? null,
    debt: latestA.debt ?? null,
    debtToEquity: latestA.debtToEquity ?? null,
  };
}

/**
 * Shareholding over time. "Public" is SEBI's category for everyone who is not a promoter,
 * an institution or the government — retail investors, HNIs and corporate bodies — and is
 * the closest published measure of retail ownership.
 *
 * Changes are in percentage POINTS: a holding going from 20% to 18% is "−2 points", not
 * "−10%", and the points are what add up across the groups.
 */
const OWNER_GROUPS = ['promoters', 'fiis', 'diis', 'government', 'public'];

function _ownership(co) {
  const rows = co?.shareholding?.quarterly || [];
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const back = (n) => (rows.length > n ? rows[rows.length - 1 - n] : null);
  const delta = (g, then) => (latest[g] != null && then?.[g] != null ? round(latest[g] - then[g], 2) : null);
  const first = rows[0];
  return {
    asof: latest.date,
    since: first.date,
    groups: OWNER_GROUPS.map(g => ({
      key: g, pct: latest[g],
      q1: delta(g, back(1)), y1: delta(g, back(4)), sinceFirst: rows.length > 1 ? delta(g, first) : null,
    })).filter(g => g.pct != null),
    shareholders: latest.shareholders,
    shareholdersY1: back(4)?.shareholders ?? null,
    history: rows,
  };
}

// ── The market's view (Yahoo) ──────────────────────────────────────────────────

const MODULES = [
  'price', 'assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData',
  'earnings', 'recommendationTrend', 'calendarEvents', 'majorHoldersBreakdown', 'institutionOwnership',
].join(',');

async function _quoteSummary(ysym) {
  const qs = await fetchYahooAuthed(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${MODULES}`);
  return qs?.quoteSummary?.result?.[0] || {};
}

// ── Abroad (Yahoo only) ────────────────────────────────────────────────────────

/** A foreign listing's home index, by Yahoo exchange suffix. US (no suffix) is the S&P 500. */
const HOME_INDEX = {
  T: ['^N225', 'Nikkei 225'], HK: ['^HSI', 'Hang Seng'], L: ['^FTSE', 'FTSE 100'], DE: ['^GDAXI', 'DAX'],
  F: ['^GDAXI', 'DAX'], PA: ['^FCHI', 'CAC 40'], AS: ['^AEX', 'AEX'], SW: ['^SSMI', 'SMI'],
  TO: ['^GSPTSE', 'S&P/TSX'], AX: ['^AXJO', 'ASX 200'], KS: ['^KS11', 'KOSPI'], SS: ['000001.SS', 'Shanghai Composite'],
  SZ: ['399001.SZ', 'Shenzhen Component'], SI: ['^STI', 'Straits Times'], TW: ['^TWII', 'Taiwan Weighted'],
  MI: ['FTSEMIB.MI', 'FTSE MIB'], MC: ['^IBEX', 'IBEX 35'], SA: ['^BVSP', 'Bovespa'],
};
const homeIndex = (ysym) => {
  const hit = HOME_INDEX[/\.([A-Z]+)$/.exec(ysym)?.[1]];
  return hit ? { symbol: hit[0], label: hit[1] } : { symbol: '^GSPC', label: 'S&P 500' };
};

const FIN_FIELDS = {
  TotalRevenue: 'revenue', NetIncome: 'netIncome', OperatingIncome: 'operatingProfit', DilutedEPS: 'eps',
  InterestExpense: 'interest', TotalDebt: 'debt', StockholdersEquity: 'equity',
  OperatingCashFlow: 'ocf', FreeCashFlow: 'fcf',
};

/** Annual and quarterly statements from Yahoo's fundamentals timeseries, in the Screener row shape. */
async function _yahooFinancials(ysym) {
  const now = Math.floor(Date.now() / 1000);
  const types = Object.keys(FIN_FIELDS).flatMap(f => [`annual${f}`, `quarterly${f}`]);
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ysym)}`
            + `?type=${types.join(',')}&period1=${now - 6 * 365 * 86400}&period2=${now}`;
  const res = (await fetchYahooAuthed(url))?.timeseries?.result || [];
  const rows = { annual: {}, quarterly: {} };
  let currency = null;
  for (const r of res) {
    const type = r.meta?.type?.[0];
    const m = /^(annual|quarterly)(.+)$/.exec(type || '');
    if (!m || !FIN_FIELDS[m[2]]) continue;
    for (const pt of r[type] || []) {
      if (!pt?.asOfDate || pt.reportedValue?.raw == null) continue;
      (rows[m[1]][pt.asOfDate] ??= { date: pt.asOfDate })[FIN_FIELDS[m[2]]] = pt.reportedValue.raw;
      currency ??= pt.currencyCode || null;
    }
  }
  const sorted = (o) => Object.values(o).filter(r => r.revenue != null || r.netIncome != null).sort((a, b) => a.date.localeCompare(b.date));
  const annual = sorted(rows.annual), quarterly = sorted(rows.quarterly);
  return annual.length || quarterly.length ? { kind: 'company', consolidated: true, currency, annual, quarterly } : null;
}

/** Who holds a foreign company: insiders and institutions, and the largest institutional holders. */
function _holders(q) {
  const mh = q.majorHoldersBreakdown, list = q.institutionOwnership?.ownershipList || [];
  if (!mh && !list.length) return null;
  return {
    kind: 'holders',
    insiders: round(fraction(raw(mh?.insidersPercentHeld))),
    institutions: round(fraction(raw(mh?.institutionsPercentHeld))),
    institutionsFloat: round(fraction(raw(mh?.institutionsFloatPercentHeld))),
    institutionsCount: raw(mh?.institutionsCount),
    asof: raw(list[0]?.reportDate) ? toDateStr(raw(list[0].reportDate) * 1000) : null,
    top: list.map(o => ({
      name: o.organization, pct: round(fraction(raw(o.pctHeld))), value: raw(o.value),
      change: round(fraction(raw(o.pctChange)), 1),
    })).filter(o => o.name && o.pct >= 0.01),
  };
}

/** Yahoo's "often compared with" list, valued and priced the same way as the company. */
async function _yahooPeers(ysym) {
  const rec = await fetchYahooAuthed(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(ysym)}`);
  const syms = [ysym, ...(rec?.finance?.result?.[0]?.recommendedSymbols || []).map(r => r.symbol).filter(Boolean).slice(0, 7)];
  if (syms.length < 2) return null;
  const [quotes, charts] = await Promise.all([
    fetchYahooAuthed(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms.join(','))}&fields=marketCap,trailingPE,priceToBook,longName,shortName,currency,quoteType`),
    Promise.all(syms.map(sym => fetchChart(sym, { range: '1y', interval: '1d' }, 10000).catch(() => null))),
  ]);
  const byS = Object.fromEntries((quotes?.quoteResponse?.result || []).map(r => [r.symbol, r]));
  const items = syms.map((sym, i) => {
    const qt = byS[sym];
    if (!qt || (qt.quoteType && qt.quoteType !== 'EQUITY')) return null;
    const w = windowReturns(toSorted(closesByDay(charts[i])), ['1m', '1y']);
    return {
      symbol: sym, name: qt.longName || qt.shortName || sym, currency: qt.currency || null,
      cap: qt.marketCap > 0 ? qt.marketCap : null,
      pe: qt.trailingPE > 0 ? round(qt.trailingPE) : null, pb: qt.priceToBook > 0 ? round(qt.priceToBook) : null,
      chg1m: round(w['1m']), chg1y: round(w['1y']), self: sym === ysym,
    };
  }).filter(Boolean).sort((a, b) => (b.cap || 0) - (a.cap || 0));
  if (items.length < 2) return null;
  return { label: 'Often compared', rank: items.findIndex(p => p.self) + 1, count: items.length, items };
}

// ── Assembly ───────────────────────────────────────────────────────────────────

async function getStock(symbol, { fresh = false, global = false } = {}) {
  const key = `${global ? 'g' : 'n'}:${symbol}`;
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < (fresh ? 30 * 1000 : TTL_MS)) return hit.data;

  const ysym = global ? symbol : `${symbol}.NS`;
  const bench = global ? homeIndex(ysym) : { symbol: '^NSEI', label: 'Nifty 50' };
  const [chart, index, q, co, peers, yPeers] = await Promise.all([
    fetchChart(ysym, { range: '5y', interval: '1d' }, 12000),
    fetchChart(bench.symbol, { range: '5y', interval: '1d' }, 12000),
    _quoteSummary(ysym),
    (global ? _yahooFinancials(ysym) : screenerService.getCompany(symbol)).catch(() => null),
    global ? null : sectorService.getPeers(symbol).catch(() => null),
    global ? _yahooPeers(ysym).catch(() => null) : null,
  ]);
  // Abroad, money stays in native units; at home it is ₹ crore.
  const money = global ? (v) => (v == null ? null : v) : crore;

  const stock = toSorted(closesByDay(chart));
  if (stock.length < 2 && !q.price) throw notFound(`No market data for ${symbol}`);
  const nifty = toSorted(closesByDay(index));
  const price = q.price || {}, sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {};
  const fd = q.financialData || {}, ap = q.assetProfile || {};

  const last = stock.length ? stock[stock.length - 1][1] : raw(price.regularMarketPrice);
  const sRet = windowReturns(stock), nRet = windowReturns(nifty);
  const isBank = co?.kind === 'bank';
  const fin = co ? _shapeFinancials(co) : null;

  const targetMean = raw(fd.targetMeanPrice);
  const trend = q.recommendationTrend?.trend?.find(t => t.period === '0m') || null;
  const trendTotal = trend ? ['strongBuy', 'buy', 'hold', 'sell', 'strongSell'].reduce((a, k) => a + (trend[k] || 0), 0) : 0;
  // Yahoo sends `{}` for "no analysts", which is truthy — count what is actually there.
  const analystCount = raw(fd.numberOfAnalystOpinions) || trendTotal || 0;

  const data = {
    symbol,
    name: price.longName || price.shortName || chart?.meta?.longName || symbol,
    asof: stock.length ? toDateStr(stock[stock.length - 1][0]) : null,
    global,
    exchange: price.exchangeName || chart?.meta?.fullExchangeName || (global ? null : 'NSE'),
    benchmark: bench,
    money: global
      ? { unit: 'unit', currency: price.currency || chart?.meta?.currency || null, financialCurrency: fd.financialCurrency || co?.currency || price.currency || null }
      : { unit: 'crore', currency: 'INR', financialCurrency: 'INR' },

    profile: {
      sector: peers?.sector?.label || ap.sectorDisp || ap.sector || null,   // OUR sector at home — the one the map uses
      industry: ap.industryDisp || ap.industry || null,
      description: ap.longBusinessSummary || null,
      website: ap.website || null,
      employees: ap.fullTimeEmployees ?? null,
      city: ap.city || null,
      officers: (ap.companyOfficers || []).slice(0, 4).map(o => ({ name: String(o.name || '').replace(/\s+/g, ' '), title: o.title })),
    },

    quote: {
      price: round(last),
      change: stock.length > 1 ? round(last - stock[stock.length - 2][1]) : round(raw(price.regularMarketChange)),
      changePct: round(sRet['1d']),
      dayHigh: raw(sd.dayHigh), dayLow: raw(sd.dayLow),
      volume: raw(sd.volume), avgVolume: raw(sd.averageVolume),
      marketCap: money(raw(price.marketCap) ?? raw(sd.marketCap)),
    },

    valuation: {
      pe: round(raw(sd.trailingPE)), forwardPe: round(raw(ks.forwardPE) ?? raw(sd.forwardPE)),
      pb: round(raw(ks.priceToBook)),
      evEbitda: isBank ? null : round(raw(ks.enterpriseToEbitda)), ev: isBank ? null : money(raw(ks.enterpriseValue)),
      eps: round(raw(ks.trailingEps)), bookValue: round(raw(ks.bookValue)),
      dividendYield: round(fraction(raw(sd.dividendYield))), payoutRatio: round(fraction(raw(sd.payoutRatio))),
      sectorMedianPe: round(peers?.medianPe), sectorMedianPb: round(peers?.medianPb),
    },

    health: fin ? { ..._health(fin, isBank), cash: money(raw(fd.totalCash)) } : null,

    analysts: analystCount > 0 || targetMean != null ? {
      count: analystCount || null,
      key: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
      targetMean: round(targetMean), targetHigh: round(raw(fd.targetHighPrice)), targetLow: round(raw(fd.targetLowPrice)),
      upside: round(pctChange(targetMean, last), 1),
      trend: trendTotal > 0 && { strongBuy: trend.strongBuy, buy: trend.buy, hold: trend.hold, sell: trend.sell, strongSell: trend.strongSell },
    } : null,

    earnings: {
      next: raw(q.calendarEvents?.earnings?.earningsDate?.[0]) ? toDateStr(raw(q.calendarEvents.earnings.earningsDate[0]) * 1000) : null,
      surprises: (q.earnings?.earningsChart?.quarterly || []).map(e => {
        const actual = raw(e.actual), estimate = raw(e.estimate);
        return {
          periodEnd: raw(e.periodEndDate) ? toDateStr(raw(e.periodEndDate) * 1000) : null,
          actual: round(actual), estimate: round(estimate),
          // Computed, not Yahoo's string: (actual − estimate) / |estimate|, so a miss on a
          // negative estimate still reads as a miss.
          surprisePct: actual != null && estimate ? round(((actual - estimate) / Math.abs(estimate)) * 100, 1) : null,
        };
      }),
    },

    financials: fin && { kind: co.kind, consolidated: co.consolidated, ...fin },
    ownership: global ? _holders(q) : _ownership(co),

    performance: {
      returns: Object.fromEntries(['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'].map(k => [k, {
        stock: round(sRet[k]), nifty: round(nRet[k]),
        stockCagr: round(sRet[`${k}Cagr`]), niftyCagr: round(nRet[`${k}Cagr`]),
      }])),
      ...(stock.length > 30 && nifty.length > 30 ? _risk(stock, nifty) : {}),
    },

    experience: holdingExperience(stock, nifty),

    peers: yPeers || peers && {
      sector: { ...peers.sector, cap: crore(peers.sector?.cap) }, rank: peers.rank, count: peers.peers.length,
      items: peers.peers.map(p => ({
        symbol: p.symbol, name: p.name, cap: crore(p.cap), pe: round(p.pe), pb: round(p.pb),
        chg1m: p.chg1m, chg1y: p.chg1y, self: p.self,
      })),
    },
  };

  _memo.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getStock, _risk, _maxDrawdown, _shapeFinancials, _ownership };
