/**
 * MobilePairing — Sync pairing UI for mobile (Capacitor).
 *
 * Two modes:
 * 1. On the DASHBOARD (web): shows a "Generate Pairing Code" button that creates
 *    a 6-digit code for the mobile app to enter.
 * 2. On the MOBILE APP: shows an input to enter the 6-digit code, which
 *    validates against the server and saves the connection details.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Smartphone, Monitor, Wifi, Check, X, RefreshCw, Loader2 } from 'lucide-react';
import { getServerUrl, setServerUrl, isCapacitor } from '@/lib/apiBase';

// ─── Mobile: Enter Pairing Code ────────────────────────────────

interface MobilePairInputProps {
  onPaired: (serverUrl: string) => void;
}

function MobilePairInput({ onPaired }: MobilePairInputProps) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [status, setStatus] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [showManual, setShowManual] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigit = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    setStatus('idle');
    setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      const code = digits.join('');
      if (code.length === 6) handleSubmit(code);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = [...digits];
    for (let i = 0; i < 6; i++) next[i] = text[i] || '';
    setDigits(next);
    if (text.length === 6) {
      setTimeout(() => handleSubmit(text), 100);
    }
  };

  const handleSubmit = async (code: string) => {
    setStatus('checking');
    setError('');
    try {
      // Try the manual URL first, then common local addresses
      const urls = manualUrl
        ? [manualUrl.trim().replace(/\/$/, '')]
        : [
            'http://10.147.17.34:8765',
            'http://192.168.1.100:8765',
            'http://192.168.0.100:8765',
            'http://192.168.1.1:8765',
            'http://localhost:8765',
          ];

      for (const url of urls) {
        try {
          const r = await fetch(`${url}/api/mobile/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
            signal: AbortSignal.timeout(5000),
          });
          const data = await r.json();
          if (data.ok && data.serverUrl) {
            setServerUrl(data.serverUrl);
            setStatus('success');
            setTimeout(() => onPaired(data.serverUrl), 500);
            return;
          }
        } catch { /* try next */ }
      }

      setStatus('error');
      setError('Could not reach server. Enter the server address below.');
      setShowManual(true);
    } catch {
      setStatus('error');
      setError('Connection failed');
      setShowManual(true);
    }
  };

  const handleManualConnect = async () => {
    if (!manualUrl.trim()) return;
    const url = manualUrl.trim().replace(/\/$/, '');
    setStatus('checking');
    setError('');

    // If we have a code, try pairing
    const code = digits.join('');
    if (code.length === 6) {
      try {
        const r = await fetch(`${url}/api/mobile/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await r.json();
        if (data.ok) {
          setServerUrl(data.serverUrl || url);
          setStatus('success');
          setTimeout(() => onPaired(data.serverUrl || url), 500);
          return;
        }
      } catch { /* fall through to direct test */ }
    }

    // Otherwise just test connectivity and save the URL directly
    try {
      const r = await fetch(`${url}/api/test`, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      if (data.ok || data.status === 'success' || r.ok) {
        setServerUrl(url);
        setStatus('success');
        setTimeout(() => onPaired(url), 500);
        return;
      }
    } catch { /* ignore */ }

    setStatus('error');
    setError('Cannot reach server at that address');
  };

  const currentServer = getServerUrl();

  return (
    <div className="flex flex-col items-center gap-6 p-6 max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-400/15 flex items-center justify-center">
        <Smartphone size={24} className="text-purple-300" />
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-white/90 mb-1">Connect to Substrate</h2>
        <p className="text-xs text-white/40 leading-relaxed">
          Enter the 6-digit pairing code from your Substrate dashboard,
          or connect directly with a server address.
        </p>
      </div>

      {/* Code input */}
      <div className="flex gap-2" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            className={`w-10 h-12 text-center text-lg font-mono rounded-lg border transition-all outline-none
              ${status === 'error' ? 'border-red-400/40 bg-red-500/10' :
                status === 'success' ? 'border-green-400/40 bg-green-500/10' :
                d ? 'border-purple-400/30 bg-purple-500/10 text-white' :
                'border-white/[0.1] bg-white/[0.04] text-white/80'}
              focus:border-purple-400/50 focus:bg-purple-500/10`}
          />
        ))}
      </div>

      {/* Status */}
      {status === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Loader2 size={12} className="animate-spin" /> Connecting…
        </div>
      )}
      {status === 'success' && (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <Check size={12} /> Paired successfully!
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 text-center">{error}</div>
      )}

      {/* Pair button */}
      {!showManual && (
        <button
          onClick={() => { const code = digits.join(''); if (code.length === 6) handleSubmit(code); }}
          disabled={digits.join('').length !== 6 || status === 'checking'}
          className="w-full py-2.5 rounded-xl bg-purple-500/20 border border-purple-400/20 text-purple-300 text-sm font-medium hover:bg-purple-500/30 disabled:opacity-30 transition-all"
        >
          Pair with Server
        </button>
      )}

      {/* Manual URL input */}
      <button
        onClick={() => setShowManual(!showManual)}
        className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
      >
        {showManual ? 'Hide manual entry' : 'Or enter server address manually'}
      </button>

      {showManual && (
        <div className="w-full flex flex-col gap-2">
          <input
            type="url"
            value={manualUrl}
            onChange={e => setManualUrl(e.target.value)}
            placeholder="http://192.168.1.100:8765"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white/90 placeholder:text-white/20 outline-none focus:border-purple-400/40"
          />
          <button
            onClick={handleManualConnect}
            disabled={!manualUrl.trim() || status === 'checking'}
            className="w-full py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/60 text-xs font-medium hover:bg-white/[0.1] disabled:opacity-30 transition-all"
          >
            Connect Directly
          </button>
        </div>
      )}

      {/* Current connection */}
      {currentServer && (
        <div className="w-full pt-3 border-t border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] text-white/30">
            <Wifi size={10} />
            <span className="truncate max-w-[180px]">{currentServer}</span>
          </div>
          <button
            onClick={() => { setServerUrl(''); window.location.reload(); }}
            className="text-[10px] text-white/20 hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard: Generate Pairing Code ──────────────────────────

function DashboardPairCode() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/mobile/pair-code', { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        setCode(data.code);
        setCountdown(data.expiresIn || 300);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { setCode(''); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;

  return (
    <div className="flex flex-col items-center gap-4 p-5">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-400/15 flex items-center justify-center">
        <Monitor size={20} className="text-purple-300" />
      </div>

      <div className="text-center">
        <h3 className="text-sm font-semibold text-white/90 mb-1">Pair Mobile App</h3>
        <p className="text-[10px] text-white/40 leading-relaxed max-w-[240px]">
          Generate a pairing code and enter it on the Substrate Android app to sync.
        </p>
      </div>

      {code ? (
        <>
          <div className="flex gap-2">
            {code.split('').map((d, i) => (
              <div key={i} className="w-9 h-11 flex items-center justify-center text-lg font-mono font-bold text-purple-300 bg-purple-500/10 border border-purple-400/20 rounded-lg">
                {d}
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/30">
            Expires in {mins}:{secs.toString().padStart(2, '0')}
          </div>
          <button
            onClick={generate}
            className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 transition-colors"
          >
            <RefreshCw size={10} /> New code
          </button>
        </>
      ) : (
        <button
          onClick={generate}
          disabled={loading}
          className="px-5 py-2 rounded-xl bg-purple-500/20 border border-purple-400/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 disabled:opacity-50 transition-all"
        >
          {loading ? 'Generating…' : 'Generate Pairing Code'}
        </button>
      )}
    </div>
  );
}

// ─── Exported Components ───────────────────────────────────────

interface MobilePairingProps {
  open: boolean;
  onClose: () => void;
}

export function MobilePairingModal({ open, onClose }: MobilePairingProps) {
  if (!open) return null;

  const isMobile = isCapacitor();

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[360px] bg-[#0d0d1a] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 text-xs text-white/50">
            {isMobile ? <Smartphone size={12} /> : <Monitor size={12} />}
            {isMobile ? 'Pair with Server' : 'Mobile Sync'}
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 p-1">
            <X size={12} />
          </button>
        </div>
        {isMobile ? (
          <MobilePairInput onPaired={() => { onClose(); window.location.reload(); }} />
        ) : (
          <DashboardPairCode />
        )}
      </div>
    </div>
  );
}

/**
 * MobileSetupScreen — Full-screen setup shown on first launch of the Android app.
 * Allows pairing with server or skipping to standalone mode.
 */
export function MobileSetupScreen({ onSkip, onPaired }: { onSkip: () => void; onPaired: (url: string) => void }) {
  return (
    <div className="substrate-bg h-screen flex flex-col items-center justify-center p-6">
      <MobilePairInput onPaired={onPaired} />
      <button
        onClick={onSkip}
        className="mt-6 text-xs text-white/20 hover:text-white/40 transition-colors"
      >
        Skip — use standalone
      </button>
    </div>
  );
}
