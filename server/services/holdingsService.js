const AccountHoldings = require('../models/AccountHoldings');
const { directionalAssetImpact } = require("../utils/transactionHelpers");

// ─── Getter Services ───────────────────────────────────────────────────────────────
async function getHoldingsMap(userId, accountId) {
  let holdingsMap = {};
  const holdingsDoc = await AccountHoldings.findOne({ account: accountId, user: userId }).select('holdings').lean();
  if (holdingsDoc?.holdings) {
    for (const h of holdingsDoc.holdings) {
      holdingsMap[h.assetSymbol] = h;
    }
  }
  return holdingsMap;
}


// ─── Update and Rebuild Services ───────────────────────────────────────────────────────────────

/**
 * Alter Holdings Map for transactions
 */
function updateHoldingsMap(holdingsMap, assetTxns) {

  for (const tx of assetTxns) {
    const sym = tx.assetSymbol?.toUpperCase();
    holdingsMap[sym] ??= {
      'assetSymbol': sym,
      'assetName': tx.assetName,
      'assetType': tx.assetType
    };
    (holdingsMap[sym]['firstPurchaseDate'] ??= tx.date) = new Date(Math.min(holdingsMap[sym]['firstPurchaseDate'], tx.date));
    (holdingsMap[sym]['lastTransactionDate'] ??= tx.date) = new Date(Math.max(holdingsMap[sym]['lastTransactionDate'], tx.date));
    holdingsMap[sym]['totalInvested'] ??= 0;
    
    // Transaction Dynamics
    const txDirection = directionalAssetImpact(tx.type);
    holdingsMap[sym]['units'] = (holdingsMap[sym]['units'] || 0) + txDirection * tx.units;

    if (holdingsMap[sym]['units'] > 0) {
      // If we are net long, buying assets affects our avg price and selling assets decreases investment pool
      if (txDirection > 0){
        // Buying the Asset
        holdingsMap[sym]['totalInvested'] += tx.amount;
        holdingsMap[sym]['avgPricePerUnit'] = holdingsMap[sym]['totalInvested'] / holdingsMap[sym]['units'];
      }
      else if (txDirection < 0) {
        // Selling the Asset
        holdingsMap[sym]['avgPricePerUnit'] = (holdingsMap[sym]['avgPricePerUnit'] || 0);
        holdingsMap[sym]['totalInvested'] = holdingsMap[sym]['avgPricePerUnit'] * holdingsMap[sym]['units'];
      }
    }
    else if (holdingsMap[sym]['units'] < 0) {
      // If we are net short, selling assets affects our avg price and buying assets decreases investment pool
      if (txDirection > 0){
        // Buying the Asset
        holdingsMap[sym]['avgPricePerUnit'] = (holdingsMap[sym]['avgPricePerUnit'] || 0);
        holdingsMap[sym]['totalInvested'] = holdingsMap[sym]['avgPricePerUnit'] * holdingsMap[sym]['units'];
      }
      else if (txDirection < 0) {
        // Selling the Asset
        holdingsMap[sym]['totalInvested'] -= tx.amount;
        holdingsMap[sym]['avgPricePerUnit'] = holdingsMap[sym]['totalInvested'] / holdingsMap[sym]['units'];
      }
    }
  }
}


/**
 * Rebuild all holding documents from account-transaction map
 */
async function rebuildAllHoldingsFromMap(userId, accountTxnsMap) {
  for (const [accountId, txMap] of Object.entries(accountTxnsMap)) {
    let holdingsMap = {};
    updateHoldingsMap(holdingsMap, txMap['assetTxns']);
    
    const accountHoldings = Object.values(holdingsMap) || [];
    await upsertHolding(accountId, userId, accountHoldings);
  }
}

/**
 * Update holding documents corresponding to txns in account-transaction map
 */
async function updateHoldingsFromMap(userId, accountTxnsMap) {
  for (const [accountId, txMap] of Object.entries(accountTxnsMap)) {
    let holdingsMap = getHoldingsMap(userId, accountId);
    updateHoldingsMap(holdingsMap, txMap['assetTxns']);
    
    const accountHoldings = Object.values(holdingsMap) || [];
    await upsertHolding(accountId, userId, accountHoldings);
  }
}

// ─── Upsert Services ───────────────────────────────────────────────────────────────

async function upsertHolding(accountId, userId, holdings) {
  await AccountHoldings.findOneAndUpdate(
    { account: accountId, user: userId },
    {
      account: accountId, 
      user: userId,
      holdings
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = { 
  getHoldingsMap,
  updateHoldingsMap,
  rebuildAllHoldingsFromMap, 
  updateHoldingsFromMap,
  upsertHolding
};
