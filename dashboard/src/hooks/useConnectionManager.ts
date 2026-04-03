/**
 * useConnectionManager - Handles gateway connection lifecycle (Substrate edition)
 *
 * Auto-connects to Substrate's /ws gateway on mount — no URL or token prompt
 * needed because the Vite dev server proxies /ws to Substrate's backend on
 * localhost:8765.  The gateway accepts empty tokens when no password has been
 * configured (first-run), and uses the session token from /api/auth/login
 * otherwise.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useGateway, saveConfig } from '@/contexts/GatewayContext';
import { getSessionToken } from '@/features/auth/useAuth';

export interface ConnectionManagerState {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editableUrl: string;
  setEditableUrl: (url: string) => void;
  officialUrl: string | null;
  editableToken: string;
  setEditableToken: (token: string) => void;
  handleConnect: (url: string, token: string) => Promise<void>;
  handleReconnect: () => Promise<void>;
  serverSideAuth: boolean;
}

/** Placeholder URL — the actual WS target is always window.location via Vite proxy. */
const LOCAL_WS = `ws://${typeof window !== 'undefined' ? window.location.host : '127.0.0.1:3000'}/ws`;

export function useConnectionManager(): ConnectionManagerState {
  const { connectionState, connect, disconnect } = useGateway();

  // Dialog starts closed — we auto-connect
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editableUrl, setEditableUrl] = useState(LOCAL_WS);
  const [editableToken, setEditableToken] = useState('');

  /** Connect to the gateway, save config, and close the dialog. */
  const handleConnect = useCallback(async (url: string, token: string) => {
    saveConfig(url, token);
    await connect(url, token);
    setDialogOpen(false);
  }, [connect]);

  // Keep refs to avoid effect dependency churn
  const connectRef = useRef(connect);
  const stateRef = useRef(connectionState);
  useEffect(() => { connectRef.current = connect; }, [connect]);
  useEffect(() => { stateRef.current = connectionState; }, [connectionState]);

  // Auto-connect: stable interval polls token + connection state.
  // Runs once on mount, reads latest values from refs each tick.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    let busy = false;

    let authChecked = false;
    let authNoPassword = false;

    // Check once whether the server requires auth at all
    fetch('/api/auth/status').then(r => r.json()).then(d => {
      authNoPassword = !d.configured || !d.authEnabled;
      authChecked = true;
      console.debug('[useConnectionManager] auth status:', { configured: d.configured, authEnabled: d.authEnabled, authenticated: d.authenticated, authNoPassword });
    }).catch(() => { authNoPassword = true; authChecked = true; });

    id = setInterval(async () => {
      if (busy || !authChecked) return;
      const state = stateRef.current;
      if (state === 'connected' || state === 'connecting' || state === 'reconnecting') {
        if (id) { clearInterval(id); id = null; }
        return;
      }
      const token = getSessionToken();
      // Allow empty token when auth is not configured
      if (!token && !authNoPassword) {
        return;
      }
      console.debug('[useConnectionManager] attempting connect…', { hasToken: !!token, authNoPassword, state });
      busy = true;
      try {
        saveConfig(LOCAL_WS, token);
        await connectRef.current(LOCAL_WS, token);
        console.debug('[useConnectionManager] connected successfully');
        setDialogOpen(false);
        if (id) { clearInterval(id); id = null; }
      } catch (e) {
        console.debug('[useConnectionManager] connect failed:', e);
        // retry on next tick
      } finally {
        busy = false;
      }
    }, 250);

    return () => { if (id) clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs handle freshness
  }, []);

  const handleReconnect = useCallback(async () => {
    if (connectionState === 'connecting' || connectionState === 'reconnecting') return;

    disconnect();
    await new Promise(r => setTimeout(r, 100));
    try {
      const token = getSessionToken() || editableToken;
      await connect(editableUrl || LOCAL_WS, token);
    } catch {
      // Connection failed — stay disconnected
    }
  }, [connect, disconnect, editableUrl, editableToken, connectionState]);

  return {
    dialogOpen,
    setDialogOpen,
    editableUrl,
    setEditableUrl,
    officialUrl: LOCAL_WS,
    editableToken,
    setEditableToken,
    handleConnect,
    handleReconnect,
    serverSideAuth: true,
  };
}
