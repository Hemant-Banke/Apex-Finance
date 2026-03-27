const AccountHoldings = require('../models/AccountHoldings');
const Transaction = require('../models/Transaction');

/**
 * Rebuilds the AccountHoldings document for a given account by replaying
 * all buy/sell transactions in chronological order using average cost basis (AVCO).
 */
async function rebuildForAccount(accountId, userId) {
  const txns = await Transaction.find({
    account: accountId,
    type: { $in: ['buy', 'sell'] }
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  const holdingsMap = {};

  for (const tx of txns) {
    if (!tx.assetSymbol) continue;
    const sym = tx.assetSymbol.toUpperCase();

    if (!holdingsMap[sym]) {
      holdingsMap[sym] = {
        qty: 0,
        avgCostPerUnit: 0,
        totalInvested: 0,
        firstPurchaseDate: tx.date,
        lastTransactionDate: tx.date,
        name: tx.assetName || sym,
        type: tx.assetType || 'other'
      };
    }

    const h = holdingsMap[sym];

    if (tx.date >= h.lastTransactionDate) {
      if (tx.assetName) h.name = tx.assetName;
      if (tx.assetType) h.type = tx.assetType;
      h.lastTransactionDate = tx.date;
    }
    if (tx.date < h.firstPurchaseDate) h.firstPurchaseDate = tx.date;

    if (tx.type === 'buy') {
      h.totalInvested += tx.amount;
      h.qty += tx.units;
      h.avgCostPerUnit = h.qty > 0 ? h.totalInvested / h.qty : 0;
    } else if (tx.type === 'sell') {
      const costBasisQty = h.qty >= 0 ? Math.min(tx.units, h.qty) : 0;
      h.totalInvested -= h.avgCostPerUnit * costBasisQty;
      h.qty -= tx.units;
      h.avgCostPerUnit = h.qty > 0 ? h.totalInvested / h.qty : 0;
    }
  }

  // Use findOne + save to reliably persist Mixed-type field
  let doc = await AccountHoldings.findOne({ account: accountId });
  if (doc) {
    doc.holdings = holdingsMap;
    doc.lastUpdated = new Date();
    doc.markModified('holdings');
    await doc.save();
  } else {
    await AccountHoldings.create({
      account: accountId,
      user: userId,
      holdings: holdingsMap,
      lastUpdated: new Date()
    });
  }
}

/**
 * Applies a single buy/sell transaction incrementally to the AccountHoldings document.
 * Falls back to a full rebuild if the transaction predates the symbol's last known
 * transaction (AVCO ordering is order-sensitive).
 */
async function applyTransaction(accountId, userId, tx) {
  if (!tx.assetSymbol || !['buy', 'sell'].includes(tx.type)) return;

  const sym    = tx.assetSymbol.toUpperCase();
  const txDate = new Date(tx.date);

  let doc = await AccountHoldings.findOne({ account: accountId });
  if (!doc) return rebuildForAccount(accountId, userId);

  const holdings = doc.holdings || {};
  const existing = holdings[sym];

  // Rebuild if this tx lands before the last known tx for this symbol
  if (existing && existing.lastTransactionDate && txDate < new Date(existing.lastTransactionDate)) {
    return rebuildForAccount(accountId, userId);
  }

  const h = existing
    ? { ...existing }
    : {
        qty: 0, avgCostPerUnit: 0, totalInvested: 0,
        firstPurchaseDate:   txDate,
        lastTransactionDate: txDate,
        name: tx.assetName || sym,
        type: tx.assetType || 'other'
      };

  if (!existing || txDate >= new Date(h.lastTransactionDate || 0)) {
    h.lastTransactionDate = txDate;
    if (tx.assetName) h.name = tx.assetName;
    if (tx.assetType) h.type = tx.assetType;
  }
  if (!existing || txDate < new Date(h.firstPurchaseDate || txDate)) {
    h.firstPurchaseDate = txDate;
  }

  if (tx.type === 'buy') {
    h.totalInvested += tx.amount;
    h.qty += tx.units;
    h.avgCostPerUnit = h.qty > 0 ? h.totalInvested / h.qty : 0;
  } else {
    const costBasisQty = h.qty >= 0 ? Math.min(tx.units, h.qty) : 0;
    h.totalInvested -= h.avgCostPerUnit * costBasisQty;
    h.qty -= tx.units;
    h.avgCostPerUnit = h.qty > 0 ? h.totalInvested / h.qty : 0;
  }

  holdings[sym] = h;
  doc.holdings = holdings;
  doc.markModified('holdings');
  doc.lastUpdated = new Date();
  await doc.save();
}

/**
 * Rebuild holdings for ALL accounts belonging to a user.
 * Called from the networth rebuild endpoint.
 */
async function rebuildAllForUser(userId) {
  const AccountModel = require('../models/Account');
  const accounts = await AccountModel.find({ user: userId, isDebt: { $ne: true } }).lean();
  await Promise.all(accounts.map(a => rebuildForAccount(a._id, userId)));
}

/**
 * Converts the stored holdings object to a frontend-friendly array.
 * Returns all holdings including zero/short positions.
 */
function holdingsToArray(holdingsDoc) {
  if (!holdingsDoc) return [];
  const map = holdingsDoc.holdings instanceof Map
    ? Object.fromEntries(holdingsDoc.holdings)
    : holdingsDoc.holdings || {};

  return Object.entries(map).map(([symbol, h]) => ({
    symbol,
    name:                h.name,
    type:                h.type,
    qty:                 h.qty,
    avgCostPerUnit:      h.avgCostPerUnit,
    totalInvested:       h.totalInvested,
    firstPurchaseDate:   h.firstPurchaseDate,
    lastTransactionDate: h.lastTransactionDate
  }));
}

module.exports = { rebuildForAccount, applyTransaction, rebuildAllForUser, holdingsToArray };
