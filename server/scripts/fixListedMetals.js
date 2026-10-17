// Retypes gold/silver rows with no purity (imported ETFs) to 'etf' and rebuilds affected users.
// Usage: node scripts/fixListedMetals.js [--apply]
require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const dvService = require('../services/dailyValueService');

const MISFILED = { assetType: { $in: ['gold', 'silver'] }, $or: [{ purity: null }, { purity: '' }] };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const rows = await Transaction.find(MISFILED).select('user assetSymbol assetType').lean();
  console.log(`${rows.length} misfiled rows:`, [...new Set(rows.map(r => r.assetSymbol))].join(', ') || '—');
  if (process.argv.includes('--apply') && rows.length) {
    await Transaction.updateMany(MISFILED, { $set: { assetType: 'etf' } });
    for (const user of new Set(rows.map(r => String(r.user)))) {
      await dvService.rebuildAll(user);
      console.log('rebuilt', user);
    }
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
