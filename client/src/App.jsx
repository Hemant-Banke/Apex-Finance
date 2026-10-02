import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppShell from './components/layout/AppShell';
import DesktopOnly from './components/layout/DesktopOnly';
import AppLoader from './components/ui/AppLoader';
import TopProgressBar from './components/ui/TopProgressBar';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import Markets from './pages/Markets';
import Plan from './pages/Plan';
import Stock from './pages/Stock';
import Asset from './pages/Asset';
import Settings from './pages/Settings';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <AppLoader />;

  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" /> : children;
}

function App() {
  return (
    // The whole site, login included — there is no part of Apex laid out for a phone.
    <DesktopOnly>
    <AuthProvider>
      <ToastProvider>
        <TopProgressBar />
        <Router>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />

          {/* Protected routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <AppShell><Dashboard /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/accounts" element={
            <ProtectedRoute>
              <AppShell><Accounts /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/accounts/:id" element={
            <ProtectedRoute>
              <AppShell><AccountDetail /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/transactions" element={
            <ProtectedRoute>
              <AppShell><Transactions /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/analytics" element={
            <ProtectedRoute>
              <AppShell><Analytics /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/plan" element={
            <ProtectedRoute>
              <AppShell><Plan /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/markets" element={
            <ProtectedRoute>
              <AppShell><Markets /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/markets/stocks/:symbol" element={
            <ProtectedRoute>
              <AppShell><Stock /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/markets/world/:symbol" element={
            <ProtectedRoute>
              <AppShell><Stock global /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/markets/assets/:symbol" element={
            <ProtectedRoute>
              <AppShell><Asset /></AppShell>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <AppShell><Settings /></AppShell>
            </ProtectedRoute>
          } />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Router>
      </ToastProvider>
    </AuthProvider>
    </DesktopOnly>
  );
}

export default App;
