const Transaction = require('../models/Transaction');

/**
 * Returns the current cash balance for an account.
 * Cash balance = income/sell inflows - expense/buy/transfer_out outflows + adjustments + incoming transfers
 */
async function getAccountCashBalance(accountId) {
  const [main, incoming] = await Promise.all([
    Transaction.aggregate([
      { $match: { account: accountId } },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $switch: {
                branches: [
                  { case: { $in: ['$type', ['income', 'sell']] }, then: '$amount' },
                  { case: { $in: ['$type', ['expense', 'buy', 'transfer']] }, then: { $multiply: ['$amount', -1] } },
                  { case: { $eq: ['$type', 'adjustment'] }, then: '$amount' },
                ],
                default: 0
              }
            }
          }
        }
      }
    ]),
    Transaction.aggregate([
      { $match: { toAccount: accountId, type: 'transfer' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);

  return (main[0]?.balance || 0) + (incoming[0]?.total || 0);
}

module.exports = { getAccountCashBalance };
