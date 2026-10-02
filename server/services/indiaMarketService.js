/**
 * indiaMarketService — the Indian market as a whole, for the Markets page.
 *
 * Everything else in the app is about the USER's money; this is about the market's. It
 * answers three questions, each from the source that actually knows:
 *
 *  1. **How has everything done?** NSE's `allIndices` returns ~130 indices in ONE call,
 *     each already carrying its 1-day, 1-week, 1-month and 1-year change — so every
 *     broad, sectoral and fixed-income index is priced without a request per index.
 *     Yahoo's chart API fills in what NSE does not list (Sensex, gold, silver, the rupee,
 *     crude, bitcoin) and supplies the HISTORY for the growth chart. Yahoo cannot do the
 *     sector board itself: for most NSE sectoral indices it holds exactly one day of data.
 *
 *  2. **Where is the big money going?** Institutional cash flows (FII/FPI and DII), FII
 *     derivatives activity, domestic mutual-fund flows (the channel retail SIP money
 *     arrives by), and participant-wise open interest — the one daily dataset that splits
 *     the market into Client (retail + HNI), DII, FII and Pro and says which way each is
 *     leaning. These are kept in `MarketFlow`, a day at a time (see that model for why).
 *
 *  3. **Which sectors is it moving between?** Built stock by stock in `sectorService`.
 *     There is no daily sector-flow dataset (the NSDL fortnightly FPI-by-sector report is
 *     too sparse to rank anything), so it is read from PRICE — a proxy, and the page says so.
 *
 * Every upstream here is a public page, not a contracted API, so every fetch is treated
 * as able to fail: one retry (the same cold-connection stall `index.js` describes), a
 * stale cache served rather than nothing, and a section that is missing rather than a
 * page that errors.
 */

const MarketFlow = require('../models/MarketFlow');
const { DAY_MS, BROWSER_HEADERS } = require('../utils/constants');
const { toDateStr, todayMs, parseNumber } = require('../utils/helpers');
const { round, pctChange, toSorted, windowReturns } = require('../utils/series');
const { metalInrPerGram } = require('../utils/assetPricing');
const { fetchChart, closesByDay } = require('./marketDataService');

// ── Catalogue ──────────────────────────────────────────────────────────────────

/**
 * The market's headline numbers. `nse` names the index on NSE's board (which supplies
 * its returns); `yahoo` supplies a sparkline and, where NSE has no entry (the Sensex is
 * a BSE index), the returns too.
 */
const HEADLINE = [
  { key: 'nifty50',   label: 'Nifty 50',          nse: 'NIFTY 50',            yahoo: '^NSEI' },
  { key: 'sensex',    label: 'Sensex',            yahoo: '^BSESN' },
  { key: 'bank',      label: 'Bank Nifty',        nse: 'NIFTY BANK',          yahoo: '^NSEBANK' },
  { key: 'next50',    label: 'Nifty Next 50',     nse: 'NIFTY NEXT 50',       view: '^NSMIDCP' },
  { key: 'midcap',    label: 'Midcap 150',        nse: 'NIFTY MIDCAP 150',    view: 'NIFTYMIDCAP150.NS' },
  { key: 'smallcap',  label: 'Smallcap 250',      nse: 'NIFTY SMALLCAP 250',  view: 'NIFTYSMLCAP250.NS' },
  { key: 'nifty500',  label: 'Nifty 500',         nse: 'NIFTY 500',           yahoo: '^CRSLDX' },
  { key: 'vix',       label: 'India VIX',         nse: 'INDIA VIX',           yahoo: '^INDIAVIX', fear: true },
];

/**
 * Other asset classes, priced in the units an Indian investor actually quotes them in.
 * Gold and silver are DOMESTIC prices — the COMEX future converted at the day's rupee
 * and lifted by the same import-duty/GST premium every holding is valued with — so the
 * figure matches a jeweller's board, not a dollar screen.
 */
const ASSETS = [
  { key: 'gold',    label: 'Gold',          unit: '₹ / 10 g',  kind: 'metal', metal: 'gold',   grams: 10 },
  { key: 'silver',  label: 'Silver',        unit: '₹ / kg',    kind: 'metal', metal: 'silver', grams: 1000 },
  { key: 'gsec',    label: '10Y G-Sec',     unit: 'total-return index', kind: 'nse', currency: null, nse: 'NIFTY 10 YR BENCHMARK G-SEC' },
  { key: 'usdinr',  label: 'US dollar',     unit: '₹ per $',   kind: 'yahoo', yahoo: 'USDINR=X' },
  { key: 'brent',   label: 'Brent crude',   unit: '$ / barrel', kind: 'yahoo', yahoo: 'BZ=F', currency: 'USD' },
  { key: 'bitcoin', label: 'Bitcoin',       unit: '₹ per coin',       kind: 'yahoo', yahoo: 'BTC-INR' },
];

/**
 * The symbol a tile opens on the asset page (`/markets/assets/:symbol`), or null.
 * Yahoo's ticker where we have one; `view` names it for indices we read from NSE but
 * Yahoo also carries in full. Metals open the domestic per-gram page. The G-Sec index
 * has no history anywhere we can chart, so it opens nothing.
 */
/**
 * Indices that have an asset page, by the symbol that page is opened with: the name NSE's
 * board knows them by (valuation, breadth) and the constituent list NSE publishes.
 */
const NSE_INDICES = {
  '^NSEI':             { nse: 'NIFTY 50',           list: 'ind_nifty50list' },
  '^CNX100':           { nse: 'NIFTY 100',          list: 'ind_nifty100list' },
  '^NSMIDCP':          { nse: 'NIFTY NEXT 50',      list: 'ind_niftynext50list' },
  '^CRSLDX':           { nse: 'NIFTY 500',          list: 'ind_nifty500list' },
  '^NSEMDCP50':        { nse: 'NIFTY MIDCAP 50',    list: 'ind_niftymidcap50list' },
  'NIFTYMIDCAP150.NS': { nse: 'NIFTY MIDCAP 150',   list: 'ind_niftymidcap150list' },
  'NIFTYSMLCAP250.NS': { nse: 'NIFTY SMALLCAP 250', list: 'ind_niftysmallcap250list' },
  '^NSEBANK':          { nse: 'NIFTY BANK',         list: 'ind_niftybanklist' },
  '^CNXIT':            { nse: 'NIFTY IT',           list: 'ind_niftyitlist' },
  '^CNXAUTO':          { nse: 'NIFTY AUTO',         list: 'ind_niftyautolist' },
  '^CNXPHARMA':        { nse: 'NIFTY PHARMA',       list: 'ind_niftypharmalist' },
  '^CNXFMCG':          { nse: 'NIFTY FMCG',         list: 'ind_niftyfmcglist' },
  '^CNXMETAL':         { nse: 'NIFTY METAL',        list: 'ind_niftymetallist' },
};

const _viewSymbol = (q) => (q.kind === 'metal' ? `_METAL:${q.metal}` : (q.view || q.yahoo || null));

/**
 * The Markets page's refresh button asks for `fresh` data. It bypasses a memo only when
 * that memo is at least this old — so a refresh always gets data newer than what is on
 * screen, but a burst of clicks cannot turn into a burst of calls against NSE and Yahoo.
 */
const FRESH_MIN_AGE_MS = 30 * 1000;
const _stale = (at, ttl, fresh) => !at || Date.now() - at >= (fresh ? FRESH_MIN_AGE_MS : ttl);


// ── Fetching ───────────────────────────────────────────────────────────────────

/**
 * GET with one retry. A first connection out of a long-lived process can stall for
 * seconds while the next is instant (see index.js), so a single attempt would turn a
 * perfectly healthy source into an empty section.
 */
async function _get(url, { as = 'json', timeoutMs = 8000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (resp.status === 404) return null;            // a holiday's file, not a failure
      if (!resp.ok) continue;
      return as === 'json' ? await resp.json() : await resp.text();
    } catch { /* stalled or malformed — one more try on a fresh connection */ }
  }
  return null;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "30-Sep-2026" → "2026-09-30". */
function _nseDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month == null) return null;
  return toDateStr(Date.UTC(+m[3], month, +m[1]));
}


// ── 1. The index board (NSE) ──────────────────────────────────────────────────

const BOARD_TTL_MS = 3 * 60 * 1000;
let _board = null;   // { at, data }

/**
 * Every NSE index with its returns, keyed by its upper-cased name. Served from a short
 * memo (the board moves intraday but not by the second), and from the LAST good copy
 * when NSE is unreachable — a quote from ten minutes ago is far more useful than none.
 */
async function _indexBoard(fresh = false) {
  if (_board && !_stale(_board.at, BOARD_TTL_MS, fresh)) return _board.data;

  const raw = await _get('https://www.nseindia.com/api/allIndices');
  if (!raw?.data?.length) return _board?.data || null;

  const byName = {};
  for (const r of raw.data) {
    const last = parseNumber(r.last);
    // NSE writes 0 for "no figure" on young indices (one with no year of history
    // reports perChange365d: 0 and oneYearAgoVal: 0). A literal 0% return is rare
    // enough that treating a zero base as missing is the honest reading.
    const yearAgo = parseNumber(r.oneYearAgoVal);
    byName[String(r.index).toUpperCase()] = {
      name:     r.index,
      group:    r.key,
      last,
      chg1d:    parseNumber(r.percentChange),
      chg1w:    pctChange(last, parseNumber(r.oneWeekAgoVal)),
      chg1m:    parseNumber(r.oneMonthAgoVal) ? parseNumber(r.perChange30d) : null,
      chg1y:    yearAgo ? parseNumber(r.perChange365d) : null,
      pe:       parseNumber(r.pe),
      pb:       parseNumber(r.pb),
      dy:       parseNumber(r.dy),
      unchanged: parseNumber(r.unchanged),
      advances: parseNumber(r.advances),
      declines: parseNumber(r.declines),
      yearHigh: parseNumber(r.yearHigh),
      yearLow:  parseNumber(r.yearLow),
    };
  }

  const data = {
    asof:    raw.timestamp || null,          // "01-Oct-2026 15:30", IST
    breadth: { advances: parseNumber(raw.advances), declines: parseNumber(raw.declines), unchanged: parseNumber(raw.unchanged) },
    byName,
  };
  _board = { at: Date.now(), data };
  return data;
}

// ── 2. Price history (Yahoo) ──────────────────────────────────────────────────

const HISTORY_TTL_MS = 15 * 60 * 1000;
const _historyMemo = new Map();   // `${symbol}|${days}` → { at, series }

/** Daily closes for a symbol over the last `days`, as `{ [dayMs]: close }`. Memoised. */
async function _closes(symbol, days, fresh = false) {
  const key = `${symbol}|${days}`;
  const hit = _historyMemo.get(key);
  if (hit && !_stale(hit.at, HISTORY_TTL_MS, fresh)) return hit.series;

  const now = Date.now();
  const result = await fetchChart(symbol, {
    period1:  Math.floor((now - days * DAY_MS) / 1000),
    period2:  Math.floor(now / 1000),
    // Weekly bars past a year: five years of dailies is ~1,250 points a line, far more
    // than a chart a few hundred pixels wide can draw, and eleven lines of it besides.
    interval: days > 400 ? '1wk' : '1d',
  }, 10000);

  const series = closesByDay(result);
  if (Object.keys(series).length) _historyMemo.set(key, { at: Date.now(), series });
  return Object.keys(series).length ? series : (hit?.series || {});
}

/** Domestic metal price per `grams`, day by day — the spot future × the day's rupee. */
function _metalSeries(spot, fx, metal, grams) {
  const fxDays = toSorted(fx);
  const out = {};
  let j = 0, rate = fxDays[0]?.[1] ?? null;
  for (const [day, usd] of toSorted(spot)) {
    // Carry the rupee forward over days the currency market was shut.
    while (j < fxDays.length && fxDays[j][0] <= day) rate = fxDays[j++][1];
    const perGram = metalInrPerGram(usd, rate, metal);
    if (perGram != null) out[day] = round(perGram * grams, 0);
  }
  return out;
}

/** The last close on or before `dayMs` in a sorted series. */
/** 1D / 1W / 1M / 1Y off a day map, in the board's field names (see `windowReturns`). */
function _returnsFrom(dayMap) {
  const r = windowReturns(toSorted(dayMap), ['1w', '1m', '1y']);
  return { last: r.last, chg1d: r['1d'], chg1w: r['1w'], chg1m: r['1m'], chg1y: r['1y'] };
}

/** The last ~3 months of a series, thinned to at most `points` closes, for a sparkline. */
function _spark(series, points = 48) {
  const cutoff = Date.now() - 92 * DAY_MS;
  const s = toSorted(series).filter(([d]) => d >= cutoff).map(([, v]) => v);
  if (s.length <= points) return s;
  const step = (s.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, i) => s[Math.round(i * step)]);
}

// ── Overview ───────────────────────────────────────────────────────────────────

/**
 * The whole board in one response: headline indices, other asset classes and the
 * broad-market breadth. (Sectors are built stock by stock — see sectorService.) One NSE call plus one Yahoo year per series, all in
 * parallel.
 */
async function getOverview({ fresh = false } = {}) {
  const yahooSyms = new Set([
    ...HEADLINE.filter(h => h.yahoo).map(h => h.yahoo),
    ...ASSETS.filter(a => a.yahoo).map(a => a.yahoo),
    'GC=F', 'SI=F', 'USDINR=X',
  ]);

  const [board, ...yearSeries] = await Promise.all([
    _indexBoard(fresh),
    ...[...yahooSyms].map(s => _closes(s, 400, fresh)),
  ]);
  const yahoo = Object.fromEntries([...yahooSyms].map((s, i) => [s, yearSeries[i]]));
  const nse   = (name) => board?.byName?.[name.toUpperCase()] || null;

  const headline = HEADLINE.map(h => {
    const n = h.nse ? nse(h.nse) : null;
    const y = h.yahoo ? yahoo[h.yahoo] : null;
    // NSE's own figures win where it lists the index — they are the exchange's numbers;
    // Yahoo's series fills only what NSE does not cover.
    const r = n || (y ? _returnsFrom(y) : null);
    if (!r || r.last == null) return null;
    return {
      key: h.key, label: h.label, fear: !!h.fear, symbol: _viewSymbol(h),
      last: r.last, chg1d: r.chg1d, chg1w: r.chg1w, chg1m: r.chg1m, chg1y: r.chg1y,
      pe: n?.pe ?? null, pb: n?.pb ?? null,
      yearHigh: n?.yearHigh ?? null, yearLow: n?.yearLow ?? null,
      spark: y ? _spark(y) : [],
    };
  }).filter(Boolean);

  const assets = ASSETS.map(a => {
    let series = null;
    if (a.kind === 'metal') series = _metalSeries(a.metal === 'gold' ? yahoo['GC=F'] : yahoo['SI=F'], yahoo['USDINR=X'], a.metal, a.grams);
    if (a.kind === 'yahoo') series = yahoo[a.yahoo];

    const r = a.kind === 'nse' ? nse(a.nse) : (series ? _returnsFrom(series) : null);
    if (!r || r.last == null) return null;
    return {
      // `currency: null` marks an index level, which is points, not rupees.
      key: a.key, label: a.label, unit: a.unit, currency: a.currency === undefined ? 'INR' : a.currency, symbol: _viewSymbol(a),
      last: r.last, chg1d: r.chg1d, chg1w: r.chg1w, chg1m: r.chg1m, chg1y: r.chg1y,
      spark: series ? _spark(series) : [],
    };
  }).filter(Boolean);

  return {
    asof:    board?.asof || null,
    breadth: board?.breadth || null,
    headline,
    assets,
    // Which sections came back empty because a SOURCE failed, as opposed to having no
    // data — the page names the missing source rather than drawing a blank.
    unavailable: [!board && 'nse', !Object.values(yahoo).some(s => Object.keys(s).length) && 'yahoo'].filter(Boolean),
  };
}

/**
 * An NSE index's own figures off the board — valuation (P/E, P/B, dividend yield) and
 * breadth among its members — plus its constituent list file. Null for anything else.
 */
async function getIndexStats(symbol, { fresh = false } = {}) {
  const def = NSE_INDICES[symbol];
  if (!def) return null;
  const n = (await _indexBoard(fresh))?.byName?.[def.nse] || null;
  return {
    nseName: def.nse,
    list: def.list,
    pe: n?.pe || null, pb: n?.pb || null, dy: n?.dy || null,
    breadth: n ? { advances: n.advances, declines: n.declines, unchanged: n.unchanged } : null,
  };
}

// ── 3. Flows ──────────────────────────────────────────────────────────────────

/** `__NEXT_DATA__` off a moneycontrol page → its `fiiDiiData` rows, or []. */
function _nextDataRows(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return [];
  try {
    const rows = JSON.parse(m[1])?.props?.pageProps?.FiiDiiData?.fiiDiiData;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/** Today's provisional FII/DII cash figures, with buy and sell — NSE's own. */
async function _fetchNseCash() {
  const rows = await _get('https://www.nseindia.com/api/fiidiiTradeReact');
  if (!Array.isArray(rows)) return [];
  const byDate = {};
  for (const r of rows) {
    const date = _nseDate(r.date);
    if (!date) continue;
    const who = /FII|FPI/i.test(r.category) ? 'fii' : /DII/i.test(r.category) ? 'dii' : null;
    if (!who) continue;
    byDate[date] ??= { date };
    byDate[date][who] = { buy: parseNumber(r.buyValue), sell: parseNumber(r.sellValue), net: parseNumber(r.netValue) };
  }
  return Object.values(byDate);
}

/**
 * The last ~30 sessions of net FII/DII cash and FII derivatives — the history NSE does
 * not offer. Only NETS here; the buy/sell split of the same day comes from NSE and is
 * merged, never overwritten (see `_save`).
 */
async function _fetchCashHistory() {
  const html = await _get('https://www.moneycontrol.com/markets/fii-dii-data/', { as: 'text', timeoutMs: 12000 });
  return _nextDataRows(html).map(r => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    fii: { net: parseNumber(r.fiiCM) },
    dii: { net: parseNumber(r.diiCM) },
    fiiDeriv: { idxFut: parseNumber(r.fiiIdxFut), idxOpt: parseNumber(r.fiiIdxOpt), stkFut: parseNumber(r.fiiStkFut), stkOpt: parseNumber(r.fiiStkOpt) },
  })).filter(r => r.date);
}

/** Domestic mutual funds' daily net equity / debt investment, as reported to SEBI. */
async function _fetchMfFlows() {
  const html = await _get('https://www.moneycontrol.com/markets/fii-dii-data/mf-sebi/', { as: 'text', timeoutMs: 12000 });
  return _nextDataRows(html).map(r => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    mf: { equity: parseNumber(r.netEquity), debt: parseNumber(r.netDebt) },
  })).filter(r => r.date);
}

const OI_COLUMNS = [
  'idxFutLong', 'idxFutShort', 'stkFutLong', 'stkFutShort',
  'idxCallLong', 'idxPutLong', 'idxCallShort', 'idxPutShort',
];

/**
 * NSE's participant-wise open interest for one day — the daily file that splits the
 * derivatives market into Client / DII / FII / Pro. Published each evening as a CSV in
 * the exchange's archive; a 404 is a holiday.
 */
async function _fetchParticipantOI(dayMs) {
  const d = new Date(dayMs);
  const stamp = String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + d.getUTCFullYear();
  const csv = await _get(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${stamp}.csv`, { as: 'text' });
  if (!csv || !/Client Type/i.test(csv)) return null;

  const positioning = {};
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(',').map(c => c.trim());
    const who = { Client: 'client', DII: 'dii', FII: 'fii', Pro: 'pro' }[cells[0]];
    if (!who) continue;
    // Columns 1-8 are futures then index options, in NSE's fixed order.
    positioning[who] = Object.fromEntries(OI_COLUMNS.map((c, i) => [c, parseNumber(cells[i + 1])]));
  }
  return Object.keys(positioning).length ? { date: toDateStr(dayMs), positioning } : null;
}

/** Flatten a partial day into `$set` paths, so one source never erases another's fields. */
function _setPaths(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'date' || v == null) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && !Array.isArray(v)) _setPaths(v, path, out);
    else out[path] = v;
  }
  return out;
}

async function _save(days) {
  const ops = days
    .map(d => ({ date: d.date, set: _setPaths(d) }))
    .filter(d => d.date && Object.keys(d.set).length)
    .map(d => ({ updateOne: { filter: { date: d.date }, update: { $set: d.set }, upsert: true } }));
  if (ops.length) await MarketFlow.bulkWrite(ops, { ordered: false });
  return ops.length;
}

const OI_LOOKBACK_DAYS = 21;
let _refreshing = null;

/**
 * Pull every flow source and fold what came back into `MarketFlow`. Each source is
 * independent — one failing costs its own fields for the day, nothing else. Participant
 * OI is only fetched for days not already stored, so after the first run it is one file
 * a day rather than a fortnight's worth every hour.
 *
 * Concurrent callers share one run.
 */
function refreshFlows() {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const today = todayMs();
    const lookback = [];
    for (let d = today - OI_LOOKBACK_DAYS * DAY_MS; d <= today; d += DAY_MS) {
      const dow = new Date(d).getUTCDay();
      if (dow !== 0 && dow !== 6) lookback.push(d);
    }
    const have = new Set((await MarketFlow.find(
      { date: { $in: lookback.map(toDateStr) }, 'positioning.client': { $exists: true } },
      { date: 1 },
    ).lean()).map(r => r.date));
    const missing = lookback.filter(d => !have.has(toDateStr(d)));

    const [cashHist, nseCash, mf, ...oi] = await Promise.all([
      _fetchCashHistory(), _fetchNseCash(), _fetchMfFlows(),
      ...missing.map(_fetchParticipantOI),
    ]);

    // Order matters only for the cash figures: moneycontrol's NET first, then NSE's
    // buy/sell/net for the same day on top — the exchange's own number wins.
    const saved = await _save([...cashHist, ...mf, ...oi.filter(Boolean), ...nseCash]);
    return { saved, sources: { cashHist: cashHist.length, nseCash: nseCash.length, mf: mf.length, oi: oi.filter(Boolean).length } };
  })().finally(() => { _refreshing = null; });
  return _refreshing;
}

/** Sum of a field over the newest `n` rows that HAVE it (sessions, not calendar days). */
//
// Each window carries the date of its newest session: the sources publish on different
// lags (the SEBI mutual-fund figures trail the exchange's provisional FII/DII numbers by
// several days), so "this week" for one is not the same five sessions as for another.
function _sumLast(rows, pick, n) {
  const vals = [];
  let through = null;
  for (let i = rows.length - 1; i >= 0 && vals.length < n; i--) {
    const v = pick(rows[i]);
    if (v == null) continue;
    through ??= rows[i].date;
    vals.push(v);
  }
  return vals.length ? { total: round(vals.reduce((s, v) => s + v, 0)), sessions: vals.length, through } : null;
}

/** Long share of a participant's index-futures book, in percent. */
const _longShare = (p) => {
  const l = p?.idxFutLong, s = p?.idxFutShort;
  return l != null && s != null && l + s > 0 ? round((l / (l + s)) * 100, 1) : null;
};

/**
 * The flows page: a day-by-day ledger plus the windows people actually ask about
 * ("what did FIIs do this week / this month"). Reads only the cache; the cache is filled
 * on a schedule (index.js). On a brand-new install with nothing stored, the first call
 * waits for one refresh rather than showing an empty page.
 */
let _lastFreshFlows = 0;

async function getFlows(sessions = 60, { fresh = false } = {}) {
  let count = await MarketFlow.estimatedDocumentCount();
  // A refresh pulls the sources now rather than waiting for the hourly job — but waits
  // at most 20s for them, and never more often than the fresh throttle allows.
  if (fresh && count && _stale(_lastFreshFlows, 0, true)) {
    _lastFreshFlows = Date.now();
    await Promise.race([refreshFlows().catch(() => null), new Promise(r => setTimeout(r, 20000))]);
  }
  if (!count) {
    await Promise.race([refreshFlows().catch(() => null), new Promise(r => setTimeout(r, 20000))]);
    count = await MarketFlow.estimatedDocumentCount();
  }

  // Calendar cut-off generous enough to cover `sessions` trading days with holidays.
  const since = toDateStr(todayMs() - Math.ceil(sessions * 1.6) * DAY_MS);
  const rows = (await MarketFlow.find({ date: { $gte: since } }).sort({ date: 1 }).lean())
    .map(({ _id, __v, createdAt, updatedAt, ...r }) => r);

  const fii = r => r.fii?.net, dii = r => r.dii?.net, mfEq = r => r.mf?.equity;
  const windows = (pick) => ({ d1: _sumLast(rows, pick, 1), w1: _sumLast(rows, pick, 5), m1: _sumLast(rows, pick, 21), all: _sumLast(rows, pick, rows.length) });

  const withOi = rows.filter(r => r.positioning?.client);
  const latestOi = withOi[withOi.length - 1] || null;

  return {
    asof: rows.filter(r => r.fii?.net != null).pop()?.date || null,
    latest: rows.filter(r => r.fii?.net != null).pop() || null,
    summary: { fii: windows(fii), dii: windows(dii), mf: windows(mfEq) },
    daily: rows.slice(-sessions).map(r => ({
      date: r.date,
      fii: r.fii?.net ?? null,
      dii: r.dii?.net ?? null,
      mfEquity: r.mf?.equity ?? null,
      mfDebt: r.mf?.debt ?? null,
      fiiIdxFut: r.fiiDeriv?.idxFut ?? null,
      fiiIdxOpt: r.fiiDeriv?.idxOpt ?? null,
    })),
    positioning: latestOi && {
      date: latestOi.date,
      participants: ['client', 'dii', 'fii', 'pro'].map(k => ({
        key: k,
        ...latestOi.positioning[k],
        idxFutNet: latestOi.positioning[k]?.idxFutLong != null
          ? latestOi.positioning[k].idxFutLong - latestOi.positioning[k].idxFutShort : null,
        longShare: _longShare(latestOi.positioning[k]),
      })),
      history: withOi.slice(-30).map(r => ({
        date: r.date,
        client: _longShare(r.positioning.client),
        fii:    _longShare(r.positioning.fii),
        pro:    _longShare(r.positioning.pro),
        dii:    _longShare(r.positioning.dii),
      })),
    },
  };
}

module.exports = {
  getOverview,
  getIndexStats,
  getFlows,
  refreshFlows,
  // Shared with sectorService, which reads the same sources the same way.
  _get,
  _stale,
  _nseDate,
};
