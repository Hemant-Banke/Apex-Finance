const { ASSET_TRANSACTION_TYPES } = require("../utils/constants");

/** Cash impact of a transaction on one specific account (source or destination). */
function accountCashImpact(tx, accountId) {
  const aid = accountId?.toString();
  const src = (tx.account?._id ?? tx.account)?.toString();
  const dst = (tx.toAccount?._id ?? tx.toAccount)?.toString();

  if (src === aid) {
    switch (tx.type) {
      case 'income':
      case '_cashcalibration':
      case 'adjustment':        return  tx.amount;
      case 'expense':
      case 'transfer':          return -tx.amount;
      case 'sell':              return (tx.usesCashBalance ? tx.amount : 0);
      case 'buy':               return (tx.usesCashBalance ? -tx.amount : 0);
      default:                  return  0;
    }
  }
  if (dst === aid && tx.type === 'transfer') return tx.amount;
  return 0;
}

/** Directional Asset impact of a transaction on one specific account (source or destination). */
function directionalAssetImpact(txType) {
  switch (txType) {
    case 'sell':              return -1;
    case '_assetcalibration':
    case 'buy':               return 1;
    default:                  return 0;
  }
  return 0;
}

/**
 * Produce the inverse of a transaction so its impact can be subtracted via delta.
 * buy-sell swap cancels the asset delta; adjustment/transfer amount negation cancels cash.
 */
function flipTx(tx) {
  if (tx.type === 'buy')     return { ...tx, type: 'sell' };
  if (tx.type === 'sell')    return { ...tx, type: 'buy' };
  if (tx.type === 'income')  return { ...tx, type: 'expense' };
  if (tx.type === 'expense') return { ...tx, type: 'income' };
  return { ...tx, amount: -tx.amount }; // adjustment, transfer
}

/**
 * Build a Cash impactsByDay map for transactions.
 *
 * @param {Object[]}  txns  Transactions array
 * @param {string} aid      Account ID
 * @returns {{ [dayMs: number]: number }}
 */
function buildCashImpactMap(txns, aid) {
  const cashImpacts = {};
  for (const tx of txns) {
    const delta = accountCashImpact(tx, aid);
    if (delta != 0) {
      const k = midnight(new Date(tx.date));
      cashImpacts[k] = (cashImpacts[k] || 0) + delta;
    }
  }
  return cashImpacts;
}

/**
 * Build an Account-Transactions map for transactions.
 *
 * @param {Object[]}  txns  Transactions sorted by date asc.
 * @returns {{ [aid: string]: Object }}  Map of accountId → Transactions Objects (sorted by date asc) for that account.
 */
function buildAccountTxnsMap(txns) {
  const accountTxns = {};
  let assetsSeen = new Set();
  for (const tx of txns) {
    const aid = tx.account._id;
    accountTxns[aid] ??= {};

    // Seperate Cash and Asset Txns
    if (ASSET_TRANSACTION_TYPES.includes(tx.type)) {
      (accountTxns[aid]['assetTxns'] ??= []).push(tx);
      (accountTxns[aid]['assetStartMs'] ??= Infinity) = Math.min(accountTxns[aid]['assetStartMs'], midnight(new Date(tx.date)));

      // Store Asset Symbol
      const sym = tx.assetSymbol?.toUpperCase();
      if (sym && !assetsSeen.has(sym)) {
        assetsSeen.add(sym);
        (accountTxns[aid]['assets'] ??= []).push({ 
          assetSymbol: sym, 
          assetType: tx.assetType || 'stock' 
        });
      }
    } else {
      (accountTxns[aid]['cashTxns'] ??= []).push(tx);
      (accountTxns[aid]['cashStartMs'] ??= Infinity) = Math.min(accountTxns[aid]['cashStartMs'], midnight(new Date(tx.date)));
    }

    // Handle Transfers
    if (tx.type === 'transfer' && tx.toAccountId) {
      const toAid = tx.toAccountId;
      (accountTxns[toAid]['cashTxns'] ??= []).push(tx);
      (accountTxns[toAid]['cashStartMs'] ??= Infinity) = Math.min(accountTxns[toAid]['cashStartMs'], midnight(new Date(tx.date)));
    }
  }

  return accountTxns;
}

module.exports = {
  accountCashImpact,
  directionalAssetImpact,
  flipTx,
  buildCashImpactMap,
  buildAccountTxnsMap
};