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

// Route imports
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const dashboardRoutes = require('./routes/dashboard');
const networthRoutes = require('./routes/networth');
const marketRoutes = require('./routes/market');
const categoryRoutes = require('./routes/categories');
const importRoutes = require('./routes/import');
const subscriptionRoutes = require('./routes/subscriptions');

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
    .then(({ schemes, histories }) =>
      console.log(`MF caches ready — ${schemes} schemes + NAVs indexed, ${histories} histories topped up`))
    .catch(e => console.error('MF cache refresh failed:', e.message));

  refreshMf();
  setInterval(refreshMf, 24 * 60 * 60 * 1000).unref();
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
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/networth', networthRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/import', importRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Apex Server running on port ${PORT}`);
});
