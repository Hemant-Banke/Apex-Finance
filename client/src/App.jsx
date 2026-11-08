import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { PricingProvider } from './context/PricingContext';
import AppShell from './components/layout/AppShell';
import DesktopOnly from './components/layout/DesktopOnly';
import TopProgressBar from './components/ui/TopProgressBar';
import AppLoader from './components/ui/AppLoader';

// Pages load on demand, so the first paint ships only what it shows; the rest preload once idle.
const pages = {
  Dashboard:     () => import('./pages/Dashboard'),
  Accounts:      () => import('./pages/Accounts'),
  AccountDetail: () => import('./pages/AccountDetail'),
  Transactions:  () => import('./pages/Transactions'),
  Analytics:     () => import('./pages/Analytics'),
  Markets:       () => import('./pages/Markets'),
  Plan:          () => import('./pages/Plan'),
  Goals:         () => import('./pages/Goals'),
  Stock:         () => import('./pages/Stock'),
  Asset:         () => import('./pages/Asset'),
  Settings:      () => import('./pages/Settings'),
};
const Login         = lazy(() => import('./pages/Login'));
const Register      = lazy(() => import('./pages/Register'));
const Dashboard     = lazy(pages.Dashboard);
const Accounts      = lazy(pages.Accounts);
const AccountDetail = lazy(pages.AccountDetail);
const Transactions  = lazy(pages.Transactions);
const Analytics     = lazy(pages.Analytics);
const Markets       = lazy(pages.Markets);
const Plan          = lazy(pages.Plan);
const Goals         = lazy(pages.Goals);
const Stock         = lazy(pages.Stock);
const Asset         = lazy(pages.Asset);
const Settings      = lazy(pages.Settings);

const preloadPages = () => Object.values(pages).forEach(load => load().catch(() => {}));
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  window.addEventListener('load', () => idle(preloadPages), { once: true });
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" /> : children;
}

function App() {
  return (
    // The whole site, login included — there is no part of Apex laid out for a phone.
    <DesktopOnly>
    <AuthProvider>
      <ToastProvider>
      <PricingProvider>
        <TopProgressBar />
        <Router>
        <Suspense fallback={<AppLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

          {/* Protected routes share one shell, which stays mounted across pages. */}
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/markets/stocks/:symbol" element={<Stock />} />
            <Route path="/markets/world/:symbol" element={<Stock global />} />
            <Route path="/markets/assets/:symbol" element={<Asset />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
        </Router>
      </PricingProvider>
      </ToastProvider>
    </AuthProvider>
    </DesktopOnly>
  );
}

export default App;
