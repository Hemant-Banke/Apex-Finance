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
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const dashboardRoutes = require('./routes/dashboard');
const networthRoutes = require('./routes/networth');
const marketRoutes = require('./routes/market');
const marketsRoutes = require('./routes/markets');
const categoryRoutes = require('./routes/categories');
const importRoutes = require('./routes/import');
const subscriptionRoutes = require('./routes/subscriptions');
const goalRoutes = require('./routes/goals');

const app = express();

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

  refreshMf();
  setInterval(refreshMf, 24 * 60 * 60 * 1000).unref();

  // Market flows (FII/DII, MF, participant OI) for the Markets page. The exchanges
  // publish each evening and no upstream keeps more than a short window, so this runs
  // hourly and the history ACCUMULATES in `marketflows`. Non-blocking, like the MF cache.
  const indiaMarket = require('./services/indiaMarketService');
  const refreshFlows = () => indiaMarket.refreshFlows()
    .then(({ saved, sources }) => console.log(`Market flows refreshed — ${saved} day(s) written`, sources))
    .catch(e => console.error('Market flow refresh failed:', e.message));

  refreshFlows();
  setInterval(refreshFlows, 60 * 60 * 1000).unref();

  // Daily closes for every cached Yahoo symbol, topped up to the last settled day so
  // valuation and charts read Mongo, not Yahoo. Every 3h: US closes land after midnight IST.
  const { refreshPriceCache } = require('./services/marketDataService');
  const refreshPrices = () => refreshPriceCache()
    .then(({ symbols, refreshed }) => symbols && console.log(`Price cache topped up — ${refreshed}/${symbols} symbols`))
    .catch(e => console.error('Price cache refresh failed:', e.message));

  refreshPrices();
  setInterval(refreshPrices, 3 * 60 * 60 * 1000).unref();
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

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
app.use('/api/categories', categoryRoutes);
app.use('/api/import', importRoutes);

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
