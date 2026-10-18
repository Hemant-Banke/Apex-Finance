/**
 * peerGrowthService — how fast a company's revenue and profit have grown, and how that
 * stands against its competitors. Served apart from the stock page: the first read
 * fetches a dozen companies' filings.
 *
 * Growth per company, from its own filings:
 *   3y / 5y — compound average annual growth, latest fiscal year against N years before.
 *   ttm     — the last four quarters against the four before them.
 * A loss at either end makes a growth rate meaningless, so it is withheld (null).
 */

const screenerService = require('./screenerService');
const stockService    = require('./stockService');
const { round, filingsGrowth } = require('../utils/series');

const TTL_MS   = 6 * 3600 * 1000;
const MAX_PEERS = 20;
const _memo = new Map();

function _median(xs) {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

async function _pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

async function getPeerGrowth(symbol, { global = false } = {}) {
  const key = `${global ? 'g' : 'n'}:${symbol}`;
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const stock = await stockService.getStock(symbol, { global });
  const items = stock.peers?.items || [];
  // The largest competitors (the list is by market cap), plus the company wherever it ranks.
  const chosen = [...items.filter(p => !p.self).slice(0, MAX_PEERS), ...items.filter(p => p.self)];
  if (!chosen.some(p => p.self)) chosen.push({ symbol, name: stock.name, self: true });

  const filings = await _pool(chosen, 4, p => (global ? stockService._yahooFinancials(p.symbol) : screenerService.getCompany(p.symbol)));
  const rows = chosen.map((p, i) => ({ symbol: p.symbol, name: p.name, self: !!p.self, ...filingsGrowth(filings[i]) }))
    .filter(r => r.self || ['3y', '5y', 'ttm'].some(w => r[w].revenue != null || r[w].profit != null));

  const others = rows.filter(r => !r.self);
  const median = Object.fromEntries(['3y', '5y', 'ttm'].map(w => [w, {
    revenue: round(_median(others.map(r => r[w].revenue)), 1),
    profit:  round(_median(others.map(r => r[w].profit)), 1),
  }]));

  const data = {
    symbol, global,
    group: global ? 'Often compared with' : stock.peers?.sector?.label || null,
    rows, median,
  };
  _memo.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getPeerGrowth };
