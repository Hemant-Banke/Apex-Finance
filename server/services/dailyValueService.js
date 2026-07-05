/**
 * dailyValueService — persistence.
 *
 * Provides:
 *   - DB persistence: upsertAccountBalance, upsertNetWorth
 *
 * No transaction lifecycle logic — that lives in transactionService.
 *
 * Semantics reminder:
 *   cashTS  (account) length N   — startDate → T (today)
 *   assetTS (account) length N-1 — startDate → T-1 (yesterday settled)
 *   valuesTS (NW)     length N-1 — startDate → T-1 (complete NW, cash+assets)
 *
 *   settledValue  (account) = cashTS[N-2] + assetTS[N-2]  = T-1 total
 *   lastCashValue (account) = cashTS[N-1]                  = T cash
 *   settledValue  (NW)      = valuesTS[last]               = T-1 NW
 *   lastCashValue (NW)      = Σ account.lastCashValue      = T cash
 */

const DailyAccountBalance = require('../models/DailyAccountBalance');
const DailyNetWorth       = require('../models/DailyNetWorth');
const tsService = require('../services/tsService');
const { rebuildAllHoldingsFromMap, updateHoldingsFromMap } = require('../services/holdingsService');
const { findTransactions } = require('../services/transactionService');
const { fetchHistoricPrices } = require('../services/marketDataService');
const { DAY_MS }          = require('../utils/constants');
const { midnight, todayMs, t1Ms } = require('../utils/helpers');
const { tsConcat, tsAdder } = require('../utils/tsHelpers');
const { buildAccountTxnsMap } = require('../utils/transactionHelpers');


// ─── Rebuild Services ───────────────────────────────────────────────────────────────

/**
 * Rebuild Networth valuesTS from all account stores for a user. 
 * Builds on the period of existing accounts.
 *
 * @param {string} userId
 * @returns {null} If no account stores exist, deletes any existing DailyNetWorth doc.
 */
async function rebuildNW(userId) {
  const acctDocs = await DailyAccountBalance.find({ user: userId }).select('account startDate cashTS assetTS').lean();

  const stores = acctDocs.map(d => ({
    cashTS:  d.cashTS  || [],
    assetTS: d.assetTS || [],
    startMs: midnight(d.startDate),
    endMs:  midnight(d.endDate)
  })).filter(s => s.cashTS.length || s.assetTS.length);

  const { valuesTS, globalStartMs, globalEndMs, lastCashValue, settledValue } = tsService.buildNetWorthTS(stores);
  await upsertNetWorth(userId, valuesTS, lastCashValue, settledValue, globalStartMs, globalEndMs);
}

/** Full rebuild of all stores from transaction history. */
async function rebuildAll(userId) {
  const today = todayMs();
  const allTxns = await findTransactions(userId);
  if (!allTxns.length) return;

  const accountTxnsMap = buildAccountTxnsMap(allTxns);
  // Fetch Prices of assets
  const pricesBySymbol = await fetchHistoricPrices(accountTxnsMap['assets'] || [], accountTxnsMap['assetStartMs'] || today, today);

  // Build Transactions TS for all accounts and Networth
  const [accountStores, networthStore] = tsService.buildTransactionsTS(userId, accountTxnsMap, pricesBySymbol);

  // Update Account Balances
  await Promise.all(Object.entries(accountStores).map(
    ([aid, store]) => upsertAccountBalance(aid, userId, store.cashTS, store.assetTS, store.startMs, store.endMs)
  ));

  // Update Networth
  await upsertNetWorth(
    userId, 
    networthStore.valuesTS, 
    networthStore.lastCashValue, 
    networthStore.settledValue, 
    networthStore.globalStartMs, 
    networthStore.globalEndMs
  );

  // Update Holdings
  await rebuildAllHoldingsFromMap(userId, accountTxnsMap);
}

// ─── Extending Services ───────────────────────────────────────────────────────────────

/**
 * Prepare calibrated transactions for the user. These are abstract transactions used to extend TS
 */
async function calibratedTransactions(userId) {
  const today = todayMs();
  const accountDocs = await DailyAccountBalance.find({ user: userId }).select('account endDate lastCashValue').lean();
  if (!accountDocs.length) return [];

  let txns = [];
  for (const { account, endDate, lastCashValue } of accountDocs) {
    const endMs = midnight(endDate);

    // Add Cash calibration transaction
    txns.push({
      user: userId,
      account,
      date: new Date(endMs + DAY_MS),
      type: '_cashcalibration',
      amount: lastCashValue || 0
    });

    // Add Asset calibration transaction
    if (!account.isDebt) {
      const holdingsDoc = await AccountHoldings.findOne({ account, user: userId }).select('holdings').lean();
      if (holdingsDoc?.holdings) {
        for (const { assetSymbol, assetName, assetType, units, avgPricePerUnit, totalInvested } of holdingsDoc.holdings) {
          txns.push({
            user: userId,
            account,
            date: new Date(endMs + DAY_MS),
            type: '_assetcalibration',
            assetSymbol,
            assetName,
            assetType,
            units,
            pricePerUnit: avgPricePerUnit,
            usesCashBalance: false,
            amount: totalInvested
          });
        }
      }
    }
  }

  return txns;
}

/**
 * Extend all stores to today with real asset prices.
 */
async function ensureUpToToday(userId) {
  const today = todayMs();
  const nwDoc = await DailyNetWorth.findOne({ user: userId }).select('startDate endDate valuesTS').lean();
  if (nwDoc && nwDoc.endDate >= today) return; // already up to date

  const calibratedTxns = await calibratedTransactions(userId);
  const accountTxnsMap = buildAccountTxnsMap(calibratedTxns);

  // Fetch Prices of assets
  const pricesBySymbol = await fetchHistoricPrices(accountTxnsMap['assets'] || [], accountTxnsMap['assetStartMs'] || today, today);

  // Build Transactions TS for all accounts and Networth
  const [accountStores, networthStore] = tsService.buildTransactionsTS(userId, accountTxnsMap, pricesBySymbol, true);

  // Update Account Balances
  await Promise.all(Object.entries(accountStores).map(
    ([aid, store]) => {
      const accountBalDoc = await DailyAccountBalance.findOne({ account: aid, user: userId }).select('startDate endDate cashTS assetsTS').lean();
      const { result: newcashTS, startMs, endMs } = tsConcat(accountBalDoc?.cashTS, store.cashTS, accountBalDoc?.startDate, store.startMs, accountBalDoc?.endDate, store.endMs);
      const { result: newassetTS, startMs, endMs } = tsConcat(accountBalDoc?.assetTS, store.assetTS, accountBalDoc?.startDate, store.startMs, accountBalDoc?.endDate, store.endMs);
      return upsertAccountBalance(aid, userId, newcashTS, newassetTS, startMs, endMs);
    }
  ));

  // Update Networth
  const { result: newvaluesTS, startMs, endMs } = tsConcat(nwDoc?.valuesTS, networthStore.valuesTS, nwDoc?.startDate, networthStore.globalStartMs, nwDoc?.endDate, networthStore.globalEndMs);
  await upsertNetWorth(userId, newvaluesTS, networthStore.lastCashValue, networthStore.settledValue, startMs, endMs);
}

// ─── Transaction Updates Services ───────────────────────────────────────────────────────────────

/**
 * Update the stores with provided transaction array
 */
async function updateForTxns(userId, txns) {
  const today = todayMs();
  const accountTxnsMap = buildAccountTxnsMap(txns);

  // Fetch Prices of assets
  const pricesBySymbol = await fetchHistoricPrices(accountTxnsMap['assets'] || [], accountTxnsMap['assetStartMs'] || today, today);

  // Build Transactions TS for all accounts and Networth
  const [accountStores, networthStore] = tsService.buildTransactionsTS(userId, accountTxnsMap, pricesBySymbol);

  // Update Account Balances
  await Promise.all(Object.entries(accountStores).map(
    ([aid, store]) => {
      const accountBalDoc = await DailyAccountBalance.findOne({ account: aid, user: userId }).select('startDate endDate cashTS assetsTS').lean();
      const { result: newcashTS, startMs, endMs } = tsAdder(accountBalDoc?.cashTS, store.cashTS, accountBalDoc?.startDate, store.startMs, accountBalDoc?.endDate, store.endMs);
      const { result: newassetTS, startMs, endMs } = tsAdder(accountBalDoc?.assetTS, store.assetTS, accountBalDoc?.startDate, store.startMs, accountBalDoc?.endDate, store.endMs);
      return upsertAccountBalance(aid, userId, newcashTS, newassetTS, startMs, endMs);
    }
  ));

  // Update Networth
  const nwDoc = await DailyNetWorth.findOne({ user: userId }).select('startDate endDate valuesTS').lean();

  const { result: newvaluesTS, startMs, endMs } = tsAdder(nwDoc?.valuesTS, networthStore.valuesTS, nwDoc?.startDate, networthStore.globalStartMs, nwDoc?.endDate, networthStore.globalEndMs);
  await upsertNetWorth(userId, newvaluesTS, networthStore.lastCashValue, networthStore.settledValue, startMs, endMs);

  // Update Holdings
  await updateHoldingsFromMap(userId, accountTxnsMap);
}

// ─── Upsert Services ───────────────────────────────────────────────────────────────

async function upsertAccountBalance(accountId, userId, cashTS, assetTS, startMs, endMs = todayMs()) {
  const lastCashValue = cashTS[cashTS.length - 1] ?? 0;
  const assetAtT1     = assetTS[assetTS.length - 1] ?? 0;

  await DailyAccountBalance.findOneAndUpdate(
    { account: accountId, user: userId },
    {
      account: accountId, user: userId,
      startDate: new Date(startMs), 
      endDate: new Date(endMs),
      cashTS, 
      assetTS,
      lastCashValue,
      settledValue: lastCashValue + assetAtT1,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function upsertNetWorth(userId, valuesTS, lastCashValue, settledValue, startMs, endMs = todayMs()) {
  await DailyNetWorth.findOneAndUpdate(
    { user: userId },
    {
      startDate:     new Date(startMs),
      endDate:       new Date(endMs),
      valuesTS,
      settledValue,
      lastCashValue,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  rebuildNW,
  rebuildAll,
  calibratedTransactions,
  ensureUpToToday,
  updateForTxns,
  upsertAccountBalance,
  upsertNetWorth,
};
