/**
 * mfService — the ONLY source for Indian mutual funds. Yahoo is never consulted for
 * them: not to search, not to resolve, not to price.
 *
 * Why: Yahoo reports every plan of an Indian fund under one identical name
 * ("Edelweiss Equity Savings Fund" ×7 — Direct/Regular × Growth/IDCW, indistinguishable),
 * offers foreign cross-listings of domestic funds, and is missing whole funds.
 * AMFI scheme codes are the real identifiers, and mfapi.in serves AMFI's registry and
 * its official daily NAVs as JSON.
 *
 * Symbols are namespaced `AMFI:<schemeCode>` so every layer downstream routes them
 * here on sight and can never send one to Yahoo by accident.
 *
 * Endpoints used:
 *   /mf/search?q=…   → every plan of a fund, each with its own scheme code
 *   /mf/{code}       → that scheme's ENTIRE NAV history (~128 KB), cached whole
 *   /mf/{code}/latest→ today's NAV
 */

// mfapi advertises an AAAA record that black-holes from some networks; undici tries
// IPv6 first and stalls for seconds where curl falls back instantly. index.js sets
// this process-wide before anything opens a socket; repeated here so scripts and
// tests that require this service directly get the same behaviour.
require('dns').setDefaultResultOrder('ipv4first');
require('net').setDefaultAutoSelectFamily(true);

const MfScheme = require('../models/MfScheme');
const MfNav    = require('../models/MfNav');
const { DAY_MS } = require('../utils/constants');
const { midnight_from_ms, todayMs } = require('../utils/helpers');

const BASE = 'https://api.mfapi.in';

const SYMBOL_PREFIX = 'AMFI:';
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;  // NAVs are published once a day
const NAV_TOLERANCE  = 0.02;                 // a statement NAV this close is the same plan

// ─── Symbols ─────────────────────────────────────────────────────────────────

const isMfSymbol   = (symbol) => typeof symbol === 'string' && symbol.startsWith(SYMBOL_PREFIX);
const toMfSymbol   = (schemeCode) => `${SYMBOL_PREFIX}${schemeCode}`;
const schemeCodeOf = (symbol) => (isMfSymbol(symbol) ? symbol.slice(SYMBOL_PREFIX.length) : null);

// ─── Fetching ────────────────────────────────────────────────────────────────

async function _json(path, timeoutMs = 15000) {
  const resp = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`mfapi ${resp.status} for ${path}`);
  return resp.json();
}

/** mfapi dates are "dd-mm-yyyy" → UTC-midnight ms. */
function parseMfDate(s) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s || '').trim());
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Words carrying no identifying information in a scheme name. */
const NOISE = new Set(['fund', 'scheme', 'the', 'of', 'and']);

/**
 * Plan/option words. They distinguish a scheme but not the FUND, so they must not
 * count against a name match — "Quant Small Cap Fund" should match every plan of it.
 */
const PLAN_WORDS = new Set([
  'plan', 'option', 'direct', 'regular', 'growth', 'idcw', 'dividend', 'bonus',
  'payout', 'reinvestment', 'monthly', 'quarterly', 'daily', 'weekly', 'annual', 'half', 'yearly',
]);

/**
 * AMFI writes "Midcap" where a statement writes "Mid Cap" (and vice versa), and the
 * search endpoint matches literally — "Invesco India Mid Cap Fund" returns only the
 * *Large & Mid Cap* fund, while "Invesco India Midcap" finds the real one. Collapse
 * the compounds so both spellings tokenize identically.
 */
const COMPOUNDS = /\b(mid|multi|small|large|flexi|micro|blue)\s+(cap|chip)\b/g;
const collapse  = (s) => (s || '').toLowerCase().replace(COMPOUNDS, '$1$2');
const expand    = (s) => (s || '').toLowerCase().replace(/\b(mid|multi|small|large|flexi|micro)(cap)\b/g, '$1 $2');

const tokens = (s) => collapse(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

const _DROPPABLE = [...NOISE, ...PLAN_WORDS];

/**
 * A noise/plan word, allowing for OCR damage — a vision model read "Fund" as "Fnd",
 * and an unrecognised "fnd" would otherwise count as an identifying word the fund's
 * real name lacks, sinking the match.
 */
const _isDroppable = (t) =>
  NOISE.has(t) || PLAN_WORDS.has(t) ||
  _DROPPABLE.some(w => w.length >= 4 && _editDistance(t, w) <= 1);

/** The tokens that actually identify a fund (not noise, not a plan/option word). */
const idTokens = (s) => tokens(s).filter(t => !_isDroppable(t));

/** Levenshtein distance, capped — we only ever care whether it is 0, 1, or "more". */
function _editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Token equality that survives OCR noise. Statement images are read by a vision
 * model, which misreads characters: "Motilal Oswal" came back as "Motilal Oswai".
 * An exact-match resolver rejects that outright, so a one-character slip in a
 * long-enough word is forgiven.
 */
const _tokenEq = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && _editDistance(a, b) <= 1);
const _hasToken = (list, t) => list.some(x => _tokenEq(x, t));

/**
 * Score a candidate scheme name against the wanted fund name.
 *
 * Rewards covering the wanted tokens, and PENALISES extra identifying words the
 * candidate adds: "Invesco India Large & Mid Cap" contains every token of "Invesco
 * India Mid Cap" and would otherwise tie with the real "Invesco India Midcap" — but
 * that "large" makes it a different fund.
 */
function _score(qTokens, name) {
  const nt = idTokens(name);
  if (!qTokens.length) return 0;
  const hit   = qTokens.filter(t => _hasToken(nt, t)).length;
  const extra = nt.filter(t => !_hasToken(qTokens, t)).length;
  return hit / qTokens.length - 0.25 * extra;
}

/**
 * Search Indian mutual funds. Every plan comes back as its own scheme with its own
 * full name, so the user picks Direct vs Regular and Growth vs IDCW explicitly —
 * there is nothing left to disambiguate.
 *
 * mfapi matches literally, so we try spelling variants and pool the hits.
 */
/** Ticker-shaped queries ("AAPL", "RELIANCE.NS", "BTC-USD") are never fund names. */
const TICKER_QUERY = /^[A-Za-z0-9.\-=^]{1,12}$/;
const looksLikeTicker = (q) => TICKER_QUERY.test(q) && (q === q.toUpperCase() || q.includes('.'));

/** Short-lived query cache — a type-ahead repeats the same prefixes constantly. */
const _searchCache = new Map();
const SEARCH_TTL_MS = 5 * 60 * 1000;

async function searchSchemes(query, limit = 10) {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  // A ticker cannot be an AMFI scheme — don't spend a call finding that out.
  if (looksLikeTicker(q)) return [];

  const cached = _searchCache.get(q.toLowerCase());
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit);

  // Type-ahead: a slow upstream must degrade, not hang. The fallback stages run one
  // after another, so a per-call timeout is not enough — three slow stages would
  // stack. Budget the WHOLE search instead: stages stop once it is spent, and we
  // rank whatever candidates we already have.
  const deadline  = Date.now() + 4000;
  const remaining = () => Math.max(500, deadline - Date.now());
  const spent     = () => Date.now() >= deadline;

  const qIds = idTokens(q);
  const core = qIds.join(' ');
  const primary = [...new Set([q, collapse(q), expand(q), core, expand(core)])]
    .filter(v => v.length >= 3);

  const pooled = new Map();

  const runVariants = async (variants) => {
    if (spent()) return;
    // In PARALLEL: a ladder of spelling variants walked serially costs a round-trip
    // each, and a mangled name walks the whole ladder — that measured 15s for one
    // statement. Latency is now one round-trip per stage, not per variant.
    const results = await Promise.all(variants.map(v =>
      _json(`/mf/search?q=${encodeURIComponent(v)}`, remaining()).catch(() => [])));
    for (const hits of results) {
      for (const h of (Array.isArray(hits) ? hits : [])) {
        if (!pooled.has(h.schemeCode)) pooled.set(h.schemeCode, h);
      }
    }
  };

  // Stage 1: the name as written. Almost always enough.
  await runVariants(primary.slice(0, 1));

  // Stage 2: alternate spellings — only when the first came back thin ("Mid Cap"
  // finding only the Large & Mid Cap fund, with the real "Midcap" one still unseen).
  if (pooled.size < 8 && primary.length > 1) await runVariants(primary.slice(1));

  // Stage 3: mfapi matches literally, so ONE misread character ("Motilal Oswai")
  // returns nothing at all — not even a candidate to score fuzzily against. Only
  // then, drop each token in turn so the remaining good ones can still find the fund.
  // Both spellings go out, since the literal index wants "Multi Cap", not "Multicap".
  if (!pooled.size && qIds.length >= 3) {
    const dropped = [];
    for (let i = 0; i < qIds.length; i++) {
      const without = qIds.filter((_, j) => j !== i).join(' ');
      dropped.push(expand(without), without);
    }
    await runVariants([...new Set(dropped)].filter(v => v.length >= 3));
  }

  if (!pooled.size) return [];

  const qTokens = idTokens(q);

  const results = [...pooled.values()]
    .map(h => ({ h, score: _score(qTokens, h.schemeName) }))
    .sort((a, b) => b.score - a.score)
    .map(({ h }) => ({
      symbol:   toMfSymbol(h.schemeCode),
      name:     h.schemeName,
      type:     'mutual_fund',
      exchange: 'AMFI',
      currency: 'INR',
    }));

  _searchCache.set(q.toLowerCase(), { at: Date.now(), results });
  return results.slice(0, limit);
}

// ─── NAV history ─────────────────────────────────────────────────────────────

/**
 * A scheme's full NAV history, cached. mfapi returns the whole series in one call,
 * so we store it whole: rebuilds that replay years of transactions cost nothing.
 * Refetched only when the cache is older than a day (a new NAV may have published).
 */
async function _loadHistory(schemeCode, { allowStale = false } = {}) {
  const cached = await MfNav.findOne({ schemeCode }).lean();
  const fresh  = cached?.fetchedAt && (Date.now() - new Date(cached.fetchedAt).getTime()) < HISTORY_TTL_MS;
  if (cached && (fresh || allowStale)) return cached.navs || {};

  let data;
  try {
    data = await _json(`/mf/${schemeCode}`, 20000);
  } catch {
    return cached?.navs || {};   // network trouble → serve what we have
  }

  const navs = {};
  let latestDay = null;
  for (const row of (data.data || [])) {
    const day = parseMfDate(row.date);
    const nav = parseFloat(row.nav);
    if (day == null || !Number.isFinite(nav)) continue;
    navs[day] = nav;
    if (latestDay == null || day > latestDay) latestDay = day;
  }
  if (!Object.keys(navs).length) return cached?.navs || {};

  await MfNav.updateOne(
    { schemeCode },
    { $set: { navs, latestDay, fetchedAt: new Date() } },
    { upsert: true },
  );

  // Keep the scheme registry in step — meta rides along with the history.
  const meta = data.meta || {};
  if (meta.scheme_name) {
    await MfScheme.updateOne(
      { schemeCode },
      { $set: {
        name:         meta.scheme_name,
        fundHouse:    meta.fund_house,
        category:     meta.scheme_category,
        isinGrowth:   meta.isin_growth || undefined,
        isinDivReinv: meta.isin_div_reinvestment || undefined,
        nav:          latestDay != null ? navs[latestDay] : undefined,
        navDate:      latestDay != null ? new Date(latestDay) : undefined,
      } },
      { upsert: true },
    );
  }

  return navs;
}

const _slice = (navs, from, to) => {
  const out = {};
  for (const [k, v] of Object.entries(navs || {})) {
    const d = Number(k);
    if (d >= from && d <= to) out[d] = v;
  }
  return out;
};

/** Daily NAVs over [fromMs, toMs] → { [dayMs]: nav }, in INR. */
async function getNavHistory(schemeCode, fromMs, toMs) {
  const navs = await _loadHistory(schemeCode);
  return _slice(navs, midnight_from_ms(fromMs), midnight_from_ms(toMs));
}

/**
 * NAV on a day, or the last one published before it (funds skip weekends/holidays).
 *
 * Asking for today — which is what the asset form does by default — is served by the
 * tiny /latest endpoint. Only a genuinely historic date pays for the full history
 * download, and then only once per scheme.
 */
async function getNavOn(schemeCode, dayMs) {
  const day = midnight_from_ms(dayMs);

  if (day >= midnight_from_ms(todayMs())) {
    try {
      const d   = await _json(`/mf/${schemeCode}/latest`, 10000);
      const nav = parseFloat(d?.data?.[0]?.nav);
      if (Number.isFinite(nav)) return nav;
    } catch { /* fall through to the history */ }
  }

  const navs = await _loadHistory(schemeCode);
  const days = Object.keys(navs).map(Number).filter(d => d <= day).sort((a, b) => a - b);
  return days.length ? navs[days[days.length - 1]] : null;
}

/** Latest published NAV per scheme → { [schemeCode]: nav }. */
async function getLatestNavs(schemeCodes = []) {
  const out = {};
  await Promise.all([...new Set(schemeCodes)].map(async (code) => {
    try {
      const d   = await _json(`/mf/${code}/latest`, 10000);
      const nav = parseFloat(d?.data?.[0]?.nav);
      if (Number.isFinite(nav)) { out[code] = nav; return; }
    } catch { /* fall through to the cached series */ }

    const navs = await _loadHistory(code, { allowStale: true });
    const days = Object.keys(navs).map(Number).sort((a, b) => a - b);
    if (days.length) out[code] = navs[days[days.length - 1]];
  }));
  return out;
}

/** Cached scheme metadata → { [schemeCode]: doc }. Fetches any we have not seen. */
async function getSchemes(schemeCodes = []) {
  const codes = [...new Set(schemeCodes)].filter(Boolean);
  if (!codes.length) return {};

  const docs  = await MfScheme.find({ schemeCode: { $in: codes } }).lean();
  const known = new Set(docs.map(d => d.schemeCode));

  const missing = codes.filter(c => !known.has(c));
  if (missing.length) {
    await Promise.all(missing.map(c => _loadHistory(c).catch(() => {})));
    const extra = await MfScheme.find({ schemeCode: { $in: missing } }).lean();
    docs.push(...extra);
  }

  return Object.fromEntries(docs.map(d => [d.schemeCode, d]));
}

// ─── Resolution (statement import) ───────────────────────────────────────────

/**
 * Identify the exact scheme a statement traded.
 *
 * A statement typically prints only "Quant Small Cap Fund" — silent about Direct vs
 * Regular, Growth vs IDCW — but it does print the NAV the order executed at, and the
 * plans' NAVs differ materially. So: match the name to get the fund's plans, then
 * match the traded NAV against each plan's actual NAV on the trade date. An ISIN,
 * when present, is decisive on its own.
 *
 * @returns {Promise<{scheme, matchedBy: 'isin'|'nav'|'name', ambiguous?: boolean}|null>}
 */
async function resolveScheme({ name, isin, nav, dateMs }) {
  if (isin) {
    const upper = String(isin).toUpperCase();
    const byIsin = await MfScheme.findOne({
      $or: [{ isinGrowth: upper }, { isinDivReinv: upper }],
    }).lean();
    if (byIsin) return { scheme: byIsin, matchedBy: 'isin' };
  }

  if (!name) return null;

  const candidates = await searchSchemes(name, 20);
  if (!candidates.length) return null;

  // Demand a strong match on the identifying words, so neither the fund house's name
  // alone ("Motilal Oswal Multi Cap" → "Motilal Oswal Ultra Short Term") nor a
  // superset fund ("Mid Cap" → "Large & Mid Cap") can carry it.
  const qTokens = idTokens(name);
  const strong  = candidates.filter(c => _score(qTokens, c.name) >= 0.9);
  if (!strong.length) return null;

  const asScheme = (c) => ({ schemeCode: schemeCodeOf(c.symbol), name: c.name });

  // Only ONE plan matches the name → there is nothing to disambiguate, so skip the
  // NAV check entirely. Each check costs a full history download, and this is the
  // common case for funds with a single plan.
  if (strong.length === 1) return { scheme: asScheme(strong[0]), matchedBy: 'name' };

  if (nav && dateMs) {
    // Price every candidate in PARALLEL — done serially, a fund with 8 plans took
    // 15s of round-trips on a cold cache.
    const scored = (await Promise.all(strong.map(async (c) => {
      const on = await getNavOn(schemeCodeOf(c.symbol), dateMs);
      return on == null ? null : { c, diff: Math.abs(on - nav) / nav };
    }))).filter(Boolean);

    const within = scored.filter(s => s.diff <= NAV_TOLERANCE).sort((a, b) => a.diff - b.diff);
    if (within.length) {
      // Plans can track each other almost exactly (a fund's Growth and Bonus NAVs
      // differ by ~0.04%), so NAV alone cannot separate them. Growth is far and away
      // the common holding — prefer it when several plans match the traded NAV.
      const growth = within.find(s => /growth/i.test(s.c.name));
      return { scheme: asScheme((growth || within[0]).c), matchedBy: 'nav' };
    }

    // The name matched but no plan's NAV lines up — flag it rather than pick a plan.
    return { scheme: asScheme(strong[0]), matchedBy: 'name', ambiguous: strong.length > 1 };
  }

  return { scheme: asScheme(strong[0]), matchedBy: 'name', ambiguous: strong.length > 1 };
}

module.exports = {
  SYMBOL_PREFIX,
  isMfSymbol,
  toMfSymbol,
  schemeCodeOf,
  searchSchemes,
  getNavHistory,
  getNavOn,
  getLatestNavs,
  getSchemes,
  resolveScheme,
};
