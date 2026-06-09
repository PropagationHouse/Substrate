/**
 * MobilePeripheralsView — Remote camera/peripheral viewer for mobile.
 * Connects to Substrate's host cameras for remote monitoring (home security style).
 * Uses MJPEG stream or polling for live feed.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Camera, RefreshCw, Loader2, Eye, EyeOff, Maximize2, Minimize2,
  AlertTriangle, Monitor, Wifi,
} from 'lucide-react';
import { getServerUrl } from '@/lib/apiBase';

interface CameraDevice {
  index: number;
  name: string;
  resolution: string;
}

export function MobilePeripheralsView() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCamera, setActiveCamera] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const loadCameras = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/peripherals/cameras');
      if (r.status === 404) throw new Error('Peripherals endpoint not found. Make sure Substrate server is running and up to date.');
      if (!r.ok) throw new Error(`Server error (${r.status}). Is Substrate running?`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('Unexpected response. Substrate server may need to be restarted.');
      const data = await r.json();
      if (data.status === 'error') {
        if (data.error?.includes('OpenCV')) {
          throw new Error('OpenCV not installed on host. Run: pip install opencv-python');
        }
        throw new Error(data.error);
      }
      setCameras(data.cameras || []);
      if (data.cameras?.length > 0 && activeCamera === null) {
        setActiveCamera(data.cameras[0].index);
      }
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message?.includes('fetch')) {
        setError('Cannot reach Substrate server. Check your connection and server URL in Settings.');
      } else {
        setError(e.message || 'Failed to list cameras');
      }
      setCameras([]);
    }
    setLoading(false);
  }, [activeCamera]);

  useEffect(() => {
    loadCameras();
  }, [loadCameras]);

  const grabSnapshot = useCallback(async (camIdx: number) => {
    setSnapshotLoading(true);
    try {
      const base = getServerUrl();
      const url = `${base}/api/peripherals/camera/frame?index=${camIdx}&t=${Date.now()}`;
      setSnapshotUrl(url);
    } catch {
      setError('Failed to grab snapshot');
    }
    setSnapshotLoading(false);
  }, []);

  const startStream = useCallback((camIdx: number) => {
    const base = getServerUrl();
    const streamUrl = `${base}/api/peripherals/camera/stream?index=${camIdx}&fps=5`;
    if (imgRef.current) {
      imgRef.current.src = streamUrl;
    }
    setStreaming(true);
  }, []);

  const stopStream = useCallback(() => {
    if (imgRef.current) {
      imgRef.current.src = '';
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStreaming(false);
  }, []);

  // Start polling mode (fallback if MJPEG doesn't work well)
  const startPolling = useCallback((camIdx: number) => {
    stopStream();
    const base = getServerUrl();
    const poll = () => {
      if (imgRef.current) {
        imgRef.current.src = `${base}/api/peripherals/camera/frame?index=${camIdx}&t=${Date.now()}`;
      }
    };
    poll();
    pollRef.current = setInterval(poll, 500); // 2fps polling
    setStreaming(true);
  }, [stopStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col overflow-hidden ${fullscreen ? 'fixed inset-0 z-50 bg-black' : ''}`}>
      {/* Header */}
      {!fullscreen && (
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Monitor size={14} className="text-white/30" />
            <span className="text-[12px] text-white/60 font-medium">Peripherals</span>
            <span className="text-[9px] text-white/25">{cameras.length} camera{cameras.length !== 1 ? 's' : ''}</span>
          </div>
          <button onClick={loadCameras} className="p-1.5 rounded-lg bg-white/[0.04] text-white/30">
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/20 flex items-center gap-2">
          <AlertTriangle size={12} className="text-red-400/60 shrink-0" />
          <span className="text-[10px] text-red-300/70">{error}</span>
        </div>
      )}

      {/* No cameras */}
      {cameras.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <Camera size={32} className="text-white/10 mb-3" />
          <p className="text-[12px] text-white/30 mb-1">No cameras detected</p>
          <p className="text-[9px] text-white/15 text-center mb-3">
            Substrate needs OpenCV and a connected camera on the host machine
          </p>
          <button onClick={loadCameras}
            className="text-[10px] text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg flex items-center gap-1"
          ><RefreshCw size={10} />Rescan</button>
        </div>
      )}

      {/* Camera selector */}
      {cameras.length > 0 && !fullscreen && (
        <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar">
          {cameras.map(cam => (
            <button
              key={cam.index}
              onClick={() => { setActiveCamera(cam.index); stopStream(); setSnapshotUrl(null); }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                activeCamera === cam.index
                  ? 'bg-indigo-500/20 border border-indigo-400/25 text-indigo-300'
                  : 'bg-white/[0.03] border border-transparent text-white/40'
              }`}
            >
              <Camera size={10} />
              {cam.name}
              <span className="text-[8px] text-white/20">{cam.resolution}</span>
            </button>
          ))}
        </div>
      )}

      {/* Feed area */}
      {activeCamera !== null && (
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
          {/* Stream/snapshot image */}
          {(streaming || snapshotUrl) ? (
            <img
              ref={imgRef}
              src={snapshotUrl || ''}
              alt="Camera feed"
              className="max-w-full max-h-full object-contain"
              onLoad={() => setSnapshotLoading(false)}
              onError={() => { setSnapshotLoading(false); setError('Feed interrupted'); }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                <Camera size={28} className="text-white/15" />
              </div>
              <p className="text-[11px] text-white/25">Camera {activeCamera} ready</p>
            </div>
          )}

          {snapshotLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 size={20} className="animate-spin text-white/40" />
            </div>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="absolute top-2 right-2 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white/40 border border-white/[0.1]"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>

          {/* Connection indicator */}
          {streaming && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-full border border-white/[0.1]">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[8px] text-white/40">LIVE</span>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      {activeCamera !== null && !fullscreen && (
        <div className="flex items-center justify-center gap-3 px-3 py-3 border-t border-white/[0.06]">
          {/* Snapshot */}
          <button
            onClick={() => grabSnapshot(activeCamera)}
            disabled={snapshotLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/50 text-[10px] font-medium disabled:opacity-40"
          >
            <Camera size={12} />Snapshot
          </button>

          {/* Stream toggle */}
          {!streaming ? (
            <button
              onClick={() => startStream(activeCamera)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-400/25 text-indigo-300 text-[10px] font-medium"
            >
              <Eye size={12} />Live Feed
            </button>
          ) : (
            <button
              onClick={stopStream}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/15 border border-red-400/20 text-red-300/70 text-[10px] font-medium"
            >
              <EyeOff size={12} />Stop
            </button>
          )}

          {/* Polling mode */}
          {!streaming && (
            <button
              onClick={() => startPolling(activeCamera)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/50 text-[10px] font-medium"
            >
              <Wifi size={12} />Poll
            </button>
          )}
        </div>
      )}
    </div>
  );
}
