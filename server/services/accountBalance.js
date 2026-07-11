/**
 * accountBalance service — O(1) reads from pre-computed stores.
 *
 * Default (settled): balance = settledValue = lastCashValue (T) + assetTS[T-1].
 * Live (fetchLatestBal=true): balance = lastCashValue (T) + live asset prices.
 *
 * All balance reads operate on RAW stored holdings ({ assetSymbol, units }).
 * Every response includes an `asof` date.
 */

const Account             = require('../models/Account');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings     = require('../models/AccountHoldings');
const { fetchLatestPrices } = require('./marketDataService');
const { todayStr, t1Str, todayMs, midnight } = require('../utils/helpers');
const { resolveUnitPrice }  = require('../utils/assetPricing');

/**
 * Live unit price for a raw stored holding: a market quote (scaled by purity for
 * physical metal), else the cost basis accrued at the holding's annual rate.
 * null means we genuinely cannot price it — the caller falls back to settled.
 */
function livePrice(h, prices) {
  return resolveUnitPrice(h, {
    marketPrice: prices[h.assetSymbol] ?? null,
    basePrice:   h.avgPricePerUnit ?? null,
    basisMs:     midnight(new Date(h.lastTransactionDate || h.firstPurchaseDate || Date.now())),
    atMs:        todayMs(),
  });
}

/** Load an account's raw holdings array (or []). */
async function loadHoldings(accountId, userId) {
  const doc = await AccountHoldings.findOne({ account: accountId, user: userId }).select('holdings').lean();
  return doc?.holdings || [];
}

/**
 * Current cash balance (T) for an account — used for buy/adjustment validation.
 */
async function getAccountCashBalance(account, user, acctDoc = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();
  return acctDoc?.lastCashValue ?? 0;
}

/**
 * Settled or live asset value for a single account.
 *   fetchLatestBal=false → assetTS[last] (T-1 settled)
 *   fetchLatestBal=true  → live prices × current qty
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAccountAssetBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();
  const assetTS      = acctDoc?.assetTS || [];
  const settledAsset = assetTS.length ? assetTS[assetTS.length - 1] : 0;

  if (!fetchLatestBal) {
    return { value: settledAsset, asof: t1Str() };
  }

  if (!holdings) holdings = await loadHoldings(account._id, user._id);
  const active = holdings.filter(h => (h.units || 0) > 0);
  if (!active.length) return { value: 0, asof: todayStr() };

  const prices = await fetchLatestPrices(active);
  const priced = active.map(h => livePrice(h, prices));
  // If any holding cannot be priced at all, fall back to the last known settled
  // (T-1) asset balance rather than under-counting that holding as 0.
  if (priced.some(p => p == null)) {
    return { value: settledAsset, asof: t1Str() };
  }
  const value = active.reduce((sum, h, i) => sum + h.units * priced[i], 0);
  return { value, asof: todayStr() };
}

/**
 * Combined asset value across all of a user's accounts (single batched price call).
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAllAccountsAssetBalance(user, fetchLatestBal = false) {
  const accounts = await Account.find({ user: user._id }).lean();

  if (!fetchLatestBal) {
    let value = 0;
    for (const account of accounts) {
      if (account.isDebt) continue;
      const { value: v } = await getAccountAssetBalance(account, user, false);
      value += v;
    }
    return { value, asof: t1Str() };
  }

  // Live: gather every active holding, then price them all in one request.
  let allHoldings = [];
  for (const account of accounts) {
    if (account.isDebt) continue;
    const holdings = (await loadHoldings(account._id, user._id)).filter(h => (h.units || 0) > 0);
    allHoldings = allHoldings.concat(holdings);
  }
  if (!allHoldings.length) return { value: 0, asof: todayStr() };

  const prices = await fetchLatestPrices(allHoldings);
  const priced = allHoldings.map(h => livePrice(h, prices));
  // If any holding cannot be priced at all, fall back to the settled (T-1) total.
  if (priced.some(p => p == null)) {
    return getAllAccountsAssetBalance(user, false);
  }
  const value = allHoldings.reduce((sum, h, i) => sum + h.units * priced[i], 0);
  return { value, asof: todayStr() };
}

/**
 * Total account balance (cash + assets). Debt accounts have no asset component.
 *
 * @returns {Promise<{ balance: number, cashBalance: number, assetBalance: number, asof: string }>}
 */
async function getAccountBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();

  if (!fetchLatestBal) {
    const balance      = acctDoc?.settledValue ?? 0;
    const cashBalance  = acctDoc?.lastCashValue ?? 0;
    const assetBalance = account.isDebt ? 0 : (balance - cashBalance);
    return { balance, cashBalance, assetBalance, asof: t1Str() };
  }

  const cashBalance = acctDoc?.lastCashValue ?? 0;
  const { value: assetBalance, asof } = account.isDebt
    ? { value: 0, asof: todayStr() }
    : await getAccountAssetBalance(account, user, true, acctDoc, holdings);

  return { balance: cashBalance + assetBalance, cashBalance, assetBalance, asof };
}

module.exports = {
  getAccountCashBalance,
  getAccountAssetBalance,
  getAllAccountsAssetBalance,
  getAccountBalance,
};
