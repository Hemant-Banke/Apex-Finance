/**
 * symbolResolver — turn whatever an imported statement calls an instrument into a
 * real, priceable market symbol.
 *
 * Statements identify assets in three different ways, and we have to survive all of them:
 *
 *   1. A proper ticker            — "RELIANCE.NS"  → validate and keep.
 *   2. A bare ticker, no exchange — "RELIANCE"     → try .NS, then .BO, then as-is (US).
 *   3. A name and nothing else    — "Quant Small Cap Fund" (typical of mutual-fund
 *                                    order lists) → search Yahoo by name.
 *
 * Case 3 is ambiguous for Indian mutual funds: every plan of a fund (Direct/Regular ×
 * Growth/IDCW) is reported under one identical name, and the plan appears in no field
 * Yahoo exposes. But an order row carries the **NAV it transacted at**, and the plans'
 * NAVs differ — so we price each candidate on the trade date and keep the one whose
 * NAV matches the statement. That is a precise identification, not a guess.
 *
 * Unresolved assets are left alone (the name becomes the symbol, as before) and flagged
 * so the UI can ask the user, rather than silently inventing a ticker that prices to nothing.
 */

const { YF_HEADERS, DAY_MS } = require('../utils/constants');
const { mapQuoteType, resolveQuoteName, midnight } = require('../utils/helpers');
const { fetchHistoricPrices, fetchQuoteMeta } = require('./marketDataService');
const mfService = require('./mfService');

/** An ISIN, if the statement printed one (they identify a fund plan outright). */
const _isinIn = (s) => (/\b(IN[A-Z0-9]{10})\b/.exec(String(s || '').toUpperCase()) || [])[1] || null;

/** Exchange suffixes to try for a bare ticker, most likely first (this is an INR app). */
const SUFFIXES = ['.NS', '.BO', ''];

/** A statement NAV within this fraction of a candidate's NAV counts as the same fund. */
const NAV_TOLERANCE = 0.02;

/** Fraction of a name's significant tokens a candidate must carry to be believed. */
const NAME_THRESHOLD = 0.7;

/** Looks like a ticker rather than a name: short, no spaces. */
const looksLikeTicker = (s) => !!s && !/\s/.test(s) && s.length <= 20;

/** Resolutions are stable within a run; an import repeats the same few funds. */
const _cache = new Map();

// ─── Yahoo lookups ───────────────────────────────────────────────────────────

/**
 * Yahoo's Morningstar-coded Indian mutual funds. These must NEVER be resolved to:
 * Indian funds come from AMFI alone. Without this, a fund AMFI failed to match (an
 * OCR typo in its name, say) would quietly fall through and be booked against an
 * opaque Yahoo code that cannot tell one plan of the fund from another.
 */
const INDIAN_MF_SYMBOL = /^0P\w+\.(BO|NS)$/i;

async function _search(query) {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search`
              + `?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
    const resp = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.quotes || [])
      .filter(q => q.symbol && q.quoteType !== 'INDEX')
      .filter(q => !INDIAN_MF_SYMBOL.test(q.symbol))
      .map(q => ({
        symbol:   q.symbol,
        name:     resolveQuoteName(q),
        type:     mapQuoteType(q.quoteType),
        exchange: q.exchDisp || q.exchange || '',
      }));
  } catch {
    return [];
  }
}

/**
 * Words that carry no identifying information in a fund name. Yahoo's search
 * returns NOTHING for "Invesco India Mid Cap Fund" but three hits for
 * "Invesco India Mid Cap" — the trailing noise word sinks the whole query.
 */
const NOISE_WORDS = new Set([
  'fund', 'funds', 'scheme', 'plan', 'option', 'direct', 'regular',
  'growth', 'idcw', 'dividend', 'payout', 'reinvestment', 'ltd', 'limited',
]);

/**
 * Yahoo's search is brittle about long queries, so try progressively shorter ones
 * and take the first that returns anything: the full name, then the name without
 * noise words, then its leading 4/3/2 significant tokens.
 */
async function _searchWithFallback(name) {
  const tokens = _norm(name);
  const core   = tokens.filter(t => !NOISE_WORDS.has(t));

  const queries = [
    name,
    core.join(' '),
    core.slice(0, 4).join(' '),
    core.slice(0, 3).join(' '),
    core.slice(0, 2).join(' '),
  ];

  const tried = new Set();
  for (const q of queries) {
    const query = (q || '').trim();
    if (query.length < 3 || tried.has(query)) continue;
    tried.add(query);
    const hits = await _search(query);
    if (hits.length) return hits;
  }
  return [];
}

/** Indian listings — this is an INR app, and Yahoo mixes in foreign cross-listings. */
const _isIndian = (c) => /bombay|bse|nse|national/i.test(c.exchange || '');

/** A candidate's price on (or just before) a given day — for NAV matching. */
async function _priceOn(symbol, assetType, dateMs) {
  const items  = [{ assetSymbol: symbol, assetType: assetType || 'stock' }];
  const series = (await fetchHistoricPrices(items, dateMs - 10 * DAY_MS, dateMs))[symbol] || {};
  const days   = Object.keys(series).map(Number).filter(d => d <= dateMs).sort((a, b) => a - b);
  return days.length ? series[days[days.length - 1]] : null;
}

// ─── Matching ────────────────────────────────────────────────────────────────

const _norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * How well a candidate name matches the wanted one (0..1), ignoring noise words —
 * the wanted "Quant Small Cap Fund" and the candidate "Quant Small Cap Dir Gr"
 * describe the same fund, and only the significant tokens should decide that.
 */
function _nameScore(wanted, candidate) {
  const w = _norm(wanted).filter(t => !NOISE_WORDS.has(t));
  const c = new Set(_norm(candidate));
  if (!w.length) return 0;
  return w.filter(t => c.has(t)).length / w.length;
}

/**
 * Choose among candidates that tie on name by matching the statement's NAV against
 * each one's actual price on the trade date. This is what separates a fund's
 * Direct/Regular/Growth/IDCW plans, which are otherwise indistinguishable — and it
 * also rejects a foreign cross-listing whose NAV is nowhere near.
 *
 * Returns the closest candidate either way, but only sets `navMatched` when the NAV
 * genuinely lines up; otherwise the row is flagged for the user to confirm.
 */
async function _disambiguateByNav(candidates, { pricePerUnit, dateMs, assetType }) {
  // Prefer the domestic listing when we can't price-match (Yahoo mixes in foreign
  // cross-listings of Indian funds — a Stuttgart line for a Bombay fund).
  const preferred = candidates.filter(_isIndian);
  const pool      = preferred.length ? preferred : candidates;

  if (!pricePerUnit || !dateMs) return pool[0];

  const priced = await Promise.all(
    pool.map(async (c) => ({ c, nav: await _priceOn(c.symbol, assetType, dateMs) })),
  );

  let best = null;
  for (const { c, nav } of priced) {
    if (nav == null) continue;
    const diff = Math.abs(nav - pricePerUnit) / pricePerUnit;
    if (!best || diff < best.diff) best = { c, diff, nav };
  }

  if (!best) return pool[0];
  // Close enough to be the same plan → trust it. Otherwise keep the nearest, but
  // say so, because the statement's actual plan may not be listed on Yahoo at all.
  return best.diff <= NAV_TOLERANCE
    ? { ...best.c, navMatched: true }
    : { ...best.c, navMismatch: true, foundNav: best.nav };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Resolve one asset to a market symbol.
 *
 * @param {{symbol?: string, name?: string, assetType?: string, pricePerUnit?: number, date?: string}} asset
 * @returns {Promise<{assetSymbol, assetName, assetType, currency, navMatched, resolved}|null>}
 *          null when nothing credible was found — the caller keeps the raw name.
 */
async function resolveAsset({ symbol, name, assetType, pricePerUnit, date }) {
  const key = `${symbol || ''}|${name || ''}|${assetType || ''}|${pricePerUnit || ''}|${date || ''}`;
  if (_cache.has(key)) return _cache.get(key);

  const result = await _resolve({ symbol, name, assetType, pricePerUnit, date });
  _cache.set(key, result);
  return result;
}

async function _resolve({ symbol, name, assetType, pricePerUnit, date }) {
  const dateMs = date ? midnight(date) : null;

  // ── Mutual funds resolve against AMFI and NOWHERE ELSE.
  //
  // If AMFI cannot match it we stop here rather than falling through to Yahoo. That
  // fallthrough looked helpful (it would catch a US fund) but it is a trap: a
  // slightly-misread Indian fund name — "Quant Small Cap Fnd" — matched Yahoo's US
  // "TIAA-CREF Quant Small-Cap" and would have been booked as a foreign equity fund.
  // An unresolved row the user fixes in review is far safer than a confident wrong one.
  if (assetType === 'mutual_fund') {
    const hit = await mfService.resolveScheme({
      name, isin: _isinIn(symbol) || _isinIn(name), nav: pricePerUnit, dateMs,
    });
    if (!hit) return null;

    return {
      assetSymbol: mfService.toMfSymbol(hit.scheme.schemeCode),
      assetName:   hit.scheme.name,
      assetType:   'mutual_fund',
      currency:    'INR',
      navMatched:  hit.matchedBy === 'nav' || hit.matchedBy === 'isin',
      ambiguous:   !!hit.ambiguous,
      resolved:    true,
    };
  }

  // ── 1/2. A ticker was given. Try it, and if it carries no exchange, try the
  //         Indian listings before falling back to a bare (US) symbol.
  if (looksLikeTicker(symbol)) {
    const upper     = symbol.toUpperCase();
    const hasSuffix = upper.includes('.');
    const tries     = hasSuffix ? [upper] : SUFFIXES.map(sfx => `${upper}${sfx}`);

    const meta = await fetchQuoteMeta(tries);
    for (const candidate of tries) {
      if (meta[candidate]) {
        return {
          assetSymbol: candidate,
          assetName:   name || candidate,
          assetType:   assetType || 'stock',
          currency:    meta[candidate].currency || '',
          resolved:    true,
        };
      }
    }
    // A ticker that prices nowhere is probably not a ticker — fall through to the name.
  }

  // ── 3. Name only (or an unusable ticker): search, then disambiguate.
  const query = name || symbol;
  if (!query) return null;

  let quotes = await _searchWithFallback(query);
  if (!quotes.length) return null;

  // Prefer candidates of the expected instrument type when we know it.
  const typed = assetType ? quotes.filter(q => q.type === assetType) : [];
  if (typed.length) quotes = typed;

  const scored = quotes
    .map(q => ({ ...q, score: _nameScore(query, q.name) }))
    .sort((a, b) => b.score - a.score);

  // Demand a strong name match. At a loose threshold "Motilal Oswal Multi Cap Fund"
  // scores 0.5 against "Motilal Oswal Ultra S/T" purely on the fund house's name —
  // an entirely different fund. Leaving it unresolved for the user is far better
  // than importing a confident wrong answer.
  const top = scored[0];
  if (!top || top.score < NAME_THRESHOLD) return null;

  // Every candidate sharing the top score is a name-tie (the mutual-fund plan case).
  const ties = scored.filter(q => q.score === top.score);
  const pick = ties.length > 1
    ? await _disambiguateByNav(ties, { pricePerUnit, dateMs, assetType: assetType || top.type })
    : top;

  const meta = await fetchQuoteMeta([pick.symbol]);

  return {
    assetSymbol: pick.symbol,
    assetName:   pick.name || name,
    assetType:   pick.type || assetType || 'stock',
    currency:    meta[pick.symbol]?.currency || '',
    navMatched:  !!pick.navMatched,
    resolved:    true,
    // Name matched but the NAV did not — most likely the exact plan the statement
    // traded is not listed on Yahoo. Surface it rather than quietly booking it.
    ambiguous:   !!pick.navMismatch,
    foundNav:    pick.foundNav,
  };
}

/**
 * Resolve every buy/sell row of a parsed statement in place.
 *
 * Rows that resolve get the real ticker, canonical name, type and currency. Rows that
 * don't are left as they were and marked `symbolUnresolved`, so the review UI can flag
 * them instead of importing a symbol that will never price.
 */
async function resolveStatementAssets(transactions = []) {
  const assetRows = transactions.filter(t => t.type === 'buy' || t.type === 'sell');
  if (!assetRows.length) return transactions;

  // In parallel, but capped: a statement of 8 rows resolved serially is 8 × the
  // round-trips, and a mangled name walks a whole fallback ladder inside each one.
  // The cache collapses an import's repeated funds to a single lookup regardless.
  const CONCURRENCY = 4;
  for (let i = 0; i < assetRows.length; i += CONCURRENCY) {
    await Promise.all(assetRows.slice(i, i + CONCURRENCY).map(async (tx) => {
      const hit = await resolveAsset({
        symbol:       tx.assetSymbol,
        name:         tx.assetName,
        assetType:    tx.assetType,
        pricePerUnit: tx.pricePerUnit,
        date:         tx.date,
      });

      if (!hit) {
        tx.symbolUnresolved = true;
        return;
      }

      tx.assetSymbol = hit.assetSymbol;
      tx.assetName   = hit.assetName;
      tx.assetType   = hit.assetType;
      if (hit.currency && hit.currency !== 'INR') tx.currency = hit.currency;
      if (hit.navMatched) tx.navMatched = true;
      if (hit.ambiguous)  tx.symbolAmbiguous = true;
    }));
  }

  return transactions;
}

module.exports = {
  resolveAsset,
  resolveStatementAssets,
};
