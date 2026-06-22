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
const marketRoutes   = require('./routes/market');
const categoryRoutes = require('./routes/categories');
const importRoutes   = require('./routes/import');

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
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/networth', networthRoutes);
app.use('/api/market',      marketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/import',    importRoutes);

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
