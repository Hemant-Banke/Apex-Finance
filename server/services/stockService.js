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
 */

const { DAY_MS } = require('../utils/constants');
const { toDateStr } = require('../utils/helpers');
const { notFound } = require('../utils/httpError');
const { round, pctChange, toSorted, windowReturns } = require('../utils/series');
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
    if (annual) {
      const avgEquity = r.equity != null && prev?.equity != null ? (r.equity + prev.equity) / 2 : null;
      Object.assign(out, {
        debt: r.debt ?? null, equity: r.equity ?? null, ocf: r.ocf ?? null, fcf: r.fcf ?? null,
        debtToEquity: !isBank && r.debt != null && r.equity > 0 ? round(r.debt / r.equity, 2) : null,
        // Return on the AVERAGE equity of the year — profit is earned across the year, on
        // the capital that was there through it, not on the closing balance alone.
        roe: avgEquity > 0 && r.netIncome != null ? round((r.netIncome / avgEquity) * 100, 1) : null,
      });
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
  'earnings', 'recommendationTrend', 'calendarEvents',
].join(',');

async function _quoteSummary(ysym) {
  const qs = await fetchYahooAuthed(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${MODULES}`);
  return qs?.quoteSummary?.result?.[0] || {};
}

// ── Assembly ───────────────────────────────────────────────────────────────────

async function getStock(symbol, { fresh = false } = {}) {
  const hit = _memo.get(symbol);
  if (hit && Date.now() - hit.at < (fresh ? 30 * 1000 : TTL_MS)) return hit.data;

  const ysym = `${symbol}.NS`;
  const [chart, index, q, co, peers] = await Promise.all([
    fetchChart(ysym, { range: '5y', interval: '1d' }, 12000),
    fetchChart('^NSEI', { range: '5y', interval: '1d' }, 12000),
    _quoteSummary(ysym),
    screenerService.getCompany(symbol).catch(() => null),
    sectorService.getPeers(symbol).catch(() => null),
  ]);

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

  const data = {
    symbol,
    name: price.longName || price.shortName || chart?.meta?.longName || symbol,
    asof: stock.length ? toDateStr(stock[stock.length - 1][0]) : null,

    profile: {
      sector: peers?.sector?.label || null,          // OUR sector — the one the map uses
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
      marketCap: crore(raw(price.marketCap) ?? raw(sd.marketCap)),
    },

    valuation: {
      pe: round(raw(sd.trailingPE)), forwardPe: round(raw(ks.forwardPE) ?? raw(sd.forwardPE)),
      pb: round(raw(ks.priceToBook)),
      evEbitda: isBank ? null : round(raw(ks.enterpriseToEbitda)), ev: isBank ? null : crore(raw(ks.enterpriseValue)),
      eps: round(raw(ks.trailingEps)), bookValue: round(raw(ks.bookValue)),
      dividendYield: round(fraction(raw(sd.dividendYield))), payoutRatio: round(fraction(raw(sd.payoutRatio))),
      sectorMedianPe: round(peers?.medianPe), sectorMedianPb: round(peers?.medianPb),
    },

    health: fin ? { ..._health(fin, isBank), cash: crore(raw(fd.totalCash)) } : null,

    analysts: fd.numberOfAnalystOpinions ? {
      count: raw(fd.numberOfAnalystOpinions),
      key: fd.recommendationKey || null,
      targetMean: round(targetMean), targetHigh: round(raw(fd.targetHighPrice)), targetLow: round(raw(fd.targetLowPrice)),
      upside: round(pctChange(targetMean, last), 1),
      trend: trend && { strongBuy: trend.strongBuy, buy: trend.buy, hold: trend.hold, sell: trend.sell, strongSell: trend.strongSell },
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
    ownership: _ownership(co),

    performance: {
      returns: Object.fromEntries(['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'].map(k => [k, {
        stock: round(sRet[k]), nifty: round(nRet[k]),
        stockCagr: round(sRet[`${k}Cagr`]), niftyCagr: round(nRet[`${k}Cagr`]),
      }])),
      ...(stock.length > 30 && nifty.length > 30 ? _risk(stock, nifty) : {}),
    },

    peers: peers && {
      sector: { ...peers.sector, cap: crore(peers.sector?.cap) }, rank: peers.rank, count: peers.peers.length,
      items: peers.peers.map(p => ({
        symbol: p.symbol, name: p.name, cap: crore(p.cap), pe: round(p.pe), pb: round(p.pb),
        chg1m: p.chg1m, chg1y: p.chg1y, self: p.self,
      })),
    },
  };

  _memo.set(symbol, { at: Date.now(), data });
  return data;
}

module.exports = { getStock, _risk, _maxDrawdown, _shapeFinancials, _ownership };
