/**
 * marketSearchService — instrument search: Yahoo ∥ the local AMFI index ∥ the Nifty 500, ranked together.
 * Shared by `/market/search` and the assistant's tools.
 */

const { searchYahoo } = require('./marketDataService');
const mfService = require('./mfService');
const sectorService = require('./sectorService');

/**
 * How well a result answers the query. Yahoo hits and AMFI funds are ranked TOGETHER
 * by this, rather than one list always sitting above the other: "quant small" was
 * surfacing a US "TIAA-CREF Quant Small-Cap" above the Indian quant Small Cap Fund
 * purely because the query happened not to contain the word "fund".
 */
function relevanceTo(query) {
  const qLower  = query.trim().toLowerCase();
  const qTokens = qLower.split(/[^a-z0-9]+/).filter(t => t.length > 1);

  return (r) => {
    if (!qTokens.length) return 0;
    const symbol = (r.symbol || '').toLowerCase();
    const name   = `${r.name} ${r.symbol}`.toLowerCase();

    // Someone typing a ticker exactly means THAT instrument. Without this, "AAPL"
    // ranked a Thai depositary receipt (AAPL19.BK) above Apple, because its name
    // happens to begin with the query string.
    if (symbol === qLower) return 10;

    const hits = qTokens.filter(t => name.includes(t)).length;
    return hits / qTokens.length
      + (symbol.startsWith(qLower) ? 0.3 : 0)
      + (name.startsWith(qTokens[0]) ? 0.15 : 0);
  };
}

/** `indices` adds Yahoo INDEX hits (the Markets page; the asset form cannot buy one). */
async function searchInstruments(q, { indices = false } = {}) {
  if (!q || q.trim().length < 1) return [];
  // Concurrent, and none may sink the others. The Nifty 500 match guarantees the NSE listing.
  const [quotes, funds, nse] = await Promise.all([
    searchYahoo(q, { indices }).catch(() => []),
    mfService.searchSchemes(q, 8).catch(() => []),
    sectorService.searchUniverse(q, 8).catch(() => []),
  ]);
  // One row per symbol — the Nifty 500 row wins, as it carries the company's sector.
  const seen = new Set(nse.map(r => r.symbol));
  const score = relevanceTo(q);
  return [...nse, ...quotes.filter(r => !seen.has(r.symbol)), ...funds]
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(({ r }) => r);
}

module.exports = { searchInstruments };
