/**
 * GlassWorkbench — Native Shadow DOM workbench/media-suite component for true glassmorphic transparency.
 * Embeds the full Media Planning Suite (HTML + CSS + JS) inside a Shadow DOM,
 * allowing backdrop-filter from the parent FloatingWindow to show through.
 */
import { useRef, useEffect } from 'react';
import { getServerUrl } from '@/lib/apiBase';

export function GlassWorkbench() {
  const hostRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const host = hostRef.current;
    const shadow = host.attachShadow({ mode: 'open' });

    const baseUrl = getServerUrl();
    const suiteBase = baseUrl ? `${baseUrl}/media-suite` : '/media-suite';

    // Fetch CSS, JS, and HTML template from the media suite server
    Promise.all([
      fetch(`${suiteBase}/static/style.css`).then(r => r.text()),
      fetch(`${suiteBase}/static/script.js`).then(r => r.text()),
      fetch(`${suiteBase}/`).then(r => r.text()),
    ]).then(([css, js, html]) => {
      // Inject Google Fonts
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      shadow.appendChild(fontLink);

      // Inject marked.js for markdown rendering
      const markedScript = document.createElement('script');
      markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
      // Can't run scripts in shadow DOM, load it globally if not already present
      if (!window.hasOwnProperty('marked')) {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        document.head.appendChild(s);
      }

      // Inject CSS — replace :root with :host, remove body/html bg rules
      const styleEl = document.createElement('style');
      let scopedCss = css
        .replace(/:root\s*\{/g, ':host {')
        .replace(/html\s*\{[^}]*\}/g, '')
        .replace(/body\s*\{/, ':host {');
      // Override host styling and hide glass-background
      scopedCss += `
        :host {
          display: block;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          background: transparent !important;
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #ffffff;
          position: relative;
        }
        .glass-background {
          display: none !important;
        }
        .modal {
          position: absolute;
          inset: 0;
          z-index: 1000;
          display: none;
          justify-content: center;
          align-items: center;
          background: rgba(0,0,0,0.5);
        }
        .modal.active {
          display: flex;
        }
        .app-container {
          max-width: 100%;
          padding: 1rem;
        }
      `;
      styleEl.textContent = scopedCss;
      shadow.appendChild(styleEl);

      // Extract body content from HTML template
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bodyContent = doc.body.innerHTML;

      // Create container and inject HTML
      const container = document.createElement('div');
      container.id = 'workbench-shadow-container';
      container.style.cssText = 'width:100%;height:100%;overflow-y:auto;position:relative;';
      container.innerHTML = bodyContent;
      shadow.appendChild(container);

      // Patch the JS to scope to shadow root
      const patchedJs = js
        // Unwrap DOMContentLoaded
        .replace(/document\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{/, '(function() {')
        .replace(/\}\);?\s*$/, '})();')
        // The $ helper uses document.getElementById — replace with shadow-scoped version
        .replace(/const \$ = id => document\.getElementById\(id\);/, 'const $ = id => _shadow.querySelector("#" + CSS.escape(id));')
        // Scope remaining document queries (no other getElementById calls in this script)
        .replace(/document\.querySelector\(/g, '_shadow.querySelector(')
        .replace(/document\.querySelectorAll\(/g, '_shadow.querySelectorAll(')
        // Notifications and theme go on the container
        .replace(/document\.body\.appendChild/g, '_shadowContainer.appendChild')
        .replace(/document\.body\.setAttribute/g, '_shadowContainer.setAttribute')
        .replace(/document\.body\.removeAttribute/g, '_shadowContainer.removeAttribute')
        // Keep createElement on document
        // Scope CSS variable access
        .replace(/document\.documentElement/g, '_shadowContainer')
        // Replace standalone fetch calls with prefixed version (avoid matching _origFetch/_fetch)
        .replace(/(?<![_a-zA-Z])fetch\(/g, '_fetch(')
        .replace(/(?<![_a-zA-Z])fetch\(`/g, '_fetch(`');

      const fixedJs = patchedJs;

      // Wrap in IIFE with scoped helpers
      const wrappedJs = `
(function(_shadow, _shadowContainer) {
  var _suiteBase = ${JSON.stringify(suiteBase)};

  // Patched fetch — prepend media suite base URL for relative paths
  var _origFetch = window.fetch.bind(window);
  var _fetch = function(url, opts) {
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      url = _suiteBase + url;
    }
    return _origFetch(url, opts);
  };

  ${fixedJs}
})(shadow, shadow.querySelector('#workbench-shadow-container'));
`;

      // Execute
      try {
        const fn = new Function('shadow', wrappedJs);
        fn(shadow);
      } catch (e) {
        console.error('[GlassWorkbench] Script execution error:', e);
      }
    }).catch(err => {
      console.error('[GlassWorkbench] Failed to load workbench assets:', err);
    });

    return () => {};
  }, []);

  return (
    <div
      ref={hostRef}
      className="w-full h-full"
      style={{ background: 'transparent' }}
    />
  );
}

export default GlassWorkbench;
