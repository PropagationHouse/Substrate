/**
 * main.tsx — Substrate Dashboard entry point.
 *
 * Mounts the React root and wraps the app in ErrorBoundary → StrictMode → AuthGate.
 * The auth gate checks `/api/auth/status` before rendering the main app.
 * When auth is disabled or the user is authenticated, the app renders normally.
 * When auth is enabled and the user is unauthenticated, the login page is shown.
 *
 * A global fetch interceptor injects the Authorization header so every /api/*
 * call carries the session token automatically.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthGate } from '@/features/auth'
import { getSessionToken } from '@/features/auth/useAuth'

// ── Global fetch interceptor ─────────────────────────────────────────
// Automatically attaches the Bearer token to every /api/* request so
// individual fetch() call-sites don't need to handle auth headers.
const _origFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const token = getSessionToken();
  if (token && url.startsWith('/api/')) {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return _origFetch(input, { ...init, headers });
  }
  return _origFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <AuthGate />
    </StrictMode>
  </ErrorBoundary>,
)
