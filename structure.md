# Apex — Structure

## 1. Components (`client/src/components/`)

### auth
- `auth/OAuthButtons.jsx` — Google / Apple sign-in buttons for the login page.

### charts
- `charts/PriceGrapher.jsx` — The one price/value chart (net worth, accounts, markets, stocks) with benchmark overlays and drag-to-measure; `axisFormat` for non-rupee prices.
- `charts/ChartTooltip.jsx` — Shared solid chart tooltip (+ `TooltipPanel`), with % change from window start.
- `charts/CompareIndexDialog.jsx` — Picker for benchmark overlays on a chart.
- `charts/CashflowChart.jsx` — Monthly income/expense bars + net cashflow line; used on Analytics and the Dashboard.
- `charts/CategoryBreakdown.jsx` — Ranked category totals with bars and prior-window change; `onSelect`/`active` make rows filters (Analytics, Transactions).

### forms
- `forms/TransactionForm.jsx` — Add/edit cash transactions (income, expense, transfer, adjustment).
- `forms/TypePicker.jsx` — Generic dropdown-select (searchable, clearable); replaces native `<select>`.
- `forms/CategoryPicker.jsx` — Hierarchical category picker wired to the categories API.
- `forms/CategoryMultiPicker.jsx` — Multi-select category filter: tick whole groups or single categories (tri-state groups, search); used by the Transactions ledger.
- `forms/DatePicker.jsx` — Date picker + `DateRangePicker`.
- `forms/EmojiPicker.jsx` — Searchable emoji grid for category icons.
- `forms/RecurrenceFields.jsx` — "Repeat" toggle + schedule fields for subscriptions.

### import
- `import/ImportModal.jsx` — Two-step statement import dialog (upload → review).
- `import/StatementUpload.jsx` — File drop/upload for PDF/CSV/HTML/image statements.
- `import/TransactionReview.jsx` — Review/edit parsed rows before importing.
- `import/ConfidenceBadge.jsx` — Single confidence pill for the whole parsed file.

### layout
- `layout/AppShell.jsx` — App frame: sidebar navigation + page outlet.
- `layout/DesktopOnly.jsx` — Gates the app to wide, hover-capable screens.

### market
- `market/MarketSearch.jsx` — Asset search (your holdings first, then market hits).
- `market/AssetTransactionForm.jsx` — Buy/sell form for an asset (metals, FX, rates, recurrence).
- `market/AssetIcon.jsx` — Company/asset logo with fallbacks.

### markets
- `markets/QuoteTile.jsx` — Index/asset tile: level, 1D delta, 1W/1M/1Y, sparkline; links to the asset page when it has a `symbol`.
- `markets/SectorMap.jsx` — Nifty 500 sector treemap + ranked table, drillable to stocks.
- `markets/FlowsPanel.jsx` — FII/DII/MF flows ledger, chart and positioning.

### portfolio
- `portfolio/HoldingsTable.jsx` — Sortable holdings book (qty, cost, price, value, P&L, weight).
- `portfolio/HoldingLink.jsx` — A holding's name linked to its company/asset page (plain text if self-priced).
- `portfolio/AllocationBar.jsx` — Allocation as a stacked bar (`showValue={false}` when slices are not money).
- `portfolio/ContributionBreakdown.jsx` — Per-holding contribution to return over a window.
- `portfolio/SellButton.jsx` — The shared sell affordance on holding rows.
- `portfolio/SellHoldingModal.jsx` — Dialog to sell an owned position.
- `portfolio/PositionCard.jsx` — "Your position" card (worth + gain/today on the left; qty, avg cost, invested on the right) for the stock and asset pages.

### stock
- `stock/PricePerformance.jsx` — `StatGrid`, `RangeBar`, `Performance` for stock/asset pages (`benchLabel={null}` drops the benchmark rows).
- `asset/IndexProfile.jsx` — NSE index valuation, breadth, sector split and members with day contribution.
- `asset/FundProfile.jsx` — Fund house, category, plan/option, ISIN and sibling plans.
- `asset/MetalProfile.jsx` — Gold/silver price by purity, world price, domestic premium, gold-silver ratio.
- `asset/ReturnSplit.jsx` — A rupee return split into asset-in-own-currency and the currency's move.
- `asset/HoldingExperience.jsx` — Monthly SIP outcomes (XIRR) and rolling 1Y/3Y returns vs benchmark.
- `stock/CompanyFinancials.jsx` — Annual/quarterly results, debt and cash-flow chart + table (`money` from `companyMoney`).
- `stock/Ownership.jsx` — Shareholding pattern over 12 quarters; abroad, insiders/institutions + largest holders.

### transactions
- `transactions/TransactionRow.jsx` — The one transaction row used in every list (`leading` slot, `selected` tint).
- `transactions/SpendCalendar.jsx` — Daily in/out calendar heatmap (weeks × weekdays), green/red against the median day, with per-weekday averages; click a day to pick it.

### ui
- `ui/Button.jsx` — Button primitive (variants, sizes, icon).
- `ui/Card.jsx` — Surface primitive (gilt / compact / flush).
- `ui/Badge.jsx` — Small status chip.
- `ui/Checkbox.jsx` — Square checkbox (`accent` master / `plain` row); is a `<button role=checkbox>`.
- `ui/Modal.jsx` — Portaled titled dialog; nests.
- `ui/ConfirmModal.jsx` — Confirmation dialog (replaces `confirm()`).
- `ui/Popover.jsx` — Portaled floating panel used by all pickers.
- `ui/Masthead.jsx` — Page headline figure + component band (`MastheadFigure`); `to` makes it a link.
- `ui/SectionHeader.jsx` — Eyebrow/title/action header above a block.
- `ui/Delta.jsx` — Signed change chip with arrow (`invert` for spending).
- `ui/DivergingBar.jsx` — Signed bar from a shared zero.
- `ui/SegmentedControl.jsx` — Window/view picker.
- `ui/ShowMore.jsx` — Collapses long lists (head or both-ends mode).
- `ui/Sparkline.jsx` — Tiny SVG trend line.
- `ui/BackLink.jsx` — The one "back" control.
- `ui/Spinner.jsx` — Centred loading spinner.
- `ui/TopProgressBar.jsx` — Top-of-page bar driven by in-flight API requests.
- `ui/AppLoader.jsx` — Branded full-screen boot loader.
- `ui/DitherField.jsx` — Static dithered "money garden" (flowers, ₹ coin-blooms, banknote leaves), drawn once; a cursor lens reveals it in colour, or `full` shows it outright with CSS-stepped falling petals (sign-in pages).
- `ui/ApexLogo.jsx` — SVG logo mark.
- `ui/Divider.jsx` — Horizontal rule (neutral or gilt).

### Pages (`client/src/pages/`)
- `Login.jsx` / `Register.jsx` — Auth entry (OAuth + email) / manual signup.
- `Dashboard.jsx` — Net worth masthead, portfolio card, recent activity.
- `Accounts.jsx` — Accounts list with liabilities, shares and sparklines.
- `AccountDetail.jsx` — One account: masthead, history chart, holdings, activity.
- `Transactions.jsx` — The ledger: period masthead vs the prior window, spending calendar, largest outflows, clickable category breakdown, type chips with counts, search/account/amount/sort filters, day-grouped list, bulk select-delete with undo, CSV export, add/import.
- `Analytics.jsx` — Cashflow, categories, holdings, contribution, allocation.
- `Markets.jsx` — Indian market overview, growth chart, sectors, flows.
- `Stock.jsx` — One company in full; `/markets/stocks/:nse` and `/markets/world/:yahoo` (`global` prop).
- `Asset.jsx` — Price page for any non-NSE-equity instrument.
- `Settings.jsx` — Subscriptions and custom categories.

### Context (`client/src/context/`)
- `AuthContext.jsx` — User/session state and auth actions.
- `ToastContext.jsx` — Toasts with optional action (Undo).

---

## 2. Helpers

### Client (`client/src/lib/`)
- `api.js` — Axios client + `authAPI`, `accountsAPI`, `transactionsAPI`, `dashboardAPI`, `subscriptionsAPI`, `marketAPI`, `marketsAPI`, `importAPI`, `categoriesAPI`, `networthAPI`, `subscribeLoading`.
- `utils.js` — the shared client helpers:
  - Money: `formatCurrency`, `formatNativeCurrency`, `formatCompact`, `formatCrore`, `compactIfLarge`, `formatSigned`.
  - Numbers: `formatCount` (counts/quantities in Indian grouping), `formatPct`, `formatPoints` (pp), `pctChange` (% change from a positive base, else null), `axisCompact`.
  - Dates: `todayStr` (IST today), `toDateInput` (stored date → "YYYY-MM-DD"), `formatDate`, `formatDateShort`, `MONTHS_SHORT`, `monthLabel`, `dayLabel`, `monthYearShort`, `fiscalYear`, `fiscalQuarter`.
  - Transactions: `getTransactionColor`, `getTransactionSign`, `getTransactionName`.
  - Colour: `CHART_COLORS`, `pnlColor`; plus `cn` (class names).
- `constants.js` — `ACCOUNT_TYPES`, `TRANSACTION_TYPES`, `ASSET_TYPES`, `BENCHMARKS`, purity/rate/market asset predicates (`isManualSymbol`, `isSelfPricedHolding`, …), label lookups.
- `markets.js` — `WINDOWS`, `windowOf`, `MARKET_RANGES`, `toChartSeries`, `formatLevel` (price at market precision), `rupeeLevel` (₹ share price), routing (`stockPath`, `assetPath`, `viewPathFor`, `nseSymbolOf`).
- `categoryNames.js` — Cached category taxonomy; `useCategoryNames`, `describeCategory`.
- `confidence.js` — Import confidence bands/labels (mirrors server).
- `recurrence.js` — `FREQUENCIES`, `emptyRecurrence`.
- `categorySelection.js` — Multi-category selection rules (`groupState`, `toggleGroup`, `toggleCode`, `isSelected`); a group never coexists with its own children.
- `undo.js` — `toCreatePayload` to re-create a deleted transaction.
- `accountPickerOptions.jsx` — Account-type icons and TypePicker option builders.

### Server utils (`server/utils/`)
- `constants.js` — `DAY_MS`, `IST_OFFSET_MS`, headers, account/transaction/asset types.
- `helpers.js` — Date math (`midnight`, `toDateStr`, `todayMs`, `t1Ms`, …), `parseNumber`, quote name/type mapping.
- `httpError.js` — `HttpError`, `badRequest`, `notFound`.
- `transactionHelpers.js` — Cash/asset impact of a txn, `flipTx`, impact/txn maps by account.
- `tsHelpers.js` — `tsAdder` (merge), `tsConcat` (append), `sliceStartIndex`.
- `assetPricing.js` — Metal per-gram pricing, purity, rate accrual, `resolveUnitPrice`.
- `currency.js` — FX symbol + currency normalisation.
- `recurrence.js` — `FREQUENCIES`, `occurrencesBetween`.
- `series.js` — `round`, `pctChange` (server; client equivalent in `lib/utils`), `toSorted`, `valueAt`, `windowReturns`, `WINDOWS`, `xirr`, `sipReturns`, `rollingReturns`, `holdingExperience` (SIP + rolling, shared by stock and asset pages).

### Server lib (`server/lib/`)
- `llmService.js` — All Claude calls: extraction (text/image) and categorisation.
- `statementParsers.js` — `parseStatement`: regex/HTML parsers with LLM fallback.
- `categoryRules.js` — Keyword category rules, merchant tokens, Misc fallback.
- `confidence.js` — Per-stage scoring and file-level confidence summary.

---

## 3. All files

### Root
- `README.md` — Project readme.
- `CLAUDE.md` — Architecture and conventions guide.
- `structure.md` — This file.
- `assets/*.png` — Screenshots and logo inspiration.

### Client config
- `client/package.json`, `vite.config.js`, `eslint.config.js`, `postcss.config.mjs`, `index.html`, `.env.example` — Build/tooling config.
- `client/public/favicon.svg`, `icons.svg` — Static icons.
- `client/.claude/agents/*.md` — Claude Code agent definitions.
- `client/src/main.jsx` — React entry point.
- `client/src/App.jsx` — Routes and providers.
- `client/src/index.css` — Design tokens and global styles.
- Components, pages, context, lib — see sections 1 and 2.

### Server
- `server/index.js` — Express app, routes, error handler, background refresh jobs.
- `server/package.json`, `.env.example` — Deps and env template.
- `server/config/db.js` — MongoDB connection (in-memory fallback).
- `server/data/defaultCategories.js` — Built-in category taxonomy.
- `server/middleware/auth.js` — JWT `protect` middleware.
- `server/middleware/asyncHandler.js` — Forwards async route errors to the error handler.

#### Models (`server/models/`)
- `User.js` — User account.
- `Account.js` — Account container.
- `Transaction.js` — Every financial movement.
- `Subscription.js` — Recurring transaction templates.
- `DailyAccountBalance.js` — Per-account cash/asset time series.
- `DailyNetWorth.js` — Per-user net worth series.
- `AccountHoldings.js` — Per-account AVCO holdings.
- `Category.js` / `UserCategory.js` — Default / custom categories.
- `UserCategoryProfile.js` — Learned merchant→category profile.
- `MfScheme.js` / `MfNav.js` — AMFI fund index / NAV history caches.
- `MarketFlow.js` — Daily FII/DII/MF flows + participant OI.

#### Routes (`server/routes/`)
- `auth.js` — Register, login, OAuth, me.
- `accounts.js` — Account CRUD, balance, holdings, daily series.
- `transactions.js` — Transaction CRUD, bulk; list + `/insights` via transactionQueryService.
- `subscriptions.js` — Subscription list/create/pause/delete.
- `dashboard.js` — Summary, portfolio, holdings, contribution, income-expense, categories.
- `networth.js` — Net worth series, ensure, rebuild.
- `market.js` — Asset search, price, OHLC, index series (`INR:<symbol>` = a foreign index converted to ₹ day by day).
- `markets.js` — Markets page: overview, sectors, stocks, assets, flows.
- `categories.js` — Category list/create/delete.
- `import.js` — Statement parse → resolve symbols → categorise.

#### Services (`server/services/`)
- `transactionService.js` — Transaction lifecycle; asset pricing on save.
- `transactionQueryService.js` — The shared transaction filter (`buildFilter`), paged list + totals, and insights (daily flows, categories, largest, type counts, prior window).
- `dailyValueService.js` — Store orchestration: rebuild, extend, delta merge, NW.
- `tsService.js` — Pure cash/asset/net-worth series builders.
- `holdingsService.js` — AVCO holdings maintenance.
- `accountBalance.js` — O(1) settled/live balances, sparklines.
- `portfolioService.js` — Mark-to-market portfolio, P&L, contribution.
- `marketDataService.js` — All Yahoo fetching, FX, live/historic prices.
- `mfService.js` — AMFI mutual-fund cache, search, NAVs.
- `symbolResolver.js` — Statement instrument → priceable symbol.
- `subscriptionService.js` — Materialise due recurring transactions.
- `categoryService.js` — User category taxonomy reads.
- `categoryProfileService.js` — Learn/predict categories from user history.
- `oauthService.js` — Verify Google/Apple identity tokens.
- `indiaMarketService.js` — NSE indices, asset classes, breadth, flows.
- `sectorService.js` — Nifty 500 sector map, market caps, peers, index composition (`getComposition`, free-float weights).
- `stockService.js` — One company (NSE, or abroad with `global`): price, risk, financials, valuation, holders, peers, SIP/rolling.
- `screenerService.js` — Screener.in filings and shareholding.
- `assetService.js` — Price page data for non-NSE instruments, plus per-kind `profile`, `currencyLens` and `experience`.
