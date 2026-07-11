import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import ApexLogo from '../components/ui/ApexLogo';
import CubeGrid, { GRID_PERIOD } from '../components/ui/CubeGrid';
import OAuthButtons from '../components/auth/OAuthButtons';

const PHRASES = ['Your wealth', 'Your growth', 'Your future', 'Your legacy'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName]           = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 3000);
    return () => clearInterval(t);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirmPw) { setError("Passwords don't match"); return; }
    setError('');
    setLoading(true);
    try   { await register(name, email, password); navigate('/'); }
    catch (err) { setError(err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || 'Registration failed'); }
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

        {/* Orbs — different palette from Login to distinguish the pages */}
        <div className="landing-orb" style={{ width: 480, height: 480, background: 'radial-gradient(circle, rgba(99,102,241,0.2), transparent 65%)', top: '-5%', right: '-2%', animation: 'orbFloat2 22s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 360, height: 360, background: 'radial-gradient(circle, rgba(45,212,191,0.18), transparent 65%)', bottom: '8%', left: '-4%', animation: 'orbFloat1 26s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 240, height: 240, background: 'radial-gradient(circle, rgba(34,197,94,0.12), transparent 65%)', top: '55%', right: '30%', animation: 'orbFloat3 20s ease-in-out infinite' }} />
        <div className="landing-orb" style={{ width: 190, height: 190, background: 'radial-gradient(circle, rgba(249,115,22,0.11), transparent 65%)', top: '15%', left: '30%', animation: 'orbFloat4 17s ease-in-out infinite' }} />

        {/* Large faint logo watermark */}
        <div style={{
          position: 'absolute', left: '-6%', top: '10%',
          opacity: 0.028, pointerEvents: 'none', transform: 'rotate(8deg)',
        }}>
          <ApexLogo size={500} />
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
            <span style={{ display: 'block', marginBottom: 6 }}>Begins with</span>
            <span style={{ position: 'relative', display: 'block', height: 'clamp(3.2rem, 6.4vw, 4.8rem)' }}>
              {PHRASES.map((ph, i) => (
                <span key={ph} style={{
                  position: 'absolute', left: 0, top: 0,
                  fontStyle: 'italic', color: 'var(--color-accent)',
                  whiteSpace: 'nowrap',
                  opacity: 0, transform: 'translateY(20px)', filter: 'blur(6px)',
                  transition: 'all 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
                  ...(i === phraseIdx ? { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' } : {}),
                }}>
                  {ph}
                </span>
              ))}
            </span>
          </h1>

          <p className="hero-subtitle" style={{ marginTop: 28 }}>
            No manual balance entry. Every figure is computed
            from your transactions — accurate, always, and
            entirely yours.
          </p>

          {/* Feature list */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 12, marginTop: 48,
            animation: 'heroFadeIn 0.8s ease-out 0.5s both',
          }}>
            {[
              'Track every asset class — stocks, crypto, gold, FDs, EPF',
              'Complete cash flow from income, expenses & transfers',
              'Net worth history built from every single transaction',
            ].map(line => (
              <div key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-accent)', marginTop: 7, flexShrink: 0 }} />
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{line}</p>
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
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 56px', background: 'var(--color-bg-primary)', overflowY: 'auto' }}>

        {/* Gradient left border */}
        <div className="landing-divider" />

        <div style={{ width: '100%', maxWidth: 380, animation: 'heroFadeIn 0.7s ease-out 0.35s both' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
            <ApexLogo size={16} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontStyle: 'italic', color: 'var(--color-text-muted)' }}>Apex</span>
          </div>

          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400,
            color: 'var(--color-text-primary)', letterSpacing: '-0.025em', marginBottom: 8,
          }}>Get started</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 36 }}>
            Create your account — free, always.
          </p>

          {error && (
            <div style={{ marginBottom: 24, padding: '12px 16px', borderRadius: 10, fontSize: 13, background: 'var(--color-danger-muted)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.15)' }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="input-field" placeholder="Your name" required autoFocus />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="input-field" placeholder="you@example.com" required />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="input-field" style={{ paddingRight: 42 }} placeholder="Min. 6 characters" required minLength={6} />
                <button type="button" onClick={() => setShowPw(!showPw)} tabIndex={-1} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex',
                }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Confirm password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                className="input-field" placeholder="Re-enter password" required />
            </div>

            <button type="submit" disabled={loading} className="btn-primary"
              style={{ width: '100%', padding: '13px 18px', marginTop: 6, fontSize: '0.875rem', letterSpacing: '-0.01em' }}>
              {loading
                ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                : <><span>Create account</span><ArrowRight size={15} /></>
              }
            </button>
          </form>

          <OAuthButtons onError={setError} />

          <p style={{ textAlign: 'center', marginTop: 32, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Already on Apex?{' '}
            <Link to="/login" style={{ fontWeight: 500, color: 'var(--color-accent)', textDecoration: 'none' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
