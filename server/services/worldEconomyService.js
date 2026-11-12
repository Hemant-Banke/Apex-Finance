// India against the world: IMF and World Bank yearly figures in MacroPoint, and country stock markets in dollars.
// Reads touch the network only for market closes, which come from the shared price cache.

const MacroPoint = require('../models/MacroPoint');
const MacroRelease = require('../models/MacroRelease');
const { DAY_MS } = require('../utils/constants');
const { todayMs, toDateStr } = require('../utils/helpers');
const { toSorted, windowReturns, round } = require('../utils/series');
const { fetchDailyCloses } = require('./marketDataService');

// The economies global capital chooses between. `etf` is the US-listed fund a dollar investor buys it through.
const PEERS = [
  { iso: 'IND', name: 'India', etf: 'INDA' },
  { iso: 'CHN', name: 'China', etf: 'MCHI' },
  { iso: 'USA', name: 'United States', etf: 'SPY' },
  { iso: 'JPN', name: 'Japan', etf: 'EWJ' },
  { iso: 'DEU', name: 'Germany', etf: 'EWG' },
  { iso: 'GBR', name: 'United Kingdom', etf: 'EWU' },
  { iso: 'KOR', name: 'South Korea', etf: 'EWY' },
  { iso: 'TWN', name: 'Taiwan', etf: 'EWT' },
  { iso: 'IDN', name: 'Indonesia', etf: 'EIDO' },
  { iso: 'VNM', name: 'Vietnam', etf: 'VNM' },
  { iso: 'BRA', name: 'Brazil', etf: 'EWZ' },
  { iso: 'MEX', name: 'Mexico', etf: 'EWW' },
];
// Groups: the IMF's (advanced / emerging & developing) and the World Bank's nearest (high / low & middle income).
const GROUPS = [
  { iso: 'WLD', name: 'World', imf: 'WEOWORLD', wb: 'WLD', etf: 'ACWI' },
  { iso: 'EME', name: 'Emerging economies', imf: 'OEMDC', wb: 'LMY', etf: 'EEM' },
  { iso: 'ADV', name: 'Advanced economies', imf: 'ADVEC', wb: 'HIC' },
];

const IMF_API = (code) => `https://www.imf.org/external/datamapper/api/v1/${code}`;
const IMF = {
  growth: 'NGDP_RPCH', inflation: 'PCPIPCH', ca: 'BCA_NGDPD', gdpUsd: 'NGDPD', pppShare: 'PPPSH', perCapita: 'NGDPDPC', debt: 'GGXWDG_NGDP',
};
// Kept for every country (not just peers): the world's growth is split between all of them.
const IMF_ALL = new Set(['growth', 'pppShare', 'gdpUsd']);
const IMF_FROM = 2000;

const WB_API = (codes, ind) => `https://api.worldbank.org/v2/country/${codes}/indicator/${ind}?format=json&date=2005:2030&per_page=2000`;
const WB = {
  invest: { id: 'NE.GDI.FTOT.ZS' }, savings: { id: 'NY.GNS.ICTR.ZS' }, manufacturing: { id: 'NV.IND.MANF.ZS' },
  fdiPct: { id: 'BX.KLT.DINV.WD.GD.ZS' }, fdiUsd: { id: 'BX.KLT.DINV.CD.WD', bn: true },
  remitUsd: { id: 'BX.TRF.PWKR.CD.DT', bn: true }, exportsUsd: { id: 'BX.GSR.GNFS.CD', bn: true },
};

const REFRESH_EVERY_MS = 3 * DAY_MS;   // the IMF revises twice a year, the World Bank a few times
const _yearEnd = (y) => `${y}-12-31`;

// IMF's edge rejects a browser User-Agent; a plain client name is let through.
async function _json(url, timeoutMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'curl/8.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return await r.json();
    } catch { /* one more try */ }
  }
  return null;
}

async function _save(points, src) {
  const ops = points.filter(p => Number.isFinite(p.value)).map(p => ({
    updateOne: { filter: { series: p.series, date: p.date }, update: { $set: { freq: 'A', value: p.value, src } }, upsert: true },
  }));
  for (let i = 0; i < ops.length; i += 2000) await MacroPoint.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  return ops.length;
}

async function _due(key) {
  const doc = await MacroRelease.findOne({ key }).lean();
  return !doc || Date.now() - new Date(doc.updatedAt).getTime() > REFRESH_EVERY_MS;
}
const _done = (key, points) => MacroRelease.updateOne({ key }, { $set: { title: key, points } }, { upsert: true });

/** IMF World Economic Outlook: history and projections, per country and group. */
async function _refreshImf() {
  if (!(await _due('world:imf'))) return { skipped: true };
  const isos = new Set(PEERS.map(p => p.iso));
  const groupOf = Object.fromEntries(GROUPS.map(g => [g.imf, g.iso]));
  // Regions are three-letter codes too (APQ, EAQ…); only real countries may split the world's growth.
  const list = (await _json(IMF_API('countries'), 60000))?.countries || {};
  const countries = new Set(Object.keys(list));
  if (!countries.size) return { saved: 0 };
  // "China, People's Republic of" → "China".
  const names = Object.fromEntries(Object.entries(list).map(([iso, c]) => [iso, String(c.label || iso).replace(/,\s.*$/, '')]));
  await MacroRelease.updateOne({ key: 'world:names' }, { $set: { title: JSON.stringify(names) } }, { upsert: true });
  let saved = 0;
  for (const [key, code] of Object.entries(IMF)) {
    const body = await _json(IMF_API(code), 60000);
    const byCountry = body?.values?.[code];
    if (!byCountry) continue;
    const points = [];
    for (const [c, years] of Object.entries(byCountry)) {
      const iso = groupOf[c] || c;
      if (!groupOf[c] && !isos.has(c) && !(IMF_ALL.has(key) && countries.has(c))) continue;
      for (const [y, v] of Object.entries(years || {})) {
        if (+y >= IMF_FROM && v != null) points.push({ series: `imf.${key}.${iso}`, date: _yearEnd(y), value: +v });
      }
    }
    saved += await _save(points, 'imf');
  }
  if (saved) await _done('world:imf', saved);
  return { saved };
}

/** World Bank: how much each economy invests and saves, what it makes, and the foreign money it draws. */
async function _refreshWorldBank() {
  if (!(await _due('world:wb'))) return { skipped: true };
  const groupOf = Object.fromEntries(GROUPS.map(g => [g.wb, g.iso]));
  const codes = [...PEERS.map(p => p.iso).filter(c => c !== 'TWN'), ...GROUPS.map(g => g.wb)].join(';');
  let saved = 0;
  for (const [key, { id, bn }] of Object.entries(WB)) {
    const body = await _json(WB_API(codes, id), 90000);
    const rows = Array.isArray(body) ? body[1] || [] : [];
    // High income comes back with no ISO3 code, only its own id.
    const isoOf = (r) => r.countryiso3code || { XD: 'HIC', XO: 'LMY', '1W': 'WLD' }[r.country?.id];
    const points = rows.filter(r => r.value != null && isoOf(r)).map(r => ({
      series: `wb.${key}.${groupOf[isoOf(r)] || isoOf(r)}`, date: _yearEnd(r.date), value: bn ? r.value / 1e9 : r.value,
    }));
    saved += await _save(points, 'worldbank');
  }
  if (saved) await _done('world:wb', saved);
  return { saved };
}

async function refreshWorld() {
  const [imf, wb] = await Promise.allSettled([_refreshImf(), _refreshWorldBank()]);
  return { imf: imf.value ?? { error: imf.reason?.message }, wb: wb.value ?? { error: wb.reason?.message } };
}

// ── Reading ────────────────────────────────────────────────────────────────────

/** { metric: { iso: [{ year, value }] } } for the peers and groups, oldest first. */
async function _yearly(prefix) {
  const rows = await MacroPoint.find({ series: { $regex: `^${prefix}\\.` } }, { series: 1, date: 1, value: 1, _id: 0 }).sort({ date: 1 }).lean();
  const out = {};
  for (const r of rows) {
    const [, metric, iso] = r.series.split('.');
    ((out[metric] ||= {})[iso] ||= []).push({ year: +r.date.slice(0, 4), value: round(r.value, 2) });
  }
  return out;
}

/**
 * Who adds the world's growth in a year: each country's share of world output (PPP) times its growth.
 * Shares are of the world's growth, so the rows sum to 100 across every country.
 */
function _growthContributions(imf, year) {
  const share = imf.pppShare || {};
  const growth = imf.growth || {};
  const at = (arr) => arr?.find(p => p.year === year)?.value;
  const rows = Object.keys(share).filter(iso => !GROUPS.some(g => g.iso === iso))
    .map(iso => ({ iso, pp: (at(share[iso]) ?? 0) * (at(growth[iso]) ?? 0) / 100 }))
    .filter(r => r.pp);
  const total = rows.reduce((s, r) => s + r.pp, 0);
  if (!total) return null;
  const all = rows.map(r => ({ ...r, share: round(r.pp / total * 100, 1), pp: round(r.pp, 2) })).sort((a, b) => b.pp - a.pp);
  const top = all.slice(0, 10);
  const rest = all.slice(10);
  return {
    year, world: at(growth.WLD) ?? null, countries: all.length, rows: top,
    rest: { pp: round(rest.reduce((s, r) => s + r.pp, 0), 2), share: round(rest.reduce((s, r) => s + r.share, 0), 1), count: rest.length },
  };
}

let _cache = { at: 0, data: null };

/** IMF and World Bank figures for India's peers and the world, plus who is adding the world's growth. */
async function getWorld() {
  if (_cache.data && Date.now() - _cache.at < 60 * 60 * 1000) return _cache.data;
  const [imf, wb, namesDoc] = await Promise.all([_yearly('imf'), _yearly('wb'), MacroRelease.findOne({ key: 'world:names' }).lean()]);
  let names = {};
  try { names = JSON.parse(namesDoc?.title || '{}'); } catch { /* names are a courtesy */ }
  for (const p of PEERS) names[p.iso] = p.name;
  const keep = new Set([...PEERS.map(p => p.iso), ...GROUPS.map(g => g.iso)]);
  const contributions = {};
  const thisYear = new Date(todayMs()).getUTCFullYear();
  for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
    const c = _growthContributions(imf, y);
    if (c) contributions[y] = c;
  }
  // India's place by the size of its economy in dollars, among every country the IMF covers.
  const sizeRank = {};
  for (const y of [thisYear - 1, thisYear]) {
    const sized = Object.entries(imf.gdpUsd || {}).filter(([iso]) => !GROUPS.some(g => g.iso === iso))
      .map(([iso, arr]) => [iso, arr.find(p => p.year === y)?.value]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    const i = sized.findIndex(([iso]) => iso === 'IND');
    if (i >= 0) sizeRank[y] = { rank: i + 1, ahead: sized.slice(0, i).map(([iso]) => names[iso] || iso), of: sized.length };
  }
  for (const c of Object.values(contributions)) for (const r of c.rows) r.name = names[r.iso] || r.iso;
  // Only the peers leave; the all-country series exist to split the world's growth and rank its economies.
  for (const m of Object.keys(imf)) for (const iso of Object.keys(imf[m])) if (!keep.has(iso)) delete imf[m][iso];
  const data = {
    peers: PEERS.map(({ iso, name }) => ({ iso, name })),
    groups: GROUPS.map(({ iso, name }) => ({ iso, name })),
    imf, wb, contributions, sizeRank, thisYear,
  };
  _cache = { at: Date.now(), data };
  return data;
}

// ── Country markets ────────────────────────────────────────────────────────────

const MARKET_WINDOWS = ['1m', '3m', '6m', 'ytd', '1y', '3y', '5y'];
// What pulls money toward the dollar: US yields and the dollar itself.
const PULL = [{ key: 'us10y', symbol: '^TNX', name: 'US 10-year yield' }, { key: 'dxy', symbol: 'DX-Y.NYB', name: 'Dollar index' }];
let _marketsCache = { at: 0, data: null };

/** Each country's market in US dollars over standard windows, and the dollar's pull. Memoised 30 min. */
async function getMarkets() {
  if (_marketsCache.data && Date.now() - _marketsCache.at < 30 * 60 * 1000) return _marketsCache.data;
  const from = todayMs() - (5 * 365 + 15) * DAY_MS;
  const items = [...PEERS, ...GROUPS.filter(g => g.etf)];
  const returnsOf = async (symbol) => {
    const closes = await fetchDailyCloses(symbol, from, todayMs()).catch(() => ({}));
    const sorted = toSorted(closes);
    return { sorted, r: sorted.length ? windowReturns(sorted, MARKET_WINDOWS) : null };
  };
  const results = [];
  for (let i = 0; i < items.length; i += 5) {
    results.push(...await Promise.all(items.slice(i, i + 5).map(it => returnsOf(it.etf))));
  }
  const markets = items.map((it, i) => {
    const r = results[i].r;
    if (!r) return null;
    return {
      iso: it.iso, name: it.name, symbol: it.etf, group: GROUPS.some(g => g.iso === it.iso),
      returns: Object.fromEntries(['1d', ...MARKET_WINDOWS].map(k => [k, round(r[k], 2)])),
      cagr: { '3y': round(r['3yCagr'], 2), '5y': round(r['5yCagr'], 2) },
    };
  }).filter(Boolean);

  const pull = {};
  for (const p of PULL) {
    const { sorted } = await returnsOf(p.symbol);
    if (!sorted.length) continue;
    const last = sorted[sorted.length - 1];
    const yearAgo = [...sorted].reverse().find(([d]) => d <= last[0] - 365 * DAY_MS);
    const weekly = sorted.filter(([d], i) => i === sorted.length - 1 || new Date(d).getUTCDay() === 5)
      .filter(([d]) => d >= last[0] - 3 * 365 * DAY_MS);
    pull[p.key] = {
      name: p.name, value: round(last[1], 2), date: toDateStr(last[0]), yearAgo: yearAgo ? round(yearAgo[1], 2) : null,
      series: weekly.map(([d, v]) => ({ date: toDateStr(d), value: round(v, 2) })),
    };
  }
  const data = { markets, pull, through: toDateStr(todayMs()) };
  _marketsCache = { at: Date.now(), data };
  return data;
}

module.exports = { refreshWorld, getWorld, getMarkets, PEERS, GROUPS };
