/**
 * FloatingWindow — Resizable, draggable window container.
 *
 * Supports drag-to-move (via title bar), edge resize (all 4 edges + corners),
 * minimize/maximize, and persists position/size to localStorage.
 */
import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { Minus, Maximize2, Minimize2, X } from 'lucide-react';

// ── Global z-index manager — clicking a window brings it to top ──
let _globalZ = 100;
function bringToFront(): number { return ++_globalZ; }

interface FloatingWindowProps {
  id: string;                   // localStorage key prefix
  children: ReactNode;
  title?: string;
  titleIcon?: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  /** Extra class for the outer frame */
  className?: string;
}

interface WindowState {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function loadState(id: string, defaults: WindowState): WindowState {
  try {
    const raw = localStorage.getItem(`fw-${id}`);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.x != null && s.y != null && s.w != null && s.h != null) return s;
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveState(id: string, state: WindowState) {
  try { localStorage.setItem(`fw-${id}`, JSON.stringify(state)); } catch { /* ignore */ }
}

export function FloatingWindow({
  id,
  children,
  title,
  titleIcon,
  defaultWidth = 720,
  defaultHeight = 600,
  minWidth = 400,
  minHeight = 350,
  onClose,
  className = '',
}: FloatingWindowProps) {
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zIndex, setZIndex] = useState(() => bringToFront());

  const focus = useCallback(() => { setZIndex(bringToFront()); }, []);

  // Compute centered defaults
  const defaultState: WindowState = {
    x: Math.max(40, Math.floor((window.innerWidth - defaultWidth) / 2)),
    y: Math.max(40, Math.floor((window.innerHeight - defaultHeight) / 2)),
    w: defaultWidth,
    h: defaultHeight,
  };

  const [state, setState] = useState<WindowState>(() => loadState(id, defaultState));
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist on change
  useEffect(() => { if (!maximized) saveState(id, state); }, [id, state, maximized]);

  // ── Drag (title bar) ──
  const dragStart = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);

  const onDragDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // don't drag from buttons
    e.preventDefault();
    setDragging(true);
    if (maximized) {
      // Un-maximize: restore to saved size, position cursor proportionally on the title bar
      const pct = e.clientX / window.innerWidth;
      const newX = e.clientX - stateRef.current.w * pct;
      const newY = e.clientY;
      const restored = { ...stateRef.current, x: newX, y: Math.max(0, newY - 16) };
      setState(restored);
      setMaximized(false);
      dragStart.current = { mx: e.clientX, my: e.clientY, sx: restored.x, sy: restored.y };
    } else {
      dragStart.current = { mx: e.clientX, my: e.clientY, sx: state.x, sy: state.y };
    }
  }, [state.x, state.y, maximized]);

  // ── Resize (edges/corners) ──
  type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const resizeStart = useRef<{ edge: Edge; mx: number; my: number; s: WindowState } | null>(null);

  const onResizeDown = useCallback((edge: Edge, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStart.current = { edge, mx: e.clientX, my: e.clientY, s: { ...stateRef.current } };
  }, []);

  // ── Global mouse handlers ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragStart.current) {
        const d = dragStart.current;
        const nx = d.sx + (e.clientX - d.mx);
        const ny = d.sy + (e.clientY - d.my);
        setState(prev => ({
          ...prev,
          x: clamp(nx, -prev.w + 100, window.innerWidth - 100),
          y: clamp(ny, 0, window.innerHeight - 40),
        }));
      }
      if (resizeStart.current) {
        const r = resizeStart.current;
        const dx = e.clientX - r.mx;
        const dy = e.clientY - r.my;
        setState(() => {
          let { x, y, w, h } = r.s;
          if (r.edge.includes('e')) w = Math.max(minWidth, w + dx);
          if (r.edge.includes('w')) { w = Math.max(minWidth, w - dx); x = r.s.x + (r.s.w - w); }
          if (r.edge.includes('s')) h = Math.max(minHeight, h + dy);
          if (r.edge.includes('n')) { h = Math.max(minHeight, h - dy); y = r.s.y + (r.s.h - h); }
          return { x, y, w, h };
        });
      }
    };
    const onUp = () => {
      if (dragStart.current) { dragStart.current = null; setDragging(false); }
      if (resizeStart.current) { resizeStart.current = null; setDragging(false); }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [minWidth, minHeight]);

  const toggleMaximize = useCallback(() => {
    setMaximized(prev => !prev);
    setMinimized(false);
  }, []);

  const toggleMinimize = useCallback(() => {
    setMinimized(prev => !prev);
  }, []);

  // Determine actual rect — maximized gets a small inset so it doesn't look like a dark fullscreen box
  const rect = maximized
    ? { x: 8, y: 8, w: window.innerWidth - 16, h: window.innerHeight - 16 }
    : state;

  return (
    <div
      className={`fixed flex flex-col ${className}`}
      onMouseDown={focus}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: minimized ? 'auto' : rect.h,
        zIndex,
        transition: dragging ? 'none' : 'left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease',
      }}
    >
      {/* Glass frame */}
      <div className="flex flex-col h-full rounded-2xl border border-white/[0.06] overflow-hidden" style={{ background: 'rgba(12, 12, 22, 0.75)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', boxShadow: '0 16px 48px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
        {/* Title bar — draggable */}
        <div
          onMouseDown={onDragDown}
          onDoubleClick={toggleMaximize}
          className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05] cursor-grab active:cursor-grabbing select-none shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            {title && <span className="text-[11px] font-bold text-white/70 truncate">{title}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={toggleMinimize} className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all" title="Minimize">
              <Minus size={12} />
            </button>
            <button onClick={toggleMaximize} className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all" title={maximized ? 'Restore' : 'Maximize'}>
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
            <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-red-400/80 hover:bg-red-500/10 transition-all" title="Close">
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Content */}
        {!minimized && (
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
        )}
      </div>

      {/* Resize handles (invisible hit areas on edges/corners) */}
      {!maximized && !minimized && (
        <>
          {/* Edges */}
          <div className="absolute top-0 left-[10px] right-[10px] h-[5px] cursor-n-resize" onMouseDown={e => onResizeDown('n', e)} />
          <div className="absolute bottom-0 left-[10px] right-[10px] h-[5px] cursor-s-resize" onMouseDown={e => onResizeDown('s', e)} />
          <div className="absolute top-[10px] left-0 bottom-[10px] w-[5px] cursor-w-resize" onMouseDown={e => onResizeDown('w', e)} />
          <div className="absolute top-[10px] right-0 bottom-[10px] w-[5px] cursor-e-resize" onMouseDown={e => onResizeDown('e', e)} />
          {/* Corners */}
          <div className="absolute top-0 left-0 w-[10px] h-[10px] cursor-nw-resize" onMouseDown={e => onResizeDown('nw', e)} />
          <div className="absolute top-0 right-0 w-[10px] h-[10px] cursor-ne-resize" onMouseDown={e => onResizeDown('ne', e)} />
          <div className="absolute bottom-0 left-0 w-[10px] h-[10px] cursor-sw-resize" onMouseDown={e => onResizeDown('sw', e)} />
          <div className="absolute bottom-0 right-0 w-[10px] h-[10px] cursor-se-resize" onMouseDown={e => onResizeDown('se', e)} />
        </>
      )}
    </div>
  );
}
