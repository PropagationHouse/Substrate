/**
 * SimulatedGlassBackdrop — Captures the ForceGraph canvas behind a FloatingWindow
 * and renders a blurred, tinted crop as a backdrop layer. This simulates the
 * glassmorphic "see-through" effect for iframe-based panels that can't use
 * real backdrop-filter across compositing layers.
 *
 * Usage: Place as the first child inside a FloatingWindow's content area.
 * It will auto-detect the nearest FloatingWindow ancestor for position tracking.
 */
import { useRef, useEffect, useCallback } from 'react';

const SNAPSHOT_INTERVAL = 800;  // ms between canvas snapshots
const BLUR_RADIUS = 28;         // CSS blur in px
const TINT_COLOR = 'rgba(10, 10, 24, 0.55)';

export function SimulatedGlassBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const capture = useCallback(() => {
    const localCanvas = canvasRef.current;
    if (!localCanvas) return;

    // Find the FloatingWindow ancestor (the fixed-position container)
    const floatingWindow = localCanvas.closest('.fixed');
    if (!floatingWindow) return;

    // Find the ForceGraph source canvas in the document
    const sourceCanvas = document.querySelector('main canvas') as HTMLCanvasElement | null;
    if (!sourceCanvas) return;

    const srcRect = sourceCanvas.getBoundingClientRect();

    // Calculate the region of the source canvas that's behind this window
    // Account for the title bar offset (~40px)
    const contentEl = localCanvas.parentElement;
    if (!contentEl) return;
    const contentRect = contentEl.getBoundingClientRect();

    // Source pixel coordinates (canvas may be scaled via CSS vs actual pixel buffer)
    const scaleX = sourceCanvas.width / srcRect.width;
    const scaleY = sourceCanvas.height / srcRect.height;

    const sx = (contentRect.left - srcRect.left) * scaleX;
    const sy = (contentRect.top - srcRect.top) * scaleY;
    const sw = contentRect.width * scaleX;
    const sh = contentRect.height * scaleY;

    // Clamp to source canvas bounds
    const clampedSx = Math.max(0, sx);
    const clampedSy = Math.max(0, sy);
    const clampedSw = Math.min(sw, sourceCanvas.width - clampedSx);
    const clampedSh = Math.min(sh, sourceCanvas.height - clampedSy);

    if (clampedSw <= 0 || clampedSh <= 0) return;

    // Size the local canvas to match the content area (at reduced resolution for perf)
    const downsample = 0.25; // render at 25% res then CSS scales up (blur hides artifacts)
    const dw = Math.ceil(contentRect.width * downsample);
    const dh = Math.ceil(contentRect.height * downsample);

    if (localCanvas.width !== dw) localCanvas.width = dw;
    if (localCanvas.height !== dh) localCanvas.height = dh;

    const ctx = localCanvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.drawImage(
        sourceCanvas,
        clampedSx, clampedSy, clampedSw, clampedSh,
        0, 0, dw, dh
      );
    } catch (_e) {
      // Cross-origin or tainted canvas — fall back to solid tint
    }
  }, []);

  useEffect(() => {
    // Initial capture after a short delay (let canvas render)
    const timeout = setTimeout(() => capture(), 300);

    // Periodic refresh
    intervalRef.current = setInterval(capture, SNAPSHOT_INTERVAL);

    // Also capture on window resize
    window.addEventListener('resize', capture);

    // Listen for pointer events (drag/resize) to update during interaction
    const onPointerMove = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(capture);
    };
    window.addEventListener('pointermove', onPointerMove);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('resize', capture);
      window.removeEventListener('pointermove', onPointerMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [capture]);

  return (
    <div className="absolute inset-0 overflow-hidden rounded-none" style={{ zIndex: 0 }}>
      {/* Blurred canvas snapshot of background */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          filter: `blur(${BLUR_RADIUS}px) saturate(1.3) brightness(0.7)`,
          transform: 'scale(1.1)', // slightly oversized to hide blur edge artifacts
          transformOrigin: 'center',
          pointerEvents: 'none',
        }}
      />
      {/* Tint overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: TINT_COLOR,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export default SimulatedGlassBackdrop;
