/**
 * behaviourService — how the user actually behaves with money, measured from their own
 * transactions. Deterministic: the assistant explains these figures, it never estimates them.
 *
 * Sections: trading (activity, holding periods, what was sold at a profit or loss and when),
 * timing (what an instrument had done in the 30 days before each trade), concentration,
 * revealed risk (what the book is invested in and how much it swings), and money habits
 * (savings, spending drift, cash cover, debt). `observations` states the notable findings
 * as sentences, each with the figures behind it.
 */

const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const { getPortfolio } = require('./portfolioService');
const { getProfile } = require('./portfolioProfileService');
const { getCalendar } = require('./calendarService');
const { fetchHistoricPrices, lastOnOrBefore } = require('./marketDataService');
const dash = require('./dashboardService');
const { DAY_MS } = require('../utils/constants');
const { midnight, todayMs, toDateStr } = require('../utils/helpers');

const QUOTED = new Set(['stock', 'etf', 'mutual_fund', 'crypto']);
const MOVE_PCT = 8;          // a prior 30-day move beyond ±8% counts as a rally or a drop
const LONG_TERM_DAYS = 365;  // Indian equity LTCG threshold
const MEMO_MS = 30 * 60 * 1000;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const cv = (xs) => {
  const m = mean(xs);
  if (!m) return null;
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / Math.abs(m);
};
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r0 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const pct = (a, b) => (b ? (a / b) * 100 : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * FIFO lots per account × symbol: each sell is matched to the oldest units still held.
 * Gives every sold unit its holding period and its gain, which the AVCO pool cannot.
 */
function matchLots(trades) {
  const pools = new Map();
  const sells = [];
  for (const t of trades) {
    const key = `${t.account}|${t.assetSymbol}`;
    const lots = pools.get(key) || [];
    pools.set(key, lots);
    const units = Math.abs(t.units || 0);
    if (!units) continue;
    const unitPrice = (t.amount || 0) / units;
    if (t.type === 'buy') { lots.push({ day: midnight(t.date), units, unitPrice }); continue; }

    let left = units, cost = 0, daysWeighted = 0, matched = 0;
    while (left > 1e-9 && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.units, left);
      cost += take * lot.unitPrice;
      daysWeighted += take * (midnight(t.date) - lot.day) / DAY_MS;
      matched += take;
      lot.units -= take; left -= take;
      if (lot.units <= 1e-9) lots.shift();
    }
    if (!matched) continue;   // a short sale has no holding period
    const proceeds = matched * unitPrice;
    sells.push({
      symbol: t.assetSymbol, name: t.assetName, type: t.assetType, date: toDateStr(t.date),
      proceeds, gain: proceeds - cost, gainPct: pct(proceeds - cost, cost),
      daysHeld: daysWeighted / matched,
    });
  }
  return sells;
}

/** What the instrument did in the 30 days before each trade: did buys follow rallies or drops? */
async function tradeTiming(trades) {
  const quoted = trades.filter(t => QUOTED.has(t.assetType) && t.assetSymbol);
  if (!quoted.length) return null;
  const items = [...new Map(quoted.map(t => [t.assetSymbol, {
    assetSymbol: t.assetSymbol, assetType: t.assetType, currency: t.currency,
  }])).values()];
  const from = Math.min(...quoted.map(t => midnight(t.date))) - 40 * DAY_MS;
  const prices = await fetchHistoricPrices(items, from, todayMs()).catch(() => ({}));

  const moves = { buy: [], sell: [] };
  for (const t of quoted) {
    const series = prices[t.assetSymbol];
    if (!series) continue;
    const day = midnight(t.date);
    const then = lastOnOrBefore(series, day - 30 * DAY_MS);
    const before = lastOnOrBefore(series, day - DAY_MS);
    // Both ends must be real quotes near their dates, or a sparse series reads as a move.
    if (!then || !before || then.day < day - 40 * DAY_MS || before.day < day - 10 * DAY_MS || !then.value) continue;
    moves[t.type].push({ move: (before.value / then.value - 1) * 100, amount: t.amount || 0, symbol: t.assetSymbol, date: toDateStr(day) });
  }
  const summarise = (rows) => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const share = (f) => r1(pct(rows.filter(f).reduce((s, r) => s + r.amount, 0), total));
    return {
      trades: rows.length,
      medianPriorMovePct: r1(median(rows.map(r => r.move))),
      afterRallyPctOfValue: share(r => r.move > MOVE_PCT),
      afterDropPctOfValue: share(r => r.move < -MOVE_PCT),
    };
  };
  return {
    note: `Each trade's instrument move over the 30 days before it; a rally or drop is beyond ±${MOVE_PCT}%.`,
    buys: summarise(moves.buy),
    sells: summarise(moves.sell),
    // One row per instrument and day: a sale is often booked as several fills.
    sellsAfterDrop: [...new Map(moves.sell.filter(r => r.move < -MOVE_PCT)
      .map(r => [`${r.symbol}|${r.date}`, r])).values()]
      .sort((a, b) => a.move - b.move).slice(0, 5)
      .map(r => ({ symbol: r.symbol, date: r.date, priorMovePct: r1(r.move) })),
  };
}

/** The book's swing, time-weighted from the calendar's daily returns (flows removed). */
function bookRisk(days) {
  const rets = days.filter(d => d.ret != null && Number.isFinite(d.ret));
  if (rets.length < 60) return null;
  const lastYear = rets.slice(-365).map(d => d.ret);
  const m = mean(lastYear);
  const vol = Math.sqrt(mean(lastYear.map(r => (r - m) ** 2))) * Math.sqrt(365);
  let idx = 1, peak = 1, maxDd = 0, ddFrom = null, ddAt = null, peakDate = rets[0].date;
  for (const d of rets) {
    idx *= 1 + d.ret;
    if (idx > peak) { peak = idx; peakDate = d.date; }
    const dd = idx / peak - 1;
    if (dd < maxDd) { maxDd = dd; ddFrom = peakDate; ddAt = d.date; }
  }
  return {
    volatilityPct: r1(vol * 100),
    maxDrawdownPct: r1(maxDd * 100),
    maxDrawdownWindow: ddFrom ? { from: ddFrom, to: ddAt } : null,
    currentDrawdownPct: r1((idx / peak - 1) * 100),
  };
}

/** 0–100 from what the book holds and how it swings; every component is returned with it. */
function riskScore({ growthShare, smallMidShare, cryptoShare, top3Share, volatilityPct }) {
  const parts = {
    growthAssets: 45 * clamp01(growthShare),
    smallMidCaps: 15 * clamp01(smallMidShare),
    crypto:       15 * clamp01(cryptoShare / 0.10),
    concentration: 10 * clamp01((top3Share - 0.30) / 0.40),
    volatility:   15 * clamp01((volatilityPct ?? 0) / 25),
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  const label = score < 25 ? 'Conservative' : score < 45 ? 'Moderately conservative'
    : score < 60 ? 'Moderate' : score < 75 ? 'Growth' : 'Aggressive';
  return { score: r0(score), label, components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(v)])) };
}

async function computeBehaviour(userId) {
  const [trades, subsDoc, portfolio, calendar, months, spending, summary] = await Promise.all([
    Transaction.find({ user: userId, type: { $in: ['buy', 'sell'] } })
      .select('type date assetSymbol assetName assetType units amount account currency').lean(),
    Subscription.findOne({ user: userId }).lean(),
    getPortfolio(userId, { live: false }),
    getCalendar(userId, { live: false }),
    dash.getIncomeExpense(userId, 24),
    dash.getSpendingProfile(userId, 12),
    dash.getSummary(userId, { live: false }),
  ]);
  // Same-day trades replay buys first, as the portfolio replay does.
  trades.sort((a, b) => (midnight(a.date) - midnight(b.date)) || (a.type === 'buy' ? -1 : 1));

  const today = todayMs();
  const holdings = portfolio.holdings;
  const total = portfolio.totals.value || 0;
  const profile = holdings.length ? await getProfile(holdings).catch(() => null) : null;

  // ── Trading ──
  const firstMs = trades.length ? midnight(trades[0].date) : null;
  const years = firstMs ? Math.max((today - firstMs) / (365 * DAY_MS), 1 / 12) : null;
  const buys = trades.filter(t => t.type === 'buy'), sellsTx = trades.filter(t => t.type === 'sell');
  const monthsSpan = firstMs ? Math.max(1, Math.round((today - firstMs) / (30.44 * DAY_MS))) : 0;
  const buyMonths = new Set(buys.map(t => toDateStr(t.date).slice(0, 7))).size;
  const lastYear = trades.filter(t => midnight(t.date) >= today - 365 * DAY_MS);
  const sumAmt = (xs) => xs.reduce((s, t) => s + (t.amount || 0), 0);
  const sips = (subsDoc?.subscriptions || []).filter(s => s.active && s.type === 'buy'
    && (!s.endDate || midnight(s.endDate) >= today));

  const sold = matchLots(trades);
  const winners = sold.filter(s => s.gain > 0), losers = sold.filter(s => s.gain <= 0);
  const soldValue = sold.reduce((s, x) => s + x.proceeds, 0);
  const openLosers = holdings.filter(h => h.priced && h.unrealisedPnl < 0 && h.firstPurchaseDate);
  const openWinners = holdings.filter(h => h.priced && h.unrealisedPnl > 0 && h.firstPurchaseDate);
  const ageDays = (h) => (today - midnight(h.firstPurchaseDate)) / DAY_MS;

  const trading = {
    firstTrade: firstMs ? toDateStr(firstMs) : null,
    buys: buys.length, sells: sellsTx.length,
    tradesPerYear: years ? r1(trades.length / years) : null,
    last12Months: { buys: lastYear.filter(t => t.type === 'buy').length, sells: lastYear.filter(t => t.type === 'sell').length,
      bought: r0(sumAmt(lastYear.filter(t => t.type === 'buy'))), sold: r0(sumAmt(lastYear.filter(t => t.type === 'sell'))) },
    turnoverPct: total ? r1(pct(sumAmt(lastYear.filter(t => t.type === 'sell')), total)) : null,
    monthsWithABuyPct: monthsSpan ? r0(pct(buyMonths, monthsSpan)) : null,
    activeSips: sips.map(s => ({ name: s.assetName || s.assetSymbol, frequency: s.frequency,
      amount: s.invariant === 'amount' ? s.amount : null, units: s.invariant === 'units' ? s.units : null })),
    sold: {
      sales: sold.length,
      medianDaysHeld: r0(median(sold.map(s => s.daysHeld))),
      shortTermPctOfValue: r1(pct(sold.filter(s => s.daysHeld < LONG_TERM_DAYS).reduce((a, s) => a + s.proceeds, 0), soldValue)),
      atAProfit: winners.length, atALoss: losers.length,
      medianDaysHeldWinners: r0(median(winners.map(s => s.daysHeld))),
      medianDaysHeldLosers: r0(median(losers.map(s => s.daysHeld))),
      medianGainPctWinners: r1(median(winners.map(s => s.gainPct))),
      medianLossPctLosers: r1(median(losers.map(s => s.gainPct))),
    },
    open: {
      inProfit: openWinners.length, atALoss: openLosers.length,
      medianDaysHeldInProfit: r0(median(openWinners.map(ageDays))),
      medianDaysHeldAtALoss: r0(median(openLosers.map(ageDays))),
    },
  };

  // ── Concentration ──
  const weights = holdings.map(h => (total ? h.value / total : 0)).sort((a, b) => b - a);
  const topN = (n) => weights.slice(0, n).reduce((a, b) => a + b, 0);
  const concentration = {
    holdings: holdings.length,
    largest: holdings[0] ? { symbol: holdings[0].symbol, name: holdings[0].name, weightPct: r1(weights[0] * 100) } : null,
    top3Pct: r1(topN(3) * 100), top5Pct: r1(topN(5) * 100),
    effectiveHoldings: r1(weights.length ? 1 / weights.reduce((s, w) => s + w * w, 0) : 0),
  };

  // ── Revealed risk ──
  const cls = profile?.classes || {};
  const caps = profile?.caps || {};
  const equity = cls.equity || 0;
  const share = (v) => (total ? (v || 0) / total : 0);
  const capBase = (caps.large || 0) + (caps.mid || 0) + (caps.small || 0);
  const risk = bookRisk(calendar.days || []);
  const mix = {
    equityPct: r1(share(equity) * 100), debtPct: r1(share(cls.debt) * 100),
    goldSilverPct: r1(share((cls.gold || 0) + (cls.silver || 0)) * 100),
    cryptoPct: r1(share(cls.crypto) * 100), globalPct: r1(share(profile?.regions?.global) * 100),
    lockedPct: r1(share(profile?.locked) * 100),
    smallMidPctOfIndianStocks: capBase ? r1(((caps.mid || 0) + (caps.small || 0)) / capBase * 100) : null,
    note: profile?.hybrid ? 'Hybrid funds are split by their category\'s typical equity share, so the mix is approximate.' : undefined,
  };
  const revealedRisk = {
    ...riskScore({
      growthShare: share(equity + (cls.crypto || 0)),
      smallMidShare: capBase ? ((caps.mid || 0) + (caps.small || 0)) / capBase : 0,
      cryptoShare: share(cls.crypto),
      top3Share: topN(3),
      volatilityPct: risk?.volatilityPct,
    }),
    mix,
    book: risk,
  };

  // ── Money habits ──
  const active = months.filter(m => m.income || m.expense);
  const recent = active.slice(-12);
  const half = (xs, key) => [mean(xs.slice(0, xs.length >> 1).map(m => m[key])), mean(xs.slice(xs.length >> 1).map(m => m[key]))];
  const [expA, expB] = recent.length >= 6 ? half(recent, 'expense') : [null, null];
  const [incA, incB] = recent.length >= 6 ? half(recent, 'income') : [null, null];
  const savingsRates = recent.filter(m => m.income > 0).map(m => m.savingsRate);
  const monthlySpend = spending.expense || 0;
  const netInvested12 = sumAmt(lastYear.filter(t => t.type === 'buy')) - sumAmt(lastYear.filter(t => t.type === 'sell'));
  const money = {
    monthsMeasured: recent.length,
    avgMonthlyIncome: r0(spending.income), avgMonthlyExpense: r0(monthlySpend),
    savingsRatePct: r1(pct(spending.income - monthlySpend, spending.income)),
    savingsRateLast3Pct: r1(mean(savingsRates.slice(-3))),
    expenseChangePct: expA ? r1(pct(expB - expA, expA)) : null,
    incomeChangePct: incA ? r1(pct(incB - incA, incA)) : null,
    incomeVariability: r1(cv(recent.map(m => m.income))),
    spendingVariability: r1(cv(recent.map(m => m.expense))),
    essentialPctOfSpend: r1(pct(spending.essential, monthlySpend)),
    discretionaryPctOfSpend: r1(pct(spending.discretionary, monthlySpend)),
    cash: r0(summary.totalCash),
    cashMonthsOfSpend: monthlySpend ? r1(summary.totalCash / monthlySpend) : null,
    liabilities: r0(summary.totalLiabilities),
    debtToAssetsPct: summary.totalAssets ? r1(pct(summary.totalLiabilities, summary.totalAssets)) : null,
    netInvestedLast12Months: r0(netInvested12),
    investedPctOfIncome: spending.income ? r1(pct(netInvested12 / 12, spending.income)) : null,
  };

  const timing = await tradeTiming(trades).catch(() => null);

  return {
    asof: toDateStr(today),
    trading, timing, concentration, revealedRisk, money,
    observations: observe({ trading, timing, concentration, revealedRisk, money }),
  };
}

/** The notable findings, as sentences with their evidence. Thresholds are deliberately conservative. */
function observe({ trading, timing, concentration, revealedRisk, money }) {
  const out = [];
  const s = trading.sold, o = trading.open;
  // Disposition effect: selling mostly winners while holding the losers.
  if (s.atAProfit >= 3 && s.atAProfit > s.atALoss && o.atALoss >= 2 && s.medianDaysHeldWinners != null && o.medianDaysHeldAtALoss != null
      && o.medianDaysHeldAtALoss > 1.5 * s.medianDaysHeldWinners) {
    out.push(`Winners are sold sooner than losers are let go: profitable sales were held a median ${s.medianDaysHeldWinners} days, while ${o.atALoss} positions now at a loss have been held a median ${o.medianDaysHeldAtALoss} days (the disposition effect).`);
  }
  if (s.sales >= 5 && s.atALoss >= 0.6 * s.sales) {
    out.push(`${s.atALoss} of ${s.sales} sales were at a loss (median ${s.medianLossPctLosers}%), held a median ${s.medianDaysHeldLosers} days; the ${s.atAProfit} profitable ones gained a median ${s.medianGainPctWinners}%.`);
  }
  if (s.sales >= 3 && s.shortTermPctOfValue > 50) {
    out.push(`${s.shortTermPctOfValue}% of sale value came from positions held under a year, which counts as short-term for tax.`);
  }
  if (timing?.buys?.trades >= 5 && timing.buys.afterRallyPctOfValue > 40) {
    out.push(`${timing.buys.afterRallyPctOfValue}% of money invested went into instruments already up more than ${MOVE_PCT}% in the previous month (buying after rallies).`);
  } else if (timing?.buys?.trades >= 5 && timing.buys.afterDropPctOfValue > 40) {
    out.push(`${timing.buys.afterDropPctOfValue}% of money invested went in after the instrument fell more than ${MOVE_PCT}% in the previous month (buying dips).`);
  }
  if (timing?.sells?.trades >= 3 && timing.sells.afterDropPctOfValue > 40) {
    out.push(`${timing.sells.afterDropPctOfValue}% of sale value came right after a fall of more than ${MOVE_PCT}%, a sign of selling into weakness.`);
  }
  if (concentration.largest?.weightPct > 20) {
    out.push(`${concentration.largest.name} is ${concentration.largest.weightPct}% of the portfolio; the top 3 holdings are ${concentration.top3Pct}%.`);
  }
  if (revealedRisk.mix.cryptoPct > 10) out.push(`Crypto is ${revealedRisk.mix.cryptoPct}% of the portfolio.`);
  if (money.cashMonthsOfSpend != null && money.cashMonthsOfSpend < 3) {
    out.push(`Cash covers ${money.cashMonthsOfSpend} months of average spending; 3–6 months is the usual emergency cushion.`);
  } else if (money.cashMonthsOfSpend > 18) {
    out.push(`Cash covers ${money.cashMonthsOfSpend} months of spending, well beyond an emergency cushion; the excess earns little.`);
  }
  if (money.expenseChangePct != null && money.incomeChangePct != null && money.expenseChangePct > 5 && money.expenseChangePct - money.incomeChangePct > 10) {
    out.push(`Spending rose ${money.expenseChangePct}% between the two halves of the last year while income changed ${money.incomeChangePct}% (lifestyle creep).`);
  }
  if (money.savingsRatePct != null && money.savingsRatePct < 10) {
    out.push(`The savings rate over the last year is ${money.savingsRatePct}% of income.`);
  }
  if (trading.monthsWithABuyPct != null && trading.buys >= 6 && trading.monthsWithABuyPct >= 75) {
    out.push(`Invests consistently: something was bought in ${trading.monthsWithABuyPct}% of months since the first trade.`);
  }
  return out;
}

// One computation per user per half hour; a transaction write clears it.
const memo = new Map();
function getBehaviour(userId) {
  const key = String(userId);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.promise;
  const promise = computeBehaviour(userId);
  memo.set(key, { at: Date.now(), promise });
  promise.catch(() => memo.delete(key));
  return promise;
}
const forgetBehaviour = (userId) => memo.delete(String(userId));

module.exports = { getBehaviour, forgetBehaviour, _matchLots: matchLots, _riskScore: riskScore };
