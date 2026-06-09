/**
 * apiBase — Resolves the backend server URL for API calls.
 * On Android (Capacitor), the app serves local HTML but needs to reach a remote server.
 * The user configures the server URL in localStorage ('substrate:serverUrl').
 * On desktop/browser, this returns '' (same-origin).
 */

const STORAGE_KEY = 'substrate:serverUrl';

export function getServerUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim().replace(/\/$/, '');
  } catch {}
  return '';
}

export function setServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/$/, ''));
  } catch {}
}

export function isCapacitor(): boolean {
  return !!(window as any).Capacitor;
}

/**
 * Patches global fetch to prefix /api/ calls with the configured server URL.
 * Call once at app startup.
 */
export function installFetchInterceptor(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const base = getServerUrl();
    if (!base) return originalFetch(input, init);

    if (typeof input === 'string') {
      if (input.startsWith('/api/') || input.startsWith('/ws')) {
        return originalFetch(`${base}${input}`, init);
      }
    } else if (input instanceof Request) {
      const url = input.url;
      // Check if it's a relative URL that was resolved to the local origin
      if (url.includes('/api/') || url.includes('/ws')) {
        const pathname = new URL(url).pathname;
        if (pathname.startsWith('/api/') || pathname.startsWith('/ws')) {
          const newUrl = `${base}${pathname}${new URL(url).search}`;
          return originalFetch(new Request(newUrl, input), init);
        }
      }
    }

    return originalFetch(input, init);
  };
}
