import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, networthAPI } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('apex_token');
    const savedUser = localStorage.getItem('apex_user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
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
    } else {
      setLoading(false);
    }
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
    // networthAPI.ensure().catch(() => {});
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('apex_token');
    localStorage.removeItem('apex_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
