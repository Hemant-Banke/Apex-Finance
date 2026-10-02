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

const { fetchLatestPrices, fetchHistoricPrices, lastOnOrBefore, latestPreviousCloses } = require('./marketDataService');
const { resolveUnitPrice }        = require('../utils/assetPricing');
const { directionalAssetImpact, isFlatUnits } = require('../utils/transactionHelpers');
const { midnight, todayMs, t1Ms, todayStr, t1Str, toDateStr } = require('../utils/helpers');
const { DAY_MS }                  = require('../utils/constants');
const { xirr }                    = require('../utils/series');
const mfService                   = require('./mfService');

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
async function loadBook(userId, account) {
  const docs = await AccountHoldings.find({ user: userId, ...(account && { account }) }).select('account holdings').lean();

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
async function computeRealised(userId, account) {
  const txns = await Transaction
    .find({ user: userId, type: { $in: ['buy', 'sell'] }, ...(account && { account }) })
    .select('account type assetSymbol units amount date')
    .sort({ date: 1 })
    .lean()
    .then(chronological);

  const bySymbol = {};     // symbol → realised INR
  const flows    = [];     // [dayMs, ±INR] — money into (−) and out of (+) the book
  const running  = {};     // `${account}|${symbol}` → { units, invested }
  let total = 0;

  for (const tx of txns) {
    const sym = tx.assetSymbol?.toUpperCase();
    if (!sym || !tx.units) continue;

    const key = `${tx.account}|${sym}`;
    flows.push([midnight(tx.date), directionalAssetImpact(tx.type) > 0 ? -(tx.amount || 0) : (tx.amount || 0)]);
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

  return { total, bySymbol, flows };
}

// Same-day trades carry no time, so buys go first: an intraday round trip is a buy then a
// sell, and replaying the sell first books a phantom short with its whole proceeds as profit.
const chronological = (txns) => txns.sort((a, b) =>
  midnight(a.date) - midnight(b.date) || directionalAssetImpact(b.type) - directionalAssetImpact(a.type));

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
  if (!book.length) return { live: {}, prev: {}, dayBase: {} };

  const t1 = t1Ms();
  const [latest, history] = await Promise.all([
    fetchLatestPrices(book),
    fetchHistoricPrices(book, t1 - PREV_CLOSE_LOOKBACK_DAYS * DAY_MS, t1),
  ]);

  const live = {};
  const prev = {};
  const dayBase = {};   // what today's move is measured FROM — `prev`, except for a fund
  // The live feed's own previous-session close: the day's move then compares like with
  // like, and on a weekend or holiday it is the last session's move rather than zero.
  const sessionPrev = latestPreviousCloses(book.map(p => p.assetSymbol));

  for (const pos of book) {
    const sym     = pos.assetSymbol;
    const basisMs = midnight(pos.lastTransactionDate || pos.firstPurchaseDate || todayMs());

    const prevQuote = lastOnOrBefore(history[sym] || {}, t1)?.value ?? null;
    let dayBaseQuote = latest[sym] != null && sessionPrev[sym] != null ? sessionPrev[sym] : prevQuote;

    // A fund reprices once a day, and its NAV for today is published only at night. All
    // day, then, its "latest" NAV IS yesterday's, and comparing it with yesterday's close
    // reported every fund as unchanged. A fund's day change is its LAST NAV move: when the
    // latest NAV is the one already on or before T-1, compare it with the NAV before that.
    // Only the day change's BASE moves — the fund is still VALUED at its latest NAV.
    if (mfService.isMfSymbol(sym) && latest[sym] != null) {
      const navDays = Object.keys(history[sym] || {}).map(Number).filter(d => d <= t1).sort((a, b) => a - b);
      const lastNav = navDays.length ? history[sym][navDays[navDays.length - 1]] : null;
      if (lastNav != null && Math.abs(lastNav - latest[sym]) < 1e-9 && navDays.length > 1) {
        dayBaseQuote = history[sym][navDays[navDays.length - 2]];
      }
    }

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

    dayBase[sym] = dayBaseQuote === prevQuote ? prev[sym] : resolveUnitPrice(pos, {
      marketPrice: dayBaseQuote,
      basePrice:   pos.avgPricePerUnit ?? null,
      basisMs,
      atMs: t1,
    });
  }

  return { live, prev, dayBase };
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
// `account` scopes the whole book (holdings, weights, realised) to one account.
async function getPortfolio(userId, { live: wantLive = true, account = null } = {}) {
  const [book, realised] = await Promise.all([loadBook(userId, account), computeRealised(userId, account)]);

  if (!book.length) {
    return {
      holdings: [],
      totals: {
        invested: 0, value: 0,
        unrealisedPnl: 0, unrealisedPnlPct: 0,
        realisedPnl: realised.total,
        totalGain: realised.total,
        ...bookXirr(realised.flows, 0, wantLive ? todayMs() : t1Ms()),
        dayChange: 0, dayChangePct: 0,
        holdingsCount: 0, priced: true,
        asof: wantLive ? todayStr() : t1Str(),
        live: wantLive,
      },
    };
  }

  const { live, prev, dayBase: dayFrom } = await priceBook(book);

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
    const fromPrice  = dayFrom[sym];
    const comparable = livePrice != null && fromPrice != null;
    const prevValue  = comparable ? pos.units * fromPrice : 0;
    const dayChange  = comparable ? pos.units * (livePrice - fromPrice) : 0;
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
      totalGain:        unrealisedPnl + realised.total,
      ...bookXirr(realised.flows, value, wantLive ? todayMs() : t1Ms()),
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

/**
 * Annualised money-weighted return of the book: every buy and sell as a dated flow, the
 * current value as the closing one. Withheld under 90 days, where annualising is noise.
 */
function bookXirr(flows, value, endMs) {
  if (!flows.length) return { xirr: null, since: null };
  const since = flows[0][0];
  if (endMs - since < 90 * DAY_MS) return { xirr: null, since: toDateStr(since) };
  const r = xirr([...flows, [endMs, value]]);
  return { xirr: r == null || !Number.isFinite(r) ? null : r, since: toDateStr(since) };
}

/**
 * Contribution to return over a WINDOW — what actually made the money, and when.
 *
 * `getPortfolio` can only ever answer "since you bought it": it reads the AVCO cost
 * basis, which has no date attached to it, so every figure it derives is lifetime. To
 * ask "what drove the last six months" the book has to be valued at BOTH ends of the
 * window and the money you moved in between taken out of the answer — otherwise a
 * ₹2L purchase made last month reads as ₹2L of profit.
 *
 * Per holding, over [fromMs, toMs]:
 *
 *   gain = value(toMs) − value(fromMs) − bought + sold
 *
 * which is the money-weighted gain: what it is worth now, less what it was worth then,
 * less what you fed it in between. A position CLOSED inside the window still appears —
 * `value(toMs)` is zero and `sold` carries the proceeds, so the profit banked on it is
 * counted where it happened. That is why this needs the transaction history and cannot
 * be read off `AccountHoldings`, which prunes anything closed.
 *
 * The denominator is CAPITAL STILL COMMITTED at the window's close — the position's
 * value at the start, plus what was bought, less a proportional release on anything
 * sold (`capitalProfile`). Plainly: the money that is in the book, which is what a
 * cumulative gain should be measured against and what the rest of the app already
 * divides by.
 *
 * Two earlier denominators were wrong, in opposite directions, and both are worth
 * remembering:
 *   - GROSS capital ever committed (sells never reducing it) left money returned by a
 *     trade closed years ago in the base for ever, and counted a round trip — ₹10k in,
 *     out, ₹10k in again — as ₹20k. All-time returns came out far too low.
 *   - AVERAGE capital at risk, integrated over the window, fixed both of those and
 *     broke something worse: the numerator is a gain ACCUMULATED over the window and is
 *     not scaled to match. A book funded steadily over five years has average capital
 *     around half of what has been put in, so it reported roughly DOUBLE the real
 *     return — a multi-year money-weighted figure wearing a period return's clothes.
 *
 * On the all-time window with nothing sold, this lands on exactly the same base as
 * `getPortfolio`'s `unrealisedPnlPct`, so the two agree. They diverge once something HAS
 * been sold, and should: the numerator here includes realised gains, and a proportional
 * release is not the same as the AVCO pool being drained at cost. Neither is the other's
 * approximation.
 *
 * Every row's gain over that one shared base is its share of the total in percentage
 * POINTS, and they sum, exactly, to the portfolio's return over the window — the list
 * is the headline taken apart, not a ranking of opinions.
 *
 * @param {number} opts.fromMs  window start (UTC midnight); null = since the first trade
 * @param {number} opts.toMs    window end (UTC midnight), default T-1
 */
async function getContribution(userId, { fromMs = null, toMs = null, account = null } = {}) {
  const end = toMs ?? t1Ms();

  const txns = await Transaction
    .find({ user: userId, type: { $in: ['buy', 'sell'] }, ...(account && { account }) })
    .select('type assetSymbol assetName assetType units amount date purity rate currency')
    .sort({ date: 1 })
    .lean()
    .then(chronological);

  if (!txns.length) return { rows: [], totals: emptyContributionTotals(fromMs, end) };

  // No explicit start → the whole history, which makes `value(start)` zero for every
  // holding and turns the same formula into lifetime total gain, realised included.
  const start = fromMs ?? (midnight(txns[0].date) - DAY_MS);

  const book = {};
  for (const tx of txns) {
    const sym = tx.assetSymbol?.toUpperCase();
    if (!sym || !tx.units) continue;
    const ms = midnight(tx.date);

    const h = (book[sym] ??= {
      assetSymbol: sym, assetName: tx.assetName || sym, assetType: tx.assetType || 'other',
      purity: null, rate: null, currency: null,
      units: 0, invested: 0, lastTxMs: ms,
      // Snapshots, taken lazily the first time the replay steps PAST each edge.
      atStart: null, atEnd: null,
      // `bought`/`sold` are the raw flows, which net out of the gain. `events` is the
      // same trades kept with their DATES, because the denominator is an integral over
      // the window and a flow's date is what decides how much of it it was there for.
      bought: 0, sold: 0, events: [],
    });

    // Valuation metadata: the latest trade to carry a value wins, exactly as the
    // holdings store decides it.
    if (tx.purity)   h.purity   = tx.purity;
    if (tx.rate    != null) h.rate     = tx.rate;
    if (tx.currency) h.currency = tx.currency;
    if (tx.assetName) h.assetName = tx.assetName;

    // Before applying a trade dated after an edge, the running state IS the state at
    // that edge. Both snapshots are taken here so a symbol whose every trade predates
    // the window still gets them (filled in after the loop).
    if (ms > start && !h.atStart) h.atStart = snapshot(h);
    if (ms > end   && !h.atEnd)   h.atEnd   = snapshot(h);

    const dir = directionalAssetImpact(tx.type);
    const amt = tx.amount || 0;

    if (ms > start && ms <= end) {
      if (dir > 0) h.bought += amt;
      else         h.sold   += amt;
      // `unitsBefore` is what turns a sale into a FRACTION of the position: releasing
      // capital proportionally is the only way the running figure stays consistent with
      // the market value it was seeded from. See `capitalProfile`.
      h.events.push({ ms, dir, amt, units: tx.units, unitsBefore: h.units });
    }

    if (dir > 0) {
      h.units    += tx.units;
      h.invested += amt;
    } else {
      const avg = h.units ? h.invested / h.units : 0;
      h.units   -= tx.units;
      h.invested = h.units > 0 ? avg * h.units : 0;
    }
    h.lastTxMs = ms;
  }

  const positions = Object.values(book);
  for (const h of positions) {
    h.atStart ??= snapshot(h);
    h.atEnd   ??= snapshot(h);
  }

  // Nothing held at either edge and nothing traded between them has no story here.
  const live = positions.filter(h =>
    !isFlatUnits(h.atStart.units, h.assetType) ||
    !isFlatUnits(h.atEnd.units,   h.assetType) ||
    h.bought || h.sold);

  if (!live.length) return { rows: [], totals: emptyContributionTotals(start, end) };

  // One batched fetch covering both edges. The lookback is what lets a window that
  // opens on a weekend still find the last real close before it.
  const history = await fetchHistoricPrices(live, start - PREV_CLOSE_LOOKBACK_DAYS * DAY_MS, end);

  const priceAt = (h, snap, atMs) => {
    const quote = lastOnOrBefore(history[h.assetSymbol] || {}, atMs)?.value ?? null;
    const base  = snap.units ? snap.invested / snap.units : null;
    const price = resolveUnitPrice(h, {
      marketPrice: quote,
      basePrice:   base,
      basisMs:     snap.lastTxMs,
      atMs,
    });
    // No opinion at all → the position is worth what it cost. Never zero.
    return { price: price ?? base ?? 0, quoted: price != null && quote != null };
  };

  const rows = live.map(h => {
    const a = priceAt(h, h.atStart, start);
    const b = priceAt(h, h.atEnd,   end);

    const valueStart = h.atStart.units * a.price;
    const valueEnd   = h.atEnd.units   * b.price;
    const gain       = valueEnd - valueStart - h.bought + h.sold;

    const { endCapital, peakCapital } = capitalProfile({ events: h.events, valueStart });
    // A position closed inside the window ends with nothing committed, so its own
    // return has to be measured against the most it ever had in — otherwise a trade
    // that made ₹3,000 on ₹5,000 divides by zero instead of reading 60%.
    const rowBase = endCapital > 0 ? endCapital : peakCapital;

    return {
      symbol: h.assetSymbol,
      name:   h.assetName,
      type:   h.assetType,
      valueStart, valueEnd,
      bought: h.bought,
      sold:   h.sold,
      capital: endCapital,
      rowBase,
      gain,
      // Its own return, on the capital it actually used. The contribution beside it is
      // the same gain over the WHOLE book's capital, and the gap between the two is the
      // pair's point: a fine return on a sliver of the book moves the total barely.
      returnPct: rowBase > 0 ? (gain / rowBase) * 100 : null,
      // A price that fell back to book cost is not a market opinion, and the row says
      // so rather than presenting an accrual as a quote.
      quoted: a.quoted && b.quoted,
    };
  });

  const totalGain    = rows.reduce((s, r) => s + r.gain, 0);
  // ONE shared base for every row, which is what makes the points additive: each row's
  // share is its gain over the whole book's committed capital, so they sum to the total.
  // Note this uses `capital`, not `rowBase` — a position closed inside the window has
  // nothing committed at the close and must not inflate the book's base, even though
  // its own return is quite properly measured against what it used.
  const totalCapital = rows.reduce((s, r) => s + r.capital, 0);

  for (const r of rows) {
    r.contributionPp = totalCapital > 0 ? (r.gain / totalCapital) * 100 : null;
  }
  rows.sort((x, y) => y.gain - x.gain);

  return {
    rows,
    totals: {
      gain:      totalGain,
      capital:   totalCapital,
      returnPct: totalCapital > 0 ? (totalGain / totalCapital) * 100 : null,
      from: toDateStr(start), to: toDateStr(end),
    },
  };
}

/** The running state of a position, frozen at a window edge. */
const snapshot = (h) => ({ units: h.units, invested: h.invested, lastTxMs: h.lastTxMs });

/**
 * How much capital this holding has committed, and the most it ever committed.
 *
 * `endCapital` — what is still tied up in it at the window's close. Seeded with the
 * position's market value at the window's start, then walked forward: a buy adds what
 * it cost, and a sale releases the same FRACTION of the running figure as the fraction
 * of units sold. Proportional release is what keeps the number consistent with the
 * market value it was seeded from, and it is why a round trip — ₹10k in, out, ₹10k in
 * again — reads as ₹10k of capital rather than ₹20k, and a fully-closed position lands
 * on exactly zero instead of on the profit it made.
 *
 * `peakCapital` — the most it held at once. Only used as the row's own denominator when
 * a position was closed inside the window and so ends at zero: a trade that made ₹3,000
 * on ₹5,000 returned 60%, and dividing by its ending capital of nothing would say either
 * "—" or infinity.
 *
 * There is deliberately NO time weighting here. Averaging capital over the window is the
 * textbook money-weighted denominator, and it was wrong for this table: the numerator is
 * a gain ACCUMULATED over the window and is not scaled to match, so a book funded
 * steadily over five years — whose average capital is roughly half of what has been put
 * in — reported double its real return. A cumulative gain belongs over the capital that
 * produced it, not over an average that silently annualises one side of the ratio.
 */
function capitalProfile({ events, valueStart }) {
  let capital = Math.max(0, valueStart);
  let peak    = capital;

  for (const ev of events) {
    if (ev.dir > 0) {
      capital += ev.amt;
    } else {
      const frac = ev.unitsBefore ? Math.min(1, Math.abs(ev.units / ev.unitsBefore)) : 1;
      capital = Math.max(0, capital - capital * frac);
    }
    peak = Math.max(peak, capital);
  }

  return { endCapital: capital, peakCapital: peak };
}

const emptyContributionTotals = (from, to) => ({
  gain: 0, capital: 0, returnPct: null,
  from: from == null ? null : toDateStr(from), to: toDateStr(to),
});

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

module.exports = { getPortfolio, getContribution, allocationByType };
