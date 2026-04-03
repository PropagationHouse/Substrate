/**
 * useAuth — React hook for authentication state management (Substrate edition).
 *
 * Checks `/api/auth/status` on mount and provides login/logout functions.
 * When auth is disabled server-side, immediately resolves to 'authenticated'.
 *
 * Stores the session token so it can be forwarded to the WS gateway handshake
 * and used as a Bearer token on REST calls.
 */

import { useState, useCallback, useSyncExternalStore } from 'react';

export type AuthState = 'loading' | 'authenticated' | 'login';

/** Minimal external store so the initial auth check doesn't trigger cascading renders. */
let authSnapshot: AuthState = 'loading';
const listeners = new Set<() => void>();
function setAuthSnapshot(s: AuthState) {
  authSnapshot = s;
  listeners.forEach(l => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => authSnapshot;

// ── Session token + username storage ─────────────────────────────────
let _sessionToken = '';
let _username = '';

/** Get the current session token (for WS handshake and API Bearer header). */
export function getSessionToken(): string { return _sessionToken; }

// Fire the initial auth check once (module-level, not inside an effect)
fetch('/api/auth/status')
  .then(r => r.json())
  .then(data => {
    if (data.username) _username = data.username;
    setAuthSnapshot((!data.configured && !data.authEnabled) || data.authenticated ? 'authenticated' : 'login');
  })
  .catch(() => setAuthSnapshot('authenticated'));

export function useAuth() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [error, setError] = useState('');

  const login = useCallback(async (password: string) => {
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: _username || 'admin', password }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.status === 'success' && data.token) {
        _sessionToken = data.token;
        setAuthSnapshot('authenticated');
      } else {
        setError(data.message || data.error || 'Login failed');
      }
    } catch {
      setError('Unable to connect to server');
    }
  }, []);

  const logout = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (_sessionToken) headers['Authorization'] = `Bearer ${_sessionToken}`;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers,
        credentials: 'include',
      });
    } catch {
      // Ignore errors — clear local state regardless
    }
    _sessionToken = '';
    setAuthSnapshot('login');
  }, []);

  return { state, error, login, logout };
}
