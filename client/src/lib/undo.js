/**
 * Putting back what a delete took away.
 *
 * A deleted transaction is gone from the server, but the client was holding the whole
 * document when it asked for the delete — so "undo" is just posting it back. It comes
 * back with a new `_id`, which is invisible and irrelevant: nothing in this app
 * identifies a transaction to a human by its id, and every derived figure (the stores,
 * the holdings, net worth) is rebuilt from the transaction either way.
 *
 * What this cannot restore is a delete performed in another tab or a previous session.
 * That is the honest boundary of an undo built on the client's own memory, and it is
 * why the confirm dialog still exists for anyone who has not switched it off.
 */

/** Fields that define a transaction. `_id`, `user` and timestamps are the server's. */
const CARRIED = [
  'type', 'amount', 'date', 'category', 'notes',
  'assetSymbol', 'assetName', 'assetType', 'units', 'pricePerUnit',
  'currency', 'purity', 'rate', 'usesCashBalance',
];

/** An id from a raw ObjectId, a populated doc, or a string. */
const idOf = (ref) => (ref && typeof ref === 'object' ? ref._id : ref) || undefined;

/**
 * Turn a transaction as the API returned it (accounts populated) back into a create
 * payload. `amount` rides along for cash rows; for an asset trade the server re-books
 * it from `units × pricePerUnit` at the trade date's FX, and since the date is
 * unchanged that lands on exactly the figure it had.
 */
export function toCreatePayload(tx) {
  const payload = { account: idOf(tx.account) };
  for (const k of CARRIED) if (tx[k] !== undefined && tx[k] !== null) payload[k] = tx[k];
  if (tx.type === 'transfer') payload.toAccount = idOf(tx.toAccount);
  return payload;
}
