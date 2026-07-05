const { ASSET_TRANSACTION_TYPES } = require("../utils/constants");
const { t1Ms } = require("../utils/helpers");
const { tsAdder } = require("../utils/tsHelpers");
const { buildCashImpactMap, directionalAssetImpact } = require("../utils/transactionHelpers");

// ─── Pure TS builders ─────────────────────────────────────────────────────────

/**
 * Build a cashTS array in a single forward pass from impactsByDay.
 *
 * @param {{ [dayMs: number]: number }} impactsByDay  Cash delta per day.
 * @param {number} startMs  UTC-midnight ms of first entry.
 * @param {number} endMs    UTC-midnight ms of last entry (inclusive, = T).
 * @param {number} [initial=0]  Starting accumulator (for incremental extend).
 * @returns {number[]}
 */
function buildCashTS(impactsByDay, startMs, endMs = todayMs(), initialCashBalance = 0) {
  const numDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  let cum = initialCashBalance;
  const cashTS = [];
  for (let i = 0; i < numDays; i++) {
    cum += impactsByDay[startMs + i * DAY_MS] || 0;
    cashTS.push(cum);
  }
  return cashTS;
}

/**
 * Build an assetTS array in a single rolling-delta forward pass.
 *
 * Uses a rolling `holdings` map that updates at each transaction date, and a
 * `lastPrice` map for carry-forward on non-trading days.
 * One request per symbol is expected to have already been fetched upfront.
 *
 * @param {Object[]}  assetTxns   Buy/sell transactions sorted by date asc.
 * @param {{ [sym: string]: { [dayMs: number]: number } }} pricesBySymbol
 * @param {number}    startMs   UTC-midnight ms of first entry.
 * @param {number}    endMs      UTC-midnight ms of last entry (T-1 = yesterday).
 * @returns {{ ts: number[], holdings: Object }}  length = (t1Ms - startMs) / DAY_MS + 1
 */
function buildAssetTS(assetTxns, pricesBySymbol, startMs, endMs = t1Ms()) {
  if (endMs < startMs) return [];
  const numDays   = Math.round((endMs - startMs) / DAY_MS) + 1;
  const holdings  = {}; // { SYM: qty } — accumulated forward
  const lastPrice = {}; // carry-forward price per symbol

  // Index transactions by their settlement day for O(1) per-day lookup
  const txsByDay = {};
  for (const tx of assetTxns) {
    const k = midnight(new Date(tx.date));
    (txsByDay[k] ??= []).push(tx);
  }

  const assetTS = [];
  for (let i = 0; i < numDays; i++) {
    const dayMs  = startMs + i * DAY_MS;

    // Apply only today's transactions to holdings
    for (const tx of (txsByDay[dayMs] || [])) {
      const sym = tx.assetSymbol?.toUpperCase();
      if (sym && tx.units) {
        holdings[sym] = (holdings[sym] || 0) + directionalAssetImpact(tx.type) * tx.units;
      }
    }

    // Compute total asset value from accumulated holdings at today's price
    let value = 0;
    for (const [sym, qty] of Object.entries(holdings)) {
      if (qty === 0) continue;
      const p = pricesBySymbol[sym]?.[dayMs] || null;
      if (p != null) lastPrice[sym] = p;
      value += qty * (lastPrice[sym] || 0);
    }
    assetTS.push(value);
  }

  return assetTS;
}

/**
 * Aggregate per-account cashTS and assetTS into a single valuesTS for net worth.
 *
 * @param {Object<{ cashTS, assetTS, startMs, endMs }>} acctStores  Expects a completed AccountStore array (extended to today)
 * @returns {{ valuesTS: number[], startMs, endMs, lastCashValue: number, settledValue: number }}
 */
function buildNetWorthTS(acctStores) {
  const t1    = t1Ms();
  let   valuesTS   = [];
  let   globalStartMs = t1;
  let   globalEndMs   = t1;
  let   lastCashValue = 0; // sum of all account cashTS[T] values
  let   settledValue = 0; // sum of all account settled values

  for (const [aid, accountStore] of Object.entries(acctStores)) {
    const { cashTS, assetTS, startMs, endMs } = accountStore;
    lastCashValue += cashTS[cashTS.length - 1] ?? 0;

    // Add Cash TS (T-1) and Asset TS (T-1) to get Account Balance TS (T-1)
    const { accountBalance, accountStartMs, accountEndMs } = tsAdder(cashTS, assetTS, startMs, startMs, t1, t1);
    settledValue += accountBalance[accountBalance.length - 1] ?? 0;

    // Add Account Balance TS (T-1) to current Net Worth TS (T-1)
    const { result: nwTS, startMs: nwStartMs, endMs: nwEndMs } = tsAdder(valuesTS, accountBalance, globalStartMs, accountStartMs, globalEndMs, accountEndMs);
    valuesTS = nwTS;
    globalStartMs = Math.min(globalStartMs, nwStartMs);
    globalEndMs   = Math.max(globalEndMs, nwEndMs);
  }

  return { valuesTS, globalStartMs, globalEndMs, lastCashValue, settledValue };
}

// ─── Core: Transaction TS Change ─────────────────────────────────────────────────────

/**
 * Produces the cashTS and assetTS changes for all affected accounts from a set of transactions.
 * 
 * @param {string}   userId
 * @param {{ [aid: string]: Object }} accountTxnsMap    Map of accountId → Transactions Objects (sorted by date asc) for that account.
 * @param {{ [sym: string]: { [dayMs: number]: number } }} pricesBySymbol
 */
function buildTransactionsTS(userId, accountTxnsMap, pricesBySymbol, useLastCashBalance = false) {
  const today = todayMs();
  const t1    = t1Ms();
  const accountStores = {};
  
  for (const [aid, aidTxnsMap] of Object.entries(accountTxnsMap)) {
    const account = await Account.findOne({ _id: aid, user: userId }).lean();
    if (!account) continue;

    const cashTxns = aidTxnsMap['cashTxns'] || [];
    const assetTxns = aidTxnsMap['assetTxns'] || [];
    const cashStartMs = aidTxnsMap['cashStartMs'] ?? today;
    const assetStartMs = aidTxnsMap['assetStartMs'] ?? today;
    const startMs = Math.min(assetStartMs, cashStartMs);

    // Build Cash Transactions TS
    let cashImpactMap = buildCashImpactMap(cashTxns.concat(assetTxns), aid);
    let cashTS = cashTxns.length
      ? buildCashTS(cashImpactMap, startMs, today, useLastCashBalance ? account.lastCashValue : 0)
      : Array(Math.round((today - startMs) / DAY_MS) + 1).fill(0);

    // Build Asset Transactions TS
    let assetTS = !account.isDebt && assetTxns.length
      ? buildAssetTS(assetTxns, pricesBySymbol, startMs, t1)
      : Array(Math.round((t1 - startMs) / DAY_MS) + 1).fill(0);

    accountStores[aid] = { cashTS, assetTS, startMs, endMs: today };
  }

  let networthStore = buildNetWorthTS(accountStores);
  return { accountStores, networthStore };
}

module.exports = {
  buildCashTS,
  buildAssetTS,
  buildNetWorthTS,
  buildTransactionsTS,
};