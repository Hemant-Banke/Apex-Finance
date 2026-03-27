import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard, Wallet, ArrowLeftRight, BarChart3, LogOut, RefreshCw
} from 'lucide-react';
import ApexLogo from '../ui/ApexLogo';
import CubeGrid, { GRID_PERIOD } from '../ui/CubeGrid';
import { networthAPI } from '../../lib/api';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/accounts', icon: Wallet, label: 'Accounts' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuild = async () => {
    setRebuilding(true);
    try { await networthAPI.rebuild(); } catch (e) { console.error(e); }
    finally { setRebuilding(false); }
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#0d0d0d',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* ── Ambient background — persists across all pages (AppShell never unmounts) ── */}
      <CubeGrid period={GRID_PERIOD} style={{ opacity: 0.5 }} />
      <div className="landing-orb" style={{ width: 680, height: 680, background: 'radial-gradient(circle, rgba(45,212,191,0.09), transparent 65%)', top: '-18%', right: '-2%', animation: 'orbFloat1 28s ease-in-out infinite' }} />
      <div className="landing-orb" style={{ width: 480, height: 480, background: 'radial-gradient(circle, rgba(99,102,241,0.07), transparent 65%)', bottom: '-12%', right: '22%', animation: 'orbFloat3 24s ease-in-out infinite' }} />

      {/* ── Sidebar ── */}
      <aside style={{
        width: 200,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary)',
        borderRight: '1px solid var(--color-border)',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo area */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '20px 20px',
        }}>
          <ApexLogo size={22} style={{ color: 'var(--color-accent)' }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 400,
            fontStyle: 'italic',
            letterSpacing: '-0.01em',
            color: 'var(--color-text-primary)',
          }}>
            Apex
          </span>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                background: isActive ? 'var(--color-bg-card)' : 'transparent',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              })}
            >
              <Icon size={18} strokeWidth={1.5} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Dev tools */}
        <div style={{ padding: '4px 8px' }}>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            title="Rebuild all daily value stores from transactions"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 12px', borderRadius: 8,
              background: 'none', border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-muted)', cursor: rebuilding ? 'default' : 'pointer',
              fontSize: 11, opacity: rebuilding ? 0.5 : 0.7,
            }}
          >
            <RefreshCw size={12} style={{ flexShrink: 0, animation: rebuilding ? 'spin 1s linear infinite' : 'none' }} />
            {rebuilding ? 'Rebuilding…' : 'Rebuild Stores'}
          </button>
        </div>

        {/* User profile */}
        <div style={{
          padding: '8px 8px',
          borderTop: '1px solid var(--color-border-subtle)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 10,
            cursor: 'default',
          }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
              background: 'var(--color-accent-muted)',
              color: 'var(--color-accent)',
            }}>
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{user?.name}</p>
              <p style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{user?.email}</p>
            </div>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              title="Sign out"
              style={{
                padding: 6,
                borderRadius: 6,
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main style={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          maxWidth: 1060,
          margin: '0 auto',
          padding: '40px 48px 60px',
        }}>
          {children}
        </div>
      </main>
    </div>
  );
}
