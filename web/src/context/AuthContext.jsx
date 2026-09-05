import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api/client';
import { clearCachedApiData } from '../lib/serviceWorker';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    // CLEARED ON THE WAY IN, NOT ONLY ON THE WAY OUT.
    //
    // logout() already dropped the cached API responses, which covers the
    // tidy case. It does not cover the common one: a session that ENDED
    // rather than being signed out of — an expired token, a password changed
    // elsewhere — leaves that cache in place, and the next person to sign in
    // on the same phone could be served the previous account's progress and
    // notes from it while offline. Clearing here makes signing in mean "this
    // is my session now" regardless of how the last one finished.
    clearCachedApiData();
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }

  // exam_track is part of registration, not a later setting: it decides what
  // every screen renders, so a new account should never open onto the wrong
  // lane and have to be corrected.
  async function register(name, email, password, exam_track = 'both') {
    const res = await api.post('/auth/register', { name, email, password, exam_track });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
    // The offline cache holds this student's own notes, progress and
    // highlights. Dropping the token without dropping the cache would leave
    // the next person on a shared phone able to be served their data.
    clearCachedApiData();
  }

  // The profile page edits the same identity the navbar renders, and the
  // display name is baked into the JWT — so a save has to replace both the
  // stored token and the in-memory user, or the header keeps showing the old
  // name until the next full reload.
  function applyIdentity({ user: nextUser, token }) {
    if (token) setToken(token);
    if (nextUser) setUser(nextUser);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, applyIdentity }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
