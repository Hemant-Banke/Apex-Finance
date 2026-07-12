/**
 * accountBalance service — O(1) reads from the pre-computed stores.
 *
 * Default (settled): balance = settledValue = lastCashValue (T) + assetTS[T-1].
 * Live (fetchLatestBal=true): balance = lastCashValue (T) + live asset prices.
 *
 * All balance reads operate on RAW stored holdings ({ assetSymbol, units, … }).
 * Every response carries an `asof` date.
 */

const Account             = require('../models/Account');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings     = require('../models/AccountHoldings');
const { fetchLatestPrices } = require('./marketDataService');
const { todayStr, t1Str, todayMs, midnight } = require('../utils/helpers');
const { resolveUnitPrice }  = require('../utils/assetPricing');

/** An account's store doc — unless the caller already loaded it. */
const loadStore = (accountId, userId, doc) =>
  doc ?? DailyAccountBalance.findOne({ account: accountId, user: userId }).lean();

/** An account's raw holdings array (or []). */
async function loadHoldings(accountId, userId) {
  const doc = await AccountHoldings.findOne({ account: accountId, user: userId }).select('holdings').lean();
  return doc?.holdings || [];
}

/** The positions an account actually holds — a closed one values at nothing. */
const openPositions = (holdings) => (holdings || []).filter(h => (h.units || 0) > 0);

/**
 * Mark a set of holdings to market, in ONE batched price call.
 *
 * A market quote wins (scaled by purity for physical metal); failing that the cost
 * basis accrues at the holding's annual rate. `null` from `resolveUnitPrice` means we
 * genuinely cannot price that holding — and rather than count it as zero and quietly
 * under-report the total, the whole valuation is abandoned, so the caller can fall
 * back to the last settled (T-1) figure instead.
 *
 * @returns {Promise<number|null>} INR market value, or null if any holding is unpriceable.
 */
async function markToMarket(holdings) {
  if (!holdings.length) return 0;

  const prices = await fetchLatestPrices(holdings);
  const atMs   = todayMs();

  let total = 0;
  for (const h of holdings) {
    const price = resolveUnitPrice(h, {
      marketPrice: prices[h.assetSymbol] ?? null,
      basePrice:   h.avgPricePerUnit ?? null,
      basisMs:     midnight(h.lastTransactionDate || h.firstPurchaseDate || Date.now()),
      atMs,
    });
    if (price == null) return null;
    total += h.units * price;
  }
  return total;
}

/** Current cash balance (T) for an account — used for buy/adjustment validation. */
async function getAccountCashBalance(account, user, acctDoc = null) {
  const doc = await loadStore(account._id, user._id, acctDoc);
  return doc?.lastCashValue ?? 0;
}

/**
 * Settled or live asset value for a single account.
 *   fetchLatestBal=false → assetTS[last]  (T-1, settled)
 *   fetchLatestBal=true  → live prices × current qty
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAccountAssetBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  const doc          = await loadStore(account._id, user._id, acctDoc);
  const assetTS      = doc?.assetTS || [];
  const settledAsset = assetTS.length ? assetTS[assetTS.length - 1] : 0;

  if (!fetchLatestBal) return { value: settledAsset, asof: t1Str() };

  const open = openPositions(holdings ?? await loadHoldings(account._id, user._id));
  const live = await markToMarket(open);

  return live == null
    ? { value: settledAsset, asof: t1Str() }   // unpriceable — settled is the honest figure
    : { value: live, asof: todayStr() };
}

/**
 * Combined asset value across all of a user's accounts.
 * Live mode gathers every open holding first, so they all price in ONE request.
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAllAccountsAssetBalance(user, fetchLatestBal = false) {
  const accounts = (await Account.find({ user: user._id }).lean()).filter(a => !a.isDebt);

  const settled = async () => {
    let value = 0;
    for (const account of accounts) {
      value += (await getAccountAssetBalance(account, user, false)).value;
    }
    return { value, asof: t1Str() };
  };

  if (!fetchLatestBal) return settled();

  const holdings = (await Promise.all(
    accounts.map(a => loadHoldings(a._id, user._id)),
  )).flatMap(openPositions);

  const live = await markToMarket(holdings);
  return live == null ? settled() : { value: live, asof: todayStr() };
}

/**
 * Total account balance (cash + assets). A debt account has no asset component.
 *
 * @returns {Promise<{ balance: number, cashBalance: number, assetBalance: number, asof: string }>}
 */
async function getAccountBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  const doc         = await loadStore(account._id, user._id, acctDoc);
  const cashBalance = doc?.lastCashValue ?? 0;

  if (!fetchLatestBal) {
    const balance = doc?.settledValue ?? 0;
    return {
      balance,
      cashBalance,
      assetBalance: account.isDebt ? 0 : balance - cashBalance,
      asof:         t1Str(),
    };
  }

  const { value: assetBalance, asof } = account.isDebt
    ? { value: 0, asof: todayStr() }
    : await getAccountAssetBalance(account, user, true, doc, holdings);

  return { balance: cashBalance + assetBalance, cashBalance, assetBalance, asof };
}

module.exports = {
  getAccountCashBalance,
  getAccountAssetBalance,
  getAllAccountsAssetBalance,
  getAccountBalance,
};
