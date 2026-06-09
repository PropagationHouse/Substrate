/**
 * ServerSettings — Simple modal to configure the backend server URL.
 * Used primarily on mobile (Capacitor) where the app needs to reach a remote server.
 */

import { useState } from 'react';
import { Server, X, Check, Wifi } from 'lucide-react';
import { getServerUrl, setServerUrl } from '@/lib/apiBase';

interface ServerSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ServerSettings({ open, onClose }: ServerSettingsProps) {
  const [url, setUrl] = useState(getServerUrl);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  if (!open) return null;

  const handleTest = async () => {
    if (!url.trim()) { setStatus('error'); return; }
    setTesting(true);
    setStatus('idle');
    try {
      const res = await fetch(`${url.trim().replace(/\/$/, '')}/api/test`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      setStatus(res.ok ? 'ok' : 'error');
    } catch {
      setStatus('error');
    }
    setTesting(false);
  };

  const handleSave = () => {
    setServerUrl(url);
    onClose();
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[340px] bg-[#0d0d1a] border border-white/[0.08] rounded-xl p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-purple-400" />
            <h3 className="text-sm font-medium text-white/90">Server Connection</h3>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 p-1">
            <X size={14} />
          </button>
        </div>

        <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
          Enter the URL of your Substrate server. This is needed when using the mobile app
          to connect to your desktop/server running Substrate.
        </p>

        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-white/30 font-medium">Server URL</label>
          <input
            type="url"
            value={url}
            onChange={e => { setUrl(e.target.value); setStatus('idle'); }}
            placeholder="http://192.168.1.100:8765"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white/90 placeholder:text-white/20 outline-none focus:border-purple-400/40 transition-colors"
          />
          <p className="text-[9px] text-white/20">
            Example: http://192.168.1.100:8765 or http://your-server.local:8765
          </p>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white/80 hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
          >
            <Wifi size={12} />
            {testing ? 'Testing…' : 'Test'}
          </button>

          {status === 'ok' && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <Check size={11} /> Connected
            </span>
          )}
          {status === 'error' && (
            <span className="text-[10px] text-red-400">
              Connection failed
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-[11px] font-medium bg-purple-500/20 border border-purple-400/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
          >
            Save & Reload
          </button>
        </div>

        {getServerUrl() && (
          <div className="mt-3 pt-3 border-t border-white/[0.04]">
            <button
              onClick={() => { setUrl(''); setServerUrl(''); onClose(); window.location.reload(); }}
              className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
            >
              Clear server URL (use same-origin)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
