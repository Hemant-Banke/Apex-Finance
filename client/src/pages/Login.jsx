import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import ApexLogo from '../components/ui/ApexLogo';
import CubeGrid, { GRID_PERIOD } from '../components/ui/CubeGrid';
import OAuthButtons from '../components/auth/OAuthButtons';

const WORDS = ['Tracks', 'Invests', 'Grows', 'Protects', 'Compounds'];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [wordIdx, setWordIdx]   = useState(0);

  useEffect(() => {
    const t = setInterval(() => setWordIdx(i => (i + 1) % WORDS.length), 3000);
    return () => clearInterval(t);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try   { await login(email, password); navigate('/'); }
    catch (err) { setError(err.response?.data?.message || 'Could not connect. Is the server running?'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#0B0D10', overflow: 'hidden' }}>

      {/* ══════════ LEFT — HERO ══════════ */}
      <div className="landing-grid" style={{
        flex: '0 0 58%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px 72px',
        overflow: 'hidden',
        background: '#0B0D10',
      }}>

        {/* Cube grid with sweeping sheen */}
        <CubeGrid period={GRID_PERIOD} />

        {/* Orbs */}
        <div className="landing-orb" style={{ width: 520, height: 520, background: 'radial-gradient(circle, rgba(45,212,191,0.22), transparent 65%)', top: '-8%', left: '-5%', animation: 'orbFloat1 20s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 380, height: 380, background: 'radial-gradient(circle, rgba(99,102,241,0.18), transparent 65%)', bottom: '5%', right: '5%', animation: 'orbFloat2 26s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 260, height: 260, background: 'radial-gradient(circle, rgba(249,115,22,0.14), transparent 65%)', top: '52%', left: '40%', animation: 'orbFloat3 18s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 200, height: 200, background: 'radial-gradient(circle, rgba(168,85,247,0.13), transparent 65%)', top: '20%', right: '18%', animation: 'orbFloat4 22s ease-in-out infinite' }} />

        {/* Large faint logo watermark */}
        <div style={{
          position: 'absolute', right: '-4%', bottom: '4%',
          opacity: 0.032, pointerEvents: 'none', transform: 'rotate(-6deg)',
        }}>
          <ApexLogo size={540} />
        </div>

        {/* Top-left logo */}
        <div style={{
          position: 'absolute', top: 40, left: 72,
          display: 'flex', alignItems: 'center', gap: 10,
          animation: 'heroFadeIn 0.6s ease-out both',
        }}>
          <ApexLogo size={20} className="logo-pulse" style={{ color: 'var(--color-accent)' }} />
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 400,
            fontStyle: 'italic', color: 'var(--color-text-primary)', letterSpacing: '-0.01em',
          }}>Apex</span>
        </div>

        {/* Hero text */}
        <div style={{ position: 'relative', zIndex: 1, animation: 'heroFadeIn 0.9s ease-out 0.15s both' }}>
          <h1 className="hero-heading">
            <span style={{ display: 'block', marginBottom: 6 }}>Apex</span>
            <span style={{ position: 'relative', display: 'block', height: 'clamp(3.2rem, 6.4vw, 4.8rem)' }}>
              {WORDS.map((w, i) => (
                <span key={w} style={{
                  position: 'absolute', left: 0, top: 0,
                  fontStyle: 'italic', color: 'var(--color-accent)',
                  opacity: 0, transform: 'translateY(20px)', filter: 'blur(6px)',
                  transition: 'all 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
                  ...(i === wordIdx ? { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' } : {}),
                }}>
                  {w}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-subtitle" style={{ marginTop: 28 }}>
            Every transaction tells your financial story.
            Track investments, expenses, income, and net worth —
            everything derived from your data.
          </p>

          {/* Stats row */}
          <div style={{
            display: 'flex', gap: 32, marginTop: 48,
            animation: 'heroFadeIn 0.8s ease-out 0.5s both',
          }}>
            {[['Everything', 'is a transaction'], ['Real-time', 'net worth'], ['Complete', 'financial picture']].map(([bold, dim]) => (
              <div key={bold}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>{bold}</p>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{dim}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Copyright */}
        <p style={{
          position: 'absolute', bottom: 40, left: 72,
          fontSize: 11, color: 'var(--color-text-muted)',
          animation: 'heroFadeIn 0.6s ease-out 0.8s both',
        }}>© 2026 Apex</p>
      </div>

      {/* ══════════ RIGHT — FORM ══════════ */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 56px', background: 'var(--color-bg-primary)' }}>

        {/* Gradient left border */}
        <div className="landing-divider" />

        <div style={{ width: '100%', maxWidth: 380, animation: 'heroFadeIn 0.7s ease-out 0.35s both' }}>

          {/* Logo repeated in form panel (small, subtle) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
            <ApexLogo size={16} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Apex</span>
          </div>

          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400,
            color: 'var(--color-text-primary)', letterSpacing: '-0.025em', marginBottom: 8,
          }}>Welcome back</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 36 }}>
            Sign in to your portfolio
          </p>

          {error && (
            <div style={{ marginBottom: 24, padding: '12px 16px', borderRadius: 10, fontSize: 13, background: 'var(--color-danger-muted)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)' }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" placeholder="you@example.com" required autoFocus />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="input-field" style={{ paddingRight: 42 }} placeholder="Enter password" required />
                <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
                }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary"
              style={{ width: '100%', padding: '13px 18px', marginTop: 6, fontSize: '0.875rem', letterSpacing: '-0.01em' }}>
              {loading
                ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                : <><span>Sign in</span><ArrowRight size={15} /></>
              }
            </button>
          </form>

          <OAuthButtons onError={setError} />

          <p style={{ textAlign: 'center', marginTop: 32, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ fontWeight: 500, color: 'var(--color-accent)', textDecoration: 'none' }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
