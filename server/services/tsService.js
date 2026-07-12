/**
 * tsService — pure time-series builders.
 *
 * No DB access. Given transactions (already partitioned per account) and a
 * price map, produces the cashTS / assetTS / net-worth arrays.
 *
 * Semantics:
 *   cashTS  — startMs → T (today).      length N
 *   assetTS — startMs → T-1 (yesterday). length N-1
 */

const { DAY_MS } = require('../utils/constants');
const { midnight, todayMs, t1Ms } = require('../utils/helpers');
const { tsAdder } = require('../utils/tsHelpers');
const { buildCashImpactMap, directionalAssetImpact } = require('../utils/transactionHelpers');
const { resolveUnitPrice, accruedPrice } = require('../utils/assetPricing');

// ─── Pure TS builders ─────────────────────────────────────────────────────────

/**
 * Build a cashTS array in a single cumulative forward pass from impactsByDay.
 *
 * @param {{ [dayMs: number]: number }} impactsByDay  Cash delta per day.
 * @param {number} startMs  UTC-midnight ms of first entry.
 * @param {number} endMs    UTC-midnight ms of last entry (inclusive, = T).
 * @param {number} [initialCashBalance=0]  Starting accumulator (for incremental extend).
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
 * Uses a rolling `holdings` map that updates at each transaction date, plus a
 * `lastPrice` map for carry-forward on non-trading days. Prices are expected to
 * have been fetched upfront (one request per symbol).
 *
 * @param {Object[]} assetTxns  Buy/sell transactions sorted by date asc.
 * @param {{ [sym: string]: { [dayMs: number]: number } }} pricesBySymbol
 * @param {number} startMs  UTC-midnight ms of first entry.
 * @param {number} endMs    UTC-midnight ms of last entry (T-1 = yesterday).
 * @returns {number[]}  length = (endMs - startMs) / DAY_MS + 1
 */
function buildAssetTS(assetTxns, pricesBySymbol, startMs, endMs = t1Ms(), seedPrices = {}) {
  if (endMs < startMs) return [];
  const numDays   = Math.round((endMs - startMs) / DAY_MS) + 1;
  const holdings  = {}; // { SYM: qty } — accumulated forward
  // Carry-forward last known MARKET price per symbol, pre-seeded with the last quote
  // from BEFORE this window. Without the seed, a window containing no trading day at
  // all (extending the store across a weekend) would find no price and fall back to
  // book value — the holding would appear to snap back to cost every Saturday.
  const lastPrice = { ...seedPrices };
  const bookPrice = {}; // last transaction pricePerUnit — book fallback for unquoted assets
  const basisMs   = {}; // day that book price was set
  const meta      = {}; // { assetType, purity, rate } — drives purity scaling & accrual

  /**
   * Rate-bearing assets (an EPF balance, an FD) compound, so their basis is a POOL, not
   * a price: `{ value, basisMs }` where the holding is worth `value × (1+r)^(elapsed)`.
   * Each contribution accrues what is already there up to its own day, then adds itself.
   *
   * A single per-symbol cost basis cannot express this — it is overwritten by each new
   * contribution, so a rebuild would accrue the WHOLE balance from the latest deposit
   * and silently drop the years of growth on the earlier ones. (That made a full
   * rebuild disagree with the incremental path by ₹3.8k on a 4-contribution EPF.)
   */
  const ratePool = {};  // { SYM: { value, basisMs } }

  // Index transactions by their settlement day for O(1) per-day lookup.
  const txsByDay = {};
  for (const tx of assetTxns) {
    const k = midnight(new Date(tx.date));
    (txsByDay[k] ??= []).push(tx);
  }

  const assetTS = [];
  for (let i = 0; i < numDays; i++) {
    const dayMs = startMs + i * DAY_MS;

    // Apply today's transactions to the rolling holdings map, and remember the
    // transacted price as the cost basis for valuation / accrual.
    for (const tx of (txsByDay[dayMs] || [])) {
      const sym = tx.assetSymbol?.toUpperCase();
      if (sym && tx.units) {
        holdings[sym] = (holdings[sym] || 0) + directionalAssetImpact(tx.type) * tx.units;
        // Cost basis must be INR to sit alongside the (INR) market prices. `amount`
        // is already booked in INR, so derive from it; `pricePerUnit` alone would
        // be the NATIVE figure for a foreign asset. Calibration txns carry no
        // amount, and their pricePerUnit is already INR.
        const inrUnitCost = tx.amount != null && tx.units
          ? Math.abs(Number(tx.amount) / Number(tx.units))
          : (tx.pricePerUnit != null ? Number(tx.pricePerUnit) : null);
        if (inrUnitCost != null) {
          bookPrice[sym] = inrUnitCost;
          basisMs[sym]   = dayMs;
        }
        meta[sym] = { assetType: tx.assetType, purity: tx.purity, rate: tx.rate };

        // Rate asset: accrue the pool to today, then fold this contribution in.
        if (tx.rate && inrUnitCost != null) {
          const pool = (ratePool[sym] ??= { value: 0, basisMs: dayMs });
          pool.value = accruedPrice(pool.value, tx.rate, pool.basisMs, dayMs)
                     + directionalAssetImpact(tx.type) * Number(tx.units) * inrUnitCost;
          pool.basisMs = dayMs;
        }
      }
    }

    // Value the accumulated holdings. A market quote wins (scaled by purity for
    // physical metal); failing that the cost basis accrues at the holding's rate;
    // failing that the book price stands, so the series is never spuriously 0.
    let value = 0;
    for (const [sym, qty] of Object.entries(holdings)) {
      if (qty === 0) continue;
      const p = pricesBySymbol[sym]?.[dayMs];
      if (p != null) lastPrice[sym] = Number(p);

      // For a rate asset the basis is its accrued pool, expressed per unit so the
      // shared `resolveUnitPrice` still does the compounding: qty × (pool/qty)
      // accrued from the pool's own day is exactly the accrued pool.
      const pool = ratePool[sym];
      const usePool = pool && qty;

      const resolved = resolveUnitPrice(meta[sym], {
        marketPrice: lastPrice[sym] ?? null,
        basePrice:   usePool ? pool.value / qty : (bookPrice[sym] ?? null),
        basisMs:     usePool ? pool.basisMs : basisMs[sym],
        atMs:        dayMs,
      });

      value += qty * (resolved ?? bookPrice[sym] ?? 0);
    }
    assetTS.push(value);
  }

  return assetTS;
}

/**
 * The last market price quoted for each symbol strictly BEFORE `beforeMs`.
 *
 * Feeds `buildAssetTS`'s carry-forward so a window that contains no trading day
 * (a weekend extend) still values holdings at the last real close rather than
 * dropping to book cost.
 *
 * @param {{ [sym: string]: { [dayMs: number]: number } }} pricesBySymbol
 * @returns {{ [sym: string]: number }}
 */
function seedPricesBefore(pricesBySymbol, beforeMs) {
  const seeds = {};
  for (const [sym, series] of Object.entries(pricesBySymbol || {})) {
    let bestDay = -Infinity;
    for (const k of Object.keys(series)) {
      const day = Number(k);
      if (day < beforeMs && day > bestDay) bestDay = day;
    }
    if (bestDay > -Infinity) seeds[sym] = series[bestDay];
  }
  return seeds;
}

/**
 * Aggregate per-account { cashTS, assetTS } stores into a single valuesTS for
 * net worth. The valuesTS ends at T-1 (settled); lastCashValue captures T cash.
 *
 * @param {Object[]|Object} acctStores  Array or map of { cashTS, assetTS, startMs, endMs }.
 * @returns {{ valuesTS: number[], globalStartMs: number, globalEndMs: number, lastCashValue: number, settledValue: number }}
 */
function buildNetWorthTS(acctStores) {
  const t1 = t1Ms();
  let valuesTS      = [];
  let globalStartMs = t1;
  let globalEndMs   = t1;
  let lastCashValue = 0; // Σ account cashTS[T]
  let settledValue  = 0; // Σ account settled (T-1) balances

  for (const store of Object.values(acctStores)) {
    const { cashTS = [], assetTS = [], startMs } = store;
    if (!cashTS.length && !assetTS.length) continue;

    lastCashValue += cashTS[cashTS.length - 1] ?? 0;

    // Account balance TS at T-1 = cashTS (clipped to T-1) + assetTS.
    const { result: balanceTS, startMs: balStart, endMs: balEnd } =
      tsAdder(cashTS, assetTS, startMs, startMs, t1, t1);
    settledValue += balanceTS[balanceTS.length - 1] ?? 0;

    // Fold this account's balance TS into the running net-worth TS.
    const { result: nwTS, startMs: nwStart, endMs: nwEnd } =
      tsAdder(valuesTS, balanceTS, globalStartMs, balStart, globalEndMs, balEnd);
    valuesTS      = nwTS;
    globalStartMs = nwStart;
    globalEndMs   = nwEnd;
  }

  return { valuesTS, globalStartMs, globalEndMs, lastCashValue, settledValue };
}

/**
 * Build cashTS + assetTS stores for every account referenced in `byAccount`.
 * Pure: relies on a caller-supplied `accountsById` map for the `isDebt` flag.
 *
 * @param {Object} byAccount     From buildAccountTxnsMap().byAccount
 * @param {Object} pricesBySymbol
 * @param {{ [aid: string]: { isDebt: boolean } }} accountsById
 * @param {number} [initialCashByAccount]  Optional { [aid]: startingCash } for extends.
 * @returns {{ [aid: string]: { cashTS, assetTS, startMs, endMs } }}
 */
function buildTransactionsTS(byAccount, pricesBySymbol, accountsById = {}, initialCashByAccount = {}) {
  const today = todayMs();
  const t1    = t1Ms();
  const accountStores = {};

  for (const [aid, bucket] of Object.entries(byAccount)) {
    const account = accountsById[aid];
    const isDebt  = account?.isDebt || false;

    const { cashTxns = [], assetTxns = [] } = bucket;

    // Earliest actual txn day. Infinity means that series is absent — never fall
    // back to `today`, or a calibration dated in the future would drag startMs
    // backwards and fabricate a spurious present-day entry.
    const startMs = Math.min(bucket.cashStartMs ?? Infinity, bucket.assetStartMs ?? Infinity);
    if (!Number.isFinite(startMs) || startMs > today) {
      // Nothing to build within [startMs, today] — emit an empty (no-op) store.
      accountStores[aid] = { cashTS: [], assetTS: [], startMs: today, endMs: today };
      continue;
    }

    // Cash TS — driven by every txn that moves cash (incl. asset txns w/ usesCashBalance).
    const cashImpactMap = buildCashImpactMap(cashTxns.concat(assetTxns), aid);
    const cashTS = buildCashTS(cashImpactMap, startMs, today, initialCashByAccount[aid] || 0);

    // Asset TS — rolling market value; skipped for debt accounts. Empty when the
    // window ends before it starts (startMs already at/after today → no settled day).
    // Seeded with the last close before the window, so a series that opens on a
    // non-trading day is still marked to market rather than to book cost.
    const assetTS = (!isDebt && assetTxns.length)
      ? buildAssetTS(assetTxns, pricesBySymbol, startMs, t1, seedPricesBefore(pricesBySymbol, startMs))
      : new Array(Math.max(0, Math.round((t1 - startMs) / DAY_MS) + 1)).fill(0);

    accountStores[aid] = { cashTS, assetTS, startMs, endMs: today };
  }

  return accountStores;
}

module.exports = {
  buildCashTS,
  buildAssetTS,
  buildNetWorthTS,
  buildTransactionsTS,
  seedPricesBefore,
};
