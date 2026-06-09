/**
 * MobileSettingsView — Phone-optimized settings panel.
 * Sections: Server Connection, Background, Display.
 */
import { useState, useCallback } from 'react';
import { Server, Image, Sun, ChevronRight } from 'lucide-react';
import { getServerUrl, setServerUrl, isCapacitor } from '@/lib/apiBase';
import { BackgroundSettings } from '@/components/BackgroundSettings';

export function MobileSettingsView() {
  const [serverUrl, setServerUrlState] = useState(() => getServerUrl());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [bgOpen, setBgOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveServer = useCallback(() => {
    const url = draft.trim();
    setServerUrl(url);
    setServerUrlState(url);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-4 space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-white/85">Settings</h2>
          <p className="text-[11px] text-white/30 mt-0.5">Configure your Substrate connection</p>
        </div>

        {/* Server Connection */}
        {isCapacitor() && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-indigo-400/60" />
                <span className="text-[12px] font-medium text-white/70">Server Connection</span>
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {!editing ? (
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-white/40">Connected to:</div>
                    <div className="text-[12px] text-white/70 truncate mt-0.5">
                      {serverUrl || '(not configured)'}
                    </div>
                  </div>
                  <button
                    onClick={() => { setDraft(serverUrl); setEditing(true); }}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.08] text-[10px] text-white/50 font-medium"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveServer(); }}
                    placeholder="http://192.168.1.x:8765"
                    className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/[0.1] text-[12px] text-white/80 placeholder:text-white/25 outline-none focus:border-indigo-400/30"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveServer} className="flex-1 py-2 rounded-lg bg-indigo-500/20 border border-indigo-400/25 text-[11px] text-indigo-300 font-medium">
                      Save
                    </button>
                    <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/40 font-medium">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {saved && (
                <div className="text-[10px] text-green-400/60 font-medium">
                  ✓ Saved — restart the app to apply
                </div>
              )}
            </div>
          </div>
        )}

        {/* Background */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
          <button
            onClick={() => setBgOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left"
          >
            <Image size={14} className="text-purple-400/60" />
            <span className="flex-1 text-[12px] font-medium text-white/70">Background & Theme</span>
            <ChevronRight size={14} className="text-white/20" />
          </button>
        </div>

        {/* App Info */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Sun size={14} className="text-amber-400/60" />
            <span className="text-[12px] font-medium text-white/70">About</span>
          </div>
          <div className="text-[10px] text-white/30 space-y-0.5 pl-5">
            <div>Substrate Dashboard (Mobile)</div>
            <div>Platform: {isCapacitor() ? 'Android (Capacitor)' : 'Web'}</div>
          </div>
        </div>
      </div>

      {/* Background Settings modal */}
      <BackgroundSettings open={bgOpen} onClose={() => setBgOpen(false)} />
    </div>
  );
}
