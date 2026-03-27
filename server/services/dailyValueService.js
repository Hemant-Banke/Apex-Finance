/**
 * dailyValueService — manages DailyNetWorth and DailyAccountBalance stores.
 *
 * Both stores share the same document structure:
 *   { startDate, endDate, values: [Number], lastValue }
 * where values[i] is the cumulative value on (startDate + i days).
 *
 * Public API:
 *   rebuild(userId)                        — full rebuild of all stores for user
 *   ensureUpToToday(userId)                — extend all stores to today
 *   onTransactionCreate(userId, tx)        — apply create to networth + account store
 *   onTransactionDelete(userId, tx)        — apply delete to networth + account store
 *   onTransactionUpdate(userId, oldTx, patch) — reverse old, apply new
 *   toDateStr(d)                           — YYYY-MM-DD helper
 *   DAY_MS                                 — milliseconds per day
 */

const Transaction          = require('../models/Transaction');
const Account              = require('../models/Account');
const DailyNetWorth        = require('../models/DailyNetWorth');
const DailyAccountBalance  = require('../models/DailyAccountBalance');

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;

/** UTC-midnight timestamp (integer) for any date-like value. */
function midnight(d) {
  const t = new Date(d).getTime();
  return t - (t % DAY_MS);
}

/** YYYY-MM-DD string for API output. */
function toDateStr(d) {
  const x = new Date(d);
  return [
    x.getUTCFullYear(),
    String(x.getUTCMonth() + 1).padStart(2, '0'),
    String(x.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Net-worth impact of a transaction.
 * Transfer nets to 0 across all accounts — skip it here.
 * Buy/sell: buy converts cash→asset (no net worth change in cash terms),
 * but we track cash net worth so buy = -amount, sell = +amount.
 */
function txImpactNetWorth(type, amount) {
  switch (type) {
    case 'income':
    case 'sell':
    case 'adjustment': return  amount;   // amount may be negative for adjustment
    case 'expense':
    case 'buy':        return -amount;
    case 'transfer':   return  0;
    default:           return  0;
  }
}

/**
 * Cash-balance impact of a transaction on a specific account.
 * Handles both source-side and destination-side of transfers.
 */
function accountTxImpact(tx, accountId) {
  const aid = accountId?.toString();
  const src = (tx.account?._id ?? tx.account)?.toString();
  const dst = (tx.toAccount?._id ?? tx.toAccount)?.toString();

  if (src === aid) {
    switch (tx.type) {
      case 'income':
      case 'sell':
      case 'adjustment': return  tx.amount;
      case 'expense':
      case 'buy':
      case 'transfer':   return -tx.amount;
      default:           return  0;
    }
  }
  if (dst === aid && tx.type === 'transfer') return tx.amount;
  return 0;
}

// ─── Generic store operations ────────────────────────────────────────────────

/**
 * Apply a one-time delta to a store document in a single O(totalDays) pass.
 * Handles all cases: no doc (create), txDate < startDate (prepend), txDate ≥ startDate (update+extend).
 *
 * @param {Model}  Model  — DailyNetWorth or DailyAccountBalance
 * @param {Object} filter — { user } or { account, user }
 * @param {Date}   txDate — date of the transaction
 * @param {number} delta  — signed impact amount
 */
async function applyDelta(Model, filter, txDate, delta) {
  if (!delta) return;

  const todayMs = midnight(Date.now());
  const txMs    = midnight(txDate);

  const doc = await Model.findOne(filter);

  if (!doc) {
    const numDays = (todayMs - txMs) / DAY_MS + 1;
    const values  = new Array(numDays).fill(delta);
    await Model.create({ ...filter, startDate: new Date(txMs), endDate: new Date(todayMs), values, lastValue: delta });
    return;
  }

  const docStartMs = midnight(doc.startDate);
  const docEndMs   = midnight(doc.endDate);
  const newStartMs = Math.min(txMs, docStartMs);
  const newEndMs   = Math.max(todayMs, docEndMs);
  const totalDays  = (newEndMs - newStartMs) / DAY_MS + 1;

  const existingOffset = (docStartMs - newStartMs) / DAY_MS;
  const existingEnd    = existingOffset + doc.values.length;
  const deltaIdx       = (txMs - newStartMs) / DAY_MS;
  const lastExisting   = doc.values[doc.values.length - 1] || 0;

  const values = new Array(totalDays);
  for (let i = 0; i < totalDays; i++) {
    const base = i < existingOffset ? 0
               : i < existingEnd   ? doc.values[i - existingOffset]
               : lastExisting;
    values[i] = base + (i >= deltaIdx ? delta : 0);
  }

  doc.startDate = new Date(newStartMs);
  doc.endDate   = new Date(newEndMs);
  doc.values    = values;
  doc.lastValue = values[totalDays - 1];
  doc.markModified('values');
  await doc.save();
}

/**
 * Trim leading days from the store so it begins at the first remaining transaction.
 * Called after a delete to fix the edge case where the earliest transaction was removed.
 *
 * @param {Model}  Model       — DailyNetWorth or DailyAccountBalance
 * @param {Object} docFilter   — query to find the store document
 * @param {Object} firstTxQuery — query to find the new first relevant transaction
 */
async function rebaseStart(Model, docFilter, firstTxQuery) {
  const doc = await Model.findOne(docFilter).lean();
  if (!doc) return;

  const firstTx = await Transaction.findOne(firstTxQuery).sort({ date: 1 }).select('date').lean();
  if (!firstTx) {
    await Model.deleteOne(docFilter);
    return;
  }

  const newStartMs = midnight(firstTx.date);
  const oldStartMs = midnight(doc.startDate);
  if (newStartMs <= oldStartMs) return; // no trim needed

  const trimDays  = Math.round((newStartMs - oldStartMs) / DAY_MS);
  const newValues = doc.values.slice(trimDays);
  if (!newValues.length) {
    await Model.deleteOne(docFilter);
    return;
  }

  await Model.updateOne(docFilter, {
    $set: {
      startDate: new Date(newStartMs),
      values:    newValues,
      lastValue: newValues[newValues.length - 1],
    }
  });
}

/**
 * Extend a single store to today using carry-forward (no recalculation).
 */
async function _extendStore(Model, filter, endMs) {
  const doc = await Model.findOne(filter).select('endDate lastValue').lean();
  if (!doc) return;
  const docEndMs = midnight(doc.endDate);
  if (docEndMs >= endMs) return;
  const extraDays = (endMs - docEndMs) / DAY_MS;
  const extra     = new Array(extraDays).fill(doc.lastValue || 0);
  await Model.updateOne(filter, {
    $push: { values: { $each: extra } },
    $set:  { endDate: new Date(endMs) }
  });
}

// ─── Rebuild ─────────────────────────────────────────────────────────────────

async function rebuildNetWorth(userId) {
  const txns = await Transaction.find({ user: userId })
    .sort({ date: 1 })
    .select('type amount date')
    .lean();

  if (!txns.length) {
    await DailyNetWorth.deleteOne({ user: userId });
    return;
  }

  const impactMap = {};
  for (const tx of txns) {
    const impact = txImpactNetWorth(tx.type, tx.amount);
    if (!impact) continue;
    const k = midnight(tx.date);
    impactMap[k] = (impactMap[k] || 0) + impact;
  }

  // Find first transaction with non-zero networth impact
  const firstImpactTx = txns.find(tx => txImpactNetWorth(tx.type, tx.amount) !== 0);
  if (!firstImpactTx) {
    await DailyNetWorth.deleteOne({ user: userId });
    return;
  }

  const startMs = midnight(firstImpactTx.date);
  const endMs   = midnight(Date.now());
  const numDays = (endMs - startMs) / DAY_MS + 1;

  let cumulative = 0;
  const values   = [];
  for (let i = 0; i < numDays; i++) {
    cumulative += impactMap[startMs + i * DAY_MS] || 0;
    values.push(cumulative);
  }

  await DailyNetWorth.findOneAndUpdate(
    { user: userId },
    { startDate: new Date(startMs), endDate: new Date(endMs), values, lastValue: values[values.length - 1] || 0 },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function rebuildAccount(accountId, userId) {
  const aid  = accountId.toString();
  const txns = await Transaction.find({
    $or: [{ account: accountId }, { toAccount: accountId }]
  }).sort({ date: 1 }).select('type amount date account toAccount').lean();

  if (!txns.length) {
    await DailyAccountBalance.deleteOne({ account: accountId });
    return;
  }

  const impactMap = {};
  for (const tx of txns) {
    const impact = accountTxImpact(tx, aid);
    if (!impact) continue;
    const k = midnight(tx.date);
    impactMap[k] = (impactMap[k] || 0) + impact;
  }

  // First transaction with non-zero account impact
  const firstImpactTx = txns.find(tx => accountTxImpact(tx, aid) !== 0);
  if (!firstImpactTx) {
    await DailyAccountBalance.deleteOne({ account: accountId });
    return;
  }

  const startMs = midnight(firstImpactTx.date);
  const endMs   = midnight(Date.now());
  const numDays = (endMs - startMs) / DAY_MS + 1;

  let cumulative = 0;
  const values   = [];
  for (let i = 0; i < numDays; i++) {
    cumulative += impactMap[startMs + i * DAY_MS] || 0;
    values.push(cumulative);
  }

  await DailyAccountBalance.findOneAndUpdate(
    { account: accountId },
    { account: accountId, user: userId, startDate: new Date(startMs), endDate: new Date(endMs), values, lastValue: values[values.length - 1] || 0 },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * Full rebuild of all stores for a user (networth + every account).
 */
async function rebuild(userId) {
  const accounts = await Account.find({ user: userId }).select('_id').lean();
  await Promise.all([
    rebuildNetWorth(userId),
    ...accounts.map(a => rebuildAccount(a._id, userId)),
  ]);
}

// ─── Ensure up to today ───────────────────────────────────────────────────────

/**
 * Extend all stores for a user to today with carry-forward.
 * Call on session start via POST /api/networth/ensure.
 */
async function ensureUpToToday(userId) {
  const endMs = midnight(Date.now());
  const acctDocs = await DailyAccountBalance.find({ user: userId }).select('account').lean();

  await Promise.all([
    _extendStore(DailyNetWorth, { user: userId }, endMs),
    ...acctDocs.map(d => _extendStore(DailyAccountBalance, { account: d.account }, endMs)),
  ]);
}

// ─── Transaction lifecycle hooks ─────────────────────────────────────────────

async function onTransactionCreate(userId, tx) {
  const aid      = (tx.account?._id ?? tx.account);
  const nwDelta  = txImpactNetWorth(tx.type, tx.amount);
  const srcDelta = accountTxImpact(tx, aid);

  const ops = [];
  if (nwDelta)  ops.push(applyDelta(DailyNetWorth,       { user: userId },             tx.date, nwDelta));
  if (srcDelta) ops.push(applyDelta(DailyAccountBalance, { account: aid, user: userId }, tx.date, srcDelta));

  if (tx.type === 'transfer' && tx.toAccount) {
    const dstId = (tx.toAccount?._id ?? tx.toAccount);
    ops.push(applyDelta(DailyAccountBalance, { account: dstId, user: userId }, tx.date, tx.amount));
  }

  await Promise.all(ops);
}

async function onTransactionDelete(userId, tx) {
  const aid      = (tx.account?._id ?? tx.account);
  const nwDelta  = txImpactNetWorth(tx.type, tx.amount);
  const srcDelta = accountTxImpact(tx, aid);

  const ops = [];

  if (nwDelta) {
    ops.push(
      applyDelta(DailyNetWorth, { user: userId }, tx.date, -nwDelta)
        .then(() => rebaseStart(
          DailyNetWorth,
          { user: userId },
          { user: userId, type: { $ne: 'transfer' } }
        ))
    );
  }

  if (srcDelta) {
    const aidStr = aid.toString();
    ops.push(
      applyDelta(DailyAccountBalance, { account: aid, user: userId }, tx.date, -srcDelta)
        .then(() => rebaseStart(
          DailyAccountBalance,
          { account: aid },
          { $or: [{ account: aidStr }, { toAccount: aidStr }] }
        ))
    );
  }

  if (tx.type === 'transfer' && tx.toAccount) {
    const dstId    = (tx.toAccount?._id ?? tx.toAccount);
    const dstStr   = dstId.toString();
    ops.push(
      applyDelta(DailyAccountBalance, { account: dstId, user: userId }, tx.date, -tx.amount)
        .then(() => rebaseStart(
          DailyAccountBalance,
          { account: dstId },
          { $or: [{ account: dstStr }, { toAccount: dstStr }] }
        ))
    );
  }

  await Promise.all(ops);
}

async function onTransactionUpdate(userId, oldTx, patch) {
  // Reverse old transaction, then apply new state
  await onTransactionDelete(userId, oldTx);
  await onTransactionCreate(userId, { ...oldTx, ...patch });
}

module.exports = {
  rebuild,
  ensureUpToToday,
  applyDelta,
  onTransactionCreate,
  onTransactionDelete,
  onTransactionUpdate,
  toDateStr,
  DAY_MS,
};
