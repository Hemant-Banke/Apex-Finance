# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Name : Apex

Apex is a Portfolio Tracking webapp. It enables users to track their investments in stocks, bonds, and other assets. It also provides insights and analytics to help users make informed decisions. It defines a complete financial picture of the user. It is a premium and luxurious experience for the user. 

This is not a conventional experience. It is non-traditional and innovative. It is a premium and luxurious experience for the user. 

Apex is a premium portfolio tracking web app. Core philosophy: **everything is a transaction** — all financial movements (income, expenses, asset purchases/sales, transfers) are recorded as transactions, and balances/holdings are computed from them via MongoDB aggregation.

## Commands

### Client (React/Vite) — run from `client/`
```bash
npm run dev      # Dev server at http://localhost:5173
npm run build    # Production build to dist/
npm run lint     # ESLint
npm run preview  # Preview production build
```

### Server (Node/Express) — run from `server/`
```bash
npm run dev      # Dev with nodemon auto-reload
npm start        # Production (node index.js)
```

### Environment
- Backend: Port 5000 by default, configured via `server/.env` (`MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `NODE_ENV`)
- Frontend: `VITE_API_URL` points to backend (default: `http://localhost:5000/api`)
- If `MONGODB_URI` is unavailable, server falls back to in-memory MongoDB automatically

## Architecture

### Stack
- **Frontend:** React 19 + Vite, React Router 7, Tailwind CSS 4, Recharts, Axios, Radix UI
- **Backend:** Express 4, MongoDB/Mongoose 8, JWT auth, bcryptjs, Helmet, Express Validator
- **Deployment:** Vercel (client), Render (server)

### Auth Flow
1. JWT token issued on login/register, stored in `localStorage`
2. `AuthContext` (`client/src/context/AuthContext.jsx`) manages user state
3. Axios client (`client/src/lib/api.js`) auto-attaches `Bearer` token via interceptor
4. Backend `protect` middleware (`server/middleware/auth.js`) validates JWT on all protected routes
5. All DB queries filtered by `req.user._id` for data isolation

### Data Model
Three collections: `users`, `accounts`, `transactions`.

**Accounts** are containers with a `type` (`bank`, `brokerage`, `retirement`, `debt`, `wallet`, `other`). `isDebt` is auto-set when `type === 'debt'`. Account **balances are never stored** — they're always computed via MongoDB aggregation from transactions.

**Transactions** have these types:
- `income` / `expense` — cash flows
- `transfer` — moves cash between accounts (uses `toAccount` field)
- `buy` / `sell` — asset trades; `amount` is auto-calculated as `units × pricePerUnit`; asset tracked by `assetSymbol`, `assetType`, `units`
- `deposit` / `withdrawal` — account funding

**Holdings** are derived by aggregating `buy`/`sell` transactions by `assetSymbol` — never stored directly.

### Backend Route Structure
```
/api/auth/*          — register, login, me
/api/accounts/*      — CRUD + balance/holdings via aggregation
/api/transactions/*  — CRUD with filtering (account, type, category, date range) + pagination
/api/dashboard/*     — summary, networth-history, asset-allocation, income-expense, expense-categories
```

### Key Backend Patterns
- MongoDB aggregation pipelines do the heavy lifting: balance calculations, holdings aggregation, net worth history, analytics
- Dashboard `summary` endpoint computes net worth, monthly income/expense, recent transactions, and holdings count in a single request
- `networth-history` builds cumulative net worth month by month from transaction history
- Account deletion cascades to all its transactions


## Features

- Premium and luxurious experience
- User authentication
- Portfolio tracking
- Investment tracking
- Insights and analytics
- Expense and Income Tracking

## Details

- Financial Picture:
The user can view their complete financial picture in one place. It includes their investments, expenses, income, and assets. It also includes their net worth and posrtfolio summaries.

- Accounts: 
Every account is a container of assets. It can be a bank account, a brokerage account, a retirement account, or any other type of account. 

- Assets: 
Assets are the investments that the user holds. They can be stocks, bonds, mutual funds, ETFs, or any other type of investment. These assets are stored in accounts. 

- Real-Time asset tracking:
The Assets must be tracked in real-time. This means that the user should be able to see the current value of their assets at any time, along with PnL metrics. This must be done using a third party API that provides real-time market data. 

- Net Worth: 
Net worth is the total value of the user's assets minus their liabilities. It is a measure of the user's financial health. This must be tracked over time and should be displayed in a way that is easy to understand. 

- Net-Worth Graph:
Net-Worth Graph is a visual representation of the user's net worth over time. It shows the user's net worth at any given time. It is a way to see how the user's financial health has changed over time. 

- Portfolio Graph: 
Portfolio Graph is a visual representation of the performance of the user's portfolio over time. It shows the consolidated performance of the portfolio the user holds after accounting for additions and withdrawals made to the portfolio. It shows how the investor has performed overall in all trades/investment he made compared to benchmarks. 

- Asset Allocation Graph:
Asset Allocation Graph is a visual representation of the user's asset allocation over time. It shows the user's asset allocation at any given time. It is a way to see how the user's asset allocation has changed over time. 

- Transactions: 
Transactions are the movements of assets between accounts. They can be deposits, withdrawals, transfers, or any other type of transaction. Purchase of assets in the account is also a transaction.

- Expenses:
Expenses are the outflows of money from the user's accounts. They can be categorized into different categories such as rent, food, transportation, etc. 

- Income:
Income is the inflows of money into the user's accounts. They can be categorized into different categories such as salary, rent, etc. 

- Custom Transaction Categories:
Users can create custom transaction categories to track their expenses and income in a way that makes sense to them. 

- Liabilities: 
Liabilities are the debts that the user owes to others. They can be loans, credit card debt, or any other type of debt. The liabilities are accounts marked as a debt account. 

- Overall Summary: 
Overall Summary is a visual representation of the user's financial health. It shows the user's net worth, their assets, their liabilities, income, expense and their overall financial health. 

- Account Summary:
Similarly we can zoom into each account and view the summary of that account. 

- Adding Transactions:
Users can add transactions to their accounts. These transactions can be of different types such as deposits, withdrawals, transfers, etc.   

- Adding Assets:
Users can add assets to their accounts. These assets can be of different types such as stocks, bonds, mutual funds, ETFs, or any other type of investment. 

- Adding Accounts:
Users can add accounts to their portfolios. These accounts can be of different types such as bank accounts, brokerage accounts, retirement accounts, debt or any other type of account. 

- Asset Form:
Asset Form is a form that is used to add assets to an account. It will be a search bar at first with some recommendations, you type in the name of asset and it will show you the recommendations. You can select the asset. It then asks you for date of purchase, number of units, and retreives the price per unit automatically from this info if it can, while keeping the option to manually enter the price per unit. We can then add this transaction into the account.


## Key Details on Transactions:

- Each transaction can be of type Income, Expense, Transfer, Adjustment, Buy and Sell.
- Accounts can be of type Bank Acccount, Brokerage, Retirement, Debt, Others.
- Assets can be of type Stock, Bond, Mutual Fund, ETF, Crypto, Commodity, EPF/NPS, FD, Other.
- Assets are tied to an account that holds it.
- Everything is a transaction.

Debt Accounts: 
- Accounts of type Debt are marked as debt accounts and are considered as liabilities.

Asset Accounts:
- All non debt accounts are considered as asset accounts.
- These accounts are used to hold assets or cash as is.
- Asset Buy and Sell transactions are available only on these accounts.
- The account balance is therefore divided into cash component and assets component. The balance is the sum of the cash component and the assets component.

Income Transaction:
- Income transactions are available on all accounts.
- Income transactions are used to add income to the account.
- They increase the cash component of the account.

Expense Transaction:
- Expense transactions are available on all accounts.
- Expense transactions are used to add expense to the account.
- They decrease the cash component of the account.

Transfer Transaction:
- Transfer transactions are available on all accounts.
- Transfer transactions are used to transfer assets from one account to another.
- They therefore have identifiers for both the source and destination accounts.
- The transferred amount is deducted from source cash component and added into destination cash component. This however does not count as expense or income for any account. It is a marked transfer transaction only.

Adjustment Transaction:
- Adjustment transactions are available on all accounts.
- Adjustment transactions are used to adjust the cash component of the account.
- They change the cash component of the account by the specified difference amount. The amount can be positive or negative. The amount is added to the cash component if it is positive and subtracted from the cash component if it is negative, while ensuring the cash component never goes below zero. The form must specify what the cash component was before the adjustment and what the cash component and balance is after the adjustment for easier user experience.

Buy Transaction:
- Buy transactions are available only on asset accounts.
- Buy transactions are used to buy assets from the account.
- They must also have an identifier for the asset being bought, units bought and price per unit. The form must specify the total amount paid for the asset.
- They decrease the cash component of the account by the total amount paid for the asset.
- They increase the assets component of the account by the total amount paid for the asset. Hence the account balance remains unchanged.
- The amount of transaction must be less than or equal to the cash component of the account.

Sell Transaction:
- Sell transactions are available only on asset accounts.
- Sell transactions are used to sell assets from the account.
- They must also have an identifier for the asset being sold, units sold and price per unit. The form must specify the total amount received for the asset.
- They increase the cash component of the account by the total amount received for the asset.
- They decrease the assets component of the account by the total amount received for the asset. Hence the account balance remains unchanged.
- The amount of transaction must not necessarily be less than or equal to the assets component of the account. They can lead to negative assets component implying short position.


## Philosophy:

- Premium and Luxurious Experience:
The user should feel like they are using a premium and luxurious product. This means that the user should feel like they are using a product that is worth their time and money. 

- Everything is a transaction:
Every action that the user takes should be a transaction. Income, Expence, Transfers, Asset Purchase and Sale, etc. are all transactions. This means that the user should be able to see the impact of their actions on their financial picture. This will also make it easier to track assets owned and their progress over time since the corresponding transactions are indexed in time. Everything else is a derivative of transactions and a visual representation of it.

- Tracking Everything:
We track everything. Every transaction, every asset, every account, every liability, every income, every expense, every transfer, etc. This is what makes our product unique. This includes tracking the performance of assets over time, the performance of accounts over time, the performance of the portfolio over time, the performance of the user's financial health over time, etc. And also tracking every form of asset, be it stocks, bonds, mutual funds, ETFs, Gold, other commodities, different Crypto currencies or any other type of investment. 

- Advisory (Next Step, not right now):
As a next step, we can add an advisory feature that will help users make informed decisions about their investments. This can be done using AI and machine learning algorithms that will analyze the user's financial picture and provide personalized recommendations. Including income-expense prediction, investment recommendations, asset allocation recommendations, net worth optimization recommendations, etc. This will use a Goal-Beased Wealth Management model, where the user can set goals and we determine the optimal allocation required to achieve those goals. 