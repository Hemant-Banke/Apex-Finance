/**
 * categoryService — read helpers over the category taxonomy (defaults + per-user).
 */

const Category     = require('../models/Category');
const UserCategory = require('../models/UserCategory');

/**
 * Build the user's category taxonomy as flat, LLM-friendly option lists per
 * transaction type. Secondary codes use the stored "parent/child" path form so
 * they match the value shape used everywhere else (e.g. "tp_food/ts_takeaway").
 *
 * @returns {Promise<{ expense: Array<{code,label}>, income: Array<{code,label}> }>}
 */
async function getUserCategoryTaxonomy(userId) {
  const [defaults, userDefined] = await Promise.all([
    Category.find().lean(),
    UserCategory.find({ user: userId }).lean(),
  ]);

  const all    = [...defaults, ...userDefined];
  const byCode = Object.fromEntries(all.map(c => [c.code, c]));
  const out    = { expense: [], income: [] };

  for (const c of all) {
    for (const type of (c.applicableTo || [])) {
      if (type !== 'expense' && type !== 'income') continue;
      if (c.level === 'primary') {
        out[type].push({ code: c.code, label: c.name });
      } else {
        const parent = byCode[c.parent];
        out[type].push({
          code:  `${c.parent}/${c.code}`,
          label: parent ? `${parent.name} / ${c.name}` : c.name,
        });
      }
    }
  }
  return out;
}

module.exports = { getUserCategoryTaxonomy };
