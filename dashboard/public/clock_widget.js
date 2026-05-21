// ========== COMMAND HUB WIDGET — Substrate Dashboard Root Level ==========
// Neumorphic draggable widget that persists across all windows/panels
// Renders at document.body level, above all FloatingWindows

(function() {
    const STORAGE_KEY = 'cmdHubState';
    const STYLE_KEY = 'cmdHubStyle';
    const IMG_KEY = 'cmdHubImg';
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
        showSettings: false,
        closed: false
    };

    let style = {
        bg: '#9fbecb',
        accent: '#ababab',
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
            thinking: [],
            excited: [],
            searching: []
        }
    };

    let timerIv = null, swIv = null, dragS = null;
    let _currentEmotion = 'idle';
    let _emotionGifEl = null;
    let _emotionCycleInterval = null;
    let _emotionCycleIdx = 0;

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
    function saveStyle() {
        try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch(e){}
        // Sync to server so other interfaces (WebUI, Electron) can access emotion GIFs
        try { fetch('/ui/widget-style', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style) }).catch(function(){}); } catch(e){}
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
        const el = document.getElementById('cmdHub');
        if (!el) return;
        const tc = textColors(style.bg);
        el.style.setProperty('--nh-bg', style.bg);
        el.style.setProperty('--nh-text', tc.text);
        el.style.setProperty('--nh-text-sub', tc.sub);
        el.style.setProperty('--nh-text-muted', tc.muted);
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
        el.id = 'cmdHub';
        el.className = 'nh';
        if (hub.x !== null && hub.y !== null) { el.style.left = hub.x+'px'; el.style.top = hub.y+'px'; }
        else { el.style.right = '24px'; el.style.top = '60px'; }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'nhFileInput';
        fileInput.accept = 'image/*,.gif,.webp';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', handleImgUpload);

        el.innerHTML = `
            <div class="nh-card nh-top" id="nhDrag">
                <div class="nh-top-row">
                    <div class="nh-datetime">
                        <div class="nh-date" id="nhDate"></div>
                        <div class="nh-time" id="nhTime"></div>
                    </div>
                    <div class="nh-top-icons">
                        <button class="nh-icon-btn" onclick="hubCycleFont()" title="Font">Aa</button>
                        <button class="nh-icon-btn" onclick="hubToggleSettings()" title="Settings">⚙</button>
                        <button class="nh-icon-btn" onclick="hubToggleCollapse()" title="Collapse">—</button>
                        <button class="nh-icon-btn" onclick="hubCloseWidget()" title="Close widget" style="font-size:0.65rem;">✕</button>
                    </div>
                </div>
            </div>
            <div id="nhBody">
                <div class="nh-bar">
                    <div class="nh-bar-text">
                        <span class="nh-bar-label" id="nhBarLabel">Active workspace</span>
                        <span class="nh-bar-value" id="nhBarValue">Substrate</span>
                    </div>
                    <div class="nh-bar-icons">
                        <button class="nh-bar-icon" onclick="document.getElementById('nhFileInput').click()" title="Set image">🖼</button>
                        <button class="nh-bar-icon" onclick="hubToggleTimerMode()" title="Timer">⏱</button>
                    </div>
                </div>
                <div class="nh-middle" id="nhMiddle">
                    <div class="nh-clock-wrap"><canvas id="nhAnalog" width="320" height="320" style="width:160px;height:160px;"></canvas></div>
                    <div class="nh-brand-card" id="nhBrandCard">
                        <div class="nh-screen" id="nhScreen">
                            <div class="nh-screen-inner" id="nhBrandImg" onclick="document.getElementById('nhFileInput').click()">
                                <img id="nhEmotionGif" src="" style="width:100%;height:100%;object-fit:cover;border-radius:14px;display:none;">
                                <span id="nhImgPlaceholder" style="font-size:2rem;">🎯</span>
                            </div>
                        </div>
                        <div class="nh-brand-name" id="nhBrandName">Substrate</div>
                    </div>
                </div>
                <div class="nh-timer-section" id="nhTimerSection" style="display:none;">
                    <div class="nh-timer-display" id="nhTimerDisp">25:00</div>
                    <div class="nh-timer-controls">
                        <button class="nh-pill-btn" id="nhTimerStartBtn" onclick="hubTimerStartStop()">▶</button>
                        <button class="nh-pill-btn" onclick="hubTimerReset()">↺</button>
                        <button class="nh-pill-btn" id="nhTimerModeBtn" onclick="hubSwitchTimerMode()">⏱ / ⏲</button>
                    </div>
                    <div class="nh-timer-label" id="nhTimerLabel">Timer · 25:00</div>
                </div>
                <div class="nh-bottom">
                    <div class="nh-chat-pill">
                        <div class="nh-mode-selector" id="nhModeSelector">
                            <button class="nh-mode-btn active" data-mode="ask" onclick="hubSetMode('ask')" title="Ask"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 12l-4 2.5 1.5-4.5L6 7.5h4.5z"/></svg></button>
                            <button class="nh-mode-btn" data-mode="code" onclick="hubSetMode('code')" title="Code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>
                            <button class="nh-mode-btn" data-mode="plan" onclick="hubSetMode('plan')" title="Plan"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
                        </div>
                        <input type="text" id="nhChatInput" class="nh-chat-input" placeholder="ask anything..." autocomplete="off">
                        <button class="nh-mic-btn" id="nhMicBtn" onclick="hubToggleMic()" title="Voice input"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
                    </div>
                    <button class="nh-circle-btn" id="nhTimerToggleBtn" onclick="hubToggleTimerMode()" title="Timer">⏱</button>
                </div>
                <div class="nh-settings" id="nhSettings">
                    <div class="nh-settings-title">Customize</div>
                    <div class="nh-setting-row">
                        <label>Color</label>
                        <div class="nh-color-swatches" id="nhSwatches"></div>
                        <input type="color" id="nhColorPicker" value="${style.bg}" onchange="hubSetColor(this.value)">
                    </div>
                    <div class="nh-setting-row">
                        <label>Accent</label>
                        <input type="color" id="nhAccentPicker" value="${style.accent}" onchange="hubSetAccent(this.value)">
                    </div>
                    <div class="nh-setting-row">
                        <label>Bloom</label>
                        <input type="range" min="0" max="40" value="${style.bloom}" oninput="hubSetBloom(this.value)">
                        <span class="nh-val" id="nhBloomVal">${style.bloom}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Intensity</label>
                        <input type="range" min="0" max="30" value="${style.intensity}" oninput="hubSetIntensity(this.value)">
                        <span class="nh-val" id="nhIntensityVal">${style.intensity}</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Opacity</label>
                        <input type="range" min="30" max="100" value="${style.opacity}" oninput="hubSetOpacity(this.value)">
                        <span class="nh-val" id="nhOpacityVal">${style.opacity}%</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Width</label>
                        <input type="range" min="260" max="500" value="${style.width}" oninput="hubSetWidth(this.value)">
                        <span class="nh-val" id="nhWidthVal">${style.width}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scale</label>
                        <input type="range" min="50" max="150" value="${style.scale}" oninput="hubSetScale(this.value)">
                        <span class="nh-val" id="nhScaleVal">${style.scale}%</span>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Chat Reply</div>
                    <div class="nh-setting-row">
                        <label>Position</label>
                        <div class="nh-chat-pos-btns">
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='auto'?' active':''}" onclick="hubSetChatPos('auto')">Auto</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='left'?' active':''}" onclick="hubSetChatPos('left')">Left</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='right'?' active':''}" onclick="hubSetChatPos('right')">Right</button>
                            <button class="nh-pill-btn nh-pos-btn${style.chatPos==='top'?' active':''}" onclick="hubSetChatPos('top')">Top</button>
                        </div>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Display</div>
                    <div class="nh-setting-row">
                        <label>Show Avatar</label>
                        <button class="nh-pill-btn nh-toggle-btn${style.showAvatar!==false?' active':''}" id="nhShowAvatarBtn" onclick="hubToggleAvatar()">
                            ${style.showAvatar!==false?'On':'Off'}
                        </button>
                    </div>
                    <div class="nh-settings-title" style="margin-top:8px">Avatar Screen</div>
                    <div class="nh-setting-row">
                        <label>Img Alpha</label>
                        <input type="range" min="10" max="100" value="${style.imgOpacity}" oninput="hubSetImgOpacity(this.value)">
                        <span class="nh-val" id="nhImgOpacityVal">${style.imgOpacity}%</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scr Glow</label>
                        <input type="range" min="0" max="30" value="${style.screenGlow}" oninput="hubSetScreenGlow(this.value)">
                        <span class="nh-val" id="nhScreenGlowVal">${style.screenGlow}px</span>
                    </div>
                    <div class="nh-setting-row">
                        <label>Scr Bloom</label>
                        <input type="range" min="0" max="40" value="${style.screenBloom}" oninput="hubSetScreenBloom(this.value)">
                        <span class="nh-val" id="nhScreenBloomVal">${style.screenBloom}px</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(fileInput);
        document.body.appendChild(el);

        // Build swatches
        const swatchContainer = el.querySelector('#nhSwatches');
        SWATCHES.forEach(c => {
            const s = document.createElement('div');
            s.className = 'nh-swatch' + (c === style.bg ? ' active' : '');
            s.style.background = c;
            s.onclick = () => hubSetColor(c);
            swatchContainer.appendChild(s);
        });

        document.getElementById('nhDrag').addEventListener('mousedown', dragStart);
        document.getElementById('nhChatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') hubSendChat(); });

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
        const container = document.getElementById('nhBrandImg');
        if (!container) return;
        const placeholder = document.getElementById('nhImgPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        const old = container.querySelector('img');
        if (old) old.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
    }

    // ---- DRAG (fixed offset bug) ----
    function dragStart(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        const el = document.getElementById('cmdHub');
        const r = el.getBoundingClientRect();
        const scaleFactor = style.scale / 100;

        // Convert right/bottom positioning to left/top
        if (!el.style.left || el.style.left === 'auto') {
            el.style.left = r.left + 'px';
            el.style.top = r.top + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }

        // FIX: Calculate offset from mouse to element's top-left corner
        // Account for CSS scale transform
        dragS = {
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startLeft: r.left,
            startTop: r.top
        };
        el.classList.add('dragging');
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup', dragEnd);
        e.preventDefault();
    }
    function dragMove(e) {
        if (!dragS) return;
        const el = document.getElementById('cmdHub');
        const dx = e.clientX - dragS.startMouseX;
        const dy = e.clientY - dragS.startMouseY;
        const newLeft = Math.max(0, Math.min(window.innerWidth - 100, dragS.startLeft + dx));
        const newTop = Math.max(0, Math.min(window.innerHeight - 50, dragS.startTop + dy));
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
    }
    function dragEnd() {
        if (!dragS) return;
        const el = document.getElementById('cmdHub');
        el.classList.remove('dragging');
        hub.x = parseInt(el.style.left);
        hub.y = parseInt(el.style.top);
        dragS = null;
        save();
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
    }

    // ---- ANALOG CLOCK (high-DPI) ----
    function drawClock() {
        const c = document.getElementById('nhAnalog');
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const logicalW = 160, logicalH = 160;
        if (c.width !== logicalW * dpr || c.height !== logicalH * dpr) {
            c.width = logicalW * dpr;
            c.height = logicalH * dpr;
            c.style.width = logicalW + 'px';
            c.style.height = logicalH + 'px';
        }
        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w=logicalW, h=logicalH, cx=w/2, cy=h/2, r=Math.min(cx,cy)-10;
        const isDark = luma(style.bg) <= 0.5;
        ctx.clearRect(0,0,w,h);

        // Neumorphic circle face
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
        ctx.fillStyle = style.bg;
        ctx.fill();
        const grad = ctx.createRadialGradient(cx-r*0.3, cy-r*0.3, r*0.1, cx, cy, r);
        grad.addColorStop(0, isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.05)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Hour marks
        for (let i=0;i<12;i++) {
            const a=(i*30-90)*Math.PI/180, main=i%3===0;
            const i1=r-(main?14:9), o1=r-3;
            ctx.beginPath();
            ctx.moveTo(cx+i1*Math.cos(a), cy+i1*Math.sin(a));
            ctx.lineTo(cx+o1*Math.cos(a), cy+o1*Math.sin(a));
            ctx.strokeStyle = main ? (isDark?'rgba(255,255,255,0.4)':'#888') : (isDark?'rgba(255,255,255,0.15)':'#bbb');
            ctx.lineWidth = main ? 2 : 1;
            ctx.stroke();
        }

        // Numbers 12, 3, 6, 9
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.25)' : '#aaa';
        ctx.font = '10px Inter, system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
        [{n:'12',a:-90},{n:'03',a:0},{n:'06',a:90},{n:'09',a:180}].forEach(({n,a})=>{
            const ang=a*Math.PI/180, nr=r-24;
            ctx.fillText(n, cx+nr*Math.cos(ang), cy+nr*Math.sin(ang));
        });

        const now=new Date(), hrs=now.getHours()%12, mins=now.getMinutes(), secs=now.getSeconds();

        // Hour hand
        const ha=((hrs+mins/60)*30-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.48)*Math.cos(ha), cy+(r*0.48)*Math.sin(ha));
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.75)' : '#333';
        ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke();

        // Minute hand
        const ma=((mins+secs/60)*6-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.68)*Math.cos(ma), cy+(r*0.68)*Math.sin(ma));
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.55)' : '#555';
        ctx.lineWidth=2; ctx.stroke();

        // Second hand (accent)
        const sa=(secs*6-90)*Math.PI/180;
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r*0.72)*Math.cos(sa), cy+(r*0.72)*Math.sin(sa));
        ctx.strokeStyle = style.accent;
        ctx.lineWidth=1; ctx.stroke();

        // Center dot
        ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2);
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : '#555';
        ctx.fill();

        positionChatWall();
        requestAnimationFrame(drawClock);
    }

    // ---- DIGITAL ----
    function tick() {
        const now = new Date();
        const h=now.getHours(), m=String(now.getMinutes()).padStart(2,'0');
        const h12=h%12||12, ap=h>=12?'PM':'AM';
        const tel=document.getElementById('nhTime'), del=document.getElementById('nhDate');
        if (tel) tel.textContent = `${h12}:${m} ${ap}`;
        if (del) del.textContent = `${now.getMonth()+1}/${String(now.getDate()).padStart(2,'0')}`;
    }

    // ---- TIMER ----
    function toggleTimerMode() {
        hub.showTimer = !hub.showTimer;
        const ts=document.getElementById('nhTimerSection'), mid=document.getElementById('nhMiddle'), btn=document.getElementById('nhTimerToggleBtn');
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
        const el=document.getElementById('nhTimerDisp'), lb=document.getElementById('nhTimerLabel'), sb=document.getElementById('nhTimerStartBtn'), mb=document.getElementById('nhTimerModeBtn');
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
    function cycleFont() {
        hub.fontIdx=(hub.fontIdx+1)%FONTS.length;
        applyFont(); save();
    }
    function applyFont() {
        const f=FONTS[hub.fontIdx];
        ['nhTime','nhTimerDisp'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.fontFamily=f; });
    }

    // ---- COLLAPSE ----
    function toggleCollapse() {
        const b=document.getElementById('nhBody'); if(!b) return;
        hub.collapsed = b.style.display!=='none';
        b.style.display = hub.collapsed ? 'none' : '';
        save();
    }

    // ---- SETTINGS ----
    function toggleSettings() {
        hub.showSettings = !hub.showSettings;
        const p = document.getElementById('nhSettings');
        if (p) p.classList.toggle('open', hub.showSettings);
        save();
    }
    function setColor(c) {
        style.bg = c;
        const picker = document.getElementById('nhColorPicker');
        if (picker) picker.value = c;
        document.querySelectorAll('.nh-swatch').forEach(s => s.classList.toggle('active', s.style.background === c || rgbToHex(s.style.background) === c));
        applyStyle(); saveStyle();
    }
    function setAccent(c) { style.accent = c; applyStyle(); saveStyle(); }
    function setBloom(v) { style.bloom = +v; const el=document.getElementById('nhBloomVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setIntensity(v) { style.intensity = +v; const el=document.getElementById('nhIntensityVal'); if(el) el.textContent = v; applyStyle(); saveStyle(); }
    function setOpacity(v) { style.opacity = +v; const el=document.getElementById('nhOpacityVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setWidth(v) { style.width = +v; const el=document.getElementById('nhWidthVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScale(v) { style.scale = +v; const el=document.getElementById('nhScaleVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setImgOpacity(v) { style.imgOpacity = +v; const el=document.getElementById('nhImgOpacityVal'); if(el) el.textContent = v+'%'; applyStyle(); saveStyle(); }
    function setScreenGlow(v) { style.screenGlow = +v; const el=document.getElementById('nhScreenGlowVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScreenBloom(v) { style.screenBloom = +v; const el=document.getElementById('nhScreenBloomVal'); if(el) el.textContent = v+'px'; applyStyle(); saveStyle(); }

    function rgbToHex(rgb) {
        if (!rgb || rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m || m.length < 3) return rgb;
        return '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('');
    }

    // ---- CHAT (anchored message history) ----
    let chatMessages = [];
    let chatContainer = null;
    let chatAutoHideTimer = null;

    function getChatSide() {
        if (style.chatPos && style.chatPos !== 'auto') return style.chatPos;
        const el = document.getElementById('cmdHub');
        if (!el) return 'right';
        const rect = el.getBoundingClientRect();
        const widgetCenter = rect.left + rect.width / 2;
        return widgetCenter < window.innerWidth / 2 ? 'right' : 'left';
    }

    function ensureChatContainer() {
        if (chatContainer) return chatContainer;
        chatContainer = document.createElement('div');
        chatContainer.id = 'nhChatWall';
        chatContainer.className = 'nh-chat-wall';
        chatContainer.innerHTML = '<div class="nh-chat-wall-inner" id="nhChatWallInner"></div>';
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
        const inner = document.getElementById('nhChatWallInner');
        if (!inner) return;
        inner.innerHTML = '';
        chatMessages.forEach((m, i) => {
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
            const inner = document.getElementById('nhChatWallInner');
            if (inner) {
                const isAtBottom = inner.scrollHeight - inner.scrollTop - inner.clientHeight < 30;
                if (isAtBottom) chatContainer.classList.remove('visible');
                else chatAutoHideTimer = setTimeout(() => { chatContainer.classList.remove('visible'); }, 15000);
            }
        }, 15000);
    }

    function positionChatWall() {
        if (!chatContainer) return;
        const el = document.getElementById('cmdHub');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const side = getChatSide();

        chatContainer.classList.remove('nh-wall-left', 'nh-wall-right', 'nh-wall-top');
        chatContainer.classList.add('nh-wall-' + side);

        if (side === 'top') {
            chatContainer.style.left = rect.left + 'px';
            chatContainer.style.right = 'auto';
            chatContainer.style.top = 'auto';
            chatContainer.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            chatContainer.style.maxHeight = Math.min(rect.top - 20, 300) + 'px';
            chatContainer.style.width = rect.width + 'px';
        } else if (side === 'right') {
            chatContainer.style.top = (rect.top) + 'px';
            chatContainer.style.bottom = 'auto';
            chatContainer.style.left = (rect.right + 10) + 'px';
            chatContainer.style.right = 'auto';
            chatContainer.style.maxHeight = Math.max(rect.height, 200) + 'px';
            chatContainer.style.width = '';
        } else {
            chatContainer.style.top = (rect.top) + 'px';
            chatContainer.style.bottom = 'auto';
            chatContainer.style.left = 'auto';
            chatContainer.style.right = (window.innerWidth - rect.left + 10) + 'px';
            chatContainer.style.maxHeight = Math.max(rect.height, 200) + 'px';
            chatContainer.style.width = '';
        }
    }

    function sendChat() {
        const inp=document.getElementById('nhChatInput'); const msg=inp?.value?.trim(); if(!msg) return; inp.value='';
        addChatMessage('user', msg);
        addChatMessage('thinking', '...');
        positionChatWall();
        // Dispatch to React app — responses come back via substrate:clock-chat-response
        window.dispatchEvent(new CustomEvent('substrate:clock-chat', { detail: { message: msg, mode: chatMode } }));
    }

    // Listen for streaming/final responses piped back from the React app
    window.addEventListener('substrate:clock-chat-response', function(e) {
        const detail = e.detail;
        if (!detail) return;
        positionChatWall();
        if (detail.type === 'streaming') {
            // Update the last message (thinking indicator) with streaming text
            if (chatMessages.length > 0) {
                chatMessages[chatMessages.length - 1] = { role: 'assistant', text: detail.text, thinking: true };
                renderChatMessages();
                showChatWall();
            }
        } else if (detail.type === 'final') {
            // Replace thinking with final response
            if (chatMessages.length > 0) {
                chatMessages[chatMessages.length - 1] = { role: 'assistant', text: detail.text };
            } else {
                chatMessages.push({ role: 'assistant', text: detail.text });
            }
            renderChatMessages();
            showChatWall();
        }
    });
    // ---- MODE / MIC / PRIMARY CHAT / AVATAR ----
    let chatMode = 'ask';
    function setMode(m) {
        chatMode = m;
        document.querySelectorAll('.nh-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        const inp = document.getElementById('nhChatInput');
        if (inp) {
            const placeholders = { ask: 'ask anything...', code: 'write code...', plan: 'plan a task...' };
            inp.placeholder = placeholders[m] || 'ask anything...';
        }
    }
    function toggleMic() {
        // Dispatch event to let the React app handle speech recognition
        window.dispatchEvent(new CustomEvent('substrate:clock-mic', { detail: { mode: chatMode } }));
        const btn = document.getElementById('nhMicBtn');
        if (btn) { btn.classList.toggle('nh-mic-active'); }
    }
    function togglePrimaryChat() {
        style.primaryChat = !style.primaryChat;
        const btn = document.getElementById('nhPrimaryChatBtn');
        if (btn) { btn.textContent = style.primaryChat ? 'On' : 'Off'; btn.classList.toggle('active', style.primaryChat); }
        // Dispatch event so React app can hide/show the regular chat button
        window.dispatchEvent(new CustomEvent('substrate:widget-primary-chat', { detail: { enabled: style.primaryChat } }));
        saveStyle();
    }
    function toggleAvatar() {
        style.showAvatar = style.showAvatar === false ? true : false;
        const btn = document.getElementById('nhShowAvatarBtn');
        if (btn) { btn.textContent = style.showAvatar !== false ? 'On' : 'Off'; btn.classList.toggle('active', style.showAvatar !== false); }
        // Dispatch event so the avatar system can toggle visibility
        window.dispatchEvent(new CustomEvent('substrate:toggle-avatar', { detail: { visible: style.showAvatar !== false } }));
        saveStyle();
    }

    function setChatPos(v) {
        style.chatPos = v;
        document.querySelectorAll('.nh-pos-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === v));
        saveStyle();
    }

    // ---- EMOTION GIF SYSTEM ----
    function _applyGifToScreen(url) {
        const gifEl = document.getElementById('nhEmotionGif');
        const placeholder = document.getElementById('nhImgPlaceholder');
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
        if (_emotionCycleInterval) { clearInterval(_emotionCycleInterval); _emotionCycleInterval = null; }
        _currentEmotion = emotion;

        const gifs = style.emotionGifs?.[emotion] || [];
        const available = gifs.filter(u => u && u.trim());

        if (available.length === 0) {
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

        _applyGifToScreen(available[0]);
        if (available.length > 1) _startGifCycle(available);
    }

    function _startGifCycle(gifList) {
        _emotionCycleIdx = 0;
        _emotionCycleInterval = setInterval(() => {
            _emotionCycleIdx = (_emotionCycleIdx + 1) % gifList.length;
            _applyGifToScreen(gifList[_emotionCycleIdx]);
        }, 5000 + Math.floor(Math.random() * 3000));
    }

    function loadGifsFromServer() {
        // Check if we already have GIFs in localStorage
        const hasLocal = style.emotionGifs && Object.keys(style.emotionGifs).some(k =>
            (style.emotionGifs[k] || []).some(u => u && u.trim())
        );
        if (hasLocal) {
            showEmotionGif('idle');
            return;
        }
        // Fallback: fetch from server
        fetch('/ui/widget-style').then(r => r.json()).then(data => {
            if (data && data.emotionGifs) {
                style.emotionGifs = data.emotionGifs;
                saveStyle();
                showEmotionGif('idle');
            }
        }).catch(() => {});
    }

    const EMOTION_MAP = {
        happy: 'laughing', joy: 'laughing', amused: 'laughing', humor: 'laughing',
        curious: 'thinking', analytical: 'thinking', contemplative: 'thinking',
        excited: 'excited', enthusiastic: 'excited', energetic: 'excited',
        searching: 'searching', researching: 'searching',
        speaking: 'speaking', talking: 'speaking'
    };
    function mapEmotionToGifCategory(emotion) {
        if (!emotion) return 'idle';
        const lower = emotion.toLowerCase();
        return EMOTION_MAP[lower] || (style.emotionGifs?.[lower] ? lower : 'idle');
    }

    // ---- CLOSE / REOPEN WIDGET ----
    function closeWidget() {
        hub.closed = true;
        save();
        hideWidget();
        window.dispatchEvent(new CustomEvent('substrate:widget-closed'));
    }
    function reopenWidget() {
        hub.closed = false;
        save();
        showWidget();
        window.dispatchEvent(new CustomEvent('substrate:widget-reopened'));
    }

    // ---- INIT (gated behind auth) ----
    let _inited = false;
    function init() {
        if (_inited) return;
        _inited = true;
        load(); create(); applyStyle(); applyFont(); tick(); updateTimer();
        setInterval(tick, 1000); drawClock();
        if (hub.collapsed) { const b=document.getElementById('nhBody'); if(b) b.style.display='none'; }
        if (hub.showTimer) toggleTimerMode();
        if (hub.showSettings) { const p=document.getElementById('nhSettings'); if(p) p.classList.add('open'); }
        loadGifsFromServer();
    }
    function showWidget() { const el = document.getElementById('cmdHub'); if (el) el.style.display = ''; }
    function hideWidget() { const el = document.getElementById('cmdHub'); if (el) el.style.display = 'none'; }

    // Don't show until authenticated — App.tsx dispatches this event after auth
    window.addEventListener('substrate:authenticated', function() {
        if (!_inited) init();
        if (hub.closed) {
            hideWidget();
            window.dispatchEvent(new CustomEvent('substrate:widget-closed'));
        } else {
            showWidget();
        }
    });
    window.addEventListener('substrate:logout', function() { hideWidget(); });

    // Listen for reopen from React app
    window.addEventListener('substrate:widget-reopen', function() {
        if (!_inited) init();
        reopenWidget();
    });

    // Listen for emotion events from the React app (piped from WebSocket)
    window.addEventListener('substrate:agent-emotion', function(e) {
        const detail = e.detail;
        if (!detail) return;
        if (detail.emotion) {
            const category = mapEmotionToGifCategory(detail.emotion);
            showEmotionGif(category);
        } else if (detail.status === 'speaking') {
            showEmotionGif('speaking');
        } else if (detail.status === 'idle' || detail.status === 'end') {
            showEmotionGif('idle');
        } else if (detail.status === 'searching' || detail.status === 'tool_executing') {
            showEmotionGif('searching');
        } else if (detail.status === 'thinking') {
            showEmotionGif('thinking');
        }
    });

    // Fallback: if auth is disabled, init after a short delay if no event fires
    setTimeout(function() {
        if (!_inited && document.querySelector('[data-substrate-app]')) {
            init();
            if (hub.closed) {
                hideWidget();
                window.dispatchEvent(new CustomEvent('substrate:widget-closed'));
            } else {
                showWidget();
            }
        }
    }, 2000);

    // Expose
    window.hubCycleFont = cycleFont;
    window.hubToggleTimerMode = toggleTimerMode;
    window.hubSwitchTimerMode = switchTimerMode;
    window.hubTimerStartStop = timerStartStop;
    window.hubTimerReset = timerReset;
    window.hubToggleCollapse = toggleCollapse;
    window.hubToggleSettings = toggleSettings;
    window.hubSendChat = sendChat;
    window.hubSetColor = setColor;
    window.hubSetAccent = setAccent;
    window.hubSetBloom = setBloom;
    window.hubSetIntensity = setIntensity;
    window.hubSetOpacity = setOpacity;
    window.hubSetWidth = setWidth;
    window.hubSetScale = setScale;
    window.hubSetImgOpacity = setImgOpacity;
    window.hubSetScreenGlow = setScreenGlow;
    window.hubSetScreenBloom = setScreenBloom;
    window.hubSetChatPos = setChatPos;
    window.hubSetMode = setMode;
    window.hubToggleMic = toggleMic;
    window.hubTogglePrimaryChat = togglePrimaryChat;
    window.hubToggleAvatar = toggleAvatar;
    window.hubCloseWidget = closeWidget;
    window.hubShowEmotionGif = showEmotionGif;
})();
