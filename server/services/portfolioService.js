/**
 * portfolioService — what the holdings are actually WORTH, and how they have done.
 *
 * Everything else in the app reads the AVCO cost basis (`totalInvested`), which says
 * what was paid and nothing about what it is worth now. This is the one place that
 * marks the book to market and derives performance from it:
 *
 *   invested     — Σ cost basis (INR)                    [from AccountHoldings]
 *   value        — Σ qty × live price (INR)              [marketDataService]
 *   unrealisedPnl— value − invested
 *   dayChange    — value − Σ qty × T-1 close
 *   realisedPnl  — Σ over every sell: proceeds − (avg cost at the time × units sold)
 *
 * Realised P&L cannot come from the holdings store: a position that has been closed is
 * PRUNED from it (see holdingsService.upsertHolding), so the profit on a stock sold
 * last year lives nowhere but the transaction history. It is replayed here.
 */

const Transaction     = require('../models/Transaction');
const AccountHoldings = require('../models/AccountHoldings');

const { fetchLatestPrices, fetchHistoricPrices, lastOnOrBefore } = require('./marketDataService');
const { resolveUnitPrice }        = require('../utils/assetPricing');
const { directionalAssetImpact, isFlatUnits } = require('../utils/transactionHelpers');
const { midnight, todayMs, t1Ms, todayStr, t1Str } = require('../utils/helpers');
const { DAY_MS }                  = require('../utils/constants');

/** How far back to look for a T-1 close: enough to clear a weekend plus a holiday run. */
const PREV_CLOSE_LOOKBACK_DAYS = 10;

/**
 * Merge every account's holdings into one book, keyed by symbol.
 *
 * The same stock held in two accounts is ONE position to the user, so the INR pools are
 * summed and the average re-blended. The native pool (a US stock's "$200 avg") is summed
 * alongside it — it cannot be re-derived from the INR one, since every buy settled at a
 * different FX rate.
 *
 * The per-account split is kept alongside the merged figures (`positions`). Merging is
 * right for READING the book — it is one position to the user — but a SALE has to name
 * the account it draws from, and "you hold 30" is a lie if 12 of them sit in a different
 * broker. So the sell UI gets the breakdown while everything else keeps the total.
 */
async function loadBook(userId) {
  const docs = await AccountHoldings.find({ user: userId }).select('account holdings').lean();

  const book = {};
  for (const doc of docs) {
    for (const h of (doc.holdings || [])) {
      const sym = h.assetSymbol;
      if (!sym || isFlatUnits(h.units, h.assetType)) continue;

      const pos = (book[sym] ??= {
        assetSymbol: sym,
        assetName:   h.assetName || sym,
        assetType:   h.assetType || 'other',
        currency:    h.currency ?? null,
        purity:      h.purity ?? null,
        rate:        h.rate ?? null,
        units: 0, totalInvested: 0, totalInvestedNative: 0,
        firstPurchaseDate: null, lastTransactionDate: null,
        positions: [],
      });

      pos.positions.push({
        account:        doc.account?.toString() || null,
        qty:            h.units || 0,
        avgCostPerUnit: h.avgPricePerUnit || 0,
        totalInvested:  h.totalInvested || 0,
      });

      pos.units               += h.units || 0;
      pos.totalInvested       += h.totalInvested || 0;
      pos.totalInvestedNative += h.totalInvestedNative ?? h.totalInvested ?? 0;

      // Valuation metadata rides along — without purity/rate a metal or an FD cannot price.
      pos.purity ??= h.purity ?? null;
      pos.rate   ??= h.rate ?? null;

      const first = h.firstPurchaseDate && new Date(h.firstPurchaseDate).getTime();
      const last  = h.lastTransactionDate && new Date(h.lastTransactionDate).getTime();
      if (first && (!pos.firstPurchaseDate   || first < pos.firstPurchaseDate)) pos.firstPurchaseDate   = first;
      if (last  && (!pos.lastTransactionDate || last  > pos.lastTransactionDate)) pos.lastTransactionDate = last;
    }
  }

  for (const pos of Object.values(book)) {
    pos.avgPricePerUnit       = pos.units ? pos.totalInvested       / pos.units : 0;
    pos.avgPricePerUnitNative = pos.units ? pos.totalInvestedNative / pos.units : 0;
  }
  return Object.values(book);
}

/**
 * Realised P&L, by replaying the trade history with a running AVCO book.
 *
 * The average cost must be the one that was in force ON THE DAY OF THE SELL — using
 * today's average would price the sale against buys that happened after it. So the book
 * is rebuilt trade by trade and each sell takes its profit against the running average.
 *
 * Sells are matched per ACCOUNT (a sale draws from the account it happened in), then
 * totalled per symbol for the merged view.
 */
async function computeRealised(userId) {
  const txns = await Transaction
    .find({ user: userId, type: { $in: ['buy', 'sell'] } })
    .select('account type assetSymbol units amount date')
    .sort({ date: 1 })
    .lean();

  const bySymbol = {};     // symbol → realised INR
  const running  = {};     // `${account}|${symbol}` → { units, invested }
  let total = 0;

  for (const tx of txns) {
    const sym = tx.assetSymbol?.toUpperCase();
    if (!sym || !tx.units) continue;

    const key = `${tx.account}|${sym}`;
    const pos = (running[key] ??= { units: 0, invested: 0 });
    const dir = directionalAssetImpact(tx.type);

    if (dir > 0) {
      pos.units    += tx.units;
      pos.invested += tx.amount || 0;
      continue;
    }

    // A sell: profit is the proceeds less what those units cost, at the average then.
    const avg      = pos.units ? pos.invested / pos.units : 0;
    const costOut  = avg * tx.units;
    const proceeds = tx.amount || 0;

    bySymbol[sym] = (bySymbol[sym] || 0) + (proceeds - costOut);
    total        += proceeds - costOut;

    pos.units    -= tx.units;
    pos.invested  = pos.units > 0 ? avg * pos.units : 0;   // drain the pool at the average
  }

  return { total, bySymbol };
}

/**
 * Live price + previous close for every position, both in INR.
 *
 * Both go through `resolveUnitPrice`, so purity scaling and rate accrual apply exactly
 * as they do in the stores — a live figure and a settled one cannot disagree about how
 * an FD or a gold bar is valued.
 *
 * A price of `null` means the position genuinely cannot be priced (an unquoted asset with
 * no rate). Its market value falls back to its cost basis, so the portfolio total stays
 * honest rather than counting it as zero.
 */
async function priceBook(book) {
  if (!book.length) return { live: {}, prev: {} };

  const t1 = t1Ms();
  const [latest, history] = await Promise.all([
    fetchLatestPrices(book),
    fetchHistoricPrices(book, t1 - PREV_CLOSE_LOOKBACK_DAYS * DAY_MS, t1),
  ]);

  const live = {};
  const prev = {};

  for (const pos of book) {
    const sym     = pos.assetSymbol;
    const basisMs = midnight(pos.lastTransactionDate || pos.firstPurchaseDate || todayMs());

    const prevQuote = lastOnOrBefore(history[sym] || {}, t1)?.value ?? null;

    // A missing LIVE quote falls back to the last market CLOSE, not to book cost.
    //
    // The live (spark) and historic (chart) endpoints fail independently, and physical
    // metal in particular often prices historically while the live call comes back empty.
    // Falling back to cost then valued the same gold at ₹6,900/g here and ~₹14,000/g in
    // the settled store — the Accounts page and the Analytics page disagreed about the
    // same holding. Yesterday's close is a real market price; what you paid for it is not.
    //
    // When this fallback fires, live === prev, so the day change comes out as zero on its
    // own — which is the honest answer: we don't know how it moved today.
    const marketNow = latest[sym] ?? prevQuote;

    live[sym] = resolveUnitPrice(pos, {
      marketPrice: marketNow,
      basePrice:   pos.avgPricePerUnit ?? null,
      basisMs,
      atMs: todayMs(),
    });

    prev[sym] = resolveUnitPrice(pos, {
      marketPrice: prevQuote,
      basePrice:   pos.avgPricePerUnit ?? null,
      basisMs,
      atMs: t1,
    });
  }

  return { live, prev };
}

/**
 * The whole portfolio, marked to market.
 *
 * @param {boolean} [opts.live=true]
 *   true  — value at the LATEST price (what it is worth right now).
 *   false — value at the last SETTLED close, T-1. The same basis the stores use, so a
 *           settled portfolio total agrees with the settled account balances.
 *   Either way the day change is live-vs-T-1, because that is what a day change IS.
 *
 * @returns {Promise<{ holdings: Object[], totals: Object }>}
 */
async function getPortfolio(userId, { live: wantLive = true } = {}) {
  const [book, realised] = await Promise.all([loadBook(userId), computeRealised(userId)]);

  if (!book.length) {
    return {
      holdings: [],
      totals: {
        invested: 0, value: 0,
        unrealisedPnl: 0, unrealisedPnlPct: 0,
        realisedPnl: realised.total,
        dayChange: 0, dayChangePct: 0,
        holdingsCount: 0, priced: true,
        asof: wantLive ? todayStr() : t1Str(),
        live: wantLive,
      },
    };
  }

  const { live, prev } = await priceBook(book);

  // `priced` tells the client whether these are real market numbers or a book-value
  // stand-in, so the UI can say so instead of quietly showing a P&L of exactly zero.
  let allPriced = true;

  let dayBase = 0;   // Σ yesterday's value, over only the positions we can compare

  const holdings = book.map(pos => {
    const sym      = pos.assetSymbol;
    const invested = pos.totalInvested;

    const livePrice = live[sym];
    const prevPrice = prev[sym];

    // What the position is VALUED at depends on the basis asked for; the day change below
    // always compares live against T-1 regardless, because that is what a day change is.
    const basisPrice = wantLive ? livePrice : (prevPrice ?? livePrice);
    if (basisPrice == null) allPriced = false;

    // No opinion on the price → the position is worth what it cost. Never zero.
    const price = basisPrice ?? pos.avgPricePerUnit;
    const value = pos.units * price;

    // A day's move is only meaningful when BOTH ends are real quotes. If either is
    // missing the position simply did not move today, as far as we can honestly say.
    //
    // Comparing a book-value fallback against a real quote is how this went wrong before:
    // physical gold failed to price live (so it fell back to the ₹8,000/g it was bought
    // at) while its historic spot came through fine (~₹17,000/g), and the portfolio
    // reported a spectacular overnight crash that never happened.
    // Derived from the two PRICES, not from `value` — in settled mode `value` is itself
    // the T-1 figure, so `value - prevValue` would collapse to zero and the day's move
    // would vanish the moment you switched basis.
    const comparable = livePrice != null && prevPrice != null;
    const prevValue  = comparable ? pos.units * prevPrice : 0;
    const dayChange  = comparable ? pos.units * (livePrice - prevPrice) : 0;
    dayBase += prevValue;

    const unrealisedPnl = value - invested;

    return {
      symbol:  sym,
      name:    pos.assetName,
      type:    pos.assetType,
      qty:     pos.units,
      currency: pos.currency,
      // Valuation metadata the sell form needs to reconstruct this instrument without
      // going back through a market search (a metal's purity, an FD's coupon).
      purity:  pos.purity,
      rate:    pos.rate,
      // Which accounts actually hold it, largest first — the sell form defaults to the
      // account with the most and can only ever offer what that one holds.
      positions: [...pos.positions].sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty)),

      avgCostPerUnit:       pos.avgPricePerUnit,
      avgCostPerUnitNative: pos.avgPricePerUnitNative,
      invested,

      price,
      value,
      priced: basisPrice != null,

      unrealisedPnl,
      unrealisedPnlPct: invested ? (unrealisedPnl / Math.abs(invested)) * 100 : 0,
      realisedPnl:      realised.bySymbol[sym] || 0,

      dayChange,
      dayChangePct: prevValue ? (dayChange / Math.abs(prevValue)) * 100 : 0,

      firstPurchaseDate: pos.firstPurchaseDate ? new Date(pos.firstPurchaseDate) : null,
    };
  });

  const sum = (key) => holdings.reduce((s, h) => s + h[key], 0);
  const invested  = sum('invested');
  const value     = sum('value');
  const dayChange = sum('dayChange');
  const unrealisedPnl = value - invested;

  // Weight is share of the portfolio's market value — what the money is actually in now,
  // not what it was put in at.
  for (const h of holdings) h.weight = value ? (h.value / value) * 100 : 0;

  holdings.sort((a, b) => b.value - a.value);

  return {
    holdings,
    totals: {
      invested,
      value,
      unrealisedPnl,
      unrealisedPnlPct: invested ? (unrealisedPnl / Math.abs(invested)) * 100 : 0,
      realisedPnl:      realised.total,
      dayChange,
      // Measured against only what was comparable, so an unpriceable holding neither
      // dilutes the move nor fabricates one.
      dayChangePct:     dayBase ? (dayChange / Math.abs(dayBase)) * 100 : 0,
      holdingsCount:    holdings.length,
      priced:           allPriced,
      // Which basis these figures are on, so the UI can say so rather than leave the user
      // guessing whether a number is live or a day old.
      live:             wantLive,
      asof:             wantLive ? todayStr() : t1Str(),
    },
  };
}

/** Allocation by asset TYPE, at market value (and at cost, so drift is visible). */
function allocationByType(holdings) {
  const byType = {};
  for (const h of holdings) {
    const t = (byType[h.type] ??= { type: h.type, value: 0, invested: 0, symbols: [] });
    t.value    += h.value;
    t.invested += h.invested;
    t.symbols.push(h.symbol);
  }

  const total = holdings.reduce((s, h) => s + h.value, 0);
  return Object.values(byType)
    .map(t => ({ ...t, weight: total ? (t.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

module.exports = { getPortfolio, allocationByType };
