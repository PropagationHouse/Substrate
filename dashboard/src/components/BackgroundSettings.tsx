/**
 * BackgroundSettings — Panel for customizing the dashboard background.
 * Options: drag-and-drop background image, solid color, blur amount, and overlay opacity.
 * All settings persist to localStorage and apply via CSS custom properties.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ImagePlus, Palette, Droplets, Eye, Trash2, Upload } from 'lucide-react';
import { getServerUrl } from '@/lib/apiBase';

const LS_PREFIX = 'substrate:bg';
const KEYS = {
  color: `${LS_PREFIX}-color`,
  blur: `${LS_PREFIX}-blur`,
  opacity: `${LS_PREFIX}-overlay-opacity`,
};

const BG_IMAGE_PATH = '/api/local/bg-image';

/** Resolve the full bg-image URL (prefixed with server URL on Capacitor) */
function bgImageUrl(): string {
  return `${getServerUrl()}${BG_IMAGE_PATH}`;
}

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function saveSetting(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}


/** Apply all background settings to the DOM (color, blur, overlay — NOT image src) */
export function applyBackgroundSettings() {
  const root = document.documentElement;

  // ── Kill ALL legacy sources ──
  try { localStorage.removeItem('substrate:bg-gif'); } catch {}
  try { localStorage.removeItem('substrate:bg-image'); } catch {}
  root.style.removeProperty('--substrate-bg-image');

  const color = loadSetting(KEYS.color, '');
  const blur = loadSetting(KEYS.blur, '0');
  const opacity = loadSetting(KEYS.opacity, '0.55');

  const imgEl = document.getElementById('substrate-bg-img') as HTMLImageElement | null;
  const overlayEl = document.getElementById('substrate-bg-overlay') as HTMLElement | null;
  const appEl = document.querySelector('[data-substrate-app]') as HTMLElement | null;

  // Blur (image src is managed separately by loadBgImage)
  if (imgEl) {
    imgEl.style.filter = blur !== '0' ? `blur(${blur}px)` : 'none';
  }

  if (appEl) {
    appEl.style.backgroundColor = color || '#0a0a1a';
  }

  if (overlayEl) {
    overlayEl.style.opacity = opacity;
  }
}

/** Load background image from server and apply to the <img> element */
export function loadBgImage() {
  const imgEl = document.getElementById('substrate-bg-img') as HTMLImageElement | null;
  if (!imgEl) return;
  // Fetch with cache bust to always get latest
  const url = `${bgImageUrl()}?t=${Date.now()}`;
  fetch(url, { method: 'HEAD' }).then(r => {
    if (r.ok) {
      imgEl.src = url;
      imgEl.style.display = 'block';
    } else {
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
    }
  }).catch(() => {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
  });
}

/** Upload a file to the server as the background image */
async function uploadBgImage(file: File): Promise<boolean> {
  try {
    const res = await fetch(bgImageUrl(), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    });
    return res.ok;
  } catch (e) {
    console.warn('[BackgroundSettings] Upload failed:', e);
    return false;
  }
}

/** Delete the background image from the server */
async function deleteBgImage(): Promise<boolean> {
  try {
    const res = await fetch(bgImageUrl(), { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

interface BackgroundSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function BackgroundSettings({ open, onClose }: BackgroundSettingsProps) {
  const [hasImage, setHasImage] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [bgColor, setBgColor] = useState(() => loadSetting(KEYS.color, '#0a0a1a'));
  const [blur, setBlur] = useState(() => loadSetting(KEYS.blur, '0'));
  const [opacity, setOpacity] = useState(() => loadSetting(KEYS.opacity, '0.55'));
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if server has a background image when panel opens
  useEffect(() => {
    if (open) {
      setBgColor(loadSetting(KEYS.color, '#0a0a1a'));
      setBlur(loadSetting(KEYS.blur, '0'));
      setOpacity(loadSetting(KEYS.opacity, '0.55'));
      // Probe server for existing image
      fetch(`${bgImageUrl()}?t=${Date.now()}`, { method: 'HEAD' })
        .then(r => {
          setHasImage(r.ok);
          setImagePreview(r.ok ? `${bgImageUrl()}?t=${Date.now()}` : '');
        })
        .catch(() => { setHasImage(false); setImagePreview(''); });
    }
  }, [open]);

  // Helper: save one key + apply immediately
  const updateSetting = useCallback((key: string, val: string) => {
    saveSetting(key, val);
    applyBackgroundSettings();
  }, []);

  const setColor = useCallback((val: string) => {
    setBgColor(val);
    updateSetting(KEYS.color, val);
  }, [updateSetting]);

  const setBlurVal = useCallback((val: string) => {
    setBlur(val);
    updateSetting(KEYS.blur, val);
  }, [updateSetting]);

  const setOpacityVal = useCallback((val: string) => {
    setOpacity(val);
    updateSetting(KEYS.opacity, val);
  }, [updateSetting]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    const ok = await uploadBgImage(file);
    setUploading(false);
    if (ok) {
      setHasImage(true);
      setImagePreview(`${bgImageUrl()}?t=${Date.now()}`);
      loadBgImage();
      applyBackgroundSettings();
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clearImage = useCallback(async () => {
    await deleteBgImage();
    setHasImage(false);
    setImagePreview('');
    // Clear the DOM image element
    const imgEl = document.getElementById('substrate-bg-img') as HTMLImageElement | null;
    if (imgEl) {
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-[400px] max-h-[600px] rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col"
        style={{ background: 'rgba(12, 12, 24, 0.92)', backdropFilter: 'blur(24px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <span className="text-[13px] font-semibold text-white/85">Background Settings</span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Background Image — drag & drop */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-medium text-white/50">
              <ImagePlus size={12} />
              Background Image
            </label>
            {hasImage ? (
              <div className="relative group">
                <div className="w-full h-28 rounded-xl overflow-hidden border border-white/[0.08]">
                  <img src={imagePreview} alt="Background preview" className="w-full h-full object-cover" />
                </div>
                <div className="absolute inset-0 rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                    title="Replace image"
                  >
                    <Upload size={16} />
                  </button>
                  <button
                    onClick={clearImage}
                    className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
                    title="Remove image"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragEnter={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  w-full h-28 rounded-xl border-2 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-2
                  ${dragging
                    ? 'border-indigo-400/60 bg-indigo-500/10'
                    : 'border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.04]'
                  }
                `}
              >
                <Upload size={20} className={`${dragging ? 'text-indigo-400' : 'text-white/25'}`} />
                <span className="text-[11px] text-white/35">
                  {uploading ? 'Uploading...' : dragging ? 'Drop image here' : 'Drag & drop an image, or click to browse'}
                </span>
                <span className="text-[9px] text-white/20">PNG, JPG, GIF, WebP — any size</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* Background Color */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-medium text-white/50">
              <Palette size={12} />
              Background Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={bgColor}
                onChange={e => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-white/[0.08] cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={bgColor}
                onChange={e => setColor(e.target.value)}
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white/90 outline-none focus:border-indigo-400/40 font-mono"
              />
            </div>
            {/* Quick presets */}
            <div className="flex gap-2 flex-wrap">
              {['#0a0a1a', '#0d1117', '#1a1a2e', '#16213e', '#0f0e17', '#1b1b2f', '#162447', '#1f4068'].map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-lg border transition-all ${bgColor === c ? 'border-indigo-400/60 scale-110' : 'border-white/[0.08] hover:border-white/[0.2]'}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Background Blur */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-[11px] uppercase tracking-wider font-medium text-white/50">
              <span className="flex items-center gap-2"><Droplets size={12} /> Image Blur</span>
              <span className="text-white/30 normal-case">{blur}px</span>
            </label>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={blur}
              onChange={e => setBlurVal(e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/[0.08] accent-indigo-400"
            />
            <div className="flex justify-between text-[9px] text-white/20">
              <span>Sharp</span>
              <span>Heavy blur</span>
            </div>
          </div>

          {/* Overlay Opacity */}
          <div className="space-y-2">
            <label className="flex items-center justify-between text-[11px] uppercase tracking-wider font-medium text-white/50">
              <span className="flex items-center gap-2"><Eye size={12} /> Overlay Opacity</span>
              <span className="text-white/30 normal-case">{(parseFloat(opacity) * 100).toFixed(0)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={opacity}
              onChange={e => setOpacityVal(e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/[0.08] accent-indigo-400"
            />
            <div className="flex justify-between text-[9px] text-white/20">
              <span>Transparent</span>
              <span>Opaque</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
          <button
            onClick={async () => {
              // Delete server image + reset localStorage
              await deleteBgImage();
              saveSetting(KEYS.color, '#0a0a1a');
              saveSetting(KEYS.blur, '0');
              saveSetting(KEYS.opacity, '0.55');
              applyBackgroundSettings();
              setHasImage(false);
              setImagePreview('');
              setBgColor('#0a0a1a');
              setBlur('0');
              setOpacity('0.55');
              // Clear DOM image
              const imgEl = document.getElementById('substrate-bg-img') as HTMLImageElement | null;
              if (imgEl) { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }
            }}
            className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
          >
            Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/25 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/30 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default BackgroundSettings;
