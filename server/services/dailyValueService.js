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
const { accruedPrice }        = require('../utils/assetPricing');
// Subscriptions materialise into transactions at the start of every `ensureUpToToday`.
// One-way dependency: subscriptionService must NOT require this module back.
const subscriptionService     = require('./subscriptionService');


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

/**
 * How far back to reach beyond the window we are building.
 *
 * The extra days are never plotted — they exist so the series can be SEEDED with the
 * last real close before it starts. A store extended on a Sunday covers only
 * non-trading days, and without a seed every holding would fall back to book cost.
 * Ten days clears a weekend plus a run of market holidays (Diwali, etc).
 */
const PRICE_LOOKBACK_DAYS = 10;

/** Fetch all symbol price series in one batched call. */
function fetchPrices(assets, assetStartMs) {
  const today = todayMs();
  const start = (assetStartMs || today) - PRICE_LOOKBACK_DAYS * DAY_MS;
  return fetchHistoricPrices(assets || [], start, today);
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
 * Bring every store up to today, then realise anything a subscription owes.
 *
 * Three steps, and the order is the whole design:
 *
 *   1. Subscriptions realise into `Transaction` rows. Rows only — no store maths.
 *   2. The stores extend to today, exactly as they always did. `extendStores` knows
 *      nothing about subscriptions: rows it has not seen are not in the holdings
 *      snapshot it calibrates from, so it cannot double-count them.
 *   3. Those rows merge through `updateForTxns` — the SAME path every other
 *      transaction takes. Cash impacts, asset valuation, holdings and net worth all
 *      come free; none of it is reimplemented here.
 *
 * Step 3 must follow step 2, not precede it: `tsAdder` zero-fills days outside a
 * series' range, so a delta reaching PAST the store's end would drop the existing
 * balance on those days. Merging into an already-current store has no such gap.
 */
async function ensureUpToToday(userId) {
  const due = await subscriptionService.materializeDue(userId, todayMs());

  // Net worth is re-aggregated by whichever step runs last — never twice.
  await extendStores(userId, { rebuildNetWorth: !due.length });

  if (due.length) await updateForTxns(userId, due);
}

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
async function extendStores(userId, { rebuildNetWorth = true } = {}) {
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
      if (sym && !assetsSeen.has(sym)) {
        assetsSeen.set(sym, {
          assetSymbol: sym,
          assetType:   h.assetType || 'stock',
          currency:    h.currency,   // so foreign quotes convert to INR
        });
      }
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
            // The cost basis is accrued forward to the calibration day, so a
            // rate-bearing asset resumes where it left off instead of snapping
            // back to book cost. Accrual is exponential, so basis-at-assetStart
            // then compounding on from there is continuous with a full rebuild.
            pricePerUnit: accruedPrice(
              h.avgPricePerUnit,
              h.rate,
              midnight(new Date(h.lastTransactionDate || h.firstPurchaseDate || assetStart)),
              assetStart,
            ),
            // Carry valuation metadata, or the extended days would lose purity
            // scaling and rate accrual and fall back to flat book value.
            purity:       h.purity,
            rate:         h.rate,
            date:         new Date(assetStart),
          }));
          // Seed the carry-forward with the last close BEFORE the extend window.
          // Extending across a weekend covers no trading day at all, so with no seed
          // every holding would be valued at book cost — the series would visibly
          // snap back to what was paid every Saturday, then jump on Monday.
          const seeds = tsService.seedPricesBefore(pricesBySymbol, assetStart);
          newAssetTS = assetTS.concat(
            tsService.buildAssetTS(calibTxns, pricesBySymbol, assetStart, t1, seeds),
          );
        } else {
          // Non-debt account with no holdings — settled asset value stays 0.
          const zeros = Math.round((t1 - assetStart) / DAY_MS) + 1;
          newAssetTS = assetTS.concat(Array(Math.max(0, zeros)).fill(0));
        }
      }
    }

    return upsertAccountBalance(aid, userId, newCashTS, newAssetTS, docStart, today);
  }));

  if (rebuildNetWorth) await rebuildNW(userId);
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
    // An EMPTY asset series has no end — deriving one from the length would land on
    // `docStartMs` (today, for an account whose only entry so far is its opening
    // balance), dragging the merged range a day past T-1 and appending a spurious 0
    // that reads as "the assets are worth nothing today".
    const assetEndMs = doc.assetTS?.length
      ? docStartMs + (doc.assetTS.length - 1) * DAY_MS
      : t1Ms();

    const cash  = tsAdder(doc.cashTS,  store.cashTS,  docStartMs, store.startMs, cashEndMs,  store.endMs);
    const asset = tsAdder(doc.assetTS, store.assetTS, docStartMs, store.startMs, assetEndMs, t1Ms());

    return upsertAccountBalance(aid, userId, cash.result, asset.result, cash.startMs, cash.endMs);
  }));

  await rebuildNW(userId);
  await holdingsService.updateHoldingsFromMap(userId, byAccount);
}


// ─── Persistence ─────────────────────────────────────────────────────────────

/** Repeated adds/subtracts leave float dust, so "zero" is a magnitude, not `=== 0`. */
const _isZero = (v) => Math.abs(v || 0) < 1e-9;

/** How many leading entries of a series are zero. */
function _leadingZeros(ts = []) {
  let i = 0;
  while (i < ts.length && _isZero(ts[i])) i++;
  return i;
}

/**
 * Drop days on which the account did not exist yet.
 *
 * A back-dated transaction moves an account's `startDate` earlier, and the days before
 * its first real movement carry zero cash AND zero assets — dead weight in every array,
 * and a flat run of nothing at the left edge of every chart. Trim the run that BOTH
 * series share and move `startDate` forward by the same number of days.
 *
 * Only the shared prefix goes: cash may legitimately be 0 while assets are already
 * worth something (a fully-invested account), and vice versa. Trimming those days
 * would silently discard real history.
 */
function trimLeadingZeros(cashTS = [], assetTS = [], startMs) {
  // Nothing to align against — an account with no asset series keeps its cash days.
  if (!cashTS.length || !assetTS.length) return { cashTS, assetTS, startMs };

  // Never trim a series away entirely: each must keep at least one day.
  const trim = Math.min(
    _leadingZeros(cashTS),
    _leadingZeros(assetTS),
    cashTS.length - 1,
    assetTS.length - 1,
  );
  if (trim <= 0) return { cashTS, assetTS, startMs };

  return {
    cashTS:  cashTS.slice(trim),
    assetTS: assetTS.slice(trim),
    startMs: startMs + trim * DAY_MS,
  };
}

async function upsertAccountBalance(accountId, userId, cashTS, assetTS, startMs, endMs = todayMs()) {
  // Every store write funnels through here — rebuild, extend, and delta merge alike —
  // so trimming here covers create/edit/delete/rebuild without touching any of them.
  ({ cashTS, assetTS, startMs } = trimLeadingZeros(cashTS, assetTS, startMs));

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
