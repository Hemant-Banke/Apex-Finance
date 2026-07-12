const AccountHoldings = require('../models/AccountHoldings');
const { directionalAssetImpact } = require('../utils/transactionHelpers');

// ─── Getters ────────────────────────────────────────────────────────────────

/** Load an account's holdings as a { [symbol]: holding } map. */
async function getHoldingsMap(userId, accountId) {
  const holdingsMap = {};
  const holdingsDoc = await AccountHoldings.findOne({ account: accountId, user: userId }).select('holdings').lean();
  for (const h of (holdingsDoc?.holdings || [])) {
    if (h.assetSymbol) holdingsMap[h.assetSymbol] = h;
  }
  return holdingsMap;
}

/**
 * Normalize stored holding docs into the client-facing array shape.
 * Stored keys (assetSymbol/units/avgPricePerUnit) → client keys (symbol/qty/avgCostPerUnit).
 *
 * `avgCostPerUnit` / `totalInvested` are **INR** — they are what every valuation
 * and aggregation path uses, and what a foreign holding actually cost you in rupees.
 * `avgCostPerUnitNative` / `totalInvestedNative` are the same figures in the asset's
 * own currency (`currency`), for display: a US stock reads "$200 avg", not "₹16,682".
 * For an INR asset the two are identical.
 */
function holdingsToArray(holdings) {
  return (holdings || []).map(h => ({
    symbol:         h.assetSymbol,
    name:           h.assetName || h.assetSymbol,
    type:           h.assetType || 'other',
    qty:            h.units || 0,
    avgCostPerUnit: h.avgPricePerUnit || 0,
    totalInvested:  h.totalInvested || 0,
    avgCostPerUnitNative: h.avgPricePerUnitNative ?? h.avgPricePerUnit ?? 0,
    totalInvestedNative:  h.totalInvestedNative  ?? h.totalInvested  ?? 0,
    purity:         h.purity ?? null,
    rate:           h.rate ?? null,
    currency:       h.currency ?? null,
    firstPurchaseDate:   h.firstPurchaseDate || null,
    lastTransactionDate: h.lastTransactionDate || null,
  }));
}

// ─── AVCO map maintenance ──────────────────────────────────────────────────────

/**
 * Apply asset transactions to a holdings map in place, maintaining average cost
 * (AVCO) for long positions and short positions symmetrically.
 */
function updateHoldingsMap(holdingsMap, assetTxns = []) {
  for (const tx of assetTxns) {
    const sym = tx.assetSymbol?.toUpperCase();
    if (!sym) continue;

    const h = (holdingsMap[sym] ??= {
      assetSymbol: sym,
      assetName:   tx.assetName,
      assetType:   tx.assetType,
      units: 0,
      totalInvested: 0,
      avgPricePerUnit: 0,
    });

    // Valuation metadata — purity for physical metal, annual rate for unlisted
    // assets, quote currency for foreign ones. The latest transaction to carry a
    // value wins. (avgPricePerUnit / totalInvested stay INR: they derive from
    // `tx.amount`, which is always booked in INR.)
    if (tx.purity   != null) h.purity   = tx.purity;
    if (tx.rate     != null) h.rate     = tx.rate;
    if (tx.currency != null) h.currency = tx.currency;

    const txMs = new Date(tx.date).getTime();
    h.firstPurchaseDate   = h.firstPurchaseDate
      ? new Date(Math.min(new Date(h.firstPurchaseDate).getTime(), txMs))
      : new Date(txMs);
    h.lastTransactionDate = h.lastTransactionDate
      ? new Date(Math.max(new Date(h.lastTransactionDate).getTime(), txMs))
      : new Date(txMs);

    const dir = directionalAssetImpact(tx.type);
    h.units = (h.units || 0) + dir * tx.units;

    // The trade's cost in the asset's own currency. For an INR asset this equals
    // `tx.amount`; for a foreign one it is the dollar (etc.) figure the exchange
    // actually charged. Tracked as its own AVCO pool because it cannot be
    // recovered from the INR one — every buy settled at a different FX rate.
    const nativeAmount = tx.pricePerUnit != null
      ? Math.abs(tx.units * tx.pricePerUnit)
      : Math.abs(tx.amount || 0);

    if (h.units > 0) {
      if (dir > 0) {
        // Adding to a long position updates the average cost.
        h.totalInvested       += tx.amount;
        h.avgPricePerUnit      = h.totalInvested / h.units;
        h.totalInvestedNative  = (h.totalInvestedNative || 0) + nativeAmount;
        h.avgPricePerUnitNative = h.totalInvestedNative / h.units;
      } else if (dir < 0) {
        // Reducing a long position drains the invested pool at the avg cost.
        h.totalInvested       = (h.avgPricePerUnit || 0) * h.units;
        h.totalInvestedNative = (h.avgPricePerUnitNative || 0) * h.units;
      }
    } else if (h.units < 0) {
      if (dir < 0) {
        // Adding to a short position updates the (negative) average cost.
        h.totalInvested       -= tx.amount;
        h.avgPricePerUnit      = h.totalInvested / h.units;
        h.totalInvestedNative  = (h.totalInvestedNative || 0) - nativeAmount;
        h.avgPricePerUnitNative = h.totalInvestedNative / h.units;
      } else if (dir > 0) {
        // Covering a short position drains the pool at the avg cost.
        h.totalInvested       = (h.avgPricePerUnit || 0) * h.units;
        h.totalInvestedNative = (h.avgPricePerUnitNative || 0) * h.units;
      }
    } else {
      // Flat position — no invested capital remains.
      h.totalInvested        = 0;
      h.avgPricePerUnit      = 0;
      h.totalInvestedNative  = 0;
      h.avgPricePerUnitNative = 0;
    }
  }
}

// ─── Rebuild / update ──────────────────────────────────────────────────────────

/** Rebuild holdings for every account in a partitioned txn map (from scratch). */
async function rebuildAllHoldingsFromMap(userId, byAccount) {
  await Promise.all(Object.entries(byAccount).map(([accountId, bucket]) => {
    const holdingsMap = {};
    updateHoldingsMap(holdingsMap, bucket.assetTxns || []);
    return upsertHolding(accountId, userId, Object.values(holdingsMap));
  }));
}

/** Apply a delta set of asset transactions onto existing holdings. */
async function updateHoldingsFromMap(userId, byAccount) {
  await Promise.all(Object.entries(byAccount).map(async ([accountId, bucket]) => {
    if (!bucket.assetTxns?.length) return;
    const holdingsMap = await getHoldingsMap(userId, accountId);
    updateHoldingsMap(holdingsMap, bucket.assetTxns);
    return upsertHolding(accountId, userId, Object.values(holdingsMap));
  }));
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Units below this count as a flat position. Repeated buy/sell arithmetic leaves
 * float dust (a fully-closed position lands on 1e-16, not 0), so an exact `=== 0`
 * test would keep phantom holdings alive forever.
 */
const FLAT_EPSILON = 1e-9;

/** A position that has been fully closed — or deleted away — is no longer a holding. */
const hasPosition = (h) => Math.abs(h?.units || 0) > FLAT_EPSILON;

async function upsertHolding(accountId, userId, holdings) {
  // Prune flat positions here rather than in the callers: this is the single
  // writer, so deleting the last buy, selling out entirely, and a full rebuild
  // all drop the symbol from the array by the same rule.
  const open = (holdings || []).filter(hasPosition);

  await AccountHoldings.findOneAndUpdate(
    { account: accountId, user: userId },
    { account: accountId, user: userId, holdings: open },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  holdingsToArray,
  updateHoldingsMap,
  rebuildAllHoldingsFromMap,
  updateHoldingsFromMap,
  upsertHolding,
};
