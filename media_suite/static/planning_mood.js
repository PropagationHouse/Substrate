// ========== WORKBENCH FUNCTIONALITY ==========

// Workbench canvas state
let moodBoardState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    drawMode: false,
    drawCanvas: null,
    drawCtx: null,
    isDrawing: false,
    lastX: 0,
    lastY: 0,
    // Selection state
    selectedImages: new Set(),
    // Drawing state
    brushType: 'pen',
    brushSize: 3,
    brushColor: '#4ade80',
    brushOpacity: 1.0,
    brushFlow: 1.0,
    brushMinSize: 0.10,       // min pressure size as fraction (10%)
    brushSmoothing: 3,        // smoothing window size
    brushTaper: 8,            // taper length in points
    pressureSensitivity: true,
    undoStack: [],
    redoStack: [],
    maxUndo: 30,
    currentPressure: 0.5,
    // Stroke storage for pan/zoom-aware drawing
    strokes: [],        // Array of completed strokes in world coords
    currentStroke: null, // Active stroke being drawn
    // Tool mode: 'draw' or 'select'
    activeTool: 'draw',
    // Selection rectangle state
    selectionRect: null,
    isSelecting: false,
    selStartX: 0, selStartY: 0,
    // Layer system
    layers: [{ id: 'layer0', name: 'Layer 1', visible: true, strokes: [] }],
    activeLayerId: 'layer0',
    layerCounter: 1
};

function saveMoodBoardView() {
    localStorage.setItem('moodBoardView', JSON.stringify({
        zoom: moodBoardState.zoom,
        panX: moodBoardState.panX,
        panY: moodBoardState.panY
    }));
}

function restoreMoodBoardView() {
    // Always auto-fit to content center mass.
    // Use rAF + timeout to ensure DOM layout is complete before computing bounds.
    requestAnimationFrame(function() {
        setTimeout(fitMoodBoardToContent, 500);
    });
}

function initMoodBoard() {
    const moodBoard = document.getElementById('moodBoard');
    const canvas = document.getElementById('moodBoardCanvas');
    
    if (!moodBoard || !canvas) return;
    
    // Drag and drop for images
    moodBoard.addEventListener('dragover', (e) => {
        e.preventDefault();
        moodBoard.classList.add('drag-over');
    });
    
    moodBoard.addEventListener('dragleave', () => {
        moodBoard.classList.remove('drag-over');
    });
    
    moodBoard.addEventListener('drop', async (e) => {
        e.preventDefault();
        moodBoard.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        for (const file of files) {
            await uploadMoodImage(file);
        }
    });
    
    // Pan functionality — use pointer events for mouse + touch + stylus support
    moodBoard.style.touchAction = 'none'; // Prevent browser handling of touch gestures

    // Track active pointers for pinch-to-zoom
    const _activePointers = new Map();

    moodBoard.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.mood-image') ||
            e.target.closest('.mood-board-controls') ||
            e.target.closest('.mood-text') ||
            e.target.closest('.radial-draw-menu') ||
            moodBoardState.drawMode) return;

        _activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (_activePointers.size === 1) {
            moodBoardState.isPanning = true;
            moodBoardState.startX = e.clientX - moodBoardState.panX;
            moodBoardState.startY = e.clientY - moodBoardState.panY;
            moodBoard.classList.add('panning');
        }
        moodBoard.setPointerCapture(e.pointerId);
    });

    moodBoard.addEventListener('pointermove', (e) => {
        if (!_activePointers.has(e.pointerId)) return;
        _activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (_activePointers.size === 2) {
            // Pinch-to-zoom with two fingers
            const pts = Array.from(_activePointers.values());
            const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;

            if (moodBoardState._lastPinchDist) {
                const scale = curDist / moodBoardState._lastPinchDist;
                const rect = moodBoard.getBoundingClientRect();
                const pivotX = midX - rect.left;
                const pivotY = midY - rect.top;
                zoomMoodBoard(scale, pivotX, pivotY);
            }
            moodBoardState._lastPinchDist = curDist;
            moodBoardState.isPanning = false;
            return;
        }

        if (!moodBoardState.isPanning || _activePointers.size !== 1) return;

        moodBoardState.panX = e.clientX - moodBoardState.startX;
        moodBoardState.panY = e.clientY - moodBoardState.startY;
        scheduleTransformUpdate();
    });

    moodBoard.addEventListener('pointerup', (e) => {
        _activePointers.delete(e.pointerId);
        if (_activePointers.size < 2) {
            moodBoardState._lastPinchDist = null;
        }
        if (_activePointers.size === 0 && moodBoardState.isPanning) {
            moodBoardState.isPanning = false;
            moodBoard.classList.remove('panning');
            saveMoodBoardView();
        }
    });
    moodBoard.addEventListener('pointercancel', (e) => {
        _activePointers.delete(e.pointerId);
        if (_activePointers.size < 2) {
            moodBoardState._lastPinchDist = null;
        }
        if (_activePointers.size === 0 && moodBoardState.isPanning) {
            moodBoardState.isPanning = false;
            moodBoard.classList.remove('panning');
            saveMoodBoardView();
        }
    });

    // Zoom with mouse wheel — targets cursor position
    moodBoard.addEventListener('wheel', (e) => {
        if (e.target.closest('.mood-image') && moodBoardState.selectedImages.size > 0) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = moodBoard.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        zoomMoodBoard(delta, mouseX, mouseY);
    }, { passive: false });
    
    // Initialize drawing canvas
    initDrawCanvas();
}

function initDrawCanvas() {
    const moodBoard = document.getElementById('moodBoard');
    if (!moodBoard) return;

    // Create drawing canvas element — stays on moodBoard for clean event capture
    const drawCanvas = document.createElement('canvas');
    drawCanvas.className = 'mood-draw-canvas';
    drawCanvas.id = 'moodDrawCanvas';

    // Set canvas size to match the moodBoard viewport
    const updateCanvasSize = () => {
        const rect = moodBoard.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        // Preserve existing strokes by re-rendering after resize
        drawCanvas.width = rect.width;
        drawCanvas.height = rect.height;
        redrawAllStrokes();
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    moodBoard.appendChild(drawCanvas);

    moodBoardState.drawCanvas = drawCanvas;
    moodBoardState.drawCtx = drawCanvas.getContext('2d');

    // Pointer events for drawing
    drawCanvas.addEventListener('pointerdown', startDrawing);
    drawCanvas.addEventListener('pointermove', draw);
    drawCanvas.addEventListener('pointerup', stopDrawing);
    drawCanvas.addEventListener('pointerleave', stopDrawing);
    drawCanvas.style.touchAction = 'none';
}

function toggleDrawMode() {
    // Ensure draw canvas exists
    if (!moodBoardState.drawCanvas) {
        initDrawCanvas();
    }
    moodBoardState.drawMode = !moodBoardState.drawMode;
    const drawCanvas = moodBoardState.drawCanvas;
    if (!drawCanvas) { console.warn('[Draw] Canvas not found'); return; }
    const moodBoard = document.getElementById('moodBoard');
    const toolbar = document.getElementById('drawToolbar');
    const hub = document.getElementById('rdmHub');

    if (moodBoardState.drawMode) {
        drawCanvas.classList.add('drawing');
        moodBoard.classList.add('draw-mode');
        if (hub) hub.classList.add('active');
        // Ensure canvas dimensions are correct
        const rect = moodBoard.getBoundingClientRect();
        if (drawCanvas.width < 10 || drawCanvas.height < 10 ||
            Math.abs(drawCanvas.width - rect.width) > 50 || Math.abs(drawCanvas.height - rect.height) > 50) {
            drawCanvas.width = rect.width;
            drawCanvas.height = rect.height;
        }
        // Migrate legacy strokes[] into layer system if needed
        if (moodBoardState.strokes.length > 0 && getActiveLayer().strokes.length === 0) {
            getActiveLayer().strokes = moodBoardState.strokes;
            moodBoardState.strokes = [];
        }
        // Re-load strokes from backend if layers are empty (module may have been hidden at page load)
        const _totalStrokes = moodBoardState.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0);
        if (_totalStrokes === 0) {
            loadStrokesFromBackend();
        }
        renderLayerList();
        redrawAllStrokes();
        showNotification('Draw mode — use finger, stylus, or mouse to sketch');
    } else {
        drawCanvas.classList.remove('drawing');
        moodBoard.classList.remove('draw-mode');
        if (hub) hub.classList.remove('active');
        // Close ring on exit
        const ring = document.getElementById('rdmRing');
        if (ring) ring.classList.remove('open');
        cancelSelection();
    }
}

// Helper: get the active layer object
function getActiveLayer() {
    return moodBoardState.layers.find(l => l.id === moodBoardState.activeLayerId) || moodBoardState.layers[0];
}

// Helper: get all visible strokes across all layers (bottom to top)
function getAllVisibleStrokes() {
    const all = [];
    moodBoardState.layers.forEach(layer => {
        if (layer.visible) all.push(...layer.strokes);
    });
    return all;
}

// Convert screen coordinates to world coordinates (accounting for pan+zoom)
function screenToWorld(screenX, screenY) {
    const canvas = moodBoardState.drawCanvas;
    const rect = canvas.getBoundingClientRect();
    const viewX = screenX - rect.left;
    const viewY = screenY - rect.top;
    // Invert the pan+zoom transform: world = (view - pan) / zoom
    const worldX = (viewX - moodBoardState.panX) / moodBoardState.zoom;
    const worldY = (viewY - moodBoardState.panY) / moodBoardState.zoom;
    return { x: worldX, y: worldY };
}

function startDrawing(e) {
    if (!moodBoardState.drawMode) return;
    e.preventDefault();
    e.stopPropagation();

    // Handle selection tool mode
    if (moodBoardState.activeTool === 'select') {
        startSelection(e);
        return;
    }

    moodBoardState.isDrawing = true;
    const world = screenToWorld(e.clientX, e.clientY);
    const pressure = e.pressure || 0.5;

    // Start a new stroke in world coordinates, storing all current brush settings
    moodBoardState.currentStroke = {
        brushType: moodBoardState.brushType,
        brushSize: moodBoardState.brushSize,
        brushColor: moodBoardState.brushColor,
        brushOpacity: moodBoardState.brushOpacity,
        brushFlow: moodBoardState.brushFlow,
        brushMinSize: moodBoardState.brushMinSize,
        brushSmoothing: moodBoardState.brushSmoothing,
        brushTaper: moodBoardState.brushTaper,
        points: [{ x: world.x, y: world.y, pressure: pressure, t: performance.now() }]
    };

    moodBoardState.lastX = world.x;
    moodBoardState.lastY = world.y;
    moodBoardState.currentPressure = pressure;
}

function draw(e) {
    if (!moodBoardState.drawMode) return;
    // Handle selection tool drag
    if (moodBoardState.activeTool === 'select' && moodBoardState.isSelecting) {
        dragSelection(e);
        return;
    }
    if (!moodBoardState.isDrawing) return;
    e.preventDefault();
    e.stopPropagation();

    const world = screenToWorld(e.clientX, e.clientY);
    const pressure = moodBoardState.pressureSensitivity ? (e.pressure || 0.5) : 0.5;

    // Add point to current stroke
    if (moodBoardState.currentStroke) {
        moodBoardState.currentStroke.points.push({ x: world.x, y: world.y, pressure: pressure, t: performance.now() });
        // Stream live stroke to other clients
        if (typeof _emitStrokeProgress === 'function') _emitStrokeProgress();
    }

    // Redraw the in-progress stroke for smooth live preview
    renderLiveStroke();

    moodBoardState.lastX = world.x;
    moodBoardState.lastY = world.y;
    moodBoardState.currentPressure = pressure;
}

function stopDrawing() {
    // Handle selection tool release
    if (moodBoardState.activeTool === 'select' && moodBoardState.isSelecting) {
        endSelection();
        return;
    }
    if (moodBoardState.isDrawing && moodBoardState.currentStroke) {
        console.log('[Draw] stopDrawing: stroke completed with', moodBoardState.currentStroke.points.length, 'points');
        // Save undo snapshot BEFORE adding the new stroke (so undo removes it)
        pushDrawUndo();
        // Save completed stroke to the active layer
        const completedStroke = moodBoardState.currentStroke;
        const layer = getActiveLayer();
        if (!layer) { console.error('[Draw] No active layer!'); return; }
        layer.strokes.push(completedStroke);
        moodBoardState.currentStroke = null;
        // Clear redo stack on new action
        moodBoardState.redoStack = [];
        // Full redraw to ensure consistency
        redrawAllStrokes();
        // Broadcast to other clients
        if (typeof emitStrokeAdd === 'function') emitStrokeAdd(moodBoardState.activeLayerId, completedStroke);
        // Persist to backend
        console.log('[Draw] Calling saveStrokesToBackend, total strokes:', moodBoardState.layers.reduce(function(a,l){return a+l.strokes.length;},0));
        saveStrokesToBackend();
    }
    moodBoardState.isDrawing = false;
}

// Live preview: redraw all completed strokes + current in-progress stroke
function renderLiveStroke() {
    const canvas = moodBoardState.drawCanvas;
    const ctx = moodBoardState.drawCtx;
    if (!canvas || !ctx || !moodBoardState.currentStroke) return;

    // Clear and redraw everything
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const zoom = moodBoardState.zoom;
    const panX = moodBoardState.panX;
    const panY = moodBoardState.panY;

    // Draw all visible layer strokes
    getAllVisibleStrokes().forEach(stroke => {
        renderFullStroke(ctx, stroke, zoom, panX, panY);
    });

    // Draw in-progress stroke
    renderFullStroke(ctx, moodBoardState.currentStroke, zoom, panX, panY);
}

// Redraw ALL strokes from scratch (called after pan/zoom changes)
function redrawAllStrokes() {
    const canvas = moodBoardState.drawCanvas;
    const ctx = moodBoardState.drawCtx;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const zoom = moodBoardState.zoom;
    const panX = moodBoardState.panX;
    const panY = moodBoardState.panY;

    getAllVisibleStrokes().forEach(stroke => {
        renderFullStroke(ctx, stroke, zoom, panX, panY);
    });
}

// ... (rest of the code remains the same)
// ============================================================

// Smooth raw points using a moving-average filter to reduce jitter
function smoothPoints(pts, windowSize) {
    if (pts.length < 3) return pts;
    const half = Math.floor(windowSize / 2);
    const smoothed = [];
    for (let i = 0; i < pts.length; i++) {
        let sx = 0, sy = 0, sp = 0, count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) {
            sx += pts[j].x;
            sy += pts[j].y;
            sp += pts[j].pressure;
            count++;
        }
        smoothed.push({
            x: sx / count,
            y: sy / count,
            pressure: sp / count,
            t: pts[i].t || 0
        });
    }
    return smoothed;
}

// Calculate per-point width based on pressure, velocity, and tapering
function calcPointWidths(pts, baseSize, brushType) {
    const widths = [];
    const totalPts = pts.length;

    for (let i = 0; i < totalPts; i++) {
        const p = pts[i];
        let pressure = p.pressure || 0.5;

        // Velocity-based thinning: faster movement = thinner line
        let velocity = 0;
        if (i > 0) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            const dt = (pts[i].t && pts[i - 1].t) ? Math.max(pts[i].t - pts[i - 1].t, 1) : 16;
            velocity = Math.sqrt(dx * dx + dy * dy) / dt; // px per ms
        }
        // Map velocity: slow (0) -> full width, fast (>2) -> thinner
        const velocityFactor = Math.max(0.3, 1.0 - velocity * 0.25);

        // Start/end tapering: thin at tips
        const startTaper = Math.min(1, i / Math.min(8, totalPts * 0.15));
        const endTaper = Math.min(1, (totalPts - 1 - i) / Math.min(8, totalPts * 0.15));
        const taper = Math.min(startTaper, endTaper);

        let width;
        switch (brushType) {
            case 'pen':
                width = baseSize * (0.3 + pressure * 0.7) * velocityFactor * (0.4 + taper * 0.6);
                break;
            case 'pencil':
                width = baseSize * 0.5 * (0.3 + pressure * 0.5) * velocityFactor * (0.5 + taper * 0.5);
                break;
            case 'marker':
                width = baseSize * 2.0 * (0.7 + pressure * 0.3) * (0.6 + taper * 0.4);
                break;
            default:
                width = baseSize * (0.5 + pressure * 0.5);
        }

        widths.push(Math.max(0.5, width));
    }

    // Smooth the widths to avoid sudden jumps
    const smoothedWidths = [];
    for (let i = 0; i < widths.length; i++) {
        const lo = Math.max(0, i - 2);
        const hi = Math.min(widths.length - 1, i + 2);
        let sum = 0, cnt = 0;
        for (let j = lo; j <= hi; j++) { sum += widths[j]; cnt++; }
        smoothedWidths.push(sum / cnt);
    }
    return smoothedWidths;
}

// Render a stroke as a filled variable-width shape with bezier smoothing
function renderFullStroke(ctx, stroke, zoom, panX, panY) {
    const rawPts = stroke.points;
    if (rawPts.length < 2) return;
    const scaledSize = stroke.brushSize * zoom;

    // --- Spray: keep particle-based rendering ---
    if (stroke.brushType === 'spray') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = stroke.brushColor;
        for (let i = 0; i < rawPts.length; i++) {
            const x = rawPts[i].x * zoom + panX;
            const y = rawPts[i].y * zoom + panY;
            const pressure = rawPts[i].pressure || 0.5;
            const radius = scaledSize * 2 * (0.5 + pressure * 0.5);
            const density = Math.floor(scaledSize * pressure * 3);
            for (let j = 0; j < density; j++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * radius;
                ctx.globalAlpha = stroke.brushOpacity * (0.1 + Math.random() * 0.3);
                ctx.beginPath();
                ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, 0.5 + Math.random(), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
        return;
    }

    // --- Eraser: smooth path with constant width ---
    if (stroke.brushType === 'eraser') {
        const pts = smoothPoints(rawPts, 3);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = scaledSize * 2;
        ctx.beginPath();
        ctx.moveTo(pts[0].x * zoom + panX, pts[0].y * zoom + panY);
        for (let i = 1; i < pts.length; i++) {
            // Use quadratic bezier through midpoints for smoothness
            if (i < pts.length - 1) {
                const xc = (pts[i].x * zoom + panX + pts[i + 1].x * zoom + panX) / 2;
                const yc = (pts[i].y * zoom + panY + pts[i + 1].y * zoom + panY) / 2;
                ctx.quadraticCurveTo(pts[i].x * zoom + panX, pts[i].y * zoom + panY, xc, yc);
            } else {
                ctx.lineTo(pts[i].x * zoom + panX, pts[i].y * zoom + panY);
            }
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return;
    }

    // --- Premium rendering for pen, pencil, marker ---
    // Step 1: Smooth the raw input points
    const smoothWindow = stroke.brushType === 'marker' ? 5 : 3;
    const pts = smoothPoints(rawPts, smoothWindow);
    if (pts.length < 2) return;

    // Step 2: Calculate per-point widths (pressure + velocity + taper)
    const widths = calcPointWidths(pts, scaledSize, stroke.brushType);

    // Step 3: Transform to screen coordinates
    const screenPts = pts.map(p => ({
        x: p.x * zoom + panX,
        y: p.y * zoom + panY
    }));

    // Step 4: Build the outline polygon (left side forward, right side backward)
    const leftSide = [];
    const rightSide = [];

    for (let i = 0; i < screenPts.length; i++) {
        const w = widths[i] / 2;
        let nx, ny;

        if (i === 0) {
            // Direction from first to second point
            const dx = screenPts[1].x - screenPts[0].x;
            const dy = screenPts[1].y - screenPts[0].y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            nx = -dy / len;
            ny = dx / len;
        } else if (i === screenPts.length - 1) {
            // Direction from second-to-last to last
            const dx = screenPts[i].x - screenPts[i - 1].x;
            const dy = screenPts[i].y - screenPts[i - 1].y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            nx = -dy / len;
            ny = dx / len;
        } else {
            // Average normal of adjacent segments
            const dx1 = screenPts[i].x - screenPts[i - 1].x;
            const dy1 = screenPts[i].y - screenPts[i - 1].y;
            const dx2 = screenPts[i + 1].x - screenPts[i].x;
            const dy2 = screenPts[i + 1].y - screenPts[i].y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            const nx1 = -dy1 / len1, ny1 = dx1 / len1;
            const nx2 = -dy2 / len2, ny2 = dx2 / len2;
            nx = (nx1 + nx2) / 2;
            ny = (ny1 + ny2) / 2;
            const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
            nx /= nlen;
            ny /= nlen;
        }

        leftSide.push({ x: screenPts[i].x + nx * w, y: screenPts[i].y + ny * w });
        rightSide.push({ x: screenPts[i].x - nx * w, y: screenPts[i].y - ny * w });
    }

    // Step 5: Draw the filled outline with bezier-smoothed edges
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = stroke.brushColor;

    switch (stroke.brushType) {
        case 'pen':
            ctx.globalAlpha = stroke.brushOpacity;
            break;
        case 'pencil':
            ctx.globalAlpha = stroke.brushOpacity * 0.65;
            break;
        case 'marker':
            ctx.globalAlpha = stroke.brushOpacity * 0.4;
            break;
        default:
            ctx.globalAlpha = stroke.brushOpacity;
    }

    ctx.beginPath();

    // Rounded start cap
    const startW = widths[0] / 2;
    ctx.arc(screenPts[0].x, screenPts[0].y, startW, 0, Math.PI * 2);

    // Left side (forward) using bezier curves through midpoints
    ctx.moveTo(leftSide[0].x, leftSide[0].y);
    for (let i = 1; i < leftSide.length - 1; i++) {
        const xc = (leftSide[i].x + leftSide[i + 1].x) / 2;
        const yc = (leftSide[i].y + leftSide[i + 1].y) / 2;
        ctx.quadraticCurveTo(leftSide[i].x, leftSide[i].y, xc, yc);
    }
    ctx.lineTo(leftSide[leftSide.length - 1].x, leftSide[leftSide.length - 1].y);

    // Rounded end cap
    const endW = widths[widths.length - 1] / 2;
    const lastPt = screenPts[screenPts.length - 1];
    ctx.arc(lastPt.x, lastPt.y, endW, 0, Math.PI * 2);

    // Right side (backward) using bezier curves
    ctx.lineTo(rightSide[rightSide.length - 1].x, rightSide[rightSide.length - 1].y);
    for (let i = rightSide.length - 2; i > 0; i--) {
        const xc = (rightSide[i].x + rightSide[i - 1].x) / 2;
        const yc = (rightSide[i].y + rightSide[i - 1].y) / 2;
        ctx.quadraticCurveTo(rightSide[i].x, rightSide[i].y, xc, yc);
    }
    ctx.lineTo(rightSide[0].x, rightSide[0].y);

    ctx.closePath();
    ctx.fill();

    // Pencil texture: add subtle grain dots along the stroke
    if (stroke.brushType === 'pencil') {
        ctx.fillStyle = stroke.brushColor;
        for (let i = 0; i < screenPts.length; i += 2) {
            const w = widths[i] * 0.6;
            for (let j = 0; j < 3; j++) {
                const ox = (Math.random() - 0.5) * w * 2;
                const oy = (Math.random() - 0.5) * w * 2;
                ctx.globalAlpha = stroke.brushOpacity * 0.08 * (pts[i].pressure || 0.5);
                ctx.beginPath();
                ctx.arc(screenPts[i].x + ox, screenPts[i].y + oy, 0.3 + Math.random() * 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
}

// --- Drawing toolbar functions ---
function setBrushType(type) {
    moodBoardState.brushType = type;
    document.querySelectorAll('.draw-tool-btn[data-brush]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.draw-tool-btn[data-brush="${type}"]`);
    if (btn) btn.classList.add('active');
}

function setBrushSize(val) {
    moodBoardState.brushSize = parseInt(val);
    const label = document.getElementById('brushSizeLabel');
    if (label) label.textContent = val;
}

function setBrushColor(color) {
    moodBoardState.brushColor = color;
    const picker = document.getElementById('brushColorPicker');
    if (picker) picker.value = color;
}

function setBrushOpacity(val) {
    moodBoardState.brushOpacity = parseInt(val) / 100;
    const label = document.getElementById('brushOpacityLabel');
    if (label) label.textContent = val;
}

function togglePressureSensitivity() {
    moodBoardState.pressureSensitivity = !moodBoardState.pressureSensitivity;
    const btn = document.getElementById('pressureToggle');
    if (btn) btn.classList.toggle('active', moodBoardState.pressureSensitivity);
    showNotification(`Pressure sensitivity ${moodBoardState.pressureSensitivity ? 'ON' : 'OFF'}`);
}

function pushDrawUndo() {
    // Store a snapshot of all layers for undo
    const snapshot = JSON.parse(JSON.stringify(moodBoardState.layers));
    moodBoardState.undoStack.push(snapshot);
    if (moodBoardState.undoStack.length > moodBoardState.maxUndo) {
        moodBoardState.undoStack.shift();
    }
}

function drawUndo() {
    if (moodBoardState.undoStack.length === 0) return;
    moodBoardState.redoStack.push(JSON.parse(JSON.stringify(moodBoardState.layers)));
    moodBoardState.layers = moodBoardState.undoStack.pop();
    redrawAllStrokes();
    renderLayerList();
    saveStrokesToBackend();
}

function drawRedo() {
    if (moodBoardState.redoStack.length === 0) return;
    moodBoardState.undoStack.push(JSON.parse(JSON.stringify(moodBoardState.layers)));
    moodBoardState.layers = moodBoardState.redoStack.pop();
    redrawAllStrokes();
    renderLayerList();
    saveStrokesToBackend();
}

function drawClear() {
    if (!confirm('Clear all drawing? This cannot be undone.')) return;
    pushDrawUndo();
    moodBoardState.layers.forEach(l => l.strokes = []);
    moodBoardState.redoStack = [];
    redrawAllStrokes();
    if (typeof emitDrawClear === 'function') emitDrawClear();
    // Force-save empty state (bypass the totalStrokes===0 skip)
    clearTimeout(_strokeSaveTimer);
    const wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
    fetch('/api/mood-board/strokes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: wsId, layers: moodBoardState.layers, layerCounter: moodBoardState.layerCounter, activeLayerId: moodBoardState.activeLayerId })
    }).then(function(r) { return r.json(); }).then(function(d) {
        console.log('[Strokes] Cleared & saved');
    }).catch(function(e) { console.warn('[Strokes] clear-save failed:', e); });
}

// Throttled transform update via rAF to prevent flicker during panning
let _transformRafId = null;
function scheduleTransformUpdate() {
    if (_transformRafId) return;
    _transformRafId = requestAnimationFrame(function() {
        _transformRafId = null;
        updateMoodBoardTransform();
    });
}

function updateMoodBoardTransform() {
    const canvas = document.getElementById('moodBoardCanvas');
    if (canvas) {
        canvas.style.transform = `translate3d(${moodBoardState.panX}px, ${moodBoardState.panY}px, 0) scale(${moodBoardState.zoom})`;
    }

    const zoomInfo = document.getElementById('moodZoomInfo');
    if (zoomInfo) {
        zoomInfo.textContent = Math.round(moodBoardState.zoom * 100) + '%';
    }

    // Redraw strokes so they follow pan/zoom (skip during active drawing to avoid flicker)
    if (moodBoardState.drawCanvas && getAllVisibleStrokes().length > 0 && !moodBoardState.isDrawing) {
        redrawAllStrokes();
    }
}

function zoomMoodBoard(factor, pivotX, pivotY) {
    const oldZoom = moodBoardState.zoom;
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * factor));
    
    if (pivotX !== undefined && pivotY !== undefined) {
        // Adjust pan so the point under the cursor stays fixed
        moodBoardState.panX -= (pivotX - moodBoardState.panX) * (newZoom / oldZoom - 1);
        moodBoardState.panY -= (pivotY - moodBoardState.panY) * (newZoom / oldZoom - 1);
    }
    
    moodBoardState.zoom = newZoom;
    updateMoodBoardTransform();
    saveMoodBoardView();
}

function resetMoodBoardView() {
    fitMoodBoardToContent();
}

function fitMoodBoardToContent() {
    const moodBoard = document.getElementById('moodBoard');
    if (!moodBoard) return;
    const images = moodBoard.querySelectorAll('.mood-image');
    if (images.length === 0) {
        moodBoardState.zoom = 1;
        moodBoardState.panX = 0;
        moodBoardState.panY = 0;
        updateMoodBoardTransform();
        return;
    }

    // Wait for all <img> inside .mood-image to finish loading before computing bounds
    const imgEls = moodBoard.querySelectorAll('.mood-image img');
    const pending = Array.from(imgEls).filter(i => !i.complete);
    if (pending.length > 0) {
        let loaded = 0;
        const onDone = () => { loaded++; if (loaded >= pending.length) _doFitMoodBoard(moodBoard, images); };
        pending.forEach(i => { i.addEventListener('load', onDone, { once: true }); i.addEventListener('error', onDone, { once: true }); });
        // Safety timeout in case some never fire
        setTimeout(() => _doFitMoodBoard(moodBoard, images), 3000);
        return;
    }

    _doFitMoodBoard(moodBoard, images);
}

function _doFitMoodBoard(moodBoard, images) {
    const boardRect = moodBoard.getBoundingClientRect();
    // If the board isn't visible yet (collapsed module, hidden tab), retry later
    if (boardRect.width < 50 || boardRect.height < 50) {
        console.log('[AutoCenter] Board not visible yet (' + boardRect.width.toFixed(0) + 'x' + boardRect.height.toFixed(0) + '), retrying in 1s');
        setTimeout(function() { fitMoodBoardToContent(); }, 1000);
        return;
    }

    // Find bounding box of all images using stored positions + state metadata
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    images.forEach(function(img) {
        const x = parseFloat(img.style.left) || 0;
        const y = parseFloat(img.style.top) || 0;
        // Prefer actual rendered size, but fall back to state metadata for lazy-loaded images
        let w = img.offsetWidth;
        let h = img.offsetHeight;
        if (w < 50 || h < 50) {
            // Image hasn't rendered yet — use metadata from state
            const id = img.dataset.id;
            const stateImg = state.moodBoardImages.find(function(si) { return si.id === id; });
            if (stateImg) {
                const scale = stateImg.scale || 1;
                w = (stateImg.width || 300) * scale;
                h = (stateImg.height || 200) * scale;
            } else {
                w = 300; h = 200;
            }
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) {
        console.log('[AutoCenter] No valid content bounds, resetting to default');
        moodBoardState.zoom = 1;
        moodBoardState.panX = 0;
        moodBoardState.panY = 0;
        updateMoodBoardTransform();
        return;
    }

    const padding = 40;
    const scaleX = (boardRect.width - padding * 2) / contentW;
    const scaleY = (boardRect.height - padding * 2) / contentH;
    let zoom = Math.min(scaleX, scaleY, 2);

    // Sanity: clamp zoom to valid range
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    zoom = Math.max(0.1, Math.min(2, zoom));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const panX = (boardRect.width / 2) - centerX * zoom;
    const panY = (boardRect.height / 2) - centerY * zoom;

    moodBoardState.zoom = zoom;
    moodBoardState.panX = panX;
    moodBoardState.panY = panY;
    updateMoodBoardTransform();
    saveMoodBoardView();
    console.log('[AutoCenter] zoom=' + zoom.toFixed(3) + ' pan=' + panX.toFixed(0) + ',' + panY.toFixed(0) + ' content=' + contentW.toFixed(0) + 'x' + contentH.toFixed(0) + ' board=' + boardRect.width.toFixed(0) + 'x' + boardRect.height.toFixed(0));
}

function toggleMoodBoardFullscreen() {
    const moodBoard = document.getElementById('moodBoard');
    if (!moodBoard) return;

    const isCurrentlyFs = moodBoard.classList.contains('fullscreen');

    // Capture old dimensions before the switch
    const oldRect = moodBoard.getBoundingClientRect();

    if (!isCurrentlyFs) {
        // ENTER fullscreen: reparent to body so it escapes overflow:hidden and backdrop-filter containing blocks
        _moodBoardOriginalParent = moodBoard.parentNode;
        _moodBoardNextSibling = moodBoard.nextSibling;
        document.body.appendChild(moodBoard);
        moodBoard.classList.add('fullscreen');
        // Apply saved fullscreen settings
        var savedFsBlur = localStorage.getItem('fsBlur');
        var savedFsDarkness = localStorage.getItem('fsDarkness');
        if (savedFsBlur) {
            var blurVal = 'blur(' + savedFsBlur + 'px) saturate(1.4)';
            moodBoard.style.setProperty('backdrop-filter', blurVal, 'important');
            moodBoard.style.setProperty('-webkit-backdrop-filter', blurVal, 'important');
        }
        if (savedFsDarkness) {
            var alpha = (parseInt(savedFsDarkness) / 100).toFixed(2);
            moodBoard.style.setProperty('background',
                'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px),' +
                'linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px),' +
                'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
                'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px),' +
                'radial-gradient(circle at 50% 50%, rgba(74,222,128,0.05), transparent 70%),' +
                'rgba(10,10,15,' + alpha + ')',
                'important'
            );
            moodBoard.style.setProperty('background-size',
                '50px 50px, 50px 50px, 10px 10px, 10px 10px, 100% 100%, 100% 100%',
                'important'
            );
        }
    } else {
        // EXIT fullscreen: move back to original location
        moodBoard.classList.remove('fullscreen');
        // Clear inline fullscreen overrides
        moodBoard.style.removeProperty('backdrop-filter');
        moodBoard.style.removeProperty('-webkit-backdrop-filter');
        moodBoard.style.removeProperty('background');
        moodBoard.style.removeProperty('background-size');
        if (_moodBoardOriginalParent) {
            if (_moodBoardNextSibling) {
                _moodBoardOriginalParent.insertBefore(moodBoard, _moodBoardNextSibling);
            } else {
                _moodBoardOriginalParent.appendChild(moodBoard);
            }
        }
    }

    const isFs = moodBoard.classList.contains('fullscreen');

    // Update button icon
    const fullscreenBtn = document.getElementById('fullscreenMoodBtn');
    if (fullscreenBtn) {
        fullscreenBtn.textContent = isFs ? '✕' : '⛶';
        fullscreenBtn.title = isFs ? 'Exit Fullscreen' : 'Fullscreen';
    }

    // Adjust pan so content stays visually centered after container resize
    // Use rAF to get the new layout dimensions
    requestAnimationFrame(function() {
        const newRect = moodBoard.getBoundingClientRect();
        // Shift pan by half the difference in container size to keep content centered
        const dx = (newRect.width - oldRect.width) / 2;
        const dy = (newRect.height - oldRect.height) / 2;
        moodBoardState.panX += dx;
        moodBoardState.panY += dy;
        updateMoodBoardTransform();
        saveMoodBoardView();

        // Resize draw canvas to match new container
        const drawCanvas = moodBoardState.drawCanvas;
        if (drawCanvas) {
            drawCanvas.width = newRect.width;
            drawCanvas.height = newRect.height;
            redrawAllStrokes();
        }
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        // Exit draw mode first, then fullscreen
        if (moodBoardState.drawMode) {
            toggleDrawMode();
            return;
        }
        const moodBoard = document.getElementById('moodBoard');
        if (moodBoard && moodBoard.classList.contains('fullscreen')) {
            toggleMoodBoardFullscreen();
        }
    }

    // Ctrl+Z / Cmd+Z = Undo drawing
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        if (moodBoardState.drawMode) {
            e.preventDefault();
            drawUndo();
        }
    }

    // Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z = Redo drawing
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        if (moodBoardState.drawMode) {
            e.preventDefault();
            drawRedo();
        }
    }
});

async function uploadMoodImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('brand_profile_id', state.brandProfile?.id);
    formData.append('workspace_id', window.getWorkspaceId ? window.getWorkspaceId() : '');
    
    try {
        const response = await fetch('/api/mood-board/upload', {
            method: 'POST',
            body: formData
        });
        
        const image = await response.json();
        console.log('Upload response:', image);
        
        if (image.error) {
            showNotification(`Upload error: ${image.error}`, 'error');
            return;
        }
        
        state.moodBoardImages.push(image);
        appendMoodImage(image);
        showNotification('Image added to mood board');
        
        // Auto-center view to include the new image
        setTimeout(fitMoodBoardToContent, 400);
        
        // Update AI context
        updateAIContext();
    } catch (error) {
        console.error('Upload error:', error);
        showNotification('Error uploading image', 'error');
    }
}

async function loadMoodBoard(retryCount) {
    retryCount = retryCount || 0;
    console.log('[Workbench] loadMoodBoard called, brandProfile:', !!state.brandProfile, 'retry:', retryCount);
    if (!state.brandProfile) {
        console.warn('[Workbench] No brand profile — cannot load mood board');
        if (retryCount < 5) {
            setTimeout(function() { loadMoodBoard(retryCount + 1); }, 2000);
        }
        return;
    }

    try {
        // Step 1: Fetch lightweight metadata only (no base64 data — fast on mobile)
        console.log('[Workbench] Fetching metadata for brand:', state.brandProfile.id);
        const metaResponse = await fetch(`/api/mood-board?brand_profile_id=${state.brandProfile.id}&metadata_only=1`);
        if (!metaResponse.ok) {
            console.error('[Workbench] Metadata fetch failed:', metaResponse.status);
            return;
        }
        const metadata = await metaResponse.json();
        console.log('[Workbench] Got metadata for', metadata.length, 'images');

        if (metadata.length === 0) {
            state.moodBoardImages = [];
            renderMoodBoard();
            return;
        }

        // Step 2: Create placeholder entries with positions but no image data yet
        state.moodBoardImages = metadata.map(function(m) {
            return {
                id: m.id, name: m.name, description: m.description,
                x: m.x, y: m.y, rotation: m.rotation, scale: m.scale,
                opacity: m.opacity, zIndex: m.zIndex,
                width: m.width, height: m.height,
                url: null, _loading: true
            };
        });

        // Render placeholders immediately so layout is visible
        renderMoodBoard();
        restoreMoodBoardView();

        // Step 3: Lazy-load each image individually (parallel with concurrency limit)
        const CONCURRENCY = 3;
        let idx = 0;
        async function loadNext() {
            while (idx < metadata.length) {
                const i = idx++;
                const imgMeta = metadata[i];
                try {
                    const resp = await fetch('/api/mood-board/image/' + imgMeta.id);
                    if (resp.ok) {
                        const data = await resp.json();
                        const stateImg = state.moodBoardImages.find(function(x) { return x.id === imgMeta.id; });
                        if (stateImg) {
                            stateImg.url = data.url;
                            stateImg._loading = false;
                        }
                        // Update DOM element directly
                        const el = document.querySelector('.mood-image[data-id="' + imgMeta.id + '"] img');
                        if (el) {
                            el.src = data.url;
                            el.style.opacity = '1';
                            el.closest('.mood-image').classList.remove('loading');
                        }
                    }
                } catch (e) {
                    console.warn('[Workbench] Failed to load image', imgMeta.id, e);
                }
            }
        }
        const workers = [];
        for (let w = 0; w < CONCURRENCY; w++) workers.push(loadNext());
        await Promise.all(workers);
        console.log('[Workbench] All images loaded');

        // Always re-fit after lazy images load — the initial fit ran on empty placeholders
        // and had wrong dimensions. This ensures images are centered and visible.
        console.log('[Workbench] Re-fitting view after lazy load complete');
        setTimeout(fitMoodBoardToContent, 300);

    } catch (error) {
        console.error('[Workbench] Error loading mood board:', error);
        if (retryCount < 3) {
            setTimeout(function() { loadMoodBoard(retryCount + 1); }, 3000);
        }
    }
}

function renderMoodBoard() {
    const canvas = document.getElementById('moodBoardCanvas');
    if (!canvas) return;
    
    if (state.moodBoardImages.length === 0) {
        canvas.innerHTML = `
            <div class="mood-board-empty">
                <p>📌 Drop images here to start your Workbench</p>
                <p style="font-size: 0.9rem; color: var(--text-tertiary); margin-top: 0.5rem;">Sketch, iterate, generate variations & edit images — all in one place</p>
            </div>
        `;
        return;
    }
    
    canvas.innerHTML = '';
    state.moodBoardImages.forEach(img => appendMoodImage(img, canvas));
}

function appendMoodImage(img, canvas) {
    if (!canvas) canvas = document.getElementById('moodBoardCanvas');
    if (!canvas) return;
    
    // Remove empty state if present
    const emptyMsg = canvas.querySelector('.mood-board-empty');
    if (emptyMsg) emptyMsg.remove();
    
    const imageEl = document.createElement('div');
    imageEl.className = 'mood-image';
    imageEl.dataset.id = img.id;
    
    // Use stored pixel positions directly from DB
    const canvasRect = canvas.getBoundingClientRect();
    let x, y;
    if (img.x !== null && img.x !== undefined && img.y !== null && img.y !== undefined) {
        x = parseFloat(img.x);
        y = parseFloat(img.y);
    } else {
        // No saved position — place randomly near center
        x = (canvasRect.width / 2) - 100 + (Math.random() * 200 - 100);
        y = (canvasRect.height / 2) - 75 + (Math.random() * 150 - 75);
        img.x = x; img.y = y;
    }
    
    imageEl.style.left = x + 'px';
    imageEl.style.top = y + 'px';
    imageEl.style.opacity = img.opacity !== undefined ? img.opacity : 1;
    imageEl.style.transform = `rotate(${img.rotation || 0}deg) scale(${img.scale || 1})`;
    imageEl.style.zIndex = img.zIndex || 1;
    
    // Support lazy-loading: show placeholder spinner if url not yet loaded
    const imgSrc = img.url || '';
    const loadingClass = img._loading ? ' loading' : '';
    if (img._loading) imageEl.classList.add('loading');

    imageEl.innerHTML = `
        <img src="${imgSrc}" alt="${img.description || 'Workbench image'}" draggable="false" style="${img._loading ? 'opacity:0' : 'opacity:1'}">
        <div class="mood-image-controls">
            <button class="mood-control-btn" onclick="event.stopPropagation(); rotateMoodImage('${img.id}')" title="Rotate">↻</button>
            <button class="mood-control-btn" onclick="event.stopPropagation(); adjustImageOpacity('${img.id}', -0.1)" title="Less opacity">◐</button>
            <button class="mood-control-btn" onclick="event.stopPropagation(); adjustImageOpacity('${img.id}', 0.1)" title="More opacity">◑</button>
            <button class="mood-control-btn" onclick="event.stopPropagation(); downloadMoodImage('${img.id}')" title="Download">⬇</button>
            <button class="mood-control-btn" onclick="event.stopPropagation(); deleteMoodImage('${img.id}')" title="Delete">✕</button>
        </div>
    `;
    
    // --- Click to select / Shift+click multi-select ---
    let isDragging = false;
    
    // Hover: bring visually on top temporarily
    imageEl.addEventListener('mouseenter', () => {
        if (!isDragging) imageEl.style.zIndex = 999;
    });
    imageEl.addEventListener('mouseleave', () => {
        if (!moodBoardState.selectedImages.has(img.id)) {
            imageEl.style.zIndex = img.zIndex || 1;
        }
    });
    let dragStartX, dragStartY, startLeft, startTop;
    let didMove = false;
    // Store initial positions of all selected for group move
    let groupStartPositions = [];
    
    const onPointerDown = (e) => {
        if (e.target.tagName === 'BUTTON' || moodBoardState.drawMode) return;
        
        didMove = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        
        const isSelected = moodBoardState.selectedImages.has(img.id);
        
        if (e.shiftKey) {
            // Shift+click: toggle selection without deselecting others
            if (isSelected) {
                moodBoardState.selectedImages.delete(img.id);
                imageEl.classList.remove('selected');
            } else {
                moodBoardState.selectedImages.add(img.id);
                imageEl.classList.add('selected');
            }
        } else if (!isSelected) {
            // Click without shift on unselected: select only this
            mediaWallDeselectAll();
            moodBoardState.selectedImages.add(img.id);
            imageEl.classList.add('selected');
        }
        // If already selected (no shift), keep selection for potential group drag
        
        isDragging = true;
        imageEl.style.zIndex = 1000;
        startLeft = parseFloat(imageEl.style.left) || 0;
        startTop = parseFloat(imageEl.style.top) || 0;
        
        // Record start positions of all selected images for group move
        groupStartPositions = [];
        moodBoardState.selectedImages.forEach(sid => {
            const el = canvas.querySelector(`[data-id="${sid}"]`);
            if (el) {
                groupStartPositions.push({
                    id: sid,
                    el: el,
                    startLeft: parseFloat(el.style.left) || 0,
                    startTop: parseFloat(el.style.top) || 0
                });
            }
        });
        
        e.preventDefault();
        e.stopPropagation();
        
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
    };
    
    const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - dragStartX) / moodBoardState.zoom;
        const dy = (e.clientY - dragStartY) / moodBoardState.zoom;
        
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didMove = true;
        
        // Move all selected images as a group
        groupStartPositions.forEach(gp => {
            gp.el.style.left = (gp.startLeft + dx) + 'px';
            gp.el.style.top = (gp.startTop + dy) + 'px';
        });
    };
    
    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        
        // Click brings image permanently to front
        const maxZ = Math.max(1, ...state.moodBoardImages.map(i => i.zIndex || 1)) + 1;
        img.zIndex = maxZ;
        imageEl.style.zIndex = maxZ;
        
        // Persist positions of all moved images
        if (didMove) {
            groupStartPositions.forEach(gp => {
                const imgData = state.moodBoardImages.find(i => i.id === gp.id);
                if (imgData) {
                    imgData.x = parseFloat(gp.el.style.left);
                    imgData.y = parseFloat(gp.el.style.top);
                }
                // Broadcast move to other clients
                if (typeof emitImageMove === 'function') {
                    emitImageMove(gp.id, gp.el.style.left, gp.el.style.top, gp.el.style.width, gp.el.style.height, gp.el.style.transform);
                }
            });
            saveMoodBoardState();
        }
        
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
    };
    
    imageEl.style.touchAction = 'none';
    imageEl.addEventListener('pointerdown', onPointerDown);
    
    // --- Scroll wheel to resize selected images ---
    imageEl.addEventListener('wheel', (e) => {
        if (!moodBoardState.selectedImages.has(img.id)) return;
        e.preventDefault();
        e.stopPropagation();
        
        const scaleDelta = e.deltaY > 0 ? 0.95 : 1.05;
        
        // Scale all selected
        moodBoardState.selectedImages.forEach(sid => {
            const imgData = state.moodBoardImages.find(i => i.id === sid);
            if (imgData) {
                imgData.scale = Math.max(0.1, Math.min(5, (imgData.scale || 1) * scaleDelta));
                const el = canvas.querySelector(`[data-id="${sid}"]`);
                if (el) el.style.transform = `rotate(${imgData.rotation || 0}deg) scale(${imgData.scale})`;
            }
        });
        saveMoodBoardState();
    });
    
    // --- Right-click context menu ---
    imageEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMediaWallContextMenu(e, img.id);
    });
    
    canvas.appendChild(imageEl);
}

function mediaWallDeselectAll() {
    moodBoardState.selectedImages.clear();
    document.querySelectorAll('.mood-image.selected').forEach(el => el.classList.remove('selected'));
}

function showMediaWallContextMenu(e, imageId) {
    var menu = document.getElementById('mwContextMenu');
    if (!menu) return;
    // Position with fixed coords on body so no overlay can block clicks
    if (menu.parentNode !== document.body) document.body.appendChild(menu);
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.display = 'block';
    menu.style.zIndex = '99999';
    
    var count = moodBoardState.selectedImages.size;
    var plural = count > 1 ? ' (' + count + ')' : '';
    
    menu.innerHTML = '<div class="mw-ctx-item" data-action="download">\u2b07 Download' + plural + '</div>'
        + '<div class="mw-ctx-divider"></div>'
        + '<div class="mw-ctx-item" data-action="variation">\u2728 Generate Variation \u25b8</div>'
        + '<div class="mw-ctx-item" data-action="edit">\ud83d\udd8c\ufe0f Edit with AI</div>'
        + '<div class="mw-ctx-item" data-action="reference">\ud83d\uddbc\ufe0f New from Reference</div>'
        + '<div class="mw-ctx-divider"></div>'
        + '<div class="mw-ctx-item" data-action="rotate">\u21bb Rotate</div>'
        + '<div class="mw-ctx-item" data-action="duplicate">\ud83d\udccb Duplicate</div>'
        + '<div class="mw-ctx-item danger" data-action="delete">\ud83d\uddd1 Delete' + plural + '</div>';

    menu.querySelectorAll('.mw-ctx-item[data-action]').forEach(function(item) {
        var action = item.getAttribute('data-action');
        item.addEventListener('pointerup', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            console.log('[CtxMenu] pointerup action:', action, 'imageId:', imageId);
            if (action === 'download') return downloadMoodImage(imageId);
            if (action === 'variation') return showVariationSubmenu(imageId);
            if (action === 'edit') return showManualPromptUI(imageId, 'edit');
            if (action === 'reference') return showManualPromptUI(imageId, 'reference');
            if (action === 'rotate') return rotateMoodImage(imageId);
            if (action === 'duplicate') return duplicateMoodImage(imageId);
            if (action === 'delete') return deleteMoodImage(imageId);
        });
    });

    var closeMenu = function(ev) {
        if (!menu.contains(ev.target)) {
            menu.style.display = 'none';
            document.removeEventListener('pointerdown', closeMenu);
        }
    };
    if (menu._closeHandler) document.removeEventListener('pointerdown', menu._closeHandler);
    menu._closeHandler = closeMenu;
    setTimeout(function() { document.addEventListener('pointerdown', closeMenu); }, 50);
}

function showVariationSubmenu(imageId) {
    var menu = document.getElementById('mwContextMenu');
    if (!menu) return;
    
    menu.innerHTML = '<div class="mw-ctx-header">\u2728 Generate Variation</div>'
        + '<div class="mw-ctx-item" data-action="vary_strong">\ud83d\udd25 Vary Strong</div>'
        + '<div class="mw-ctx-item" data-action="vary_light">\ud83c\udf3f Vary Light</div>'
        + '<div class="mw-ctx-item" data-action="vary_manual">\u270f\ufe0f Manual Prompt</div>'
        + '<div class="mw-ctx-divider"></div>'
        + '<div class="mw-ctx-header" style="font-size:0.75rem;">Output Size</div>'
        + '<div class="mw-ctx-row"><label class="mw-ctx-radio"><input type="radio" name="mw-size" value="auto" checked> Auto (match source)</label></div>'
        + '<div class="mw-ctx-row"><label class="mw-ctx-radio"><input type="radio" name="mw-size" value="manual"> Manual</label>'
        + '<input type="number" id="mwManualScale" placeholder="Scale %" value="100" style="width:55px;padding:2px 4px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:0.75rem;display:none;" /></div>'
        + '<div class="mw-ctx-divider"></div>'
        + '<div class="mw-ctx-item" data-action="back" style="color:var(--text-tertiary);">\u2190 Back</div>';

    menu.querySelectorAll('.mw-ctx-item[data-action]').forEach(function(item) {
        var action = item.getAttribute('data-action');
        item.addEventListener('pointerup', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            console.log('[CtxMenu] variation pointerup:', action);
            if (action === 'vary_strong') return runImageGeneration(imageId, 'vary_strong');
            if (action === 'vary_light') return runImageGeneration(imageId, 'vary_light');
            if (action === 'vary_manual') return showManualPromptUI(imageId, 'vary_manual');
            if (action === 'back') return showMediaWallContextMenu(ev, imageId);
        });
    });
    
    menu.querySelectorAll('input[name="mw-size"]').forEach(function(r) {
        r.addEventListener('change', function() {
            document.getElementById('mwManualScale').style.display = r.value === 'manual' ? 'inline-block' : 'none';
        });
    });
}

function showManualPromptUI(imageId, mode) {
    var menu = document.getElementById('mwContextMenu');
    if (!menu) return;

    var titles = {
        vary_manual: '\u2728 Manual Variation',
        edit: '\ud83d\udd8c\ufe0f Edit with AI',
        reference: '\ud83d\uddbc\ufe0f New from Reference'
    };
    var placeholders = {
        vary_manual: 'Describe the variation you want...',
        edit: 'e.g. make it more vibrant, remove background...',
        reference: 'e.g. product shot in this style, sketch inspired by this...'
    };

    menu.innerHTML = '<div class="mw-ctx-header">' + (titles[mode] || 'Generate') + '</div>'
        + '<div style="padding:0.4rem 0.75rem;"><textarea id="mwPromptInput" rows="3" placeholder="' + (placeholders[mode] || 'Describe...') + '" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:0.5rem;font-size:0.8rem;resize:none;font-family:inherit;"></textarea></div>'
        + '<div style="padding:0.25rem 0.75rem 0.5rem;"><div class="mw-ctx-header" style="font-size:0.7rem;margin-bottom:0.25rem;">Output Size</div>'
        + '<div class="mw-ctx-row"><label class="mw-ctx-radio"><input type="radio" name="mw-size" value="auto" checked> Auto</label>'
        + '<label class="mw-ctx-radio"><input type="radio" name="mw-size" value="manual"> Manual</label>'
        + '<input type="number" id="mwManualScale" placeholder="%" value="100" style="width:48px;padding:2px 4px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:0.75rem;display:none;" /></div></div>'
        + '<div style="display:flex;gap:0.4rem;padding:0.25rem 0.75rem 0.5rem;"><button class="mw-ctx-btn" data-action="cancel">Cancel</button><button class="mw-ctx-btn primary" data-action="generate">Generate</button></div>';

    menu.querySelectorAll('.mw-ctx-btn[data-action]').forEach(function(btn) {
        var action = btn.getAttribute('data-action');
        btn.addEventListener('pointerup', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            console.log('[CtxMenu] prompt UI pointerup:', action);
            if (action === 'cancel') return showMediaWallContextMenu(ev, imageId);
            if (action === 'generate') return runImageGeneration(imageId, mode);
        });
    });

    menu.querySelectorAll('input[name="mw-size"]').forEach(function(r) {
        r.addEventListener('change', function() {
            document.getElementById('mwManualScale').style.display = r.value === 'manual' ? 'inline-block' : 'none';
        });
    });

    setTimeout(function() { var ta = document.getElementById('mwPromptInput'); if (ta) ta.focus(); }, 50);
}

function getSelectedSizeMode() {
    const radio = document.querySelector('input[name="mw-size"]:checked');
    if (!radio || radio.value === 'auto') return { mode: 'auto' };
    const scaleInput = document.getElementById('mwManualScale');
    return { mode: 'manual', scalePercent: parseInt(scaleInput?.value || '100') };
}

async function runImageGeneration(imageId, mode) {
    const imgData = state.moodBoardImages.find(i => i.id === imageId);
    if (!imgData) return;
    
    // Get prompt from textarea if present (manual modes)
    const promptInput = document.getElementById('mwPromptInput');
    const userPrompt = promptInput?.value?.trim() || '';
    
    // Get size mode
    const sizeMode = getSelectedSizeMode();
    
    // Close menu
    const menu = document.getElementById('mwContextMenu');
    if (menu) menu.style.display = 'none';
    
    // Build the prompt and variation strength for backend
    let prompt, variationStrength;
    
    switch (mode) {
        case 'vary_strong':
            prompt = 'Create a strong variation of this image';
            variationStrength = 'strong';
            break;
        case 'vary_light':
            prompt = 'Create a subtle variation of this image';
            variationStrength = 'light';
            break;
        case 'vary_manual':
            if (!userPrompt) { showNotification('Please enter a prompt', 'error'); return; }
            prompt = userPrompt;
            variationStrength = 'manual';
            break;
        case 'edit':
            if (!userPrompt) { showNotification('Please describe the edit', 'error'); return; }
            prompt = `Edit this image: ${userPrompt}`;
            variationStrength = 'manual';
            break;
        case 'reference':
            if (!userPrompt) { showNotification('Please describe what to generate', 'error'); return; }
            prompt = userPrompt;
            variationStrength = 'manual';
            break;
        default:
            prompt = userPrompt || 'Create a variation';
            variationStrength = 'strong';
    }
    
    showNotification('Generating image...', 'info');
    
    try {
        const response = await fetch('/api/ai/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                brand_profile_id: state.brandProfile?.id,
                reference_image_data: imgData.url,
                variation_strength: variationStrength
            })
        });
        const data = await response.json();
        
        if (data.image_url) {
            // Calculate placement: grid-snap to the right of the reference image
            const refScale = imgData.scale || 1;
            let newScale;
            if (sizeMode.mode === 'manual') {
                newScale = refScale * (sizeMode.scalePercent / 100);
            } else {
                newScale = refScale;
            }
            
            // Get reference element dimensions for placement
            const refEl = document.querySelector(`[data-id="${imageId}"]`);
            let newX = (imgData.x || 200) + 320;
            let newY = imgData.y || 100;
            
            if (refEl) {
                const refRect = refEl.getBoundingClientRect();
                const canvasEl = document.getElementById('moodBoardCanvas');
                const canvasRect = canvasEl.getBoundingClientRect();
                // Place to the right with a small gap
                newX = (imgData.x || 0) + (refRect.width / moodBoardState.zoom) + 20;
                newY = imgData.y || 0;
            }
            
            // Check if spot is occupied, shift down if needed
            const occupied = state.moodBoardImages.some(img => 
                img.id !== imageId && 
                Math.abs((img.x || 0) - newX) < 100 && 
                Math.abs((img.y || 0) - newY) < 100
            );
            if (occupied) newY += 320;
            
            // Upload as mood board image with proper placement
            const formData = new FormData();
            const resp = await fetch(data.image_url);
            const blob = await resp.blob();
            formData.append('image', new File([blob], 'ai-generated.png', { type: blob.type }));
            formData.append('brand_profile_id', state.brandProfile?.id);
            formData.append('workspace_id', window.getWorkspaceId ? window.getWorkspaceId() : '');
            
            const uploadResp = await fetch('/api/mood-board/upload', { method: 'POST', body: formData });
            const newImage = await uploadResp.json();
            
            if (newImage.error) {
                showNotification(newImage.error, 'error');
                return;
            }
            
            // Set position and scale
            newImage.x = newX;
            newImage.y = newY;
            newImage.scale = newScale;
            newImage.rotation = 0;
            
            state.moodBoardImages.push(newImage);
            appendMoodImage(newImage);
            saveMoodBoardState();
            
            showNotification('Image generated!');
        } else {
            showNotification(data.error || 'Could not generate image', 'error');
        }
    } catch (err) {
        console.error('Generation error:', err);
        showNotification('Error generating image', 'error');
    }
}

function downloadMoodImage(imageId) {
    const ids = moodBoardState.selectedImages.size > 0 ? [...moodBoardState.selectedImages] : [imageId];
    ids.forEach(async (id) => {
        const imgData = state.moodBoardImages.find(i => i.id === id);
        if (!imgData || !imgData.url) return;
        try {
            const resp = await fetch(imgData.url, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = `media-wall-${id.substring(0, 8)}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
        } catch (err) {
            console.error('[Download] Failed', err);
            try { showNotification('Download failed'); } catch (_) {}
        }
    });
    try { showNotification(`Downloaded ${ids.length} image${ids.length > 1 ? 's' : ''}`); } catch (_) {}
    const menu = document.getElementById('mwContextMenu');
    if (menu) menu.style.display = 'none';
}

async function duplicateMoodImage(imageId) {
    const imgData = state.moodBoardImages.find(i => i.id === imageId);
    if (!imgData) return;
    
    const dup = { ...imgData, id: crypto.randomUUID(), x: (imgData.x || 100) + 30, y: (imgData.y || 100) + 30 };
    state.moodBoardImages.push(dup);
    appendMoodImage(dup);
    showNotification('Image duplicated');
}

function selectMoodImage(imageId) {
    const imageEl = document.querySelector(`[data-id="${imageId}"]`);
    if (imageEl) {
        imageEl.classList.toggle('selected');
        if (imageEl.classList.contains('selected')) {
            moodBoardState.selectedImages.add(imageId);
        } else {
            moodBoardState.selectedImages.delete(imageId);
        }
    }
}

async function deleteMoodImage(imageId) {
    // No confirmation - trust the user's delete choice
    
    try {
        await fetch(`/api/mood-board/${imageId}`, { method: 'DELETE' });
        state.moodBoardImages = state.moodBoardImages.filter(img => img.id !== imageId);
        renderMoodBoard();
        showNotification('Image removed');
        // Auto-center on remaining content
        setTimeout(fitMoodBoardToContent, 300);
        updateAIContext();
    } catch (error) {
        showNotification('Error removing image', 'error');
    }
}

function updateAIContext() {
    // Update AI agent's context with mood board descriptions
    const moodContext = state.moodBoardImages
        .map(img => img.description || img.tags?.join(', '))
        .filter(Boolean)
        .join('; ');
    
    localStorage.setItem('moodBoardContext', moodContext);
}

// ========== PLANNING TOOLS FUNCTIONALITY ==========

function initPlanningTools() {
    const closePlanningBtn = document.getElementById('closePlanningBtn');
    const cancelPlanningBtn = document.getElementById('cancelPlanningBtn');
    const savePlanningBtn = document.getElementById('savePlanningBtn');
    
    // Individual AI assist buttons for each tool
    const aiAssistShotlistBtn = document.getElementById('aiAssistShotlistBtn');
    const aiAssistStoryboardBtn = document.getElementById('aiAssistStoryboardBtn');
    const aiAssistScriptBtn = document.getElementById('aiAssistScriptBtn');
    const aiAssistCaptionBtn = document.getElementById('aiAssistCaptionBtn');
    
    const closeImageGenBtn = document.getElementById('closeImageGenBtn');
    const cancelImageGenBtn = document.getElementById('cancelImageGenBtn');
    const generateImageBtn = document.getElementById('generateImageBtn');
    const improvePromptBtn = document.getElementById('improvePromptBtn');
    
    if (closePlanningBtn) closePlanningBtn.addEventListener('click', () => closeModal('planningModal'));
    if (cancelPlanningBtn) cancelPlanningBtn.addEventListener('click', () => closeModal('planningModal'));
    if (savePlanningBtn) savePlanningBtn.addEventListener('click', savePlanningData);
    
    // AI assist for each tool type
    if (aiAssistShotlistBtn) aiAssistShotlistBtn.addEventListener('click', () => startAIAssist('shotlist'));
    if (aiAssistStoryboardBtn) aiAssistStoryboardBtn.addEventListener('click', () => startAIAssist('storyboard'));
    if (aiAssistScriptBtn) aiAssistScriptBtn.addEventListener('click', () => startAIAssist('script'));
    if (aiAssistCaptionBtn) aiAssistCaptionBtn.addEventListener('click', () => startAIAssist('caption'));
    
    if (closeImageGenBtn) closeImageGenBtn.addEventListener('click', () => closeModal('imageGenModal'));
    if (cancelImageGenBtn) cancelImageGenBtn.addEventListener('click', () => closeModal('imageGenModal'));
    if (generateImageBtn) generateImageBtn.addEventListener('click', generateImage);
    if (improvePromptBtn) improvePromptBtn.addEventListener('click', improveImagePrompt);
}

function openPlanningTool(toolType) {
    state.currentPlanningTool = toolType;
    
    const titles = {
        shotlist: '📋 Shot List',
        storyboard: '🎬 Storyboard',
        script: '📝 Script',
        caption: '💬 Caption',
        moodboard: '🎨 Mood Board Reference'
    };
    
    document.getElementById('planningModalTitle').textContent = titles[toolType] || 'Planning Tool';
    
    // Hide all sections
    document.querySelectorAll('.planning-section').forEach(s => s.style.display = 'none');
    
    // Show relevant section
    const sectionId = toolType + 'Section';
    const section = document.getElementById(sectionId);
    console.log('Opening planning tool:', toolType, 'Section ID:', sectionId, 'Section found:', !!section);
    if (section) {
        section.style.display = 'block';
        console.log('Section display set to block');
    }
    
    // Load existing data and ensure form is visible
    loadPlanningData(toolType);
    
    openModal('planningModal');
}

function loadPlanningData(toolType) {
    const data = state.selectedItem?.planning_data?.[toolType];
    
    switch(toolType) {
        case 'shotlist':
            // Always show at least one empty shot for manual entry
            renderShotList(data?.shots || [{type: '', angle: '', description: '', duration: ''}]);
            break;
        case 'storyboard':
            // Always show at least one empty frame for manual entry
            renderStoryboard(data?.frames || [{frame_number: 1, description: '', notes: ''}]);
            break;
        case 'script':
            document.getElementById('scriptContent').value = data?.content || '';
            updateScriptMeta();
            break;
        case 'caption':
            document.getElementById('captionContent').value = data?.content || '';
            updateCaptionMeta();
            break;
        case 'moodboard':
            renderMoodboardPreview(data?.images || []);
            break;
    }
}

async function savePlanningData() {
    if (!state.selectedItem) return;
    
    const toolType = state.currentPlanningTool;
    let data = {};
    
    switch(toolType) {
        case 'shotlist':
            data = { shots: collectShotListData() };
            break;
        case 'storyboard':
            data = { frames: collectStoryboardData() };
            break;
        case 'script':
            data = { content: document.getElementById('scriptContent').value };
            break;
        case 'caption':
            data = { content: document.getElementById('captionContent').value };
            break;
        case 'moodboard':
            data = { images: getSelectedMoodImages() };
            break;
    }
    
    console.log('Saving planning data:', toolType, data);
    
    try {
        const response = await fetch(`/api/media-items/${state.selectedItem.id}/planning`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: toolType, data })
        });
        
        const result = await response.json();
        console.log('Save response:', result);
        
        if (!response.ok) {
            throw new Error(result.error || 'Save failed');
        }
        
        // Update local state
        if (!state.selectedItem.planning_data) {
            state.selectedItem.planning_data = {};
        }
        state.selectedItem.planning_data[toolType] = data;
        
        // Update status indicator
        const statusEl = document.getElementById(toolType + 'Status');
        if (statusEl) statusEl.classList.add('active');
        
        // Reload media items to ensure sync
        await loadMediaItems();
        
        showNotification('Planning data saved');
        closeModal('planningModal');
    } catch (error) {
        console.error('Save error:', error);
        showNotification('Error saving planning data', 'error');
    }
}

// ========== AI ASSIST WITH CLARIFYING QUESTIONS ==========

async function startAIAssist(toolType) {
    const contentItem = state.selectedItem;
    
    if (!contentItem) {
        showNotification('Please select a content item first', 'error');
        return;
    }
    
    // Generate directly without asking questions - use existing content context
    showNotification('AI is generating content...', 'info');
    
    // Get mood board context
    const moodContext = localStorage.getItem('moodBoardContext') || '';
    
    // Prepare context for AI - no questions, just generate based on existing content
    const context = {
        content_title: contentItem.title,
        content_type: contentItem.content_type,
        description: contentItem.description,
        brand: state.brandProfile?.name,
        industry: state.brandProfile?.industry,
        mood_board_context: moodContext,
        tool_type: toolType || state.currentPlanningTool,
        user_instructions: `Generate appropriate content for this ${contentItem.content_type}`
    };
    
    try {
        // Generate directly without questions
        const response = await fetch('/api/ai/generate-planning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(context)
        });
        
        const data = await response.json();
        console.log('AI response:', data);
        
        if (data.content) {
            applyAIGeneratedContent(toolType || state.currentPlanningTool, data.content);
            showNotification('AI content generated!');
        } else if (data.error) {
            showNotification(`Error: ${data.error}`, 'error');
        } else {
            showNotification('Error generating content', 'error');
        }
    } catch (error) {
        console.error('AI assist error:', error);
        showNotification('Error getting AI assistance', 'error');
    }
}

function applyAIGeneratedContent(toolType, content) {
    switch(toolType) {
        case 'shotlist':
            if (content.shots) {
                renderShotList(content.shots);
            }
            break;
        case 'storyboard':
            if (content.frames) {
                renderStoryboard(content.frames);
            }
            break;
        case 'script':
            if (content.script) {
                document.getElementById('scriptContent').value = content.script;
                updateScriptMeta();
            }
            break;
        case 'caption':
            if (content.caption) {
                document.getElementById('captionContent').value = content.caption;
                updateCaptionMeta();
            }
            break;
    }
}

function renderClarifyingQuestions(questions) {
    const container = document.getElementById('clarifyingQuestions');
    
    let html = '<h3>Let\'s clarify a few things first...</h3><div id="questionsList">';
    
    questions.forEach((q, i) => {
        html += `
            <div class="question-item">
                <label>${q.question}</label>
                ${q.type === 'text' ? 
                    `<input type="text" class="premium-input" id="answer_${i}" placeholder="${q.placeholder || ''}">` :
                    q.type === 'select' ?
                    `<select class="premium-input" id="answer_${i}">
                        ${q.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>` :
                    `<textarea class="premium-textarea" id="answer_${i}" rows="3" placeholder="${q.placeholder || ''}"></textarea>`
                }
            </div>
        `;
    });
    
    html += '</div>';
    html += `
        <div class="question-actions">
            <button class="btn-ghost" onclick="skipQuestions()">Skip & Generate</button>
            <button class="btn-primary" onclick="submitAnswers()">Submit Answers</button>
        </div>
    `;
    
    container.innerHTML = html;
    container.style.display = 'block';
    
    // Store questions for later
    state.currentQuestions = questions;
}

function skipQuestions() {
    generatePlanningContent({});
}

async function submitAnswers() {
    const answers = {};
    state.currentQuestions.forEach((q, i) => {
        const input = document.getElementById(`answer_${i}`);
        answers[q.key] = input.value;
    });
    
    await generatePlanningContent(answers);
}

async function generatePlanningContent(answers) {
    const toolType = state.currentPlanningTool;
    const contentItem = state.selectedItem;
    
    showNotification('AI is generating your content...', 'info');
    
    // Hide questions
    document.getElementById('clarifyingQuestions').style.display = 'none';
    
    const moodContext = localStorage.getItem('moodBoardContext') || '';
    
    try {
        const response = await fetch('/api/ai/generate-planning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tool_type: toolType,
                content_item: contentItem,
                answers: answers,
                brand: state.brandProfile,
                mood_context: moodContext
            })
        });
        
        const result = await response.json();
        
        // Populate the planning tool with AI-generated content
        populatePlanningTool(toolType, result.data);
        
        showNotification('Content generated successfully!');
    } catch (error) {
        showNotification('Error generating content', 'error');
    }
}

function populatePlanningTool(toolType, data) {
    switch(toolType) {
        case 'shotlist':
            renderShotList(data.shots || []);
            break;
        case 'storyboard':
            renderStoryboard(data.frames || []);
            break;
        case 'script':
            document.getElementById('scriptContent').value = data.content || '';
            updateScriptMeta();
            break;
        case 'caption':
            document.getElementById('captionContent').value = data.content || '';
            updateCaptionMeta();
            break;
    }
}

// ========== SHOT LIST ==========

function renderShotList(shots) {
    const container = document.getElementById('shotListItems');
    console.log('renderShotList called, container:', !!container, 'shots:', shots);
    if (!container) {
        console.error('shotListItems container not found!');
        return;
    }
    
    // Always render shots, even if empty array - show at least one empty shot
    if (!shots || shots.length === 0) {
        shots = [{ type: '', angle: '', description: '', duration: '' }];
    }
    
    console.log('Rendering', shots.length, 'shots');
    container.innerHTML = shots.map((shot, i) => `
        <div class="shot-item" data-index="${i}">
            <div class="shot-item-header">
                <span class="shot-number">Shot ${i + 1}</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-ghost btn-sm" onclick="generateShotImage(${i})" title="Generate AI image for this shot">
                        <span>✨</span> Generate Image
                    </button>
                    <button class="btn-ghost btn-sm" onclick="removeShot(${i})">Remove</button>
                </div>
            </div>
            <div class="shot-item-grid">
                <div class="shot-image-upload" onclick="uploadShotImage(${i})">
                    ${shot.image ? `<img src="${shot.image}" alt="Shot ${i + 1}">` : '<div class="shot-image-placeholder">📷<br>Click to Upload<br>or Generate AI Image</div>'}
                </div>
                <div class="shot-fields">
                    <input type="text" class="premium-input" placeholder="Shot type (e.g., Wide, Close-up, Medium)" value="${shot.type || ''}" onchange="updateShot(${i}, 'type', this.value)">
                    <input type="text" class="premium-input" placeholder="Camera angle (e.g., Eye level, Low angle, High angle)" value="${shot.angle || ''}" onchange="updateShot(${i}, 'angle', this.value)">
                    <textarea class="premium-textarea" rows="3" placeholder="Shot description and notes..." onchange="updateShot(${i}, 'description', this.value)">${shot.description || ''}</textarea>
                    <input type="text" class="premium-input" placeholder="Duration (e.g., 5s, 3-5s)" value="${shot.duration || ''}" onchange="updateShot(${i}, 'duration', this.value)">
                </div>
            </div>
        </div>
    `).join('');
}

function addShot() {
    const container = document.getElementById('shotListItems');
    const shots = collectShotListData();
    shots.push({ type: '', angle: '', description: '', duration: '', image: null });
    renderShotList(shots);
}

function uploadShotImage(index) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const shots = collectShotListData();
                shots[index].image = event.target.result;
                renderShotList(shots);
            };
            reader.readAsDataURL(file);
        }
    };
    input.click();
}

async function generateShotImage(index) {
    const shots = collectShotListData();
    const shot = shots[index];
    
    if (!shot.description || shot.description.trim() === '') {
        showNotification('Please add a description for this shot first', 'error');
        return;
    }
    
    showNotification('Generating image for shot...', 'info');
    
    try {
        // Build prompt from shot details
        const prompt = `${shot.type || 'Shot'} ${shot.angle || 'angle'}: ${shot.description}`;
        
        const response = await fetch('/api/ai/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                brand_profile_id: state.brandProfile?.id
            })
        });
        
        const data = await response.json();
        
        if (data.image_url) {
            shots[index].image = data.image_url;
            renderShotList(shots);
            showNotification('Image generated!');
        } else if (data.error) {
            showNotification(data.error, 'error');
            if (data.description) {
                console.log('AI description fallback:', data.description);
            }
        } else {
            showNotification('Error generating image', 'error');
        }
    } catch (error) {
        console.error('Image generation error:', error);
        showNotification('Error generating image', 'error');
    }
}

function removeShot(index) {
    const shots = collectShotListData();
    shots.splice(index, 1);
    renderShotList(shots);
}

function updateShot(index, field, value) {
    // Data is updated in real-time via input values
}

function collectShotListData() {
    const items = document.querySelectorAll('.shot-item');
    return Array.from(items).map(item => {
        const inputs = item.querySelectorAll('input, textarea');
        const imageEl = item.querySelector('.shot-image-upload img');
        return {
            type: inputs[0].value,
            angle: inputs[1].value,
            description: inputs[2].value,
            duration: inputs[3].value,
            image: imageEl ? imageEl.src : null
        };
    });
}

// ========== STORYBOARD ==========

function renderStoryboard(frames) {
    const container = document.getElementById('storyboardFrames');
    if (!container) return;
    
    // Always render frames, even if empty - show at least one empty frame
    if (!frames || frames.length === 0) {
        frames = [{ frame_number: 1, image: null, description: '', notes: '' }];
    }
    
    container.innerHTML = frames.map((frame, i) => `
        <div class="storyboard-frame" data-index="${i}">
            <div class="frame-canvas" onclick="uploadFrameImage(${i})">
                ${frame.image ? `<img src="${frame.image}" style="width:100%;height:100%;object-fit:cover;">` : '+ Add Image'}
            </div>
            <textarea class="premium-textarea" rows="3" placeholder="Frame description" onchange="updateFrame(${i}, 'description', this.value)">${frame.description || ''}</textarea>
            <button class="btn-ghost btn-sm" onclick="removeFrame(${i})" style="margin-top: 0.5rem;">Remove Frame</button>
        </div>
    `).join('');
}

function addFrame() {
    const frames = collectStoryboardData();
    frames.push({ image: null, description: '' });
    renderStoryboard(frames);
}

function removeFrame(index) {
    const frames = collectStoryboardData();
    frames.splice(index, 1);
    renderStoryboard(frames);
}

function updateFrame(index, field, value) {
    // Data updated in real-time
}

function uploadFrameImage(index) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('image', file);
            
            try {
                const response = await fetch('/api/upload-temp', {
                    method: 'POST',
                    body: formData
                });
                const { url } = await response.json();
                
                const frames = collectStoryboardData();
                frames[index].image = url;
                renderStoryboard(frames);
            } catch (error) {
                showNotification('Error uploading image', 'error');
            }
        }
    };
    input.click();
}

function collectStoryboardData() {
    const items = document.querySelectorAll('.storyboard-frame');
    return Array.from(items).map(item => {
        const img = item.querySelector('img');
        const textarea = item.querySelector('textarea');
        return {
            image: img ? img.src : null,
            description: textarea.value
        };
    });
}

// ========== SCRIPT & CAPTION ==========

function updateScriptMeta() {
    const content = document.getElementById('scriptContent').value;
    const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
    const readTime = Math.ceil(words / 150 * 60); // 150 words per minute
    
    document.getElementById('wordCount').textContent = `${words} words`;
    document.getElementById('readTime').textContent = `~${readTime} sec read time`;
}

function updateCaptionMeta() {
    const content = document.getElementById('captionContent').value;
    document.getElementById('charCount').textContent = `${content.length} characters`;
}

// Add event listeners for real-time updates
document.addEventListener('DOMContentLoaded', () => {
    const scriptContent = document.getElementById('scriptContent');
    const captionContent = document.getElementById('captionContent');
    
    if (scriptContent) {
        scriptContent.addEventListener('input', updateScriptMeta);
    }
    
    if (captionContent) {
        captionContent.addEventListener('input', updateCaptionMeta);
    }
});

function addHashtags() {
    const textarea = document.getElementById('captionContent');
    const cursor = textarea.selectionStart;
    const text = textarea.value;
    const hashtags = '\n\n#content #socialmedia #creative';
    textarea.value = text.slice(0, cursor) + hashtags + text.slice(cursor);
    updateCaptionMeta();
}

function addEmojis() {
    const textarea = document.getElementById('captionContent');
    const cursor = textarea.selectionStart;
    const text = textarea.value;
    const emojis = '✨ 🎯 💡 ';
    textarea.value = text.slice(0, cursor) + emojis + text.slice(cursor);
    updateCaptionMeta();
}

function addCTA() {
    const textarea = document.getElementById('captionContent');
    const cursor = textarea.selectionStart;
    const text = textarea.value;
    const cta = '\n\n👉 Link in bio to learn more!';
    textarea.value = text.slice(0, cursor) + cta + text.slice(cursor);
    updateCaptionMeta();
}

// ========== MOOD BOARD PREVIEW ==========

function renderMoodboardPreview(selectedImages) {
    const container = document.getElementById('moodboardPreview');
    if (!container) return;
    
    if (selectedImages.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem; grid-column: 1/-1;">No images selected</p>';
        return;
    }
    
    container.innerHTML = selectedImages.map(img => `
        <div class="moodboard-preview-item" onclick="removeMoodboardPreview('${img.id}')">
            <img src="${img.url}" alt="">
        </div>
    `).join('');
}

function openMoodBoardSelector() {
    // Scroll to mood board module
    const module = document.getElementById('moodBoardModule');
    if (module) {
        module.scrollIntoView({ behavior: 'smooth' });
        showNotification('Select images from your mood board, then return here', 'info');
    }
}

function getSelectedMoodImages() {
    const selected = document.querySelectorAll('.mood-image.selected');
    return Array.from(selected).map(el => {
        const id = el.dataset.id;
        return state.moodBoardImages.find(img => img.id === id);
    }).filter(Boolean);
}

function removeMoodboardPreview(imageId) {
    const imageEl = document.querySelector(`.mood-image[data-id="${imageId}"]`);
    if (imageEl) {
        imageEl.classList.remove('selected');
    }
    renderMoodboardPreview(getSelectedMoodImages());
}

// ========== IMAGE GENERATION ==========

function loadStyleReferences() {
    const container = document.getElementById('styleReferenceGrid');
    if (!container) return;
    
    if (state.moodBoardImages.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1/-1;">No mood board images available</p>';
        return;
    }
    
    container.innerHTML = state.moodBoardImages.map(img => `
        <div class="style-reference-item" data-id="${img.id}" onclick="toggleStyleReference('${img.id}')">
            <img src="${img.url}" alt="">
        </div>
    `).join('');
}

function toggleStyleReference(imageId) {
    const item = document.querySelector(`.style-reference-item[data-id="${imageId}"]`);
    if (item) {
        item.classList.toggle('selected');
    }
}

async function improveImagePrompt() {
    const promptInput = document.getElementById('imagePrompt');
    const originalPrompt = promptInput.value.trim();
    
    if (!originalPrompt) {
        showNotification('Please enter a prompt first', 'error');
        return;
    }
    
    showNotification('AI is improving your prompt...', 'info');
    
    const moodContext = localStorage.getItem('moodBoardContext') || '';
    
    try {
        const response = await fetch('/api/ai/improve-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: originalPrompt,
                brand: state.brandProfile,
                mood_context: moodContext
            })
        });
        
        const { improved_prompt } = await response.json();
        promptInput.value = improved_prompt;
        showNotification('Prompt improved!');
    } catch (error) {
        showNotification('Error improving prompt', 'error');
    }
}

async function generateImage() {
    const prompt = document.getElementById('imagePrompt').value.trim();
    
    if (!prompt) {
        showNotification('Please enter a prompt', 'error');
        return;
    }
    
    const selectedRefs = document.querySelectorAll('.style-reference-item.selected');
    const styleImages = Array.from(selectedRefs).map(el => el.dataset.id);
    
    showNotification('Generating image...', 'info');
    
    try {
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                style_references: styleImages,
                brand_profile_id: state.brandProfile?.id
            })
        });
        
        const { image_url } = await response.json();
        
        // Add to mood board
        state.moodBoardImages.push({
            id: Date.now().toString(),
            url: image_url,
            description: prompt,
            generated: true
        });
        
        renderMoodBoard();
        closeModal('imageGenModal');
        showNotification('Image generated and added to mood board!');
        
        // Scroll to mood board
        document.getElementById('moodBoardModule').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        showNotification('Error generating image', 'error');
    }
}

// Mood board rotation and scaling
function rotateMoodImage(imageId) {
    const imgData = state.moodBoardImages.find(i => i.id === imageId);
    if (imgData) {
        imgData.rotation = (imgData.rotation || 0) + 15;
        const imageEl = document.querySelector(`.mood-image[data-id="${imageId}"]`);
        if (imageEl) {
            imageEl.style.transform = `rotate(${imgData.rotation}deg) scale(${imgData.scale || 1})`;
        }
        saveMoodBoardState();
    }
}

function scaleMoodImage(imageId, factor) {
    const imgData = state.moodBoardImages.find(i => i.id === imageId);
    if (imgData) {
        imgData.scale = Math.max(0.5, Math.min(2, (imgData.scale || 1) * factor));
        const imageEl = document.querySelector(`.mood-image[data-id="${imageId}"]`);
        if (imageEl) {
            imageEl.style.transform = `rotate(${imgData.rotation || 0}deg) scale(${imgData.scale})`;
        }
        saveMoodBoardState();
    }
}

function adjustImageOpacity(imageId, delta) {
    const imgData = state.moodBoardImages.find(i => i.id === imageId);
    if (imgData) {
        imgData.opacity = Math.max(0.1, Math.min(1, (imgData.opacity !== undefined ? imgData.opacity : 1) + delta));
        const imageEl = document.querySelector(`.mood-image[data-id="${imageId}"]`);
        if (imageEl) imageEl.style.opacity = imgData.opacity;
        saveMoodBoardState();
    }
}

let _saveMoodBoardTimeout = null;

function saveMoodBoardState() {
    // Debounce: wait 500ms after last call before actually saving
    if (_saveMoodBoardTimeout) clearTimeout(_saveMoodBoardTimeout);
    _saveMoodBoardTimeout = setTimeout(_doSaveMoodBoardState, 500);
}

async function _doSaveMoodBoardState() {
    // Batch all position updates into a single request
    const updates = state.moodBoardImages
        .filter(img => img.id)
        .map(img => ({
            id: img.id,
            x: img.x,
            y: img.y,
            rotation: img.rotation || 0,
            scale: img.scale || 1,
            opacity: img.opacity !== undefined ? img.opacity : 1,
            zIndex: img.zIndex || 1
        }));
    
    if (updates.length === 0) return;
    
    try {
        await fetch('/api/mood-board/batch-update', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ updates })
        });
    } catch (error) {
        console.error('Error saving mood board state:', error);
    }
}

// ============================================================
// PREMIUM BRUSH CONTROL FUNCTIONS
// ============================================================

function setBrushMinSize(val) {
    moodBoardState.brushMinSize = parseInt(val) / 100;
    const label = document.getElementById('brushMinSizeLabel');
    if (label) label.textContent = val + '%';
}

function setBrushFlow(val) {
    moodBoardState.brushFlow = parseInt(val) / 100;
    const label = document.getElementById('brushFlowLabel');
    if (label) label.textContent = val + '%';
}

function setBrushSmoothing(val) {
    moodBoardState.brushSmoothing = parseInt(val);
    const label = document.getElementById('brushSmoothLabel');
    if (label) label.textContent = val;
}

function setBrushTaper(val) {
    moodBoardState.brushTaper = parseInt(val);
    const label = document.getElementById('brushTaperLabel');
    if (label) label.textContent = val;
}

function setDrawTool(tool) {
    moodBoardState.activeTool = tool;
    // Update UI: deactivate brush buttons when in select mode
    document.querySelectorAll('.draw-tool-btn[data-brush]').forEach(b => {
        b.classList.toggle('active', tool === 'draw' && b.dataset.brush === moodBoardState.brushType);
    });
    const selBtn = document.querySelector('.draw-tool-btn[data-tool="select"]');
    if (selBtn) selBtn.classList.toggle('active', tool === 'select');

    // Show/hide selection overlay
    const overlay = document.getElementById('drawSelectionOverlay');
    if (overlay) overlay.style.display = tool === 'select' ? 'block' : 'none';

    // Update cursor
    const drawCanvas = moodBoardState.drawCanvas;
    if (drawCanvas) drawCanvas.style.cursor = tool === 'select' ? 'crosshair' : 'crosshair';
}

// Override setBrushType to also set tool back to draw
const _origSetBrushType = setBrushType;
function setBrushTypeAndTool(type) {
    moodBoardState.activeTool = 'draw';
    const overlay = document.getElementById('drawSelectionOverlay');
    if (overlay) overlay.style.display = 'none';
    const selBtn = document.querySelector('.draw-tool-btn[data-tool="select"]');
    if (selBtn) selBtn.classList.remove('active');
    _origSetBrushType(type);
}
// Re-bind the global
window.setBrushType = setBrushTypeAndTool;

// ============================================================
// LAYER SYSTEM
// ============================================================

function renderLayerList() {
    const container = document.getElementById('drawLayerList');
    if (!container) return;
    container.innerHTML = '';
    moodBoardState.layers.forEach(layer => {
        const chip = document.createElement('div');
        chip.className = 'draw-layer-chip' +
            (layer.id === moodBoardState.activeLayerId ? ' active' : '') +
            (!layer.visible ? ' hidden' : '');
        chip.innerHTML = '<span class="layer-vis" onclick="event.stopPropagation(); toggleLayerVisibility(\'' + layer.id + '\')">' +
            (layer.visible ? '👁' : '👁‍🗨') + '</span>' +
            '<span>' + layer.name + ' (' + layer.strokes.length + ')</span>';
        chip.onclick = function() { setActiveLayer(layer.id); };
        container.appendChild(chip);
    });
}

function setActiveLayer(id) {
    moodBoardState.activeLayerId = id;
    renderLayerList();
}

function toggleLayerVisibility(id) {
    const layer = moodBoardState.layers.find(l => l.id === id);
    if (layer) {
        layer.visible = !layer.visible;
        renderLayerList();
        redrawAllStrokes();
    }
}

function addDrawLayer() {
    moodBoardState.layerCounter++;
    const newLayer = {
        id: 'layer' + moodBoardState.layerCounter,
        name: 'Layer ' + (moodBoardState.layerCounter),
        visible: true,
        strokes: []
    };
    moodBoardState.layers.push(newLayer);
    moodBoardState.activeLayerId = newLayer.id;
    renderLayerList();
    showNotification('Added ' + newLayer.name);
    if (typeof emitLayerUpdate === 'function') emitLayerUpdate();
}

function removeDrawLayer() {
    if (moodBoardState.layers.length <= 1) {
        showNotification('Cannot delete the only layer', 'error');
        return;
    }
    const activeId = moodBoardState.activeLayerId;
    const idx = moodBoardState.layers.findIndex(l => l.id === activeId);
    if (idx === -1) return;
    pushDrawUndo();
    moodBoardState.layers.splice(idx, 1);
    moodBoardState.activeLayerId = moodBoardState.layers[Math.max(0, idx - 1)].id;
    moodBoardState.redoStack = [];
    renderLayerList();
    redrawAllStrokes();
    if (typeof emitLayerUpdate === 'function') emitLayerUpdate();
}

function mergeDrawLayers() {
    const visible = moodBoardState.layers.filter(l => l.visible);
    if (visible.length < 2) {
        showNotification('Need at least 2 visible layers to merge', 'error');
        return;
    }
    pushDrawUndo();
    const merged = [];
    visible.forEach(l => merged.push(...l.strokes));
    // Remove all visible layers except the first, put merged strokes in first
    const keepId = visible[0].id;
    visible[0].strokes = merged;
    moodBoardState.layers = moodBoardState.layers.filter(l => !l.visible || l.id === keepId);
    moodBoardState.activeLayerId = keepId;
    moodBoardState.redoStack = [];
    renderLayerList();
    if (typeof emitLayerUpdate === 'function') emitLayerUpdate();
    redrawAllStrokes();
    showNotification('Merged ' + visible.length + ' layers');
}

// ============================================================
// SELECTION TOOL — crop/export rectangle
// ============================================================

function startSelection(e) {
    const rect = moodBoardState.drawCanvas.getBoundingClientRect();
    moodBoardState.isSelecting = true;
    moodBoardState.selStartX = e.clientX - rect.left;
    moodBoardState.selStartY = e.clientY - rect.top;
    moodBoardState.selectionRect = null;

    // Remove old rect element
    const overlay = document.getElementById('drawSelectionOverlay');
    const old = overlay.querySelector('.draw-selection-rect');
    if (old) old.remove();
    const actions = document.getElementById('drawSelectionActions');
    if (actions) actions.style.display = 'none';
}

function dragSelection(e) {
    if (!moodBoardState.isSelecting) return;
    const rect = moodBoardState.drawCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.min(moodBoardState.selStartX, cx);
    const y = Math.min(moodBoardState.selStartY, cy);
    const w = Math.abs(cx - moodBoardState.selStartX);
    const h = Math.abs(cy - moodBoardState.selStartY);

    moodBoardState.selectionRect = { x, y, w, h };

    const overlay = document.getElementById('drawSelectionOverlay');
    let el = overlay.querySelector('.draw-selection-rect');
    if (!el) {
        el = document.createElement('div');
        el.className = 'draw-selection-rect';
        overlay.appendChild(el);
    }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
}

function endSelection() {
    moodBoardState.isSelecting = false;
    if (!moodBoardState.selectionRect || moodBoardState.selectionRect.w < 10 || moodBoardState.selectionRect.h < 10) {
        cancelSelection();
        return;
    }
    // Show action buttons near selection
    const r = moodBoardState.selectionRect;
    const actions = document.getElementById('drawSelectionActions');
    if (actions) {
        actions.style.display = 'flex';
        actions.style.left = r.x + 'px';
        actions.style.top = (r.y + r.h + 8) + 'px';
    }
}

function cancelSelection() {
    moodBoardState.isSelecting = false;
    moodBoardState.selectionRect = null;
    const overlay = document.getElementById('drawSelectionOverlay');
    if (overlay) {
        const el = overlay.querySelector('.draw-selection-rect');
        if (el) el.remove();
    }
    const actions = document.getElementById('drawSelectionActions');
    if (actions) actions.style.display = 'none';
}

// exportSelectionPNG and selectionToWorkbenchImage are defined in the SELECTION EXPORT section below

// ============================================================
// FRESH CANVAS — standalone blank canvas for sketching
// ============================================================

let freshCanvasState = null;

function openFreshCanvas() {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fresh-canvas-modal';
    modal.id = 'freshCanvasModal';

    const W = 1920, H = 1080;

    modal.innerHTML = '<div class="fresh-canvas-header">' +
        '<h3>Fresh Canvas</h3>' +
        '<select id="freshCanvasBg" onchange="setFreshCanvasBg(this.value)" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:0.2rem 0.5rem;font-size:0.75rem;">' +
        '<option value="white">White</option><option value="black">Black</option><option value="transparent">Transparent</option></select>' +
        '<button class="draw-tool-btn small" onclick="freshCanvasUndo()" title="Undo">↩</button>' +
        '<button class="draw-tool-btn small" onclick="freshCanvasRedo()" title="Redo">↪</button>' +
        '<button class="draw-tool-btn" onclick="exportFreshCanvas(true)" style="font-size:0.75rem;">Export PNG</button>' +
        '<button class="draw-tool-btn" onclick="freshCanvasToWorkbench()" style="font-size:0.75rem;">Add to Workbench</button>' +
        '<div style="flex:1"></div>' +
        '<button class="draw-tool-btn" onclick="closeFreshCanvas()" style="font-size:0.85rem;">Close</button>' +
        '</div>' +
        '<div class="fresh-canvas-body"><canvas id="freshCanvasDraw" width="' + W + '" height="' + H + '"></canvas></div>';

    document.body.appendChild(modal);

    const canvas = document.getElementById('freshCanvasDraw');
    const ctx = canvas.getContext('2d');

    // Scale canvas to fit viewport
    const body = modal.querySelector('.fresh-canvas-body');
    const maxW = body.clientWidth * 0.9;
    const maxH = body.clientHeight * 0.9;
    const displayScale = Math.min(maxW / W, maxH / H, 1);
    canvas.style.width = (W * displayScale) + 'px';
    canvas.style.height = (H * displayScale) + 'px';

    freshCanvasState = {
        canvas, ctx, W, H, displayScale,
        bg: 'white',
        strokes: [],
        currentStroke: null,
        isDrawing: false,
        undoStack: [],
        redoStack: [],
        lastX: 0, lastY: 0
    };

    canvas.addEventListener('pointerdown', freshCanvasDown);
    canvas.addEventListener('pointermove', freshCanvasMove);
    canvas.addEventListener('pointerup', freshCanvasUp);
    canvas.addEventListener('pointerleave', freshCanvasUp);
    canvas.style.touchAction = 'none';
}

function freshCanvasDown(e) {
    const fc = freshCanvasState;
    if (!fc) return;
    e.preventDefault();
    const rect = fc.canvas.getBoundingClientRect();
    const scaleX = fc.W / rect.width;
    const scaleY = fc.H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const pressure = e.pressure || 0.5;
    fc.isDrawing = true;
    fc.currentStroke = {
        brushType: moodBoardState.brushType === 'eraser' ? 'eraser' : moodBoardState.brushType,
        brushSize: moodBoardState.brushSize * 2,
        brushColor: moodBoardState.brushColor,
        brushOpacity: moodBoardState.brushOpacity,
        brushFlow: moodBoardState.brushFlow,
        brushMinSize: moodBoardState.brushMinSize,
        brushSmoothing: moodBoardState.brushSmoothing,
        brushTaper: moodBoardState.brushTaper,
        points: [{ x, y, pressure, t: performance.now() }]
    };
    fc.lastX = x;
    fc.lastY = y;
}

function freshCanvasMove(e) {
    const fc = freshCanvasState;
    if (!fc || !fc.isDrawing) return;
    e.preventDefault();
    const rect = fc.canvas.getBoundingClientRect();
    const scaleX = fc.W / rect.width;
    const scaleY = fc.H / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const pressure = moodBoardState.pressureSensitivity ? (e.pressure || 0.5) : 0.5;
    fc.currentStroke.points.push({ x, y, pressure, t: performance.now() });
    freshCanvasRedraw();
}

function freshCanvasUp() {
    const fc = freshCanvasState;
    if (!fc || !fc.isDrawing) return;
    if (fc.currentStroke && fc.currentStroke.points.length > 1) {
        fc.undoStack.push(JSON.parse(JSON.stringify(fc.strokes)));
        fc.strokes.push(fc.currentStroke);
        fc.redoStack = [];
    }
    fc.currentStroke = null;
    fc.isDrawing = false;
    freshCanvasRedraw();
}

function freshCanvasRedraw() {
    const fc = freshCanvasState;
    if (!fc) return;
    const ctx = fc.ctx;
    ctx.clearRect(0, 0, fc.W, fc.H);
    if (fc.bg === 'white') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fc.W, fc.H); }
    else if (fc.bg === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, fc.W, fc.H); }
    fc.strokes.forEach(s => renderFullStroke(ctx, s, 1, 0, 0));
    if (fc.currentStroke) renderFullStroke(ctx, fc.currentStroke, 1, 0, 0);
}

function freshCanvasUndo() {
    const fc = freshCanvasState;
    if (!fc || fc.undoStack.length === 0) return;
    fc.redoStack.push(JSON.parse(JSON.stringify(fc.strokes)));
    fc.strokes = fc.undoStack.pop();
    freshCanvasRedraw();
}

function freshCanvasRedo() {
    const fc = freshCanvasState;
    if (!fc || fc.redoStack.length === 0) return;
    fc.undoStack.push(JSON.parse(JSON.stringify(fc.strokes)));
    fc.strokes = fc.redoStack.pop();
    freshCanvasRedraw();
}

function setFreshCanvasBg(val) {
    if (freshCanvasState) {
        freshCanvasState.bg = val;
        freshCanvasRedraw();
    }
}

function exportFreshCanvas(download) {
    const fc = freshCanvasState;
    if (!fc) return;
    const link = document.createElement('a');
    link.download = 'canvas_' + Date.now() + '.png';
    link.href = fc.canvas.toDataURL('image/png');
    if (download) link.click();
    showNotification('Exported fresh canvas');
    return link.href;
}

function freshCanvasToWorkbench() {
    const fc = freshCanvasState;
    if (!fc) return;
    const dataUrl = fc.canvas.toDataURL('image/png');
    const newImg = {
        id: 'fcanvas_' + Date.now(),
        url: dataUrl,
        description: 'Fresh canvas sketch',
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
        scale: 0.5,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        width: fc.W,
        height: fc.H
    };
    state.moodBoardImages.push(newImg);
    appendMoodImage(newImg);
    showNotification('Canvas added to workbench');
    closeFreshCanvas();
}

function closeFreshCanvas() {
    const modal = document.getElementById('freshCanvasModal');
    if (modal) modal.remove();
    freshCanvasState = null;
}

// Global exports for fresh canvas
window.freshCanvasUndo = freshCanvasUndo;
window.freshCanvasRedo = freshCanvasRedo;
window.setFreshCanvasBg = setFreshCanvasBg;
window.exportFreshCanvas = exportFreshCanvas;
window.freshCanvasToWorkbench = freshCanvasToWorkbench;
window.closeFreshCanvas = closeFreshCanvas;

// Make functions globally accessible
window.openPlanningTool = openPlanningTool;
window.selectMoodImage = selectMoodImage;
window.deleteMoodImage = deleteMoodImage;
window.rotateMoodImage = rotateMoodImage;
window.scaleMoodImage = scaleMoodImage;
window.zoomMoodBoard = zoomMoodBoard;
window.resetMoodBoardView = resetMoodBoardView;
window.fitMoodBoardToContent = fitMoodBoardToContent;
window.addTextToCanvas = typeof addTextToCanvas !== 'undefined' ? addTextToCanvas : function() {};
window.toggleDrawMode = toggleDrawMode;
window.addShot = addShot;
window.removeShot = removeShot;
window.updateShot = updateShot;
window.uploadShotImage = uploadShotImage;
window.generateShotImage = generateShotImage;
window.addFrame = addFrame;
window.removeFrame = removeFrame;
window.updateFrame = updateFrame;
window.uploadFrameImage = uploadFrameImage;
window.addHashtags = addHashtags;
window.addEmojis = addEmojis;
window.addCTA = addCTA;
window.openMoodBoardSelector = openMoodBoardSelector;
window.toggleStyleReference = toggleStyleReference;
window.skipQuestions = skipQuestions;
window.submitAnswers = submitAnswers;
window.appendMoodImage = appendMoodImage;
window.saveMoodBoardView = saveMoodBoardView;
window.restoreMoodBoardView = restoreMoodBoardView;
// Workbench new functions
window.mediaWallDeselectAll = mediaWallDeselectAll;
window.showMediaWallContextMenu = showMediaWallContextMenu;
window.downloadMoodImage = downloadMoodImage;
window.duplicateMoodImage = duplicateMoodImage;
window.adjustImageOpacity = adjustImageOpacity;
window.showVariationSubmenu = showVariationSubmenu;
window.showManualPromptUI = showManualPromptUI;
window.runImageGeneration = runImageGeneration;
// Drawing toolbar functions
window.setBrushType = setBrushType;
window.setBrushSize = setBrushSize;
window.setBrushColor = setBrushColor;
window.setBrushOpacity = setBrushOpacity;
window.setBrushMinSize = setBrushMinSize;
window.setBrushFlow = setBrushFlow;
window.setBrushSmoothing = setBrushSmoothing;
window.setBrushTaper = setBrushTaper;
window.togglePressureSensitivity = togglePressureSensitivity;
window.drawUndo = drawUndo;
window.drawRedo = drawRedo;
window.drawClear = drawClear;
window.setDrawTool = setDrawTool;
// Layer functions
window.addDrawLayer = addDrawLayer;
window.removeDrawLayer = removeDrawLayer;
window.mergeDrawLayers = mergeDrawLayers;
window.setActiveLayer = setActiveLayer;
window.toggleLayerVisibility = toggleLayerVisibility;
// Selection & export
window.exportSelectionPNG = exportSelectionPNG;
window.selectionToWorkbenchImage = selectionToWorkbenchImage;
window.cancelSelection = cancelSelection;
// Fresh canvas
window.openFreshCanvas = openFreshCanvas;
// Radial menu
window.toggleRadialMenu = toggleRadialMenu;
// RADIAL MENU LOGIC
// ============================================================

function toggleRadialMenu() {
    const hub = document.getElementById('rdmHub');
    const ring = document.getElementById('rdmRing');
    if (!hub || !ring) return;

    if (!moodBoardState.drawMode) {
        // Draw mode is OFF — activate it and open the ring
        toggleDrawMode();
        ring.classList.add('open');
        hub.classList.add('open');
    } else {
        const isOpen = ring.classList.contains('open');
        if (isOpen) {
            // Ring is open — close it (stay in draw mode)
            ring.classList.remove('open');
            hub.classList.remove('open');
        } else {
            // Ring is closed — exit draw mode
            toggleDrawMode();
        }
    }
}

// Close radial menu ring when clicking outside (draw mode stays on so user can keep drawing)
document.addEventListener('pointerdown', function(e) {
    const menu = document.getElementById('drawToolbar');
    if (!menu) return;
    // Don't close if clicking inside the menu
    if (menu.contains(e.target)) return;
    // Don't close if clicking on the draw canvas (user is drawing)
    if (moodBoardState.drawCanvas && moodBoardState.drawCanvas.contains(e.target)) return;
    const ring = document.getElementById('rdmRing');
    const hub = document.getElementById('rdmHub');
    if (ring && ring.classList.contains('open')) {
        ring.classList.remove('open');
        if (hub) hub.classList.remove('open');
    }
});

// Update hub icon to reflect current brush
function updateRadialHubIcon() {
    const hubIcon = document.getElementById('rdmHubIcon');
    if (!hubIcon) return;
    const icons = { pen: '\u{1F58A}\uFE0F', pencil: '\u270F\uFE0F', marker: '\u{1F58D}\uFE0F', spray: '\u{1F4A8}', eraser: '\u{1F9FD}' };
    hubIcon.textContent = icons[moodBoardState.brushType] || '\u{1F58A}\uFE0F';
    // Update brush preview dot
    const preview = document.getElementById('rdmHubPreview');
    if (preview) {
        const ctx = preview.getContext('2d');
        const size = preview.width;
        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        const dotSize = Math.max(2, Math.min(size * 0.8, (moodBoardState.brushSize / 80) * size));
        ctx.arc(size / 2, size / 2, dotSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = moodBoardState.brushColor;
        ctx.globalAlpha = moodBoardState.brushOpacity;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// Patch setBrushSize/Color/Opacity/Type to also update the hub icon
(function patchRadialUpdates() {
    const origSize = setBrushSize;
    setBrushSize = function(val) { origSize(val); updateRadialHubIcon(); };
    window.setBrushSize = setBrushSize;

    const origColor = setBrushColor;
    setBrushColor = function(val) {
        origColor(val);
        updateRadialHubIcon();
        document.querySelectorAll('.rdm-swatch').forEach(function(sw) {
            const bg = sw.style.background || sw.style.backgroundColor;
            sw.classList.toggle('active', bg === val);
        });
    };
    window.setBrushColor = setBrushColor;

    const origOpacity = setBrushOpacity;
    setBrushOpacity = function(val) { origOpacity(val); updateRadialHubIcon(); };
    window.setBrushOpacity = setBrushOpacity;

    const origType = setBrushType;
    setBrushType = function(type) {
        origType(type);
        updateRadialHubIcon();
        document.querySelectorAll('.rdm-sec-btn[data-brush]').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-brush') === type);
        });
    };
    window.setBrushType = setBrushType;
})();

// ============================================================
// REAL-TIME SYNC (WebSocket via Socket.IO)
// ============================================================

var _drawSocket = null;

console.log('[DrawSync] Init section reached');
document.addEventListener('DOMContentLoaded', function() {
    console.log('[DrawSync] DOMContentLoaded — starting init');
    if (typeof io === 'undefined') {
        console.log('[DrawSync] Loading Socket.IO from CDN...');
        var script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
        script.onload = function() {
            console.log('[DrawSync] Socket.IO loaded from CDN');
            connectDrawSync();
        };
        script.onerror = function() {
            console.warn('[DrawSync] CDN load failed, trying local socketio...');
            var s2 = document.createElement('script');
            s2.src = '/static/socket.io.min.js';
            s2.onload = function() { connectDrawSync(); };
            s2.onerror = function() { console.error('[DrawSync] Could not load Socket.IO'); };
            document.head.appendChild(s2);
        };
        document.head.appendChild(script);
    } else {
        console.log('[DrawSync] Socket.IO already available');
        connectDrawSync();
    }
});

function connectDrawSync() {
    try {
        var protocol = window.location.protocol;
        var host = window.location.hostname;
        var port = '5000';
        var url = protocol + '//' + host + ':' + port;
        console.log('[DrawSync] Connecting to:', url);
        _drawSocket = io(url, {
            path: '/ws/draw',
            transports: ['polling', 'websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10
        });

        _drawSocket.on('connect', function() {
            console.log('[DrawSync] Connected:', _drawSocket.id);
            _drawSocket.emit('draw:request_state');
        });

        _drawSocket.on('connect_error', function(err) {
            console.warn('[DrawSync] Connection error:', err.message);
        });

        _drawSocket.on('draw:state', function(data) {
            // Only accept WS state if it actually has strokes AND we haven't loaded from backend yet
            if (data && data.layers && !_strokesLoaded && getAllVisibleStrokes().length === 0) {
                var wsStrokes = data.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0);
                if (wsStrokes > 0) {
                    console.log('[DrawSync] Accepting WS state with', wsStrokes, 'strokes');
                    moodBoardState.layers = data.layers;
                    moodBoardState.layerCounter = data.layerCounter || moodBoardState.layers.length;
                    moodBoardState.activeLayerId = data.activeLayerId || moodBoardState.layers[0].id;
                    renderLayerList();
                    redrawAllStrokes();
                } else {
                    console.log('[DrawSync] Ignoring empty WS state');
                }
            }
        });

        _drawSocket.on('draw:stroke_add', function(data) {
            // Server uses include_self=False, so we only get other clients' strokes
            var layer = moodBoardState.layers.find(function(l) { return l.id === data.layerId; });
            if (layer) {
                layer.strokes.push(data.stroke);
                // Clear remote progress for this sender since stroke is finalized
                if (data._sender) delete _remoteStrokes[data._sender];
                _lastWsStrokeTime = Date.now();
                redrawAllStrokes();
                console.log('[DrawSync] Received stroke from another device');
            }
        });

        _drawSocket.on('draw:stroke_progress', function(data) {
            // Live stroke being drawn on another client — render as overlay
            if (data && data.stroke && data._sender) {
                _remoteStrokes[data._sender] = data.stroke;
                _renderRemoteStrokes();
            }
        });

        _drawSocket.on('draw:layer_update', function(data) {
            if (data && data.layers) {
                moodBoardState.layers = data.layers;
                moodBoardState.layerCounter = data.layerCounter || moodBoardState.layers.length;
                renderLayerList();
                redrawAllStrokes();
            }
        });

        _drawSocket.on('draw:image_move', function(data) {
            if (data && data.imageId) {
                const el = document.querySelector('[data-id="' + data.imageId + '"]');
                if (el) {
                    el.style.left = data.left;
                    el.style.top = data.top;
                    if (data.width) el.style.width = data.width;
                    if (data.height) el.style.height = data.height;
                    if (data.transform) el.style.transform = data.transform;
                }
            }
        });

        _drawSocket.on('draw:clear', function() {
            moodBoardState.layers.forEach(function(l) { l.strokes = []; });
            redrawAllStrokes();
            renderLayerList();
        });

        _drawSocket.on('disconnect', function() {
            console.log('[DrawSync] Disconnected');
        });

    } catch(e) {
        console.warn('[DrawSync] Could not connect:', e);
    }
}

function emitStrokeAdd(layerId, stroke) {
    if (_drawSocket && _drawSocket.connected) {
        _drawSocket.emit('draw:stroke_add', { layerId: layerId, stroke: stroke, _sender: _drawSocket.id });
    }
}

function emitLayerUpdate() {
    if (_drawSocket && _drawSocket.connected) {
        _drawSocket.emit('draw:layer_update', {
            layers: moodBoardState.layers,
            layerCounter: moodBoardState.layerCounter,
            activeLayerId: moodBoardState.activeLayerId
        });
    }
}

function emitImageMove(imageId, left, top, width, height, transform) {
    if (_drawSocket && _drawSocket.connected) {
        _drawSocket.emit('draw:image_move', {
            imageId: imageId, left: left, top: top,
            width: width, height: height, transform: transform
        });
    }
}

function emitDrawClear() {
    if (_drawSocket && _drawSocket.connected) {
        _drawSocket.emit('draw:clear');
    }
}

window.emitStrokeAdd = emitStrokeAdd;
window.emitLayerUpdate = emitLayerUpdate;
window.emitImageMove = emitImageMove;
window.emitDrawClear = emitDrawClear;

// ============================================================
// LIVE STROKE PROGRESS — stream strokes to other clients as drawn
// ============================================================
var _remoteStrokes = {};
var _strokeProgressThrottle = 0;

function _emitStrokeProgress() {
    if (!_drawSocket || !_drawSocket.connected) return;
    var now = performance.now();
    if (now - _strokeProgressThrottle < 50) return;
    _strokeProgressThrottle = now;
    var stroke = moodBoardState.currentStroke;
    if (!stroke || stroke.points.length < 2) return;
    _drawSocket.emit('draw:stroke_progress', {
        _sender: _drawSocket.id,
        stroke: {
            brushType: stroke.brushType,
            brushSize: stroke.brushSize,
            brushColor: stroke.brushColor,
            brushOpacity: stroke.brushOpacity,
            brushFlow: stroke.brushFlow || 1,
            brushMinSize: stroke.brushMinSize || 0.1,
            brushSmoothing: stroke.brushSmoothing || 3,
            brushTaper: stroke.brushTaper || 0.5,
            points: stroke.points
        }
    });
}

function _renderRemoteStrokes() {
    var canvas = moodBoardState.drawCanvas;
    var ctx = moodBoardState.drawCtx;
    if (!canvas || !ctx) return;
    redrawAllStrokes();
    var zoom = moodBoardState.zoom;
    var panX = moodBoardState.panX;
    var panY = moodBoardState.panY;
    Object.keys(_remoteStrokes).forEach(function(sender) {
        var stroke = _remoteStrokes[sender];
        if (!stroke || !stroke.points || stroke.points.length < 2) return;
        renderFullStroke(ctx, stroke, zoom, panX, panY);
    });
}

// ============================================================
// STROKE PERSISTENCE — save/load to backend
// ============================================================
var _strokeSaveTimer = null;
var _strokesLoaded = false;
function saveStrokesToBackend() {
    clearTimeout(_strokeSaveTimer);
    _strokeSaveTimer = setTimeout(function() {
        try {
            var wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
            var totalStrokes = moodBoardState.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0);
            if (totalStrokes === 0) { console.log('[Strokes] Nothing to save (0 strokes)'); return; }
            // Strip non-essential fields to reduce payload size
            var cleanLayers = moodBoardState.layers.map(function(layer) {
                return {
                    id: layer.id,
                    name: layer.name,
                    visible: layer.visible,
                    strokes: layer.strokes.map(function(s) {
                        return {
                            brushType: s.brushType,
                            brushSize: s.brushSize,
                            brushColor: s.brushColor,
                            brushOpacity: s.brushOpacity,
                            brushFlow: s.brushFlow || 1,
                            brushMinSize: s.brushMinSize || 0.1,
                            brushSmoothing: s.brushSmoothing || 3,
                            brushTaper: s.brushTaper || 0.5,
                            points: s.points.map(function(p) {
                                return { x: p.x, y: p.y, pressure: p.pressure || 0.5, t: p.t || 0 };
                            })
                        };
                    })
                };
            });
            var payload = {
                workspace_id: wsId || 'default',
                layers: cleanLayers,
                layerCounter: moodBoardState.layerCounter,
                activeLayerId: moodBoardState.activeLayerId
            };
            var bodyStr = JSON.stringify(payload);
            console.log('[Strokes] Saving', totalStrokes, 'strokes, payload size:', bodyStr.length, 'bytes, wsId:', wsId || 'default');
            fetch(_getApiBase() + '/mood-board/strokes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bodyStr
            }).then(function(r) {
                console.log('[Strokes] Response status:', r.status);
                _lastSaveTime = Date.now();
                return r.json();
            }).then(function(d) {
                if (d.error) console.warn('[Strokes] save error:', d.error);
                else console.log('[Strokes] Saved OK');
            }).catch(function(e) { console.warn('[Strokes] save fetch failed:', e); });
        } catch(err) {
            console.error('[Strokes] saveStrokesToBackend exception:', err);
        }
    }, 600);
}

function loadStrokesFromBackend() {
    var wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
    var url = _getApiBase() + '/mood-board/strokes?workspace_id=' + encodeURIComponent(wsId || 'default');
    console.log('[Strokes] Loading from:', url);
    fetch(url)
        .then(function(r) {
            console.log('[Strokes] Load response status:', r.status);
            return r.json();
        })
        .then(function(d) {
            console.log('[Strokes] Load response:', d && d.layers ? d.layers.length + ' layers' : 'no data');
            if (d && d.layers && d.layers.length > 0) {
                var totalStrokes = d.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0);
                if (totalStrokes > 0) {
                    moodBoardState.layers = d.layers;
                    moodBoardState.layerCounter = d.layerCounter || moodBoardState.layers.length;
                    moodBoardState.activeLayerId = d.activeLayerId || moodBoardState.layers[0].id;
                    _strokesLoaded = true;
                    renderLayerList();
                    _ensureStrokesRendered();
                    console.log('[Strokes] Loaded', totalStrokes, 'strokes from backend');
                } else {
                    console.log('[Strokes] Backend has layers but 0 strokes');
                }
            } else {
                console.log('[Strokes] No saved strokes found on backend');
            }
        }).catch(function(e) { console.warn('[Strokes] load failed:', e); });
}

function _ensureStrokesRendered() {
    var canvas = moodBoardState.drawCanvas;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
        redrawAllStrokes();
        return;
    }
    if (!canvas) {
        initDrawCanvas();
        canvas = moodBoardState.drawCanvas;
    }
    var retries = 0;
    var interval = setInterval(function() {
        retries++;
        if (retries > 20) { clearInterval(interval); return; }
        var c = moodBoardState.drawCanvas;
        if (!c) return;
        var moodBoard = document.getElementById('moodBoard');
        if (!moodBoard) return;
        var rect = moodBoard.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) {
            if (c.width < 1 || c.height < 1) {
                c.width = rect.width;
                c.height = rect.height;
            }
            redrawAllStrokes();
            clearInterval(interval);
            console.log('[Strokes] Deferred render complete after', retries, 'retries');
        }
    }, 500);
}

// ============================================================
// SSE REAL-TIME SYNC — instant push when any client saves strokes
// ============================================================
function _getApiBase() {
    if (window.location.pathname.indexOf('/media-suite') === 0) return '/media-suite/api';
    return '/api';
}

var _syncEventSource = null;
var _lastSaveTime = 0;
var _lastWsStrokeTime = 0;

function _initStrokesAndSync() {
    console.log('[Sync] Starting stroke loader + SSE real-time sync');
    setTimeout(loadStrokesFromBackend, 800);
    _connectSSE();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initStrokesAndSync);
} else {
    _initStrokesAndSync();
}

function _connectSSE() {
    if (_syncEventSource) { try { _syncEventSource.close(); } catch(e) {} }
    var wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
    var url = _getApiBase() + '/mood-board/strokes/stream?workspace_id=' + encodeURIComponent(wsId || 'default');
    console.log('[Sync] Connecting SSE:', url);
    _syncEventSource = new EventSource(url);

    _syncEventSource.onopen = function() {
        console.log('[Sync] SSE connected');
    };

    _syncEventSource.onmessage = function(event) {
        try {
            var msg = JSON.parse(event.data);
            if (msg.connected) { console.log('[Sync] SSE handshake OK'); return; }
            if (Date.now() - _lastSaveTime < 2000) return;
            if (moodBoardState.isDrawing) return;
            // Skip SSE fetch if we recently got a stroke via WebSocket (avoids overwrite race)
            if (Date.now() - _lastWsStrokeTime < 3000) return;
            console.log('[Sync] SSE notification: strokes changed, fetching...');
            _fetchAndRedraw();
        } catch(e) { console.warn('[Sync] SSE parse error:', e); }
    };

    _syncEventSource.onerror = function() {
        console.warn('[Sync] SSE disconnected, reconnecting in 3s...');
        try { _syncEventSource.close(); } catch(e) {}
        setTimeout(_connectSSE, 3000);
    };
}

function _fetchAndRedraw() {
    var wsId = window.getWorkspaceId ? window.getWorkspaceId() : '';
    fetch(_getApiBase() + '/mood-board/strokes?workspace_id=' + encodeURIComponent(wsId || 'default'))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d || !d.layers) return;
            var remoteCount = d.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0);
            var localCount = moodBoardState.layers
                ? moodBoardState.layers.reduce(function(a, l) { return a + l.strokes.length; }, 0)
                : 0;
            if (remoteCount === localCount) return;
            console.log('[Sync] Updating: remote=' + remoteCount + ' local=' + localCount);
            moodBoardState.layers = d.layers;
            moodBoardState.layerCounter = d.layerCounter || moodBoardState.layers.length;
            moodBoardState.activeLayerId = d.activeLayerId || moodBoardState.layers[0].id;
            _strokesLoaded = true;
            var canvas = moodBoardState.drawCanvas;
            if (!canvas) {
                try { initDrawCanvas(); canvas = moodBoardState.drawCanvas; } catch(e) {}
            }
            if (canvas) {
                if (canvas.width < 1 || canvas.height < 1) {
                    var mb = document.getElementById('moodBoard');
                    if (mb) {
                        var rect = mb.getBoundingClientRect();
                        if (rect.width > 1) { canvas.width = rect.width; canvas.height = rect.height; }
                    }
                }
                redrawAllStrokes();
                console.log('[Sync] Redraw complete, canvas:', canvas.width + 'x' + canvas.height);
            }
            if (typeof renderLayerList === 'function') renderLayerList();
        })
        .catch(function(e) { console.warn('[Sync] fetch error:', e); });
}

// ============================================================
// SELECTION EXPORT — frame an area and export as PNG
// ============================================================
function exportSelectionPNG(transparent) {
    const sel = moodBoardState.selectionRect;
    if (!sel) { showNotification('No selection — draw a frame first', 'error'); return; }
    const zoom = moodBoardState.zoom;
    const panX = moodBoardState.panX;
    const panY = moodBoardState.panY;

    // Convert selection rect from screen to world coords
    const worldX = (sel.x - panX) / zoom;
    const worldY = (sel.y - panY) / zoom;
    const worldW = sel.w / zoom;
    const worldH = sel.h / zoom;

    // Create offscreen canvas at the selection size
    const exportCanvas = document.createElement('canvas');
    const scale = 2; // 2x for higher resolution export
    exportCanvas.width = worldW * scale;
    exportCanvas.height = worldH * scale;
    const ctx = exportCanvas.getContext('2d');

    if (!transparent) {
        // Get background color from prompt or default white
        const bgColor = moodBoardState._exportBgColor || '#ffffff';
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }

    // Render all visible strokes into this region
    const offsetX = -worldX * scale;
    const offsetY = -worldY * scale;
    getAllVisibleStrokes().forEach(function(stroke) {
        renderFullStroke(ctx, stroke, scale, offsetX, offsetY);
    });

    // Trigger download
    const link = document.createElement('a');
    link.download = 'sketch-' + Date.now() + '.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    showNotification('Sketch exported as PNG');
}

function showExportDialog() {
    const sel = moodBoardState.selectionRect;
    if (!sel) { showNotification('No selection — use Select tool to frame an area first', 'error'); return; }
    const actions = document.getElementById('drawSelectionActions');
    if (actions) actions.style.display = 'flex';
}

function selectionToWorkbenchImage() {
    const sel = moodBoardState.selectionRect;
    if (!sel) return;
    const zoom = moodBoardState.zoom;
    const panX = moodBoardState.panX;
    const panY = moodBoardState.panY;

    const worldX = (sel.x - panX) / zoom;
    const worldY = (sel.y - panY) / zoom;
    const worldW = sel.w / zoom;
    const worldH = sel.h / zoom;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = worldW * 2;
    exportCanvas.height = worldH * 2;
    const ctx = exportCanvas.getContext('2d');

    const offsetX = -worldX * 2;
    const offsetY = -worldY * 2;
    getAllVisibleStrokes().forEach(function(stroke) {
        renderFullStroke(ctx, stroke, 2, offsetX, offsetY);
    });

    exportCanvas.toBlob(function(blob) {
        if (!blob) return;
        const file = new File([blob], 'sketch-' + Date.now() + '.png', { type: 'image/png' });
        uploadMoodImage(file);
        cancelSelection();
        showNotification('Sketch added to workbench');
    }, 'image/png');
}

// ============================================================
// DRAGGABLE RADIAL MENU — persist position between sessions
// ============================================================
(function initRadialMenuDrag() {
    document.addEventListener('DOMContentLoaded', function() {
        var menu = document.getElementById('drawToolbar');
        var hub = document.getElementById('rdmHub');
        if (!menu || !hub) return;

        // Restore saved position
        var savedPos = localStorage.getItem('radialMenuPos');
        if (savedPos) {
            try {
                var pos = JSON.parse(savedPos);
                menu.style.left = pos.left;
                menu.style.bottom = pos.bottom;
                menu.style.transform = 'none';
            } catch(e) {}
        }

        var _rdmDragActive = false;
        var _rdmMoved = false;
        var _rdmStartX = 0, _rdmStartY = 0, _rdmOrigLeft = 0, _rdmOrigBottom = 0;
        var _rdmPointerId = null;

        hub.addEventListener('pointerdown', function(e) {
            _rdmDragActive = true;
            _rdmMoved = false;
            _rdmStartX = e.clientX;
            _rdmStartY = e.clientY;
            // Always use moodBoard as the reference container (works in both regular and fullscreen)
            var moodBoard = document.getElementById('moodBoard');
            var containerRect = moodBoard ? moodBoard.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            var menuRect = menu.getBoundingClientRect();
            _rdmOrigLeft = menuRect.left - containerRect.left + menuRect.width / 2;
            _rdmOrigBottom = containerRect.height - (menuRect.top - containerRect.top) - menuRect.height / 2;
            _rdmPointerId = e.pointerId;
        });

        document.addEventListener('pointermove', function(e) {
            if (!_rdmDragActive || e.pointerId !== _rdmPointerId) return;
            var dx = e.clientX - _rdmStartX;
            var dy = e.clientY - _rdmStartY;
            if (!_rdmMoved && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            _rdmMoved = true;

            menu.style.left = (_rdmOrigLeft + dx) + 'px';
            menu.style.bottom = (_rdmOrigBottom - dy) + 'px';
            menu.style.transform = 'none';
        });

        document.addEventListener('pointerup', function(e) {
            if (!_rdmDragActive || e.pointerId !== _rdmPointerId) return;
            _rdmDragActive = false;

            if (_rdmMoved) {
                localStorage.setItem('radialMenuPos', JSON.stringify({
                    left: menu.style.left,
                    bottom: menu.style.bottom
                }));
            }
        });

        // Suppress click only when a drag occurred
        hub.addEventListener('click', function(e) {
            if (_rdmMoved) {
                e.stopImmediatePropagation();
                e.preventDefault();
                _rdmMoved = false;
            }
        }, true);
    });
})();