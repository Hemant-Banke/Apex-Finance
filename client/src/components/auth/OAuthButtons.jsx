import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const APPLE_CLIENT_ID  = import.meta.env.VITE_APPLE_CLIENT_ID;
const APPLE_REDIRECT   = import.meta.env.VITE_APPLE_REDIRECT_URI
  || (typeof window !== 'undefined' ? window.location.origin : '');
const APPLE_SDK = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

// ── Apple JS SDK (loaded on demand) ─────────────────────────────────────────
let appleScriptPromise = null;
function loadAppleSdk() {
  if (window.AppleID) return Promise.resolve();
  if (appleScriptPromise) return appleScriptPromise;
  appleScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = APPLE_SDK;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { appleScriptPromise = null; reject(new Error('Failed to load Apple sign-in')); };
    document.head.appendChild(s);
  });
  return appleScriptPromise;
}

async function signInWithApple() {
  await loadAppleSdk();
  window.AppleID.auth.init({
    clientId: APPLE_CLIENT_ID,
    scope: 'name email',
    redirectURI: APPLE_REDIRECT,
    usePopup: true,
  });
  const data = await window.AppleID.auth.signIn();
  // `user` (name/email) is only present on the very first authorization.
  return { id_token: data.authorization?.id_token, user: data.user };
}

// Turn an axios/auth failure into a message that actually says what went wrong.
function describeAuthError(e, provider) {
  if (e?.response) {
    // Server replied — prefer its message, else surface the status.
    return e.response.data?.message
      || `${provider} sign-in failed (server returned ${e.response.status})`;
  }
  if (e?.request) {
    // Request left the browser but no response — server down / not restarted / CORS.
    return `Could not reach the server for ${provider} sign-in. Is the backend running and restarted?`;
  }
  return e?.message || `${provider} sign-in failed`;
}

function AppleMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.82 0-2.06-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.46 7.83 1.3 10.39.86 1.25 1.88 2.66 3.22 2.61 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.28 3.12-2.54.98-1.45 1.39-2.86 1.41-2.93-.03-.01-2.71-1.04-2.74-4.12M14.6 4.77c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.98-1.08 3.15 1.14.09 2.3-.58 3.01-1.44"/>
    </svg>
  );
}

/**
 * OAuthButtons — Google + Apple sign-in, shown only on Login (which doubles as
 * sign-up: an unknown OAuth identity is created server-side and signed straight in).
 * Each button shows only when its client ID is configured (VITE_GOOGLE_CLIENT_ID /
 * VITE_APPLE_CLIENT_ID); the whole block hides if neither is set. Errors are
 * surfaced via `onError` so the host page renders them inline.
 */
export default function OAuthButtons({ onError }) {
  const { loginWithGoogle, loginWithApple } = useAuth();
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const [gWidth, setGWidth] = useState(320);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const measure = () => {
      if (wrapRef.current) setGWidth(Math.max(200, Math.min(400, Math.floor(wrapRef.current.offsetWidth))));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const handleGoogle = useCallback(async (cred) => {
    onError?.('');
    setBusy(true);
    try { await loginWithGoogle(cred.credential); navigate('/'); }
    catch (e) { onError?.(describeAuthError(e, 'Google')); }
    finally { setBusy(false); }
  }, [loginWithGoogle, navigate, onError]);

  const handleApple = useCallback(async () => {
    onError?.('');
    setBusy(true);
    try {
      const payload = await signInWithApple();
      if (!payload.id_token) throw new Error('No Apple token returned');
      await loginWithApple(payload);
      navigate('/');
    } catch (e) {
      // Apple rejects with { error: 'popup_closed_by_user' } on cancel — stay quiet.
      if (e?.error === 'popup_closed_by_user') { /* user cancelled */ }
      else onError?.(describeAuthError(e, 'Apple'));
    } finally { setBusy(false); }
  }, [loginWithApple, navigate, onError]);

  if (!GOOGLE_CLIENT_ID && !APPLE_CLIENT_ID) return null;

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {GOOGLE_CLIENT_ID && (
        <div style={{
          display: 'flex', justifyContent: 'center', colorScheme: 'light',
          opacity: busy ? 0.55 : 1, pointerEvents: busy ? 'none' : 'auto',
        }}>
          <GoogleLogin
            onSuccess={handleGoogle}
            onError={() => onError?.('Google sign-in failed')}
            theme="filled_black"
            shape="pill"
            text="continue_with"
            width={String(gWidth)}
          />
        </div>
      )}

      {APPLE_CLIENT_ID && (
        <button
          type="button"
          onClick={handleApple}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '11px 18px', borderRadius: 999,
            background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
            fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.55 : 1,
            transition: 'opacity 0.15s, transform 0.1s',
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.99)'; }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <AppleMark size={16} /> Continue with Apple
        </button>
      )}
    </div>
  );
}
