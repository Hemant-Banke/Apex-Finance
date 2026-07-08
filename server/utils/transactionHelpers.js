const { ASSET_TRANSACTION_TYPES } = require('../utils/constants');
const { midnight } = require('../utils/helpers');

/** Normalize an account reference (ObjectId | populated doc | string) to a string id. */
function accountIdOf(ref) {
  if (!ref) return null;
  return (ref._id ?? ref).toString();
}

/** Cash impact of a transaction on one specific account (source or destination). */
function accountCashImpact(tx, accountId) {
  const aid = accountId?.toString();
  const src = accountIdOf(tx.account);
  const dst = accountIdOf(tx.toAccount);

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

/** Directional asset-quantity impact of a transaction (+1 acquires units, -1 releases). */
function directionalAssetImpact(txType) {
  switch (txType) {
    case 'sell':              return -1;
    case '_assetcalibration':
    case 'buy':               return 1;
    default:                  return 0;
  }
}

/**
 * Produce the inverse of a transaction so its impact can be subtracted via delta.
 * buy↔sell swap cancels the asset delta; adjustment/transfer amount negation cancels cash.
 */
function flipTx(tx) {
  if (tx.type === 'buy')     return { ...tx, type: 'sell' };
  if (tx.type === 'sell')    return { ...tx, type: 'buy' };
  if (tx.type === 'income')  return { ...tx, type: 'expense' };
  if (tx.type === 'expense') return { ...tx, type: 'income' };
  return { ...tx, amount: -tx.amount }; // adjustment, transfer, calibration
}

/**
 * Build a cash impactsByDay map for the given account.
 *
 * @param {Object[]} txns  Transactions array (cash + asset txns for the account)
 * @param {string}   aid   Account ID
 * @returns {{ [dayMs: number]: number }}
 */
function buildCashImpactMap(txns, aid) {
  const cashImpacts = {};
  for (const tx of txns) {
    const delta = accountCashImpact(tx, aid);
    if (delta !== 0) {
      const k = midnight(new Date(tx.date));
      cashImpacts[k] = (cashImpacts[k] || 0) + delta;
    }
  }
  return cashImpacts;
}

/**
 * Partition a flat, date-sorted transaction list into per-account cash/asset buckets,
 * and collect the global set of traded symbols for a single batched price fetch.
 *
 * @param {Object[]} txns  Transactions sorted by date asc.
 * @returns {{
 *   byAccount: { [aid: string]: { cashTxns, assetTxns, cashStartMs, assetStartMs } },
 *   assets: Array<{ assetSymbol: string, assetType: string }>,
 *   assetStartMs: number
 * }}
 */
function buildAccountTxnsMap(txns) {
  const byAccount = {};
  const assetsSeen = new Map(); // sym → { assetSymbol, assetType }
  let assetStartMs = Infinity;

  const bucketFor = (aid) => (byAccount[aid] ??= {
    cashTxns: [], assetTxns: [], cashStartMs: Infinity, assetStartMs: Infinity,
  });

  for (const tx of txns) {
    const aid   = accountIdOf(tx.account);
    if (!aid) continue;
    const dayMs = midnight(new Date(tx.date));
    const acct  = bucketFor(aid);

    if (ASSET_TRANSACTION_TYPES.includes(tx.type)) {
      acct.assetTxns.push(tx);
      acct.assetStartMs = Math.min(acct.assetStartMs, dayMs);
      assetStartMs      = Math.min(assetStartMs, dayMs);

      const sym = tx.assetSymbol?.toUpperCase();
      if (sym && !assetsSeen.has(sym)) {
        assetsSeen.set(sym, { assetSymbol: sym, assetType: tx.assetType || 'stock' });
      }
    } else {
      acct.cashTxns.push(tx);
      acct.cashStartMs = Math.min(acct.cashStartMs, dayMs);
    }

    // Transfers also credit the destination account's cash series.
    if (tx.type === 'transfer') {
      const dst = accountIdOf(tx.toAccount);
      if (dst) {
        const dstAcct = bucketFor(dst);
        dstAcct.cashTxns.push(tx);
        dstAcct.cashStartMs = Math.min(dstAcct.cashStartMs, dayMs);
      }
    }
  }

  return {
    byAccount,
    assets: Array.from(assetsSeen.values()),
    assetStartMs: assetStartMs === Infinity ? null : assetStartMs,
  };
}

module.exports = {
  accountIdOf,
  accountCashImpact,
  directionalAssetImpact,
  flipTx,
  buildCashImpactMap,
  buildAccountTxnsMap,
};
