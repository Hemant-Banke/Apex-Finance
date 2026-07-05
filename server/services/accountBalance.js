/**
 * accountBalance service — O(1) reads from pre-computed stores.
 *
 * "Balance" = settled balance by default:
 *   settledValue  = cashTS[T-1] + assetTS[T-1]  (yesterday's close)
 *
 * With fetchLatestBal=true (live):
 *   balance = lastCashValue + live asset prices via marketDataService
 *
 * Always includes an `asof` date in responses.
 */

const Account = require('../models/Account');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const AccountHoldings     = require('../models/AccountHoldings');
const holdingsService     = require('./holdingsService');
const { fetchLatestPrices } = require('./marketDataService');
const { todayStr, t1Str }         = require('../utils/helpers');
const { DAY_MS }         = require('../utils/constants');

/**
 * Returns the settled cash balance at T-1 (from cashTS[T-2], the T-1 entry).
 * Use lastCashValue for the T (today) cash value instead.
 */
async function getAccountCashBalance(account, user, acctDoc = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();
  return acctDoc?.lastCashValue ?? 0;
}

/**
 * Returns the settled asset value.
 *   fetchLatestBal=false: assetTS[last] = T-1 settled (from pre-computed store)
 *   fetchLatestBal=true:  live prices × current qty via marketDataService
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAccountAssetBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();

  if (!fetchLatestBal) {
    const assetTS = acctDoc?.assetTS || [];
    const value   = assetTS.length > 0 ? assetTS[assetTS.length - 1] : 0;
    return { value, asof: t1Str() };
  }

  // Live fetch
  if (!holdings) holdings = await AccountHoldings.findOne({ account: account._id, user: user._id }).lean()?.holdings || [];
  const activeHoldings   = holdings.filter(h => h.units > 0);
  if (!activeHoldings.length) return { value: 0, asof: todayStr() };

  const prices = await fetchLatestPrices(activeHoldings);
  const value  = activeHoldings.reduce((sum, h) => sum + h.units * (prices[h.assetSymbol] ?? 0), 0);
  return { value, asof: todayStr() };
}

/**
 * Returns the latest Asset Values off all holdings
 *
 * @returns {Promise<{ value: number, asof: string }>}
 */
async function getAllAccountsAssetBalance(user, fetchLatestBal = false) {
  const accounts = await Account.find({ user: user._id }).lean();

  let value = 0;
  let allHoldings = [];
  for (const account in accounts) {
    if (!fetchLatestBal) value += getAccountAssetBalance(account, user, false)?.value || 0;
    else {
      // Concatenate all Holdings
      const acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id }).lean();
      const holdings = await AccountHoldings.findOne({ account: account._id, user: user._id }).lean()?.holdings.filter(h => h.units > 0) || [];
      if (!holdings.length) continue;
      allHoldings = allHoldings.concat(holdings);
    }
  }

  // Find Latest prices of all holdings in one call
  if (fetchLatestBal) {
    const prices = await fetchLatestPrices(allHoldings);
    value  = allHoldings.reduce((sum, h) => sum + h.units * (prices[h.assetSymbol] ?? 0), 0);
  }

  return { value, asof: fetchLatestBal ? todayStr() : t1Str() };
}

/**
 * Returns the total account balance (cash + assets).
 * Debt accounts return only cash (no asset component).
 *
 * @returns {Promise<{ balance: number, cashBalance: number, assetBalance: number, asof: string }>}
 */
async function getAccountBalance(account, user, fetchLatestBal = false, acctDoc = null, holdings = null) {
  if (!acctDoc) acctDoc = await DailyAccountBalance.findOne({ account: account._id, user: user._id}).lean();

  if (!fetchLatestBal) {
    // Default: settled balance from pre-computed settledValue (T cash + T-1 assets)
    const balance      = acctDoc?.settledValue ?? 0;
    const cashBalance  = acctDoc?.lastCashValue ?? 0;
    const assetBalance = account.isDebt ? 0 : (balance - cashBalance);
    return { balance, cashBalance, assetBalance, asof: t1Str() };
  }

  // Live: lastCashValue (T) + live asset value
  const cashBalance  = acctDoc?.lastCashValue ?? 0;
  const { value: assetBalance, asof } = account.isDebt
    ? { value: 0, asof: todayStr() }
    : await getAccountAssetBalance(account, user, true, acctDoc, holdings);

  return {
    balance:      cashBalance + assetBalance,
    cashBalance,
    assetBalance,
    asof,
  };
}

module.exports = { 
  getAccountCashBalance, 
  getAccountAssetBalance, 
  getAllAccountsAssetBalance,
  getAccountBalance 
};
