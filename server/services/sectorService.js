/**
 * sectorService — the Nifty 500, stock by stock, grouped into sectors.
 *
 * The first version of the sector map read sixteen NSE sector INDICES and sized them by
 * hand-kept weights. That could not go any deeper: an index has a return but no members
 * you can see, so "which stocks drove Auto down?" had no answer, and the box sizes were
 * a guess that aged. This builds the map from the stocks themselves:
 *
 *  - **The universe** is the Nifty 500 constituent list NSE publishes (with each
 *    company's NSE industry), refreshed daily. NSE's twenty industries are the base
 *    taxonomy; the over-broad ones are split using NSE's OWN sub-index lists (PSU banks,
 *    capital markets, defence, tourism), so the finer sectors are still the exchange's
 *    classification rather than ours.
 *  - **Prices** are a year of daily closes per stock from Yahoo's spark endpoint — 20
 *    symbols a request (its hard limit), 25 requests for the lot, memoised.
 *  - **Size** is each company's live market cap (Yahoo's quote endpoint, 250 symbols a
 *    request). That endpoint wants a session cookie + "crumb"; when it cannot be had the
 *    map falls back to EQUAL boxes and says so, rather than inventing a weight.
 *
 * A sector's return is the CAP-WEIGHTED return of its members as a buy-and-hold book:
 * each stock's value at the start of the window is its cap today divided by (1 + its
 * return), and the sector return is total value now over total value then. Averaging the
 * members' percentages would let a ₹2,000-crore smallcap move a sector as much as a
 * ₹10-lakh-crore bank.
 *
 * The market these sectors rotate against is the same 500 computed the same way, so a
 * sector's "against the market" can never be skewed by a difference in methodology.
 */

const { YF_HEADERS } = require('../utils/constants');
const { _get, _stale } = require('./indiaMarketService');
const { round, windowReturns, toSorted } = require('../utils/series');
const { midnight } = require('../utils/helpers');
const { fetchYahooAuthed } = require('./marketDataService');

// ── Taxonomy ───────────────────────────────────────────────────────────────────

/** NSE industry → our sector key + label. Order is the fallback ranking only. */
const INDUSTRY = {
  'Financial Services':               { key: 'financials',  label: 'Lenders & NBFCs' },
  'Information Technology':           { key: 'it',          label: 'IT' },
  'Oil Gas & Consumable Fuels':       { key: 'oilgas',      label: 'Oil, gas & fuels' },
  'Automobile and Auto Components':   { key: 'auto',        label: 'Auto & components' },
  'Fast Moving Consumer Goods':       { key: 'fmcg',        label: 'FMCG' },
  'Healthcare':                       { key: 'health',      label: 'Healthcare' },
  'Capital Goods':                    { key: 'capgoods',    label: 'Capital goods' },
  'Power':                            { key: 'power',       label: 'Power' },
  'Metals & Mining':                  { key: 'metals',      label: 'Metals & mining' },
  'Telecommunication':                { key: 'telecom',     label: 'Telecom' },
  'Consumer Services':                { key: 'consumersvc', label: 'Consumer services' },
  'Consumer Durables':                { key: 'durables',    label: 'Consumer durables' },
  'Chemicals':                        { key: 'chem',        label: 'Chemicals' },
  'Construction':                     { key: 'construction',label: 'Construction' },
  'Construction Materials':           { key: 'cement',      label: 'Cement & materials' },
  'Realty':                           { key: 'realty',      label: 'Realty' },
  'Services':                         { key: 'services',    label: 'Services & logistics' },
  'Textiles':                         { key: 'textiles',    label: 'Textiles' },
  'Media Entertainment & Publication':{ key: 'media',       label: 'Media' },
  'Diversified':                      { key: 'diversified', label: 'Conglomerates' },
};

/**
 * The splits. Each is a membership test applied BEFORE the industry fallback, in this
 * order — a PSU bank is a bank before it is "financial services". Lists are NSE's own
 * sub-index constituents; the name tests cover what no list does (every bank, not just
 * the ten in Nifty Private Bank; every insurer).
 */
const SPLITS = [
  { key: 'psubank',  label: 'PSU banks',       list: 'ind_niftypsubanklist' },
  { key: 'pvtbank',  label: 'Private banks',   industry: 'Financial Services', name: /\bbank\b/i },
  { key: 'capmkt',   label: 'Capital markets', list: 'ind_niftyCapitalMarkets_list', industry: 'Financial Services' },
  { key: 'insurance',label: 'Insurance',       industry: 'Financial Services', name: /insurance|assurance|\blife\b/i },
  { key: 'defence',  label: 'Defence',         list: 'ind_niftyindiadefence_list' },
  { key: 'tourism',  label: 'Travel & hotels', list: 'ind_niftyindiatourism_list' },
];

const LIST_URL = (f) => `https://nsearchives.nseindia.com/content/indices/${f}.csv`;

/** Minimal CSV: quoted fields, commas inside quotes. NSE's lists are simple but not unquoted. */
function _csv(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map(s => s.trim()));
  }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** "Bajaj Auto Ltd." → "Bajaj Auto". The suffix is on every row and says nothing. */
const _shortName = (n) => String(n || '').replace(/\s+(Ltd\.?|Limited)$/i, '').trim();

const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000;
let _universe = null;   // { at, stocks: [{ symbol, name, industry, sector, label }] }

async function _getUniverse() {
  if (_universe && Date.now() - _universe.at < UNIVERSE_TTL_MS) return _universe.stocks;

  const files = ['ind_nifty500list', ...SPLITS.filter(s => s.list).map(s => s.list)];
  const texts = await Promise.all(files.map(f => _get(LIST_URL(f), { as: 'text', timeoutMs: 10000 })));
  const base = _csv(texts[0]);
  if (base.length < 100) return _universe?.stocks || null;   // a failed or truncated list — keep yesterday's

  const lists = {};
  files.slice(1).forEach((f, i) => { lists[f] = new Set(_csv(texts[i + 1]).map(r => r.Symbol)); });

  const stocks = base.filter(r => r.Symbol && r.Series === 'EQ').map(r => {
    const split = SPLITS.find(s =>
      (!s.list || lists[s.list]?.has(r.Symbol)) &&
      (!s.industry || s.industry === r.Industry) &&
      (!s.name || s.name.test(r['Company Name'])) &&
      // A rule with a list must actually have one — a list that failed to download
      // must not turn "member of nothing" into "member of everything".
      (!s.list || lists[s.list]?.size));
    const ind = INDUSTRY[r.Industry] || { key: 'other', label: r.Industry || 'Other' };
    return {
      symbol:   r.Symbol,
      name:     _shortName(r['Company Name']),
      industry: r.Industry,
      sector:   split ? split.key : ind.key,
      label:    split ? split.label : ind.label,
    };
  });

  _universe = { at: Date.now(), stocks };
  return stocks;
}

// ── Prices and caps (Yahoo) ───────────────────────────────────────────────────

const yahooSym = (s) => `${s}.NS`;

/** Run `fn` over `items` with at most `n` in flight. */
async function _pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const SPARK_BATCH = 20;   // Yahoo rejects more: "Number of symbols needs to be less than or equal to 20"

/** One spark batch → `{ [symbol]: { [dayMs]: close } }`, with one retry. */
async function _sparkBatch(symbols) {
  const url = `https://query1.finance.yahoo.com/v8/finance/spark`
            + `?symbols=${encodeURIComponent(symbols.map(yahooSym).join(','))}&range=1y&interval=1d`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      const out = {};
      for (const sym of symbols) {
        const r = data?.[yahooSym(sym)];
        if (!r?.timestamp?.length) continue;
        const series = {};
        r.timestamp.forEach((ts, i) => {
          const c = r.close?.[i];
          // Bars are stamped at the session open (09:15 IST); truncating to the UTC day
          // keeps them on their own calendar date.
          if (c != null) series[midnight(ts * 1000)] = c;
        });
        out[sym] = series;
      }
      return out;
    } catch { /* stalled — retry on a fresh connection */ }
  }
  return {};
}

/*
 * Market caps come from Yahoo's quote endpoint, which needs a session (cookie + crumb);
 * `marketDataService.fetchYahooAuthed` owns that, as the one door to Yahoo.
 */
const CAPS_TTL_MS = 6 * 60 * 60 * 1000;
let _caps = null;   // { at, bySymbol: { SYM: capInr }, ratios: { SYM: { pe, pb } }, floats: { SYM: fraction } }

/**
 * Market cap per symbol, in rupees. Caps move slowly relative to what they are used for
 * here (box AREA), so they are cached for hours; the returns on the map are always live.
 */
async function _getCaps(symbols) {
  if (_caps && Date.now() - _caps.at < CAPS_TTL_MS) return _caps.bySymbol;

  const chunks = [];
  for (let i = 0; i < symbols.length; i += 250) chunks.push(symbols.slice(i, i + 250));

  const fetchChunk = async (chunk) => {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote`
              + `?symbols=${encodeURIComponent(chunk.map(yahooSym).join(','))}`
              + `&fields=marketCap,trailingPE,priceToBook,sharesOutstanding,floatShares`;
    return (await fetchYahooAuthed(url))?.quoteResponse?.result || null;
  };

  const results = await Promise.all(chunks.map(c => fetchChunk(c)));
  const bySymbol = {};
  const ratios = {};
  const floats = {};
  for (const r of results.flat()) {
    if (!r?.symbol || !(r.marketCap > 0)) continue;
    const sym = r.symbol.replace(/\.NS$/, '');
    bySymbol[sym] = r.marketCap;
    // Valuation ratios ride along for free on the same call — the stock page compares a
    // company's P/E with its sector's median, which needs every peer's.
    ratios[sym] = { pe: r.trailingPE > 0 ? r.trailingPE : null, pb: r.priceToBook > 0 ? r.priceToBook : null };
    // Free-float fraction, for index weights (NSE weighs by float, not full cap).
    if (r.floatShares > 0 && r.sharesOutstanding > 0) floats[sym] = Math.min(1, r.floatShares / r.sharesOutstanding);
  }
  // Half the universe or better, or it is not a sizing — keep the last good one.
  if (Object.keys(bySymbol).length < symbols.length / 2) return _caps?.bySymbol || null;
  _caps = { at: Date.now(), bySymbol, ratios, floats };
  return bySymbol;
}

const QUOTES_TTL_MS = 10 * 60 * 1000;
let _quotes = null;   // { at, bySymbol: { SYM: { last, chg1d, chg1w, chg1m, chg1y } } }

async function _getQuotes(symbols, fresh = false) {
  if (_quotes && !_stale(_quotes.at, QUOTES_TTL_MS, fresh)) return _quotes.bySymbol;

  const batches = [];
  for (let i = 0; i < symbols.length; i += SPARK_BATCH) batches.push(symbols.slice(i, i + SPARK_BATCH));
  const results = await _pool(batches, 5, _sparkBatch);

  const bySymbol = { ...(_quotes?.bySymbol || {}) };   // a batch that failed keeps its last quotes
  let updated = 0;
  for (const res of results) {
    for (const [sym, series] of Object.entries(res)) {
      const w = windowReturns(toSorted(series), ['1w', '1m', '1y']);
      if (w.last == null) continue;
      bySymbol[sym] = { last: w.last, chg1d: w['1d'], chg1w: w['1w'], chg1m: w['1m'], chg1y: w['1y'] };
      updated++;
    }
  }
  if (!updated) return _quotes?.bySymbol || null;
  _quotes = { at: Date.now(), bySymbol };
  return bySymbol;
}

// ── Aggregation ────────────────────────────────────────────────────────────────

const FIELDS = ['chg1d', 'chg1w', 'chg1m', 'chg1y'];

/**
 * The cap-weighted, buy-and-hold return of a set of stocks over each window. A stock
 * with no return for a window (listed inside it) sits that window out — its cap is not
 * counted in either the start or the end value.
 */
function _weighted(stocks) {
  const out = {};
  for (const f of FIELDS) {
    let now = 0, then = 0;
    for (const s of stocks) {
      const r = s[f];
      if (r == null || !(s.weight > 0) || r <= -100) continue;
      now  += s.weight;
      then += s.weight / (1 + r / 100);
    }
    out[f] = then > 0 ? (now / then - 1) * 100 : null;
  }
  return out;
}


/**
 * The whole map in one response: every sector with its size and returns, and every
 * stock with its sector, cap and returns. The client draws both levels — and works out
 * each sector's leaders and laggards for whichever window is showing — from this one
 * payload, so drilling into a sector costs no round trip.
 */
async function getSectors({ fresh = false } = {}) {
  const universe = await _getUniverse();
  if (!universe?.length) return { sectors: [], stocks: [], sized: null, unavailable: ['nse'] };

  const symbols = universe.map(s => s.symbol);
  // Caps are not refreshed on demand: they size boxes, and move too little in an hour
  // to be worth a crumb-gated call per click.
  const [quotes, caps] = await Promise.all([_getQuotes(symbols, fresh), _getCaps(symbols)]);
  if (!quotes) return { sectors: [], stocks: [], sized: null, unavailable: ['yahoo'] };

  const sized = caps ? 'cap' : 'equal';
  const stocks = universe
    .filter(u => quotes[u.symbol])
    .map(u => {
      const q = quotes[u.symbol];
      const cap = caps?.[u.symbol] ?? null;
      return {
        symbol: u.symbol, name: u.name, sector: u.sector,
        cap,
        // Equal sizing when caps are unavailable; a stock whose cap alone is missing gets
        // the sector's smallest box rather than vanishing from it.
        weight: sized === 'equal' ? 1 : cap,
        last: round(q.last),
        chg1d: round(q.chg1d), chg1w: round(q.chg1w), chg1m: round(q.chg1m), chg1y: round(q.chg1y),
      };
    });

  if (sized === 'cap') {
    const bySector = {};
    for (const s of stocks) if (s.weight > 0) bySector[s.sector] = Math.min(bySector[s.sector] ?? Infinity, s.weight);
    for (const s of stocks) if (!(s.weight > 0)) s.weight = bySector[s.sector] ?? 0;
  }

  const groups = {};
  for (const s of stocks) (groups[s.sector] ??= []).push(s);
  const labelOf = Object.fromEntries(universe.map(u => [u.sector, u.label]));

  const sectors = Object.entries(groups).map(([key, members]) => {
    const r = _weighted(members);
    return {
      key, label: labelOf[key], count: members.length,
      weight: members.reduce((sum, m) => sum + (m.weight || 0), 0),
      cap: sized === 'cap' ? members.reduce((sum, m) => sum + (m.cap || 0), 0) : null,
      chg1d: round(r.chg1d), chg1w: round(r.chg1w), chg1m: round(r.chg1m), chg1y: round(r.chg1y),
    };
  }).sort((a, b) => b.weight - a.weight);

  const m = _weighted(stocks);
  return {
    sized,
    market: { label: 'Nifty 500', chg1d: round(m.chg1d), chg1w: round(m.chg1w), chg1m: round(m.chg1m), chg1y: round(m.chg1y) },
    sectors,
    stocks,
    unavailable: [],
  };
}

/**
 * A stock's sector and its peers, for the company page — from the same cached universe,
 * quotes and caps the sector map uses, so the two pages cannot disagree about who is in
 * which sector or how they did. Null when the symbol is not in the Nifty 500.
 */
async function getPeers(symbol) {
  const data = await getSectors();
  const self = data.stocks.find(s => s.symbol === symbol);
  if (!self) return null;
  const sector = data.sectors.find(s => s.key === self.sector);
  const ratios = _caps?.ratios || {};
  const peers = data.stocks
    .filter(s => s.sector === self.sector)
    .map(s => ({ ...s, pe: ratios[s.symbol]?.pe ?? null, pb: ratios[s.symbol]?.pb ?? null, self: s.symbol === symbol }))
    .sort((a, b) => (b.cap || 0) - (a.cap || 0));

  const median = (xs) => {
    const v = xs.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  return {
    sector: sector && { key: sector.key, label: sector.label, chg1d: sector.chg1d, chg1w: sector.chg1w, chg1m: sector.chg1m, chg1y: sector.chg1y, cap: sector.cap },
    market: data.market,
    rank: peers.findIndex(p => p.self) + 1,
    medianPe: median(peers.map(p => p.pe)),
    medianPb: median(peers.map(p => p.pb)),
    peers,
  };
}

const _lists = new Map();   // list file → { at, symbols }

/** An NSE constituent list's symbols, cached for a day (yesterday's kept on failure). */
async function _listSymbols(file) {
  const hit = _lists.get(file);
  if (hit && Date.now() - hit.at < UNIVERSE_TTL_MS) return hit.symbols;
  const rows = _csv(await _get(LIST_URL(file), { as: 'text', timeoutMs: 10000 }));
  const symbols = rows.filter(r => r.Symbol).map(r => r.Symbol);
  if (!symbols.length) return hit?.symbols || null;
  _lists.set(file, { at: Date.now(), symbols });
  return symbols;
}

/**
 * What an index is made of: every member with its weight, sector and returns, and the
 * index's split by sector — from the same quotes and caps as the sector map. Weights are
 * by FREE-FLOAT cap, as NSE weighs (full cap where a float is missing), so they track the
 * official ones closely; `sized` says 'float', 'cap' or 'equal' when caps are missing.
 */
async function getComposition(listFile) {
  const [symbols, data] = await Promise.all([_listSymbols(listFile), getSectors()]);
  if (!symbols?.length || !data.stocks?.length) return null;

  const bySym = new Map(data.stocks.map(st => [st.symbol, st]));
  const members = symbols.map(sym => bySym.get(sym)).filter(Boolean);
  if (!members.length) return null;

  const floats = _caps?.floats || {};
  const sized = data.sized === 'cap' && members.some(m => floats[m.symbol]) ? 'float' : data.sized;
  const w = (m) => (m.weight || 0) * (sized === 'float' ? (floats[m.symbol] ?? 1) : 1);
  const total = members.reduce((a, m) => a + w(m), 0);
  const labelOf = Object.fromEntries(data.sectors.map(sec => [sec.key, sec.label]));
  const holdings = members.map(m => {
    const weight = total ? (w(m) / total) * 100 : null;
    return {
      symbol: m.symbol, name: m.name, sector: labelOf[m.sector] || m.sector,
      weight: round(weight, 2),
      chg1d: m.chg1d, chg1m: m.chg1m, chg1y: m.chg1y,
      // Points of the index's day move this member accounts for.
      contrib1d: weight != null && m.chg1d != null ? round((weight * m.chg1d) / 100, 3) : null,
    };
  }).sort((a, b) => (b.weight || 0) - (a.weight || 0));

  const groups = {};
  for (const m of members) (groups[m.sector] ??= []).push({ ...m, weight: w(m) });
  const sectors = Object.entries(groups).map(([key, ms]) => {
    const r = _weighted(ms);
    return {
      name: labelOf[key] || key, count: ms.length,
      weight: round((ms.reduce((a, m) => a + m.weight, 0) / total) * 100, 2),
      chg1d: round(r.chg1d), chg1y: round(r.chg1y),
    };
  }).sort((a, b) => b.weight - a.weight);

  return {
    sized,
    count: symbols.length,
    covered: members.length,
    top10: round(holdings.slice(0, 10).reduce((a, h) => a + (h.weight || 0), 0), 1),
    holdings,
    sectors,
  };
}

/**
 * Nifty 500 companies matching a query, as search results — matched LOCALLY against the
 * cached constituent list (no quotes, no network once the list is loaded). Yahoo's
 * symbol search returns ten rows across every exchange on earth, so for an Indian
 * company it often surfaces the BSE twin and misses the NSE listing; this guarantees the
 * NSE row for anything in the index. Every typed token must start a word of the name or
 * the symbol ("tata mot" → Tata Motors).
 */
async function searchUniverse(q, limit = 8) {
  const tokens = String(q || '').toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  if (!tokens.length) return [];
  const universe = await _getUniverse().catch(() => null);
  if (!universe) return [];
  return universe
    .filter(u => {
      const words = `${u.name} ${u.symbol}`.toLowerCase().split(/[^a-z0-9&]+/);
      return tokens.every(t => words.some(w => w.startsWith(t)));
    })
    .slice(0, limit)
    .map(u => ({ symbol: `${u.symbol}.NS`, name: u.name, type: 'stock', exchange: 'NSE', currency: 'INR', sector: u.label }));
}

module.exports = { getSectors, getPeers, getComposition, searchUniverse, _csv, _weighted };
