import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
  Economy:       () => import('./pages/Economy'),
  Plan:          () => import('./pages/Plan'),
  Goals:         () => import('./pages/Goals'),
  Stock:         () => import('./pages/Stock'),
  Asset:         () => import('./pages/Asset'),
  Settings:      () => import('./pages/Settings'),
  Assistant:     () => import('./pages/Assistant'),
};
const Login         = lazy(() => import('./pages/Login'));
const ConnectAuthorize = lazy(() => import('./pages/ConnectAuthorize'));
const Register      = lazy(() => import('./pages/Register'));
const Dashboard     = lazy(pages.Dashboard);
const Accounts      = lazy(pages.Accounts);
const AccountDetail = lazy(pages.AccountDetail);
const Transactions  = lazy(pages.Transactions);
const Analytics     = lazy(pages.Analytics);
const Markets       = lazy(pages.Markets);
const Economy       = lazy(pages.Economy);
const Plan          = lazy(pages.Plan);
const Goals         = lazy(pages.Goals);
const Stock         = lazy(pages.Stock);
const Asset         = lazy(pages.Asset);
const Settings      = lazy(pages.Settings);
const Assistant     = lazy(pages.Assistant);

const preloadPages = () => Object.values(pages).forEach(load => load().catch(() => {}));
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  window.addEventListener('load', () => idle(preloadPages), { once: true });
}

// A consent link opened while signed out resumes after sign-in, wherever login sends the user.
const RETURN_KEY = 'apex_return_to';
function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (!user) {
    if (pathname.startsWith('/connect/')) { try { sessionStorage.setItem(RETURN_KEY, pathname + search); } catch { /* best effort */ } }
    return <Navigate to="/login" />;
  }
  let back = null;
  try { back = sessionStorage.getItem(RETURN_KEY); } catch { /* best effort */ }
  if (back && back !== pathname + search) {
    try { sessionStorage.removeItem(RETURN_KEY); } catch { /* best effort */ }
    return <Navigate to={back} replace />;
  }
  return children;
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

          {/* Approving the Apex connector for Claude / ChatGPT — signed in, outside the shell. */}
          <Route path="/connect/authorize" element={<ProtectedRoute><ConnectAuthorize /></ProtectedRoute>} />

          {/* Protected routes share one shell, which stays mounted across pages. */}
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/economy" element={<Economy />} />
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
