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

const { fetchLatestPrices, fetchHistoricPrices, lastOnOrBefore, latestSessionDays } = require('./marketDataService');
const { resolveUnitPrice, isRateAsset } = require('../utils/assetPricing');
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
 *
 * Quantity and cost basis come from the trade REPLAY (`pools`), not the stored AVCO: the
 * store is maintained incrementally, so a back-dated or edited trade lands out of order
 * and its average drifts from the chronological one realised P&L is taken against. Two
 * bases made unrealised + realised disagree with value − money put in.
 */
async function loadBook(userId, account, pools = {}) {
  const docs = await AccountHoldings.find({ user: userId, ...(account && { account }) }).select('account holdings').lean();

  const book = {};
  for (const doc of docs) {
    for (const h of (doc.holdings || [])) {
      const sym = h.assetSymbol?.toUpperCase();
      if (!sym) continue;
      const pool  = pools[`${doc.account}|${sym}`];
      const units = pool ? pool.units : (h.units || 0);
      if (isFlatUnits(units, h.assetType)) continue;
      const invested = pool ? pool.invested : (h.totalInvested || 0);

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
        qty:            units,
        avgCostPerUnit: units ? invested / units : 0,
        totalInvested:  invested,
      });

      pos.units               += units;
      pos.totalInvested       += invested;
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
 * One trade against a running AVCO pool `{ units, invested }` (invested carries the sign
 * of units, so a short holds its proceeds as negative cost). Returns the P&L it realised.
 *
 * The part of a trade that reduces the position realises against the average; any
 * remainder opens the other side. Every trade keeps `invested = bought − sold + realised`,
 * which is what makes unrealised + realised equal value − net money in.
 */
function applyTrade(pos, dir, units, amount, assetType) {
  let realised = 0;
  const closing = pos.units * dir < 0 ? Math.min(units, Math.abs(pos.units)) : 0;
  if (closing > 0) {
    const avg = pos.invested / pos.units;
    const amt = amount * (closing / units);
    realised = dir < 0 ? amt - avg * closing : avg * closing - amt;
    pos.units += dir * closing;
    if (isFlatUnits(pos.units, assetType)) { pos.units = 0; pos.invested = 0; }
    else pos.invested = avg * pos.units;
  }
  const opening = units - closing;
  if (opening > 0) {
    pos.units    += dir * opening;
    pos.invested += dir * amount * (opening / units);
  }
  return realised;
}

/**
 * The trade history replayed once, chronologically, per ACCOUNT and symbol (a sale
 * draws from the account it happened in). The single source for cost basis, realised
 * P&L, XIRR flows and the trades a day change has to net out.
 *
 * The average a sell is costed at is the one in force ON THE DAY OF THE SELL — today's
 * would price the sale against buys that happened after it.
 */
async function replayTrades(userId, account) {
  const txns = await Transaction
    .find({ user: userId, type: { $in: ['buy', 'sell'] }, ...(account && { account }) })
    .select('account type assetSymbol assetType units amount date')
    .sort({ date: 1 })
    .lean()
    .then(chronological);

  const pools    = {};     // `${account}|${symbol}` → { units, invested }
  const bySymbol = {};     // symbol → realised INR
  const trades   = {};     // symbol → [{ ms, dir, units, amount }]
  const flows    = [];     // [dayMs, ±INR] — money into (−) and out of (+) the book
  let total = 0;

  for (const tx of txns) {
    const sym = tx.assetSymbol?.toUpperCase();
    if (!sym || !tx.units) continue;

    const ms  = midnight(tx.date);
    const dir = directionalAssetImpact(tx.type);
    const amt = tx.amount || 0;
    flows.push([ms, dir > 0 ? -amt : amt]);
    (trades[sym] ??= []).push({ ms, dir, units: tx.units, amount: amt });

    const pos = (pools[`${tx.account}|${sym}`] ??= { units: 0, invested: 0 });
    const r = applyTrade(pos, dir, tx.units, amt, tx.assetType);
    if (r) {
      bySymbol[sym] = (bySymbol[sym] || 0) + r;
      total += r;
    }
  }

  return { pools, realised: { total, bySymbol }, trades, flows };
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
 *
 * `baseDay` is the day the day change is measured FROM: trades dated after it are part of
 * the move and are netted out of it. `liveMissing` counts quoted positions that got no
 * live price (so fell back to the close).
 */
async function priceBook(book, wantLive = true) {
  if (!book.length) return { live: {}, prev: {}, dayBase: {}, baseDay: {}, liveMissing: 0 };

  const t1 = t1Ms();
  const [latest, history] = await Promise.all([
    wantLive ? fetchLatestPrices(book) : {},
    fetchHistoricPrices(book, t1 - PREV_CLOSE_LOOKBACK_DAYS * DAY_MS, t1),
  ]);

  const live = {};
  const prev = {};
  const dayBase = {};   // what today's move is measured FROM — `prev`, except for a fund
  const baseDay = {};
  let liveMissing = 0;
  // Which session each live price is from: on a weekend or holiday it is one already
  // stored as a close, and the day's move is that session's, not zero.
  const sessions = latestSessionDays(book.map(p => p.assetSymbol));

  for (const pos of book) {
    const sym     = pos.assetSymbol;
    const basisMs = midnight(pos.lastTransactionDate || pos.firstPurchaseDate || todayMs());

    const last = lastOnOrBefore(history[sym] || {}, t1);
    const before = last ? lastOnOrBefore(history[sym] || {}, last.day - DAY_MS) : null;
    const prevQuote = last?.value ?? null;
    // The day change is measured from a STORED close — in INR at that day's own FX, the
    // same close the settled basis uses. The live feed's previous close converted at
    // today's FX dropped the rupee's own move from a rupee figure. When the live price is
    // from a session already stored as a close (a weekend, before the open), the move is
    // that session's: its close against the one before.
    let dayBaseQuote = prevQuote;
    baseDay[sym] = last?.day ?? t1;
    const lastSessionDone = wantLive
      ? (latest[sym] == null || (sessions[sym] != null && last != null && sessions[sym] <= last.day))
      : true;
    if (lastSessionDone && before) {
      dayBaseQuote = before.value;
      baseDay[sym] = before.day;
    }

    // Settled basis: no live quote is asked for, so the day's move is the LAST SETTLED
    // session — the close before T-1's against T-1's own.
    if (!wantLive) {
      live[sym] = resolveUnitPrice(pos, { marketPrice: prevQuote, basePrice: pos.avgPricePerUnit ?? null, basisMs, atMs: t1 });
      prev[sym] = live[sym];
      // With no close at all (an FD, an EPF) the "session" is the last day's accrual.
      const fromMs = before?.day ?? t1 - DAY_MS;
      if (!before) baseDay[sym] = fromMs;
      dayBase[sym] = resolveUnitPrice(pos, {
        marketPrice: before?.value ?? null, basePrice: pos.avgPricePerUnit ?? null, basisMs, atMs: fromMs,
      });
      continue;
    }

    if (latest[sym] == null && !isRateAsset(pos.assetType)) liveMissing++;

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
        baseDay[sym] = navDays[navDays.length - 2];
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
    // When this fallback fires the position is at the last close, so its day change is
    // that session's move — exactly what the settled basis reports for it.
    // A live price from a session that is already a stored close IS that close; its last
    // trade differs from the official close by noise, and live would disagree with settled.
    const closedSession = sessions[sym] != null && last != null && sessions[sym] <= last.day;
    const marketNow = closedSession ? prevQuote : (latest[sym] ?? prevQuote);

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
      atMs: baseDay[sym],
    });
  }

  return { live, prev, dayBase, baseDay, liveMissing };
}

/**
 * Every position valued on one basis — THE valuation. The portfolio, every account
 * balance, the net-worth headline and today's chart point all read it, so no two of them
 * can price the same holding differently.
 *
 * @returns {Promise<{ holdings: Object[], replay: Object, allPriced: boolean, dayBase: number, asof: string }>}
 */
async function markBook(userId, { live: wantLive = true, account = null } = {}) {
  const replay = await replayTrades(userId, account);
  const book   = await loadBook(userId, account, replay.pools);
  if (!book.length) return { holdings: [], replay, allPriced: true, dayBase: 0, asof: wantLive ? todayStr() : t1Str() };

  const { live, prev, dayBase: dayFrom, baseDay, liveMissing } = await priceBook(book, wantLive);

  // `priced` tells the client whether these are real market numbers or a book-value
  // stand-in, so the UI can say so instead of quietly showing a P&L of exactly zero.
  let allPriced = true;
  let dayBase = 0;   // capital the day's move is measured against, over comparable positions

  const holdings = book.map(pos => {
    const sym      = pos.assetSymbol;
    const invested = pos.totalInvested;

    const livePrice = live[sym];
    const prevPrice = prev[sym];

    const basisPrice = wantLive ? livePrice : (prevPrice ?? livePrice);
    if (basisPrice == null) allPriced = false;

    // No opinion on the price → the position is worth what it cost. Never zero.
    const price = basisPrice ?? pos.avgPricePerUnit;
    const value = pos.units * price;

    // The day's move is the change in what the position is worth less the money put into
    // it since the base close: value − units then × base price − bought + sold. Pricing
    // today's buys at yesterday's close (units now × the price move) booked a move on
    // shares that were not held, and the day change stopped matching the change in gain.
    //
    // It needs BOTH ends to be real quotes. Comparing a book-value fallback against a
    // real quote once made the portfolio report a −25% overnight crash that never happened.
    const moveSince = (dayMs, fromPx) => {
      let unitsThen = pos.units, bought = 0, sold = 0;
      for (const t of replay.trades[sym] || []) {
        if (t.ms <= dayMs) continue;
        unitsThen -= t.dir * t.units;
        if (t.dir > 0) bought += t.amount; else sold += t.amount;
      }
      return { change: value - unitsThen * fromPx - bought + sold, base: Math.abs(unitsThen * fromPx) + bought };
    };
    const fromPrice  = dayFrom[sym];
    const comparable = livePrice != null && fromPrice != null;
    const day = comparable ? moveSince(baseDay[sym], fromPrice) : { change: 0, base: 0 };
    const dayChange = day.change, prevValue = day.base;
    dayBase += prevValue;
    // The same move measured from T-1's close instead of the session's base: what the
    // calendar series did, so net worth's 1D can swap one for the other (`assetValuesByAccount`).
    const calendarChange = comparable && prevPrice != null ? moveSince(t1Ms(), prevPrice).change : dayChange;

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
      realisedPnl:      replay.realised.bySymbol[sym] || 0,

      dayChange,
      dayChangePct: prevValue ? (dayChange / prevValue) * 100 : 0,
      calendarChange,

      firstPurchaseDate: pos.firstPurchaseDate ? new Date(pos.firstPurchaseDate) : null,
    };
  });

  // A live request that fell back to a close for any quoted holding is labelled as the close.
  const asof = wantLive && !liveMissing ? todayStr() : t1Str();
  return { holdings, replay, allPriced, dayBase, asof };
}

/**
 * Each account's asset value from `markBook` — a position's account share times the one
 * price its symbol was valued at, so the accounts add up to the portfolio exactly.
 *
 * `dayChange` is the portfolio's 1D; `calendarChange` the same book's move since T-1's close.
 *
 * @returns {Promise<{ byAccount: Object.<string, number>, total: number, dayChange: number, calendarChange: number, asof: string }>}
 */
async function assetValuesByAccount(userId, { live = false } = {}) {
  const { holdings, asof } = await markBook(userId, { live });
  const byAccount = {};
  let total = 0, dayChange = 0, calendarChange = 0;
  for (const h of holdings) {
    total += h.value;
    dayChange += h.dayChange;
    calendarChange += h.calendarChange;
    for (const p of h.positions) byAccount[p.account] = (byAccount[p.account] || 0) + p.qty * h.price;
  }
  return { byAccount, total, dayChange, calendarChange, asof };
}

/**
 * The whole portfolio, marked to market.
 *
 * @param {boolean} [opts.live=true]
 *   true  — value at the LATEST price (what it is worth right now).
 *   false — value at the last SETTLED close, T-1. The same basis the account balances use.
 *   The day change follows the basis: live against the previous session's close, or —
 *   settled — the last settled session (T-1's close against the close before it).
 *
 * @returns {Promise<{ holdings: Object[], totals: Object }>}
 */
// `account` scopes the whole book (holdings, weights, realised) to one account.
async function getPortfolio(userId, { live: wantLive = true, account = null } = {}) {
  const { holdings, replay, allPriced, dayBase, asof } = await markBook(userId, { live: wantLive, account });
  const realised = replay.realised;
  // Today even when settled: today's trades are in the flows, and must not fall after the end.
  const endMs = todayMs();

  if (!holdings.length) {
    return {
      holdings: [],
      totals: {
        invested: 0, value: 0,
        unrealisedPnl: 0, unrealisedPnlPct: 0,
        realisedPnl: realised.total,
        totalGain: realised.total,
        ...bookXirr(replay.flows, 0, endMs),
        dayChange: 0, dayChangePct: 0,
        holdingsCount: 0, priced: true,
        asof,
        live: wantLive,
      },
    };
  }

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
      ...bookXirr(replay.flows, value, endMs),
      dayChange,
      // Measured against only what was comparable, so an unpriceable holding neither
      // dilutes the move nor fabricates one.
      dayChangePct:     dayBase ? (dayChange / dayBase) * 100 : 0,
      holdingsCount:    holdings.length,
      priced:           allPriced,
      // Which basis these figures are on, so the UI can say so rather than leave the user
      // guessing whether a number is live or a day old.
      live:             wantLive,
      asof,
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
 * The window ends NOW, on the same basis and from the same valuation as `getPortfolio`
 * (`markBook`), with today's trades included — so the all-time gain here IS the
 * portfolio's total gain, and each row's is that holding's unrealised + realised.
 *
 * @param {number}  opts.fromMs  window start (UTC midnight); null = since the first trade
 * @param {boolean} opts.live    value the close of the window at live prices
 */
async function getContribution(userId, { fromMs = null, account = null, live: liveBasis = false } = {}) {
  const end = todayMs();

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
  const active = positions.filter(h =>
    !isFlatUnits(h.atStart.units, h.assetType) ||
    !isFlatUnits(h.atEnd.units,   h.assetType) ||
    h.bought || h.sold);

  if (!active.length) return { rows: [], totals: emptyContributionTotals(start, end) };

  // The start edge is priced from history (the lookback finds the last close before a
  // weekend); the end edge is the portfolio's own valuation.
  const [history, marked] = await Promise.all([
    fetchHistoricPrices(active, start - PREV_CLOSE_LOOKBACK_DAYS * DAY_MS, start),
    markBook(userId, { live: liveBasis, account }),
  ]);
  const markedBySymbol = new Map(marked.holdings.map(m => [m.symbol, m]));

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

  const rows = active.map(h => {
    const a = priceAt(h, h.atStart, start);
    const m = markedBySymbol.get(h.assetSymbol);
    // Not in the book → closed (worth nothing), or a store out of step with the trades (at cost).
    const b = m
      ? { value: m.value, quoted: m.priced }
      : { value: isFlatUnits(h.atEnd.units, h.assetType) ? 0 : h.atEnd.invested, quoted: isFlatUnits(h.atEnd.units, h.assetType) };

    const valueStart = h.atStart.units * a.price;
    const valueEnd   = b.value;
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
      quoted: (isFlatUnits(h.atStart.units, h.assetType) || a.quoted) && b.quoted,
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

module.exports = { getPortfolio, getContribution, allocationByType, assetValuesByAccount };
