/**
 * accountBalance service — balance reads.
 *
 * Cash is the store's T figure (`lastCashValue`). Assets are the account's share of
 * `portfolioService.assetValuesByAccount` — the SAME valuation the portfolio, the
 * net-worth headline and today's chart point use — at the T-1 close (settled) or live
 * prices (fetchLatestBal=true). The store's `assetTS[T-1]` is not used for a current
 * figure: it values YESTERDAY's holdings, so a buy settled from cash today dropped out of
 * the balance until tomorrow while the portfolio already counted it.
 *
 * Every response carries an `asof` date.
 */

const Account             = require('../models/Account');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const { assetValuesByAccount } = require('./portfolioService');

/** An account's store doc — unless the caller already loaded it. */
const loadStore = (accountId, userId, doc) =>
  doc ?? DailyAccountBalance.findOne({ account: accountId, user: userId }).lean();

/**
 * A downsampled trajectory of an account's total value, for the list's sparkline.
 *
 * Free, in practice: `GET /accounts` already loads every account's store document and
 * throws away all but two numbers from it. The shape of the last few months is sitting
 * right there, and a list of balances that cannot say which way any of them is moving
 * is a list of facts with the story removed.
 *
 * `cashTS` runs to T and `assetTS` only to T-1, so the asset side is carried forward a
 * day rather than dropping to zero on the final point — which would draw every account
 * falling off a cliff today.
 *
 * Buckets take their LAST value, not an average: a balance series is a step function,
 * and averaging would round off the very steps the line exists to show.
 *
 * @returns {number[]|null} `points` values, oldest first — or null if there is no shape
 *          to draw (a brand-new account, or one that has never moved).
 */
function accountSparkline(doc, { days = 90, points = 24 } = {}) {
  const cashTS  = doc?.cashTS  || [];
  const assetTS = doc?.assetTS || [];
  if (cashTS.length < 2) return null;

  const lastAsset = assetTS.length ? assetTS[assetTS.length - 1] : 0;
  const from      = Math.max(0, cashTS.length - days);

  const totals = [];
  for (let i = from; i < cashTS.length; i++) {
    totals.push(cashTS[i] + (i < assetTS.length ? assetTS[i] : lastAsset));
  }
  if (totals.length < 2) return null;

  // A perfectly flat account has no trajectory to plot; a straight line across the row
  // would imply we measured something when we did not.
  if (totals.every(v => Math.abs(v - totals[0]) < 1e-9)) return null;

  if (totals.length <= points) return totals;

  const out  = [];
  const step = totals.length / points;
  for (let i = 1; i <= points; i++) {
    out.push(totals[Math.min(totals.length - 1, Math.ceil(i * step) - 1)]);
  }
  return out;
}

/** Current cash balance (T) for an account — used for buy/adjustment validation. */
async function getAccountCashBalance(account, user, acctDoc = null) {
  const doc = await loadStore(account._id, user._id, acctDoc);
  return doc?.lastCashValue ?? 0;
}

/**
 * Asset value for a single account. `values` (from `assetValuesByAccount`) lets a caller
 * that reads several accounts value the book once.
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAccountAssetBalance(account, user, fetchLatestBal = false, values = null) {
  const v = values ?? await assetValuesByAccount(user._id, { live: fetchLatestBal });
  if (account.isDebt) return { value: 0, asof: v.asof };
  return { value: v.byAccount[account._id.toString()] || 0, asof: v.asof };
}

/**
 * Combined asset value across all of a user's accounts.
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAllAccountsAssetBalance(user, fetchLatestBal = false) {
  const [v, accounts] = await Promise.all([
    assetValuesByAccount(user._id, { live: fetchLatestBal }),
    Account.find({ user: user._id }).select('isDebt').lean(),
  ]);
  const value = accounts.filter(a => !a.isDebt).reduce((s, a) => s + (v.byAccount[a._id.toString()] || 0), 0);
  return { value, asof: v.asof, byAccount: v.byAccount };
}

/**
 * Total account balance (cash + assets). A debt account has no asset component.
 *
 * @returns {Promise<{ balance: number, cashBalance: number, assetBalance: number, asof: string }>}
 */
async function getAccountBalance(account, user, fetchLatestBal = false, acctDoc = null, values = null) {
  const [doc, v] = await Promise.all([
    loadStore(account._id, user._id, acctDoc),
    values ?? assetValuesByAccount(user._id, { live: fetchLatestBal }),
  ]);
  const cashBalance = doc?.lastCashValue ?? 0;
  const { value: assetBalance, asof } = await getAccountAssetBalance(account, user, fetchLatestBal, v);
  return { balance: cashBalance + assetBalance, cashBalance, assetBalance, asof };
}

module.exports = {
  accountSparkline,
  getAccountCashBalance,
  getAccountAssetBalance,
  getAllAccountsAssetBalance,
  getAccountBalance,
};
