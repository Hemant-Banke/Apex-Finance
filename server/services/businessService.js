const CompanyReport = require('../models/CompanyReport');
const screenerService = require('./screenerService');
const llm = require('../lib/llmService');
const { BROWSER_HEADERS } = require('../utils/constants');

/**
 * Where a company's money comes from — segments, geography, exports and imports, inputs,
 * customers and suppliers — read from its own annual reports.
 *
 * No feed carries this for Indian companies; it lives only in the filed report (the
 * segment note, the "foreign exchange earnings and outgo" disclosure, BRSR). So the last
 * few reports are downloaded (BSE PDFs via Screener's links; SEC 10-Ks for US listings),
 * cut down to the paragraphs that matter, and structured by the LLM. Each report is read
 * ONCE and kept in `companyreports` for good — a filed report does not change.
 */

const REPORTS = 3;                      // the latest N reports; each also prints the year before
const EXCERPT_BUDGET = 110_000;         // chars sent to the model per report
const MEMO_MS = 12 * 3600 * 1000;
const SEC_HEADERS = { 'User-Agent': process.env.SEC_USER_AGENT || 'Apex portfolio research admin@apex.local' };

// Where the answers live in a report, most important first. `after`/`before` are lines of context.
const RULES = [
  { re: /segment (information|reporting|revenue)|operating segments?|reportable segments?/i, after: 70, before: 3, max: 4 },
  { re: /geograph/i, after: 25, before: 3, max: 5 },
  { re: /foreign exchange earnings and outgo|earnings in foreign (exchange|currency)|expenditure in foreign currency/i, after: 18, before: 2, max: 3 },
  { re: /value of imports|c\.?i\.?f\.? value/i, after: 14, before: 2, max: 3 },
  { re: /contribution of exports|export(s)? (revenue|turnover|sales)|net sales by (geograph|region|country)/i, after: 10, before: 2, max: 4 },
  { re: /major customers?|single customer|significant customers?|largest customers?|top (5|five|10|ten) customers|more than 10%/i, after: 10, before: 3, max: 6 },
  { re: /types? of customers|markets served by the entity|products\/services sold by the entity|details of business activities/i, after: 16, before: 1, max: 3 },
  { re: /raw materials?|key inputs?|sole[- ]source|single[- ]source|suppliers?\b|vendors?\b|sourced from|procure/i, after: 6, before: 2, max: 14 },
];

const UNIT = { rupees: 1, thousands: 1e3, lakhs: 1e5, crore: 1e7, millions: 1e6, billions: 1e9 };

/** The paragraphs of a report worth reading, within the budget, highest-priority rules first. */
function excerpts(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const taken = new Set();
  let size = 0;
  for (const rule of RULES) {
    let hits = 0;
    for (let i = 0; i < lines.length && hits < rule.max; i++) {
      if (!rule.re.test(lines[i])) continue;
      hits++;
      for (let j = Math.max(0, i - rule.before); j <= Math.min(lines.length - 1, i + rule.after); j++) {
        if (taken.has(j)) continue;
        if (size + lines[j].length > EXCERPT_BUDGET) break;
        taken.add(j);
        size += lines[j].length + 1;
      }
    }
  }
  // Back in document order, with a marker wherever text was skipped.
  const idx = [...taken].sort((a, b) => a - b);
  return idx.map((j, k) => (k && idx[k - 1] !== j - 1 ? `[…]\n${lines[j]}` : lines[j])).join('\n');
}

async function _download(url, headers, timeout = 90_000) {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!resp.ok) throw new Error(`${resp.status} for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function _pdfText(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return (await parser.getText()).text || ''; } finally { await parser.destroy().catch(() => {}); }
}

/** A 10-K's HTML as lines of text: block elements become line breaks, everything else is stripped. */
function _htmlText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

// ── Where the reports are ───────────────────────────────────────────────────

async function _bseReports(symbol) {
  const company = await screenerService.getCompany(symbol);
  return (company?.annualReports || []).slice(0, REPORTS).map(r => ({ ...r, source: 'bse' }));
}

let _tickers = null;
async function _cik(ticker) {
  if (!_tickers) {
    const json = JSON.parse((await _download('https://www.sec.gov/files/company_tickers.json', SEC_HEADERS)).toString());
    _tickers = new Map(Object.values(json).map(r => [r.ticker.toUpperCase(), r.cik_str]));
  }
  return _tickers.get(ticker.toUpperCase().replace('.', '-')) || null;
}

async function _secReports(symbol) {
  const cik = await _cik(symbol);
  if (!cik) return [];
  const pad = String(cik).padStart(10, '0');
  const sub = JSON.parse((await _download(`https://data.sec.gov/submissions/CIK${pad}.json`, SEC_HEADERS)).toString());
  const r = sub.filings?.recent || {};
  const out = [];
  for (let i = 0; i < (r.form || []).length && out.length < REPORTS; i++) {
    if (r.form[i] !== '10-K') continue;
    out.push({
      source: 'sec',
      year: +String(r.reportDate[i]).slice(0, 4),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`,
    });
  }
  return out;
}

// ── One report, read once ───────────────────────────────────────────────────

async function _readReport(symbol, name, report) {
  const cached = await CompanyReport.findOne({ url: report.url }).lean();
  if (cached?.extract) return { ...report, extract: cached.extract };

  const raw = report.source === 'sec'
    ? _htmlText((await _download(report.url, SEC_HEADERS)).toString())
    : await _pdfText(await _download(report.url, { ...BROWSER_HEADERS, Referer: 'https://www.bseindia.com/' }));
  const text = excerpts(raw);
  // A scanned report has no text layer; there is nothing to read.
  if (text.length < 2000) return null;

  const extract = await llm.extractBusinessProfile(text, { company: name, year: report.year });
  if (!extract) return null;
  await CompanyReport.updateOne({ url: report.url },
    { $set: { symbol, source: report.source, year: report.year, extract } }, { upsert: true });
  return { ...report, extract };
}

// ── Several years into one picture ──────────────────────────────────────────

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const keyOf = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const yearBefore = (iso) => (iso ? `${+iso.slice(0, 4) - 1}${iso.slice(4)}` : null);

/** Rows that each report states for its year AND the year before, merged by name; a newer report wins. */
function _byYear(reads, pick, nameField, scale) {
  const rows = new Map();
  for (const { extract: x } of [...reads].reverse()) {         // oldest first, so newer overwrite
    const f = scale(x);
    for (const r of pick(x) || []) {
      const k = keyOf(r[nameField]);
      if (!k) continue;
      const row = rows.get(k) || { name: r[nameField], revenue: {}, result: {} };
      row.name = r[nameField];
      const prev = yearBefore(x.fiscalYearEnd);
      if (num(r.prevRevenue) != null && prev && row.revenue[prev] == null) row.revenue[prev] = r.prevRevenue * f;
      if (num(r.revenue) != null) row.revenue[x.fiscalYearEnd] = r.revenue * f;
      if (num(r.prevResult) != null && prev && row.result[prev] == null) row.result[prev] = r.prevResult * f;
      if (num(r.result) != null) row.result[x.fiscalYearEnd] = r.result * f;
      rows.set(k, row);
    }
  }
  // A line renamed between reports ("Overseas" → "Rest of world") prints the same figure
  // for a year both cover: fold the older name into the newer.
  const list = [...rows.values()].filter(r => Object.keys(r.revenue).length);
  const same = (a, b) => Object.keys(a.revenue).some(y => b.revenue[y] != null
    && Math.abs(a.revenue[y] - b.revenue[y]) <= 0.005 * Math.max(Math.abs(a.revenue[y]), 1));
  const lastYear = (r) => Object.keys(r.revenue).sort().at(-1);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!list[i] || !list[j] || !same(list[i], list[j])) continue;
      const [keep, drop] = lastYear(list[i]) >= lastYear(list[j]) ? [i, j] : [j, i];
      list[keep].revenue = { ...list[drop].revenue, ...list[keep].revenue };
      list[keep].result  = { ...list[drop].result, ...list[keep].result };
      list[drop] = null;
    }
  }
  // A line the latest report no longer prints is history, not a part of today's business.
  const latest = reads[0]?.extract?.fiscalYearEnd;
  return list
    .filter(r => r && (r.revenue[latest] != null || r.revenue[yearBefore(latest)] != null))
    .sort((a, b) => (b.revenue[latest] ?? 0) - (a.revenue[latest] ?? 0));
}

/** Segments, unless they are only regions again (Apple reports by geography) — then product lines. */
function _business(segments, geography, products) {
  const geo = new Set(geography.map(g => keyOf(g.name)));
  const regional = segments.length && segments.filter(s => geo.has(keyOf(s.name))).length >= segments.length / 2;
  if (regional || !segments.length) return products.length ? { by: 'product', rows: products } : { by: 'segment', rows: regional ? [] : segments };
  return { by: 'segment', rows: segments };
}

function _combine(reads, source) {
  const home = source === 'bse';
  const target = home ? UNIT.crore : UNIT.millions;
  const scale = (x) => (UNIT[x.unit] || target) / target;
  const latest = reads[0].extract;

  const years = new Set();
  for (const { extract: x } of reads) {
    if (x.fiscalYearEnd) years.add(x.fiscalYearEnd);
    if (x.fiscalYearEnd) years.add(yearBefore(x.fiscalYearEnd));
  }

  // Trade per year: each report's current year, plus its previous-year column where nothing newer said it.
  const trade = {};
  for (const { extract: x } of [...reads].reverse()) {
    const t = x.trade || {}, f = scale(t.unit ? t : x), y = x.fiscalYearEnd, p = yearBefore(y);
    if (!y) continue;
    const prev = trade[p] || {};
    trade[p] = {
      ...prev,
      forexEarnings: prev.forexEarnings ?? (num(t.prevForexEarnings) != null ? t.prevForexEarnings * f : null),
      forexOutgo:    prev.forexOutgo    ?? (num(t.prevForexOutgo) != null ? t.prevForexOutgo * f : null),
      importsCif:    prev.importsCif    ?? (num(t.prevImportsCif) != null ? t.prevImportsCif * f : null),
    };
    trade[y] = {
      exportShare:   num(t.exportShare),
      forexEarnings: num(t.forexEarnings) != null ? t.forexEarnings * f : null,
      forexOutgo:    num(t.forexOutgo) != null ? t.forexOutgo * f : null,
      importsCif:    num(t.importsCif) != null ? t.importsCif * f : null,
      imports:       (t.imports || []).filter(i => num(i.value) != null).map(i => ({ item: i.item, value: i.value * f })),
    };
  }
  const tradeRows = Object.entries(trade)
    .map(([date, t]) => ({ date, ...t }))
    .filter(t => t.forexEarnings != null || t.forexOutgo != null || t.importsCif != null || t.exportShare != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    available: true,
    source,
    unit: home ? 'crore' : 'million',
    currency: latest.currency || (home ? 'INR' : 'USD'),
    basis: latest.basis || null,
    years: [...years].filter(Boolean).sort(),
    reports: reads.map(r => ({ year: r.year, url: r.url, fiscalYearEnd: r.extract.fiscalYearEnd })),
    business: _business(
      _byYear(reads, x => x.segments, 'name', scale),
      _byYear(reads, x => x.geography, 'region', scale),
      _byYear(reads, x => x.products, 'name', scale),
    ),
    geography: _byYear(reads, x => x.geography, 'region', scale),
    trade: tradeRows,
    // Lines with only a share (BRSR's "products/services sold"), when no revenue was printed.
    products: (latest.products || []).filter(p => p?.name && num(p.share) != null).map(p => ({ name: p.name, share: p.share })),
    materials: (latest.materials || []).filter(m => m?.name),
    customers: latest.customers || null,
    suppliers: latest.suppliers || null,
    highlights: (latest.highlights || []).filter(Boolean).slice(0, 4),
  };
}

const _memo = new Map();
const _inflight = new Map();

/**
 * The business profile of an NSE company (or, with `global`, a US-listed one).
 * `{ available: false, reason }` when there is nothing to read or nothing could be read.
 */
async function getBusiness(symbol, { global = false } = {}) {
  const key = `${global ? 'g' : 'n'}:${symbol}`;
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.data;
  if (_inflight.has(key)) return _inflight.get(key);

  const job = (async () => {
    if (!llm.isLLMAvailable()) return { available: false, reason: 'unavailable' };
    if (global && symbol.includes('.')) return { available: false, reason: 'unsupported' };

    const reports = global ? await _secReports(symbol) : await _bseReports(symbol);
    if (!reports.length) return { available: false, reason: 'noreports' };

    const reads = (await Promise.all(reports.map(r => _readReport(symbol, symbol, r).catch((e) => {
      console.error(`[business] ${symbol} ${r.year}:`, e.message);
      return null;
    })))).filter(r => r?.extract?.fiscalYearEnd);
    if (!reads.length) return { available: false, reason: 'unreadable' };

    reads.sort((a, b) => b.extract.fiscalYearEnd.localeCompare(a.extract.fiscalYearEnd));
    return _combine(reads, global ? 'sec' : 'bse');
  })();

  _inflight.set(key, job);
  try {
    const data = await job;
    // A failure is memoised briefly, so a broken source is not hammered on every view.
    _memo.set(key, { at: data.available ? Date.now() : Date.now() - MEMO_MS + 10 * 60 * 1000, data });
    return data;
  } finally {
    _inflight.delete(key);
  }
}

module.exports = { getBusiness, excerpts, _htmlText };
