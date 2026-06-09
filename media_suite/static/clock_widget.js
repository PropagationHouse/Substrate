// ========== COMMAND HUB WIDGET ==========
// Neumorphic draggable widget: fully customizable (color, bloom, intensity, opacity, width, scale)
// date/time card, workspace bar, analog clock + image card, AI chat pill, timer/stopwatch, settings panel

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
        showSettings: false
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
        chatPos: 'auto'
    };

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
    function saveStyle() { try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch(e){} }
    function fmtD(sec) { sec=Math.abs(Math.floor(sec)); const h=Math.floor(sec/3600),m=String(Math.floor((sec%3600)/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0'); return h>0?`${h}:${m}:${s}`:`${m}:${s}`; }

    // Compute contrasting text colors from bg
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
        else { el.style.right = '24px'; el.style.bottom = '24px'; }

        // Hidden file input for image upload
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
                    </div>
                </div>
            </div>
            <div id="nhBody">
                <div class="nh-bar">
                    <div class="nh-bar-text">
                        <span class="nh-bar-label" id="nhBarLabel">Active workspace</span>
                        <span class="nh-bar-value" id="nhBarValue">Main Studio</span>
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
                                <span id="nhImgPlaceholder" style="font-size:2rem;">🎯</span>
                            </div>
                        </div>
                        <div class="nh-brand-name" id="nhBrandName">Brand</div>
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
                        <span class="nh-chat-icon">✦</span>
                        <input type="text" id="nhChatInput" class="nh-chat-input" placeholder="ask AI anything..." autocomplete="off">
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
                        </div>
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

        // Load saved image
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
        // Remove old img
        const old = container.querySelector('img');
        if (old) old.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
    }

    // ---- DRAG ----
    function dragStart(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        const el = document.getElementById('cmdHub');
        const r = el.getBoundingClientRect();
        if (el.style.right && !el.style.left) { el.style.left=r.left+'px'; el.style.top=r.top+'px'; el.style.right='auto'; el.style.bottom='auto'; }
        dragS = { sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top };
        el.classList.add('dragging');
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup', dragEnd);
        e.preventDefault();
    }
    function dragMove(e) {
        if (!dragS) return;
        const el = document.getElementById('cmdHub');
        el.style.left = Math.max(0, Math.min(window.innerWidth-200, dragS.ox+e.clientX-dragS.sx))+'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight-80, dragS.oy+e.clientY-dragS.sy))+'px';
    }
    function dragEnd() {
        if (!dragS) return;
        const el = document.getElementById('cmdHub');
        el.classList.remove('dragging');
        hub.x = parseInt(el.style.left); hub.y = parseInt(el.style.top);
        dragS = null; save();
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
    }

    // ---- ANALOG CLOCK (high-DPI neumorphic) ----
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
        const ws=document.getElementById('nhBarValue'), br=document.getElementById('nhBrandName');
        if (ws && window.state?.activeWorkspace) ws.textContent = window.state.activeWorkspace.name || 'Main Studio';
        if (br && window.state?.brandProfile) br.textContent = window.state.brandProfile.name || 'Brand';
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
                    if(hub.timerRemaining<=0){clearInterval(timerIv);hub.timerRunning=false;updateTimer();if(typeof showNotification==='function')showNotification('⏰ Timer complete!','info');}
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
        if(typeof showNotification==='function') showNotification(`Font: ${FONT_LABELS[hub.fontIdx]}`,'info');
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
        document.getElementById('nhColorPicker').value = c;
        // Update swatch active
        document.querySelectorAll('.nh-swatch').forEach(s => s.classList.toggle('active', s.style.background === c || rgbToHex(s.style.background) === c));
        applyStyle(); saveStyle();
    }
    function setAccent(c) { style.accent = c; applyStyle(); saveStyle(); }
    function setBloom(v) { style.bloom = +v; document.getElementById('nhBloomVal').textContent = v+'px'; applyStyle(); saveStyle(); }
    function setIntensity(v) { style.intensity = +v; document.getElementById('nhIntensityVal').textContent = v; applyStyle(); saveStyle(); }
    function setOpacity(v) { style.opacity = +v; document.getElementById('nhOpacityVal').textContent = v+'%'; applyStyle(); saveStyle(); }
    function setWidth(v) { style.width = +v; document.getElementById('nhWidthVal').textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScale(v) { style.scale = +v; document.getElementById('nhScaleVal').textContent = v+'%'; applyStyle(); saveStyle(); }
    function setImgOpacity(v) { style.imgOpacity = +v; document.getElementById('nhImgOpacityVal').textContent = v+'%'; applyStyle(); saveStyle(); }
    function setScreenGlow(v) { style.screenGlow = +v; document.getElementById('nhScreenGlowVal').textContent = v+'px'; applyStyle(); saveStyle(); }
    function setScreenBloom(v) { style.screenBloom = +v; document.getElementById('nhScreenBloomVal').textContent = v+'px'; applyStyle(); saveStyle(); }

    function rgbToHex(rgb) {
        if (!rgb || rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m || m.length < 3) return rgb;
        return '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('');
    }

    // ---- CHAT (anchored message history) ----
    let chatMessages = []; // session history: {role:'user'|'assistant', text:string}
    let chatContainer = null;
    let chatAutoHideTimer = null;

    function getChatSide() {
        if (style.chatPos !== 'auto') return style.chatPos;
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
        // If last message is a "thinking" placeholder, replace it
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
            // Fade-in animation for new messages
            div.style.animationDelay = (i === chatMessages.length - 1) ? '0s' : '0s';
            inner.appendChild(div);
        });
        // Auto-scroll to bottom
        requestAnimationFrame(() => { inner.scrollTop = inner.scrollHeight; });
    }

    function showChatWall() {
        ensureChatContainer();
        chatContainer.classList.add('visible');
        // Reset auto-hide timer
        if (chatAutoHideTimer) clearTimeout(chatAutoHideTimer);
        chatAutoHideTimer = setTimeout(() => {
            // Only hide if user hasn't scrolled up
            const inner = document.getElementById('nhChatWallInner');
            if (inner) {
                const isAtBottom = inner.scrollHeight - inner.scrollTop - inner.clientHeight < 30;
                if (isAtBottom) chatContainer.classList.remove('visible');
                else chatAutoHideTimer = setTimeout(() => { chatContainer.classList.remove('visible'); }, 15000);
            }
        }, 15000);
    }

    // Position the chat wall relative to the widget — called every frame in drawClock
    function positionChatWall() {
        if (!chatContainer) return;
        const el = document.getElementById('cmdHub');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const side = getChatSide();
        // Vertical: align top of chat wall with top of widget
        chatContainer.style.top = (rect.top) + 'px';
        // Max height matches widget height
        chatContainer.style.maxHeight = Math.max(rect.height, 200) + 'px';

        chatContainer.classList.remove('nh-wall-left', 'nh-wall-right');
        chatContainer.classList.add('nh-wall-' + side);

        if (side === 'right') {
            chatContainer.style.left = (rect.right + 10) + 'px';
            chatContainer.style.right = 'auto';
        } else {
            chatContainer.style.left = 'auto';
            chatContainer.style.right = (window.innerWidth - rect.left + 10) + 'px';
        }
    }

    function sendChat() {
        const inp=document.getElementById('nhChatInput'); const msg=inp?.value?.trim(); if(!msg) return; inp.value='';
        addChatMessage('user', msg);
        addChatMessage('thinking', 'Thinking...');
        // Send to AI backend directly
        (async () => {
            try {
                const enhancedMessage = `${msg}\n\nContext:\n- Brand: ${window.state?.brandProfile?.name || 'Not set'}`;
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        message: enhancedMessage,
                        action_mode: true,
                        brand_profile_id: window.state?.brandProfile?.id,
                        workspace_id: window.getWorkspaceId ? window.getWorkspaceId() : null
                    })
                });
                const data = await response.json();
                if (data.error) {
                    addChatMessage('assistant', 'Error: ' + data.error);
                } else {
                    addChatMessage('assistant', data.response);
                }
            } catch(err) {
                addChatMessage('assistant', 'Connection error.');
                console.error('Hub chat error:', err);
            }
        })();
    }
    function setChatPos(v) {
        style.chatPos = v;
        document.querySelectorAll('.nh-pos-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === v));
        saveStyle();
    }

    // ---- INIT ----
    function init() {
        load(); create(); applyStyle(); applyFont(); tick(); updateTimer();
        setInterval(tick, 1000); drawClock();
        if (hub.collapsed) { const b=document.getElementById('nhBody'); if(b) b.style.display='none'; }
        if (hub.showTimer) toggleTimerMode();
        if (hub.showSettings) { const p=document.getElementById('nhSettings'); if(p) p.classList.add('open'); }
    }
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

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
})();
