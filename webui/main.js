(function(){
  const chatEl = document.getElementById('chat');
  const inputEl = document.getElementById('message');
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('status');
  
  // Smart auto-scroll: enabled by default, disabled when user scrolls up
  let _webuiAutoScroll = true;
  if (chatEl) chatEl.addEventListener('scroll', () => {
    const dist = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
    _webuiAutoScroll = dist <= 80;
  });
  function _chatScroll() {
    if (_webuiAutoScroll && chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  }
  const hostInfo = document.getElementById('hostInfo');
  const heroVideo = document.getElementById('heroVideo');
  const heroImg = document.getElementById('heroImg');

  const url = new URL(window.location.href);
  const proxyBase = url.searchParams.get('proxy') || `${window.location.protocol}//${window.location.hostname}:${window.location.port || (window.location.protocol === 'https:' ? '8766' : '8765')}`;
  try { window.proxyBase = proxyBase; } catch(_) {}
  hostInfo.textContent = `Proxy: ${proxyBase}`;

  // Ensure a reusable hidden audio element for Kokoro playback
  function ensureAudio(){
    let audio = document.getElementById('kokoro-audio');
    if (!audio){
      audio = document.createElement('audio');
      audio.id = 'kokoro-audio';
      audio.preload = 'auto';
      audio.autoplay = true; // attempt autoplay; Electron policy will allow
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
    return audio;
  }

  // Track active voice playback to avoid clearing mouth animation mid-utterance
  let voiceActive = false;

  // === TTS streaming audio playback via WebSocket ===
  let ttsAudioCtx = null;
  let ttsNextTime = 0;  // schedule time for next buffer
  let ttsWs = null;
  let ttsWsConnected = false;
  let ttsWsStreaming = false; // true only while actively receiving audio chunks

  function connectTtsStream() {
    try {
      const p = new URL(proxyBase);
      const proto = p.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${p.host}/api/tts/stream`;
      ttsWs = new WebSocket(wsUrl);
      ttsWs.binaryType = 'arraybuffer';

      ttsWs.onopen = () => {
        ttsWsConnected = true;
        console.log('[TTS-WS] Connected');
      };

      ttsWs.onmessage = (evt) => {
        if (typeof evt.data === 'string') {
          // JSON control message
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'tts_start') {
              // New utterance starting — reset audio context timing
              if (ttsAudioCtx && ttsAudioCtx.state === 'closed') ttsAudioCtx = null;
              if (!ttsAudioCtx) ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: msg.sampleRate || 24000 });
              if (ttsAudioCtx.state === 'suspended') ttsAudioCtx.resume();
              ttsNextTime = 0;
              ttsWsStreaming = true;
              console.log('[TTS-WS] Utterance start, sampleRate:', msg.sampleRate);
            } else if (msg.type === 'tts_end') {
              ttsWsStreaming = false;
              console.log('[TTS-WS] Utterance end');
            }
          } catch(_) {}
          return;
        }

        // Binary: 4-byte sampleRate (LE) + 1-byte flags + PCM int16 data
        if (evt.data instanceof ArrayBuffer && evt.data.byteLength > 5) {
          const view = new DataView(evt.data);
          const sampleRate = view.getUint32(0, true);
          const flags = view.getUint8(4);
          const pcmBytes = new Int16Array(evt.data.slice(5));

          if (!ttsAudioCtx || ttsAudioCtx.state === 'closed') {
            ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
          }
          if (ttsAudioCtx.state === 'suspended') ttsAudioCtx.resume();

          // Convert int16 to float32
          const float32 = new Float32Array(pcmBytes.length);
          for (let i = 0; i < pcmBytes.length; i++) {
            float32[i] = pcmBytes[i] / 32768.0;
          }

          // Create audio buffer and schedule playback
          const buf = ttsAudioCtx.createBuffer(1, float32.length, sampleRate);
          buf.getChannelData(0).set(float32);
          const src = ttsAudioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(ttsAudioCtx.destination);

          const now = ttsAudioCtx.currentTime;
          if (ttsNextTime < now) ttsNextTime = now;
          src.start(ttsNextTime);
          ttsNextTime += buf.duration;
        }
      };

      ttsWs.onclose = () => {
        ttsWsConnected = false;
        console.log('[TTS-WS] Disconnected, reconnecting in 3s...');
        setTimeout(connectTtsStream, 3000);
      };

      ttsWs.onerror = () => {
        ttsWsConnected = false;
      };
    } catch(e) {
      console.warn('[TTS-WS] Connection error:', e);
      setTimeout(connectTtsStream, 5000);
    }
  }
  // Connect TTS stream on page load
  connectTtsStream();

  // Remove the Send button and rely on Enter-to-send
  try { if (sendBtn && sendBtn.parentElement) sendBtn.remove(); } catch(_) {}

  // Remove deprecated Enable Sound button; we no longer require a gesture.
  let audioEnabled = true;
  let lastAudioUrl = null;
  (function removeEnableSoundButton(){
    try { const b = document.getElementById('enableSoundBtn'); if (b) b.remove(); } catch(_) {}
    // Also try again after DOM is fully ready in case templates inject it
    window.addEventListener('DOMContentLoaded', () => {
      try { const b = document.getElementById('enableSoundBtn'); if (b) b.remove(); } catch(_) {}
    });
  })();

  // Remove edit face button; long-press on main display square remains as the editor gesture
  (function removeEditFaceBtn(){
    try { const e = document.getElementById('editFaceBtn'); if (e) e.remove(); } catch(_) {}
    window.addEventListener('DOMContentLoaded', () => {
      try { const e = document.getElementById('editFaceBtn'); if (e) e.remove(); } catch(_) {}
    });
  })();

  // Instantiate desktop avatar rig if available
  let avatar = null;
  function initAvatar(){
    try {
      const container = document.getElementById('avatarContainer');
      if (!container) { console.warn('avatarContainer not found yet'); return; }
      if (avatar) return;
      if (window.AnimatedAvatar) {
        console.log('Initializing AnimatedAvatar in WebUI');
        avatar = new AnimatedAvatar('avatarContainer');
        console.log('AnimatedAvatar initialized');
        // Ensure hero-specific styling is applied
        if (avatar.avatarEl) {
          // Force perspective and visibility on container so 3D is visible everywhere
          try {
            container.style.perspective = '900px';
            container.style.overflow = 'visible';
            container.style.transformStyle = 'preserve-3d';
          } catch(_) {}
          // Create a dedicated parallax wrapper to avoid conflicts with face transforms
          try {
            const faceEl = avatar.avatarEl;
            const parent = faceEl.parentElement;
            if (parent && !document.getElementById('avatarParallaxWrap')){
              const wrap = document.createElement('div');
              wrap.id = 'avatarParallaxWrap';
              wrap.style.cssText = 'position:relative;display:inline-block;transform-style:preserve-3d;will-change:transform;';
              parent.insertBefore(wrap, faceEl);
              wrap.appendChild(faceEl);
              try { wrap.style.transformOrigin = '50% 50%'; } catch(_) {}
            }
          } catch(_) {}

          // Face element references for styling and interactions
          const faceEl = avatar.avatarEl;
          faceEl.classList.add('hero-face');
          // Allow pointer events so long-press/click works, but suppress drag unless Ctrl is held
          faceEl.style.pointerEvents = 'auto';
          const suppressDrag = (e) => {
            if (faceEl.classList && faceEl.classList.contains('editor-active')) return; // allow full interaction while editing
            if (!e.ctrlKey) { e.stopImmediatePropagation(); e.preventDefault(); }
          };
          faceEl.addEventListener('mousedown', suppressDrag, true);
          faceEl.addEventListener('touchstart', suppressDrag, true);
          // Observe for re-renders that detach the wrapper; re-wrap if needed
          try {
            const obs = new MutationObserver(() => {
              try {
                const el = avatar && avatar.avatarEl;
                if (!el) return;
                const wrap = document.getElementById('avatarParallaxWrap');
                if (!wrap || el.parentElement !== wrap) {
                  const parent = el.parentElement;
                  if (parent) {
                    const w = wrap || document.createElement('div');
                    if (!wrap) {
                      w.id = 'avatarParallaxWrap';
                      w.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;transform-style:preserve-3d;will-change:transform;transform-origin:50% 50%';
                    }
                    parent.insertBefore(w, el);
                    w.appendChild(el);
                  }
                }
              } catch(_) {}
            });
            obs.observe(container, { childList: true, subtree: true });
          } catch(_) {}
        }
        // Ensure avatar is inside the hero container
        forceReparentToContainer();

  // If still effectively invisible, inject a simple fallback face
  function ensureVisibleOrFallback(){
    try {
      const container = document.getElementById('avatarContainer');
      if (!container) return;
      const existing = container.querySelector('.animated-avatar');
      if (existing){
        const r = existing.getBoundingClientRect();
        const tooSmall = (r.width < 40 || r.height < 40);
        if (!tooSmall) return; // visible enough
      }
      // inject a visible, simple fallback
      const existsFallback = container.querySelector('[data-fallback-face]');
      if (existsFallback) return;
      console.warn('Injecting fallback face (avatar too small/offscreen)');
      const root = document.createElement('div');
      root.dataset.fallbackFace = '1';
      root.style.cssText = 'position:relative;width:96%;aspect-ratio:1/1;background:#a8e4f3;border-radius:16px;border:2px solid #5bbfdd;z-index:3;';
      const eye = (side) => {
        const e = document.createElement('div');
        e.style.cssText = 'position:absolute;width:64px;height:64px;border-radius:50%;background:#000;top:28%;';
        const glint = document.createElement('div');
        glint.style.cssText = 'position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;top:18%;left:18%;';
        e.appendChild(glint);
        if (side === 'left') e.style.left = '22%'; else e.style.right = '22%';
        return e;
      };
      const cheek = (side) => {
        const c = document.createElement('div');
        c.style.cssText = 'position:absolute;width:36px;height:36px;border-radius:50%;background:#ffb6c1;top:56%;';
        if (side === 'left') c.style.left = '24%'; else c.style.right = '24%';
        return c;
      };
      const mouth = document.createElement('div');
      mouth.style.cssText = 'position:absolute;width:46%;height:18px;left:50%;top:66%;transform:translateX(-50%);border-radius:0 0 14px 14px;background:#ff6b6b;border:3px solid #c83333;border-top:none;';
      root.appendChild(eye('left'));
      root.appendChild(eye('right'));
      root.appendChild(cheek('left'));
      root.appendChild(cheek('right'));
      root.appendChild(mouth);
      container.appendChild(root);
    } catch(e){ console.warn('ensureVisibleOrFallback error', e); }
  }

  // If avatar rect is off-canvas or too small, reset layout to fit hero square
  function recenterAvatar(){
    try {
      if (!avatar || !avatar.avatarEl) return;
      const el = avatar.avatarEl;
      const container = document.getElementById('avatarContainer');
      if (!container) return;
      const cr = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const offscreen = (r.width < 10 || r.height < 10 || r.right < cr.left + 4 || r.bottom < cr.top + 4 || r.left > cr.right - 4 || r.top > cr.bottom - 4);
      if (offscreen) {
        console.warn('Avatar offscreen on mobile; applying recenter fallback');
        // Reset transforms and offsets, size to fit, keep centered via flex
        el.style.position = 'relative';
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = 'none';
        el.style.width = '96%';
        el.style.height = '96%';
        el.style.margin = '0 auto';
        el.style.animation = 'none';
        el.classList.add('hero-face');
        // Ensure inner face panel is centered and visible
        const s = el.style;
        s.setProperty('--face-width', s.getPropertyValue('--face-width') || '82%');
        s.setProperty('--face-height', s.getPropertyValue('--face-height') || '55%');
        s.setProperty('--left-eye-top', s.getPropertyValue('--left-eye-top') || '20%');
        s.setProperty('--right-eye-top', s.getPropertyValue('--right-eye-top') || '20%');
        s.setProperty('--left-eye-left', s.getPropertyValue('--left-eye-left') || '30%');
        s.setProperty('--right-eye-right', s.getPropertyValue('--right-eye-right') || '30%');
        s.setProperty('--mouth-top', s.getPropertyValue('--mouth-top') || '60%');
        s.setProperty('--eye-width', s.getPropertyValue('--eye-width') || '48px');
        s.setProperty('--eye-height', s.getPropertyValue('--eye-height') || '48px');
        s.setProperty('--mouth-width', s.getPropertyValue('--mouth-width') || '90px');
        s.setProperty('--mouth-height', s.getPropertyValue('--mouth-height') || '6px');
        // Re-apply server config after fallback sizing
        applyFaceConfigFromServer();
      }
    } catch(e){ console.warn('recenterAvatar error', e); }
  }
        // After init, pull exact face config from backend and apply
        applyFaceConfigFromServer();
        // Mobile safety: ensure core facial elements exist (some mobile browsers may skip initial child renders)
        setTimeout(() => { ensureFaceElements(); recenterAvatar(); ensureVisibleOrFallback(); startCenterLock(); forceReparentToContainer(); }, 450);
        // Re-apply face config on resize (Flip phone open/close, rotation, etc.)
        let _resizeTimer = null;
        window.addEventListener('resize', () => {
          clearTimeout(_resizeTimer);
          _resizeTimer = setTimeout(() => applyFaceConfigFromServer(), 200);
        });
        // Long-press to open editor (simulate Ctrl+click the editor listens for)
        try {
          const targetEl = avatar.avatarEl;
          let holdTimer = null;
          let moved = false;
          const start = (e) => {
            moved = false;
            holdTimer = setTimeout(() => {
              const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
              targetEl.dispatchEvent(evt);
            }, 650);
          };
          const move = () => { moved = true; if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
          const end = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
          targetEl.addEventListener('mousedown', start);
          targetEl.addEventListener('touchstart', start);
          targetEl.addEventListener('mousemove', move);
          targetEl.addEventListener('touchmove', move);
          ['mouseup','mouseleave','touchend','touchcancel'].forEach(t=> targetEl.addEventListener(t, end));
        } catch(_) {}
        // Edit button to open editor directly
        try {
          const btn = document.getElementById('editFaceBtn');
          if (btn && avatar.avatarEl){
            // Ensure button is clickable above overlays
            btn.style.zIndex = '10001';
            btn.style.pointerEvents = 'auto';
            btn.addEventListener('click', () => {
              const openNow = () => {
                if (window.avatarEditor && typeof window.avatarEditor.toggleEditor === 'function') {
                  window.avatarEditor.toggleEditor();
                  return true;
                }
                if (typeof window.openAvatarEditor === 'function') {
                  window.openAvatarEditor();
                  return true;
                }
                return false;
              };
              // Try immediately
              if (openNow()) return;
              // Lazy-init if editor not present
              try {
                if (window.AvatarEditor) {
                  const ed = new window.AvatarEditor();
                  ed.init();
                  window.avatarEditor = ed;
                  setTimeout(() => { openNow() || null; }, 50);
                  return;
                }
              } catch(_) {}
              // Fallback: synthetic Ctrl+click the avatar (used by older editor detection)
              const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
              avatar.avatarEl.dispatchEvent(evt);
              // Final fallback: post a window message that avatar-editor.js listens for
              try { window.postMessage('OPEN_AVATAR_EDITOR', '*'); } catch(_) {}
              setTimeout(() => { try { window.postMessage('OPEN_AVATAR_EDITOR', '*'); } catch(_) {} }, 100);
            });
            // Mobile touch fallback
            const touchOpen = (e) => {
              try { e.stopPropagation(); e.stopImmediatePropagation(); } catch(_) {}
              try { e.preventDefault(); } catch(_) {}
              // Mirror click behavior
              const openNow = () => {
                if (window.avatarEditor && typeof window.avatarEditor.toggleEditor === 'function') { window.avatarEditor.toggleEditor(); return true; }
                if (typeof window.openAvatarEditor === 'function') { window.openAvatarEditor(); return true; }
                return false;
              };
              if (openNow()) return;
              try {
                if (window.AvatarEditor) {
                  const ed = new window.AvatarEditor(); ed.init(); window.avatarEditor = ed;
                  setTimeout(() => { openNow() || null; }, 50);
                  return;
                }
              } catch(_) {}
              const evt = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
              avatar.avatarEl.dispatchEvent(evt);
              try { window.postMessage('OPEN_AVATAR_EDITOR', '*'); } catch(_) {}
              setTimeout(() => { try { window.postMessage('OPEN_AVATAR_EDITOR', '*'); } catch(_) {} }, 100);
            };
            btn.addEventListener('touchend', touchOpen, { passive: false });
            btn.addEventListener('touchstart', (e) => { try { e.stopPropagation(); } catch(_) {} }, { passive: true, capture: true });
            // Global fallback: message bus
            window.addEventListener('message', (ev) => {
              if (ev && ev.data === 'OPEN_AVATAR_EDITOR') {
                if (window.avatarEditor && typeof window.avatarEditor.toggleEditor === 'function') window.avatarEditor.toggleEditor();
              }
            });
          }
        } catch(_) {}
        // Face-only mode: disable roaming/behaviors and fix layout
        try {
          avatar.autonomousMovementEnabled = false;
          avatar.isAnimating = false;
          // Clear running intervals if any
          if (avatar.clearAnimations) avatar.clearAnimations(true);
          const intervals = ['_autonomousMovementInterval','mouthAnimationInterval','armWavingInterval','colorTransitionInterval'];
          intervals.forEach(k => { if (avatar[k]) { clearInterval(avatar[k]); avatar[k] = null; }});
          // Remove mouse tracking if set up
          if (avatar.trackCursor) document.removeEventListener('mousemove', avatar.trackCursor);
          // Apply CSS vars to center eyes/mouth in the square
          if (avatar.avatarEl && avatar.avatarEl.style){
            const el = avatar.avatarEl;
            el.style.setProperty('--face-width', '88%');
            el.style.setProperty('--face-height', '78%');
            el.style.setProperty('--eye-width', '20px');
            el.style.setProperty('--eye-height', '20px');
            el.style.setProperty('--left-eye-top', '34%');
            el.style.setProperty('--right-eye-top', '34%');
            el.style.setProperty('--left-eye-left', '32%');
            el.style.setProperty('--right-eye-right', '32%');
            el.style.setProperty('--mouth-top', '60%');
            el.style.setProperty('--mouth-width', '26px');
            el.style.setProperty('--mouth-height', '6px');
          }
          // Remove placeholder if present
          const container = document.getElementById('avatarContainer');
          if (container){
            const children = Array.from(container.children);
            children.forEach(node => {
              if (!node.classList || !node.classList.contains('animated-avatar')){
                // remove simple placeholder shapes
                container.removeChild(node);
              }
            });
          }
          // Initial theme sync from computed colors
          try {
            const el = avatar.avatarEl;
            const bodyC = getComputedStyle(el).getPropertyValue('--avatar-body-color').trim() || '#5bbfdd';
            const faceC = getComputedStyle(el).getPropertyValue('--avatar-face-color').trim() || '#a8e4f3';
            syncUiThemeColors(bodyC, faceC);
          } catch(_) {}
          // Enable Android gyroscope parallax
          enableGyroParallax();
        } catch (e) { console.warn('Face-only setup warning', e); }
      } else {
        console.warn('AnimatedAvatar not found on window');
      }
    } catch (e) { console.error('Avatar init error', e); }
  }
  // Try immediate, then on DOM ready
  initAvatar();
  window.addEventListener('DOMContentLoaded', initAvatar);
  // Fallback: if avatar not present shortly after load, inject placeholder to verify layering
  setTimeout(() => {
    const container = document.getElementById('avatarContainer');
    const exists = container && (container.querySelector('.animated-avatar') || container.querySelector('[data-fallback-face]'));
    if (!exists && container){
      console.warn('AnimatedAvatar not present; injecting fallback face');
      const root = document.createElement('div');
      root.dataset.fallbackFace = '1';
      root.style.cssText = 'position:relative;width:96%;aspect-ratio:1/1;background:#a8e4f3;border-radius:16px;border:2px solid #5bbfdd;';
      const eye = (side) => {
        const e = document.createElement('div');
        e.style.cssText = 'position:absolute;width:72px;height:72px;border-radius:50%;background:#000;top:28%;';
        const glint = document.createElement('div');
        glint.style.cssText = 'position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:18%;left:18%;';
        e.appendChild(glint);
        if (side === 'left') e.style.left = '22%'; else e.style.right = '22%';
        return e;
      };
      const cheek = (side) => {
        const c = document.createElement('div');
        c.style.cssText = 'position:absolute;width:44px;height:44px;border-radius:50%;background:#ffb6c1;top:56%;';
        if (side === 'left') c.style.left = '24%'; else c.style.right = '24%';
        return c;
      };
      const mouth = document.createElement('div');
      mouth.id = 'fallbackMouth';
      mouth.style.cssText = 'position:absolute;width:46%;height:24px;left:50%;top:66%;transform:translateX(-50%);border-radius:0 0 14px 14px;background:#ff6b6b;border:3px solid #c83333;border-top:none;';
      root.appendChild(eye('left'));
      root.appendChild(eye('right'));
      root.appendChild(cheek('left'));
      root.appendChild(cheek('right'));
      root.appendChild(mouth);
      container.appendChild(root);
    }
  }, 800);

  // Avatar media helpers (no-op since hero media removed)
  function refreshAvatar(){
    return; // background disabled in hero
  }
  refreshAvatar();
  // Periodic refresh in case avatar file changes outside of config events
  setInterval(refreshAvatar, 5 * 60 * 1000);

  // Ensure eyes/mouth/cheeks exist even if initial render was skipped
  function ensureFaceElements(){
    try {
      if (!avatar || !avatar.avatarEl) return;
      const el = avatar.avatarEl;
      const need = (sel) => !el.querySelector(sel);
      const mk = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
      if (need('.left-eye')) { const n = mk('eye left-eye'); el.appendChild(n); }
      if (need('.right-eye')) { const n = mk('eye right-eye'); el.appendChild(n); }
      if (need('.mouth')) { const n = mk('mouth'); el.appendChild(n); }
      if (need('.left-cheek')) { const n = mk('left-cheek'); el.appendChild(n); }
      if (need('.right-cheek')) { const n = mk('right-cheek'); el.appendChild(n); }
      // Apply basic defaults if CSS vars not present
      const s = el.style;
      if (!getComputedStyle(el).getPropertyValue('--face-width')) s.setProperty('--face-width', '78%');
      if (!getComputedStyle(el).getPropertyValue('--face-height')) s.setProperty('--face-height', '68%');
      if (!getComputedStyle(el).getPropertyValue('--left-eye-top')) s.setProperty('--left-eye-top', '34%');
      if (!getComputedStyle(el).getPropertyValue('--right-eye-top')) s.setProperty('--right-eye-top', '34%');
      if (!getComputedStyle(el).getPropertyValue('--left-eye-left')) s.setProperty('--left-eye-left', '32%');
      if (!getComputedStyle(el).getPropertyValue('--right-eye-right')) s.setProperty('--right-eye-right', '32%');
      if (!getComputedStyle(el).getPropertyValue('--mouth-top')) s.setProperty('--mouth-top', '60%');
      if (!getComputedStyle(el).getPropertyValue('--eye-width')) s.setProperty('--eye-width', '20px');
      if (!getComputedStyle(el).getPropertyValue('--eye-height')) s.setProperty('--eye-height', '20px');
      if (!getComputedStyle(el).getPropertyValue('--mouth-width')) s.setProperty('--mouth-width', '26px');
      if (!getComputedStyle(el).getPropertyValue('--mouth-height')) s.setProperty('--mouth-height', '6px');
    } catch(e){ console.warn('ensureFaceElements error', e); }
  }

  // === Exact face config sync ===
  // Intercept editor saves to push to backend
  try {
    const _origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k, v){
      _origSetItem(k, v);
      if (k === 'avatarConfig'){
        fetch(`${proxyBase}/ui/face-config`, { method:'POST', headers:{'Content-Type':'application/json'}, body: v }).catch(()=>{});
        // Re-apply immediately
        try { const cfg = JSON.parse(v); if (cfg) applyFaceConfig(cfg); } catch(_) {}
      }
    };
  } catch(_) {}

  async function applyFaceConfigFromServer(){
    try {
      const res = await fetch(`${proxyBase}/ui/face-config`);
      if (!res.ok) return;
      const cfg = await res.json();
      if (!cfg || !avatar || !avatar.avatarEl) return;
      applyFaceConfig(cfg);
      // Sync theme with body/face color from config if present
      try {
        const bodyColor = (cfg.body && cfg.body.color) ? cfg.body.color : getComputedStyle(avatar.avatarEl).getPropertyValue('--avatar-body-color').trim() || '#5bbfdd';
        const faceColor = (cfg.face && cfg.face.color) ? cfg.face.color : getComputedStyle(avatar.avatarEl).getPropertyValue('--avatar-face-color').trim() || '#a8e4f3';
        syncUiThemeColors(bodyColor, faceColor);
      } catch(_) {}
    } catch(e){ console.warn('face-config fetch failed', e); }
  }

  // Compute the actual avatar size from viewport dimensions (matches CSS: min(92vmin, 860px))
  function getAvatarSize() {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    return Math.min(vmin * 0.92, 860);
  }

  // Scale a px value string proportionally to the current avatar size.
  // face_config px values were authored at REF_SIZE (~520px avatar).
  const REF_AVATAR_SIZE = 520;
  function scalePxVal(val, factor) {
    if (!val) return val;
    const s = String(val);
    if (s.endsWith('%')) return s; // percentages don't need scaling
    const n = parseFloat(s);
    if (isNaN(n)) return s;
    return Math.round(n * factor) + 'px';
  }

  function applyFaceConfig(cfg){
    try {
      const el = avatar && avatar.avatarEl;
      if (!el) return;
      // Skip if face editor panel is currently open — editor has control
      const fePanel = document.getElementById('faceEditorPanel');
      if (fePanel && fePanel.style.display !== 'none') return;

      // Responsive scale factor based on viewport (always available, no layout timing issues)
      const avatarSize = getAvatarSize();
      const sf = Math.min(1, avatarSize / REF_AVATAR_SIZE); // never scale UP, only down
      const sp = (v) => scalePxVal(v, sf);

      // CSS vars (scaled)
      if (cfg.leftEye){
        if (cfg.leftEye.width) el.style.setProperty('--eye-width', sp(cfg.leftEye.width));
        if (cfg.leftEye.height) el.style.setProperty('--eye-height', sp(cfg.leftEye.height));
        if (cfg.leftEye.top) el.style.setProperty('--left-eye-top', cfg.leftEye.top);
        if (cfg.leftEye.left) el.style.setProperty('--left-eye-left', cfg.leftEye.left);
      }
      if (cfg.rightEye){
        if (cfg.rightEye.top) el.style.setProperty('--right-eye-top', cfg.rightEye.top);
        if (cfg.rightEye.right) el.style.setProperty('--right-eye-right', cfg.rightEye.right);
      }
      if (cfg.mouth){
        if (cfg.mouth.top) el.style.setProperty('--mouth-top', cfg.mouth.top);
        if (cfg.mouth.width) el.style.setProperty('--mouth-width', sp(cfg.mouth.width));
        if (cfg.mouth.height) el.style.setProperty('--mouth-height', sp(cfg.mouth.height));
      }
      if (cfg.face){
        if (cfg.face.width) el.style.setProperty('--face-width', cfg.face.width);
        if (cfg.face.height) el.style.setProperty('--face-height', cfg.face.height);
        if (cfg.face.color) el.style.setProperty('--avatar-face-color', cfg.face.color);
      }
      if (cfg.body && cfg.body.color){
        el.style.setProperty('--avatar-body-color', cfg.body.color);
      }

      // ALL element properties use setProperty with 'important' + responsive scaling
      const le = el.querySelector('.left-eye');
      const re = el.querySelector('.right-eye');
      const mo = el.querySelector('.mouth');
      const lc = el.querySelector('.left-cheek');
      const rc = el.querySelector('.right-cheek') || (function(){
        const r = document.createElement('div'); r.className = 'right-cheek'; el.appendChild(r); return r; })();

      if (le && cfg.leftEye) {
        if (cfg.leftEye.width) le.style.setProperty('width', sp(cfg.leftEye.width), 'important');
        if (cfg.leftEye.height) le.style.setProperty('height', sp(cfg.leftEye.height), 'important');
        if (cfg.leftEye.top) le.style.setProperty('top', cfg.leftEye.top, 'important');
        if (cfg.leftEye.left) le.style.setProperty('left', cfg.leftEye.left, 'important');
      }
      if (re && cfg.rightEye) {
        if (cfg.rightEye.width) re.style.setProperty('width', sp(cfg.rightEye.width), 'important');
        if (cfg.rightEye.height || (cfg.leftEye && cfg.leftEye.height)) re.style.setProperty('height', sp(cfg.rightEye.height || cfg.leftEye.height), 'important');
        if (cfg.rightEye.top) re.style.setProperty('top', cfg.rightEye.top, 'important');
        if (cfg.rightEye.right) re.style.setProperty('right', cfg.rightEye.right, 'important');
      }
      if (mo && cfg.mouth) {
        if (cfg.mouth.width) mo.style.setProperty('width', sp(cfg.mouth.width), 'important');
        if (cfg.mouth.height) mo.style.setProperty('height', sp(cfg.mouth.height), 'important');
        if (cfg.mouth.top) mo.style.setProperty('top', cfg.mouth.top, 'important');
      }
      if (lc && cfg.leftCheek){
        if (cfg.leftCheek.width) lc.style.setProperty('width', sp(cfg.leftCheek.width), 'important');
        if (cfg.leftCheek.height) lc.style.setProperty('height', sp(cfg.leftCheek.height), 'important');
        if (cfg.leftCheek.top) lc.style.setProperty('top', cfg.leftCheek.top, 'important');
        if (cfg.leftCheek.left) lc.style.setProperty('left', cfg.leftCheek.left, 'important');
        lc.style.position = 'absolute'; lc.style.borderRadius = '50%'; lc.style.backgroundColor = '#ffb6c1'; lc.style.zIndex = '15';
      }
      if (rc && cfg.rightCheek){
        if (cfg.rightCheek.width) rc.style.setProperty('width', sp(cfg.rightCheek.width), 'important');
        if (cfg.rightCheek.height) rc.style.setProperty('height', sp(cfg.rightCheek.height), 'important');
        if (cfg.rightCheek.top) rc.style.setProperty('top', cfg.rightCheek.top, 'important');
        if (cfg.rightCheek.right) rc.style.setProperty('right', cfg.rightCheek.right, 'important');
        rc.style.position = 'absolute'; rc.style.borderRadius = '50%'; rc.style.backgroundColor = '#ffb6c1'; rc.style.zIndex = '15';
      }

      // Faceplate ::before
      let feStyle = document.getElementById('fe-override-style');
      if (!feStyle) { feStyle = document.createElement('style'); feStyle.id = 'fe-override-style'; document.head.appendChild(feStyle); }
      feStyle.textContent = `
        #avatarContainer .animated-avatar::before {
          top: ${cfg.face ? cfg.face.top || '30%' : '30%'} !important;
          width: ${cfg.face ? cfg.face.width || '82%' : '82%'} !important;
          height: ${cfg.face ? cfg.face.height || '55%' : '55%'} !important;
        }
      `;
      console.log('Applied face-config to WebUI (scale=' + sf.toFixed(2) + ', avatarSize=' + Math.round(avatarSize) + 'px, vmin=' + Math.min(window.innerWidth, window.innerHeight) + ')');
    } catch(e){ console.warn('applyFaceConfig error', e); }
  }

  // Sync the UI theme to the avatar body/face colors
  function syncUiThemeColors(bodyColor, faceColor){
    try {
      const root = document.documentElement;
      const b = document.body;
      if (bodyColor) {
        root.style.setProperty('--avatar-body-color', bodyColor);
        b.style.backgroundColor = bodyColor; // smooth via CSS transition
      }
      if (faceColor) {
        root.style.setProperty('--avatar-face-color', faceColor);
      }
    } catch(e){ console.warn('syncUiThemeColors error', e); }
  }

  // UI state sync — poll the backend for the desktop avatar's current color + expression
  (function startUiSync(){
    let lastBody = '', lastFace = '', lastExpr = '';
    setInterval(async () => {
      try {
        const res = await fetch(`${proxyBase}/api/ui/color`);
        if (!res.ok) return;
        const c = await res.json();
        // Color sync
        if (c.body && (c.body !== lastBody || c.face !== lastFace)) {
          lastBody = c.body; lastFace = c.face;
          const root = document.documentElement;
          root.style.setProperty('--avatar-body-color', c.body);
          root.style.setProperty('--avatar-face-color', c.face);
          document.body.style.backgroundColor = c.body;
          if (avatar && avatar.avatarEl) {
            avatar.avatarEl.style.setProperty('--avatar-body-color', c.body);
            avatar.avatarEl.style.setProperty('--avatar-face-color', c.face);
          }
        }
        // Expression sync
        if (c.expression && c.expression !== lastExpr && avatar) {
          lastExpr = c.expression;
          const expr = c.expression;
          if (expr === 'idle' || expr === 'talking' || expr === 'thinking') {
            if (avatar.state !== expr) avatar.setState(expr);
          } else if (avatar.showEmotion) {
            avatar.showEmotion(expr, 2000);
          }
        }
      } catch(_){}
    }, 500);
  })();

  function tightenFaceLayout(){
    // Disabled — face editor / face-config is now the single source of truth for sizing.
  }

  // === SVG Avatar animation control ===
  const eyeL = document.getElementById('eyeL');
  const eyeR = document.getElementById('eyeR');
  const pupilL = document.getElementById('pupilL');
  const pupilR = document.getElementById('pupilR');
  const mouth = document.getElementById('mouth');
  let avatarState = 'idle';
  let talkTimer = null;
  let thinkTimer = null;
  let blinkTimer = null;

  function clearTimers(){
    if (talkTimer) { clearInterval(talkTimer); talkTimer = null; }
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
  }
  function setEyes(open){
    if (!eyeL || !eyeR) return;
    const ry = open ? 12 : 1.2;
    eyeL.setAttribute('ry', ry);
    eyeR.setAttribute('ry', ry);
  }
  function setMouth(height){
    if (!mouth) return;
    const h = Math.max(2, Math.min(24, height));
    mouth.setAttribute('height', h);
    // keep mouth vertically centered around y=78 baseline
    const baseY = 78; // original top
    mouth.setAttribute('y', baseY - (h - 6) / 2);
  }
  function centerPupils(dx, dy){
    if (!pupilL || !pupilR) return;
    const baseLX = 70, baseLY = 55;
    const baseRX = 130, baseRY = 55;
    pupilL.setAttribute('cx', baseLX + (dx||0));
    pupilL.setAttribute('cy', baseLY + (dy||0));
    pupilR.setAttribute('cx', baseRX + (dx||0));
    pupilR.setAttribute('cy', baseRY + (dy||0));
  }
  function blinkOnce(){
    if (!eyeL) return;
    setEyes(false);
    setTimeout(() => setEyes(true), 120);
  }
  function ensureBlinkLoop(){
    if (blinkTimer) return;
    blinkTimer = setInterval(() => {
      // randomize blink timing a bit
      blinkOnce();
    }, 3200);
  }
  ensureBlinkLoop();

  // Helper: element we actually transform for parallax/drift
  function getParallaxEl(){
    return document.getElementById('avatarParallaxWrap') || (avatar && avatar.avatarEl);
  }

  // Mobile gyroscope/touch parallax for the avatar face (works outside Flask too)
  function enableGyroParallax(){
    try {
      // Run on any environment where the avatar exists (Samsung Internet/Chrome/etc.)
      if (!avatar || !avatar.avatarEl) return;
      // Smoothing state
      let rx = 0, ry = 0, tx = 0, ty = 0;
      let targetRx = 0, targetRy = 0, targetTx = 0, targetTy = 0;
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const lerp = (a, b, t) => a + (b - a) * t;
      const update = () => {
        const el = getParallaxEl();
        rx = lerp(rx, targetRx, 0.34);
        ry = lerp(ry, targetRy, 0.34);
        tx = lerp(tx, targetTx, 0.34);
        ty = lerp(ty, targetTy, 0.34);
        const z = (Math.abs(rx) + Math.abs(ry)) * 0.9; // stronger depth pop
        const rz = clamp(ry * 0.20, -6, 6); // a bit of roll for drama
        if (el) el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) translate3d(${tx}px, ${ty}px, ${z}px) scale(1.05)`;
        // Clear inner face transform to avoid conflicts
        try { if (avatar && avatar.avatarEl) avatar.avatarEl.style.transform = ''; } catch(_) {}
        requestAnimationFrame(update);
      };
      const handle = (e) => {
        // Android: beta (front-back), gamma (left-right)
        const beta = (typeof e.beta === 'number') ? e.beta : 0;   // [-180, 180]
        const gamma = (typeof e.gamma === 'number') ? e.gamma : 0; // [-90, 90]
        const maxTilt = 35;
        targetRx = clamp(beta * -0.90, -maxTilt, maxTilt);
        targetRy = clamp(gamma * 1.60, -maxTilt, maxTilt);
        // much stronger xy parallax
        targetTx = clamp(gamma * -3.0, -40, 40);
        targetTy = clamp(beta * 2.4, -40, 40);
      };
      let gotOrientation = false;
      let gotMotion = false;
      // Mark sensor activity to pause idle drift only while sensors are active
      let lastSensorTs = 0;
      const markSensor = () => { lastSensorTs = Date.now(); };
      const onOrientation = (e) => { gotOrientation = true; markSensor(); handle(e); try { updateHud('orientation', e.beta, e.gamma); } catch(_) {} };
      // Add with capture and non-capture for broader compat
      window.addEventListener('deviceorientation', onOrientation, true);
      window.addEventListener('deviceorientation', onOrientation, false);
      // Some Androids only emit absolute events
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
      window.addEventListener('deviceorientationabsolute', onOrientation, false);

      // Also listen to devicemotion immediately (some browsers only emit this)
      try {
        const motionHandler = (ev) => {
          gotMotion = true; markSensor();
          const acc = ev.accelerationIncludingGravity || ev.acceleration || {};
          const ax = typeof acc.x === 'number' ? acc.x : 0;
          const ay = typeof acc.y === 'number' ? acc.y : 0;
          const az = typeof acc.z === 'number' ? acc.z : 0;
          const toDeg = (r) => (r * 180) / Math.PI;
          const betaEst = toDeg(Math.atan2(-ax, Math.hypot(ay, az)));   // front-back
          const gammaEst = toDeg(Math.atan2(ay, az));                    // left-right
          const maxTilt = 35;
          targetRx = clamp(betaEst * -0.90, -maxTilt, maxTilt);
          targetRy = clamp(gammaEst * 1.60, -maxTilt, maxTilt);
          targetTx = clamp(gammaEst * -3.0, -40, 40);
          targetTy = clamp(betaEst * 2.4, -40, 40);
          try { updateHud('motion', betaEst, gammaEst); } catch(_) {}
        };
        window.addEventListener('devicemotion', motionHandler, true);
        window.addEventListener('devicemotion', motionHandler, false);
      } catch(_) {}

      // Generic Sensor API fallback (secure-context only; harmless if unavailable)
      try {
        if ('Gyroscope' in window) {
          const gyro = new Gyroscope({ frequency: 30 });
          gyro.addEventListener('reading', () => {
            // Integrate small deltas into targets for visible motion
            const gY = gyro.y || 0; // pitch
            const gX = gyro.x || 0; // roll
            const maxTilt = 35;
            targetRx = clamp(targetRx + (-gY * 0.6), -maxTilt, maxTilt);
            targetRy = clamp(targetRy + (gX * 0.6), -maxTilt, maxTilt);
          });
          gyro.start();
        }
      } catch(_) {}

      // Re-attach on orientation/visibility changes (some browsers pause sensors)
      const rearm = () => {
        try {
          window.removeEventListener('deviceorientation', onOrientation, true);
          window.removeEventListener('deviceorientation', onOrientation, false);
          window.removeEventListener('deviceorientationabsolute', onOrientation, true);
          window.removeEventListener('deviceorientationabsolute', onOrientation, false);
        } catch(_) {}
        try {
          window.addEventListener('deviceorientation', onOrientation, true);
          window.addEventListener('deviceorientation', onOrientation, false);
          window.addEventListener('deviceorientationabsolute', onOrientation, true);
          window.addEventListener('deviceorientationabsolute', onOrientation, false);
        } catch(_) {}
      };
      window.addEventListener('orientationchange', rearm, { passive: true });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) rearm(); });

      // Kick off animation loop
      requestAnimationFrame(update);

      // Try permission (mostly iOS, harmless on Android)
      try {
        if (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission === 'function') {
          window.addEventListener('touchend', async function askPermOnce(){
            try { await window.DeviceMotionEvent.requestPermission(); } catch(_) {}
            window.removeEventListener('touchend', askPermOnce, true);
          }, true);
        }
      } catch(_) {}

      // Touch-drag fallback if sensors don't fire quickly: map finger drag to parallax
      setTimeout(() => {
        if (!gotOrientation && !gotMotion) {
          const area = document.getElementById('avatarContainer') || document.body;
          let dragging = false; let lastX = 0, lastY = 0;
          const start = (e) => { dragging = true; const t = (e.touches && e.touches[0]) || e; lastX = t.clientX; lastY = t.clientY; };
          const move = (e) => {
            if (!dragging) return; const t = (e.touches && e.touches[0]) || e;
            const dx = (t.clientX - lastX); const dy = (t.clientY - lastY);
            lastX = t.clientX; lastY = t.clientY;
            const maxTilt = 35;
            // accumulate targets based on drag deltas
            targetRy = clamp(targetRy + dx * 0.25, -maxTilt, maxTilt);
            targetRx = clamp(targetRx - dy * 0.25, -maxTilt, maxTilt);
            targetTx = clamp(targetTx + dx * -0.6, -40, 40);
            targetTy = clamp(targetTy + dy * 0.6, -40, 40);
            try { updateHud('drag', targetRx, targetRy); } catch(_) {}
          };
          const end = () => { dragging = false; };
          area.addEventListener('touchstart', start, { passive: true });
          area.addEventListener('touchmove', move, { passive: true });
          area.addEventListener('touchend', end, { passive: true });
        }
      }, 500);

      // Expose sensor heartbeat so idle drift can pause only while active
      try { window.__tiltHeartbeat = () => lastSensorTs; } catch(_) {}
    } catch(e){ console.warn('enableGyroParallax error', e); }
  }

  // Optional tilt debug HUD: add ?debugTilt=1 to URL to see live values
  const __tiltDebug = /[?&]debugTilt=1/.test((window.location && window.location.search) || '');
  function updateHud(source, a, b){
    if (!__tiltDebug) return;
    try {
      let hud = document.getElementById('tilt-hud');
      if (!hud){
        hud = document.createElement('div');
        hud.id = 'tilt-hud';
        hud.style.cssText = 'position:fixed;left:8px;bottom:8px;background:rgba(0,0,0,0.45);color:#fff;font:12px monospace;padding:6px 8px;border-radius:8px;z-index:99999;pointer-events:none;';
        document.body.appendChild(hud);
      }
      hud.textContent = `${source}: a=${(a||0).toFixed(1)} b=${(b||0).toFixed(1)}`;
    } catch(_) {}
  }

  function setAvatarState(state){
    if (state === avatarState) return;
    avatarState = state;
    clearTimers();
    switch(state){
      case 'talking': {
        // open mouth rhythmically, slight pupil micro-movement
        setEyes(true);
        let phase = 0;
        talkTimer = setInterval(() => {
          phase = (phase + 1) % 6;
          const h = 6 + (phase % 3) * 6; // 6,12,18 mouth height
          setMouth(h);
          const dy = (phase % 2) ? 0.5 : -0.5;
          centerPupils(0.5, dy);
        }, 120);
        break;
      }
      case 'thinking': {
        // smaller mouth, pupils drift upward then down
        setMouth(6);
        let t = 0;
        thinkTimer = setInterval(() => {
          t += 0.2;
          const dy = Math.sin(t) * 2;
          centerPupils(0, -2 + dy);
        }, 100);
        break;
      }
      default: { // idle
        setEyes(true);
        setMouth(6);
        centerPupils(0, 0);
        startIdleDrift();
      }
    }
  }
  // initialize to idle
  setAvatarState('idle');

  // === Simulated idle drift/parallax when no sensors ===
  let idleDriftRAF = null;
  let idleDriftTimer = null;
  let glanceTimer = null;
  let idleActive = false;
  let idleRx = 0, idleRy = 0, idleTx = 0, idleTy = 0;
  let idleTarget = { rx: 0, ry: 0, tx: 0, ty: 0 };
  let microPhase = 0;
  // Glance control
  let glanceActive = false;
  let glanceUntil = 0;      // timestamp when glance ends
  let glanceHoldUntil = 0;  // brief hold at peak
  let glanceBoost = 0.0;    // temporary lerp boost
  // Startup wiggle fallback (in case transforms are being overridden)
  let wiggleTimer = null;
  function pickIdleTarget(){
    // Random gentle target; occasionally more dramatic
    const strong = Math.random() < 0.45;
    const tilt = strong ? 32 : 14; // degrees
    const shift = strong ? 28 : 12; // px
    idleTarget.rx = (Math.random() * 2 - 1) * tilt;
    idleTarget.ry = (Math.random() * 2 - 1) * tilt;
    idleTarget.tx = (Math.random() * 2 - 1) * shift;
    idleTarget.ty = (Math.random() * 2 - 1) * shift;
  }
  function idleStep(){
    if (!avatar || !avatar.avatarEl) return;
    const el = getParallaxEl();
    // If sensors are active, suppress large drift but keep micro motion (not during explicit glances)
    let suppressLarge = false;
    try {
      const hb = (typeof window.__tiltHeartbeat === 'function') ? window.__tiltHeartbeat() : 0;
      suppressLarge = !glanceActive && ((Date.now() - hb) < 1500);
    } catch(_) {}
    // Scale based on state (smaller while talking/thinking)
    const stateScale = (avatarState === 'idle') ? 1.0 : 0.5;
    // Lerp toward target (or zero if suppressing)
    const lerp = (a,b,t)=>a+(b-a)*t;
    const tgtRx = suppressLarge ? 0 : idleTarget.rx * stateScale;
    const tgtRy = suppressLarge ? 0 : idleTarget.ry * stateScale;
    const tgtTx = suppressLarge ? 0 : idleTarget.tx * stateScale;
    const tgtTy = suppressLarge ? 0 : idleTarget.ty * stateScale;
    // If a glance is active, temporarily boost the speeds and pin targets during hold
    const now = Date.now();
    const inHold = glanceActive && now < glanceHoldUntil;
    const rotLerp = (glanceActive ? 0.38 + glanceBoost : 0.16);
    const posLerp = (glanceActive ? 0.42 + glanceBoost : 0.18);
    const gRx = inHold ? idleTarget.rx : tgtRx;
    const gRy = inHold ? idleTarget.ry : tgtRy;
    const gTx = inHold ? idleTarget.tx : tgtTx;
    const gTy = inHold ? idleTarget.ty : tgtTy;
    idleRx = lerp(idleRx, gRx, rotLerp);
    idleRy = lerp(idleRy, gRy, rotLerp);
    idleTx = lerp(idleTx, gTx, posLerp);
    idleTy = lerp(idleTy, gTy, posLerp);
    // End glance after its window
    if (glanceActive && now >= glanceUntil){ glanceActive = false; glanceBoost = 0; }

    // Continuous micro-oscillation (always on)
    microPhase += 0.1;
    const microTilt = (avatarState === 'idle') ? 2.0 : 1.2; // deg
    const microShift = (avatarState === 'idle') ? 2.0 : 1.0; // px
    const mx = Math.sin(microPhase) * microTilt;
    const my = Math.cos(microPhase * 0.8) * microTilt;
    const mtx = Math.sin(microPhase * 1.2) * microShift;
    const mty = Math.cos(microPhase * 0.7) * microShift;

    const rxAll = idleRx + mx;
    const ryAll = idleRy + my;
    const txAll = idleTx + mtx;
    const tyAll = idleTy + mty;
    const rzAll = ryAll * 0.3; // add a bit of roll for more obvious motion
    const scalePulse = 1.0 + Math.min(0.04, (Math.abs(rxAll) + Math.abs(ryAll)) * 0.004);
    if (el) {
      el.style.transform = `rotateX(${rxAll}deg) rotateY(${ryAll}deg) rotateZ(${rzAll}deg) translate3d(${txAll}px, ${tyAll}px, ${(Math.abs(rxAll)+Math.abs(ryAll))*1.0}px) scale(${scalePulse})`;
      // Brief border flash during glances so it's visually obvious
      if (glanceActive) {
        el.style.outline = '2px solid rgba(255,200,0,0.8)';
        el.style.boxShadow = '0 0 24px rgba(255,200,0,0.35)';
      } else {
        el.style.outline = '';
        el.style.boxShadow = '';
      }
    }
    // Clear inner face transform to avoid conflicts
    try { if (avatar && avatar.avatarEl) avatar.avatarEl.style.transform = ''; } catch(_) {}
    // Nudge eyes if present
    try { centerPupils(ryAll * 0.5, -rxAll * 0.5); } catch(_) {}
    try {
      const le = (avatar && avatar.avatarEl) ? avatar.avatarEl.querySelector('.left-eye') : null;
      const re = (avatar && avatar.avatarEl) ? avatar.avatarEl.querySelector('.right-eye') : null;
      // Add sharper eye saccade during glances
      const eyeScale = glanceActive ? 0.95 : 0.6;
      if (le) le.style.transform = `translate(${ryAll * eyeScale}px, ${-rxAll * eyeScale}px)`;
      if (re) re.style.transform = `translate(${ryAll * eyeScale}px, ${-rxAll * eyeScale}px)`;
    } catch(_) {}
    idleDriftRAF = requestAnimationFrame(idleStep);
  }
  function triggerGlance(dir){
    // dir: 'left' | 'right' | 'up' | 'down' | undefined (random)
    const sign = (x)=> (x<0?-1:1);
    const pick = (a,b)=> (Math.random()<0.5?a:b);
    const stateScale = (avatarState === 'idle') ? 1.0 : 0.6;
    const baseTilt = 42 * stateScale;   // bigger turns
    const baseShift = 34 * stateScale;  // bigger slide
    const d = dir || pick('left','right');
    const rx = pick(-1,1) * (d==='up'? baseTilt : d==='down'? -baseTilt : (Math.random()*0.5+0.75)*baseTilt*0.6);
    const ry = (d==='left'? -1 : d==='right'? 1 : pick(-1,1)) * (Math.random()*0.5+0.75)*baseTilt;
    const tx = sign(ry) * baseShift;
    const ty = -sign(rx) * (baseShift*0.8);
    idleTarget = { rx, ry, tx, ty };
    glanceActive = true;
    const now = Date.now();
    glanceHoldUntil = now + 260; // hold peak a bit longer
    glanceUntil = now + 900;     // finish glance a bit longer
    glanceBoost = 0.24;          // speed up easing during glance
    // snap pupils slightly further for a saccade feel
    try { centerPupils(ry * 0.9, -rx * 0.9); } catch(_) {}
    try { console.log('Glance', {dir: dir||'auto', rx, ry}); } catch(_) {}
  }
  function startIdleDrift(){
    if (idleActive) return;
    idleActive = true;
    // Force an immediate strong glance on start
    triggerGlance();
    idleDriftRAF = requestAnimationFrame(idleStep);
    idleDriftTimer = setInterval(pickIdleTarget, 1200);
    // Schedule periodic glances
    glanceTimer = setInterval(() => {
      // random chance each cycle to glance; higher if idle
      const p = (avatarState === 'idle') ? 0.6 : 0.3;
      if (Math.random() < p) triggerGlance();
    }, 2400);
    // Startup wiggle: alternate left/right hard for 5s so motion is unmistakable
    try {
      const el = getParallaxEl();
      let side = 1; let count = 0;
      wiggleTimer = setInterval(() => {
        count++;
        const rx = 8 * side, ry = 28 * side, tx = 18 * side, ty = -12 * side;
        if (el) el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translate3d(${tx}px, ${ty}px, 24px)`;
        side *= -1;
        if (count > 7) { clearInterval(wiggleTimer); wiggleTimer = null; }
      }, 600);
    } catch(_) {}

    // Debug: expose a manual trigger and hotkey
    try { window.__forceGlance = (d) => triggerGlance(d); } catch(_) {}
    try {
      document.addEventListener('keydown', (e) => {
        if ((e.key || '').toLowerCase() === 'g') {
          triggerGlance();
        }
      });
    } catch(_) {}
  }
  function stopIdleDrift(){
    idleActive = false;
    try { if (idleDriftRAF) cancelAnimationFrame(idleDriftRAF); } catch(_) {}
    idleDriftRAF = null;
    try { if (idleDriftTimer) clearInterval(idleDriftTimer); } catch(_) {}
    idleDriftTimer = null;
    try { if (glanceTimer) clearInterval(glanceTimer); } catch(_) {}
    glanceTimer = null;
    try { if (wiggleTimer) clearInterval(wiggleTimer); } catch(_) {}
    wiggleTimer = null;
    glanceActive = false; glanceBoost = 0; glanceUntil = 0; glanceHoldUntil = 0;
  }

  // Track last audio URL for attaching to messages
  let lastVoiceAudioUrl = null;

  // === Thinking Panel (streaming model reasoning) ===
  function _webuiCreateThinkingPanel(){
    const existing = chatEl.querySelector('.thinking-panel');
    if (existing) existing.remove();
    const panel = document.createElement('div');
    panel.className = 'thinking-panel';
    panel.style.cssText = 'margin:6px 0;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(180,140,255,0.15);overflow:hidden;font-family:Consolas,Monaco,"Courier New",monospace;';
    const header = document.createElement('div');
    header.className = 'thinking-panel-header';
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(180,140,255,0.08);border-bottom:1px solid rgba(180,140,255,0.1);cursor:pointer;user-select:none;';
    header.innerHTML = '<span style="font-size:11px;color:rgba(180,140,255,0.7);">\ud83d\udcad</span><span style="font-size:11px;color:rgba(180,140,255,0.7);font-weight:500;">Thinking</span><span class="thinking-spinner" style="font-size:9px;color:rgba(180,140,255,0.4);margin-left:4px;">\u25cf\u25cf\u25cf</span><span class="thinking-toggle" style="margin-left:auto;font-size:9px;color:rgba(255,255,255,0.2);">\u25be</span>';
    const content = document.createElement('div');
    content.className = 'thinking-panel-content';
    content.style.cssText = 'padding:8px 12px;font-size:11px;line-height:1.6;color:rgba(255,255,255,0.45);max-height:250px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(180,140,255,0.15) transparent;white-space:pre-wrap;word-break:break-word;';
    header.addEventListener('click', () => {
      const collapsed = content.style.display === 'none';
      content.style.display = collapsed ? 'block' : 'none';
      const t = header.querySelector('.thinking-toggle');
      if (t) t.textContent = collapsed ? '\u25be' : '\u25b8';
    });
    panel.appendChild(header);
    panel.appendChild(content);
    chatEl.appendChild(panel);
    _chatScroll();
    statusEl.textContent = 'Thinking...';
  }
  function _webuiAppendThinkingDelta(text){
    let panel = chatEl.querySelector('.thinking-panel');
    if (!panel) _webuiCreateThinkingPanel();
    panel = chatEl.querySelector('.thinking-panel');
    const c = panel ? panel.querySelector('.thinking-panel-content') : null;
    if (c){ c.textContent += text; c.scrollTop = c.scrollHeight; }
    _chatScroll();
  }
  function _webuiFinalizeThinkingPanel(){
    const panel = chatEl.querySelector('.thinking-panel');
    if (!panel) return;
    const spinner = panel.querySelector('.thinking-spinner');
    if (spinner) spinner.remove();
    const c = panel.querySelector('.thinking-panel-content');
    const h = panel.querySelector('.thinking-panel-header');
    if (c && h){
      const n = (c.textContent || '').length;
      if (n > 0){
        const lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.15);margin-left:6px;';
        lbl.textContent = n + ' chars';
        const t = h.querySelector('.thinking-toggle');
        if (t) h.insertBefore(lbl, t);
      }
      c.style.display = 'none';
      const t = h.querySelector('.thinking-toggle');
      if (t) t.textContent = '\u25b8';
    }
    statusEl.textContent = '';
  }

  function addMsg(content, who, audioUrl = null){
    const div = document.createElement('div');
    div.className = 'msg ' + (who || 'assistant');
    div.style.position = 'relative';
    
    // Create text content span
    const textSpan = document.createElement('span');
    textSpan.textContent = content;
    div.appendChild(textSpan);
    
    // Add audio playback button for assistant messages with audio
    if ((who === 'assistant' || !who) && audioUrl) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'msg-audio-btn';
      audioBtn.innerHTML = '🔊';
      audioBtn.title = 'Replay voice';
      audioBtn.style.cssText = 'position:absolute;bottom:4px;right:4px;background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:12px;opacity:0.6;transition:opacity 0.2s;';
      audioBtn.onmouseenter = () => audioBtn.style.opacity = '1';
      audioBtn.onmouseleave = () => audioBtn.style.opacity = '0.6';
      audioBtn.onclick = (e) => {
        e.stopPropagation();
        try {
          const audio = ensureAudio();
          if (!audio.paused && audio._activeBtn === audioBtn) {
            audio.pause();
            audioBtn.innerHTML = '🔊';
            audioBtn.title = 'Replay voice';
          } else {
            if (audio._activeBtn && audio._activeBtn !== audioBtn) {
              audio._activeBtn.innerHTML = '🔊';
              audio._activeBtn.title = 'Replay voice';
            }
            audio.src = audioUrl;
            audio._activeBtn = audioBtn;
            audioBtn.innerHTML = '⏸';
            audioBtn.title = 'Pause';
            audio.play().catch(() => {});
            audio.onended = () => { audioBtn.innerHTML = '🔊'; audioBtn.title = 'Replay voice'; };
          }
        } catch(err) { console.warn('Audio replay error:', err); }
      };
      div.appendChild(audioBtn);
      div.dataset.audioUrl = audioUrl;
    }
    
    chatEl.appendChild(div);
    _chatScroll();
    return div;
  }
  
  // Attach audio URL to the last assistant message
  function attachAudioToLastAssistant(audioUrl) {
    const msgs = chatEl.querySelectorAll('.msg.assistant');
    if (msgs.length === 0) return;
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.dataset.audioUrl) return; // Already has audio
    
    const audioBtn = document.createElement('button');
    audioBtn.className = 'msg-audio-btn';
    audioBtn.innerHTML = '🔊';
    audioBtn.title = 'Replay voice';
    audioBtn.style.cssText = 'position:absolute;bottom:4px;right:4px;background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:12px;opacity:0.6;transition:opacity 0.2s;';
    audioBtn.onmouseenter = () => audioBtn.style.opacity = '1';
    audioBtn.onmouseleave = () => audioBtn.style.opacity = '0.6';
    audioBtn.onclick = (e) => {
      e.stopPropagation();
      try {
        const audio = ensureAudio();
        if (!audio.paused && audio._activeBtn === audioBtn) {
          audio.pause();
          audioBtn.innerHTML = '🔊';
          audioBtn.title = 'Replay voice';
        } else {
          if (audio._activeBtn && audio._activeBtn !== audioBtn) {
            audio._activeBtn.innerHTML = '🔊';
            audio._activeBtn.title = 'Replay voice';
          }
          audio.src = audioUrl;
          audio._activeBtn = audioBtn;
          audioBtn.innerHTML = '⏸';
          audioBtn.title = 'Pause';
          audio.play().catch(() => {});
          audio.onended = () => { audioBtn.innerHTML = '🔊'; audioBtn.title = 'Replay voice'; };
        }
      } catch(err) { console.warn('Audio replay error:', err); }
    };
    lastMsg.appendChild(audioBtn);
    lastMsg.dataset.audioUrl = audioUrl;
    lastMsg.style.position = 'relative';
  }

  // Image bubble helper
  function addImageMsg(fileName, dataUrl, pending=false){
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const caption = document.createElement('div');
    caption.textContent = fileName ? `Image: ${fileName}` : 'Image';
    if (pending) {
      const note = document.createElement('span');
      note.textContent = ' (pending, will send with next message)';
      note.style.color = '#999';
      caption.appendChild(note);
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = fileName || 'image';
    img.style.maxWidth = '160px';
    img.style.maxHeight = '120px';
    img.style.display = 'block';
    img.style.marginTop = '4px';
    wrap.appendChild(caption);
    wrap.appendChild(img);
    chatEl.appendChild(wrap);
    _chatScroll();
    return wrap;
  }

  // Assistant image bubble helper (for generated/returned images)
  function addAssistantImageMsg(src, caption){
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.style.position = 'relative';
    if (caption) {
      const capDiv = document.createElement('div');
      capDiv.textContent = caption;
      capDiv.style.cssText = 'margin-bottom:6px;font-size:13px;color:rgba(255,255,255,0.8);';
      wrap.appendChild(capDiv);
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = caption || 'Generated image';
    img.style.cssText = 'max-width:320px;max-height:280px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;display:block;background:rgba(0,0,0,0.2);';
    img.onclick = function(){
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(4px);';
      var full = document.createElement('img');
      full.src = src; full.alt = caption || '';
      full.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,0.5);';
      overlay.appendChild(full);
      var dlBtn = document.createElement('a');
      dlBtn.href = src; dlBtn.download = 'image.png';
      dlBtn.textContent = 'Download';
      dlBtn.style.cssText = 'position:absolute;bottom:16px;color:#fff;background:rgba(255,255,255,0.15);padding:4px 12px;border-radius:6px;font-size:12px;text-decoration:none;';
      dlBtn.onclick = function(e){ e.stopPropagation(); };
      overlay.appendChild(dlBtn);
      overlay.onclick = function(){ overlay.remove(); };
      document.body.appendChild(overlay);
    };
    img.onerror = function(){ img.style.display='none'; var s=document.createElement('span'); s.textContent='[Image failed to load]'; s.style.color='#f87171'; wrap.appendChild(s); };
    wrap.appendChild(img);
    chatEl.appendChild(wrap);
    _chatScroll();
    return wrap;
  }

  // Detect if text contains image content that should be rendered
  function hasImageContent(text){
    if (!text) return false;
    return /!\[[^\]]*\]\([^)]+\)/.test(text) ||
           /^data:image\//m.test(text) ||
           /^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?$/im.test(text);
  }

  // Simple image extraction from text — renders images inline, returns remaining text
  function renderTextWithImages(text, parentEl){
    if (!text) return;
    // Split on markdown images, bare data URIs, and bare image URLs
    const imgPattern = /(?:!\[([^\]]*)\]\(([^)]+)\))|(?:^(data:image\/[^\s]+)$)|(?:^(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?)$)/gim;
    let lastIdx = 0;
    let match;
    while ((match = imgPattern.exec(text)) !== null) {
      // Add text before the match
      const before = text.slice(lastIdx, match.index).trim();
      if (before) {
        const span = document.createElement('div');
        span.textContent = before;
        parentEl.appendChild(span);
      }
      // Render the image
      const src = match[2] || match[3] || match[4];
      const alt = match[1] || 'Image';
      if (src) {
        const img = document.createElement('img');
        img.src = src; img.alt = alt;
        img.style.cssText = 'max-width:320px;max-height:280px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;display:block;margin:6px 0;background:rgba(0,0,0,0.2);';
        img.onclick = function(){
          var o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(4px);';
          var f=document.createElement('img');f.src=src;f.style.cssText='max-width:92vw;max-height:92vh;border-radius:8px;';o.appendChild(f);o.onclick=function(){o.remove();};document.body.appendChild(o);
        };
        parentEl.appendChild(img);
      }
      lastIdx = match.index + match[0].length;
    }
    // Add remaining text after last match
    const after = text.slice(lastIdx).trim();
    if (after) {
      const span = document.createElement('div');
      span.textContent = after;
      parentEl.appendChild(span);
    }
  }

  // Maintain a live assistant bubble for streaming
  let currentAssistantDiv = null;
  let lastAssistantText = '';
  let recentAssistantTexts = []; // Track last few assistant texts for dedup
  function upsertAssistantChunk(text){
    if (!currentAssistantDiv){
      currentAssistantDiv = addMsg(text || '', 'assistant');
    } else {
      currentAssistantDiv.textContent = (currentAssistantDiv.textContent || '') + (text || '');
      _chatScroll();
    }
    lastAssistantText = currentAssistantDiv.textContent || '';
  }
  function finalizeAssistant(){
    currentAssistantDiv = null;
  }
  let lastIndex = 0;
  async function poll(){
    try {
      const res = await fetch(`${proxyBase}/api/messages?since=${lastIndex}`);
      if (!res.ok) throw new Error('poll failed');
      statusEl.textContent = 'Connected';
      const data = await res.json();
      if (!data || !Array.isArray(data.messages)) return;
      // Update index
      if (typeof data.index === 'number') lastIndex = data.index;
      if (data.messages.length > 0) console.log(`[POLL] ${data.messages.length} new msgs, index now ${lastIndex}`);
      for (const item of data.messages){
        const msg = item && item.message ? item.message : item;
        if (!msg) continue;
        console.log('[POLL]', msg.type || msg.status, JSON.stringify(msg).slice(0,150));
        // WebUI: handle Kokoro audio playback (skip if TTS WebSocket already streamed this utterance)
        if (msg.type === 'voice-audio' && msg.url){
          try {
            const u = (msg.url.startsWith('http://') || msg.url.startsWith('https://'))
              ? msg.url
              : `${proxyBase.replace(/\/$/, '')}${msg.url.startsWith('/') ? '' : '/'}${msg.url}`;
            // Store as last voice audio URL and attach to last assistant message
            lastVoiceAudioUrl = u;
            attachAudioToLastAssistant(u);

            // Only play via <audio> element if TTS WebSocket isn't actively streaming
            if (!ttsWsStreaming) {
              if (!audioEnabled) { lastAudioUrl = u; }
              const audio = ensureAudio();
              audio.src = u;
              const p = audio.play();
              if (p && typeof p.catch === 'function') {
                p.catch(() => {});
              }
            } else {
              console.log('[TTS-WS] Skipping voice-audio URL playback (streaming via WebSocket)');
            }
          } catch(e){ console.warn('voice-audio playback error', e); }
          continue;
        }
        // WebUI: forward desktop-style voice status to avatar via window message
        if (msg.type === 'voice' && typeof msg.status === 'string'){
          try {
            // Update local speaking flag immediately to gate state changes below
            if (msg.status === 'speaking' || msg.status === 'start') voiceActive = true;
            if (msg.status === 'stopped' || msg.status === 'end') voiceActive = false;
            window.postMessage({ type: 'voice-status', status: msg.status }, '*');
          } catch(e){ console.warn('voice status forwarding error', e); }
          continue;
        }
        // Handle avatar events (state only). IMPORTANT: do NOT change state while speaking,
        // or it will clear desktop mouth animation.
        if (msg.type === 'avatar'){
          if (avatar && typeof msg.state === 'string'){
            // Do not alter avatar state while voice is active
            if (!voiceActive && !avatar.isAudioPlaying) {
              if (msg.state === 'thinking') avatar.setState && avatar.setState('thinking');
              else if (msg.state === 'talking') avatar.setState && avatar.setState('talking');
              else avatar.setState && avatar.setState('idle');
            }
          }
          continue;
        }
        // Handle push notifications from backend
        if (msg.type === 'notification'){
          showNotification(msg.title, msg.body, msg.tag);
          continue;
        }
        // Respect suppress_chat flag from backend
        if (msg.suppress_chat === true) continue;
        // If backend sends a config (e.g., profile switch), refresh avatar
        if (msg.type === 'config' || msg.type === 'profile_switched'){
          refreshAvatar();
          continue;
        }
        // User messages from desktop — show in webui chat
        if (msg.status === 'user_message' && typeof msg.result === 'string' && msg.result.trim()){
          addMsg(msg.result, 'user');
          // Reset dedup guard for the new conversation turn
          lastAssistantText = '';
          if (currentAssistantDiv) finalizeAssistant();
          continue;
        }
        // Streaming thinking content from model reasoning
        if (msg.type === 'thinking_start'){
          _webuiCreateThinkingPanel();
          continue;
        }
        if (msg.type === 'thinking_delta'){
          _webuiAppendThinkingDelta(msg.content || '');
          continue;
        }
        if (msg.type === 'thinking_end'){
          _webuiFinalizeThinkingPanel();
          continue;
        }
        // Image messages from backend
        if (msg.type === 'image' || msg.image_url || msg.image_base64){
          const imgSrc = msg.image_url || msg.image_base64 || '';
          const imgCaption = msg.caption || msg.alt || msg.result || 'Generated image';
          if (imgSrc) {
            if (currentAssistantDiv) finalizeAssistant();
            addAssistantImageMsg(imgSrc, imgCaption);
          }
          continue;
        }
        // Thinking indicator
        if (msg.status === 'thinking'){
          statusEl.textContent = 'Thinking...';
          continue;
        }
        // Tool activity — just update status, don't create bubbles (matches desktop behavior)
        if (msg.status === 'tool_executing' || msg.status === 'tool_result'){
          _webuiFinalizeThinkingPanel();
          const toolMsg = msg.message || msg.tool || '';
          statusEl.textContent = toolMsg ? `Working: ${toolMsg}` : 'Working...';
          continue;
        }
        // Skip [SILENT] heartbeat/observation messages (startsWith catches "[SILENT] nothing to do" etc.)
        if (typeof msg.result === 'string' && (msg.result.trim().startsWith('[SILENT]') || msg.result.trim() === 'CIRCUITS_OK' || msg.result.trim() === 'HEARTBEAT_OK')) continue;
        // Streaming chunks
        if (msg.status === 'streaming' && typeof msg.result === 'string'){
          upsertAssistantChunk(msg.result);
          continue;
        }
        // Final messages
        let content = '';
        if (Array.isArray(msg.messages)){
          for (let i = msg.messages.length - 1; i >= 0; i--) {
            const m = msg.messages[i];
            if (m && m.role === 'assistant') { content = m.content || ''; break; }
          }
        }
        if (!content && typeof msg.result === 'string') content = msg.result;
        if (!content && typeof msg.content === 'string') content = msg.content;
        if (content){
          const trimmed = (content || '').trim();
          // Filter legacy placeholders
          if (!trimmed || trimmed === 'No response generated.' || trimmed === 'No content') continue;
          // If we streamed earlier, REPLACE the bubble with final content to avoid duplication
          if (currentAssistantDiv){
            if (hasImageContent(content)) {
              currentAssistantDiv.textContent = '';
              renderTextWithImages(content, currentAssistantDiv);
            } else {
              currentAssistantDiv.textContent = content;
            }
            _chatScroll();
            lastAssistantText = content;
            finalizeAssistant();
          } else {
            // Suppress duplicate assistant messages (check recent history)
            if (trimmed && trimmed !== (lastAssistantText || '').trim() && !recentAssistantTexts.includes(trimmed)){
              if (hasImageContent(content)) {
                const wrap = document.createElement('div');
                wrap.className = 'msg assistant';
                renderTextWithImages(content, wrap);
                chatEl.appendChild(wrap);
                _chatScroll();
              } else {
                addMsg(content, 'assistant');
              }
              lastAssistantText = content;
              recentAssistantTexts.push(trimmed);
              if (recentAssistantTexts.length > 5) recentAssistantTexts.shift();
            }
          }
        }
      }
    } catch (e) {
      statusEl.textContent = 'Connecting...';
      console.warn('[POLL] error:', e.message, 'proxyBase:', proxyBase);
    }
  }
  // Start polling
  console.log('[POLL] Starting poll loop, proxyBase:', proxyBase);
  poll();
  setInterval(poll, 500);

  // Hold a pending image selection until user clicks Send
  let pendingImage = null; // { filename, dataUrl, base64, mime, bubble }

  function send(){
    const text = (inputEl.value || '').trim();
    if (!text && !pendingImage) return; // require text or pending image
    if (text) addMsg(text, 'user');
    inputEl.value = '';
    // Reset duplicate guard for the next assistant turn
    lastAssistantText = '';
    const body = { text };
    if (pendingImage) {
      body.filename = pendingImage.filename;
      body.image_data_url = pendingImage.dataUrl;
      body.image_base64 = pendingImage.base64;
      body.mime = pendingImage.mime;
    }
    console.log('[SEND] POST to', `${proxyBase}/api/input`, 'body:', JSON.stringify(body).slice(0,200));
    fetch(`${proxyBase}/api/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(async r => {
      console.log('[SEND] response status:', r.status);
      if (!r.ok) {
        try { const j = await r.json(); addMsg(`[Server error ${r.status}: ${j.message || JSON.stringify(j)}]`, 'assistant'); }
        catch(_) { addMsg(`[Network error: HTTP ${r.status}]`, 'assistant'); }
      }
    }).catch(err => {
      console.error('[SEND] fetch failed:', err);
      addMsg(`[Send failed: ${err.message}. proxyBase=${proxyBase}]`, 'assistant');
    });
    // Clear pending image if any (and remove pending note)
    if (pendingImage && pendingImage.bubble) {
      try { pendingImage.bubble.querySelector('div span')?.remove(); } catch(_) {}
      pendingImage = null;
    }
  }

  // === Image upload (file picker) ===
  (function injectImagePicker(){
    try {
      const container = (inputEl && inputEl.parentElement) || document.body;
      const fileBtn = document.createElement('button');
      fileBtn.id = 'imageBtn';
      fileBtn.title = 'Send a photo from gallery';
      fileBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
      fileBtn.style.display = 'inline-flex';
      fileBtn.style.alignItems = 'center';
      fileBtn.style.justifyContent = 'center';
      fileBtn.style.flexShrink = '0';
      const fileInp = document.createElement('input');
      fileInp.type = 'file';
      fileInp.accept = 'image/*';
      fileInp.style.display = 'none';
      fileInp.id = 'imageInput';
      // Insert on right side: [input] [Send] [folder] [camera ꕥ]
      const visionBtn = document.getElementById('visionToggle');
      if (visionBtn) {
        container.insertBefore(fileBtn, visionBtn);
        container.insertBefore(fileInp, visionBtn);
      } else {
        container.appendChild(fileBtn);
        container.appendChild(fileInp);
      }
      fileBtn.addEventListener('click', () => fileInp.click());
      fileInp.addEventListener('change', async () => {
        try {
          const f = fileInp.files && fileInp.files[0];
          if (!f) return;
          const readAsDataURL = (file) => new Promise((res, rej) => {
            const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
          });
          const dataUrl = await readAsDataURL(f);
          const bubble = addImageMsg(f.name, dataUrl, true);
          pendingImage = {
            filename: f.name, dataUrl,
            base64: (typeof dataUrl === 'string' && dataUrl.includes(',')) ? dataUrl.split(',')[1] : null,
            mime: f.type || null, bubble
          };
        } catch (e){ console.warn('Image send failed', e); }
        finally { fileInp.value = ''; }
      });
    } catch(e){ console.warn('injectImagePicker error', e); }
  })();

  // === Voice chat (STT) — WebSocket streaming mic ===
  // Streams raw 16kHz mono PCM int16 over WebSocket to backend for real-time Chirp 2 transcription.
  // Audio transfers while you talk, so only the API call latency remains when you stop.
  (function injectVoiceChat(){
    try {
      const container = (inputEl && inputEl.parentElement) || document.body;
      const micBtn = document.createElement('button');
      micBtn.id = 'micBtn';
      micBtn.title = 'Voice input';
      micBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
      micBtn.style.display = 'inline-flex';
      micBtn.style.alignItems = 'center';
      micBtn.style.justifyContent = 'center';
      micBtn.style.flexShrink = '0';

      const visionBtn = document.getElementById('visionToggle');
      if (visionBtn) {
        container.insertBefore(micBtn, visionBtn);
      } else {
        container.appendChild(micBtn);
      }

      let micStream = null;
      let audioCtx = null;
      let scriptNode = null;
      let sttWs = null;
      let streaming = false;
      let lastTranscript = '';

      function getWsUrl() {
        const p = new URL(proxyBase);
        const proto = p.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${p.host}/api/stt/stream`;
      }

      async function startStreaming() {
        if (streaming) return;
        inputEl.value = '';
        lastTranscript = '';

        // Get mic
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
        } catch(e) {
          console.warn('[STT] Mic access denied:', e);
          return;
        }

        // Open WebSocket
        try {
          sttWs = new WebSocket(getWsUrl());
          sttWs.binaryType = 'arraybuffer';
        } catch(e) {
          console.warn('[STT] WebSocket failed:', e);
          micStream.getTracks().forEach(t => t.stop());
          micStream = null;
          return;
        }

        // Wait for WS open
        await new Promise((resolve, reject) => {
          sttWs.onopen = resolve;
          sttWs.onerror = reject;
          setTimeout(() => reject(new Error('WS timeout')), 5000);
        }).catch(e => {
          console.warn('[STT] WebSocket connect failed:', e);
          micStream.getTracks().forEach(t => t.stop());
          micStream = null;
          sttWs = null;
          return;
        });

        if (!sttWs || sttWs.readyState !== WebSocket.OPEN) {
          if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
          return;
        }

        // Handle incoming transcripts
        sttWs.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'transcript' && typeof msg.text === 'string') {
              lastTranscript = msg.text;
              inputEl.value = msg.text;
              console.log('[STT]', msg.final ? 'Final:' : 'Interim:', msg.text);
              if (msg.final) {
                cleanup();
                if (msg.text.trim()) {
                  send();
                }
              }
            }
          } catch(e) { console.warn('[STT] WS message parse error:', e); }
        };

        sttWs.onclose = () => {
          console.log('[STT] WebSocket closed');
          if (streaming) cleanup();
        };

        sttWs.onerror = (e) => {
          console.warn('[STT] WebSocket error:', e);
          cleanup();
        };

        // Set up audio processing: capture mic → resample to 16kHz mono → send PCM int16
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(micStream);

        // ScriptProcessorNode: 4096 samples per chunk at 16kHz = 256ms chunks
        scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptNode.onaudioprocess = (e) => {
          if (!sttWs || sttWs.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          // Convert float32 [-1,1] to int16
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          sttWs.send(int16.buffer);
        };

        source.connect(scriptNode);
        scriptNode.connect(audioCtx.destination);

        streaming = true;
        micBtn.classList.add('active', 'hold');
        inputEl.placeholder = 'Listening...';
        console.log('[STT] Streaming started');
      }

      function stopStreaming() {
        if (!streaming) return;
        console.log('[STT] Stop requested');
        inputEl.placeholder = 'Transcribing...';
        // Send stop command — backend will transcribe remaining audio and send final transcript
        if (sttWs && sttWs.readyState === WebSocket.OPEN) {
          sttWs.send(JSON.stringify({ action: 'stop' }));
          // Give backend up to 15s to respond with final transcript before cleanup
          setTimeout(() => {
            if (streaming) {
              console.warn('[STT] Timeout waiting for final transcript');
              cleanup();
              if (lastTranscript.trim()) {
                inputEl.value = lastTranscript;
                send();
              }
            }
          }, 15000);
        } else {
          cleanup();
          if (lastTranscript.trim()) {
            inputEl.value = lastTranscript;
            send();
          }
        }
      }

      function cleanup() {
        streaming = false;
        if (scriptNode) { try { scriptNode.disconnect(); } catch(_){} scriptNode = null; }
        if (audioCtx) { try { audioCtx.close(); } catch(_){} audioCtx = null; }
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
        if (sttWs) { try { sttWs.close(); } catch(_){} sttWs = null; }
        micBtn.classList.remove('active', 'hold');
        inputEl.placeholder = 'Type your message...';
      }

      micBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (streaming) {
          stopStreaming();
        } else {
          startStreaming();
        }
      });

    } catch(e){ console.warn('injectVoiceChat error', e); }
  })();

  // === Vision toggle — camera behind avatar face ===
  (function initVisionToggle(){
    const heroPanel = document.getElementById('heroPanel');
    const cameraVideo = document.getElementById('cameraVideo');
    const visionBtn = document.getElementById('visionToggle');
    if (!heroPanel || !cameraVideo || !visionBtn) return;

    let visionStream = null;
    let visionActive = false;
    let snapshotTimer = null;
    let facingUser = false;
    let camMinInterval = 30;  // seconds, updated from config
    let camMaxInterval = 120; // seconds, updated from config

    async function loadCameraConfig(){
      try {
        const res = await fetch(`${proxyBase}/api/camera/config`);
        if (res.ok) {
          const cam = await res.json();
          if (cam) {
            if (cam.min_interval) camMinInterval = parseInt(cam.min_interval) || 30;
            if (cam.max_interval) camMaxInterval = parseInt(cam.max_interval) || 120;
            console.log(`[Vision] config loaded: interval ${camMinInterval}-${camMaxInterval}s`);
          }
        }
      } catch(e){ console.warn('[Vision] config fetch failed, using defaults', e); }
    }

    function randomInterval(){
      const minMs = camMinInterval * 1000;
      const maxMs = camMaxInterval * 1000;
      return minMs + Math.random() * (maxMs - minMs);
    }

    function captureFrame(){
      if (!cameraVideo || !cameraVideo.videoWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = cameraVideo.videoWidth;
      canvas.height = cameraVideo.videoHeight;
      canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.7);
    }

    function sendSnapshot(){
      if (!visionActive) return;
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      const b64 = dataUrl.split(',')[1];
      fetch(`${proxyBase}/api/camera/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: b64, mime: 'image/jpeg' })
      }).catch(e => console.warn('[Vision] snapshot send failed', e));
    }

    function scheduleNextSnapshot(){
      if (!visionActive) return;
      const delay = randomInterval();
      console.log(`[Vision] next snapshot in ${(delay/1000).toFixed(0)}s`);
      snapshotTimer = setTimeout(() => {
        sendSnapshot();
        scheduleNextSnapshot();
      }, delay);
    }

    function startSnapshotTimer(){
      stopSnapshotTimer();
      // Send first snapshot after a short delay (the "opening eyes" moment)
      setTimeout(() => { if (visionActive) { sendSnapshot(); scheduleNextSnapshot(); } }, 3000);
    }

    function stopSnapshotTimer(){
      if (snapshotTimer){ clearTimeout(snapshotTimer); snapshotTimer = null; }
    }

    async function startVision(){
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        addMsg('[Camera not available \u2014 requires HTTPS]', 'assistant');
        return;
      }
      try {
        visionStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        cameraVideo.srcObject = visionStream;
        cameraVideo.classList.add('active');
        heroPanel.classList.add('camera-on');
        visionBtn.classList.add('active');
        visionActive = true;
        await loadCameraConfig();
        startSnapshotTimer();
        console.log('[Vision] camera started');
      } catch(e){
        console.error('[Vision] camera access failed:', e);
        addMsg(`[Vision error: ${e.message}]`, 'assistant');
        stopVision();
      }
    }

    function stopVision(){
      visionActive = false;
      stopSnapshotTimer();
      if (visionStream){ visionStream.getTracks().forEach(t => t.stop()); visionStream = null; }
      cameraVideo.srcObject = null;
      cameraVideo.classList.remove('active');
      heroPanel.classList.remove('camera-on');
      visionBtn.classList.remove('active');
      // Reset first-look flag so next toggle gets "opening eyes" prompt
      fetch(`${proxyBase}/api/camera/reset`, { method: 'POST' }).catch(() => {});
      console.log('[Vision] camera stopped');
    }

    // Toggle on click
    visionBtn.addEventListener('click', () => {
      if (visionActive) stopVision();
      else startVision();
    });

    // Long-press to switch camera (front/rear)
    let pressTimer = null;
    visionBtn.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(async () => {
        if (!visionActive) return;
        facingUser = !facingUser;
        if (visionStream) visionStream.getTracks().forEach(t => t.stop());
        try {
          visionStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingUser ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
          cameraVideo.srcObject = visionStream;
          console.log('[Vision] switched to', facingUser ? 'front' : 'rear');
        } catch(e){ console.warn('[Vision] camera switch failed', e); }
      }, 600);
    });
    visionBtn.addEventListener('pointerup', () => { if (pressTimer) clearTimeout(pressTimer); });
    visionBtn.addEventListener('pointercancel', () => { if (pressTimer) clearTimeout(pressTimer); });

    // Expose for external control (e.g. backend can request a snapshot)
    window.substrateVision = {
      start: startVision,
      stop: stopVision,
      isActive: () => visionActive,
      captureFrame,
      sendSnapshot,
    };
  })();

  // === Web Notifications ===
  let notificationsEnabled = false;
  (function initNotifications(){
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { notificationsEnabled = true; return; }
    if (Notification.permission === 'denied') return;
    // Request on first user interaction (browsers require gesture)
    const requestOnce = () => {
      Notification.requestPermission().then(p => {
        notificationsEnabled = (p === 'granted');
        console.log('[Notifications]', p);
      });
      document.removeEventListener('click', requestOnce);
      document.removeEventListener('touchstart', requestOnce);
    };
    document.addEventListener('click', requestOnce, { once: true });
    document.addEventListener('touchstart', requestOnce, { once: true });
  })();

  function showNotification(title, body, tag){
    if (!notificationsEnabled) return;
    try {
      // Use service worker notification if available (works in background)
      if (navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title || 'Substrate', {
            body: body || '', tag: tag || 'substrate', vibrate: [200, 100, 200],
          });
        });
      } else {
        new Notification(title || 'Substrate', { body: body || '', tag: tag || 'substrate' });
      }
    } catch(e){ console.warn('Notification error', e); }
  }
  // Expose globally so other scripts can trigger
  window.substrateNotify = showNotification;

  // === Service Worker registration (PWA) ===
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => console.log('[SW] registered', reg.scope))
      .catch(err => console.warn('[SW] registration failed', err));
  }

  // Enter to send, Shift+Enter for newline
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      send();
    }
  });

  // ===================== Face Editor =====================
  (function initFaceEditor(){
    const panel = document.getElementById('faceEditorPanel');
    const openBtn = document.getElementById('editFaceBtn');
    const closeBtn = document.getElementById('feCloseBtn');
    const saveBtn = document.getElementById('feSaveBtn');
    const resetBtn = document.getElementById('feResetBtn');
    if (!panel || !openBtn) return;

    // Default face config (hero-sized avatar defaults)
    const DEFAULTS = {
      face: { top: 30, width: 82, height: 55 },
      leftEye: { top: 20, left: 30, width: 48, height: 48 },
      rightEye: { top: 20, right: 30, width: 48, height: 48 },
      mouth: { top: 60, width: 90, height: 6 },
      leftCheek: { top: 42, left: 28, width: 30, height: 30 },
      rightCheek: { top: 42, right: 28, width: 30, height: 30 },
      body: { color: '#5bbfdd' },
      faceColor: '#a8e4f3'
    };

    // Current working state
    let cfg = JSON.parse(JSON.stringify(DEFAULTS));

    // Slider ↔ config mapping
    const sliders = {
      'fe-face-top':     { get: () => cfg.face.top,          set: v => { cfg.face.top = v; } },
      'fe-face-w':       { get: () => cfg.face.width,        set: v => { cfg.face.width = v; } },
      'fe-face-h':       { get: () => cfg.face.height,       set: v => { cfg.face.height = v; } },
      'fe-eye-top':      { get: () => cfg.leftEye.top,       set: v => { cfg.leftEye.top = v; cfg.rightEye.top = v; } },
      'fe-eye-spread':   { get: () => cfg.leftEye.left,      set: v => { cfg.leftEye.left = v; cfg.rightEye.right = v; } },
      'fe-eye-size':     { get: () => cfg.leftEye.width,     set: v => { cfg.leftEye.width = v; cfg.leftEye.height = v; cfg.rightEye.width = v; cfg.rightEye.height = v; } },
      'fe-mouth-top':    { get: () => cfg.mouth.top,         set: v => { cfg.mouth.top = v; } },
      'fe-mouth-w':      { get: () => cfg.mouth.width,       set: v => { cfg.mouth.width = v; } },
      'fe-mouth-h':      { get: () => cfg.mouth.height,      set: v => { cfg.mouth.height = v; } },
      'fe-cheek-top':    { get: () => cfg.leftCheek.top,     set: v => { cfg.leftCheek.top = v; cfg.rightCheek.top = v; } },
      'fe-cheek-spread': { get: () => cfg.leftCheek.left,    set: v => { cfg.leftCheek.left = v; cfg.rightCheek.right = v; } },
      'fe-cheek-size':   { get: () => cfg.leftCheek.width,   set: v => { cfg.leftCheek.width = v; cfg.leftCheek.height = v; cfg.rightCheek.width = v; cfg.rightCheek.height = v; } },
    };

    // Populate slider values from cfg and show value labels
    function syncSlidersFromCfg(){
      for (const [id, map] of Object.entries(sliders)){
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + '-val');
        if (el) el.value = map.get();
        if (valEl) valEl.textContent = map.get() + (id.includes('size') ? 'px' : '%');
      }
      // Colors
      const bodyC = document.getElementById('fe-color-body');
      const faceC = document.getElementById('fe-color-face');
      if (bodyC) bodyC.value = cfg.body.color || '#5bbfdd';
      if (faceC) faceC.value = cfg.faceColor || '#a8e4f3';
    }

    // Apply current cfg to the live avatar via inline !important (beats all stylesheet rules)
    function applyToAvatar(){
      const av = document.querySelector('#avatarContainer .animated-avatar');
      if (!av) return;

      // Responsive scale: slider values are "authored" px, scale down for small screens
      const avatarSz = getAvatarSize();
      const sf = Math.min(1, avatarSz / REF_AVATAR_SIZE);
      const spx = (n) => Math.round(n * sf) + 'px';

      // CSS custom properties on the avatar element (scaled)
      av.style.setProperty('--face-width', cfg.face.width + '%');
      av.style.setProperty('--face-height', cfg.face.height + '%');
      av.style.setProperty('--eye-width', spx(cfg.leftEye.width));
      av.style.setProperty('--eye-height', spx(cfg.leftEye.height));
      av.style.setProperty('--left-eye-top', cfg.leftEye.top + '%');
      av.style.setProperty('--right-eye-top', cfg.rightEye.top + '%');
      av.style.setProperty('--left-eye-left', cfg.leftEye.left + '%');
      av.style.setProperty('--right-eye-right', cfg.rightEye.right + '%');
      av.style.setProperty('--mouth-top', cfg.mouth.top + '%');
      av.style.setProperty('--mouth-width', spx(cfg.mouth.width));
      av.style.setProperty('--mouth-height', spx(cfg.mouth.height));
      av.style.setProperty('--avatar-body-color', cfg.body.color);
      av.style.setProperty('--avatar-face-color', cfg.faceColor);

      // Body bg
      const bgSq = document.querySelector('#bodyBg .bgSquare');
      if (bgSq) bgSq.style.backgroundColor = cfg.body.color;

      // Faceplate (::before) — can only be styled via stylesheet, not inline
      let feStyle = document.getElementById('fe-override-style');
      if (!feStyle) { feStyle = document.createElement('style'); feStyle.id = 'fe-override-style'; document.head.appendChild(feStyle); }
      feStyle.textContent = `
        #avatarContainer .animated-avatar::before {
          top: ${cfg.face.top}% !important;
          width: ${cfg.face.width}% !important;
          height: ${cfg.face.height}% !important;
        }
      `;

      // Inline style with 'important' priority + responsive scaling
      const le = av.querySelector('.left-eye');
      const re = av.querySelector('.right-eye');
      const mo = av.querySelector('.mouth');
      const lc = av.querySelector('.left-cheek');
      const rc = av.querySelector('.right-cheek');

      if (le) {
        le.style.setProperty('width', spx(cfg.leftEye.width), 'important');
        le.style.setProperty('height', spx(cfg.leftEye.height), 'important');
        le.style.setProperty('top', cfg.leftEye.top + '%', 'important');
        le.style.setProperty('left', cfg.leftEye.left + '%', 'important');
      }
      if (re) {
        re.style.setProperty('width', spx(cfg.rightEye.width), 'important');
        re.style.setProperty('height', spx(cfg.rightEye.height), 'important');
        re.style.setProperty('top', cfg.rightEye.top + '%', 'important');
        re.style.setProperty('right', cfg.rightEye.right + '%', 'important');
      }
      if (mo) {
        mo.style.setProperty('width', spx(cfg.mouth.width), 'important');
        mo.style.setProperty('height', spx(cfg.mouth.height), 'important');
        mo.style.setProperty('top', cfg.mouth.top + '%', 'important');
      }
      if (lc) {
        lc.style.setProperty('width', spx(cfg.leftCheek.width), 'important');
        lc.style.setProperty('height', spx(cfg.leftCheek.height), 'important');
        lc.style.setProperty('top', cfg.leftCheek.top + '%', 'important');
        lc.style.setProperty('left', cfg.leftCheek.left + '%', 'important');
      }
      if (rc) {
        rc.style.setProperty('width', spx(cfg.rightCheek.width), 'important');
        rc.style.setProperty('height', spx(cfg.rightCheek.height), 'important');
        rc.style.setProperty('top', cfg.rightCheek.top + '%', 'important');
        rc.style.setProperty('right', cfg.rightCheek.right + '%', 'important');
      }
    }

    // Wire up sliders for live preview
    for (const [id, map] of Object.entries(sliders)){
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        map.set(parseInt(el.value));
        const valEl = document.getElementById(id + '-val');
        if (valEl) valEl.textContent = el.value + (id.includes('size') ? 'px' : '%');
        applyToAvatar();
      });
    }
    // Color inputs
    const bodyC = document.getElementById('fe-color-body');
    const faceC = document.getElementById('fe-color-face');
    if (bodyC) bodyC.addEventListener('input', () => { cfg.body.color = bodyC.value; applyToAvatar(); });
    if (faceC) faceC.addEventListener('input', () => { cfg.faceColor = faceC.value; applyToAvatar(); });

    // Load config from server
    async function loadFromServer(){
      try {
        const res = await fetch(proxyBase + '/ui/face-config', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !Object.keys(data).length) return;
        // Map server format (desktop editor) to our flat format
        if (data.face) {
          if (data.face.top) cfg.face.top = parseInt(data.face.top) || DEFAULTS.face.top;
          if (data.face.width) cfg.face.width = parseInt(data.face.width) || DEFAULTS.face.width;
          if (data.face.height) cfg.face.height = parseInt(data.face.height) || DEFAULTS.face.height;
          if (data.face.color) cfg.faceColor = data.face.color;
        }
        if (data.leftEye) {
          if (data.leftEye.top) cfg.leftEye.top = parseInt(data.leftEye.top) || DEFAULTS.leftEye.top;
          if (data.leftEye.left) cfg.leftEye.left = parseInt(data.leftEye.left) || DEFAULTS.leftEye.left;
          if (data.leftEye.width) cfg.leftEye.width = parseInt(data.leftEye.width) || DEFAULTS.leftEye.width;
          if (data.leftEye.height) cfg.leftEye.height = parseInt(data.leftEye.height) || DEFAULTS.leftEye.height;
        }
        if (data.rightEye) {
          if (data.rightEye.top) cfg.rightEye.top = parseInt(data.rightEye.top) || DEFAULTS.rightEye.top;
          if (data.rightEye.right) cfg.rightEye.right = parseInt(data.rightEye.right) || DEFAULTS.rightEye.right;
          if (data.rightEye.width) cfg.rightEye.width = parseInt(data.rightEye.width) || DEFAULTS.rightEye.width;
          if (data.rightEye.height) cfg.rightEye.height = parseInt(data.rightEye.height) || DEFAULTS.rightEye.height;
        }
        if (data.mouth) {
          if (data.mouth.top) cfg.mouth.top = parseInt(data.mouth.top) || DEFAULTS.mouth.top;
          if (data.mouth.width) cfg.mouth.width = parseInt(data.mouth.width) || DEFAULTS.mouth.width;
          if (data.mouth.height) cfg.mouth.height = parseInt(data.mouth.height) || DEFAULTS.mouth.height;
        }
        if (data.leftCheek) {
          if (data.leftCheek.top) cfg.leftCheek.top = parseInt(data.leftCheek.top) || DEFAULTS.leftCheek.top;
          if (data.leftCheek.left) cfg.leftCheek.left = parseInt(data.leftCheek.left) || DEFAULTS.leftCheek.left;
          if (data.leftCheek.width) cfg.leftCheek.width = parseInt(data.leftCheek.width) || DEFAULTS.leftCheek.width;
          if (data.leftCheek.height) cfg.leftCheek.height = parseInt(data.leftCheek.height) || DEFAULTS.leftCheek.height;
        }
        if (data.rightCheek) {
          if (data.rightCheek.top) cfg.rightCheek.top = parseInt(data.rightCheek.top) || DEFAULTS.rightCheek.top;
          if (data.rightCheek.right) cfg.rightCheek.right = parseInt(data.rightCheek.right) || DEFAULTS.rightCheek.right;
          if (data.rightCheek.width) cfg.rightCheek.width = parseInt(data.rightCheek.width) || DEFAULTS.rightCheek.width;
          if (data.rightCheek.height) cfg.rightCheek.height = parseInt(data.rightCheek.height) || DEFAULTS.rightCheek.height;
        }
        if (data.body && data.body.color) cfg.body.color = data.body.color;
        console.log('[FaceEditor] Loaded config from server', cfg);
      } catch(e) { console.warn('[FaceEditor] Could not load server config', e); }
    }

    // Save config to server (same format as desktop editor for cross-device compat)
    async function saveToServer(){
      const payload = {
        _manual: true,
        face: { top: cfg.face.top + '%', width: cfg.face.width + '%', height: cfg.face.height + '%', left: '50%', color: cfg.faceColor },
        leftEye: { top: cfg.leftEye.top + '%', left: cfg.leftEye.left + '%', width: cfg.leftEye.width + 'px', height: cfg.leftEye.height + 'px' },
        rightEye: { top: cfg.rightEye.top + '%', right: cfg.rightEye.right + '%', width: cfg.rightEye.width + 'px', height: cfg.rightEye.height + 'px' },
        mouth: { top: cfg.mouth.top + '%', width: cfg.mouth.width + 'px', height: cfg.mouth.height + 'px' },
        leftCheek: { top: cfg.leftCheek.top + '%', left: cfg.leftCheek.left + '%', width: cfg.leftCheek.width + 'px', height: cfg.leftCheek.height + 'px' },
        rightCheek: { top: cfg.rightCheek.top + '%', right: cfg.rightCheek.right + '%', width: cfg.rightCheek.width + 'px', height: cfg.rightCheek.height + 'px' },
        body: { color: cfg.body.color, width: '120px', height: '120px' },
      };
      try {
        await fetch(proxyBase + '/ui/face-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        console.log('[FaceEditor] Saved config to server');
      } catch(e) { console.warn('[FaceEditor] Save failed', e); }
    }

    // Toggle panel
    let editorOpen = false;
    function togglePanel(){
      editorOpen = !editorOpen;
      panel.style.display = editorOpen ? 'block' : 'none';
      if (editorOpen) {
        loadFromServer().then(() => { syncSlidersFromCfg(); applyToAvatar(); });
      }
    }
    openBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    if (closeBtn) closeBtn.addEventListener('click', () => { editorOpen = true; togglePanel(); });

    // Save
    if (saveBtn) saveBtn.addEventListener('click', () => {
      saveToServer();
      editorOpen = true; togglePanel(); // close panel
    });

    // Reset
    if (resetBtn) resetBtn.addEventListener('click', () => {
      cfg = JSON.parse(JSON.stringify(DEFAULTS));
      syncSlidersFromCfg();
      applyToAvatar();
    });

    // On page load, apply saved config — delay past the 450ms recenterAvatar timeout
    loadFromServer().then(() => {
      applyToAvatar();
      // Re-apply after recenterAvatar (450ms) and tightenFaceLayout (450ms + setTimeout 0) finish
      setTimeout(() => { applyToAvatar(); }, 600);
      setTimeout(() => { applyToAvatar(); }, 1200);
    });
  })();

})();
