/**
 * dailyValueService — transaction-driven store orchestration + persistence.
 *
 * Coordinates the pure builders in tsService with the DB. Owns:
 *   - rebuildAll:     full recompute of all stores from transaction history
 *   - ensureUpToToday: incremental carry-forward extend of existing stores
 *   - updateForTxns:  apply a delta set of transactions to existing stores
 *   - rebuildNW:      re-aggregate net worth from persisted account stores
 *   - upsert*:        DB persistence
 *
 * This module must NOT require transactionService (that direction would create a
 * cycle). It reads the Transaction model directly for full rebuilds.
 *
 * Semantics reminder:
 *   cashTS  (account) length N   — startDate → T (today)
 *   assetTS (account) length N-1 — startDate → T-1 (yesterday settled)
 *   valuesTS (NW)     length N-1 — startDate → T-1
 *   settledValue  (account) = lastCashValue + assetTS[last]  (T cash + T-1 assets)
 *   lastCashValue (account) = cashTS[last]                    (T cash)
 */

const Transaction         = require('../models/Transaction');
const Account             = require('../models/Account');
const AccountHoldings     = require('../models/AccountHoldings');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const DailyNetWorth       = require('../models/DailyNetWorth');

const tsService               = require('./tsService');
const holdingsService         = require('./holdingsService');
const { fetchHistoricPrices } = require('./marketDataService');
const { DAY_MS }              = require('../utils/constants');
const { midnight, todayMs, t1Ms } = require('../utils/helpers');
const { tsAdder }             = require('../utils/tsHelpers');
const { buildAccountTxnsMap } = require('../utils/transactionHelpers');


// ─── Shared loaders ─────────────────────────────────────────────────────────

/** All of a user's transactions, sorted ascending by date. */
async function fetchTxns(userId) {
  return Transaction.find({ user: userId }).sort({ date: 1 }).lean();
}

/** Map of accountId → account doc, for isDebt lookups in the pure builders. */
async function loadAccountsById(userId) {
  const accounts = await Account.find({ user: userId }).lean();
  return Object.fromEntries(accounts.map(a => [a._id.toString(), a]));
}

/** Fetch all symbol price series in one batched call. */
function fetchPrices(assets, assetStartMs) {
  const today = todayMs();
  return fetchHistoricPrices(assets || [], assetStartMs || today, today);
}


// ─── Rebuild services ─────────────────────────────────────────────────────────

/**
 * Re-aggregate DailyNetWorth from every persisted DailyAccountBalance.
 * Always safe to call after account stores change.
 */
async function rebuildNW(userId) {
  const acctDocs = await DailyAccountBalance
    .find({ user: userId })
    .select('startDate cashTS assetTS')
    .lean();

  const stores = acctDocs
    .map(d => ({
      cashTS:  d.cashTS  || [],
      assetTS: d.assetTS || [],
      startMs: midnight(d.startDate),
    }))
    .filter(s => s.cashTS.length || s.assetTS.length);

  const { valuesTS, globalStartMs, lastCashValue, settledValue } =
    tsService.buildNetWorthTS(stores);

  // valuesTS content ends at T-1, but endDate marks how far the store is current:
  // it is stamped to T (today) so `ensureUpToToday` treats a same-day store as up
  // to date. (Account cashTS likewise runs to T.)
  await upsertNetWorth(userId, valuesTS, lastCashValue, settledValue, globalStartMs, todayMs());
}

/** Full rebuild of all account stores, net worth, and holdings from history. */
async function rebuildAll(userId) {
  const today = todayMs();
  const allTxns = await fetchTxns(userId);

  const { byAccount, assets, assetStartMs } = buildAccountTxnsMap(allTxns);
  const accountsById   = await loadAccountsById(userId);
  const pricesBySymbol = await fetchPrices(assets, assetStartMs);

  const accountStores = tsService.buildTransactionsTS(byAccount, pricesBySymbol, accountsById);

  // Persist stores for every account — empty stores reset accounts with no txns.
  await Promise.all(Object.keys(accountsById).map(aid => {
    const store = accountStores[aid];
    return store
      ? upsertAccountBalance(aid, userId, store.cashTS, store.assetTS, store.startMs, store.endMs)
      : upsertAccountBalance(aid, userId, [], [], today, today);
  }));

  await rebuildNW(userId);
  await holdingsService.rebuildAllHoldingsFromMap(userId, byAccount);
}


// ─── Extend service ─────────────────────────────────────────────────────────

/**
 * Extend every store forward to today without replaying transaction history,
 * using the current cash balance and holdings as calibration.
 *
 * The two series end on different days (cashTS → T, assetTS → T-1), so they are
 * calibrated on different days:
 *
 *   cashTS   ends at prevT      → carry lastCashValue forward for prevT+1 … today.
 *   assetTS  ends at prevT-1    → resume at **prevT**, injecting current holdings
 *                                 as an `_assetcalibration` there and pricing
 *                                 prevT … newT-1 with real market data.
 *
 * (A single combined build can't do this — cash would need to start a day after
 * asset, which the shared start-day builder can't express — so the two series
 * are extended independently here.)
 */
async function ensureUpToToday(userId) {
  const today = todayMs();
  const t1    = t1Ms();
  const nwDoc = await DailyNetWorth.findOne({ user: userId }).select('endDate').lean();
  if (nwDoc && midnight(nwDoc.endDate) >= today) return; // already current

  const acctDocs = await DailyAccountBalance
    .find({ user: userId })
    .select('account startDate cashTS assetTS lastCashValue')
    .lean();
  if (!acctDocs.length) return;

  const accountsById = await loadAccountsById(userId);

  // Load holdings once per non-debt account and collect symbols for a single
  // batched price fetch. Each account's asset series resumes at its own prevT.
  const holdingsByAcct = {};
  const assetsSeen     = new Map(); // sym → { assetSymbol, assetType }
  let   minAssetStart  = Infinity;

  for (const d of acctDocs) {
    const aid = d.account.toString();
    if (accountsById[aid]?.isDebt || !d.cashTS?.length) continue;

    const hDoc     = await AccountHoldings.findOne({ account: d.account, user: userId }).select('holdings').lean();
    const holdings = (hDoc?.holdings || []).filter(h => h.units);
    if (!holdings.length) continue;

    holdingsByAcct[aid] = holdings;
    // prevT = day after assetTS's last entry (assetTS runs to prevT-1).
    const assetStart = midnight(d.startDate) + (d.assetTS?.length || 0) * DAY_MS;
    minAssetStart = Math.min(minAssetStart, assetStart);
    for (const h of holdings) {
      const sym = h.assetSymbol?.toUpperCase();
      if (sym && !assetsSeen.has(sym)) assetsSeen.set(sym, { assetSymbol: sym, assetType: h.assetType || 'stock' });
    }
  }

  const pricesBySymbol = await fetchPrices(
    [...assetsSeen.values()],
    Number.isFinite(minAssetStart) ? minAssetStart : today,
  );

  await Promise.all(acctDocs.map(async (d) => {
    const aid      = d.account.toString();
    const isDebt   = accountsById[aid]?.isDebt || false;
    const docStart = midnight(d.startDate);
    const cashTS   = d.cashTS  || [];
    const assetTS  = d.assetTS || [];
    if (!cashTS.length) return; // never-transacted account — nothing to extend

    const prevT    = docStart + (cashTS.length - 1) * DAY_MS; // last cash day (T)
    const lastCash = d.lastCashValue ?? cashTS[cashTS.length - 1] ?? 0;

    // Cash: carry lastCashValue forward for prevT+1 … today.
    const cashDays  = Math.round((today - prevT) / DAY_MS);
    const newCashTS = cashDays > 0 ? cashTS.concat(Array(cashDays).fill(lastCash)) : cashTS.slice();

    // Asset: resume at prevT (= docStart + assetTS.length days) … newT-1.
    let newAssetTS = assetTS.slice();
    if (!isDebt) {
      const assetStart = docStart + assetTS.length * DAY_MS; // prevT
      if (assetStart <= t1) {
        const holdings = holdingsByAcct[aid];
        if (holdings) {
          const calibTxns = holdings.map(h => ({
            type:         '_assetcalibration',
            assetSymbol:  h.assetSymbol,
            assetType:    h.assetType,
            units:        h.units,
            pricePerUnit: h.avgPricePerUnit,
            date:         new Date(assetStart),
          }));
          newAssetTS = assetTS.concat(tsService.buildAssetTS(calibTxns, pricesBySymbol, assetStart, t1));
        } else {
          // Non-debt account with no holdings — settled asset value stays 0.
          const zeros = Math.round((t1 - assetStart) / DAY_MS) + 1;
          newAssetTS = assetTS.concat(Array(Math.max(0, zeros)).fill(0));
        }
      }
    }

    return upsertAccountBalance(aid, userId, newCashTS, newAssetTS, docStart, today);
  }));

  await rebuildNW(userId);
}


// ─── Delta update service ─────────────────────────────────────────────────────

/** Apply a delta set of transactions to existing stores (create/update/delete). */
async function updateForTxns(userId, txns) {
  const { byAccount, assets, assetStartMs } = buildAccountTxnsMap(txns);
  const accountsById   = await loadAccountsById(userId);
  const pricesBySymbol = await fetchPrices(assets, assetStartMs);

  const deltaStores = tsService.buildTransactionsTS(byAccount, pricesBySymbol, accountsById);

  await Promise.all(Object.entries(deltaStores).map(async ([aid, store]) => {
    const doc = await DailyAccountBalance
      .findOne({ account: aid, user: userId })
      .select('startDate endDate cashTS assetTS')
      .lean();

    if (!doc || !(doc.cashTS?.length || doc.assetTS?.length)) {
      return upsertAccountBalance(aid, userId, store.cashTS, store.assetTS, store.startMs, store.endMs);
    }

    const docStartMs = midnight(doc.startDate);
    const cashEndMs  = midnight(doc.endDate);
    const assetEndMs = docStartMs + Math.max(0, (doc.assetTS?.length || 0) - 1) * DAY_MS;

    const cash  = tsAdder(doc.cashTS,  store.cashTS,  docStartMs, store.startMs, cashEndMs,  store.endMs);
    const asset = tsAdder(doc.assetTS, store.assetTS, docStartMs, store.startMs, assetEndMs, t1Ms());

    return upsertAccountBalance(aid, userId, cash.result, asset.result, cash.startMs, cash.endMs);
  }));

  await rebuildNW(userId);
  await holdingsService.updateHoldingsFromMap(userId, byAccount);
}


// ─── Persistence ─────────────────────────────────────────────────────────────

async function upsertAccountBalance(accountId, userId, cashTS, assetTS, startMs, endMs = todayMs()) {
  const lastCashValue = cashTS[cashTS.length - 1] ?? 0;
  const assetAtT1     = assetTS[assetTS.length - 1] ?? 0;

  await DailyAccountBalance.findOneAndUpdate(
    { account: accountId, user: userId },
    {
      account: accountId, user: userId,
      startDate: new Date(startMs),
      endDate:   new Date(endMs),
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
      user: userId,
      startDate: new Date(startMs),
      endDate:   new Date(endMs),
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
  ensureUpToToday,
  updateForTxns,
  upsertAccountBalance,
  upsertNetWorth,
};
