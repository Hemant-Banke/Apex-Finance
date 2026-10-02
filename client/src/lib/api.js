import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// ── Global in-flight request tracking (drives the top progress bar) ──────────
let _inFlight = 0;
const _loadingSubs = new Set();
function _emitLoading() { _loadingSubs.forEach(fn => fn(_inFlight)); }
function _startRequest() { _inFlight += 1; _emitLoading(); }
function _endRequest()   { _inFlight = Math.max(0, _inFlight - 1); _emitLoading(); }

/** Subscribe to in-flight request count. Returns an unsubscribe fn. */
export function subscribeLoading(fn) {
  _loadingSubs.add(fn);
  fn(_inFlight);
  return () => _loadingSubs.delete(fn);
}

// Request interceptor — attach JWT token + track loading
api.interceptors.request.use(
  (config) => {
    _startRequest();
    const token = localStorage.getItem('apex_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => { _endRequest(); return Promise.reject(error); }
);

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => { _endRequest(); return response; },
  (error) => {
    _endRequest();
    // Don't redirect for login/register — wrong credentials should show an in-page error.
    // All other 401s (including /auth/me on session restore) redirect to login.
    const url = error.config?.url || '';
    const isUnauthenticatedEndpoint = url.includes('/auth/login') || url.includes('/auth/register')
      || url.includes('/auth/google') || url.includes('/auth/apple');
    if (error.response?.status === 401 && !isUnauthenticatedEndpoint) {
      localStorage.removeItem('apex_token');
      localStorage.removeItem('apex_user');
      window.location.href = '/login';
      // Return a never-resolving promise so catch blocks in pages don't fire
      // while the browser is navigating away
      return new Promise(() => {});
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  google: (credential) => api.post('/auth/google', { credential }),
  apple: (payload) => api.post('/auth/apple', payload), // { id_token, user? }
  getMe: () => api.get('/auth/me')
};

// Accounts
export const accountsAPI = {
  getAll: () => api.get('/accounts'),
  getById: (id) => api.get(`/accounts/${id}`),
  getHoldings: (id) => api.get(`/accounts/${id}/holdings`),
  // `growth` swaps the series for a growth-only index (base 100) — see PriceGrapher.
  getDaily: (id, days, growth) => api.get(`/accounts/${id}/daily`, {
    params: { ...(days ? { days } : {}), ...(growth ? { growth: 'true' } : {}) },
  }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`)
};

// Transactions
export const transactionsAPI = {
  getAll: (params) => api.get('/transactions', { params }),
  create: (data) => api.post('/transactions', data),
  // Import path. One request, and one store pass server-side — sending rows singly
  // re-prices and re-aggregates every store per row.
  bulkCreate: (transactions) => api.post('/transactions/bulk', { transactions }),
  update: (id, data) => api.put(`/transactions/${id}`, data),
  delete: (id) => api.delete(`/transactions/${id}`),
  // Undo an import: one request, one store pass. Axios puts a DELETE body under
  // `data`, not as the second positional argument.
  bulkDelete: (ids) => api.delete('/transactions/bulk', { data: { ids } })
};

// Dashboard
export const dashboardAPI = {
  getSummary:          ()       => api.get('/dashboard/summary'),
  // The book marked to market — value, unrealised/realised P&L, day change, weight,
  // and allocation by market value. This is what anything about PERFORMANCE reads.
  getPortfolio:        ()       => api.get('/dashboard/portfolio'),
  // The raw book at cost. Only for callers that just need the instrument list.
  getHoldings:         ()       => api.get('/dashboard/holdings'),
  // days omitted / 0 = the whole history
  getContribution:     (days)   => api.get('/dashboard/contribution', { params: { days } }),
  getIncomeExpense:    (months) => api.get('/dashboard/income-expense',    { params: { months } }),
  // Category totals for one direction — where it goes, and where it comes from.
  getCategoryTotals:   (type, months) => api.get('/dashboard/categories', { params: { type, months } })
};

// Subscriptions — recurring transactions (SIPs, streaming, rent…). Each due
// occurrence materialises into a real transaction server-side.
export const subscriptionsAPI = {
  getAll: ()            => api.get('/subscriptions'),
  create: (data)        => api.post('/subscriptions', data),
  setActive: (id, active) => api.patch(`/subscriptions/${id}`, { active }),
  delete: (id)          => api.delete(`/subscriptions/${id}`),
};

// Market data (search + historical prices via Yahoo Finance proxy)
export const marketAPI = {
  // `indices` — include market indices (Markets can show one; nothing can buy one).
  search: (q, indices)   => api.get('/market/search', { params: indices ? { q, indices: true } : { q } }),
  // assetType/purity are only needed for physical metal, which is priced per gram
  // by type rather than by symbol.
  price:  (symbol, date, opts = {}) => api.get('/market/price', { params: { symbol, date, ...opts } }),
  ohlc:   (symbol, days) => api.get('/market/ohlc',   { params: days ? { symbol, days } : { symbol } }),
  // A day-by-day close series for a benchmark index, carried forward across
  // non-trading days — feeds the growth view's comparison overlay.
  indexSeries: (symbol, days) => api.get('/market/index-series', { params: days ? { symbol, days } : { symbol } }),
};

// The Indian market as a whole (the Markets page) — not the user's money.
export const marketsAPI = {
  // `fresh` — the Markets refresh button: bypass the server's caches (it throttles).
  overview: (fresh)              => api.get('/markets/overview', { params: fresh ? { fresh: true } : {} }),
  sectors:  (fresh)              => api.get('/markets/sectors',  { params: fresh ? { fresh: true } : {} }),
  stock:    (symbol, fresh)      => api.get(`/markets/stocks/${encodeURIComponent(symbol)}`, { params: fresh ? { fresh: true } : {} }),
  asset:    (symbol, fresh)      => api.get(`/markets/assets/${encodeURIComponent(symbol)}`, { params: fresh ? { fresh: true } : {} }),
  flows:    (sessions = 60, fresh) => api.get('/markets/flows',  { params: { sessions, ...(fresh ? { fresh: true } : {}) } }),
};

// Statement import (parse PDF / HTML / image)
export const importAPI = {
  parse: (formData) => api.post('/import/parse', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

// Transaction categories (default + user-defined)
export const categoriesAPI = {
  getAll:  (type) => api.get('/categories', { params: type ? { type } : {} }),
  create:  (data) => api.post('/categories', data),
  // Renames / re-emojis a custom category. The `code` never changes — transactions
  // already filed under it reference it.
  update:  (code, data) => api.patch(`/categories/${encodeURIComponent(code)}`, data),
  delete:  (code) => api.delete(`/categories/${encodeURIComponent(code)}`),
};

// Net Worth store
export const networthAPI = {
  // Today is always appended to the settled series (T cash + T-1 close), so the chart
  // ends where the headline figure does instead of a day short of it.
  // `growth` swaps the series for a growth-only index (base 100) — see PriceGrapher.
  getDaily: (days, growth) => api.get('/networth/daily', {
    params: { ...(days ? { days } : {}), ...(growth ? { growth: 'true' } : {}) },
  }),
  ensure:   ()     => api.post('/networth/ensure'),
  rebuild:  ()     => api.post('/networth/rebuild'),
};

export default api;
