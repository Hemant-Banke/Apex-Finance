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
 *   /mf              → the ENTIRE scheme list (~37k, 5.4 MB), mirrored into Mongo once
 *                      a day. SEARCH RUNS AGAINST THAT MIRROR, never over the network.
 *   /mf/{code}       → that scheme's ENTIRE NAV history (~128 KB), cached whole
 *   /mf/{code}/latest→ today's NAV
 */

// mfapi's first connection from a long-lived process can stall for ~10s. Prefer IPv4
// and enable Happy-Eyeballs fallback. index.js sets this process-wide before anything
// opens a socket; repeated here so scripts requiring this service directly match.
// (It is a mitigation, not the fix — the fix is that search never touches the network.)
require('dns').setDefaultResultOrder('ipv4first');
require('net').setDefaultAutoSelectFamily(true);

const MfScheme = require('../models/MfScheme');
const MfNav    = require('../models/MfNav');
const { DAY_MS } = require('../utils/constants');
const { midnight, midnight_from_ms, todayMs } = require('../utils/helpers');

const BASE = 'https://api.mfapi.in';

const SYMBOL_PREFIX = 'AMFI:';
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;  // NAVs are published once a day
/**
 * How old a cached latest-NAV may be before we go and refresh it. Funds publish on
 * business days only, so a NAV from last Friday is perfectly current on a Sunday —
 * hence days, not hours.
 */
const NAV_STALE_MS   = 4 * DAY_MS;
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
 * Does a query token match a candidate's token? Directional, and forgiving in two
 * specific ways:
 *
 *   PREFIX — the user is still typing. "small" must match "smallcap", or a search
 *            for "bandhan small" ranks the Bandhan Small Cap fund below noise.
 *   FUZZY  — a vision model misreads statement names ("Motilal Oswal" → "Oswai").
 *            One character's slip in a long word is forgiven.
 */
function _matches(qTok, cTok) {
  if (qTok === cTok) return true;
  if (qTok.length >= 3 && cTok.startsWith(qTok)) return true;
  return qTok.length >= 5 && cTok.length >= 5 && _editDistance(qTok, cTok) <= 1;
}

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
  const hit   = qTokens.filter(t => nt.some(c => _matches(t, c))).length;
  const extra = nt.filter(c => !qTokens.some(t => _matches(t, c))).length;
  return hit / qTokens.length - 0.25 * extra;
}

/** Ticker-shaped queries ("AAPL", "RELIANCE.NS", "BTC-USD") are never fund names. */
const TICKER_QUERY = /^[A-Za-z0-9.\-=^]{1,12}$/;
const looksLikeTicker = (q) => TICKER_QUERY.test(q) && (q === q.toUpperCase() || q.includes('.'));

const _escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── The local scheme index ──────────────────────────────────────────────────

const INDEX_TTL_MS   = 24 * 60 * 60 * 1000;   // the scheme list changes slowly
const INDEX_MIN_SIZE = 10000;                 // AMFI publishes ~37k schemes
let _indexPromise = null;

/**
 * Mirror EVERY AMFI scheme — name, ISINs, and its latest NAV — into Mongo in a SINGLE
 * call (`/mf/latest`, ~11 MB, ~37k schemes).
 *
 * This one request is the whole cache. Afterwards:
 *   - search runs against the local index, never the network;
 *   - any NAV on or after the scheme's `navDate` is served straight from `mfschemes`,
 *     so valuing a holding, pricing today in the asset form, and NAV-matching an
 *     imported statement all cost zero requests;
 *   - only a genuinely HISTORIC date reaches for `/mf/{code}` (cached thereafter).
 *
 * It is what makes search work at all, not just what makes it fast: querying mfapi per
 * keystroke was unreliable — its first connection from a long-lived process stalls for
 * ~10s, blowing the request budget and returning ZERO funds, so "bandhan" found nothing
 * while "bandhan small cap" found everything, seemingly at random.
 */
async function ensureSchemeIndex({ force = false } = {}) {
  if (!force) {
    const count = await MfScheme.estimatedDocumentCount();
    if (count >= INDEX_MIN_SIZE) {
      const newest = await MfScheme.findOne().sort({ updatedAt: -1 }).select('updatedAt').lean();
      const age = newest ? Date.now() - new Date(newest.updatedAt).getTime() : Infinity;
      if (age < INDEX_TTL_MS) return count;
    }
  }
  if (_indexPromise) return _indexPromise;   // collapse concurrent builds

  _indexPromise = (async () => {
    const list = await _json('/mf/latest', 90000);
    if (!Array.isArray(list) || !list.length) throw new Error('mfapi returned no schemes');

    const ops = [];
    for (const s of list) {
      if (!s.schemeCode || !s.schemeName) continue;
      const nav = parseFloat(s.nav);
      const day = parseMfDate(s.date);
      ops.push({
        updateOne: {
          filter: { schemeCode: String(s.schemeCode) },
          update: { $set: {
            name:         s.schemeName,
            nameNorm:     normalizeName(s.schemeName),
            fundHouse:    s.fundHouse || undefined,
            category:     s.schemeCategory || undefined,
            isinGrowth:   s.isinGrowth || undefined,
            isinDivReinv: s.isinDivReinvestment || undefined,
            ...(Number.isFinite(nav) && day != null
              ? { nav, navDate: new Date(day) }
              : {}),
          } },
          upsert: true,
        },
      });
    }

    for (let i = 0; i < ops.length; i += 5000) {
      await MfScheme.bulkWrite(ops.slice(i, i + 5000), { ordered: false });
    }
    return ops.length;
  })().finally(() => { _indexPromise = null; });

  return _indexPromise;
}

/** Name → the form search matches against (see MfScheme.nameNorm). */
const normalizeName = (s) => collapse(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Candidate schemes whose name contains every identifying token of the query.
 *
 * Substring matching against `nameNorm` is what makes partial typing work: "small"
 * hits "smallcap", and the compound collapse means "small cap" and "smallcap" are
 * the same string on both sides.
 */
async function _findCandidates(qTokens, cap = 200) {
  if (!qTokens.length) return [];

  const and = qTokens.map(t => ({ nameNorm: { $regex: _escapeRe(t) } }));
  let docs = await MfScheme.find({ $and: and }).limit(cap).lean();
  if (docs.length) return docs;

  // Nothing matched every token — one of them is probably OCR damage ("Motilal
  // Oswai"). Drop each in turn and pool what the rest find; the fuzzy scorer below
  // then rejects anything that is not really the fund. Local, so this is cheap.
  if (qTokens.length < 2) return [];

  const seen = new Map();
  for (let i = 0; i < qTokens.length; i++) {
    const subset = qTokens.filter((_, j) => j !== i);
    if (!subset.length) continue;
    const rows = await MfScheme.find({
      $and: subset.map(t => ({ nameNorm: { $regex: _escapeRe(t) } })),
    }).limit(cap).lean();
    for (const r of rows) if (!seen.has(r.schemeCode)) seen.set(r.schemeCode, r);
  }
  return [...seen.values()];
}

const _toQuote = (d) => ({
  symbol:   toMfSymbol(d.schemeCode),
  name:     d.name,
  type:     'mutual_fund',
  exchange: 'AMFI',
  currency: 'INR',
});

/**
 * Search Indian mutual funds. Every plan is its own fully-named scheme, so the user
 * picks Direct vs Regular and Growth vs IDCW explicitly — nothing is left ambiguous.
 * Runs against the local index: no network, no timeouts, no dropped results.
 */
async function searchSchemes(query, limit = 10) {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  if (looksLikeTicker(q)) return [];   // a ticker is never an AMFI scheme

  await ensureSchemeIndex();

  const qTokens = idTokens(q);
  const docs    = await _findCandidates(qTokens);
  if (!docs.length) return [];

  return docs
    .map(d => ({ d, score: _score(qTokens, d.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => _toQuote(d));
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
 * **Anything on or after the scheme's published `navDate` is served from `mfschemes`
 * with no network at all** — that covers the common cases (today's valuation, the
 * asset form's default date), which is why the daily refresh keeps that field warm.
 * Only a genuinely historic date reaches for the history, and that is cached too.
 */
async function getNavOn(schemeCode, dayMs) {
  const day = midnight_from_ms(dayMs);

  const scheme = await MfScheme.findOne({ schemeCode }).select('nav navDate').lean();
  if (scheme?.nav != null && scheme.navDate && day >= midnight(scheme.navDate)) {
    return scheme.nav;
  }

  const navs = await _loadHistory(schemeCode);
  const days = Object.keys(navs).map(Number).filter(d => d <= day).sort((a, b) => a - b);
  return days.length ? navs[days[days.length - 1]] : null;
}

/**
 * Latest published NAV per scheme → { [schemeCode]: nav }.
 *
 * Read from `mfschemes`. A scheme whose NAV is missing or stale is refreshed on the
 * spot (and folded into its cached history), so a fund used for the first time works
 * immediately rather than waiting for tomorrow's daily pass.
 */
async function getLatestNavs(schemeCodes = []) {
  const codes = [...new Set(schemeCodes)].filter(Boolean);
  if (!codes.length) return {};

  const docs   = await MfScheme.find({ schemeCode: { $in: codes } }).select('schemeCode nav navDate').lean();
  const byCode = Object.fromEntries(docs.map(d => [d.schemeCode, d]));
  const cutoff = todayMs() - NAV_STALE_MS;

  const out = {};
  const stale = [];
  for (const code of codes) {
    const d = byCode[code];
    if (d?.nav != null && d.navDate && midnight(d.navDate) >= cutoff) out[code] = d.nav;
    else stale.push(code);
  }

  if (stale.length) {
    const fresh = await Promise.all(stale.map(code => refreshLatestNav(code)));
    stale.forEach((code, i) => { if (fresh[i] != null) out[code] = fresh[i]; });
  }
  return out;
}

/**
 * Pull one scheme's newest NAV and write it to BOTH caches: `mfschemes` (so it can be
 * served without a network hop) and its cached history (so the series stays current
 * without re-downloading years of it).
 *
 * @returns {Promise<number|null>} the NAV, or null if it could not be fetched.
 */
async function refreshLatestNav(schemeCode) {
  let nav = null;
  let day = null;
  try {
    const d   = await _json(`/mf/${schemeCode}/latest`, 10000);
    const row = d?.data?.[0];
    nav = parseFloat(row?.nav);
    day = parseMfDate(row?.date);
  } catch { /* fall through */ }

  if (!Number.isFinite(nav) || day == null) {
    // Network trouble — serve whatever the cached history already knows.
    const navs = await _loadHistory(schemeCode, { allowStale: true });
    const days = Object.keys(navs).map(Number).sort((a, b) => a - b);
    return days.length ? navs[days[days.length - 1]] : null;
  }

  await MfScheme.updateOne(
    { schemeCode },
    { $set: { nav, navDate: new Date(day) } },
    { upsert: true },
  );
  // Extend the cached history by the one new day, rather than refetching the series.
  await MfNav.updateOne(
    { schemeCode, navs: { $exists: true } },
    { $set: { [`navs.${day}`]: nav, latestDay: day } },
  );

  return nav;
}

// ─── Daily refresh ───────────────────────────────────────────────────────────

/**
 * The once-a-day pass. ONE network call: `/mf/latest` re-mirrors every scheme AND its
 * newest NAV.
 *
 * The histories we hold (only for funds someone actually owns) are then topped up
 * from that same payload — a day appended locally, rather than re-downloading years
 * of a series to learn one number. History therefore stays ad-hoc: pulled in full the
 * first time a scheme is used, and kept current from here on.
 */
async function refreshDailyCaches() {
  const schemes = await ensureSchemeIndex({ force: true });

  const tracked = await MfNav.find().select('schemeCode').lean();
  if (!tracked.length) return { schemes, histories: 0 };

  const codes  = tracked.map(t => t.schemeCode);
  const latest = await MfScheme.find({ schemeCode: { $in: codes } })
    .select('schemeCode nav navDate').lean();

  const ops = [];
  for (const s of latest) {
    if (s.nav == null || !s.navDate) continue;
    const day = midnight(s.navDate);
    ops.push({
      updateOne: {
        filter: { schemeCode: s.schemeCode },
        update: { $set: { [`navs.${day}`]: s.nav, latestDay: day } },
      },
    });
  }
  if (ops.length) await MfNav.bulkWrite(ops, { ordered: false });

  return { schemes, histories: ops.length };
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
  ensureSchemeIndex,
  refreshDailyCaches,
  refreshLatestNav,
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
