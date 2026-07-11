import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, networthAPI } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Hydrate the user synchronously from localStorage so there's no logged-out
  // flash on refresh; the effect below then re-validates the token.
  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem('apex_token');
      const savedUser = localStorage.getItem('apex_user');
      return token && savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  // Only "loading" while there's a stored session to re-validate; otherwise
  // there's nothing to wait for, so we start settled (no setState in the effect).
  const [loading, setLoading] = useState(
    () => !!(localStorage.getItem('apex_token') && localStorage.getItem('apex_user'))
  );

  useEffect(() => {
    const token = localStorage.getItem('apex_token');
    const savedUser = localStorage.getItem('apex_user');
    if (!token || !savedUser) return;
    // Verify token is still valid
    authAPI.getMe()
      .then(res => {
        setUser(res.data);
        localStorage.setItem('apex_user', JSON.stringify(res.data));
        networthAPI.ensure().catch(() => {}); // extend store to today on session restore
      })
      .catch(() => {
        localStorage.removeItem('apex_token');
        localStorage.removeItem('apex_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await authAPI.login({ email, password });
    const { token, ...userData } = res.data;
    localStorage.setItem('apex_token', token);
    localStorage.setItem('apex_user', JSON.stringify(userData));
    setUser(userData);
    networthAPI.ensure().catch(() => {});
    return userData;
  };

  const register = async (name, email, password) => {
    const res = await authAPI.register({ name, email, password });
    const { token, ...userData } = res.data;
    localStorage.setItem('apex_token', token);
    localStorage.setItem('apex_user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  };

  // Persist a session from any auth response, then hydrate context.
  const establishSession = (data) => {
    const { token, ...userData } = data;
    localStorage.setItem('apex_token', token);
    localStorage.setItem('apex_user', JSON.stringify(userData));
    setUser(userData);
    networthAPI.ensure().catch(() => {});
    return userData;
  };

  const loginWithGoogle = async (credential) => {
    const res = await authAPI.google(credential);
    return establishSession(res.data);
  };

  const loginWithApple = async (payload) => {
    const res = await authAPI.apple(payload);
    return establishSession(res.data);
  };

  const logout = () => {
    localStorage.removeItem('apex_token');
    localStorage.removeItem('apex_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, loginWithGoogle, loginWithApple }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
