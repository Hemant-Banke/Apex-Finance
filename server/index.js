// Network defaults — must be set before ANY module opens a socket.
// Some upstreams (mfapi in particular) advertise an AAAA record that black-holes
// from many networks. Node connects verbatim (IPv6 first) and stalls for seconds
// where curl would fall back instantly; the first request measured 2.4s instead of
// 89ms. Prefer IPv4 and enable Happy-Eyeballs fallback for everything.
require('dns').setDefaultResultOrder('ipv4first');
require('net').setDefaultAutoSelectFamily(true);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const { errorHandler } = require('./middleware/asyncHandler');

// Route imports
const compression = require('compression');
const bookCache = require('./services/bookCache');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const dashboardRoutes = require('./routes/dashboard');
const networthRoutes = require('./routes/networth');
const marketRoutes = require('./routes/market');
const marketsRoutes = require('./routes/markets');
const economyRoutes = require('./routes/economy');
const categoryRoutes = require('./routes/categories');
const importRoutes = require('./routes/import');
const subscriptionRoutes = require('./routes/subscriptions');
const goalRoutes = require('./routes/goals');
const assistantRoutes = require('./routes/assistant');
const mcp = require('./routes/mcp');
const { forgetBehaviour } = require('./services/behaviourService');

const app = express();
// One proxy in front in production (Render); the OAuth endpoints rate-limit by client IP.
app.set('trust proxy', 1);

// Connect to MongoDB then seed default data
const mongoose = require('mongoose');
connectDB();
mongoose.connection.once('open', async () => {
  try {
    const Category = require('./models/Category');
    const { seedDefaultCategories } = require('./data/defaultCategories');
    await seedDefaultCategories(Category);
  } catch (e) {
    console.error('Category seed failed:', e.message);
  }

  // Mutual-fund caches, refreshed once a day: the AMFI scheme list (~37k, so search
  // runs locally) and the latest NAV of every scheme we actually track (so valuing a
  // holding needs no network either). Non-blocking — a user request must never wait
  // on it, and every read falls back to whatever is already cached.
  const mfService = require('./services/mfService');
  const refreshMf = () => mfService.refreshDailyCaches()
    .then(({ schemes, histories, backfilled }) =>
      console.log(`MF caches ready — ${schemes} schemes + NAVs indexed, ${histories} histories topped up`
        + (backfilled ? `, ${backfilled} backfilled from a stale gap` : '')))
    .catch(e => console.error('MF cache refresh failed:', e.message));

  // Stores re-value their last few days once new closes/NAVs are in, so the chart matches the book.
  const { reviseAll } = require('./services/dailyValueService');
  const revise = () => reviseAll().catch(e => console.error('Store revision failed:', e.message));

  const refreshMfAndRevise = () => refreshMf().then(revise);
  refreshMfAndRevise();
  // Every 3h, not daily: AMFI posts NAVs late in the evening, and a daily timer lagged them up to a day.
  setInterval(refreshMfAndRevise, 3 * 60 * 60 * 1000).unref();

  // Market flows (FII/DII, MF, participant OI) for the Markets page. The exchanges
  // publish each evening and no upstream keeps more than a short window, so this runs
  // hourly and the history ACCUMULATES in `marketflows`. Non-blocking, like the MF cache.
  const indiaMarket = require('./services/indiaMarketService');
  const refreshFlows = () => indiaMarket.refreshFlows()
    .then(({ saved, sources }) => console.log(`Market flows refreshed — ${saved} day(s) written`, sources))
    .catch(e => console.error('Market flow refresh failed:', e.message));

  refreshFlows();
  setInterval(refreshFlows, 60 * 60 * 1000).unref();

  // The Economy page's series (RBI, NSDL, MoSPI, FRED). Releases are weekly at most, so every 6h is plenty.
  const economy = require('./services/economyService');
  const refreshEconomy = () => economy.refreshEconomy()
    .then(r => console.log('Economy refreshed', JSON.stringify(r)))
    .catch(e => console.error('Economy refresh failed:', e.message));
  refreshEconomy();
  setInterval(refreshEconomy, 6 * 60 * 60 * 1000).unref();

  // Daily closes for every cached Yahoo symbol, topped up to the last settled day so
  // valuation and charts read Mongo, not Yahoo. Every 3h: US closes land after midnight IST.
  const { refreshPriceCache } = require('./services/marketDataService');
  const refreshPrices = () => refreshPriceCache()
    .then(({ symbols, refreshed }) => symbols && console.log(`Price cache topped up — ${refreshed}/${symbols} symbols`))
    .catch(e => console.error('Price cache refresh failed:', e.message));

  const refreshPricesAndRevise = () => refreshPrices().then(revise);
  refreshPricesAndRevise();
  setInterval(refreshPricesAndRevise, 3 * 60 * 60 * 1000).unref();
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({ exposedHeaders: ['X-Price-Snapshot'] }));
app.use(express.json());
// Any write by a user drops their memoised reads; `protect` sets req.user before it finishes.
// The assistant's own requests change no money, so they keep the snapshot.
app.use((req, res, next) => {
  if (req.method !== 'GET' && !req.originalUrl.startsWith('/api/assistant')) {
    res.on('finish', () => {
      if (!req.user) return;
      bookCache.invalidate(req.user._id);
      forgetBehaviour(req.user._id);
    });
  }
  next();
});
// Stamp every reply with the user's price snapshot, so the client can drop copies from an older one.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    const at = req.user && bookCache.snapshotAt(req.user._id);
    if (at) res.set('X-Price-Snapshot', String(at));
    return json(body);
  };
  next();
});

// The Apex connector: OAuth endpoints at the root and the MCP server at /mcp.
mcp.mountMcp(app);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/networth', networthRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/economy', economyRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/import', importRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/mcp', mcp.router);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Terminal error handler. Routes are wrapped in `asyncHandler`, so a rejection from any
// of them — or from a service that threw an HttpError — lands here.
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Apex Server running on port ${PORT}`);
});
