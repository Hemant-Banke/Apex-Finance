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

/**
 * The VALUE impact of a transaction that crosses a boundary from OUTSIDE the tracked
 * system — the "growth view" subtracts exactly this, so what remains is what the money
 * itself did rather than how much of it there was. A buy/sell settled in cash is
 * flow-neutral (cash and asset just swap places inside the boundary); one that ISN'T
 * settled in cash moves value across the boundary on its own, same as an
 * income/expense/transfer would (see the import review's In/Out convention, which is
 * this exact same system-boundary idea).
 *
 * `accountId` scopes which boundary: pass an account id for THAT account's own boundary
 * (a transfer in/out crosses it); omit it for the whole system's boundary (a transfer
 * between the user's own accounts cancels there and is not a flow).
 */
function externalFlowImpact(tx, accountId) {
  if (!accountId) {
    switch (tx.type) {
      case 'income':     return  tx.amount;
      case 'expense':    return -tx.amount;
      case 'adjustment': return  tx.amount;
      case 'buy':        return tx.usesCashBalance ? 0 :  tx.amount;
      case 'sell':       return tx.usesCashBalance ? 0 : -tx.amount;
      default:           return 0; // transfer nets to zero across the user's own accounts
    }
  }

  const aid = accountId.toString();
  const src = accountIdOf(tx.account);
  const dst = accountIdOf(tx.toAccount);

  if (src === aid) {
    switch (tx.type) {
      case 'income':
      case 'adjustment': return  tx.amount;
      case 'expense':
      case 'transfer':   return -tx.amount;
      case 'buy':        return tx.usesCashBalance ? 0 :  tx.amount;
      case 'sell':       return tx.usesCashBalance ? 0 : -tx.amount;
      default:           return 0;
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
 * Units below which a position counts as CLOSED, by asset type.
 *
 * Two different kinds of dust land in a holdings row, and they are orders of magnitude
 * apart:
 *
 *   - Float dust. Repeated AVCO buy/sell arithmetic never lands on exactly 0 — closing
 *     a fractional crypto position leaves 5.55e-17. Every asset type suffers this, so
 *     `FLAT_EPSILON` is the floor everywhere.
 *   - Quantity dust. A share is not divisible on any exchange this app prices against,
 *     yet a statement rounds ("9.9999" sold against 10 bought) and an import books the
 *     rounded figure. What is left is a thousandth of a share — not a position, an
 *     artefact — and it kept a symbol on the books, in the donut and in the asset
 *     series long after the user had sold out of it.
 *
 * Only exchange-traded SHARE counts get the wider tolerance. Crypto is genuinely held
 * in satoshis, a mutual fund in fractional units, metal in fractions of a gram, and an
 * EPF balance carries rupees as its "units" — a 1e-3 cut there would silently delete
 * real holdings, which is why the TODO scoped this to stocks alone.
 */
const FLAT_EPSILON       = 1e-9;
const SHARE_EPSILON      = 1e-3;
const SHARE_UNIT_TYPES   = new Set(['stock', 'etf']);

/** Tolerance below which `units` of this asset type is indistinguishable from zero. */
function unitsEpsilon(assetType) {
  return SHARE_UNIT_TYPES.has(assetType) ? SHARE_EPSILON : FLAT_EPSILON;
}

/** True when a quantity is dust rather than a real position (see `unitsEpsilon`). */
function isFlatUnits(units, assetType) {
  return Math.abs(Number(units) || 0) <= unitsEpsilon(assetType);
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
      const k = midnight(tx.date);
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
 *   assets: Array<{ assetSymbol: string, assetType: string, currency?: string }>,
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
    const dayMs = midnight(tx.date);
    const acct  = bucketFor(aid);

    if (ASSET_TRANSACTION_TYPES.includes(tx.type)) {
      acct.assetTxns.push(tx);
      acct.assetStartMs = Math.min(acct.assetStartMs, dayMs);
      assetStartMs      = Math.min(assetStartMs, dayMs);

      const sym = tx.assetSymbol?.toUpperCase();
      if (sym && !assetsSeen.has(sym)) {
        // `currency` rides along so the price fetch knows to convert this
        // symbol's quotes to INR.
        assetsSeen.set(sym, {
          assetSymbol: sym,
          assetType:   tx.assetType || 'stock',
          currency:    tx.currency,
        });
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
  unitsEpsilon,
  isFlatUnits,
  accountCashImpact,
  externalFlowImpact,
  directionalAssetImpact,
  flipTx,
  buildCashImpactMap,
  buildAccountTxnsMap,
};
