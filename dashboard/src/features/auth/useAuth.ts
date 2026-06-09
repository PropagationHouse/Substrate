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
import { getServerUrl, isCapacitor } from '@/lib/apiBase';

export type AuthState = 'loading' | 'authenticated' | 'login';

/** Minimal external store so the initial auth check doesn't trigger cascading renders. */
let authSnapshot: AuthState = 'loading';
const listeners = new Set<() => void>();
function setAuthSnapshot(s: AuthState) {
  console.debug(`[useAuth] state: ${authSnapshot} → ${s}`);
  authSnapshot = s;
  listeners.forEach(l => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => authSnapshot;

// ── Session token + username storage ─────────────────────────────────
const _TOKEN_STORAGE_KEY = 'substrate:sessionToken';
let _sessionToken = '';
let _username = '';

// Restore saved token from localStorage (for Capacitor / "remember me")
try {
  const saved = localStorage.getItem(_TOKEN_STORAGE_KEY);
  if (saved) {
    _sessionToken = saved;
    window.__substrateSessionToken = saved;
  }
} catch {}

/** Get the current session token (for WS handshake and API Bearer header). */
export function getSessionToken(): string { return _sessionToken; }

/** Sync token to both module var and window global (for fetch interceptor). */
function _setToken(t: string) {
  _sessionToken = t;
  window.__substrateSessionToken = t;
}

// Fire the initial auth check once (module-level, not inside an effect)
// On Capacitor with no server URL, skip auth entirely — MobileSetupScreen will handle it.
const _hasServerUrl = !!getServerUrl();
const _isCapacitor = isCapacitor();

if (_isCapacitor && !_hasServerUrl) {
  // No server configured yet — let the app render so MobileSetupScreen can show
  setAuthSnapshot('authenticated');
} else {
  const _authAbort = new AbortController();
  const _authTimeout = setTimeout(() => _authAbort.abort(), 3000);
  fetch('/api/auth/status', { signal: _authAbort.signal })
    .then(r => r.json())
    .then(data => {
      clearTimeout(_authTimeout);
      if (data.username) _username = data.username;
      // No credentials configured → skip login
      if (!data.configured) {
        setAuthSnapshot('authenticated');
        return;
      }
      // Credentials configured — check if our saved token is still valid
      if (data.authenticated) {
        setAuthSnapshot('authenticated');
      } else if (_sessionToken) {
        // We have a saved token but server says not authenticated — token expired
        _setToken('');
        try { localStorage.removeItem(_TOKEN_STORAGE_KEY); } catch {}
        setAuthSnapshot('login');
      } else {
        setAuthSnapshot('login');
      }
    })
    .catch(() => {
      clearTimeout(_authTimeout);
      // Network error — on Capacitor always show login so user can provide credentials
      // On desktop (same-origin), if we have a token we can optimistically allow through
      if (_isCapacitor) {
        setAuthSnapshot('login');
      } else {
        setAuthSnapshot(_sessionToken ? 'authenticated' : 'login');
      }
    });
}

export function useAuth() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [error, setError] = useState('');

  const login = useCallback(async (password: string) => {
    setError('');
    try {
      // Ensure we have the correct username — re-fetch if needed
      if (!_username) {
        try {
          const statusRes = await fetch('/api/auth/status');
          const statusData = await statusRes.json();
          if (statusData.username) _username = statusData.username;
        } catch { /* proceed with fallback */ }
      }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: _username || 'admin', password }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.status === 'success' && data.token) {
        _setToken(data.token);
        if (data.username) _username = data.username;
        try { localStorage.setItem(_TOKEN_STORAGE_KEY, data.token); } catch {}
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
    _setToken('');
    try { localStorage.removeItem(_TOKEN_STORAGE_KEY); } catch {}
    setAuthSnapshot('login');
  }, []);

  return { state, error, login, logout };
}
