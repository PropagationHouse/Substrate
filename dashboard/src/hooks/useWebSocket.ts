import { useRef, useCallback, useState, useEffect } from 'react';
import type { GatewayMessage, GatewayEvent, GatewayResponse } from '@/types';
import { getServerUrl } from '@/lib/apiBase';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface PendingReq {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onEvent: React.MutableRefObject<((msg: GatewayEvent) => void) | null>;
  connectError: string;
  reconnectAttempt: number;
}

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const INSTANCE_ID_STORAGE_KEY = 'substrate-dashboard-instance-id';

function generateInstanceId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateInstanceId(): string {
  const fallback = generateInstanceId();
  if (typeof window === 'undefined') return fallback;

  try {
    const existing = window.sessionStorage.getItem(INSTANCE_ID_STORAGE_KEY);
    if (existing) return existing;

    window.sessionStorage.setItem(INSTANCE_ID_STORAGE_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Low-level WebSocket hook for the Substrate gateway protocol.
 *
 * Handles connection (with challenge/auth handshake), JSON-RPC requests
 * with timeouts, event dispatch, and automatic reconnection with
 * exponential backoff + jitter.
 *
 * WebSocket traffic is proxied through the Vite dev server's `/ws`
 * endpoint so the client works behind reverse proxies and HTTPS termination.
 */
export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectError, setConnectError] = useState('');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(0);
  const pendingRef = useRef<Record<string, PendingReq>>({});
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const connectReqIdRef = useRef<string | null>(null);
  const connectResolveRef = useRef<(() => void) | null>(null);
  const connectRejectRef = useRef<((e: Error) => void) | null>(null);
  const onEvent = useRef<((msg: GatewayEvent) => void) | null>(null);
  
  // Auto-reconnect state
  const credentialsRef = useRef<{ url: string; token: string } | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const doConnectRef = useRef<((url: string, token: string, isReconnect: boolean) => Promise<void>) | null>(null);
  const instanceIdRef = useRef(getOrCreateInstanceId());
  const connectionGenRef = useRef(0);

  const rejectPending = useCallback((reason: Error) => {
    const pending = pendingRef.current;
    for (const id of Object.keys(pending)) {
      pending[id].reject(reason);
      delete pending[id];
    }
    const timeouts = timeoutsRef.current;
    for (const id of Object.keys(timeouts)) {
      clearTimeout(timeouts[id]);
      delete timeouts[id];
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return reject(new Error('Not connected'));
      const id = String(++reqIdRef.current);
      pendingRef.current[id] = { resolve, reject };
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
      const timeoutId = setTimeout(() => {
        if (pendingRef.current[id]) {
          delete pendingRef.current[id];
          if (timeoutsRef.current[id]) delete timeoutsRef.current[id];
          reject(new Error('Timeout'));
        }
      }, 30000);
      timeoutsRef.current[id] = timeoutId;
    });
  }, []);

  const doConnect = useCallback((_url: string, token: string, isReconnect: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
      const gen = ++connectionGenRef.current;
      if (!isReconnect) {
        setConnectError('');
      }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      rejectPending(new Error('Disconnected'));
      connectReqIdRef.current = null;
      connectResolveRef.current = resolve;
      connectRejectRef.current = reject;

      setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

      let ws: WebSocket;
      try {
        // Connect to Substrate's /ws gateway via Vite proxy.
        // The Vite dev server proxies /ws to Substrate's backend.
        const serverUrl = getServerUrl();
        let wsUrl: string;
        if (serverUrl) {
          const parsed = new URL(serverUrl);
          const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${wsProtocol}//${parsed.host}/ws`;
        } else {
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${wsProtocol}//${window.location.host}/ws`;
        }
        console.debug('[WS] Connecting to', wsUrl, 'token-length=', token?.length ?? 0);
        ws = new WebSocket(wsUrl);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setConnectError('Invalid URL: ' + errMsg);
        setConnectionState('disconnected');
        reject(e);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState(isReconnect ? 'reconnecting' : 'connecting');
      };

      ws.onmessage = (ev) => {
        let msg: GatewayMessage;
        try { msg = JSON.parse(ev.data) as GatewayMessage; } catch { return; }

        if (msg.type === 'event' && (msg.event === 'gateway.challenge' || msg.event === 'connect.challenge')) {
          const id = String(++reqIdRef.current);
          connectReqIdRef.current = id;
          ws.send(JSON.stringify({
            type: 'req', id, method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: {
                id: 'substrate-dashboard',
                version: '0.1.0',
                platform: 'web',
                mode: 'webchat',
                instanceId: instanceIdRef.current,
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
              auth: { token },
              caps: ['tool-events']
            }
          }));
          console.debug('[WS] Sent connect handshake, token-length=', token?.length ?? 0);
          onEvent.current?.(msg);
          return;
        }

        if (msg.type === 'res') {
          const response = msg as GatewayResponse;
          if (response.id === connectReqIdRef.current) {
            connectReqIdRef.current = null;
            if (response.ok) {
              // Success! Reset reconnect counter
              reconnectAttemptRef.current = 0;
              hasConnectedRef.current = true;
              setReconnectAttempt(0);
              setConnectError('');
              setConnectionState('connected');
              console.debug('[WS] Connected successfully!', response.payload);
              connectResolveRef.current?.();
            } else {
              const errMsg = 'Auth failed: ' + (response.error?.message || 'unknown');
              console.debug('[WS] Auth FAILED:', response.error);
              setConnectError(errMsg);
              setConnectionState('disconnected');
              // Treat auth failures during reconnect like transient failures so the
              // socket keeps retrying instead of getting stuck until a manual reload.
              ws.close();
              connectRejectRef.current?.(new Error(errMsg));
            }
            return;
          }
          const p = pendingRef.current[response.id];
          if (p) {
            delete pendingRef.current[response.id];
            const timeoutId = timeoutsRef.current[response.id];
            if (timeoutId) {
              clearTimeout(timeoutId);
              delete timeoutsRef.current[response.id];
            }
            if (response.ok) p.resolve(response.payload);
            else p.reject(new Error(response.error?.message || 'request failed'));
          }
          return;
        }

        if (msg.type === 'event') {
          onEvent.current?.(msg as GatewayEvent);
        }
      };

      ws.onerror = () => {
        // Don't set error message during reconnect attempts (too noisy)
        if (!isReconnect) {
          setConnectError('WebSocket error — check URL');
        }
      };

      ws.onclose = () => {
        rejectPending(new Error('WebSocket disconnected'));

        // Stale connection: a newer doConnect has already superseded this one
        if (gen !== connectionGenRef.current) return;

        // Don't reconnect if intentionally disconnected, no credentials, or never connected
        if (intentionalDisconnectRef.current || !credentialsRef.current || !hasConnectedRef.current) {
          setConnectionState('disconnected');
          return;
        }

        // Attempt auto-reconnect
        const attempt = ++reconnectAttemptRef.current;
        setReconnectAttempt(attempt);

        // Exponential backoff with jitter
        const delay = Math.min(
          RECONNECT_BASE_DELAY * Math.pow(1.5, attempt - 1) + Math.random() * 500,
          RECONNECT_MAX_DELAY
        );

        console.debug(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`);
        setConnectionState('reconnecting');

        reconnectTimeoutRef.current = setTimeout(() => {
          const creds = credentialsRef.current;
          if (creds && !intentionalDisconnectRef.current && doConnectRef.current) {
            doConnectRef.current(creds.url, creds.token, true).catch(() => {
              // Error handling is done in onclose/onerror
            });
          }
        }, delay);
      };
    });
  }, [rejectPending]);
  
  // Store doConnect in ref so it can reference itself for reconnection
  useEffect(() => {
    doConnectRef.current = doConnect;
  }, [doConnect]);

  // Cleanup reconnect timeout and WebSocket on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      if (wsRef.current) {
        intentionalDisconnectRef.current = true; // prevent reconnect on cleanup close
        wsRef.current.close();
        wsRef.current = null;
      }
      rejectPending(new Error('Component unmounted'));
    };
  }, [clearReconnectTimeout, rejectPending]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimeout();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    credentialsRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    rejectPending(new Error('Disconnected'));
    setConnectionState('disconnected');
  }, [rejectPending, clearReconnectTimeout]);

  const connect = useCallback((url: string, token: string): Promise<void> => {
    // Store credentials for reconnection
    credentialsRef.current = { url, token };
    intentionalDisconnectRef.current = false;
    clearReconnectTimeout();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    return doConnect(url, token, false);
  }, [doConnect, clearReconnectTimeout]);

  return { connectionState, connect, disconnect, rpc, onEvent, connectError, reconnectAttempt };
}
