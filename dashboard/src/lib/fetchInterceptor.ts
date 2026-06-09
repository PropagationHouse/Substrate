/**
 * fetchInterceptor — Global fetch monkey-patch for Substrate.
 *
 * MUST be imported before any module that makes fetch('/api/...') calls
 * (especially useAuth.ts which fires a module-level auth check at import time).
 *
 * 1. Rewrites relative /api/* and /ws* paths to the configured remote server URL
 *    (needed for Capacitor where the WebView origin is http://substrate.local).
 * 2. Attaches the Bearer session token to every /api/* request.
 *
 * The session token is read from a global on `window` to avoid circular imports
 * with useAuth.ts.  useAuth.ts writes to `window.__substrateSessionToken` whenever
 * the token changes.
 */

import { getServerUrl } from '@/lib/apiBase';

declare global {
  interface Window {
    __substrateSessionToken?: string;
  }
}

// Restore token from localStorage immediately so the very first fetch has it
try {
  const saved = localStorage.getItem('substrate:sessionToken');
  if (saved) window.__substrateSessionToken = saved;
} catch { /* ignore */ }

const _origFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const serverBase = getServerUrl();

  // Rewrite relative /api/ and /ws paths to remote server when configured
  if (serverBase) {
    if (typeof input === 'string') {
      if (input.startsWith('/api/') || input.startsWith('/ws') || input.startsWith('/ui/') || input.startsWith('/audio/')) {
        input = `${serverBase}${input}`;
      }
    } else if (input instanceof URL) {
      const p = input.pathname;
      if (p.startsWith('/api/') || p.startsWith('/ws') || p.startsWith('/ui/') || p.startsWith('/audio/')) {
        input = `${serverBase}${p}${input.search}`;
      }
    } else if (input instanceof Request) {
      const parsed = new URL(input.url);
      if (parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/ws') || parsed.pathname.startsWith('/ui/') || parsed.pathname.startsWith('/audio/')) {
        const newUrl = `${serverBase}${parsed.pathname}${parsed.search}`;
        input = new Request(newUrl, input);
      }
    }
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const token = window.__substrateSessionToken || '';
  if (token && (url.includes('/api/') || url.includes('/ui/'))) {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return _origFetch(input, { ...init, headers });
  }
  return _origFetch(input, init);
};
