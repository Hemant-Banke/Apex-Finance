/**
 * assistantTools — the READ-ONLY tools the assistant (and the Apex MCP connector) use to
 * see the user's money. Each returns what the app itself shows, from the same services,
 * so the assistant can never contradict a page. Figures are INR unless a field says otherwise.
 */

const mongoose = require('mongoose');
const Account = require('../models/Account');
const Goal = require('../models/Goal');
const DailyAccountBalance = require('../models/DailyAccountBalance');
const { getPortfolio, getContribution, allocationByType, assetValuesByAccount } = require('./portfolioService');
const { getProfile } = require('./portfolioProfileService');
const { getCalendar } = require('./calendarService');
const { getAccountBalance } = require('./accountBalance');
const { listTransactions } = require('./transactionQueryService');
const { getUserCategoryTaxonomy } = require('./categoryService');
const { getBehaviour } = require('./behaviourService');
const { searchInstruments } = require('./marketSearchService');
const { getStock } = require('./stockService');
const { getAsset } = require('./assetService');
const { getOverview } = require('./indiaMarketService');
const dash = require('./dashboardService');
const { DAY_MS } = require('../utils/constants');
const { todayMs, toDateStr } = require('../utils/helpers');

const MAX_RESULT_CHARS = 40_000;

const money = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const dateOf = (d) => (d ? toDateStr(d) : null);

// Category codes are never shown to a person (or a model); this maps them to their names.
async function categoryNames(userId) {
  const tax = await getUserCategoryTaxonomy(userId);
  const map = new Map();
  for (const list of [tax.expense, tax.income]) for (const c of list) map.set(c.code, c.label);
  return { label: (code) => (code ? map.get(code) || map.get(code.split('/')[0]) || 'Other' : 'Uncategorised'), tax };
}

/** Drops chart series and caps long lists, so a page payload fits a model's context. */
function compact(v, depth = 0) {
  if (v == null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? num(v, Math.abs(v) >= 100 ? 0 : 3) : null;
  if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (Array.isArray(v)) {
    if (v.length > 24 && v.every(x => typeof x === 'number' || Array.isArray(x))) return undefined;   // a series
    const rows = v.slice(0, 15).map(x => compact(x, depth + 1)).filter(x => x !== undefined);
    return v.length > 15 ? [...rows, `…${v.length - 15} more`] : rows;
  }
  if (typeof v === 'object') {
    if (depth > 5) return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(series|closes|chart|weekly|officers|_.*)$/.test(k)) continue;
      const c = compact(x, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

const TOOLS = [
  {
    name: 'get_overview',
    label: 'Reading your net worth',
    description: 'Net worth and its parts (cash, investments, liabilities), its change over 1 day / 1 week / 1 month / 1 year, this month\'s income and expense, and the five latest transactions. The same figures as the Dashboard.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(userId, _args, ctx) {
      const s = await dash.getSummary(userId, { live: ctx.live });
      const ch = (c) => (c ? { abs: money(c.abs), pct: num(c.pct), partialHistory: c.partial || undefined } : null);
      const names = await categoryNames(userId);
      return {
        asof: s.asof, basis: ctx.live ? 'live prices' : 'last close',
        netWorth: money(s.netWorth), cash: money(s.totalCash), investments: money(s.totalInvestments), liabilities: money(s.totalLiabilities),
        change: { '1D': ch(s.netWorthChange.day), '1W': ch(s.netWorthChange.week), '1M': ch(s.netWorthChange.month), '1Y': ch(s.netWorthChange.year) },
        thisMonth: { income: money(s.monthlyIncome), expense: money(s.monthlyExpense) },
        accounts: s.accountCount, holdings: s.holdingsCount,
        latestTransactions: s.recentTransactions.map(t => ({
          date: dateOf(t.date), type: t.type, amount: money(t.amount), account: t.account?.name,
          what: t.assetName || names.label(t.category), notes: t.notes || undefined,
        })),
      };
    },
  },
  {
    name: 'get_accounts',
    label: 'Reading your accounts',
    description: 'Every account with its type and balance split into cash and invested assets. Debt accounts carry a negative balance (what is owed).',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(userId, _args, ctx) {
      const [accounts, docs, values] = await Promise.all([
        Account.find({ user: userId }).lean(),
        DailyAccountBalance.find({ user: userId }).select('account lastCashValue').lean(),
        assetValuesByAccount(userId, { live: ctx.live }),
      ]);
      const byId = new Map(docs.map(d => [String(d.account), d]));
      const rows = await Promise.all(accounts.map(async a => {
        const b = await getAccountBalance(a, { _id: userId }, ctx.live, byId.get(String(a._id)) || null, values);
        return { id: String(a._id), name: a.name, type: a.type, isDebt: !!a.isDebt, balance: money(b.balance), cash: money(b.cashBalance), invested: money(b.assetBalance) };
      }));
      return { asof: values.asof, accounts: rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)) };
    },
  },
  {
    name: 'get_portfolio',
    label: 'Reading your portfolio',
    description: 'Every holding marked to market: units, price, value, weight, cost, unrealised and realised gain, today\'s change, when first bought and which accounts hold it. Plus totals (value, invested, total gain, XIRR), allocation by asset type, and the asset-class / market-cap / region mix. Optionally for one account.',
    schema: {
      type: 'object',
      properties: { account_id: { type: 'string', description: 'Limit to one account (id from get_accounts). Omit for the whole portfolio.' } },
      additionalProperties: false,
    },
    async run(userId, args, ctx) {
      const account = /^[a-f0-9]{24}$/i.test(args.account_id || '') ? args.account_id : null;
      const [{ holdings, totals }, accounts] = await Promise.all([
        getPortfolio(userId, { live: ctx.live, account }),
        Account.find({ user: userId }).select('name').lean(),
      ]);
      const accName = new Map(accounts.map(a => [String(a._id), a.name]));
      const profile = holdings.length ? await getProfile(holdings).catch(() => null) : null;
      const share = (v) => (totals.value ? num((v || 0) / totals.value * 100, 1) : null);
      const pctMap = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, share(v)])) : null);
      return {
        asof: totals.asof, basis: ctx.live ? 'live prices' : 'last close',
        totals: {
          value: money(totals.value), invested: money(totals.invested),
          unrealisedGain: money(totals.unrealisedPnl), unrealisedPct: num(totals.unrealisedPnlPct),
          realisedGain: money(totals.realisedPnl), totalGain: money(totals.totalGain),
          xirrPct: num(totals.xirr, 1),
          investingSince: totals.since || null,
          dayChange: money(totals.dayChange), dayChangePct: num(totals.dayChangePct), holdings: totals.holdingsCount,
          allPriced: totals.priced,
        },
        holdings: holdings.map(h => ({
          symbol: h.symbol, name: h.name, type: h.type, currency: h.currency || 'INR',
          units: num(h.qty, 4), price: num(h.price), value: money(h.value), weightPct: num(h.weight, 1),
          invested: money(h.invested), avgCost: num(h.avgCostPerUnit),
          unrealisedGain: money(h.unrealisedPnl), unrealisedPct: num(h.unrealisedPnlPct, 1),
          realisedGain: h.realisedPnl ? money(h.realisedPnl) : undefined,
          dayChangePct: num(h.dayChangePct), firstBought: dateOf(h.firstPurchaseDate),
          purity: h.purity || undefined, ratePct: h.rate ?? undefined,
          accounts: (h.positions || []).map(p => accName.get(String(p.account)) || 'Unknown'),
          priced: h.priced ? undefined : 'no market quote; valued at cost or accrued rate',
        })),
        allocationByTypePct: Object.fromEntries(allocationByType(holdings).map(a => [a.type, num(a.weight, 1)])),
        mixPct: profile ? {
          assetClass: pctMap(profile.classes), marketCap: pctMap(profile.caps), region: pctMap(profile.regions),
          liquid: share(profile.liquid), locked: share(profile.locked),
          note: profile.hybrid ? 'Hybrid funds are split by their category\'s typical equity share.' : undefined,
        } : null,
      };
    },
  },
  {
    name: 'get_performance',
    label: 'Measuring performance',
    description: 'How the investments performed over a window: total gain and return (money-weighted, flows removed), each holding\'s gain, return and contribution to the total in percentage points (they sum to the total). Plus monthly returns for the last 12 months and calendar-year returns (time-weighted).',
    schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Window length in days, e.g. 30, 90, 365. 0 = since the first investment (includes realised gains).', minimum: 0, maximum: 3650 } },
      required: ['days'],
      additionalProperties: false,
    },
    async run(userId, args, ctx) {
      const days = Math.max(0, Math.min(parseInt(args.days) || 0, 3650));
      const [contrib, cal] = await Promise.all([
        getContribution(userId, { fromMs: days ? todayMs() - days * DAY_MS : null, live: ctx.live }),
        getCalendar(userId, { live: ctx.live }),
      ]);
      // Months and years compound their days, the same roll-up as the Analytics calendar.
      const roll = (keyOf) => {
        const m = new Map();
        for (const d of cal.days) {
          if (d.ret == null) continue;
          const k = keyOf(d.date);
          const e = m.get(k) || { idx: 1, gain: 0 };
          e.idx *= 1 + d.ret; e.gain += d.gain || 0;
          m.set(k, e);
        }
        return [...m].map(([period, e]) => ({ period, returnPct: num((e.idx - 1) * 100), gain: money(e.gain) }));
      };
      const rows = [...contrib.rows].sort((a, b) => (b.contributionPp || 0) - (a.contributionPp || 0));
      return {
        window: { from: contrib.totals.from, to: contrib.totals.to, days: days || 'all time' },
        total: { gain: money(contrib.totals.gain), returnPct: num(contrib.totals.returnPct), capital: money(contrib.totals.capital) },
        byHolding: rows.map(r => ({
          symbol: r.symbol, name: r.name, type: r.type,
          gain: money(r.gain), returnPct: num(r.returnPct, 1), contributionPp: num(r.contributionPp),
          bought: money(r.bought) || undefined, sold: money(r.sold) || undefined,
          atCost: r.quoted === false ? true : undefined,
        })),
        monthlyLast12: roll(d => d.slice(0, 7)).slice(-12),
        yearly: roll(d => d.slice(0, 4)),
      };
    },
  },
  {
    name: 'get_transactions',
    label: 'Searching your transactions',
    description: 'Find individual transactions with filters, newest first (or largest first). Returns the matching rows (up to `limit`) and totals over ALL matches: income, expense, net, bought, sold, count. For totals by category or by month use get_cashflow instead; use this to see the rows behind a figure.',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Comma list of: income, expense, transfer, adjustment, buy, sell' },
        category: { type: 'string', description: 'Category name to match, e.g. "Food", "Rent", "Salary"' },
        account_id: { type: 'string', description: 'Account id from get_accounts' },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        search: { type: 'string', description: 'Free text in notes, asset name or symbol' },
        min_amount: { type: 'number' },
        max_amount: { type: 'number' },
        sort: { type: 'string', enum: ['date', 'amount'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Rows to return (default 25)' },
      },
      additionalProperties: false,
    },
    async run(userId, args) {
      const names = await categoryNames(userId);
      let category;
      if (args.category) {
        const q = String(args.category).toLowerCase();
        const codes = [...names.tax.expense, ...names.tax.income].filter(c => c.label.toLowerCase().includes(q)).map(c => c.code);
        if (!codes.length) return { error: `No category matches "${args.category}".` };
        category = codes.join(',');
      }
      const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
      const { transactions, summary } = await listTransactions(userId, {
        type: args.type, category,
        account: /^[a-f0-9]{24}$/i.test(args.account_id || '') ? args.account_id : undefined,
        startDate: isDate(args.from) ? args.from : undefined,
        endDate: isDate(args.to) ? args.to : undefined,
        search: args.search, minAmount: args.min_amount, maxAmount: args.max_amount,
        sort: args.sort, limit: Math.min(Math.max(parseInt(args.limit) || 25, 1), 100),
      });
      return {
        matches: summary.count,
        totals: { income: money(summary.income), expense: money(summary.expense), net: money(summary.net), bought: money(summary.invested), sold: money(summary.divested) },
        rows: transactions.map(t => ({
          date: dateOf(t.date), type: t.type, amount: money(t.amount), account: t.account?.name,
          toAccount: t.toAccount?.name || undefined,
          category: ['income', 'expense'].includes(t.type) ? names.label(t.category) : undefined,
          asset: t.assetName ? `${t.assetName}${t.assetSymbol ? ` (${t.assetSymbol})` : ''}` : undefined,
          units: t.units != null ? num(t.units, 4) : undefined,
          price: t.pricePerUnit != null ? num(t.pricePerUnit) : undefined,
          currency: t.currency || undefined,
          notes: t.notes ? String(t.notes).slice(0, 120) : undefined,
        })),
      };
    },
  },
  {
    name: 'get_cashflow',
    label: 'Reading your cashflow',
    description: 'Income and spending totals: each month\'s income, expense, net and savings rate; monthly averages split into essential / discretionary / other; and spending and income by category over the window, each against the equal window before it. The right tool for "what do I spend on" and "how has my spending changed". `months: 1` is the current calendar month so far.',
    schema: {
      type: 'object',
      properties: { months: { type: 'integer', minimum: 1, maximum: 60, description: 'Months to cover (default 12)' } },
      additionalProperties: false,
    },
    async run(userId, args) {
      const months = Math.min(Math.max(parseInt(args.months) || 12, 1), 60);
      const [monthly, profile, expense, income, names] = await Promise.all([
        dash.getIncomeExpense(userId, months),
        dash.getSpendingProfile(userId, months),
        dash.getCategoryTotals(userId, { type: 'expense', months }),
        dash.getCategoryTotals(userId, { type: 'income', months }),
        categoryNames(userId),
      ]);
      const cats = (rows, n) => rows.slice(0, n).map(c => ({
        category: names.label(c._id), total: money(c.total), count: c.count,
        previousWindow: money(c.prev), changePct: c.prev > 0 ? num((c.total - c.prev) / c.prev * 100, 1) : null,
      }));
      return {
        monthly: monthly.map(m => ({ month: m.month, income: money(m.income), expense: money(m.expense), net: money(m.net), savingsRatePct: num(m.savingsRate, 1) })),
        averagesPerActiveMonth: {
          activeMonths: profile.activeMonths, income: money(profile.income), expense: money(profile.expense),
          essential: money(profile.essential), discretionary: money(profile.discretionary), other: money(profile.other),
        },
        expenseByCategory: cats(expense, 15),
        incomeByCategory: cats(income, 8),
      };
    },
  },
  {
    name: 'get_behaviour',
    label: 'Studying your habits',
    description: 'The user\'s measured behaviour: trading activity and turnover, holding periods, what was sold at a profit or loss and how long it was held, what instruments did in the month before each trade (buying rallies or dips, selling into falls), concentration, a revealed risk score with its components and the asset mix behind it, portfolio volatility and drawdowns, and money habits (savings rate, spending drift, cash cover, debt). Includes plain-language observations with their evidence.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: (userId) => getBehaviour(userId),
  },
  {
    name: 'get_goals',
    label: 'Reading your goals',
    description: 'The user\'s financial goals: what, cost in today\'s rupees, target date, inflation assumed, priority, payout shape, preferred strategy. The funding plan itself is computed in the app\'s Goals page and is not available here.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(userId) {
      const goals = await Goal.find({ user: userId }).sort({ targetDate: 1 }).lean();
      return {
        goals: goals.map(g => ({
          name: g.name, type: g.type, priority: g.priority, costToday: money(g.amount), targetDate: dateOf(g.targetDate),
          inflationPct: g.inflation, strategy: g.strategy, mayUseExistingSavings: g.useExisting,
          payout: g.withdrawal?.mode === 'spread' ? `spread over ${g.withdrawal.years} years` : 'lump sum',
          notes: g.notes || undefined,
        })),
      };
    },
  },
  {
    name: 'search_instruments',
    label: 'Searching the market',
    description: 'Find stocks, ETFs, mutual funds (AMFI), indices, crypto by name or ticker. Returns symbols to pass to get_instrument.',
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name or ticker, e.g. "HDFC Bank", "parag parikh flexi", "AAPL"' } },
      required: ['query'],
      additionalProperties: false,
    },
    async run(_userId, args) {
      const rows = await searchInstruments(String(args.query || ''), { indices: true });
      return { results: rows.slice(0, 10).map(r => ({ symbol: r.symbol, name: r.name, type: r.type, exchange: r.exchange || r.exchDisp || undefined, sector: r.sector || undefined })) };
    },
  },
  {
    name: 'get_instrument',
    label: 'Researching',
    description: 'Research one instrument: price, returns over 1M–5Y against its benchmark, risk (volatility, beta, drawdown), and by kind: a company\'s valuation vs sector, growth, margins, debt, ownership and analysts; a fund\'s category, holdings, sectors, expense ratio, P/E; an index\'s valuation and members. Use NSE tickers plain (e.g. "INFY"), mutual funds as "AMFI:<code>", others as Yahoo symbols (e.g. "AAPL", "^NSEI", "BTC-USD").',
    schema: {
      type: 'object',
      properties: { symbol: { type: 'string' } },
      required: ['symbol'],
      additionalProperties: false,
    },
    async run(_userId, args) {
      const sym = String(args.symbol || '').trim().toUpperCase();
      if (!sym) return { error: 'A symbol is required.' };
      const nse = sym.replace(/\.NS$/, '');
      if (/^[A-Z0-9&-]{1,20}$/.test(nse)) {
        const stock = await getStock(nse).catch(() => null);
        if (stock) return compact(stock);
      }
      const isForeignStock = /^[A-Z.-]{1,10}$/.test(sym) && !sym.endsWith('.NS');
      if (isForeignStock) {
        const stock = await getStock(sym, { global: true }).catch(() => null);
        if (stock) return compact(stock);
      }
      const asset = await getAsset(String(args.symbol).trim()).catch(() => null);
      return asset ? compact(asset) : { error: `No data found for ${args.symbol}. Try search_instruments first.` };
    },
  },
  {
    name: 'get_market_overview',
    label: 'Checking the market',
    description: 'The Indian market today: Nifty 50, Sensex and other headline indices, gold, silver, the rupee, crude and bitcoin with 1D/1W/1M/1Y moves, and market breadth (advances vs declines).',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run() { return compact(await getOverview()); },
  },
];

const byName = new Map(TOOLS.map(t => [t.name, t]));

/** Runs a tool by name; a failure becomes an error the model can read and recover from. */
async function runTool(rawUserId, name, args, ctx = {}) {
  // Aggregations do not cast ids, and a string id silently matches nothing (the connector passes one).
  const userId = typeof rawUserId === 'string' ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;
  const tool = byName.get(name);
  if (!tool) return { ok: false, content: JSON.stringify({ error: `Unknown tool ${name}` }) };
  if (!args || typeof args !== 'object') return { ok: false, content: JSON.stringify({ error: 'Arguments were not valid JSON.' }) };
  try {
    const out = await tool.run(userId, args, ctx);
    let content = JSON.stringify(out ?? {});
    if (content.length > MAX_RESULT_CHARS) content = `${content.slice(0, MAX_RESULT_CHARS)}… [truncated: narrow the request]`;
    return { ok: !out?.error, content };
  } catch (e) {
    console.error(`[assistant tool ${name}]`, e);
    return { ok: false, content: JSON.stringify({ error: e.status && e.status < 500 ? e.message : 'This data is unavailable right now.' }) };
  }
}

module.exports = { TOOLS, runTool, compact };
