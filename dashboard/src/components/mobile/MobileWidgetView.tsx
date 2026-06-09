/**
 * MobileWidgetView — Mobile adaptation of the desktop neumorphic Command Hub widget.
 * Accessed by swiping right from the chat view.
 * Features: analog clock, avatar/emotion screen, chat input with mode selector, timer.
 * Matches the desktop clock_widget.js visual language.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Code, MessageSquare, FileText, Play, Pause, RotateCcw, ChevronLeft, Eye,
} from 'lucide-react';
import { getServerUrl } from '@/lib/apiBase';

type ChatMode = 'ask' | 'code' | 'plan';
type TimerMode = 'timer' | 'stopwatch';

interface MobileWidgetViewProps {
  agentName: string;
  onClose: () => void;
  messages?: Array<{ role: string; rawText?: string; text?: string }>;
  isStreaming?: boolean;
  streamingRawText?: string;
}

// ── Neumorphic color helpers ─────────────────────────────────

function luma(hex: string) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function getColors(bg: string, textColorOverride?: string) {
  const dark = luma(bg) <= 0.5;
  const text = textColorOverride || (dark ? '#eee' : '#333');
  return {
    text,
    sub: dark ? '#bbb' : '#777',
    muted: dark ? '#888' : '#999',
    shadowDark: dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.12)',
    shadowLight: dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
    insetDark: dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)',
    insetLight: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
    isDark: dark,
  };
}

const STYLE_CACHE_KEY = 'substrate:mobileWidgetStyle';

function loadCachedStyle(): any | null {
  try {
    const s = localStorage.getItem(STYLE_CACHE_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  // Fallback: try desktop widget's localStorage key
  try {
    const s = localStorage.getItem('cmdHubStyle');
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

// Parse once at module load so all useState initializers share the same data
let _cachedStyleInit: any = null;
try { _cachedStyleInit = loadCachedStyle(); } catch {}

// Resolve a GIF path (like /ui/widget-gif/idle/0) to a full URL for <img src>
// img src doesn't go through fetch interceptor, so we need the full server URL
function resolveGifUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  // Relative /ui/ path — prepend server base
  const serverBase = getServerUrl();
  return serverBase ? `${serverBase}${url}` : url;
}

// Preload cache: keeps Image objects alive so browser retains them in memory cache
const _preloadedImages: HTMLImageElement[] = [];

// Base64 data URI cache for native overlay — keyed by resolved URL
const _gifDataUriCache: Map<string, string> = new Map();

async function fetchGifAsDataUri(url: string): Promise<string | null> {
  if (_gifDataUriCache.has(url)) return _gifDataUriCache.get(url)!;
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const reader = new FileReader();
    const dataUri: string = await new Promise((res, rej) => {
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
    _gifDataUriCache.set(url, dataUri);
    return dataUri;
  } catch { return null; }
}

function preloadGifs(emotionGifs: Record<string, string[]>) {
  const urls = new Set<string>();
  for (const gifs of Object.values(emotionGifs)) {
    if (Array.isArray(gifs)) {
      for (const u of gifs) {
        if (u && typeof u === 'string') urls.add(resolveGifUrl(u));
      }
    }
  }
  for (const url of urls) {
    const img = new Image();
    img.src = url;
    _preloadedImages.push(img); // prevent GC
    // Also pre-cache as base64 for native overlay
    fetchGifAsDataUri(url);
  }
}

// NOTE: preloading moved into component useEffect to avoid crashes before React mounts

function applyStyleData(data: any, setters: {
  setBg: (v: string) => void;
  setTextColor: (v: string | undefined) => void;
  setAccent: (v: string | undefined) => void;
  setImgOpacity: (v: number) => void;
  setAllEmotionGifs: (v: Record<string, string[]>) => void;
  setAvatarUrl: (v: string | null) => void;
}) {
  if (!data || typeof data !== 'object') return;
  if (data.bg) setters.setBg(data.bg);
  if (data.textColor) setters.setTextColor(data.textColor);
  if (data.accent) setters.setAccent(data.accent);
  if (data.imgOpacity !== undefined) setters.setImgOpacity(data.imgOpacity);
  if (data.emotionGifs) {
    setters.setAllEmotionGifs(data.emotionGifs);
    preloadGifs(data.emotionGifs); // preload ALL gifs immediately
    const idle = (data.emotionGifs.idle || []).filter((u: string) => u?.trim());
    if (idle.length > 0) setters.setAvatarUrl(resolveGifUrl(idle[0]));
  }
}

function fmtTime(sec: number) {
  sec = Math.abs(Math.floor(sec));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function MobileWidgetView({ agentName, onClose, messages: parentMessages, isStreaming, streamingRawText }: MobileWidgetViewProps) {
  const [bg, setBg] = useState(() => _cachedStyleInit?.bg || '#9fbecb');
  const [chatInput, setChatInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('ask');
  const [showTimer, setShowTimer] = useState(false);
  const [timerMode, setTimerMode] = useState<TimerMode>('timer');
  const [timerSec, setTimerSec] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [swSec, setSwSec] = useState(0);
  const [swRunning, setSwRunning] = useState(false);
  const [now, setNow] = useState(new Date());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
    const idle = (_cachedStyleInit?.emotionGifs?.idle || []).filter((u: string) => u?.trim());
    return idle.length > 0 ? resolveGifUrl(idle[0]) : null;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatMsgsRef = useRef<HTMLDivElement>(null);
  const [widgetChatMsgs, setWidgetChatMsgs] = useState<Array<{ role: string; text: string; thinking?: boolean }>>([]);

  // ── Voice input state ──
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const voiceRecognitionRef = useRef<SpeechRecognition | null>(null);

  // ── Camera passthrough state ──
  const [cameraActive, setCameraActive] = useState(false);
  const cameraActiveRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camMinInterval = useRef(30);
  const camMaxInterval = useRef(120);
  const panelRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useRef(1);
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const swipeStartX = useRef(0);

  const doSendSnapshot = useCallback(async () => {
    if (!cameraActiveRef.current) return;
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      const result = await CameraPreview.capture({ quality: 70 });
      if (result.value && cameraActiveRef.current) {
        fetch('/api/camera/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: result.value, mime: 'image/jpeg' }),
        }).catch(err => console.warn('[Camera] snapshot failed:', err));
      }
    } catch {}
  }, []);

  const doScheduleBackendSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    if (!cameraActiveRef.current) return;
    const min = camMinInterval.current * 1000;
    const max = camMaxInterval.current * 1000;
    const delay = min + Math.random() * (max - min);
    snapshotTimerRef.current = setTimeout(() => {
      doSendSnapshot();
      doScheduleBackendSnapshot();
    }, delay);
  }, [doSendSnapshot]);


  const doStartCamera = useCallback(async () => {
    if (cameraActiveRef.current) return;
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      const isSquare = window.innerWidth / window.innerHeight > 0.85;

      // Phase 1: Start camera off-screen, then trigger layout shift
      await CameraPreview.start({
        position: 'rear', toBack: false, disableAudio: true, aspectMode: 'cover',
        x: 0, y: 0, width: 1, height: 1, // tiny placeholder
      });
      cameraActiveRef.current = true;
      setCameraActive(true);
      zoomLevel.current = 1;

      // Phase 2: After layout settles into compact/regular mode, reposition to match the panel
      setTimeout(async () => {
        if (!cameraActiveRef.current) return;
        const pad = 4;
        let x: number, y: number, w: number, h: number;

        if (isSquare) {
          // Compact mode: padding=6, topBar~24px, gap=4, then camera panel (1:1, clamped)
          const outerPad = 6;
          const topBarH = 24;
          const gap = 4;
          w = window.innerWidth - outerPad * 2 - pad * 2;
          h = Math.min(w, window.innerHeight - 100 - pad * 2); // 1:1 clamped by calc(100vh-100px)
          x = outerPad + pad;
          y = outerPad + topBarH + gap + pad;
        } else {
          // Regular mode: padding=16, topBar~60px, gap=12, workspaceBar~44px, gap=12, then panel (4:3)
          const outerPad = 16;
          const topBarH = 60;
          const workspaceBarH = 44;
          const gap = 12;
          w = window.innerWidth - outerPad * 2 - pad * 2;
          h = Math.round((w + pad * 2) * 0.75) - pad * 2; // 4:3 of full panel width
          x = outerPad + pad;
          y = outerPad + topBarH + gap + workspaceBarH + gap + pad;
        }

        try {
          await CameraPreview.stop();
          await CameraPreview.start({
            position: 'rear', toBack: false, disableAudio: true, aspectMode: 'cover',
            x, y, width: w, height: h,
          });
          setTimeout(async () => {
            try { await CameraPreview.setOpacity({ opacity: 0.4 }); } catch {}
            if (avatarUrl) {
              try {
                const dataUri = await fetchGifAsDataUri(avatarUrl);
                if (dataUri) await (CameraPreview as any).setOverlayImage({ url: dataUri, opacity: 0.35, scaleMode: isSquare ? 'fit' : 'crop' });
              } catch {}
            }
          }, 300);
        } catch {}
      }, 800); // wait for compact layout to settle

      // Load camera config
      fetch('/api/camera/config').then(r => r.ok ? r.json() : null).then(cfg => {
        if (cfg?.min_interval) camMinInterval.current = cfg.min_interval;
        if (cfg?.max_interval) camMaxInterval.current = cfg.max_interval;
      }).catch(() => {});
      // Schedule backend snapshots
      setTimeout(() => {
        if (cameraActiveRef.current) doScheduleBackendSnapshot();
      }, 3000);
    } catch (e: any) {
      console.error('[Camera] start failed:', e?.message || e);
    }
  }, [doScheduleBackendSnapshot]);

  // Update native GIF overlay when avatarUrl changes while camera is active
  useEffect(() => {
    if (!cameraActive || !avatarUrl) return;
    const isSquare = window.innerWidth / window.innerHeight > 0.85;
    (async () => {
      try {
        const { CameraPreview } = await import('@capgo/camera-preview');
        const dataUri = await fetchGifAsDataUri(avatarUrl);
        if (dataUri) await (CameraPreview as any).setOverlayImage({ url: dataUri, opacity: 0.35, scaleMode: isSquare ? 'fit' : 'crop' });
      } catch {}
    })();
  }, [avatarUrl, cameraActive]);

  const doStopCamera = useCallback(async () => {
    cameraActiveRef.current = false;
    setCameraActive(false);
    if (snapshotTimerRef.current) { clearTimeout(snapshotTimerRef.current); snapshotTimerRef.current = null; }
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      await CameraPreview.stop();
    } catch {}
    fetch('/api/camera/reset', { method: 'POST' }).catch(() => {});
  }, []);

  const flipCamera = useCallback(async () => {
    if (!cameraActiveRef.current) return;
    try {
      const { CameraPreview } = await import('@capgo/camera-preview');
      await CameraPreview.flip();
      zoomLevel.current = 1;
    } catch {}
  }, []);

  const toggleCamera = useCallback(() => {
    if (cameraActiveRef.current) {
      doStopCamera();
    } else {
      doStartCamera();
    }
  }, [doStartCamera, doStopCamera]);

  // Touch handlers for swipe (flip camera) and pinch (zoom)
  const handlePanelTouchStart = useCallback((e: React.TouchEvent) => {
    if (!cameraActiveRef.current) return;
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
      pinchStartZoom.current = zoomLevel.current;
    } else if (e.touches.length === 1) {
      swipeStartX.current = e.touches[0].clientX;
    }
  }, []);

  const handlePanelTouchMove = useCallback(async (e: React.TouchEvent) => {
    if (!cameraActiveRef.current) return;
    if (e.touches.length === 2 && pinchStartDist.current > 0) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchStartDist.current;
      const newZoom = Math.max(1, Math.min(10, pinchStartZoom.current * scale));
      zoomLevel.current = newZoom;
      try {
        const { CameraPreview } = await import('@capgo/camera-preview');
        await CameraPreview.setZoom({ level: newZoom });
      } catch {}
    }
  }, []);

  const handlePanelTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!cameraActiveRef.current) return;
    if (e.changedTouches.length === 1 && pinchStartDist.current === 0) {
      const endX = e.changedTouches[0].clientX;
      const diff = endX - swipeStartX.current;
      if (Math.abs(diff) > 60) {
        // Swipe detected — flip camera
        flipCamera();
      }
    }
    pinchStartDist.current = 0;
  }, [flipCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (cameraActiveRef.current) {
        import('@capgo/camera-preview').then(({ CameraPreview }) => CameraPreview.stop()).catch(() => {});
      }
    };
  }, []);

  const [textColor, setTextColor] = useState<string | undefined>(() => _cachedStyleInit?.textColor || undefined);
  const [_accent, setAccent] = useState<string | undefined>(() => _cachedStyleInit?.accent || undefined);
  const [imgOpacity, setImgOpacity] = useState<number>(() => _cachedStyleInit?.imgOpacity ?? 0.52);
  const c = getColors(bg, textColor);

  const [emotion, setEmotion] = useState<string>('idle');
  const [allEmotionGifs, setAllEmotionGifs] = useState<Record<string, string[]>>(() => _cachedStyleInit?.emotionGifs || {});

  // Load cached style instantly, then sync from server in background with retry
  useEffect(() => {
    const setters = { setBg, setTextColor, setAccent, setImgOpacity, setAllEmotionGifs, setAvatarUrl };
    // 1) Instant load from localStorage cache
    const cached = loadCachedStyle();
    if (cached && Object.keys(cached).length > 0) {
      applyStyleData(cached, setters);
    }
    // 2) Background sync from server — retry up to 3 times with backoff
    let attempts = 0;
    const fetchStyle = () => {
      attempts++;
      fetch('/ui/widget-style?lite=1')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            applyStyleData(data, setters);
            // Cache to localStorage for instant load next time
            try { localStorage.setItem(STYLE_CACHE_KEY, JSON.stringify(data)); } catch {}
            // Update module-level cache so any future remounts have data immediately
            _cachedStyleInit = data;
          }
        })
        .catch(() => {
          // Retry with backoff (2s, 5s, 10s)
          if (attempts < 3) {
            setTimeout(fetchStyle, attempts * 3000);
          }
        });
    };
    // Delay first fetch slightly to let auth complete
    setTimeout(fetchStyle, 500);
  }, []);

  // Listen for emotion changes from the agent (via WebSocket events piped through React app)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      let newEmotion = 'idle';
      if (detail.emotion) {
        const map: Record<string, string> = {
          happy: 'laughing', joy: 'laughing', amused: 'laughing',
          curious: 'searching', analytical: 'searching', contemplative: 'searching',
          angry: 'angry', frustrated: 'angry',
          sleeping: 'sleeping', tired: 'sleeping',
          yelling: 'yelling', surprised: 'yelling',
          searching: 'searching', thinking: 'searching',
          speaking: 'speaking', talking: 'speaking',
        };
        newEmotion = map[detail.emotion.toLowerCase()] || detail.emotion.toLowerCase();
      } else if (detail.status === 'speaking') newEmotion = 'speaking';
      else if (detail.status === 'searching' || detail.status === 'tool_executing') newEmotion = 'searching';
      else if (detail.status === 'thinking') newEmotion = 'searching';
      else newEmotion = 'idle';
      setEmotion(newEmotion);
    };
    window.addEventListener('substrate:agent-emotion', handler);
    return () => window.removeEventListener('substrate:agent-emotion', handler);
  }, []);

  // Update avatar when emotion changes
  useEffect(() => {
    const gifs = allEmotionGifs[emotion]?.filter((u: string) => u?.trim()) || [];
    const url = gifs.length > 0
      ? gifs[Math.floor(Math.random() * gifs.length)]
      : (allEmotionGifs.idle?.filter((u: string) => u?.trim()) || [])[0] || null;
    if (url) setAvatarUrl(resolveGifUrl(url));
  }, [emotion, allEmotionGifs]);

  // Clock tick
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Draw analog clock
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = Math.min(window.innerWidth, 500);
    const size = Math.round(vw * 0.44);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = size, h = size, cx = w / 2, cy = h / 2, r = Math.min(cx, cy) - 8;

    ctx.clearRect(0, 0, w, h);

    // Face
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grad.addColorStop(0, c.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, c.isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.05)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Hour marks
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 - 90) * Math.PI / 180;
      const main = i % 3 === 0;
      const i1 = r - (main ? 12 : 7), o1 = r - 2;
      ctx.beginPath();
      ctx.moveTo(cx + i1 * Math.cos(a), cy + i1 * Math.sin(a));
      ctx.lineTo(cx + o1 * Math.cos(a), cy + o1 * Math.sin(a));
      ctx.strokeStyle = main ? (c.isDark ? 'rgba(255,255,255,0.4)' : '#888') : (c.isDark ? 'rgba(255,255,255,0.15)' : '#bbb');
      ctx.lineWidth = main ? 2 : 1;
      ctx.stroke();
    }

    // Numbers
    ctx.fillStyle = c.isDark ? 'rgba(255,255,255,0.25)' : '#aaa';
    ctx.font = '9px Inter, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [{ n: '12', a: -90 }, { n: '3', a: 0 }, { n: '6', a: 90 }, { n: '9', a: 180 }].forEach(({ n, a }) => {
      const ang = a * Math.PI / 180, nr = r - 20;
      ctx.fillText(n, cx + nr * Math.cos(ang), cy + nr * Math.sin(ang));
    });

    const hrs = now.getHours() % 12, mins = now.getMinutes(), secs = now.getSeconds();

    // Hour hand
    const ha = ((hrs + mins / 60) * 30 - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r * 0.48) * Math.cos(ha), cy + (r * 0.48) * Math.sin(ha));
    ctx.strokeStyle = c.isDark ? 'rgba(255,255,255,0.75)' : '#333';
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();

    // Minute hand
    const ma = ((mins + secs / 60) * 6 - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r * 0.68) * Math.cos(ma), cy + (r * 0.68) * Math.sin(ma));
    ctx.strokeStyle = c.isDark ? 'rgba(255,255,255,0.55)' : '#555';
    ctx.lineWidth = 2; ctx.stroke();

    // Second hand
    const sa = (secs * 6 - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (r * 0.72) * Math.cos(sa), cy + (r * 0.72) * Math.sin(sa));
    ctx.strokeStyle = '#ababab';
    ctx.lineWidth = 1; ctx.stroke();

    // Center dot
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = c.isDark ? 'rgba(255,255,255,0.5)' : '#555';
    ctx.fill();
  }, [now, bg, c]);

  // Timer/stopwatch logic
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timerMode === 'timer' && timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSec(prev => {
          if (prev <= 1) { setTimerRunning(false); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else if (timerMode === 'stopwatch' && swRunning) {
      timerRef.current = setInterval(() => setSwSec(prev => prev + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerMode, timerRunning, swRunning]);

  // In-widget chat
  const handleSend = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput('');
    setWidgetChatMsgs(prev => [...prev, { role: 'user', text: msg }, { role: 'assistant', text: '...', thinking: true }]);
    window.dispatchEvent(new CustomEvent('substrate:clock-chat', { detail: { message: msg, mode: chatMode } }));
  }, [chatInput, chatMode]);

  // Live streaming: update thinking bubble with streaming text as it arrives
  useEffect(() => {
    if (!streamingRawText) return;
    setWidgetChatMsgs(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant' || !last.thinking) return prev;
      return [...prev.slice(0, -1), { role: 'assistant', text: streamingRawText, thinking: true }];
    });
  }, [streamingRawText]);

  // Finalize: when isStreaming goes from true to false, grab the final response
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      return;
    }
    // isStreaming just became false
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;
    // Find the latest assistant message in parent messages
    if (!parentMessages || parentMessages.length === 0) return;
    const newest = parentMessages[parentMessages.length - 1];
    if (newest?.role === 'assistant') {
      const text = newest.rawText || newest.text || '';
      if (text) {
        setWidgetChatMsgs(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { role: 'assistant', text, thinking: false }];
        });
      }
    }
  }, [isStreaming, parentMessages]);

  // Auto-scroll chat messages
  useEffect(() => {
    if (chatMsgsRef.current) {
      chatMsgsRef.current.scrollTop = chatMsgsRef.current.scrollHeight;
    }
  }, [widgetChatMsgs]);

  const h = now.getHours(), m = String(now.getMinutes()).padStart(2, '0');
  const h12 = h % 12 || 12, ap = h >= 12 ? 'PM' : 'AM';
  const dateStr = `${now.getMonth() + 1}/${String(now.getDate()).padStart(2, '0')}`;

  // Neumorphic inline styles
  const card = {
    background: bg,
    borderRadius: 14,
    boxShadow: `4px 4px 8px ${c.shadowDark}, -4px -4px 8px ${c.shadowLight}`,
    padding: '10px 14px',
  };
  const inset = {
    background: bg,
    borderRadius: 10,
    boxShadow: `inset 2px 2px 4px ${c.insetDark}, inset -2px -2px 4px ${c.insetLight}`,
  };
  const pillBtn = (active = false) => ({
    background: bg,
    borderRadius: 12,
    border: 'none',
    boxShadow: active
      ? `inset 2px 2px 4px ${c.insetDark}, inset -2px -2px 4px ${c.insetLight}`
      : `2px 2px 5px ${c.shadowDark}, -2px -2px 5px ${c.shadowLight}`,
    color: active ? c.text : c.muted,
    padding: '5px 12px',
    fontSize: '0.65rem',
    cursor: 'pointer',
  });

  const isSquareScreen = window.innerWidth / window.innerHeight > 0.85;
  const compactMode = cameraActive && isSquareScreen;

  return (
    <div className="h-full w-full flex flex-col" style={{ background: bg, padding: compactMode ? 6 : 16, paddingTop: compactMode ? 6 : 16, paddingBottom: compactMode ? 6 : 16, gap: compactMode ? 4 : 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Top bar: full on normal, compact on square+camera ── */}
      {compactMode ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: c.text, letterSpacing: -0.5 }}>{h12}:{m} <span style={{ fontSize: '0.55rem', color: c.muted }}>{ap}</span></div>
          <button onClick={onClose} style={{
            width: 24, height: 24, borderRadius: 6, border: 'none', background: bg,
            boxShadow: `1px 1px 3px ${c.shadowDark}, -1px -1px 3px ${c.shadowLight}`,
            color: c.muted, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><ChevronLeft size={12} /></button>
        </div>
      ) : (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: c.sub, letterSpacing: 0.5 }}>{dateStr}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: c.text, lineHeight: 1.1, letterSpacing: -1 }}>{h12}:{m} {ap}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={{
              width: 28, height: 28, borderRadius: 8, border: 'none', background: bg,
              boxShadow: `2px 2px 5px ${c.shadowDark}, -2px -2px 5px ${c.shadowLight}`,
              color: c.muted, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><ChevronLeft size={14} /></button>
          </div>
        </div>
      )}

      {/* ── Workspace bar (hidden on square+camera) ── */}
      {!compactMode && (
        <div style={{ ...inset, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px' }}>
          <div>
            <div style={{ fontSize: '0.55rem', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Active workspace</div>
            <div style={{ fontSize: '0.75rem', color: c.text, fontWeight: 500 }}>Substrate</div>
          </div>
        </div>
      )}

      {/* ── Popout Face Screen (camera feed panel — slides open when vision active) ── */}
      <div
        ref={panelRef}
        style={{
        width: '100%', overflow: 'hidden', borderRadius: 16,
        maxHeight: cameraActive ? (compactMode ? 'calc(100vh - 100px)' : '60vh') : 0,
        opacity: cameraActive ? 1 : 0,
        transition: 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease',
        background: 'transparent',
        position: 'relative',
      }}>
        <div
          onTouchStart={handlePanelTouchStart}
          onTouchMove={handlePanelTouchMove}
          onTouchEnd={handlePanelTouchEnd}
          style={{
            width: '100%', aspectRatio: compactMode ? '1/1' : '4/3',
            position: 'relative',
            background: bg,
            borderRadius: 16, overflow: 'hidden',
            boxShadow: `inset 3px 3px 8px ${c.insetDark}, inset -3px -3px 8px ${c.insetLight}`,
          }}
        >
          {/* Soft bloom glow around the camera cutout — feathered edges */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 20,
            borderRadius: 16, pointerEvents: 'none',
            boxShadow: `0 0 12px 6px ${bg}, 0 0 24px 12px ${c.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)'}`,
          }} />
          {/* Avatar GIF overlay — only via HTML when camera is NOT active; native overlay handles it when camera is on */}
          {avatarUrl && !cameraActive && (
            <img src={avatarUrl} alt="" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', borderRadius: 16, zIndex: 21,
              opacity: 0,
              transition: 'opacity 0.5s ease',
              pointerEvents: 'none',
            }} />
          )}
        </div>
      </div>

      {/* ── Middle: Clock + Avatar screen (hidden when camera active on square screen) ── */}
      {!showTimer && !compactMode && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
          {/* Analog clock — tap to toggle timer */}
          <div
            onClick={() => setShowTimer(!showTimer)}
            style={{
              borderRadius: '50%', background: bg,
              boxShadow: `inset 3px 3px 6px ${c.insetDark}, inset -3px -3px 6px ${c.insetLight}`,
              padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <canvas ref={canvasRef} style={{ width: '44vw', height: '44vw', maxWidth: 220, maxHeight: 220 }} />
          </div>

          {/* Avatar/brand screen — camera feed shows behind when active */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: '38vw', height: '38vw', maxWidth: 190, maxHeight: 190, borderRadius: 18, background: bg,
                boxShadow: `inset 4px 4px 8px ${c.insetDark}, inset -4px -4px 8px ${c.insetLight}, 0 0 16px rgba(171,171,171,0.3)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, position: 'relative', overflow: 'hidden',
              }}>
              <div style={{
                position: 'absolute', inset: 4, borderRadius: 14,
                background: 'rgba(0,0,0,0.12)', boxShadow: '0 0 9px rgba(171,171,171,0.3)',
                pointerEvents: 'none',
              }} />
              <div style={{
                width: '100%', height: '100%', borderRadius: 14, background: 'rgba(0,0,0,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                position: 'relative', zIndex: 1, opacity: cameraActive ? 1 : imgOpacity,
              }}>
                {/* Avatar */}
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" style={{
                    width: '100%', height: '100%', borderRadius: 14,
                    objectFit: 'cover' as const, opacity: imgOpacity,
                  }} />
                ) : (
                  <span style={{ fontSize: '2rem' }}>🎯</span>
                )}
                {/* Vision active indicator */}
                {cameraActive && (
                  <div style={{
                    position: 'absolute', top: 6, left: 8,
                    display: 'flex', alignItems: 'center', gap: 4, zIndex: 3,
                  }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%', background: '#4ade80',
                      boxShadow: '0 0 5px rgba(74,222,128,0.8)',
                      animation: 'pulse 2s infinite',
                    }} />
                    <span style={{ color: '#fff', fontSize: '0.5rem', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>Vision</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: '0.65rem', color: c.sub, textAlign: 'center' }}>{agentName}</div>
          </div>
        </div>
      )}

      {/* ── Timer section ── */}
      {showTimer && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 16 }}>
          <button
            onClick={() => setShowTimer(false)}
            style={{
              alignSelf: 'flex-start', background: 'none', border: 'none',
              color: c.muted, cursor: 'pointer', fontSize: '0.7rem',
              display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 4,
            }}
          ><ChevronLeft size={12} /> Back</button>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, color: c.text, letterSpacing: -1 }}>
            {timerMode === 'timer' ? fmtTime(timerSec) : fmtTime(swSec)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                if (timerMode === 'timer') setTimerRunning(!timerRunning);
                else setSwRunning(!swRunning);
              }}
              style={pillBtn()}
            >
              {(timerMode === 'timer' ? timerRunning : swRunning) ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              onClick={() => {
                if (timerMode === 'timer') { setTimerRunning(false); setTimerSec(25 * 60); }
                else { setSwRunning(false); setSwSec(0); }
              }}
              style={pillBtn()}
            ><RotateCcw size={12} /></button>
            <button
              onClick={() => {
                setTimerMode(timerMode === 'timer' ? 'stopwatch' : 'timer');
                setTimerRunning(false); setSwRunning(false);
              }}
              style={pillBtn()}
            ><span style={{ fontSize: '0.6rem' }}>{timerMode === 'timer' ? '→ Stopwatch' : '→ Timer'}</span></button>
          </div>
          <div style={{ fontSize: '0.6rem', color: c.muted }}>
            {timerMode === 'timer'
              ? `Timer · ${timerRunning ? 'Running' : timerSec <= 0 ? 'Done!' : 'Paused'}`
              : `Stopwatch · ${swRunning ? 'Running' : 'Stopped'}`
            }
          </div>
        </div>
      )}

      {/* ── In-widget chat messages ── */}
      {widgetChatMsgs.length > 0 && (
        <div
          ref={chatMsgsRef}
          style={{
            ...inset,
            flex: 1,
            minHeight: 60,
            maxHeight: 200,
            overflowY: 'auto',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {widgetChatMsgs.map((msg, i) => {
            const isUser = msg.role === 'user';
            // White text on both sides; user gets slightly lighter grey bg, agent gets darker
            const bubbleBg = isUser
              ? 'rgba(255,255,255,0.18)'
              : 'rgba(255,255,255,0.08)';
            const bubbleColor = '#ffffff';
            return (
              <div
                key={i}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  background: bubbleBg,
                  color: bubbleColor,
                  borderRadius: 10,
                  padding: '5px 10px',
                  fontSize: '0.68rem',
                  maxWidth: '85%',
                  wordBreak: 'break-word',
                  opacity: msg.thinking && msg.text === '...' ? 0.6 : 1,
                  lineHeight: 1.4,
                }}
              >
                {msg.text}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Chat input ── */}
      <div style={{ ...inset, display: 'flex', alignItems: 'center', gap: compactMode ? 4 : 6, padding: compactMode ? '5px 10px' : '8px 12px', borderRadius: compactMode ? 16 : 20, marginTop: widgetChatMsgs.length > 0 ? undefined : 'auto', flexShrink: 0 }}>
        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 2 }}>
          {([
            { mode: 'code' as ChatMode, icon: <Code size={13} /> },
            { mode: 'ask' as ChatMode, icon: <MessageSquare size={13} /> },
            { mode: 'plan' as ChatMode, icon: <FileText size={13} /> },
          ]).map(({ mode, icon }) => (
            <button
              key={mode}
              onClick={() => setChatMode(mode)}
              style={{
                padding: '5px 6px', border: 'none', background: chatMode === mode ? c.insetDark : 'transparent',
                color: c.text, cursor: 'pointer', opacity: chatMode === mode ? 0.9 : 0.28,
                borderRadius: 6, display: 'flex', alignItems: 'center', lineHeight: 0,
              }}
            >{icon}</button>
          ))}
        </div>

        {/* Input */}
        <input
          type="text"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder={chatMode === 'code' ? 'write code...' : chatMode === 'plan' ? 'plan a task...' : 'ask anything...'}
          style={{
            flex: 1, border: 'none', background: 'transparent', outline: 'none',
            fontSize: '0.72rem', color: c.text, fontFamily: 'inherit',
          }}
        />

        {/* Vision toggle */}
        <button
          onClick={toggleCamera}
          style={{
            background: 'none', border: 'none', padding: 2, cursor: 'pointer',
            color: c.text, opacity: cameraActive ? 0.9 : 0.4,
            lineHeight: 0,
          }}
        >
          <Eye size={14} />
        </button>

        {/* Mic button */}
        <button
          onClick={() => {
            if (isVoiceActive) {
              // Stop recording
              if (voiceRecognitionRef.current) {
                voiceRecognitionRef.current.stop();
                voiceRecognitionRef.current = null;
              }
              setIsVoiceActive(false);
              return;
            }
            const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!Ctor) return;
            const recognition = new Ctor();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.onresult = (event: any) => {
              let fullTranscript = '';
              for (let i = 0; i < event.results.length; i++) {
                fullTranscript += event.results[i][0].transcript;
              }
              setChatInput(fullTranscript);
            };
            recognition.onerror = () => { setIsVoiceActive(false); voiceRecognitionRef.current = null; };
            recognition.onend = () => {
              if (voiceRecognitionRef.current) { try { recognition.start(); } catch {} }
            };
            recognition.start();
            voiceRecognitionRef.current = recognition;
            setIsVoiceActive(true);
            setChatInput('');
          }}
          style={{
            background: isVoiceActive ? 'rgba(239,68,68,0.2)' : 'none',
            border: isVoiceActive ? '1px solid rgba(239,68,68,0.4)' : 'none',
            borderRadius: 6,
            opacity: isVoiceActive ? 1 : 0.4,
            padding: 2, cursor: 'pointer', color: isVoiceActive ? '#ef4444' : c.text,
            lineHeight: 0,
          }}
        >
          {isVoiceActive ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
      </div>

      {/* ── Swipe-back hint ── */}
      <div style={{ position: 'absolute', top: '50%', right: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <div style={{ width: 3, height: 36, borderRadius: 2, background: c.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }} />
      </div>

    </div>
  );
}
