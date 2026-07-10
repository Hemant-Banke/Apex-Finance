/**
 * categoryProfileService — learns each user's categorization habits and uses
 * them to categorize future imports.
 *
 *   recordTransactions  — aggregate saved (user-confirmed) income/expense txns
 *                         into the per-user profile.
 *   predictFromProfile  — decisively categorize by learned merchant→category
 *                         dominance (no model call).
 *   getProfileSummary   — compact, model-friendly digest of the user's patterns.
 */

const UserCategoryProfile = require('../models/UserCategoryProfile');
const { extractMerchantTokens, isMiscCategory } = require('../lib/categoryRules');

// Mongo field names can't contain '.' or start with '$'.
const sanitize = k => k.replace(/^\$/, '_').replace(/\./g, '·');

const isIncomeExpense = t => t.type === 'income' || t.type === 'expense';

/**
 * Fold user-confirmed transactions into the profile. Misc/uncategorized and
 * non-cash rows are ignored so the profile only learns real signal.
 */
async function recordTransactions(userId, txns) {
  const relevant = (txns || []).filter(t =>
    isIncomeExpense(t) && t.category && t.category !== 'general' && !isMiscCategory(t.category));
  if (!relevant.length) return;

  const doc = (await UserCategoryProfile.findOne({ user: userId }))
    || new UserCategoryProfile({ user: userId, tokens: {}, categories: {} });

  const tokens = doc.tokens || {};
  const cats   = doc.categories || {};

  for (const t of relevant) {
    const cat = t.category;
    const amt = Number(t.amount) || 0;
    const dow = new Date(t.date).getUTCDay(); // 0..6

    for (const tok of extractMerchantTokens(t.narration || t.description || '')) {
      const key = sanitize(tok);
      (tokens[key] ??= {});
      tokens[key][cat] = (tokens[key][cat] || 0) + 1;
    }

    const c = (cats[cat] ??= { count: 0, amtSum: 0, amtSqSum: 0, dow: [0, 0, 0, 0, 0, 0, 0] });
    c.count    += 1;
    c.amtSum   += amt;
    c.amtSqSum += amt * amt;
    c.dow[dow]  = (c.dow[dow] || 0) + 1;

    doc.sampleCount = (doc.sampleCount || 0) + 1;
  }

  doc.tokens = tokens;
  doc.categories = cats;
  doc.markModified('tokens');
  doc.markModified('categories');
  await doc.save();
}

/**
 * Predict categories for items where a learned merchant token strongly favours
 * one category of the item's type. Returns { [id]: code } for confident items.
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

    const votes = {};
    let total = 0;
    for (const tok of extractMerchantTokens(it.narration || '')) {
      const counts = doc.tokens?.[sanitize(tok)];
      if (!counts) continue;
      for (const [cat, n] of Object.entries(counts)) {
        if (!allowed.has(cat)) continue; // only categories valid for this type
        votes[cat] = (votes[cat] || 0) + n;
        total += n;
      }
    }
    if (!total) continue;

    let best = null, bestN = 0;
    for (const [cat, n] of Object.entries(votes)) if (n > bestN) { best = cat; bestN = n; }
    // Confident when the dominant category has enough support and clear majority.
    if (best && bestN >= 3 && bestN / total >= 0.6) out[it.id] = best;
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

  // Strong merchant → category mappings.
  const merchantLines = [];
  for (const [tok, counts] of Object.entries(doc.tokens || {})) {
    let best = null, bestN = 0, total = 0;
    for (const [cat, n] of Object.entries(counts)) { total += n; if (n > bestN) { best = cat; bestN = n; } }
    if (best && bestN >= 2 && bestN / total >= 0.6 && labelOf[best]) {
      merchantLines.push({ line: `"${tok}" → ${labelOf[best]}`, n: bestN });
    }
  }
  merchantLines.sort((a, b) => b.n - a.n);

  // Per-category amount + day patterns.
  const catLines = [];
  for (const [cat, s] of Object.entries(doc.categories || {})) {
    if (!labelOf[cat] || !s.count) continue;
    const avg = Math.round(s.amtSum / s.count);
    const busiest = (s.dow || [])
      .map((n, i) => ({ d: DOW[i], n }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(x => x.d)
      .join('/');
    catLines.push(`${labelOf[cat]}: typical ~${avg}${busiest ? `, usually on ${busiest}` : ''} (${s.count} seen)`);
  }

  const parts = [];
  if (merchantLines.length) parts.push('Known merchants for this user:\n' + merchantLines.slice(0, 25).map(m => '- ' + m.line).join('\n'));
  if (catLines.length)      parts.push('This user\'s category patterns:\n' + catLines.slice(0, 25).map(c => '- ' + c).join('\n'));
  return parts.join('\n\n');
}

module.exports = { recordTransactions, predictFromProfile, getProfileSummary };
