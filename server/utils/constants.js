const DAY_MS = 86400000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const ACCOUNT_TYPES = [
  'bank', 
  'brokerage', 
  'retirement', 
  'debt', 
  'wallet', 
  'other'
];

const TRANSACTION_TYPES = [
  'income', 
  'expense', 
  'transfer', 
  'adjustment', 
  'buy', 
  'sell',
  '_cashcalibration',
  '_assetcalibration',
];

const ASSET_TRANSACTION_TYPES = [
  'buy',
  'sell',
  '_assetcalibration',
];

const ASSET_TYPES = [
  'stock',
  'bond',
  'mutual_fund',
  'etf',
  'crypto',
  'gold',
  'silver',
  'commodity',
  'epf_nps',
  'fd',
  'other'
];

module.exports = { 
  DAY_MS,
  IST_OFFSET_MS,
  YF_HEADERS,

  ACCOUNT_TYPES, 
  TRANSACTION_TYPES, 
  ASSET_TRANSACTION_TYPES,
  ASSET_TYPES,
};