/**
 * assetService — any priceable instrument, for its page in Markets.
 *
 * The company page (`stockService`) is built around an NSE listing's filings. Everything
 * else a user can hold or compare against — an index, gold, silver, a coin, a US share,
 * an ETF, an Indian mutual fund — has no filings, but has a PRICE HISTORY, and that is
 * enough for the half of the company page that is about the price: the quote, the day's
 * move, returns over every window against a benchmark, and the risk measures. Those are
 * computed exactly as the company page computes them (`series.windowReturns`,
 * `stockService._risk`), so a 1-year return means one thing everywhere.
 *
 * Each source answers in its own unit, and the payload says which (`unit`):
 *   - `_METAL:gold|silver` — DOMESTIC metal, ₹ per gram of 999 (spot × USDINR × premium),
 *     the same figure a physical holding is valued at.
 *   - `AMFI:<code>` — the fund's NAV, ₹.
 *   - anything else — Yahoo, in the instrument's own currency; an index is in points.
 *
 * Beyond the price, each kind gets what an investor in it actually asks (`profile`):
 *   - an NSE index — valuation, breadth and what it is made of (members, sectors);
 *   - a fund — its house, category and plans, measured against its CATEGORY's index;
 *   - gold/silver — the price by purity, and how much of the return was the metal and
 *     how much the rupee; any foreign-quoted asset gets that same rupee split.
 * Every kind gets SIP and rolling returns — the holding experience, not one start date.
 */

const { DAY_MS } = require('../utils/constants');
const { nowMs, toDateStr } = require('../utils/helpers');
const { notFound } = require('../utils/httpError');
const { round, toSorted, valueAt, windowReturns, holdingExperience } = require('../utils/series');
const { PURITY_OPTIONS } = require('../utils/assetPricing');
const { fetchChart, closesByDay, fetchHistoricPrices } = require('./marketDataService');
const mfService = require('./mfService');
const indiaMarketService = require('./indiaMarketService');
const sectorService = require('./sectorService');
const { _risk } = require('./stockService');

const TROY_OZ_G = 31.1034768;

const TTL_MS = 10 * 60 * 1000;
const _memo = new Map();   // symbol → { at, data }

const HISTORY_DAYS = 5 * 365 + 10;
const PERIODS = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'];

const METALS = {
  gold:   { name: 'Gold',   sub: '24K (999), domestic price per gram' },
  silver: { name: 'Silver', sub: '999, domestic price per gram' },
};

/** Yahoo's instrument type → ours. An index gets its own: it is a yardstick, not a holding. */
const YAHOO_TYPES = {
  EQUITY: 'stock', ETF: 'etf', CRYPTOCURRENCY: 'crypto', MUTUALFUND: 'mutual_fund',
  FUTURE: 'commodity', CURRENCY: 'currency', INDEX: 'index',
};

const NIFTY = { symbol: '^NSEI', label: 'Nifty 50' };
const NIFTY500 = { symbol: '^CRSLDX', label: 'Nifty 500' };

/**
 * The index a fund should be judged against, read off its AMFI category (and name, for
 * index funds and FoFs). A debt or overseas fund has no fair yardstick we can chart, so
 * it gets none rather than a Nifty comparison that says nothing.
 */
function fundBenchmark(category, name) {
  const c = `${category || ''} ${name || ''}`.toLowerCase();
  if (/\bgold\b/.test(c)) return { symbol: '_METAL:gold', label: 'Gold' };
  if (/\bsilver\b/.test(c)) return { symbol: '_METAL:silver', label: 'Silver' };
  if (/debt|liquid|overnight|money market|gilt|duration|credit risk|banking and psu|floater|corporate bond|dynamic bond|arbitrage|target maturity|overseas|international|global|nasdaq|s&p/.test(c)) return null;
  if (/next 50/.test(c)) return { symbol: '^NSMIDCP', label: 'Nifty Next 50' };
  if (/nifty 50(?!0)/.test(c)) return NIFTY;
  if (/large\s*(&|and)\s*mid/.test(c)) return NIFTY500;
  if (/large\s*cap/.test(c)) return { symbol: '^CNX100', label: 'Nifty 100' };
  if (/mid\s*cap/.test(c)) return { symbol: 'NIFTYMIDCAP150.NS', label: 'Nifty Midcap 150' };
  if (/small\s*cap/.test(c)) return { symbol: 'NIFTYSMLCAP250.NS', label: 'Nifty Smallcap 250' };
  if (/banking|financial/.test(c)) return { symbol: '^NSEBANK', label: 'Nifty Bank' };
  if (/technology|digital/.test(c)) return { symbol: '^CNXIT', label: 'Nifty IT' };
  return NIFTY500;
}

/** The yardstick an asset is measured against — the Nifty, except for the Nifty itself. */
const benchmarkFor = (symbol, asset) => {
  if (asset.type === 'mutual_fund') return fundBenchmark(asset.scheme?.category, asset.name);
  return symbol === '^NSEI' ? { symbol: '^BSESN', label: 'Sensex' } : NIFTY;
};

/** Sorted daily closes + what the instrument is, from whichever source owns it. */
async function _load(symbol) {
  const now = nowMs();
  const from = now - HISTORY_DAYS * DAY_MS;

  const metal = /^_METAL:(gold|silver)$/.exec(symbol)?.[1];
  if (metal) {
    const closes = (await fetchHistoricPrices([{ assetSymbol: symbol, assetType: metal }], from, now))[symbol] || {};
    return { series: toSorted(closes), name: METALS[metal].name, sub: METALS[metal].sub, type: metal, currency: 'INR', unit: 'g' };
  }

  if (mfService.isMfSymbol(symbol)) {
    const code = mfService.schemeCodeOf(symbol);
    const [navs, schemes] = await Promise.all([
      mfService.getNavHistory(code, from, now),
      mfService.getSchemes([code]),
    ]);
    const scheme = schemes[code];
    return { series: toSorted(navs), name: scheme?.name || symbol, sub: scheme?.fundHouse || 'NAV', type: 'mutual_fund', currency: 'INR', unit: null, scheme };
  }

  const chart = await fetchChart(symbol, { range: '5y', interval: '1d' }, 12000);
  const meta = chart?.meta || {};
  const name = meta.longName || meta.shortName || symbol;
  // Yahoo files some Indian ETFs as EQUITY; the same name rule `searchYahoo` applies.
  const type = /\b(ETF|BEES)\b|AMC\s*-\s/i.test(name) ? 'etf' : (YAHOO_TYPES[meta.instrumentType] || 'other');
  return {
    series: toSorted(closesByDay(chart)),
    name,
    sub: meta.fullExchangeName || meta.exchangeName || null,
    type,
    // An index is in POINTS — Yahoo stamps the Nifty "INR", which would print it as ₹.
    currency: type === 'index' ? null : (meta.currency || null),
    quoteCurrency: meta.currency || null,
    unit: null,
  };
}

const _chart5y = (sym) => fetchChart(sym, { range: '5y', interval: '1d' }, 12000).then(r => toSorted(closesByDay(r)));

/** Native closes × the day's rupee rate (carried over days FX did not trade). */
function _inrSeries(native, fx) {
  const out = [];
  let j = 0, rate = null;
  for (const [d, v] of native) {
    while (j < fx.length && fx[j][0] <= d) rate = fx[j++][1];
    if (rate != null) out.push([d, v * rate]);
  }
  return out;
}

const SPLIT_WINDOWS = ['1m', '1y', '3y', '5y'];

/** How much of a rupee return came from the asset in its own currency, and how much from the rupee. */
function _returnSplit(native, fx, inr) {
  const n = windowReturns(native, SPLIT_WINDOWS), f = windowReturns(fx, SPLIT_WINDOWS), r = windowReturns(inr, SPLIT_WINDOWS);
  return Object.fromEntries(SPLIT_WINDOWS.map(k => [k, { native: round(n[k]), fx: round(f[k]), inr: round(r[k]) }]));
}

/** Gold and silver: the price by purity, the international spot, the premium, and the rupee split. */
async function _metalProfile(metal, series) {
  const [spot, other, fx] = await Promise.all([
    _chart5y(metal === 'gold' ? 'GC=F' : 'SI=F'),
    _chart5y(metal === 'gold' ? 'SI=F' : 'GC=F'),
    _chart5y('USDINR=X'),
  ]);
  const last = series[series.length - 1][1];
  const spotLast = spot.at(-1)?.[1] ?? null, fxLast = fx.at(-1)?.[1] ?? null;
  const intl = spotLast && fxLast ? (spotLast * fxLast) / TROY_OZ_G : null;

  // Gold-to-silver ratio: how many ounces of silver one ounce of gold buys.
  const [g, si] = metal === 'gold' ? [spot, other] : [other, spot];
  const ratio = g.map(([d, v]) => { const sv = valueAt(si, d); return sv ? v / sv : null; }).filter(Boolean).sort((a, b) => a - b);
  const ratioNow = g.length && valueAt(si, g.at(-1)[0]) ? g.at(-1)[1] / valueAt(si, g.at(-1)[0]) : null;

  return {
    kind: 'metal',
    metal,
    purities: PURITY_OPTIONS[metal].map(o => ({ label: o.label, perGram: round(last * o.factor, 0) })),
    spotUsdOz: round(spotLast),
    usdInr: round(fxLast),
    internationalPerGram: round(intl, 0),
    premiumPct: intl ? round((last / intl - 1) * 100, 1) : null,
    split: spot.length && fx.length ? _returnSplit(spot, fx, series) : null,
    ratio: ratioNow && ratio.length > 20 ? {
      now: round(ratioNow, 1),
      low: round(ratio[0], 1), high: round(ratio.at(-1), 1),
      median: round(ratio[Math.floor(ratio.length / 2)], 1),
    } : null,
  };
}

/** A foreign-quoted asset seen in rupees: its own return, the rupee's, and the two together. */
async function _currencyLens(currency, native) {
  const fx = await _chart5y(`${currency}INR=X`);
  if (fx.length < 2) return null;
  const inr = _inrSeries(native, fx);
  return { currency, rate: round(fx.at(-1)[1], 4), inrPrice: round(inr.at(-1)?.[1]), split: _returnSplit(native, fx, inr) };
}

async function _indexProfile(symbol) {
  const stats = await indiaMarketService.getIndexStats(symbol).catch(() => null);
  if (!stats) return null;
  const composition = await sectorService.getComposition(stats.list).catch(() => null);
  return {
    kind: 'index',
    pe: stats.pe, pb: stats.pb, dy: stats.dy,
    earningsYield: stats.pe ? round(100 / stats.pe) : null,
    breadth: stats.breadth,
    composition,
  };
}

async function _fundProfile(symbol, scheme) {
  const code = mfService.schemeCodeOf(symbol);
  const plans = await mfService.getSiblingPlans(code).catch(() => []);
  const name = scheme?.name || '';
  return {
    kind: 'fund',
    fundHouse: scheme?.fundHouse || null,
    category: scheme?.category || null,
    plan: /direct/i.test(name) ? 'Direct' : /regular/i.test(name) ? 'Regular' : null,
    option: /idcw|dividend/i.test(name) ? 'IDCW' : /bonus/i.test(name) ? 'Bonus' : /growth/i.test(name) ? 'Growth' : null,
    isin: scheme?.isinGrowth || scheme?.isinDivReinv || null,
    schemeCode: code,
    plans: plans.map(p => ({ ...p, navDate: p.navDate && toDateStr(p.navDate) })),
  };
}

async function _profile(symbol, asset) {
  if (asset.type === 'mutual_fund') return _fundProfile(symbol, asset.scheme);
  if (asset.type === 'gold' || asset.type === 'silver') return _metalProfile(asset.type, asset.series);
  return _indexProfile(symbol);
}

async function getAsset(symbol, { fresh = false } = {}) {
  const hit = _memo.get(symbol);
  if (hit && Date.now() - hit.at < (fresh ? 30 * 1000 : TTL_MS)) return hit.data;

  const asset = await _load(symbol);
  const s = asset.series;
  if (s.length < 2) throw notFound(`No price history for ${symbol}`);

  const bench = benchmarkFor(symbol, asset);
  const foreign = asset.quoteCurrency && asset.quoteCurrency !== 'INR' ? asset.quoteCurrency : null;
  const [b, profile, lens] = await Promise.all([
    bench ? _load(bench.symbol).then(x => x.series).catch(() => []) : [],
    _profile(symbol, asset).catch(() => null),
    foreign ? _currencyLens(foreign, s).catch(() => null) : null,
  ]);
  const aRet = windowReturns(s), bRet = windowReturns(b);
  const last = s[s.length - 1][1];

  const data = {
    symbol,
    name: asset.name,
    sub: asset.sub,
    type: asset.type,
    currency: asset.currency,
    unit: asset.unit,
    asof: toDateStr(s[s.length - 1][0]),
    benchmark: bench,

    quote: {
      price: round(last, 4),
      change: round(last - s[s.length - 2][1], 4),
      changePct: round(aRet['1d']),
    },

    // Same shape as the company page's, so the same component draws it: `stock` is this
    // asset and `nifty` is its benchmark, whichever that is.
    performance: {
      returns: Object.fromEntries(PERIODS.map(k => [k, {
        stock: round(aRet[k]), nifty: bench ? round(bRet[k]) : null,
        stockCagr: round(aRet[`${k}Cagr`]), niftyCagr: round(bRet[`${k}Cagr`]),
      }])),
      // `_risk` pairs against a benchmark for beta; with none, it pairs against itself
      // and the beta is dropped below.
      ...(s.length > 30 ? _risk(s, b.length > 30 ? b : s) : {}),
      ...(b.length > 30 ? {} : { beta: null, correlation: null }),
    },

    profile,
    currencyLens: lens,
    experience: holdingExperience(s, b),
  };

  _memo.set(symbol, { at: Date.now(), data });
  return data;
}

module.exports = { getAsset };
