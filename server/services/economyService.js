// India's economy as a whole, for the Economy page, kept in MacroPoint from the institutions that publish it.
// Sources: RBI press releases, NSDL, MoSPI and FRED; reads touch the network only for the rupee (shared price cache).

const MacroPoint = require('../models/MacroPoint');
const MacroRelease = require('../models/MacroRelease');
const { DAY_MS, BROWSER_HEADERS } = require('../utils/constants');
const { toDateStr, todayMs } = require('../utils/helpers');
const XLSX = require('xlsx');
const { fetchDailyCloses } = require('./marketDataService');

const HEADERS = { ...BROWSER_HEADERS, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' };
delete HEADERS.Referer;

const RBI_PR = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx';
const NSDL_YEARS = 'https://www.fpi.nsdl.co.in/web/Reports/Yearwise.aspx?RptType=6';
const MOSPI_GDP = 'https://api.mospi.gov.in/api/nas/getNASData?base_year=2022-23&series=Current&frequency=Quarterly&indicator_code=5&format=json';
const AMFI_MONTHLY = 'https://www.amfiindia.com/research-information/amfi-monthly';
const FRED_CSV = (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;

const BACKFILL_FROM = { bop: 2021, wss: 2024, credit: 2023, fpi: 2019 };
const AMFI_FROM = '2019-04-30';   // earlier reports group funds by sponsor, not category

// The first year a kind must be read from: its backfill year until that backfill is recorded, then the current year (and last, in January).
async function _fromYear(kind) {
  const now = new Date(todayMs());
  const recent = now.getUTCMonth() < 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return (await MacroRelease.exists({ key: `backfill:${kind}:${BACKFILL_FROM[kind]}` })) ? recent : BACKFILL_FROM[kind];
}
const _markBackfilled = (kind) => MacroRelease.updateOne({ key: `backfill:${kind}:${BACKFILL_FROM[kind]}` }, { $set: { title: 'backfill' } }, { upsert: true });
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ── Fetching ───────────────────────────────────────────────────────────────────

// One retry: a long-lived process's first connection can stall (see index.js).
async function _get(url, { as = 'text', timeoutMs = 20000, init = {} } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) continue;
      return { body: as === 'json' ? await resp.json() : await resp.text(), resp };
    } catch { /* one more try */ }
  }
  return null;
}

const _decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const _text = (html) => _decode(html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();

// ASP.NET pages (RBI's archive, NSDL's years) switch view through a form post carrying the page's own state.
async function _postBack(url, fields) {
  const first = await _get(url);
  if (!first) return null;
  const cookie = (first.resp.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const form = new URLSearchParams();
  for (const [, k, v] of first.body.matchAll(/name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)) form.set(k, _decode(v));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const r = await _get(url, { init: { method: 'POST', body: form.toString(), headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } } });
  return r?.body || null;
}

/** Table rows as arrays of cell text. Split at each <tr>, since NSDL leaves its rows unclosed. */
function _rows(html) {
  return html.split(/<tr\b[^>]*>/i).slice(1).map(chunk =>
    [...chunk.split(/<\/table/i)[0].matchAll(/<t[dh][^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh][\s>]|$)/gi)].map(c => _text(c[1])));
}

const _num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  const neg = /^\(.*\)$/.test(t);
  const n = parseFloat(t.replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

const _monthEnd = (y, m) => toDateStr(Date.UTC(y, m + 1, 0));
const _monthIdx = (name) => MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());

/** "October 30, 2026" or "Oct. 15, 2026" → "2026-10-30". */
function _longDate(s) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(s || '');
  if (!m || _monthIdx(m[1]) < 0) return null;
  return toDateStr(Date.UTC(+m[3], _monthIdx(m[1]), +m[2]));
}

// ── RBI ────────────────────────────────────────────────────────────────────────

/** Press releases of a year (`month` 0 = all), as { prid, title }. */
async function _rbiArchive(year, month = 0) {
  const html = await _postBack(RBI_PR, { hdnYear: String(year), hdnMonth: String(month) });
  if (!html) return [];
  const seen = new Set();
  return [...html.matchAll(/prid=(\d+)>([^<]*)/g)]
    .map(([, prid, title]) => ({ prid: +prid, title: _text(title) }))
    .filter(r => !seen.has(r.prid) && seen.add(r.prid));
}

/** Weekly Statistical Supplement: reserves (US$ mn), bank deposits and credit (₹ crore, YoY %). */
function parseWss(html) {
  const t = _text(html);
  const out = [];
  const resDate = _longDate(/Foreign Exchange Reserves.*?As on ([A-Za-z]+\.? \d{1,2}, \d{4})/.exec(t)?.[1]);
  if (resDate) {
    const usd = (re) => _num(re.exec(t)?.[2]);
    const items = {
      total: usd(/Total Reserves ([\d.]+) ([\d.]+)/),
      fca: usd(/Foreign Currency Assets #? ?([\d.]+) ([\d.]+)/),
      gold: usd(/1\.2 Gold ([\d.]+) ([\d.]+)/),
      sdr: usd(/1\.3 SDRs ([\d.]+) ([\d.]+)/),
      imf: usd(/Reserve Position in the IMF ([\d.]+) ([\d.]+)/),
    };
    for (const [k, v] of Object.entries(items)) if (v != null) out.push({ series: `reserves.${k}`, date: resDate, freq: 'W', value: v });
  }
  const bankDate = _longDate(/Scheduled Commercial Banks.*?Outstanding as on ([A-Za-z]+\.? \d{1,2}, \d{4})/.exec(t)?.[1]);
  if (bankDate) {
    const level = (re) => _num(re.exec(t)?.[1]);
    const lastGrowth = (re) => { const m = re.exec(t); return m ? _num(m[1].trim().split(' ').pop()) : null; };
    const items = {
      deposits: level(/Aggregate Deposits (-?[\d.]+)/),
      depositsYoY: lastGrowth(/2\.1a Growth \(Per cent\) ((?:-?[\d.]+ ){4}-?[\d.]+)/),
      credit: level(/7 Bank Credit (-?[\d.]+)/),
      creditYoY: lastGrowth(/7\.1a Growth \(Per cent\) ((?:-?[\d.]+ ){4}-?[\d.]+)/),
    };
    for (const [k, v] of Object.entries(items)) if (v != null) out.push({ series: `bank.${k}`, date: bankDate, freq: 'F', value: v });

    // Money stock for the same fortnight: M3 and currency with the public, level and year-on-year %.
    const stock = (label) => {
      const m = new RegExp(`${label} ((?:-?[\\d.]+ ){11}-?[\\d.]+)`).exec(t);
      return m ? m[1].split(' ').map(_num) : null;
    };
    const m3 = stock('M3');
    const cur = stock('1\\.1 Currency with the Public');
    if (m3) out.push({ series: 'money.m3', date: bankDate, freq: 'F', value: m3[1] }, { series: 'money.m3YoY', date: bankDate, freq: 'F', value: m3[11] });
    if (cur) out.push({ series: 'money.currencyYoY', date: bankDate, freq: 'F', value: cur[11] });
  }

  // Liquidity operations, a row a day: the last column is the net injection (+) or absorption (−), ₹ crore.
  const liq = t.slice(t.indexOf('Liquidity Operations by RBI'));
  // Dated "26-Oct-26" now, "Dec. 23, 2024" before 2025.
  for (const m of liq.matchAll(/(?:(\d{2})-([A-Z][a-z]{2})-(\d{2})|([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4}))((?: (?:-?[\d.]+|-)){10})/g)) {
    const net = _num(m[7].trim().split(' ').pop());
    const mi = _monthIdx(m[2] || m[4]);
    const date = m[1] ? Date.UTC(2000 + +m[3], mi, +m[1]) : Date.UTC(+m[6], mi, +m[5]);
    if (net != null && mi >= 0) out.push({ series: 'liquidity.net', date: toDateStr(date), freq: 'D', value: net });
  }
  return out;
}

/** Sectoral deployment of bank credit: year-on-year growth (%) by sector, read from the release's own sentences. */
function parseSectoralCredit(html) {
  const t = _text(html);
  const month = /Sectoral Deployment of Bank Credit\s*[–-]\s*([A-Z][a-z]+) (\d{4})/.exec(t);
  if (!month || _monthIdx(month[1]) < 0) return [];
  const date = _monthEnd(+month[2], _monthIdx(month[1]));
  const body = t.slice(t.indexOf('On a year-on-year') >= 0 ? t.indexOf('On a year-on-year') : 0);
  const sentences = body.split(/\.\s+(?=[A-Z‘'])/);
  const first = (re) => {
    const s1 = sentences.find(x => re.test(x));
    return s1 ? _num(/(-?[\d.]+) per cent/.exec(s1)?.[1]) : null;
  };
  const items = {
    nonfood: first(/non-food bank credit/i), agriculture: first(/agriculture/i), industry: first(/credit (growth )?to industry|industry (recorded|grew|registered)/i),
    services: first(/services sector/i), personal: first(/personal loans/i),
  };
  return Object.entries(items).filter(([, v]) => v != null).map(([k, v]) => ({ series: `credit.${k}`, date, freq: 'M', value: v }));
}

const BOPQ_ROWS = [
  [/^A\. Current Account/i, 'ca'], [/1\. Goods/i, 'goods'], [/\bPOL\b/, 'pol'], [/2\. Services/i, 'services'],
  [/Primary Income/i, 'primary'], [/Secondary Income/i, 'secondary'], [/^B\. Capital Account and Financial/i, 'capfin'],
  [/Direct Investment/i, 'di'], [/Portfolio Investment/i, 'pi'], [/Other Investment/i, 'oi'], [/NRI Deposits/i, 'nri'],
  [/ECBs? to India/i, 'ecb'], [/Reserve/i, 'reserves'], [/Errors (&|and) Omissions/i, 'eo'],
];

/** Quarterly BoP release: credit, debit and net per item (US$ bn) for each quarter column. */
function parseBopQuarter(html) {
  const rows = _rows(html);
  const out = [];
  let periods = null;
  for (const cells of rows) {
    if (!periods) {
      const labels = cells.filter(Boolean);
      // A header holds only short period labels; the release's prose mentions periods too.
      if (labels.length && labels.every(c => c.length < 40) && labels.some(c => /\b(January|April|July|October)\s*[-–—]\s*(March|June|September|December)\s+\d{4}/.test(c))) {
        periods = labels.map(c => {
          // Only a three-month span is a quarter; "April-December" is the year to date, and "2022-23" a whole year.
          const m = /\b(January|April|July|October)\s*[-–—]\s*(March|June|September|December)\s+(\d{4})/.exec(c);
          return m && _monthIdx(m[2]) - _monthIdx(m[1]) === 2 ? _monthEnd(+m[3], _monthIdx(m[2])) : null;
        });
      }
      continue;
    }
    const label = cells[0] || '';
    const hit = BOPQ_ROWS.find(([re]) => re.test(label));
    const vals = cells.slice(1);
    if (!hit || vals.length < periods.length * 3 || !vals.some(v => _num(v) != null)) continue;
    periods.forEach((date, i) => {
      if (!date) return;
      const [cr, dr, net] = vals.slice(i * 3, i * 3 + 3).map(v => _num(v) ?? 0);
      const key = hit[1];
      out.push({ series: `bopq.${key}.cr`, date, freq: 'Q', value: cr });
      out.push({ series: `bopq.${key}.dr`, date, freq: 'Q', value: dr });
      out.push({ series: `bopq.${key}.net`, date, freq: 'Q', value: net });
    });
  }
  return out;
}

const BOPM_ROWS = [
  [/^A\. Current Account/i, 'ca'], [/^A\.1 Merchandise/i, 'goods'], [/^A\.2 Services/i, 'services'],
  [/^A\.3 Transfers/i, 'transfers'], [/^A\.4 Income/i, 'income'], [/^B\. Capital Account/i, 'capital'],
  [/^B\.1 Foreign Direct/i, 'fdi'], [/^B\.2 Foreign Portfolio/i, 'fpi'], [/^B\.3 External Commercial/i, 'ecb'],
  [/^B\.4 Short-term/i, 'stcredit'], [/^B\.5 Banking/i, 'banking'], [/NRI Deposits/i, 'nri'],
  [/^B\.6 Other/i, 'othercap'], [/^C\. Overall/i, 'overall'], [/^D\. Monetary/i, 'reserves'],
];
const BOPM_SUB = { goods: ['X', 'M'], services: ['X', 'M'], fdi: ['In', 'Out'], fpi: ['In', 'Out'], ecb: ['In', 'Out'] };

/** Monthly BoP release (net items, US$ bn) for each single-month column. */
function parseBopMonth(html) {
  const out = [];
  let periods = null;
  let parent = null;
  for (const cells of _rows(html)) {
    if (!periods) {
      const labels = cells.slice(1);
      if (/^Item$/i.test(cells[0] || '') && labels.some(c => /^[A-Z][a-z]+ \d{4}/.test(c))) {
        periods = labels.map(c => {
          const m = /^([A-Z][a-z]+) (\d{4})/.exec(c);
          return m && _monthIdx(m[1]) >= 0 ? _monthEnd(+m[2], _monthIdx(m[1])) : null;
        });
      }
      continue;
    }
    const label = cells[0] || '';
    let key = BOPM_ROWS.find(([re]) => re.test(label))?.[1];
    if (key) parent = key;
    else if (/^[ab]\./.test(label) && BOPM_SUB[parent]) key = parent + BOPM_SUB[parent][label[0] === 'a' ? 0 : 1];
    if (!key) continue;
    periods.forEach((date, i) => {
      const v = _num(cells[i + 1]);
      if (date && v != null) out.push({ series: `bopm.${key}`, date, freq: 'M', value: v });
    });
  }
  return out;
}

/** The release kinds we read, by title. */
// `v` is the parser's version: a release read by an older one is read again.
const RBI_KINDS = [
  { kind: 'wss', re: /Weekly Statistical Supplement/i, parse: parseWss, v: 3 },
  { kind: 'bop', re: /Balance of Payments during/i, parse: parseBopQuarter, v: 1 },
  { kind: 'bop', re: /Balance of Payments for the Month/i, parse: parseBopMonth, v: 1 },
  { kind: 'credit', re: /Sectoral Deployment of Bank Credit/i, parse: parseSectoralCredit, v: 1 },
];
const RBI_KIND_NAMES = [...new Set(RBI_KINDS.map(k => k.kind))];

async function _refreshRbi() {
  const year = new Date(todayMs()).getUTCFullYear();
  const fromBy = Object.fromEntries(await Promise.all(RBI_KIND_NAMES.map(async k => [k, await _fromYear(k)])));
  const stale = await MacroRelease.find({ key: /^rbi:/, $or: [{ v: { $exists: false } }, { v: { $lt: Math.max(...RBI_KINDS.map(k => k.v)) } }] }, { key: 1, title: 1, v: 1 }).lean();
  const restale = stale.filter(r => (RBI_KINDS.find(k => k.re.test(r.title || ''))?.v || 1) > (r.v || 1));
  const from = Math.min(...Object.values(fromBy), ...restale.map(() => year));

  const listed = [];
  const years = [];
  for (let y = from; y <= year; y++) {
    const rows = await _rbiArchive(y);
    years.push(rows.length > 0);
    listed.push(...rows.map(r => ({ ...r, year: y })));
  }
  const wanted = listed
    .map(r => ({ ...r, ...RBI_KINDS.find(k => k.re.test(r.title)) }))
    .filter(r => r.kind && r.year >= fromBy[r.kind]);
  const read = new Map((await MacroRelease.find({ key: { $in: wanted.map(r => `rbi:${r.prid}`) } }, { key: 1, v: 1 }).lean()).map(r => [r.key, r.v || 1]));
  const reread = restale.map(r => ({ prid: +r.key.slice(4), title: r.title, ...RBI_KINDS.find(k => k.re.test(r.title || '')) }));
  const todo = [...wanted.filter(r => !read.has(`rbi:${r.prid}`) || read.get(`rbi:${r.prid}`) < r.v), ...reread]
    .filter((r, i, all) => all.findIndex(x => x.prid === r.prid) === i)
    .sort((a, b) => a.prid - b.prid);

  // Fetched a few at a time, then saved oldest first so a revised figure overwrites the preliminary one.
  const parsed = [];
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    const pages = await Promise.all(batch.map(r => _get(`${RBI_PR}?prid=${r.prid}`)));
    batch.forEach((r, j) => pages[j] && parsed.push({ r, points: r.parse(pages[j].body) }));
  }
  let saved = 0;
  for (const { r, points } of parsed) {
    saved += await _save(points, 'rbi');
    await MacroRelease.updateOne({ key: `rbi:${r.prid}` }, { $set: { title: r.title, points: points.length, v: r.v } }, { upsert: true });
  }
  // A year whose archive did not load leaves the backfill unrecorded, so the next run retries it.
  if (years.every(Boolean)) await Promise.all(RBI_KIND_NAMES.map(_markBackfilled));
  return { releases: parsed.length, saved };
}

/** Policy rates and reserve ratios from RBI's home page, recorded on the day seen. */
async function _refreshRates() {
  const page = await _get('https://www.rbi.org.in/');
  if (!page) return { saved: 0 };
  const t = _text(page.body);
  const rate = (re) => _num(re.exec(t)?.[1]);
  const date = toDateStr(todayMs());
  const items = {
    repo: rate(/Policy Repo Rate\s*:\s*([\d.]+)%/), sdf: rate(/Standing Deposit Facility Rate\s*:\s*([\d.]+)%/),
    msf: rate(/Marginal Standing Facility Rate\s*:\s*([\d.]+)%/), crr: rate(/CRR\s*:\s*([\d.]+)%/), slr: rate(/SLR\s*:\s*([\d.]+)%/),
  };
  const points = Object.entries(items).filter(([, v]) => v != null).map(([k, v]) => ({ series: `rate.${k}`, date, freq: 'D', value: v }));
  return { saved: await _save(points, 'rbi') };
}

// ── NSDL ───────────────────────────────────────────────────────────────────────

/** One calendar year of monthly FPI net investment (₹ crore): equity, debt (all routes), hybrid, other, total. */
function parseNsdlYear(html, year) {
  const rows = _rows(html);
  const at = rows.findIndex(c => c[0] === 'January');
  if (at < 1) return [];
  const header = rows[at - 1];
  const hybridAt = header.findIndex(h => /^Hybrid/i.test(h));
  const out = [];
  for (const [label, ...cells] of rows.slice(at, at + 12)) {
    const m = _monthIdx((label || '').replace(/[^A-Za-z]/g, ''));
    const vals = cells.map(c => (c === '-' ? 0 : _num(c)));   // '-' is a route that did not exist yet
    const width = header.length + (/^Total/i.test(header[header.length - 1]) ? 0 : 1);
    if (m < 0 || vals.length !== width || vals.some(v => v == null)) continue;
    const total = vals[vals.length - 1];
    const equity = vals[0];
    const debt = vals.slice(1, hybridAt > 0 ? hybridAt : vals.length - 1).reduce((s, v) => s + v, 0);
    const hybrid = hybridAt > 0 ? vals[hybridAt] : 0;
    const items = { equity, debt, hybrid, other: total - equity - debt - hybrid, total };
    for (const [k, v] of Object.entries(items)) out.push({ series: `fpi.${k}`, date: _monthEnd(year, m), freq: 'M', value: Math.round(v) });
  }
  return out;
}

async function _refreshNsdl() {
  const year = new Date(todayMs()).getUTCFullYear();
  const from = await _fromYear('fpi');
  let saved = 0;
  let complete = true;
  for (let y = from; y <= year; y++) {
    const html = y === year ? (await _get(NSDL_YEARS))?.body : await _postBack(NSDL_YEARS, { __EVENTTARGET: 'ddl', ddl: String(y) });
    const points = html ? parseNsdlYear(html, y) : [];
    if (!points.length) complete = false;
    saved += await _save(points, 'nsdl');
  }
  if (complete) await _markBackfilled('fpi');
  return { saved };
}

// ── AMFI ───────────────────────────────────────────────────────────────────────

/** Where a fund category's money goes: by its section of the report, then by its own name. */
function _amfiClass(section, label) {
  const l = label.toLowerCase();
  if (/gold|silver/.test(l)) return 'metals';
  if (/index|exchange traded|^other schemes/.test(section)) {
    if (/debt/.test(l)) return 'debt';
    if (/hybrid/.test(l)) return 'hybrid';
    if (/overseas/.test(l)) return 'other';
    return 'passive';
  }
  if (/debt|income/.test(section)) return 'debt';
  if (/equity|growth/.test(section)) return 'equity';
  if (/hybrid/.test(section)) return 'hybrid';
  return 'other';
}

/** One monthly report: net inflows by class (₹ crore), total AUM, equity AUM and folios. Open-ended schemes only, plus the grand total. */
function parseAmfiMonth(buf, date) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const net = { equity: 0, passive: 0, debt: 0, hybrid: 0, metals: 0 };
  let block = '';
  let section = '';
  let grand = null;
  let equityAum = null;
  for (const r of rows) {
    const sr = String(r[0] ?? '').trim();
    const label = String(r[1] ?? '').trim();
    if (/^[ABC]$/.test(sr)) { block = sr; continue; }
    if (/^Grand Total/i.test(label)) { grand = r; continue; }
    if (block !== 'A') continue;
    if (/^[IVX]+$/.test(sr) && r[6] == null) { section = label.toLowerCase(); continue; }
    if (/^Sub Total/i.test(label)) {
      if (/equity|growth/.test(section) && equityAum == null) equityAum = _num(r[7]);
      continue;
    }
    const v = _num(r[6]);
    if (!label || v == null || /total/i.test(label)) continue;
    const cls = _amfiClass(section, label);
    if (cls in net) net[cls] += v;
  }
  if (!grand) return [];
  const total = _num(grand[6]);
  const items = { ...net, other: total - Object.values(net).reduce((a, b) => a + b, 0), total, aum: _num(grand[7]), folios: _num(grand[3]), equityAum };
  return Object.entries(items).filter(([, v]) => v != null && Number.isFinite(v))
    .map(([k, v]) => ({ series: `amfi.${k}`, date, freq: 'M', value: k === 'folios' ? v : Math.round(v) }));
}

async function _refreshAmfi() {
  const page = await _get(AMFI_MONTHLY);
  if (!page) return { saved: 0 };
  // One file per month; a "revised" file replaces the original.
  const files = new Map();
  for (const [url, mon, yr, revised] of page.body.matchAll(/https:\/\/portal\.amfiindia\.com\/spages\/am([a-z]{3})(\d{4})repo(revised)?\.xls/g)) {
    const mi = _monthIdx(mon);
    const date = mi < 0 ? null : _monthEnd(+yr, mi);
    if (!date || date < AMFI_FROM) continue;
    if (!files.has(date) || revised) files.set(date, url);
  }
  const have = new Set(await MacroPoint.distinct('date', { series: 'amfi.total' }));
  const recent = [...files.keys()].sort().slice(-2);
  const todo = [...files].filter(([date]) => !have.has(date) || recent.includes(date));
  let saved = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    const bufs = await Promise.all(batch.map(async ([, url]) => {
      try {
        const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch { return null; }
    }));
    for (let j = 0; j < batch.length; j++) {
      if (!bufs[j]) continue;
      try { saved += await _save(parseAmfiMonth(bufs[j], batch[j][0]), 'amfi'); } catch { /* an unreadable month is skipped */ }
    }
  }
  return { files: todo.length, saved };
}

// ── MoSPI, FRED ────────────────────────────────────────────────────────────────

/** Quarterly GDP (₹ crore, 2022-23 base), real and nominal, dated at each quarter's end. */
async function _refreshGdp() {
  const r = await _get(MOSPI_GDP, { as: 'json' });
  const points = [];
  for (const row of r?.body?.data || []) {
    if (row.frequency !== 'Quarterly' || !/^Q[1-4]$/.test(row.quarter || '')) continue;
    const fy = parseInt(row.year, 10);
    const q = +row.quarter[1];
    const date = q === 4 ? _monthEnd(fy + 1, 2) : _monthEnd(fy, 2 + q * 3);
    const real = _num(row.constant_price);
    const nominal = _num(row.current_price);
    if (real != null) points.push({ series: 'gdp.real', date, freq: 'Q', value: real });
    if (nominal != null) points.push({ series: 'gdp.nominal', date, freq: 'Q', value: nominal });
  }
  return { saved: await _save(points, 'mospi') };
}

/** India's 10-year government bond yield, monthly average (FRED, from the OECD). */
async function _refreshYield() {
  const r = await _get(FRED_CSV('INDIRLTLT01STM'), { timeoutMs: 40000 });
  const points = (r?.body || '').split('\n').slice(1).map(line => {
    const [d, v] = line.split(',');
    const value = _num(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || value == null || +d.slice(0, 4) < 2015) return null;
    return { series: 'gsec10y', date: _monthEnd(+d.slice(0, 4), +d.slice(5, 7) - 1), freq: 'M', value };
  }).filter(Boolean);
  return { saved: await _save(points, 'fred') };
}

// ── Store ──────────────────────────────────────────────────────────────────────

async function _save(points, src) {
  const ops = points.filter(p => p && Number.isFinite(p.value)).map(p => ({
    updateOne: { filter: { series: p.series, date: p.date }, update: { $set: { freq: p.freq, value: p.value, src } }, upsert: true },
  }));
  if (ops.length) await MacroPoint.bulkWrite(ops, { ordered: false });
  return ops.length;
}

let _refreshing = null;

/** Pulls every source into MacroPoint; each one failing costs only its own series. Callers share one run. */
function refreshEconomy() {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const jobs = { rbi: _refreshRbi, rates: _refreshRates, nsdl: _refreshNsdl, amfi: _refreshAmfi, gdp: _refreshGdp, yield: _refreshYield };
    const results = await Promise.allSettled(Object.values(jobs).map(f => f()));
    return Object.fromEntries(Object.keys(jobs).map((k, i) =>
      [k, results[i].status === 'fulfilled' ? results[i].value : { error: results[i].reason?.message }]));
  })().finally(() => { _refreshing = null; });
  return _refreshing;
}

// ── Reading ────────────────────────────────────────────────────────────────────

/** { series: [{date, value}] } oldest first, for series matching a prefix regex. */
async function _series(re, since) {
  const rows = await MacroPoint.find({ series: re, ...(since ? { date: { $gte: since } } : {}) }, { series: 1, date: 1, value: 1, _id: 0 })
    .sort({ date: 1 }).lean();
  const out = {};
  for (const r of rows) (out[r.series] ||= []).push({ date: r.date, value: r.value });
  return out;
}

const _last = (arr) => (arr?.length ? arr[arr.length - 1] : null);
const _round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const _quarterLabel = (date) => {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  const fy = m <= 3 ? y : y + 1;
  const q = { 6: 1, 9: 2, 12: 3, 3: 4 }[m];
  return { short: `Q${q} FY${String(fy).slice(2)}`, months: { 1: 'Apr–Jun', 2: 'Jul–Sep', 3: 'Oct–Dec', 4: 'Jan–Mar' }[q] + ` ${y}` };
};

/** Weekly USD/INR closes since a day, as [{date, value}]. */
async function _rupee(sinceMs) {
  const closes = await fetchDailyCloses('USDINR=X', sinceMs, todayMs()).catch(() => ({}));
  return Object.entries(closes).map(([ms, v]) => ({ date: toDateStr(+ms), value: v })).sort((a, b) => a.date.localeCompare(b.date));
}

function _avgBetween(series, from, to) {
  const vals = series.filter(p => p.date > from && p.date <= to).map(p => p.value);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/** Year-on-year change of a quarterly level series, in %. */
function _yoy(series) {
  const byDate = new Map(series.map(p => [p.date, p.value]));
  return series.map(p => {
    const prev = byDate.get(`${+p.date.slice(0, 4) - 1}${p.date.slice(4)}`);
    return prev ? { date: p.date, value: _round((p.value / prev - 1) * 100) } : null;
  }).filter(Boolean);
}

/** The headline figures: growth, rates, the rupee, reserves and the current account. */
async function getHeadline() {
  const since = toDateStr(todayMs() - 6 * 365 * DAY_MS);
  const [s, rupee] = await Promise.all([_series(/^(gdp\.|rate\.|gsec10y|reserves\.total|bopq\.(ca|goods|services)\.)/, since), _rupee(todayMs() - 400 * DAY_MS)]);

  const realYoY = _yoy(s['gdp.real'] || []);
  const nominalYoY = _yoy(s['gdp.nominal'] || []);
  const gdp = _last(realYoY);
  const reserves = _last(s['reserves.total']);
  const reservesYearAgo = reserves && [...(s['reserves.total'] || [])].reverse()
    .find(p => p.date <= toDateStr(Date.parse(reserves.date) - 364 * DAY_MS));
  const usd = _last(rupee);
  const usdYearAgo = usd && [...rupee].reverse().find(p => p.date <= toDateStr(Date.parse(usd.date) - 365 * DAY_MS));

  // Import cover: reserves over a month of goods and services imports, averaged across the last four quarters.
  const imports = (s['bopq.goods.dr'] || []).slice(-4).map(p => p.value + ((s['bopq.services.dr'] || []).find(x => x.date === p.date)?.value || 0));
  const monthlyImports = imports.length === 4 ? imports.reduce((a, b) => a + b, 0) / 12 : null;

  // Current account as a share of GDP for the latest quarter both cover, GDP converted at that quarter's average rupee.
  const ca = _last(s['bopq.ca.net']);
  let caPct = null;
  const gdpNominal = ca && (s['gdp.nominal'] || []).find(p => p.date === ca.date);
  if (gdpNominal) {
    const from = toDateStr(Date.parse(ca.date) - 92 * DAY_MS);
    const allRupee = await _rupee(Date.parse(from));
    const fx = _avgBetween(allRupee, from, ca.date);
    if (fx) caPct = _round(ca.value / (gdpNominal.value * 1e7 / fx / 1e9) * 100);
  }

  const repo = _last(s['rate.repo']);
  const gsec = _last(s.gsec10y);
  return {
    gdp: gdp && { real: gdp.value, nominal: _last(nominalYoY)?.value ?? null, date: gdp.date, quarter: _quarterLabel(gdp.date), series: realYoY },
    repo: repo && {
      value: repo.value, date: repo.date,
      sdf: _last(s['rate.sdf'])?.value ?? null, msf: _last(s['rate.msf'])?.value ?? null,
      crr: _last(s['rate.crr'])?.value ?? null, slr: _last(s['rate.slr'])?.value ?? null,
    },
    gsec10y: gsec && { value: gsec.value, date: gsec.date, spread: repo ? _round(gsec.value - repo.value, 2) : null },
    usdinr: usd && { value: _round(usd.value, 2), date: usd.date, change1y: usdYearAgo ? _round((usd.value / usdYearAgo.value - 1) * 100) : null },
    reserves: reserves && {
      value: _round(reserves.value / 1000), date: reserves.date,
      change1y: reservesYearAgo ? _round((reserves.value - reservesYearAgo.value) / 1000) : null,
      importCover: monthlyImports ? _round(reserves.value / 1000 / monthlyImports) : null,
    },
    currentAccount: ca && { value: ca.value, pctGdp: caPct, date: ca.date, quarter: _quarterLabel(ca.date) },
  };
}

const BOP_ITEMS = ['ca', 'goods', 'pol', 'services', 'primary', 'secondary', 'capfin', 'di', 'pi', 'oi', 'nri', 'ecb', 'reserves', 'eo'];

/** Money crossing the border: quarterly BoP, the latest months, reserves, the rupee and foreign portfolio flows. */
async function getExternal() {
  const since = toDateStr(todayMs() - 6 * 365 * DAY_MS);
  const [s, rupee] = await Promise.all([_series(/^(bopq\.|bopm\.|reserves\.|fpi\.)/, since), _rupee(todayMs() - 5 * 365 * DAY_MS)]);

  const qDates = [...new Set((s['bopq.ca.net'] || []).map(p => p.date))];
  const at = (series, date) => (s[series] || []).find(p => p.date === date)?.value ?? null;
  const quarters = qDates.map(date => {
    const items = {};
    for (const k of BOP_ITEMS) {
      const net = at(`bopq.${k}.net`, date);
      if (net != null) items[k] = { cr: at(`bopq.${k}.cr`, date), dr: at(`bopq.${k}.dr`, date), net };
    }
    return { date, ...(_quarterLabel(date)), items };
  });

  const mDates = [...new Set((s['bopm.ca'] || []).map(p => p.date))];
  const months = mDates.map(date => ({
    date,
    items: Object.fromEntries(Object.keys(s).filter(k => k.startsWith('bopm.')).map(k => [k.slice(5), at(k, date)]).filter(([, v]) => v != null)),
  }));

  const rDates = (s['reserves.total'] || []).map(p => p.date);
  const reserves = rDates.map(date => ({
    date, total: at('reserves.total', date), fca: at('reserves.fca', date), gold: at('reserves.gold', date),
    sdr: at('reserves.sdr', date), imf: at('reserves.imf', date),
  }));

  const fDates = (s['fpi.total'] || []).map(p => p.date);
  const thisMonth = _monthEnd(new Date(todayMs()).getUTCFullYear(), new Date(todayMs()).getUTCMonth());
  const fpi = fDates.map(date => ({
    date, partial: date === thisMonth, equity: at('fpi.equity', date), debt: at('fpi.debt', date),
    hybrid: at('fpi.hybrid', date), other: at('fpi.other', date), total: at('fpi.total', date),
  }));

  // Weekly rupee points keep the payload small; the last close is always kept.
  const weekly = rupee.filter((p, i) => i === rupee.length - 1 || new Date(p.date).getUTCDay() === 5);
  return { quarters, months, reserves, rupee: weekly.map(p => ({ date: p.date, value: _round(p.value, 2) })), fpi, through: toDateStr(todayMs()) };
}


/** Money inside the country: household money into funds, banks' deposits and credit by sector, liquidity and money supply. */
async function getDomestic() {
  const since = toDateStr(todayMs() - 6 * 365 * DAY_MS);
  const s = await _series(/^(amfi\.|bank\.|credit\.|money\.|liquidity\.)/, since);
  const pivot = (prefix, keys) => {
    const dates = [...new Set(keys.flatMap(k => (s[`${prefix}.${k}`] || []).map(p => p.date)))].sort();
    const idx = Object.fromEntries(keys.map(k => [k, new Map((s[`${prefix}.${k}`] || []).map(p => [p.date, p.value]))]));
    return dates.map(date => ({ date, ...Object.fromEntries(keys.map(k => [k, idx[k].get(date) ?? null])) }));
  };
  const funds = pivot('amfi', ['equity', 'passive', 'debt', 'hybrid', 'metals', 'other', 'total', 'aum', 'equityAum', 'folios']);
  const banks = pivot('bank', ['deposits', 'credit', 'depositsYoY', 'creditYoY'])
    .map(r => ({ ...r, cd: r.deposits && r.credit ? _round(r.credit / r.deposits * 100) : null }));
  const credit = pivot('credit', ['nonfood', 'agriculture', 'industry', 'services', 'personal']);
  const money = pivot('money', ['m3', 'm3YoY', 'currencyYoY']);
  const yearAgo = toDateStr(todayMs() - 366 * DAY_MS);
  const liquidity = (s['liquidity.net'] || []).filter(p => p.date >= yearAgo);
  return { funds, banks, credit, money, liquidity };
}

// ── The story ──────────────────────────────────────────────────────────────────

const _cr = (v) => {
  const a = Math.abs(v);
  return a >= 1e5 ? `₹${(a / 1e5).toFixed(2)}L Cr` : `₹${Math.round(a).toLocaleString('en-IN')} Cr`;
};
const _usd = (v) => `$${Math.abs(v).toFixed(1)}B`;
const _pct = (v, d = 1) => `${v.toFixed(d)}%`;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _monthName = (date) => MONTH_NAMES[+date.slice(5, 7) - 1];
const _lc = (label) => label.replace(/^[A-Z][a-z]/, m => m.toLowerCase());
const _nearest = (rows, date, key = 'date') => [...rows].reverse().find(r => r[key] <= date);
const _yearBefore = (date) => toDateStr(Date.parse(date) - 365 * DAY_MS);

/**
 * What the figures add up to, in plain sentences: each finding is a comparison the data can prove.
 * Every finding is optional and drops out when its data is missing.
 */
async function getStory() {
  const [h, x, d] = await Promise.all([getHeadline(), getExternal(), getDomestic()]);
  const out = [];
  const facts = {};

  // Growth: the level, its direction, and what nominal minus real says about prices.
  if (h.gdp?.series?.length) {
    const ser = h.gdp.series;
    const r = ser[ser.length - 1].value;
    const prev = ser[ser.length - 2]?.value;
    facts.growth = { r, prev, months: h.gdp.quarter.months };
    const title = r >= 7.5 ? 'The economy is growing fast' : r >= 6 ? 'Growth is steady' : r >= 4 ? 'Growth is slowing' : 'Growth is weak';
    const dir = prev == null ? '' : r > prev ? `, up from ${_pct(prev)} the quarter before` : r < prev ? `, down from ${_pct(prev)} the quarter before` : ', unchanged on the quarter before';
    const prices = h.gdp.nominal != null ? ` Nominal growth of ${_pct(h.gdp.nominal)} means prices across the economy rose about ${_pct(h.gdp.nominal - r)}.` : '';
    out.push({ key: 'growth', theme: 'Growth', anchor: 'top', title,
      detail: `Real GDP grew ${_pct(r)} in ${h.gdp.quarter.months} on a year earlier${dir}.${prices}`,
      stat: { value: _pct(r), label: `real GDP growth, ${h.gdp.quarter.months}` },
      spark: { values: ser.map(p => p.value), label: `Growth, last ${ser.length} quarters`, fmt: 'pct' } });
  }

  // Trade: the goods deficit, and how much of it services and remittances pay for.
  const q = x.quarters[x.quarters.length - 1];
  if (q?.items.goods && q.items.services && q.items.secondary) {
    const goods = q.items.goods.net;
    const ya = x.quarters.find(z => z.date === `${+q.date.slice(0, 4) - 1}${q.date.slice(4)}`);
    const earn = q.items.services.net + q.items.secondary.net;
    const caPct = h.currentAccount?.date === q.date ? h.currentAccount.pctGdp : null;
    const title = q.items.ca.net > 0 ? 'India earned more abroad than it spent'
      : caPct != null && caPct >= -1.5 ? 'Services and remittances keep the trade gap in check' : 'India is spending more abroad than it earns';
    const was = ya?.items.goods ? ` (${-goods > -ya.items.goods.net ? 'wider than' : 'narrower than'} ${_usd(ya.items.goods.net)} a year earlier)` : '';
    out.push({ key: 'trade', theme: 'Trade', anchor: 'bop', title,
      detail: `The goods trade deficit was ${_usd(goods)} in ${q.months}${was}. Services exports and remittances brought in a net ${_usd(earn)}, covering ${Math.round(earn / -goods * 100)}% of it${q.items.primary ? `; after ${_usd(q.items.primary.net)} of investment income ${q.items.primary.net < 0 ? 'paid abroad' : 'earned'}` : ''}, the current account ended at ${caPct != null ? `${caPct < 0 ? '−' : '+'}${Math.abs(caPct).toFixed(1)}% of GDP` : _usd(q.items.ca.net)}.`,
      stat: { value: `${Math.round(earn / -goods * 100)}%`, label: 'of the goods deficit paid for by services and remittances' },
      spark: { values: x.quarters.slice(-12).map(z => z.items.ca?.net ?? 0), label: 'Current account, last 12 quarters', fmt: 'usd', zero: true } });
  }

  // Funding: which channel brought foreign money in this financial year (monthly BoP).
  const lastM = x.months[x.months.length - 1];
  if (lastM) {
    const fyStartYear = +lastM.date.slice(5, 7) >= 4 ? +lastM.date.slice(0, 4) : +lastM.date.slice(0, 4) - 1;
    const fy = x.months.filter(m => m.date >= `${fyStartYear}-04-01`);
    const sum = (k) => fy.reduce((a, m) => a + (m.items[k] ?? 0), 0);
    const ch = [['nri', 'NRI deposits'], ['fdi', 'FDI'], ['fpi', 'Portfolio investment'], ['ecb', 'Foreign loans']]
      .map(([k, label]) => ({ k, label, v: Math.round(sum(k) * 10) / 10 })).sort((a, b) => b.v - a.v);
    const top = ch[0];
    const titles = { nri: 'Indians abroad are the biggest source of foreign money', fdi: 'Long-term foreign investment is funding the gap', fpi: 'Foreign portfolio money is pouring in', ecb: 'Companies are borrowing abroad' };
    const res = -sum('reserves');
    const span = `${_monthName(fy[0].date).slice(0, 3)}–${_monthName(lastM.date).slice(0, 3)} ${lastM.date.slice(0, 4)}`;
    if (top.v > 0) {
      // A channel that arrived mostly in the last two months is a surge, and the most important thing to say about it.
      const lastTwo = fy.slice(-2).reduce((a, m) => a + (m.items[top.k] ?? 0), 0);
      facts.funding = { top, lastTwo, res, months: fy.slice(-2).map(m => _monthName(m.date)), fpi: ch.find(c => c.k === 'fpi').v };
      const surge = fy.length > 2 && lastTwo >= top.v * 0.7
        ? ` ${_usd(lastTwo)} of the ${_lc(top.label)} came in ${fy.slice(-2).map(m => _monthName(m.date)).join(' and ')} alone, a sudden surge.` : '';
      out.push({ key: 'funding', theme: 'Foreign money', anchor: 'bop', title: titles[top.k],
        detail: `Net, ${span}: ${ch.map(c => `${_lc(c.label)} ${c.v < 0 ? '−' : ''}${_usd(c.v)}`).join(', ')}.${surge} The RBI ${res >= 0 ? 'added' : 'drew down'} ${_usd(res)} ${res >= 0 ? 'to' : 'from'} reserves.`,
        stat: { value: `+${_usd(top.v)}`, label: `${_lc(top.label)}, ${span}` },
        bars: { fmt: 'usd', rows: ch.map(c => ({ label: c.label, v: c.v })) } });
    }
  }

  // Rupee and reserves: direction, how weak against five years, and how much of the reserve change is gold.
  if (h.usdinr && h.reserves) {
    const rupeeChg = h.usdinr.change1y != null ? (1 / (1 + h.usdinr.change1y / 100) - 1) * 100 : null;
    const maxFx = Math.max(...x.rupee.map(p => p.value));
    const weakest = h.usdinr.value >= maxFx - 0.05;
    const r = x.reserves;
    const lastR = r[r.length - 1];
    const yaR = lastR && _nearest(r, _yearBefore(lastR.date));
    const goldChg = lastR?.gold != null && yaR?.gold != null ? (lastR.gold - yaR.gold) / 1000 : null;
    const falling = rupeeChg != null && rupeeChg < -1;
    const title = falling ? (h.reserves.change1y > 0 ? 'The rupee is falling even as reserves grow' : 'The rupee is falling, and reserves with it')
      : rupeeChg != null && rupeeChg > 1 ? 'The rupee is strengthening' : 'The rupee is holding steady';
    facts.rupee = { chg: rupeeChg, weakest, reservesChg: h.reserves.change1y };
    const gold = goldChg == null || h.reserves.change1y == null || Math.abs(goldChg) < 1 ? ''
      : goldChg >= h.reserves.change1y ? ` All of that, and more, is the rising value of the RBI's gold (${_usd(goldChg)}); its currency holdings did not grow.`
        : goldChg > 0 ? ` ${_usd(goldChg)} of that is the rising value of the RBI's gold; the rest is foreign currency it bought.`
          : ` All of it is foreign currency the RBI bought; its gold lost ${_usd(goldChg)} in value.`;
    out.push({ key: 'rupee', theme: 'Rupee', anchor: 'reserves', title,
      detail: `₹${h.usdinr.value.toFixed(2)} per dollar, ${rupeeChg != null ? `${Math.abs(rupeeChg).toFixed(1)}% ${rupeeChg < 0 ? 'weaker' : 'stronger'} than a year ago` : ''}${weakest ? ' and its weakest in five years' : ''}. Reserves are ${_usd(h.reserves.value)}, ${h.reserves.change1y >= 0 ? 'up' : 'down'} ${_usd(h.reserves.change1y)} in a year.${gold}`,
      stat: { value: `₹${h.usdinr.value.toFixed(2)}`, label: 'per US dollar' },
      spark: { values: x.rupee.slice(-104).map(p => p.value), label: 'Rupees per dollar, 2 years', fmt: 'inr' } });
  }

  // Shares: foreign selling against Indian savers' buying, over the same calendar year.
  if (x.fpi.length && d.funds.length) {
    const year = x.fpi[x.fpi.length - 1].date.slice(0, 4);
    const fpi = x.fpi.filter(m => m.date.startsWith(year));
    const dom = d.funds.filter(m => m.date.startsWith(year));
    if (fpi.length >= 3 && dom.length >= 3) {
      const f = fpi.reduce((a, m) => a + (m.equity || 0), 0);
      const dm = dom.reduce((a, m) => a + (m.equity || 0) + (m.passive || 0), 0);
      const title = f < 0 && dm > 0 ? (dm >= -f ? 'Indian savers are buying more than foreigners sell' : 'Foreigners are selling faster than Indian savers buy')
        : f > 0 && dm > 0 ? 'Foreign and Indian money are both buying shares' : 'Foreign money is leading the market';
      facts.shares = { f, dm, year };
      const ratio = f < 0 && dm > 0 ? ` — ${(dm / -f).toFixed(1)}× what foreigners took out` : '';
      out.push({ key: 'shares', theme: 'Shares', anchor: 'fpi', title,
        detail: `Foreign investors ${f < 0 ? 'sold' : 'bought'} a net ${_cr(f)} of Indian shares in ${year} (to ${_monthName(fpi[fpi.length - 1].date)}). Indians put ${_cr(dm)} into equity funds and ETFs (to ${_monthName(dom[dom.length - 1].date)})${ratio}.`,
        stat: f < 0 && dm > 0 ? { value: `${(dm / -f).toFixed(1)}×`, label: `Indian fund buying against foreign selling, ${year}` } : { value: `${dm < 0 ? '−' : '+'}${_cr(dm)}`, label: `into Indian equity funds, ${year}` },
        bars: { fmt: 'cr', rows: [{ label: 'Foreign investors', v: f }, { label: 'Indian fund investors', v: dm }] } });
    }
  }

  // Credit: loans against deposits, and which borrowers are driving it.
  const b = d.banks[d.banks.length - 1];
  const c = d.credit[d.credit.length - 1];
  if (b?.creditYoY != null && b.depositsYoY != null) {
    const gap = b.creditYoY - b.depositsYoY;
    const title = b.creditYoY >= 15 ? (gap > 1 ? 'A lending boom, running ahead of deposits' : 'A lending boom') : gap > 1 ? 'Banks are lending faster than they raise deposits' : gap < -1 ? 'Deposits are outgrowing loans' : 'Loans and deposits are growing together';
    const yaB = _nearest(d.banks, _yearBefore(b.date));
    facts.credit = { yoy: b.creditYoY, deposits: b.depositsYoY };
    let sector = '';
    if (c) {
      const ya = d.credit.find(r => r.date.slice(0, 7) === `${+c.date.slice(0, 4) - 1}${c.date.slice(4, 7)}`);
      const names = { personal: 'personal loans', services: 'services', industry: 'industry', agriculture: 'agriculture' };
      const top = Object.keys(names).filter(k => c[k] != null).sort((a, z) => c[z] - c[a])[0];
      if (top) facts.credit.top = { name: names[top], v: c[top] };
      if (top) sector = ` Fastest: ${names[top]} at ${_pct(c[top])}${ya?.[top] != null ? `, up from ${_pct(ya[top])} a year earlier` : ''}.`;
    }
    out.push({ key: 'credit', theme: 'Banks', anchor: 'banks', title,
      detail: `Bank loans are up ${_pct(b.creditYoY)} on a year, deposits ${_pct(b.depositsYoY)}. Banks lend ₹${Math.round(b.cd)} of every ₹100 deposited${yaB?.cd ? `, against ₹${Math.round(yaB.cd)} a year ago` : ''}.${sector}`,
      stat: { value: _pct(b.creditYoY), label: 'bank credit growth on a year' },
      spark: { values: d.banks.slice(-48).map(r => r.creditYoY ?? 0), label: 'Credit growth, 2 years', fmt: 'pct' } });
  }

  // Money: spare cash in the system and how fast money is growing.
  const m = d.money[d.money.length - 1];
  if (m?.m3YoY != null && d.liquidity.length) {
    const recent = d.liquidity.slice(-30);
    const surplus = -recent.reduce((a, p) => a + p.value, 0) / recent.length;
    const yaM = _nearest(d.money, _yearBefore(m.date));
    facts.money = { surplus, m3: m.m3YoY };
    const title = surplus > 50000 && m.m3YoY >= 12 ? 'Money is plentiful' : surplus < 0 ? 'Cash is tight in the banking system' : 'Liquidity is comfortable';
    out.push({ key: 'money', theme: 'Money', anchor: 'liquidity', title,
      detail: `Banks have ${surplus >= 0 ? 'parked' : 'borrowed'} an average ${_cr(surplus)} a day ${surplus >= 0 ? 'with' : 'from'} the RBI over the past month. Broad money is growing ${_pct(m.m3YoY)} a year${yaM?.m3YoY != null ? `, ${m.m3YoY >= yaM.m3YoY ? 'up' : 'down'} from ${_pct(yaM.m3YoY)} a year ago` : ''}${h.repo ? `, with the repo rate at ${h.repo.value.toFixed(2)}%` : ''}.`,
      stat: { value: _cr(surplus), label: 'spare cash banks park with the RBI, a day' },
      spark: { values: d.money.slice(-48).map(r => r.m3YoY ?? 0), label: 'Broad money growth, 2 years', fmt: 'pct' } });
  }
  return { lede: _lede(facts), findings: out };
}

/** The findings joined into one paragraph: growth, then the money crossing the border, then the money at home. */
function _lede({ growth, funding, rupee, shares, credit, money }) {
  const parts = [];
  if (growth) parts.push(`India grew ${_pct(growth.r)} in ${growth.months}${growth.prev != null ? `, ${Math.abs(growth.r - growth.prev) < 0.3 ? (growth.r === growth.prev ? 'as fast as' : `a touch ${growth.r > growth.prev ? 'faster' : 'slower'} than`) : growth.r > growth.prev ? 'faster than' : 'slower than'} the quarter before` : ''}.`);

  if (funding || shares) {
    const selling = (shares && shares.f < 0) || (funding && funding.fpi < 0);
    const surge = funding && funding.lastTwo >= funding.top.v * 0.7;
    let s1 = selling ? 'Foreign investors are pulling money out of Indian shares' : 'Foreign investors are buying Indian shares';
    if (funding) {
      s1 += selling ? `, but ${_lc(funding.top.label)} ${surge ? `surged, ${_usd(funding.lastTwo)} in ${funding.months.join(' and ')} alone,` : `brought in ${_usd(funding.top.v)}`} and more than made up for it`
        : `, and ${_lc(funding.top.label)} brought in the most foreign money this year (${_usd(funding.top.v)})`;
      if (funding.res > 0) s1 += `, letting the RBI add ${_usd(funding.res)} to reserves`;
    }
    if (rupee?.chg != null && rupee.chg < -1) s1 += `${funding?.res > 0 ? '. Even so, the rupee' : '. The rupee'} has lost ${Math.abs(rupee.chg).toFixed(1)}% against the dollar in a year${rupee.weakest ? ', to its weakest in five years' : ''}`;
    parts.push(`${s1}.`);
  }

  const home = [];
  if (money && money.surplus > 50000) home.push(`money is plentiful (banks hold a ${_cr(money.surplus)} daily surplus and broad money is up ${_pct(money.m3, 0)})`);
  if (credit) home.push(`bank lending is growing ${_pct(credit.yoy, 0)}${credit.top ? `, fastest to ${credit.top.name}` : ''}`);
  if (home.length) parts.push(`At home, ${home.join(', and ')}.`);
  if (shares && shares.f < 0 && shares.dm > 0) parts.push(`Indian savers are the market's buyers: ${_cr(shares.dm)} into equity funds this year, ${(shares.dm / -shares.f).toFixed(1)}× what foreigners sold.`);
  return parts.join(' ');
}

module.exports = { refreshEconomy, getHeadline, getExternal, getDomestic, getStory, parseSectoralCredit, parseAmfiMonth, parseWss, parseBopQuarter, parseBopMonth, parseNsdlYear };
