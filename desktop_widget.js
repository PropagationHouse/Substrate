// ========== DESKTOP WIDGET — Substrate Electron App ==========
// Clock widget that runs in the Electron index.html context
// Chat uses same IPC channels as the main chat bar (execute-action → python-message)
// When active: hides main chat bar, avatar becomes freely draggable
// Toggled via radial config panel "Enable Widget" button

(function() {
    const STORAGE_KEY = 'deskWidgetState';
    const STYLE_KEY = 'deskWidgetStyle';
    const IMG_KEY = 'deskWidgetImg';
    const ENABLED_KEY = 'substrate:desktopWidgetEnabled';
    const FONTS = [
        "'Inter', sans-serif",
        "'SF Mono', 'Fira Code', monospace",
        "'Georgia', serif",
        "'Courier New', monospace",
        "system-ui, sans-serif"
    ];
    const FONT_LABELS = ['Inter', 'Mono', 'Serif', 'Courier', 'System'];
    const SWATCHES = ['#9fbecb','#e0e0e0','#d6cfe8','#cfe8d6','#e8d6cf','#cfdce8','#222','#333','#f5f0e1'];

    let hub = {
        x: null, y: null,
        fontIdx: 4,
        mode: 'timer',
        timerDuration: 25 * 60,
        timerRemaining: 25 * 60,
        timerRunning: false,
        swElapsed: 0,
        swRunning: false,
        collapsed: false,
        showTimer: false,
        showSettings: false
    };

    let style = {
        bg: '#9fbecb',
        accent: '#ababab',
        textColor: '',
        bloom: 8,
        intensity: 12,
        opacity: 76,
        width: 340,
        scale: 50,
        imgOpacity: 52,
        screenGlow: 9,
        screenBloom: 16,
        chatPos: 'auto',
        emotionGifs: {
            idle: [],
            speaking: [],
            laughing: [],
            angry: [],
            sleeping: [],
            yelling: [],
            searching: []
        }
    };
    let _currentEmotion = 'idle';
    let _emotionGifEl = null;
    let _emotionCycleInterval = null;
    let _emotionCycleIdx = 0;

    let timerIv = null, swIv = null, dragS = null;

    function load() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) { Object.assign(hub, JSON.parse(s)); hub.timerRunning = false; hub.swRunning = false; }
        } catch(e){}
        try {
            const st = localStorage.getItem(STYLE_KEY);
            if (st) Object.assign(style, JSON.parse(st));
        } catch(e){}
    }
    function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(hub)); } catch(e){} }
    function _apiBase() { return (window.proxyBase || 'http://localhost:8765'); }
    function saveStyle() {
        try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch(e){}
        // Sync to server so remote WebUI / dashboard can access emotion GIFs
        try { fetch(_apiBase() + '/ui/widget-style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style) }).catch(function(){}); } catch(e){}
    }
    function fmtD(sec) { sec=Math.abs(Math.floor(sec)); const h=Math.floor(sec/3600),m=String(Math.floor((sec%3600)/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0'); return h>0?`${h}:${m}:${s}`:`${m}:${s}`; }

    function luma(hex) {
        const c = hex.replace('#','');
        const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
        return (0.299*r + 0.587*g + 0.114*b) / 255;
    }
    function textColors(bg) {
        const dark = luma(bg) > 0.5;
        return {
            text: dark ? '#333' : '#eee',
            sub: dark ? '#777' : '#bbb',
            muted: dark ? '#999' : '#888',
            shadowDark: dark ? 'rgba(0,0,0,'+(.08+style.intensity*0.005)+')' : 'rgba(0,0,0,'+(.15+style.intensity*0.01)+')',
            shadowLight: dark ? 'rgba(255,255,255,'+(.5+style.intensity*0.015)+')' : 'rgba(255,255,255,'+(.05+style.intensity*0.003)+')',
            insetDark: dark ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.2)',
            insetLight: dark ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.05)'
        };
    }

    function applyStyle() {
        const el = document.getElementById('deskWidget');
        if (!el) return;
        const tc = textColors(style.bg);
        el.style.setProperty('--nh-bg', style.bg);
        // If user set a custom text color, override auto-detected colors
        if (style.textColor) {
            el.style.setProperty('--nh-text', style.textColor);
            el.style.setProperty('--nh-text-sub', style.textColor);
            el.style.setProperty('--nh-text-muted', style.textColor);
        } else {
            el.style.setProperty('--nh-text', tc.text);
            el.style.setProperty('--nh-text-sub', tc.sub);
            el.style.setProperty('--nh-text-muted', tc.muted);
        }
        el.style.setProperty('--nh-shadow-dark', tc.shadowDark);
        el.style.setProperty('--nh-shadow-light', tc.shadowLight);
        el.style.setProperty('--nh-inset-dark', tc.insetDark);
        el.style.setProperty('--nh-inset-light', tc.insetLight);
        el.style.setProperty('--nh-accent', style.accent);
        el.style.setProperty('--nh-bloom', style.bloom + 'px');
        el.style.setProperty('--nh-opacity', style.opacity / 100);
        el.style.setProperty('--nh-width', style.width + 'px');
        el.style.setProperty('--nh-scale', style.scale / 100);
        el.style.setProperty('--nh-img-opacity', style.imgOpacity / 100);
        el.style.setProperty('--nh-screen-glow', style.screenGlow + 'px');
        el.style.setProperty('--nh-screen-bloom', style.screenBloom + 'px');
    }

    function create() {
        const el = document.createElement('div');
        el.id = 'deskWidget';
        el.className = 'nh';
        if (hub.x !== null && hub.y !== null) { el.style.left = hub.x+'px'; el.style.top = hub.y+'px'; }
        else { el.style.right = '24px'; el.style.top = '60px'; }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'dwFileInput';
        fileInput.accept = 'image/*,.gif,.webp';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', handleImgUpload);

        el.innerHTML = `
            <div class="nh-card nh-top" id="dwDrag">
                <div class="nh-top-row">
                    <div class="nh-datetime">
                        <div class="nh-date" id="dwDate"></div>
                        <div class="nh-time" id="dwTime"></div>
                    </div>
                    <div class="nh-top-icons">
                        <button class="nh-icon-btn" onclick="dwCycleFont()" title="Font">Aa</button>
                        <button class="nh-icon-btn" onclick="dwToggleSettings()" title="Settings">⚙</button>
                        <button class="nh-icon-btn" onclick="dwToggleCollapse()" title="Collapse">—</button>
                    </div>
                </div>
            </div>
            <div id="dwBody">
                <div class="nh-bar">
                    <div class="nh-bar-text">
                        <span class="nh-bar-label" id="dwBarLabel">Active workspace</span>
                        <span class="nh-bar-value" id="dwBarValue">Substrate</span>
                    </div>
                    <div class="nh-bar-icons">
                        <button class="nh-bar-icon" onclick="dwToggleTimerMode()" title="Timer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3L2 6"/><path d="M22 6l-3-3"/><line x1="12" y1="1" x2="12" y2="3"/></svg></button>
                    </div>
                </div>
                <div class="nh-middle" id="dwMiddle">
                    <div class="nh-clock-wrap"><canvas id="dwAnalog" width="320" height="320" style="width:160px;height:160px;"></canvas></div>
                    <div class="nh-brand-card" id="dwBrandCard">
                        <div class="nh-screen" id="dwScreen">
                            <div class="nh-screen-inner" id="dwEmotionBox">
                                <img id="dwEmotionGif" src="" style="width:100%;height:100%;object-fit:cover;border-radius:14px;display:none;">
                                <span id="dwImgPlaceholder" style="font-size:2rem;">🎯</span>
                            </div>
                        </div>
                        <div class="nh-brand-name" id="dwBrandName">Substrate</div>
                    </div>
                </div>
                <div class="nh-timer-section" id="dwTimerSection" style="display:none;">
                    <div class="nh-timer-display" id="dwTimerDisp">25:00</div>
                    <div class="nh-timer-controls">
                        <button class="nh-pill-btn" id="dwTimerStartBtn" onclick="dwTimerStartStop()">▶</button>
                        <button class="nh-pill-btn" onclick="dwTimerReset()">↺</button>
                        <button class="nh-pill-btn" id="dwTimerModeBtn" onclick="dwSwitchTimerMode()">⏱ / ⏲</button>
                    </div>
                    <div class="nh-timer-label" id="dwTimerLabel">Timer · 25:00</div>
                </div>
                <div class="nh-bottom">
                    <div class="nh-chat-pill">
                        <div class="nh-mode-selector" id="dwModeSelector">
                            <button class="nh-mode-btn" data-mode="code" data-tooltip="Code" onclick="dwSetMode('code')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>
                            <button class="nh-mode-btn active" data-mode="ask" data-tooltip="Ask" onclick="dwSetMode('ask')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
                            <button class="nh-mode-btn" data-mode="plan" data-tooltip="Plan" onclick="dwSetMode('plan')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
                        </div>
                        <input type="text" id="dwChatInput" class="nh-chat-input" placeholder="ask anything..." autocomplete="off">
                        <button class="nh-mic-btn" id="dwMicBtn" onclick="dwToggleMic()" title="Voice input"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
                    </div>
                    <div class="nh-radial-hub" id="dwRadialHub">
                        <button class="nh-circle-btn nh-radial-trigger" id="dwRadialTrigger" title="Open Dashboard" onclick="dwOpenDashboard()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
                        <div class="nh-radial-ring" id="dwRadialRing">
                            <button class="nh-radial-item" data-idx="0" onclick="dwToggleMute()" title="Mute Microphone">၊၊||၊</button>
                            <button class="nh-radial-item" data-idx="1" onclick="dwToggleUserMsgs()" title="Toggle User Messages">U</button>
                            <button class="nh-radial-item" data-idx="2" onclick="dwElevenLabsCall()" title="ElevenLabs Call"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></button>
                            <button class="nh-radial-item" data-idx="3" onclick="dwOpenConfig()" title="Settings">📚</button>
                            <button class="nh-radial-item" data-idx="4" onclick="dwOpenDashboard()" title="Dashboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
                        </div>
                    </div>
                </div>
                <div class="nh-settings" id="dwSettings">
                    <div class="nh-settings-title">Customize</div>
                    <div class="nh-setting-row">
                        <label>Color</label>
                        <div class="nh-color-swatches" id="dwSwatches"></div>
                        <input type="color" id="dwColorPicker" value="${style.bg}" onchange="dwSetColor(this.value)">
                    </div>
                    <div class="nh-setting-row">
                        <label>Accent</label>
                        <input type="color" id="dwAccentPicker" value="${style.accent}" onchange="dwSetAccent(this.value)">
                    </div>
                    <div class="nh-setting-row">
                        <label>Bloom</label>
                        <input type="range" min="0" max="40" value="${style.bloom}" oninput="dwSetBloom(this.value)">
                        <span class="nh-val" id="dwBloomVal">${style.bloom}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Intensity</label>
                        <input type="range" min="0" max="30" value="${style.intensity}" oninput="dwSetIntensity(this.value)">
                        <span class="nh-val" id="dwIntensityVal">${style.intensity}</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Opacity</label>
                        <input type="range" min="30" max="100" value="${style.opacity}" oninput="dwSetOpacity(this.value)">
                        <span class="nh-val" id="dwOpacityVal">${style.opacity}%</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Width</label>
                        <input type="range" min="260" max="500" value="${style.width}" oninput="dwSetWidth(this.value)">
                        <span class="nh-val" id="dwWidthVal">${style.width}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scale</label>
                        <input type="range" min="50" max="150" value="${style.scale}" oninput="dwSetScale(this.value)">
                        <span class="nh-val" id="dwScaleVal">${style.scale}%</span>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Chat Reply</div>
                    <div class="nh-setting-row">
                        <label>Position</label>
                        <div class="nh-chat-pos-btns">
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='auto'?' active':''}" onclick="dwSetChatPos('auto')">Auto</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='left'?' active':''}" onclick="dwSetChatPos('left')">Left</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='right'?' active':''}" onclick="dwSetChatPos('right')">Right</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='top'?' active':''}" onclick="dwSetChatPos('top')">Top</button>
                        </div>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Text</div>
                    <div class="nh-setting-row">
                        <label>Color</label>
                        <input type="color" id="dwTextColorPicker" value="${style.textColor || '#333333'}" onchange="dwSetTextColor(this.value)">
                        <button class="nh-pill-btn" onclick="dwSetTextColor('')" style="font-size:0.55rem;">Auto</button>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Avatar Screen</div>
                    <div class="nh-setting-row">
                        <label>Img Alpha</label>
                        <input type="range" min="10" max="100" value="${style.imgOpacity}" oninput="dwSetImgOpacity(this.value)">
                        <span class="nh-val" id="dwImgOpacityVal">${style.imgOpacity}%</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scr Glow</label>
                        <input type="range" min="0" max="30" value="${style.screenGlow}" oninput="dwSetScreenGlow(this.value)">
                        <span class="nh-val" id="dwScreenGlowVal">${style.screenGlow}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scr Bloom</label>
                        <input type="range" min="0" max="40" value="${style.screenBloom}" oninput="dwSetScreenBloom(this.value)">
                        <span class="nh-val" id="dwScreenBloomVal">${style.screenBloom}px</span>
                    </div>
                    <div class="nh-setting-row" style="margin-top:8px;justify-content:center;">
                        <button class="nh-pill-btn" onclick="dwOpenEmotionPanel()" style="font-size:0.6rem;padding:4px 12px;">Emotion GIFs</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(fileInput);
        document.body.appendChild(el);

        // Build swatches
        const swatchContainer = el.querySelector('#dwSwatches');
        SWATCHES.forEach(c => {
            const s = document.createElement('div');
            s.className = 'nh-swatch' + (c === style.bg ? ' active' : '');
            s.style.background = c;
            s.onclick = () => dwSetColor(c);
            swatchContainer.appendChild(s);
        });

        document.getElementById('dwDrag').addEventListener('mousedown', dragStart);
        document.getElementById('dwChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') dwSendChat(); });

        // Radial panel hover logic — same pattern as main chat bar radial menu
        const radialHub = el.querySelector('#dwRadialHub');
        const radialTriggerEl = el.querySelector('#dwRadialTrigger');
        const radialRing = el.querySelector('#dwRadialRing');
        let _dwRadialTimeout;
        if (radialHub && radialTriggerEl && radialRing) {
            radialTriggerEl.addEventListener('mouseenter', () => {
                clearTimeout(_dwRadialTimeout);
                radialHub.classList.add('expanded');
            });
            radialRing.addEventListener('mouseenter', () => {
                clearTimeout(_dwRadialTimeout);
            });
            [radialTriggerEl, radialRing].forEach(target => {
                target.addEventListener('mouseleave', () => {
                    _dwRadialTimeout = setTimeout(() => {
                        if (!radialRing.matches(':hover') && !radialTriggerEl.matches(':hover')) {
                            radialHub.classList.remove('expanded');
                        }
                    }, 400);
                });
            });
        }

        // Triple-click to revert to normal view
        let _tripleClickCount = 0;
        let _tripleClickTimer = null;
        el.addEventListener('click', (e) => {
            // Ignore clicks on inputs, buttons, etc.
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA' ||
                e.target.closest('button') || e.target.closest('input') || e.target.closest('.nh-settings')) return;
            _tripleClickCount++;
            if (_tripleClickTimer) clearTimeout(_tripleClickTimer);
            _tripleClickTimer = setTimeout(() => { _tripleClickCount = 0; }, 500);
            if (_tripleClickCount >= 3) {
                _tripleClickCount = 0;
                // Revert to regular view
                localStorage.setItem(ENABLED_KEY, 'false');
                window.dispatchEvent(new CustomEvent('substrate:toggle-desktop-widget', { detail: { enabled: false } }));
                hideWidget();
            }
        });

        loadImg();
        return el;
    }

    // ---- IMAGE UPLOAD ----
    function handleImgUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            try { localStorage.setItem(IMG_KEY, dataUrl); } catch(e) {}
            renderImg(dataUrl);
        };
        reader.readAsDataURL(file);
    }
    function loadImg() {
        try {
            const d = localStorage.getItem(IMG_KEY);
            if (d) renderImg(d);
        } catch(e) {}
    }
    function renderImg(dataUrl) {
        const container = document.getElementById('dwBrandImg');
        if (!container) return;
        const placeholder = document.getElementById('dwImgPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        const old = container.querySelector('img');
        if (old) old.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
    }

    // ---- DRAG ----
    function dragStart(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        const el = document.getElementById('deskWidget');
        const r = el.getBoundingClientRect();
        if (!el.style.left || el.style.left === 'auto') {
            el.style.left = r.left + 'px';
            el.style.top = r.top + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
        dragS = { startMouseX: e.clientX, startMouseY: e.clientY, startLeft: r.left, startTop: r.top };
        el.classList.add('dragging');
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup', dragEnd);
        e.preventDefault();
    }
    function dragMove(e) {
        if (!dragS) return;
        const el = document.getElementById('deskWidget');
        const dx = e.clientX - dragS.startMouseX;
        const dy = e.clientY - dragS.startMouseY;
        el.style.left = Math.max(0, Math.min(window.innerWidth - 100, dragS.startLeft + dx)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - 50, dragS.startTop + dy)) + 'px';
    }
    function dragEnd() {
        if (!dragS) return;
        const el = document.getElementById('deskWidget');
        el.classList.remove('dragging');
        hub.x = parseInt(el.style.left);
        hub.y = parseInt(el.style.top);
        dragS = null;
        save();
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
    }

    // ---- ANALOG CLOCK ----
    function drawClock() {
        const c = document.getElementById('dwAnalog');
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const logicalW = 160, logicalH = 160;
        if (c.width !== logicalW * dpr || c.height !== logicalH * dpr) {
            c.width = logicalW * dpr; c.height = logicalH * dpr;
            c.style.width = logicalW + 'px'; c.style.height = logicalH + 'px';
        }
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w=logicalW, h=logicalH, cx=w/2, cy=h/2, r=Math.min(cx,cy)-10;
        const isDark = luma(style.bg) <= 0.5;
        ctx.clearRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
        ctx.fillStyle = style.bg; ctx.fill();
        const grad = ctx.createRadialGradient(cx-r*0.3, cy-r*0.3, r*0.1, cx, cy, r);
        grad.addColorStop(0, isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.05)');
        ctx.fillStyle = grad; ctx.fill();
        for (let i=0;i<12;i++) {
            const a=(i*30-90)*Math.PI/180, main=i%3===0;
            const i1=r-(main?14:9), o1=r-3;
            ctx.beginPath();
            ctx.moveTo(cx+i1*Math.cos(a), cy+i1*Math.sin(a));
            ctx.lineTo(cx+o1*Math.cos(a), cy+o1*Math.sin(a));
            ctx.strokeStyle = main ? (isDark?'rgba(255,255,255,0.4)':'#888') : (isDark?'rgba(255,255,255,0.15)':'#bbb');
            ctx.lineWidth = main ? 2 : 1; ctx.stroke();
        }
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.25)' : '#aaa';
        ctx.font = '10px Inter, system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        [{n:'12',a:-90},{n:'03',a:0},{n:'06',a:90},{n:'09',a:180}].forEach(({n,a})=>{
            const ang=a*Math.PI/180, nr=r-24;
            ctx.fillText(n, cx+nr*Math.cos(ang), cy+nr*Math.sin(ang));
        });
        const now=new Date(), hrs=now.getHours()%12, mins=now.getMinutes(), secs=now.getSeconds();
        const ha=((hrs+mins/60)*30-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.48)*Math.cos(ha), cy+(r*0.48)*Math.sin(ha));
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.75)' : '#333'; ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke();
        const ma=((mins+secs/60)*6-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.68)*Math.cos(ma), cy+(r*0.68)*Math.sin(ma));
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.55)' : '#555'; ctx.lineWidth=2; ctx.stroke();
        const sa=(secs*6-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.72)*Math.cos(sa), cy+(r*0.72)*Math.sin(sa));
        ctx.strokeStyle = style.accent; ctx.lineWidth=1; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2);
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : '#555'; ctx.fill();
        positionChatWall();
        requestAnimationFrame(drawClock);
    }

    // ---- DIGITAL ----
    function tick() {
        const now = new Date();
        const h=now.getHours(), m=String(now.getMinutes()).padStart(2,'0');
        const h12=h%12||12, ap=h>=12?'PM':'AM';
        const tel=document.getElementById('dwTime'), del=document.getElementById('dwDate');
        if (tel) tel.textContent = `${h12}:${m} ${ap}`;
        if (del) del.textContent = `${now.getMonth()+1}/${String(now.getDate()).padStart(2,'0')}`;
    }

    // ---- TIMER ----
    function toggleTimerMode() {
        hub.showTimer = !hub.showTimer;
        const ts=document.getElementById('dwTimerSection'), mid=document.getElementById('dwMiddle'), btn=document.getElementById('dwTimerToggleBtn');
        if (ts) ts.style.display = hub.showTimer ? 'flex' : 'none';
        if (mid) mid.style.display = hub.showTimer ? 'none' : 'flex';
        if (btn) btn.style.boxShadow = hub.showTimer ? 'inset 2px 2px 5px var(--nh-inset-dark), inset -2px -2px 5px var(--nh-inset-light)' : '';
        save();
    }
    function switchTimerMode() {
        hub.mode = hub.mode==='timer' ? 'stopwatch' : 'timer';
        clearInterval(timerIv); clearInterval(swIv);
        hub.timerRunning=false; hub.swRunning=false;
        hub.timerRemaining=hub.timerDuration; hub.swElapsed=0;
        updateTimer(); save();
    }
    function updateTimer() {
        const el=document.getElementById('dwTimerDisp'), lb=document.getElementById('dwTimerLabel'), sb=document.getElementById('dwTimerStartBtn'), mb=document.getElementById('dwTimerModeBtn');
        if (!el) return;
        if (hub.mode==='timer') {
            el.textContent=fmtD(hub.timerRemaining);
            lb.textContent=`Timer · ${hub.timerRunning?'Running':hub.timerRemaining<=0?'Done!':'Paused'}`;
            if(sb) sb.textContent=hub.timerRunning?'⏸':'▶';
            if(mb) mb.textContent='→ Stopwatch';
        } else {
            el.textContent=fmtD(hub.swElapsed);
            lb.textContent=`Stopwatch · ${hub.swRunning?'Running':'Stopped'}`;
            if(sb) sb.textContent=hub.swRunning?'⏸':'▶';
            if(mb) mb.textContent='→ Timer';
        }
    }
    function timerStartStop() {
        if (hub.mode==='timer') {
            if (hub.timerRunning) { clearInterval(timerIv); hub.timerRunning=false; }
            else { if(hub.timerRemaining<=0) hub.timerRemaining=hub.timerDuration; hub.timerRunning=true;
                timerIv=setInterval(()=>{ hub.timerRemaining--; updateTimer();
                    if(hub.timerRemaining<=0){clearInterval(timerIv);hub.timerRunning=false;updateTimer();}
                },1000);
            }
        } else {
            if (hub.swRunning){clearInterval(swIv);hub.swRunning=false;}
            else{hub.swRunning=true;swIv=setInterval(()=>{hub.swElapsed++;updateTimer();},1000);}
        }
        updateTimer(); save();
    }
    function timerReset() {
        if (hub.mode==='timer'){clearInterval(timerIv);hub.timerRunning=false;hub.timerRemaining=hub.timerDuration;}
        else{clearInterval(swIv);hub.swRunning=false;hub.swElapsed=0;}
        updateTimer(); save();
    }

    // ---- FONT ----
    function cycleFont() { hub.fontIdx=(hub.fontIdx+1)%FONTS.length; applyFont(); save(); }
    function applyFont() {
        const f=FONTS[hub.fontIdx];
        ['dwTime','dwTimerDisp'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.fontFamily=f; });
    }

    // ---- COLLAPSE ----
    function toggleCollapse() {
        const b=document.getElementById('dwBody'); if(!b) return;
        hub.collapsed = b.style.display!=='none';
        b.style.display = hub.collapsed ? 'none' : '';
        save();
    }

    // ---- SETTINGS ----
    function toggleSettings() {
        hub.showSettings = !hub.showSettings;
        const p = document.getElementById('dwSettings');
        if (p) p.classList.toggle('open', hub.showSettings);
        save();
    }
    function setColor(c) {
        style.bg = c;
        const picker = document.getElementById('dwColorPicker');
        if (picker) picker.value = c;
        document.querySelectorAll('#deskWidget .nh-swatch').forEach(s => s.classList.toggle('active', s.style.background === c || rgbToHex(s.style.background) === c));
        applyStyle(); saveStyle();
    }
    function setAccent(c) { style.accent = c; applyStyle(); saveStyle(); }
    function setBloom(v) { style.bloom = +v; const el=document.getElementById('dwBloomVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setIntensity(v) { style.intensity = +v; const el=document.getElementById('dwIntensityVal'); if(el) el.textContent = v; applyStyle(); saveStyle(); }
    function setOpacity(v) { style.opacity = +v; const el=document.getElementById('dwOpacityVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setWidth(v) { style.width = +v; const el=document.getElementById('dwWidthVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScale(v) { style.scale = +v; const el=document.getElementById('dwScaleVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setImgOpacity(v) { style.imgOpacity = +v; const el=document.getElementById('dwImgOpacityVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setScreenGlow(v) { style.screenGlow = +v; const el=document.getElementById('dwScreenGlowVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScreenBloom(v) { style.screenBloom = +v; const el=document.getElementById('dwScreenBloomVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }

    function rgbToHex(rgb) {
        if (!rgb || rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m || m.length < 3) return rgb;
        return '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('');
    }

    // ---- CHAT (IPC-based, same channel as main chat bar) ----
    let chatMessages = [];
    let chatContainer = null;
    let chatAutoHideTimer = null;
    let chatMode = 'ask';
    let _waitingForResponse = false;

    function getChatSide() {
        if (style.chatPos && style.chatPos !== 'auto') return style.chatPos;
        const el = document.getElementById('deskWidget');
        if (!el) return 'right';
        const rect = el.getBoundingClientRect();
        return (rect.left + rect.width / 2) < window.innerWidth / 2 ? 'right' : 'left';
    }

    function ensureChatContainer() {
        if (chatContainer) return chatContainer;
        chatContainer = document.createElement('div');
        chatContainer.id = 'dwChatWall';
        chatContainer.className = 'nh-chat-wall';
        chatContainer.innerHTML = '<div class="nh-chat-wall-inner" id="dwChatWallInner"></div>';
        document.body.appendChild(chatContainer);
        return chatContainer;
    }

    function addChatMessage(role, text) {
        if (role === 'assistant' && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].thinking) {
            chatMessages[chatMessages.length - 1] = { role, text };
        } else {
            chatMessages.push(role === 'thinking' ? { role: 'assistant', text, thinking: true } : { role, text });
        }
        renderChatMessages();
        showChatWall();
    }

    function renderChatMessages() {
        ensureChatContainer();
        const inner = document.getElementById('dwChatWallInner');
        if (!inner) return;
        inner.innerHTML = '';
        chatMessages.forEach(m => {
            const div = document.createElement('div');
            div.className = 'nh-chat-msg nh-chat-' + m.role;
            if (m.thinking) div.classList.add('nh-chat-thinking');
            div.textContent = m.text;
            inner.appendChild(div);
        });
        requestAnimationFrame(() => { inner.scrollTop = inner.scrollHeight; });
    }

    function showChatWall() {
        ensureChatContainer();
        chatContainer.classList.add('visible');
        if (chatAutoHideTimer) clearTimeout(chatAutoHideTimer);
        chatAutoHideTimer = setTimeout(() => {
            chatContainer.classList.remove('visible');
        }, 15000);
    }

    function positionChatWall() {
        if (!chatContainer) return;
        const el = document.getElementById('deskWidget');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const side = getChatSide();
        chatContainer.classList.remove('nh-wall-left', 'nh-wall-right', 'nh-wall-top');
        chatContainer.classList.add('nh-wall-' + side);
        if (side === 'top') {
            chatContainer.style.left = rect.left + 'px'; chatContainer.style.right = 'auto';
            chatContainer.style.top = 'auto'; chatContainer.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            chatContainer.style.maxHeight = Math.min(rect.top - 20, 300) + 'px';
            chatContainer.style.width = rect.width + 'px';
        } else if (side === 'right') {
            chatContainer.style.top = rect.top + 'px'; chatContainer.style.bottom = 'auto';
            chatContainer.style.left = (rect.right + 10) + 'px'; chatContainer.style.right = 'auto';
            chatContainer.style.maxHeight = Math.max(rect.height, 200) + 'px'; chatContainer.style.width = '';
        } else {
            chatContainer.style.top = rect.top + 'px'; chatContainer.style.bottom = 'auto';
            chatContainer.style.left = 'auto'; chatContainer.style.right = (window.innerWidth - rect.left + 10) + 'px';
            chatContainer.style.maxHeight = Math.max(rect.height, 200) + 'px'; chatContainer.style.width = '';
        }
    }

    function sendChat() {
        const inp = document.getElementById('dwChatInput');
        const msg = inp?.value?.trim();
        if (!msg) return;
        inp.value = '';
        addChatMessage('user', msg);
        addChatMessage('thinking', '...');
        _waitingForResponse = true;
        positionChatWall();

        // Send via same IPC channel as main chat bar
        if (window.api && window.api.send) {
            window.api.send('execute-action', {
                action: 'chat',
                text: msg,
                mode: chatMode
            });
        }
    }

    // Listen for responses via the same IPC channel as the main chat (python-message)
    // This is registered once and checks _waitingForResponse + widget visibility
    let _ipcListenerRegistered = false;
    function registerIPCListener() {
        if (_ipcListenerRegistered) return;
        if (!window.api || !window.api.receive) return;
        _ipcListenerRegistered = true;
        window.api.receive('python-message', function(data) {
            if (!_waitingForResponse) return;
            // Only process when widget is visible
            const el = document.getElementById('deskWidget');
            if (!el || el.style.display === 'none') return;
            if (!data || typeof data !== 'object') return;
            // Skip non-chat messages
            if (data.type === 'voice' || data.type === 'voice-audio' || data.type === 'avatar_emotions'
                || data.type === 'config' || data.type === 'user_message'
                || data.type === 'thinking' || data.type === 'thinking_start' || data.type === 'thinking_delta'
                || data.type === 'thinking_end' || data.type === 'transcript'
                || data.status === 'tool_executing' || data.status === 'tool_result'
                || data.status === 'tool_permission_required' || data.status === 'searching') return;

            const result = data.result || '';
            if (!result) return;
            const status = data.status;

            // Streaming update (replace_last means the backend is updating the current response)
            if (data.replace_last) {
                if (chatMessages.length > 0) {
                    chatMessages[chatMessages.length - 1] = { role: 'assistant', text: result, thinking: true };
                    renderChatMessages(); showChatWall();
                }
                return;
            }

            // Final response
            if (status === 'done' || status === 'success' || data.new_message) {
                if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].thinking) {
                    chatMessages[chatMessages.length - 1] = { role: 'assistant', text: result };
                } else {
                    chatMessages.push({ role: 'assistant', text: result });
                }
                renderChatMessages(); showChatWall();
                _waitingForResponse = false;
                return;
            }

            // Fallback: any other message with result text
            if (chatMessages.length > 0 && chatMessages[chatMessages.length - 1].thinking) {
                chatMessages[chatMessages.length - 1] = { role: 'assistant', text: result };
            } else {
                chatMessages.push({ role: 'assistant', text: result });
            }
            renderChatMessages(); showChatWall();
            _waitingForResponse = false;
        });
    }

    function setMode(m) {
        chatMode = m;
        document.querySelectorAll('#deskWidget .nh-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        const inp = document.getElementById('dwChatInput');
        if (inp) {
            const placeholders = { ask: 'ask anything...', code: 'write code...', plan: 'plan a task...' };
            inp.placeholder = placeholders[m] || 'ask anything...';
        }
    }
    function toggleMic() {
        // Use Electron IPC for voice if available
        if (window.api && window.api.send) {
            window.api.send('start-listening');
        }
        const btn = document.getElementById('dwMicBtn');
        if (btn) btn.classList.toggle('nh-mic-active');
    }
    function setChatPos(v) {
        style.chatPos = v;
        document.querySelectorAll('#deskWidget .nh-pos-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === v));
        saveStyle();
    }
    function setTextColor(v) {
        style.textColor = v;
        applyStyle();
        saveStyle();
    }
    // ---- EMOTION GIF SYSTEM ----
    const EMOTION_LABELS = {
        idle: { label: 'Idle', icon: '😐' },
        speaking: { label: 'Speaking', icon: '🗣️' },
        laughing: { label: 'Laughing', icon: '😂' },
        angry: { label: 'Angry', icon: '😡' },
        sleeping: { label: 'Sleeping', icon: '😴' },
        yelling: { label: 'Yelling', icon: '😱' },
        searching: { label: 'Searching', icon: '🔍' }
    };

    function setEmotionGif(emotion, idx, url) {
        if (!style.emotionGifs) style.emotionGifs = {};
        if (!style.emotionGifs[emotion]) style.emotionGifs[emotion] = [];
        // Grow array if needed
        while (style.emotionGifs[emotion].length <= idx) style.emotionGifs[emotion].push('');
        style.emotionGifs[emotion][idx] = url;
        // Trim trailing empty entries
        while (style.emotionGifs[emotion].length > 0 && !style.emotionGifs[emotion][style.emotionGifs[emotion].length - 1]) {
            style.emotionGifs[emotion].pop();
        }
        saveStyle();
        // If this is the current emotion, refresh display
        if (_currentEmotion === emotion) showEmotionGif(emotion);
        // Update the preview thumbnail in the panel if open
        const thumb = document.querySelector(`.nh-egif-thumb[data-emotion="${emotion}"][data-idx="${idx}"]`);
        if (thumb) {
            if (url && url.trim()) {
                thumb.src = url;
                thumb.style.display = 'block';
                const dropZone = thumb.closest('.nh-egif-slot');
                if (dropZone) { const ph = dropZone.querySelector('.nh-egif-drop-label'); if (ph) ph.style.display = 'none'; }
            } else {
                thumb.src = '';
                thumb.style.display = 'none';
                const dropZone = thumb.closest('.nh-egif-slot');
                if (dropZone) { const ph = dropZone.querySelector('.nh-egif-drop-label'); if (ph) ph.style.display = ''; }
            }
        }
    }

    function openEmotionPanel() {
        // If panel already exists, toggle visibility
        let panel = document.getElementById('dwEmotionPanel');
        if (panel) { panel.style.display = panel.style.display === 'none' ? '' : 'none'; return; }

        panel = document.createElement('div');
        panel.id = 'dwEmotionPanel';
        panel.className = 'nh-egif-panel';

        // Position near the widget
        const widget = document.getElementById('deskWidget');
        if (widget) {
            const wr = widget.getBoundingClientRect();
            panel.style.left = (wr.right + 12) + 'px';
            panel.style.top = wr.top + 'px';
        } else {
            panel.style.right = '20px';
            panel.style.top = '60px';
        }

        // Header
        const header = document.createElement('div');
        header.className = 'nh-egif-header';
        header.innerHTML = '<span class="nh-egif-title">Emotion GIFs</span>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'nh-egif-close';
        closeBtn.textContent = '✕';
        closeBtn.onclick = () => { panel.style.display = 'none'; };
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Make header draggable
        let _epDrag = null;
        header.addEventListener('mousedown', (e) => {
            if (e.target === closeBtn) return;
            const r = panel.getBoundingClientRect();
            _epDrag = { sx: e.clientX, sy: e.clientY, sl: r.left, st: r.top };
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!_epDrag) return;
            panel.style.left = (_epDrag.sl + e.clientX - _epDrag.sx) + 'px';
            panel.style.top = (_epDrag.st + e.clientY - _epDrag.sy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { _epDrag = null; });

        // Scrollable body
        const body = document.createElement('div');
        body.className = 'nh-egif-body';

        // Current emotion indicator
        const indicator = document.createElement('div');
        indicator.className = 'nh-egif-indicator';
        indicator.id = 'dwEmotionIndicator';
        indicator.textContent = 'Current: ' + (_currentEmotion || 'idle');
        body.appendChild(indicator);

        // Helper: update the count badge for a section header
        function _updateCount(sHead, emotion) {
            const g = style.emotionGifs?.[emotion] || [];
            const c = g.filter(u => u && u.trim()).length;
            const el = sHead.querySelector('.nh-egif-count');
            if (el) el.textContent = c + ' set';
        }

        // Helper: create a single drop-slot for an emotion at a given index
        function _createSlot(emotion, idx, sBody, sHead) {
            const gifs = style.emotionGifs?.[emotion] || [];
            const slot = document.createElement('div');
            slot.className = 'nh-egif-slot';
            slot.dataset.emotion = emotion;
            slot.dataset.idx = idx;

            const dropLabel = document.createElement('div');
            dropLabel.className = 'nh-egif-drop-label';
            dropLabel.textContent = 'Drop GIF\nor click';
            slot.appendChild(dropLabel);

            const thumb = document.createElement('img');
            thumb.className = 'nh-egif-thumb';
            thumb.dataset.emotion = emotion;
            thumb.dataset.idx = idx;
            const currentUrl = gifs[idx] || '';
            if (currentUrl) {
                thumb.src = currentUrl;
                thumb.style.display = 'block';
                dropLabel.style.display = 'none';
            } else {
                thumb.style.display = 'none';
            }
            slot.appendChild(thumb);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'nh-egif-remove';
            removeBtn.textContent = '✕';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                dwSetEmotionGif(emotion, idx, '');
                thumb.src = ''; thumb.style.display = 'none';
                dropLabel.style.display = '';
                _updateCount(sHead, emotion);
            };
            slot.appendChild(removeBtn);

            slot.addEventListener('click', (e) => {
                if (e.target === removeBtn) return;
                const fi = document.createElement('input');
                fi.type = 'file'; fi.accept = 'image/gif,image/*';
                fi.onchange = (ev) => {
                    const file = ev.target.files[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (re) => {
                        dwSetEmotionGif(emotion, idx, re.target.result);
                        _updateCount(sHead, emotion);
                    };
                    reader.readAsDataURL(file);
                };
                fi.click();
            });

            slot.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.add('nh-egif-dragover'); });
            slot.addEventListener('dragleave', () => { slot.classList.remove('nh-egif-dragover'); });
            slot.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                slot.classList.remove('nh-egif-dragover');
                const file = e.dataTransfer.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (re) => {
                    dwSetEmotionGif(emotion, idx, re.target.result);
                    _updateCount(sHead, emotion);
                };
                reader.readAsDataURL(file);
            });

            return slot;
        }

        // Build collapsible sections for each emotion
        for (const [emotion, meta] of Object.entries(EMOTION_LABELS)) {
            const section = document.createElement('div');
            section.className = 'nh-egif-section';

            const sHead = document.createElement('div');
            sHead.className = 'nh-egif-section-head';
            const gifs = style.emotionGifs?.[emotion] || [];
            const count = gifs.filter(u => u && u.trim()).length;
            sHead.innerHTML = `<span>${meta.icon} ${meta.label}</span><span class="nh-egif-count">${count} set</span><span class="nh-egif-chevron">▶</span>`;
            sHead.onclick = () => {
                section.classList.toggle('open');
                const chev = sHead.querySelector('.nh-egif-chevron');
                if (chev) chev.textContent = section.classList.contains('open') ? '▼' : '▶';
            };
            section.appendChild(sHead);

            const sBody = document.createElement('div');
            sBody.className = 'nh-egif-section-body';

            // Slot container (so "Add" and "Preview" stay below)
            const slotWrap = document.createElement('div');
            slotWrap.className = 'nh-egif-slot-wrap';

            // Show max(existing count, 3) slots
            const initialSlots = Math.max(gifs.length, 3);
            let _nextIdx = initialSlots;
            for (let i = 0; i < initialSlots; i++) {
                slotWrap.appendChild(_createSlot(emotion, i, sBody, sHead));
            }
            sBody.appendChild(slotWrap);

            // Button row: Add + Preview
            const btnRow = document.createElement('div');
            btnRow.className = 'nh-egif-btn-row';

            const addBtn = document.createElement('button');
            addBtn.className = 'nh-egif-test-btn';
            addBtn.textContent = '+ Add Variant';
            addBtn.onclick = () => {
                const newSlot = _createSlot(emotion, _nextIdx, sBody, sHead);
                slotWrap.appendChild(newSlot);
                _nextIdx++;
            };
            btnRow.appendChild(addBtn);

            const testBtn = document.createElement('button');
            testBtn.className = 'nh-egif-test-btn';
            testBtn.textContent = '▶ Preview';
            testBtn.onclick = () => { showEmotionGif(emotion); };
            btnRow.appendChild(testBtn);

            sBody.appendChild(btnRow);
            section.appendChild(sBody);
            body.appendChild(section);
        }

        panel.appendChild(body);
        document.body.appendChild(panel);
    }

    function _applyGifToScreen(url) {
        const gifEl = document.getElementById('dwEmotionGif');
        const placeholder = document.getElementById('dwImgPlaceholder');
        if (!gifEl) return;
        if (url) {
            gifEl.src = url;
            gifEl.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            gifEl.src = '';
            gifEl.style.display = 'none';
            if (placeholder) placeholder.style.display = '';
        }
    }

    function showEmotionGif(emotion) {
        // Stop any existing cycle
        if (_emotionCycleInterval) { clearInterval(_emotionCycleInterval); _emotionCycleInterval = null; }

        _currentEmotion = emotion;
        _emotionCycleIdx = 0;

        // Update indicator in the panel if open
        const ind = document.getElementById('dwEmotionIndicator');
        if (ind) {
            const meta = EMOTION_LABELS[emotion];
            ind.textContent = 'Current: ' + (meta ? meta.icon + ' ' + meta.label : emotion);
        }

        const gifs = style.emotionGifs?.[emotion] || [];
        const available = gifs.filter(u => u && u.trim());

        if (available.length === 0) {
            // No GIF for this emotion — try idle fallback
            if (emotion !== 'idle') {
                const idleGifs = (style.emotionGifs?.idle || []).filter(u => u && u.trim());
                if (idleGifs.length > 0) {
                    _applyGifToScreen(idleGifs[0]);
                    if (idleGifs.length > 1) _startGifCycle(idleGifs);
                    return;
                }
            }
            _applyGifToScreen(null);
            return;
        }

        // Show first GIF immediately
        _applyGifToScreen(available[0]);
        // If multiple, start cycling
        if (available.length > 1) _startGifCycle(available);
    }

    function _startGifCycle(gifList) {
        _emotionCycleIdx = 0;
        _emotionCycleInterval = setInterval(() => {
            _emotionCycleIdx = (_emotionCycleIdx + 1) % gifList.length;
            _applyGifToScreen(gifList[_emotionCycleIdx]);
        }, 5000 + Math.floor(Math.random() * 3000)); // 5-8 seconds per variant
    }

    // Map main avatar emotions to our GIF categories
    function mapEmotionToGifCategory(emotion) {
        const map = {
            'idle': 'idle',
            'talking': 'speaking',
            'speaking': 'speaking',
            'happy': 'speaking',
            'smiling': 'speaking',
            'excited': 'speaking',
            'laughing': 'laughing',
            'angry': 'angry',
            'sad': 'sleeping',
            'sleepy': 'sleeping',
            'sleeping': 'sleeping',
            'surprised': 'yelling',
            'yelling': 'yelling',
            'confused': 'idle',
            'skeptical': 'idle',
            'searching': 'searching',
            'thinking': 'idle'
        };
        return map[emotion] || 'idle';
    }

    // Register emotion listener (hooks into same IPC as main avatar)
    let _emotionListenerRegistered = false;
    function registerEmotionListener() {
        if (_emotionListenerRegistered) return;
        if (!window.api || !window.api.receive) return;
        _emotionListenerRegistered = true;

        window.api.receive('python-message', function(data) {
            if (!data || typeof data !== 'object') return;
            const el = document.getElementById('deskWidget');
            if (!el) return;

            // Voice status → speaking/idle
            if (data.type === 'voice' || data.type === 'voice-audio') {
                if (data.status === 'start' || data.status === 'speaking') {
                    showEmotionGif('speaking');
                } else if (data.status === 'end' || data.status === 'stopped') {
                    showEmotionGif('idle');
                }
                return;
            }

            // Avatar emotion messages from backend
            if (data.type === 'avatar_emotions' && data.emotions) {
                const emotions = data.emotions;
                if (Array.isArray(emotions) && emotions.length > 0) {
                    const primary = emotions[0].emotion || emotions[0];
                    const category = mapEmotionToGifCategory(primary);
                    showEmotionGif(category);
                }
                return;
            }

            // Searching status
            if (data.status === 'searching' || data.status === 'tool_executing') {
                showEmotionGif('searching');
                return;
            }
        });

        // Also listen for showEmotion calls from the main avatar (DOM-level)
        // Poll the avatar's state every 2s as a fallback sync
        setInterval(() => {
            if (!window.avatar) return;
            const avatarState = window.avatar.state;
            if (avatarState) {
                const category = mapEmotionToGifCategory(avatarState);
                if (category !== _currentEmotion) {
                    showEmotionGif(category);
                }
            }
        }, 2000);
    }

    // Radial menu toggle (called via inline onclick)
    let _radialCloseTimer = null;
    function toggleRadial(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        const hub = document.getElementById('dwRadialHub');
        if (!hub) return;
        hub.classList.toggle('expanded');
        if (_radialCloseTimer) clearTimeout(_radialCloseTimer);
        if (hub.classList.contains('expanded')) {
            _radialCloseTimer = setTimeout(() => { hub.classList.remove('expanded'); }, 4000);
        }
    }

    let _dwMuted = false;
    function toggleMute() {
        _dwMuted = !_dwMuted;
        if (window.api && window.api.send) {
            window.api.send(_dwMuted ? 'stop-listening' : 'start-listening');
        }
        // Update the radial item appearance
        const items = document.querySelectorAll('#dwRadialRing .nh-radial-item[data-idx="0"]');
        items.forEach(b => {
            b.textContent = _dwMuted ? '🕨' : '၊၊||၊';
            b.title = _dwMuted ? 'Unmute Microphone' : 'Mute Microphone';
        });
    }
    function toggleUserMsgs() {
        // Toggle user messages visibility in the widget's own chat wall
        const wall = document.querySelector('.nh-chat-wall');
        if (wall) wall.classList.toggle('hide-user-msgs');
        // Also toggle on main output if accessible
        const output = document.getElementById('output');
        if (output) output.classList.toggle('hide-user-messages');
        // Sync global flag
        if (typeof window.showUserMessages !== 'undefined') {
            window.showUserMessages = !window.showUserMessages;
        }
    }
    function elevenLabsCall() {
        // Send ElevenLabs call command via IPC
        if (window.api && window.api.send) {
            window.api.send('execute-action', { action: 'command', text: '/call' });
        }
    }
    function openConfig() {
        // Prefer the radial config panel (new-style settings wheel)
        if (typeof window.showRadialConfigPanel === 'function') {
            const radialPanel = document.getElementById('radial-config-panel');
            if (radialPanel && radialPanel.classList.contains('active')) {
                window.hideRadialConfigPanel();
            } else {
                window.showRadialConfigPanel();
            }
            return;
        }
        // Fallback: use the global toggleConfigPanel
        if (typeof window.toggleConfigPanel === 'function') {
            window.toggleConfigPanel();
            return;
        }
    }
    function openDashboard() {
        // Open dashboard in a new tab/window via shell or direct navigation
        const dashboardUrl = (window.proxyBase || 'http://localhost:8765') + '/dashboard';
        if (window.api && window.api.send) {
            window.api.send('execute-action', { action: 'command', text: '/dashboard' });
        }
        // Also try opening via shell/window
        try { window.open(dashboardUrl, '_blank'); } catch(_) {}
    }

    // ---- INIT & VISIBILITY ----
    let _inited = false;
    function init() {
        if (_inited) return;
        _inited = true;
        load(); create(); applyStyle(); applyFont(); tick(); updateTimer();
        setInterval(tick, 1000); drawClock();
        if (hub.collapsed) { const b=document.getElementById('dwBody'); if(b) b.style.display='none'; }
        if (hub.showTimer) toggleTimerMode();
        if (hub.showSettings) { const p=document.getElementById('dwSettings'); if(p) p.classList.add('open'); }
        // Sync current style (including emotionGifs) to server on init
        // so dashboard/webui can read it — previous saves may have silently failed
        saveStyle();
        // Radial hub: expand on hover (matching main chat bar behavior)
        const _dwHub = document.getElementById('dwRadialHub');
        if (_dwHub) {
            let _dwHubTimer = null;
            _dwHub.addEventListener('mouseenter', () => {
                if (_dwHubTimer) clearTimeout(_dwHubTimer);
                _dwHub.classList.add('expanded');
            });
            _dwHub.addEventListener('mouseleave', () => {
                _dwHubTimer = setTimeout(() => { _dwHub.classList.remove('expanded'); }, 400);
            });
        }
    }

    // Aggressively hide/show main UI elements for widget mode
    let _widgetModeCleanupInterval = null;
    const _HIDE_STYLE = 'display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important;pointer-events:none!important;';
    function hideMainUI() {
        // Hide the main chat bar (not the avatar container)
        const chatBar = document.querySelector('#input-container > .chat-input-container');
        if (chatBar) chatBar.setAttribute('style', _HIDE_STYLE);
        // Hide the main chat output — this is the big one that shows regular chat messages
        const output = document.getElementById('output');
        if (output) output.setAttribute('style', _HIDE_STYLE);
        // Hide thinking indicator
        const thinking = document.getElementById('thinking-indicator');
        if (thinking) thinking.setAttribute('style', _HIDE_STYLE);
        // Hide image/file previews
        const imgPrev = document.getElementById('image-preview');
        if (imgPrev) imgPrev.setAttribute('style', _HIDE_STYLE);
        const filePrev = document.getElementById('file-preview');
        if (filePrev) filePrev.setAttribute('style', _HIDE_STYLE);
        // Hide any debug messages or activity panels that render on top
        document.querySelectorAll('.debug-message, .agent-activity-panel').forEach(el => {
            el.style.display = 'none';
        });
    }
    function restoreMainUI() {
        const chatBar = document.querySelector('#input-container > .chat-input-container');
        if (chatBar) chatBar.removeAttribute('style');
        const output = document.getElementById('output');
        if (output) output.removeAttribute('style');
        const thinking = document.getElementById('thinking-indicator');
        if (thinking) thinking.removeAttribute('style');
        // Don't restore #file-preview — its CSS default is display:none, only JS shows it when a file is attached
    }

    function showWidget() {
        if (!_inited) init();
        const el = document.getElementById('deskWidget');
        if (el) {
            el.style.display = '';
            el.style.visibility = '';
            el.style.opacity = '';
            el.style.pointerEvents = '';
        }
        // Restore chat wall container if it was hidden
        if (chatContainer) {
            chatContainer.style.display = '';
            chatContainer.style.visibility = '';
        }
        applyStyle();
        hideMainUI();
        // Keep hiding main UI periodically (debug_renderer's aggressiveCleanup can re-show things)
        if (!_widgetModeCleanupInterval) {
            _widgetModeCleanupInterval = setInterval(hideMainUI, 2000);
        }
        // Make the avatar freely draggable
        enableAvatarDrag();
        // Register IPC listener for chat responses (registers only once)
        registerIPCListener();
        // Register emotion GIF listener and show initial state
        registerEmotionListener();
        showEmotionGif('idle');
    }
    function hideWidget() {
        // Remove the widget element from the DOM entirely to prevent any visual artifact
        const el = document.getElementById('deskWidget');
        if (el) el.remove();
        // Stop emotion GIF cycling
        if (_emotionCycleInterval) { clearInterval(_emotionCycleInterval); _emotionCycleInterval = null; }
        // Remove the emotion GIF panel if open
        const egp = document.getElementById('dwEmotionPanel');
        if (egp) egp.remove();
        // Remove the chat wall from DOM
        if (chatContainer) {
            chatContainer.remove();
            chatContainer = null;
        }
        // Also remove the file input helper
        const fi = document.getElementById('dwFileInput');
        if (fi) fi.remove();
        // Reset init flag so widget can be re-created if re-enabled
        _inited = false;
        restoreMainUI();
        // Stop the periodic cleanup
        if (_widgetModeCleanupInterval) {
            clearInterval(_widgetModeCleanupInterval);
            _widgetModeCleanupInterval = null;
        }
        // Disable avatar drag
        disableAvatarDrag();
        // IPC listener stays registered but checks widget visibility before processing
        _waitingForResponse = false;
    }

    // ---- AVATAR DRAG (when widget mode is on) ----
    let _avatarDragState = null;
    let _avatarDragEnabled = false;
    function enableAvatarDrag() {
        if (_avatarDragEnabled) return;
        _avatarDragEnabled = true;
        // Find the animated avatar (the main character element)
        const tryAttach = () => {
            const avatar = document.querySelector('.animated-avatar') || document.querySelector('#avatar-container img') || document.querySelector('.current-avatar');
            if (!avatar) { setTimeout(tryAttach, 500); return; }
            // Make it draggable
            avatar.style.cursor = 'grab';
            avatar.style.position = 'fixed';
            avatar.style.zIndex = '9998';
            avatar.style.pointerEvents = 'auto';
            // Restore saved position
            const savedPos = localStorage.getItem('substrate:avatarDragPos');
            if (savedPos) {
                try {
                    const { x, y } = JSON.parse(savedPos);
                    avatar.style.left = x + 'px';
                    avatar.style.top = y + 'px';
                    avatar.style.bottom = 'auto';
                    avatar.style.right = 'auto';
                } catch(e) {}
            }
            // Disable the avatar's built-in autonomous movement so it doesn't fight our positioning
            if (window.avatar && window.avatar.autonomousMovementEnabled !== undefined) {
                avatar._dwSavedAutonomous = window.avatar.autonomousMovementEnabled;
                window.avatar.autonomousMovementEnabled = false;
            }
            avatar._dwMouseDown = (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = avatar.getBoundingClientRect();
                _avatarDragState = {
                    startX: e.clientX, startY: e.clientY,
                    startLeft: rect.left, startTop: rect.top
                };
                avatar.style.cursor = 'grabbing';
                document.addEventListener('mousemove', avatar._dwMouseMove);
                document.addEventListener('mouseup', avatar._dwMouseUp);
            };
            avatar._dwMouseMove = (e) => {
                if (!_avatarDragState) return;
                const dx = e.clientX - _avatarDragState.startX;
                const dy = e.clientY - _avatarDragState.startY;
                const newLeft = Math.max(-50, Math.min(window.innerWidth - 50, _avatarDragState.startLeft + dx));
                const newTop = Math.max(-50, Math.min(window.innerHeight - 50, _avatarDragState.startTop + dy));
                avatar.style.left = newLeft + 'px';
                avatar.style.top = newTop + 'px';
                avatar.style.bottom = 'auto';
                avatar.style.right = 'auto';
            };
            avatar._dwMouseUp = () => {
                if (_avatarDragState) {
                    const left = parseInt(avatar.style.left);
                    const top = parseInt(avatar.style.top);
                    localStorage.setItem('substrate:avatarDragPos', JSON.stringify({ x: left, y: top }));
                }
                _avatarDragState = null;
                avatar.style.cursor = 'grab';
                document.removeEventListener('mousemove', avatar._dwMouseMove);
                document.removeEventListener('mouseup', avatar._dwMouseUp);
            };
            avatar.addEventListener('mousedown', avatar._dwMouseDown);
            avatar._dwAttached = true;
        };
        tryAttach();
    }
    function disableAvatarDrag() {
        _avatarDragEnabled = false;
        const avatar = document.querySelector('.animated-avatar') || document.querySelector('#avatar-container img') || document.querySelector('.current-avatar');
        if (avatar && avatar._dwAttached) {
            avatar.removeEventListener('mousedown', avatar._dwMouseDown);
            document.removeEventListener('mousemove', avatar._dwMouseMove);
            document.removeEventListener('mouseup', avatar._dwMouseUp);
            avatar.style.cursor = '';
            avatar.style.position = '';
            avatar.style.zIndex = '';
            avatar.style.left = '';
            avatar.style.top = '';
            avatar.style.bottom = '';
            avatar.style.right = '';
            // Restore the avatar's autonomous movement
            if (window.avatar && avatar._dwSavedAutonomous !== undefined) {
                window.avatar.autonomousMovementEnabled = avatar._dwSavedAutonomous;
            }
            avatar._dwAttached = false;
        }
    }

    // Check localStorage for enabled state
    function checkEnabled() {
        const enabled = JSON.parse(localStorage.getItem(ENABLED_KEY) || 'false');
        if (enabled) showWidget(); else hideWidget();
    }

    // Listen for toggle events from the config panel (same window context)
    window.addEventListener('substrate:toggle-desktop-widget', function(e) {
        const enabled = e.detail?.enabled;
        if (enabled) showWidget(); else hideWidget();
    });

    // One-time migration: clear the force-enabled flag that the old debug code set.
    // Without this, users updating from .13→.15 would have widget mode silently active.
    const _MIGRATION_KEY = 'substrate:dwForceEnableMigrated';
    if (!localStorage.getItem(_MIGRATION_KEY)) {
        localStorage.removeItem(ENABLED_KEY);
        localStorage.setItem(_MIGRATION_KEY, '1');
    }

    // Initialize on DOM ready — respect the user's stored preference
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(checkEnabled, 1500);
    });

    // Expose global functions
    window.dwCycleFont = cycleFont;
    window.dwToggleTimerMode = toggleTimerMode;
    window.dwSwitchTimerMode = switchTimerMode;
    window.dwTimerStartStop = timerStartStop;
    window.dwTimerReset = timerReset;
    window.dwToggleCollapse = toggleCollapse;
    window.dwToggleSettings = toggleSettings;
    window.dwSendChat = sendChat;
    window.dwSetColor = setColor;
    window.dwSetAccent = setAccent;
    window.dwSetBloom = setBloom;
    window.dwSetIntensity = setIntensity;
    window.dwSetOpacity = setOpacity;
    window.dwSetWidth = setWidth;
    window.dwSetScale = setScale;
    window.dwSetImgOpacity = setImgOpacity;
    window.dwSetScreenGlow = setScreenGlow;
    window.dwSetScreenBloom = setScreenBloom;
    window.dwSetChatPos = setChatPos;
    window.dwSetTextColor = setTextColor;
    window.dwSetMode = setMode;
    window.dwToggleMic = toggleMic;
    window.dwToggleMute = toggleMute;
    window.dwToggleUserMsgs = toggleUserMsgs;
    window.dwElevenLabsCall = elevenLabsCall;
    window.dwToggleRadial = toggleRadial;
    window.dwSetEmotionGif = setEmotionGif;
    window.dwShowEmotionGif = showEmotionGif;
    window.dwOpenEmotionPanel = openEmotionPanel;
    window.dwOpenConfig = openConfig;
    window.dwOpenDashboard = openDashboard;
    window.dwShowWidget = showWidget;
    window.dwHideWidget = hideWidget;
})();
