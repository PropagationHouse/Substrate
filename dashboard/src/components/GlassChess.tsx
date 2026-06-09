/**
 * GlassChess — Native Shadow DOM chess component for true glassmorphic transparency.
 * Embeds the full chess game (HTML + CSS + JS) inside a Shadow DOM attached to a div,
 * allowing backdrop-filter from the parent FloatingWindow to show through.
 */
import { useRef, useEffect } from 'react';
import { getServerUrl } from '@/lib/apiBase';

// We'll fetch CSS and HTML at runtime from the chess server
export function GlassChess() {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const host = hostRef.current;
    const shadow = host.attachShadow({ mode: 'open' });
    shadowRef.current = shadow;

    const baseUrl = getServerUrl();
    const chessBase = baseUrl ? `${baseUrl}/glass-chess` : '/glass-chess';

    // Unicode icons — guaranteed to render in any context including Shadow DOM
    const IC = {
      list:      '\u2630',  // ☰ hamburger/list
      flag:      '\u2691',  // ⚑ flag
      rotate:    '\u21BB',  // ↻ refresh
      brain:     '\u2609',  // ☉ analysis
      book:      '\u2261',  // ≡ book/training
      cog:       '\u2699',  // ⚙ gear
      times:     '\u2715',  // ✕ close
      bookOpen:  '\uD83D\uDCD6',  // 📖 open book
      userAstro: '\uD83E\uDDE0',  // 🧠 brain
      chartLine: '\uD83D\uDCC8',  // 📈 chart
      gradCap:   '\uD83C\uDF93',  // 🎓 grad cap
      desktop:   '\uD83D\uDDA5',  // 🖥 desktop
      cloudUp:   '\u2601',  // ☁ cloud
    };

    // Fetch chess CSS and JS in parallel
    Promise.all([
      fetch(`${chessBase}/static/style.css`).then(r => r.text()),
      fetch(`${chessBase}/static/script.js`).then(r => r.text()),
    ]).then(([css, js]) => {

      // Inject CSS — replace :root with :host for CSS variable scoping
      const styleEl = document.createElement('style');
      let scopedCss = css
        .replace(/:root\s*\{/g, ':host {')
        .replace(/html\s*\{[^}]*\}/g, '')  // remove html {} block
        .replace(/body\s*\{/, ':host {');   // body styles become :host
      // Override host to be transparent and fill container; make board responsive
      scopedCss += `
        :host {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          width: 100%;
          height: 100%;
          overflow: auto;
          background: transparent !important;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          color: #e2e8f0;
          position: relative;
          container-type: size;
        }
        #chess-shadow-container {
          container-type: size;
          overflow: visible;
        }
        #chessboard {
          width: min(85cqh, 85cqw) !important;
          height: min(85cqh, 85cqw) !important;
        }
        .square {
          font-size: min(8cqh, 8cqw) !important;
        }
        #game-container {
          gap: 10px !important;
          max-height: none;
          overflow-y: auto;
          overflow-x: hidden;
          padding-bottom: 20px;
        }
        #in-game-analysis-container {
          width: 100% !important;
        }
        #in-game-analysis-panel {
          color: var(--text-color, #e2e8f0);
        }
        #evaluation-score, #best-move-hint, #coach-advice {
          color: var(--text-color, #e2e8f0);
        }
        #best-move-hint {
          color: var(--primary-glow, rgba(99, 102, 241, 0.8));
        }
        .modal {
          position: absolute;
          inset: 0;
          z-index: 100;
          overflow-y: auto;
          align-items: flex-start;
          padding: 20px 10px;
        }
        .modal .modal-content {
          max-height: none;
          width: 95%;
          margin: auto;
        }
        .modal .modal-content.wide-modal {
          max-width: none;
          width: 98%;
        }
        .modal .modal-body {
          max-height: none;
          overflow-y: visible;
        }
        .mini-chessboard {
          width: min(380px, 45cqw, 70cqh) !important;
          height: min(380px, 45cqw, 70cqh) !important;
        }
        .presentation-split {
          grid-template-columns: 1fr 1fr;
        }
        @container (max-width: 700px) {
          .presentation-split {
            grid-template-columns: 1fr;
          }
          .mini-chessboard {
            width: min(300px, 80cqw) !important;
            height: min(300px, 80cqw) !important;
          }
        }
        .training-grid {
          grid-template-columns: 1fr 1fr;
        }
        @container (max-width: 700px) {
          .training-grid {
            grid-template-columns: 1fr;
          }
        }
      `;
      styleEl.textContent = scopedCss;
      shadow.appendChild(styleEl);

      // Inject HTML structure
      const container = document.createElement('div');
      container.id = 'chess-shadow-container';
      container.style.cssText = 'width:100%;height:100%;display:flex;justify-content:center;align-items:center;position:relative;';
      container.innerHTML = `
        <div id="background-layer"></div>
        <div id="game-container">
          <div id="controls">
            <button class="icon-btn" id="history-btn" title="Move History">${IC.list}</button>
            <button class="icon-btn" id="forfeit-btn" title="Forfeit Game">${IC.flag}</button>
            <button class="icon-btn" id="reset-btn" title="Reset Game">${IC.rotate}</button>
            <button class="icon-btn" id="in-game-analysis-btn" title="Analyze Position">${IC.brain}</button>
            <button class="icon-btn" id="training-btn" title="Training Replay">${IC.book}</button>
            <button class="icon-btn" id="settings-btn" title="Settings">${IC.cog}</button>
          </div>
          <div id="chessboard"></div>
          <div id="in-game-analysis-container">
            <div id="in-game-analysis-panel" class="glass-panel hidden">
              <div class="analysis-row">
                <div class="analysis-item">
                  <span class="label">Evaluation</span>
                  <div id="evaluation-score">0.0</div>
                </div>
                <div class="analysis-item">
                  <span class="label">Best Move Hint</span>
                  <div id="best-move-hint">-</div>
                </div>
              </div>
              <div id="evaluation-bar-container">
                <div id="evaluation-bar"></div>
              </div>
              <div class="analysis-advice">
                <span class="label">Substrate's Advice</span>
                <p id="coach-advice">I'm ready when you are.</p>
              </div>
            </div>
          </div>
          <div id="game-status-overlay" class="hidden">
            <h1 id="game-status-text">Checkmate</h1>
          </div>
        </div>

        <div id="history-modal" class="modal hidden">
          <div class="modal-content glass-panel">
            <div class="modal-header">
              <h2>Move History</h2>
              <button id="close-history" class="icon-btn">${IC.times}</button>
            </div>
            <div class="modal-body">
              <ul id="move-list"></ul>
            </div>
          </div>
        </div>

        <div id="training-modal" class="modal hidden">
          <div class="modal-content glass-panel wide-modal">
            <div class="modal-header">
              <h2>${IC.bookOpen} Post-Game & Cognitive Training</h2>
              <button id="close-training" class="icon-btn">${IC.times}</button>
            </div>
            <div class="modal-body">
              <div class="training-grid">
                <div class="training-col">
                  <div class="training-card">
                    <h3>${IC.userAstro} Cognitive Profile</h3>
                    <div id="cognitive-blindspots"></div>
                  </div>
                  <div class="training-card">
                    <h3>${IC.chartLine} Performance Metrics</h3>
                    <div class="metrics-list">
                      <div class="metric-item">
                        <span class="metric-label">Tactical Accuracy</span>
                        <div class="progress-bar-container"><div id="metric-accuracy" class="progress-bar" style="width: 0%"></div></div>
                      </div>
                      <div class="metric-item">
                        <span class="metric-label">Blunder Rate</span>
                        <div class="progress-bar-container"><div id="metric-blunders" class="progress-bar alert" style="width: 0%"></div></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="training-col">
                  <div class="training-card" style="height: 100%;">
                    <h3>${IC.gradCap} Tailored Strategy Modules</h3>
                    <div id="tailored-modules"></div>
                  </div>
                </div>
              </div>
              <div class="training-card" style="margin-top: 20px;">
                <h3>${IC.desktop} Active Chess Presentation</h3>
                <div id="active-presentation" class="presentation-container"></div>
              </div>
            </div>
          </div>
        </div>

        <div id="settings-modal" class="modal hidden">
          <div class="modal-content glass-panel">
            <div class="modal-header">
              <h2>Aesthetics</h2>
              <button id="close-settings" class="icon-btn">${IC.times}</button>
            </div>
            <div class="modal-body">
              <div class="setting-group">
                <label>Board Opacity</label>
                <input type="range" id="opacity-slider" min="0" max="100" value="40">
              </div>
              <div class="setting-group">
                <label>Glass Blur</label>
                <input type="range" id="blur-slider" min="0" max="50" value="24">
              </div>
              <div class="setting-group">
                <label>Theme</label>
                <select id="theme-select">
                  <option value="substrate">Substrate (Dark)</option>
                  <option value="neon">Neon Cyber</option>
                  <option value="minimal">Minimal Light</option>
                </select>
              </div>
              <div class="setting-group">
                <label>Custom Background</label>
                <div id="bg-dropzone" class="dropzone">
                  ${IC.cloudUp}
                  <span>Drag & Drop Image Here</span>
                </div>
                <button id="remove-bg-btn" class="secondary-btn">Remove Background</button>
              </div>
            </div>
          </div>
        </div>
      `;
      shadow.appendChild(container);

      // Inject the JS — modify it to scope to shadow root and use correct API base
      // Apply regex replacements to scope document calls to shadow root
      const patchedJs = js
        // Unwrap the DOMContentLoaded wrapper since we execute immediately
        .replace(/document\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{/, '(function() {')
        .replace(/\}\);?\s*$/, '})();')
        // Scope DOM queries to shadow root
        .replace(/document\.getElementById\(/g, '_getElementById(')
        .replace(/document\.querySelector\(/g, '_querySelector(')
        .replace(/document\.querySelectorAll\(/g, '_querySelectorAll(')
        // Touch clone goes into shadow container
        .replace(/document\.body\.appendChild/g, '_shadowContainer.appendChild')
        .replace(/document\.body\.removeAttribute/g, '_shadowContainer.removeAttribute')
        .replace(/document\.body\.setAttribute/g, '_shadowContainer.setAttribute')
        // Patch elementFromPoint to use shadow root version (critical for touch drag in shadow DOM)
        .replace(/document\.elementFromPoint\(/g, '_elementFromPoint(')
        // Scope CSS variable access to the shadow container
        .replace(/document\.documentElement/g, '_shadowContainer')
        // Replace standalone fetch( calls — use negative lookbehind to avoid _origFetch/_fetch
        .replace(/(?<![_a-zA-Z])fetch\(/g, '_fetch(');

      // Wrap in IIFE with scoped helpers
      const wrappedJs = `
(function(_shadow, _shadowContainer) {
  var _chessBase = ${JSON.stringify(chessBase)};

  // Scoped DOM queries
  var _getElementById = function(id) { return _shadow.querySelector('#' + CSS.escape(id)); };
  var _querySelector = function(sel) { return _shadow.querySelector(sel); };
  var _querySelectorAll = function(sel) { return _shadow.querySelectorAll(sel); };

  // Patched elementFromPoint — shadow DOM aware
  var _elementFromPoint = function(x, y) {
    // Try shadow root first (returns deepest element in shadow)
    if (_shadow.elementFromPoint) return _shadow.elementFromPoint(x, y);
    // Fallback: use document and check if result is within our host
    var el = document.elementFromPoint(x, y);
    if (el && _shadow.host && _shadow.host.contains(el)) return el;
    // If document returns our host, dig into composed path
    if (el === _shadow.host) {
      var evt = new MouseEvent('mousemove', {clientX: x, clientY: y});
      var nodes = _shadow.elementsFromPoint ? _shadow.elementsFromPoint(x, y) : [el];
      return nodes[0] || el;
    }
    return el;
  };

  // Patched fetch — prepend chess base URL for relative paths
  var _origFetch = window.fetch.bind(window);
  var _fetch = function(url, opts) {
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      url = _chessBase + url;
    }
    return _origFetch(url, opts);
  };

  ${patchedJs}
})(shadow, shadow.querySelector('#chess-shadow-container'));
`;

      // Execute the script via Function constructor (script tags don't execute in shadow DOM)
      try {
        const fn = new Function('shadow', wrappedJs);
        fn(shadow);
      } catch (e) {
        console.error('[GlassChess] Script execution error:', e);
      }
    }).catch(err => {
      console.error('[GlassChess] Failed to load chess assets:', err);
    });

    return () => {
      // Cleanup polling intervals if component unmounts
      // The script sets up setInterval - we'd need to track and clear it
      // For now, the shadow DOM cleanup handles most of this
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="w-full h-full"
      style={{ background: 'transparent' }}
    />
  );
}

export default GlassChess;
