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
 */
function holdingsToArray(holdings) {
  return (holdings || []).map(h => ({
    symbol:         h.assetSymbol,
    name:           h.assetName || h.assetSymbol,
    type:           h.assetType || 'other',
    qty:            h.units || 0,
    avgCostPerUnit: h.avgPricePerUnit || 0,
    totalInvested:  h.totalInvested || 0,
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

    const txMs = new Date(tx.date).getTime();
    h.firstPurchaseDate   = h.firstPurchaseDate
      ? new Date(Math.min(new Date(h.firstPurchaseDate).getTime(), txMs))
      : new Date(txMs);
    h.lastTransactionDate = h.lastTransactionDate
      ? new Date(Math.max(new Date(h.lastTransactionDate).getTime(), txMs))
      : new Date(txMs);

    const dir = directionalAssetImpact(tx.type);
    h.units = (h.units || 0) + dir * tx.units;

    if (h.units > 0) {
      if (dir > 0) {
        // Adding to a long position updates the average cost.
        h.totalInvested   += tx.amount;
        h.avgPricePerUnit  = h.totalInvested / h.units;
      } else if (dir < 0) {
        // Reducing a long position drains the invested pool at the avg cost.
        h.totalInvested = (h.avgPricePerUnit || 0) * h.units;
      }
    } else if (h.units < 0) {
      if (dir < 0) {
        // Adding to a short position updates the (negative) average cost.
        h.totalInvested   -= tx.amount;
        h.avgPricePerUnit  = h.totalInvested / h.units;
      } else if (dir > 0) {
        // Covering a short position drains the pool at the avg cost.
        h.totalInvested = (h.avgPricePerUnit || 0) * h.units;
      }
    } else {
      // Flat position — no invested capital remains.
      h.totalInvested   = 0;
      h.avgPricePerUnit = 0;
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

async function upsertHolding(accountId, userId, holdings) {
  await AccountHoldings.findOneAndUpdate(
    { account: accountId, user: userId },
    { account: accountId, user: userId, holdings },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  getHoldingsMap,
  holdingsToArray,
  updateHoldingsMap,
  rebuildAllHoldingsFromMap,
  updateHoldingsFromMap,
  upsertHolding,
};
