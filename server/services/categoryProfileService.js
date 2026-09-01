/**
 * categoryProfileService — learns each user's categorization habits and uses
 * them to categorize future imports.
 *
 * One feature profile PER CATEGORY (merchants, day-of-week, day-of-month, amount
 * mean/std, recurrence frequency). A new transaction is classified by closest
 * SIMILARITY across those dimensions — no training, just a weighted comparison —
 * so it stays decisive only when the signal is strong, and otherwise falls through
 * to the LLM layer.
 *
 *   recordTransactions  — aggregate saved (user-confirmed) income/expense txns
 *                         into the per-user, per-category profile.
 *   predictFromProfile  — decisively categorize by closest similarity (no model call).
 *   getProfileSummary   — compact, model-friendly digest of the user's patterns.
 *   rebuildProfile      — wipe and replay a user's full transaction history. Profiles
 *                         are 100% derived from transactions, so this is how an
 *                         existing user moves onto a changed feature set.
 */

const UserCategoryProfile = require('../models/UserCategoryProfile');
const Transaction         = require('../models/Transaction');
const { extractMerchantTokens, isMiscCategory } = require('../lib/categoryRules');
const { DAY_MS } = require('../utils/constants');

// Mongo field names can't contain '.' or start with '$'.
const sanitize = k => k.replace(/^\$/, '_').replace(/\./g, '·');

const isIncomeExpense = t => t.type === 'income' || t.type === 'expense';

const emptyCategory = () => ({
  merchants: {}, dow: [0, 0, 0, 0, 0, 0, 0], dom: new Array(31).fill(0),
  count: 0, amtSum: 0, amtSqSum: 0, firstDate: null, lastDate: null,
});

/**
 * Fold user-confirmed transactions into the profile. Misc/uncategorized and
 * non-cash rows are ignored so the profile only learns real signal.
 */
async function recordTransactions(userId, txns) {
  const relevant = (txns || []).filter(t =>
    isIncomeExpense(t) && t.category && t.category !== 'general' && !isMiscCategory(t.category));
  if (!relevant.length) return;

  // Upsert rather than find-or-construct: two requests arriving together would both
  // see no profile, both build one, and the loser would die on the unique `user` index.
  // This still races on the READ-MODIFY-WRITE below, which is why callers hand over a
  // whole batch in one call instead of one call per row.
  const doc = await UserCategoryProfile.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const cats = doc.categories || {};

  for (const t of relevant) {
    const amt = Number(t.amount) || 0;
    const d   = new Date(t.date);
    if (isNaN(d)) continue;
    const ms  = d.getTime();
    const dow = d.getUTCDay();
    const dom = d.getUTCDate() - 1; // 0..30

    const c = (cats[t.category] ??= emptyCategory());
    c.count    += 1;
    c.amtSum   += amt;
    c.amtSqSum += amt * amt;
    c.dow[dow]  = (c.dow[dow] || 0) + 1;
    c.dom[dom]  = (c.dom[dom] || 0) + 1;
    c.firstDate = c.firstDate == null ? ms : Math.min(c.firstDate, ms);
    c.lastDate  = c.lastDate  == null ? ms : Math.max(c.lastDate,  ms);

    for (const tok of extractMerchantTokens(t.narration || t.notes || '')) {
      const key = sanitize(tok);
      // Mongoose `minimize` strips an empty `merchants: {}` on save (no tokens ever
      // matched for this category yet), so a re-fetched doc can be missing the key
      // entirely — restore it before writing into it.
      c.merchants ??= {};
      c.merchants[key] = (c.merchants[key] || 0) + 1;
    }

    doc.sampleCount = (doc.sampleCount || 0) + 1;
  }

  doc.categories = cats;
  doc.markModified('categories');
  await doc.save();
}

/**
 * Gaussian kernel, peaked at 1 when `x` sits at `mean`, decaying with `spread`
 * (the standard deviation). A zero/undefined spread means "not enough signal" —
 * the caller treats that as neutral rather than dividing by zero.
 */
function gaussian(x, mean, spread) {
  if (!spread || !Number.isFinite(spread)) return 0.5;
  const z = (x - mean) / spread;
  return Math.exp(-0.5 * z * z);
}

/**
 * Similarity of a candidate transaction to one category's stored profile, across
 * every stored dimension. Merchant match dominates (it is the highest-precision
 * signal); amount, day-of-week, day-of-month and recurrence frequency refine it.
 *
 * @returns {{ score, merchantShare }}
 */
function similarity(c, { tokens, merchantHits, merchantTotal, amt, dow, dom, dateMs }) {
  const merchantShare = merchantTotal ? (merchantHits / merchantTotal) : 0;

  let amtScore = 0.5;
  if (c.count >= 2 && c.amtSum) {
    const mean     = c.amtSum / c.count;
    const variance = Math.max(c.amtSqSum / c.count - mean * mean, 0);
    const std      = Math.sqrt(variance) || Math.abs(mean) * 0.25 || 1;
    amtScore = gaussian(amt, mean, std);
  }

  const dowScore = (dow != null && c.count) ? (c.dow[dow] || 0) / c.count : 0.5;
  const domScore = (dom != null && c.count) ? (c.dom[dom] || 0) / c.count : 0.5;

  // Recurrence: compare the gap since this category's last occurrence against its
  // historical average gap. A category due again "on schedule" scores highly even
  // when its merchant text varies occurrence to occurrence.
  let freqScore = 0.5;
  if (dateMs != null && c.count >= 2 && c.lastDate > c.firstDate) {
    const spanDays        = (c.lastDate - c.firstDate) / DAY_MS;
    const expectedGapDays = spanDays / (c.count - 1);
    const actualGapDays   = Math.abs(dateMs - c.lastDate) / DAY_MS;
    const ratio           = actualGapDays / Math.max(expectedGapDays, 0.5);
    // Gaussian in log-space so being twice as early counts the same as being twice
    // as late, and it peaks at ratio=1 (right on schedule).
    freqScore = gaussian(Math.log(Math.max(ratio, 0.05)), 0, 0.75);
  }

  const score = 0.55 * merchantShare + 0.20 * amtScore + 0.10 * dowScore + 0.05 * domScore + 0.10 * freqScore;
  return { score, merchantShare };
}

/**
 * Predict categories for items whose closest-matching category is decisively
 * closer than the runner-up. Returns `{ [id]: { code, confidence } }` for
 * confident items — the caller shows the score, so "your past choices" can be
 * distinguished from "your past choices, barely".
 *
 * @param {Array<{id,type,narration,amount,date}>} items
 * @param {{ expense: Set<string>, income: Set<string> }} validByType
 */
async function predictFromProfile(userId, items, validByType) {
  const doc = await UserCategoryProfile.findOne({ user: userId }).lean();
  if (!doc?.sampleCount) return {};

  const out = {};
  for (const it of items) {
    const allowed = validByType[it.type];
    if (!allowed) continue;

    const candidates = Object.entries(doc.categories || {}).filter(([code]) => allowed.has(code));
    if (!candidates.length) continue;

    const tokens = extractMerchantTokens(it.narration || '');
    const amt    = Number(it.amount) || 0;
    const d      = it.date ? new Date(it.date) : null;
    const valid  = d && !isNaN(d);
    const dow    = valid ? d.getUTCDay() : null;
    const dom    = valid ? d.getUTCDate() - 1 : null;
    const dateMs = valid ? d.getTime() : null;

    // Merchant hits per candidate, and the total across all candidates — the same
    // vote-share basis the old token-only model used, now folded into `similarity`.
    const merchantHits = {};
    let merchantTotal = 0;
    for (const tok of tokens) {
      const key = sanitize(tok);
      for (const [code, c] of candidates) {
        const n = c.merchants?.[key];
        if (!n) continue;
        merchantHits[code] = (merchantHits[code] || 0) + n;
        merchantTotal += n;
      }
    }

    let best = null, bestScore = -Infinity, bestShare = 0, secondScore = -Infinity;
    for (const [code, c] of candidates) {
      const { score, merchantShare } = similarity(c, {
        tokens, merchantHits: merchantHits[code] || 0, merchantTotal, amt, dow, dom, dateMs,
      });
      if (score > bestScore) {
        secondScore = bestScore;
        best = code; bestScore = score; bestShare = merchantShare;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
    if (secondScore === -Infinity) secondScore = 0;

    // Decisive requires real merchant support (mirrors the old bar) AND a combined
    // score that clearly beats the runner-up — a near-tie must not be settled by the
    // weaker day/amount signals alone.
    const margin = bestScore - secondScore;
    if (best && merchantTotal >= 3 && bestShare >= 0.5 && bestScore >= 0.55 && margin >= 0.15) {
      // Everything here has already cleared the decisive bar, so the floor is high.
      // What separates a good match from a great one is the MARGIN over the runner-up:
      // a category that won by a hair is a different proposition from one nothing else
      // came close to, and the review UI should be able to say which this was.
      out[it.id] = {
        code:       best,
        confidence: Math.min(0.95, 0.70 + 0.25 * Math.min(1, (margin - 0.15) / 0.35)),
      };
    }
  }
  return out;
}

/**
 * A compact digest of the user's habits for the LLM: strong merchant→category
 * mappings and each category's typical amount and busiest weekdays.
 */
async function getProfileSummary(userId, taxonomy) {
  const doc = await UserCategoryProfile.findOne({ user: userId }).lean();
  if (!doc?.sampleCount) return '';

  const labelOf = Object.fromEntries(
    [...(taxonomy.expense || []), ...(taxonomy.income || [])].map(o => [o.code, o.label]));
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Strong merchant → category mappings — built by inverting the per-category
  // merchant maps back to a token index, same as the old global one, but derived.
  const tokenTotals = {};
  for (const [code, c] of Object.entries(doc.categories || {})) {
    for (const [tok, n] of Object.entries(c.merchants || {})) {
      (tokenTotals[tok] ??= {})[code] = (tokenTotals[tok][code] || 0) + n;
    }
  }
  const merchantLines = [];
  for (const [tok, counts] of Object.entries(tokenTotals)) {
    let best = null, bestN = 0, total = 0;
    for (const [cat, n] of Object.entries(counts)) { total += n; if (n > bestN) { best = cat; bestN = n; } }
    if (best && bestN >= 2 && bestN / total >= 0.6 && labelOf[best]) {
      merchantLines.push({ line: `"${tok}" → ${labelOf[best]}`, n: bestN });
    }
  }
  merchantLines.sort((a, b) => b.n - a.n);

  // Per-category amount + day + recurrence patterns.
  const catLines = [];
  for (const [cat, c] of Object.entries(doc.categories || {})) {
    if (!labelOf[cat] || !c.count) continue;
    const avg = Math.round(c.amtSum / c.count);
    const busiest = (c.dow || [])
      .map((n, i) => ({ d: DOW[i], n }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(x => x.d)
      .join('/');
    const cadence = (c.count >= 2 && c.lastDate > c.firstDate)
      ? `, about every ${Math.round((c.lastDate - c.firstDate) / DAY_MS / (c.count - 1))}d`
      : '';
    catLines.push(`${labelOf[cat]}: typical ~${avg}${busiest ? `, usually on ${busiest}` : ''}${cadence} (${c.count} seen)`);
  }

  const parts = [];
  if (merchantLines.length) parts.push('Known merchants for this user:\n' + merchantLines.slice(0, 25).map(m => '- ' + m.line).join('\n'));
  if (catLines.length)      parts.push('This user\'s category patterns:\n' + catLines.slice(0, 25).map(c => '- ' + c).join('\n'));
  return parts.join('\n\n');
}

/**
 * Wipe and replay a user's full transaction history into the profile. Profiles are
 * 100% derived from confirmed income/expense transactions (like AccountHoldings or
 * the daily stores), so this is both how a user migrates onto a changed feature set
 * and how the profile can always be regenerated from scratch if it drifts.
 *
 * `narration` is never persisted on a Transaction (see routes/transactions.js) — only
 * the import flow has it, transiently, at save time. Historical replay therefore
 * learns merchant tokens from `notes`, the one free-text field that IS persisted.
 */
async function rebuildProfile(userId) {
  await UserCategoryProfile.deleteOne({ user: userId });

  const txns = await Transaction.find({ user: userId, type: { $in: ['income', 'expense'] } })
    .select('type category amount date notes')
    .sort({ date: 1 })
    .lean();

  await recordTransactions(userId, txns.map(t => ({
    type: t.type, category: t.category, amount: t.amount, date: t.date, narration: t.notes,
  })));
}

module.exports = { recordTransactions, predictFromProfile, getProfileSummary, rebuildProfile };
