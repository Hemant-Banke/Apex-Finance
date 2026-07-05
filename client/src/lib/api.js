import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor — attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('apex_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't redirect for login/register — wrong credentials should show an in-page error.
    // All other 401s (including /auth/me on session restore) redirect to login.
    const url = error.config?.url || '';
    const isUnauthenticatedEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
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
  getMe: () => api.get('/auth/me')
};

// Accounts
export const accountsAPI = {
  getAll: () => api.get('/accounts'),
  getById: (id) => api.get(`/accounts/${id}`),
  getHoldings: (id) => api.get(`/accounts/${id}/holdings`),
  getDaily: (id, days) => api.get(`/accounts/${id}/daily`, { params: days ? { days } : {} }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`)
};

// Transactions
export const transactionsAPI = {
  getAll: (params) => api.get('/transactions', { params }),
  create: (data) => api.post('/transactions', data),
  update: (id, data) => api.put(`/transactions/${id}`, data),
  delete: (id) => api.delete(`/transactions/${id}`)
};

// Dashboard
export const dashboardAPI = {
  getSummary:          ()       => api.get('/dashboard/summary'),
  getHoldings:         ()       => api.get('/dashboard/holdings'),
  getAssetAllocation:  ()       => api.get('/dashboard/asset-allocation'),
  getIncomeExpense:    (months) => api.get('/dashboard/income-expense',    { params: { months } }),
  getExpenseCategories:(months) => api.get('/dashboard/expense-categories',{ params: { months } })
};

// Market data (search + historical prices via Yahoo Finance proxy)
export const marketAPI = {
  search: (q)            => api.get('/market/search', { params: { q } }),
  price:  (symbol, date) => api.get('/market/price',  { params: { symbol, date } }),
  ohlc:   (symbol, days) => api.get('/market/ohlc',   { params: days ? { symbol, days } : { symbol } }),
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
  delete:  (code) => api.delete(`/categories/${encodeURIComponent(code)}`),
};

// Net Worth store
export const networthAPI = {
  getDaily: (days) => api.get('/networth/daily', { params: days ? { days } : {} }),
  ensure:   ()     => api.post('/networth/ensure'),
  rebuild:  ()     => api.post('/networth/rebuild'),
};

export default api;
