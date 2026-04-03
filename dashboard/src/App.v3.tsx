/**
 * App.tsx — Substrate Dashboard
 *
 * Single-view glassmorphic workspace with force graph as the main view.
 * Graph shows ALL workspace data: files, memories, conversations, tool calls.
 * Real-time gateway events feed live activity into the graph.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MessageSquare,
  LogOut,
  Wifi,
  WifiOff,
  Bot,
  X,
  Loader2,
} from 'lucide-react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { useChat } from '@/contexts/ChatContext';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { GlassBadge } from '@/components/glass/GlassCard';
import { GlassChat } from '@/components/glass/GlassChat';
import { ForceGraph, type LiveEvent } from '@/components/graph/ForceGraph2';
import { getWorkspaceAgentId } from '@/features/workspace/workspaceScope';
import type { GatewayEvent } from '@/types';
import '@/glass.css';

interface AppProps {
  onLogout?: () => void;
}

// ─── File tree fetcher ────────────────────────────────────────────
function useFlatFiles() {
  const [files, setFiles] = useState<Array<{ name: string; path: string; type: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/files/tree')
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data: { entries?: Array<{ name: string; path: string; type: string; children?: unknown[] }> } | Array<{ name: string; path: string; type: string; children?: unknown[] }>) => {
        if (cancelled) return;
        const tree = Array.isArray(data) ? data : (data.entries || []);
        const flat: Array<{ name: string; path: string; type: string }> = [];
        const walk = (nodes: typeof tree) => {
          for (const n of nodes) {
            flat.push({ name: n.name, path: n.path, type: n.type });
            if (Array.isArray((n as { children?: unknown[] }).children))
              walk((n as { children: typeof tree }).children);
          }
        };
        walk(tree);
        setFiles(flat);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return files;
}

// ─── Live event stream hook ────────────────────────────────────────
function useLiveEvents(): LiveEvent[] {
  const { subscribe, connectionState } = useGateway();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const eventsRef = useRef<LiveEvent[]>([]);

  useEffect(() => {
    if (connectionState !== 'connected') return;

    return subscribe((msg: GatewayEvent) => {
      const evt = msg.event;
      const p = (msg.payload || {}) as Record<string, unknown>;
      let live: LiveEvent | null = null;

      if (evt === 'agent') {
        const stream = p.stream as string | undefined;
        const data = p.data as Record<string, unknown> | undefined;

        if (stream === 'tool' && data?.phase === 'start' && data?.name) {
          live = {
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'tool_call',
            label: String(data.name),
            detail: data.args ? JSON.stringify(data.args).slice(0, 120) : undefined,
            timestamp: Date.now(),
          };
        } else if (stream === 'assistant') {
          live = {
            id: `stream-${Date.now()}`,
            kind: 'streaming',
            label: 'Streaming response',
            timestamp: Date.now(),
          };
        } else if (stream === 'lifecycle') {
          const phase = data?.phase as string | undefined;
          if (phase === 'start') {
            live = { id: `life-${Date.now()}`, kind: 'thinking', label: 'Agent thinking', timestamp: Date.now() };
          }
        }
      } else if (evt === 'chat') {
        const state = p.state as string | undefined;
        if (state === 'started') {
          live = { id: `chat-${Date.now()}`, kind: 'thinking', label: 'Processing request', timestamp: Date.now() };
        } else if (state === 'delta') {
          live = { id: `delta-${Date.now()}`, kind: 'streaming', label: 'Streaming', timestamp: Date.now() };
        }
      }

      if (live) {
        // Keep last 15 events, expire after 8 seconds
        const now = Date.now();
        const next = [...eventsRef.current.filter(e => now - e.timestamp < 8000), live].slice(-15);
        eventsRef.current = next;
        setEvents(next);
      }
    });
  }, [subscribe, connectionState]);

  // Decay old events every 2s
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const filtered = eventsRef.current.filter(e => now - e.timestamp < 8000);
      if (filtered.length !== eventsRef.current.length) {
        eventsRef.current = filtered;
        setEvents(filtered);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  return events;
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App({ onLogout }: AppProps) {
  const { connectionState, model } = useGateway();
  const { currentSession, agentName, agentStatus } = useSessionContext();
  const {
    messages, isGenerating, stream, processingStage,
    handleSend, loadHistory,
  } = useChat();

  useConnectionManager(); // auto-connect

  const workspaceAgentId = useMemo(
    () => getWorkspaceAgentId(currentSession),
    [currentSession],
  );

  const { memories } = useDashboardData({ agentId: workspaceAgentId });
  const files = useFlatFiles();
  const liveEvents = useLiveEvents();

  // Convert ChatMsg[] to simple graph messages
  const graphMessages = useMemo(() => {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        text: m.rawText || '',
        timestamp: m.timestamp ? m.timestamp.getTime() : undefined,
      }));
  }, [messages]);

  const [chatOpen, setChatOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // Boot after first connection + load chat history
  useEffect(() => {
    if (connectionState === 'connected' && !booted) {
      setBooted(true);
      loadHistory();
    }
  }, [connectionState, booted, loadHistory]);

  // Derive agent state
  const agentState = useMemo(() => {
    const sessionKey = currentSession || 'agent:main:main';
    const granular = agentStatus[sessionKey];
    if (granular) {
      const s = granular.status;
      if (s === 'THINKING') return 'thinking';
      if (s === 'STREAMING') return 'streaming';
      if (s === 'ERROR') return 'error';
      if (s === 'DONE') return 'idle';
    }
    if (isGenerating) return 'streaming';
    return 'idle';
  }, [agentStatus, currentSession, isGenerating]);

  const streamingText = useMemo(() => stream?.html || '', [stream]);

  const onChatSend = useCallback((text: string) => { handleSend(text); }, [handleSend]);
  const toggleChat = useCallback(() => { setChatOpen(prev => !prev); }, []);

  // Placeholder tasks
  const tasks: Array<{ id: string; title: string; status: string; source: 'user' | 'agent' }> = [];

  const connBadge = connectionState === 'connected'
    ? { variant: 'success' as const, icon: Wifi, label: 'Connected' }
    : connectionState === 'reconnecting'
      ? { variant: 'warning' as const, icon: Loader2, label: 'Reconnecting…' }
      : { variant: 'error' as const, icon: WifiOff, label: 'Disconnected' };

  // Loading state
  if (!booted) {
    return (
      <div className="substrate-bg flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-400/15 flex items-center justify-center animate-pulse">
            <Bot size={28} className="text-indigo-300" />
          </div>
          <div className="text-sm text-white/40 font-medium">
            {connectionState === 'connecting' || connectionState === 'reconnecting'
              ? 'Connecting to Substrate…'
              : 'Waiting for connection…'}
          </div>
          <Loader2 size={18} className="text-indigo-400/50 animate-spin" />
        </div>
      </div>
    );
  }

  // ─── Main Layout — graph is the ONLY view ───────────────────────
  return (
    <div className="substrate-bg h-screen flex flex-col overflow-hidden relative" style={{ zIndex: 1 }}>
      {/* Top Bar — minimal */}
      <header className="relative z-20 flex items-center justify-between px-5 py-2.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500/25 to-purple-500/20 border border-indigo-400/15 flex items-center justify-center">
            <Bot size={16} className="text-indigo-300" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white/90">{agentName || 'Substrate'}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`status-dot ${
                agentState === 'idle' ? 'status-dot-idle' :
                agentState === 'thinking' ? 'status-dot-thinking' :
                'status-dot-active'
              }`} />
              <span className="text-[11px] text-white/40 capitalize">{agentState}</span>
              <span className="text-[11px] text-white/20">·</span>
              <span className="text-[11px] text-white/30 truncate max-w-[200px]">{model || 'no model'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <GlassBadge variant={connBadge.variant}>
            <connBadge.icon size={11} className={connectionState === 'reconnecting' ? 'animate-spin' : ''} />
            {connBadge.label}
          </GlassBadge>

          {/* Chat toggle */}
          <button
            onClick={toggleChat}
            className={`
              relative ml-2 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${chatOpen
                ? 'bg-indigo-500/20 border border-indigo-400/25 text-indigo-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
          >
            <MessageSquare size={15} />
            {isGenerating && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
            )}
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.03] border border-white/[0.05] text-white/30 hover:text-white/50 hover:bg-white/[0.05] transition-all"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </header>

      {/* Graph — full viewport */}
      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 relative z-10 h-full">
          <ForceGraph
            agentName={agentName || 'Substrate'}
            agentState={agentState}
            model={model || 'unknown'}
            memories={memories}
            files={files}
            messages={graphMessages}
            tasks={tasks}
            liveEvents={liveEvents}
            onNodeClick={(kind) => {
              if (kind === 'conversation') setChatOpen(true);
            }}
          />
        </main>

        {/* Chat Slide Panel */}
        <div
          className={`
            absolute top-0 right-0 h-full z-30
            transition-all duration-300 ease-in-out
            ${chatOpen ? 'w-[420px] opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-full'}
          `}
        >
          <div className="h-full glass-panel m-1 ml-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-indigo-300" />
                <span className="text-xs font-semibold text-white/80">Chat</span>
                {isGenerating && (
                  <GlassBadge variant="info">
                    <Loader2 size={10} className="animate-spin" />
                    {processingStage === 'thinking' ? 'Thinking' : 'Streaming'}
                  </GlassBadge>
                )}
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
              >
                <X size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <GlassChat
                messages={messages}
                isStreaming={isGenerating}
                streamingText={streamingText}
                processingStage={processingStage}
                onSend={onChatSend}
                agentName={agentName || 'Substrate'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status */}
      <footer className="relative z-20 flex items-center justify-between px-5 py-1.5 border-t border-white/[0.04] text-[10px] text-white/25">
        <div className="flex items-center gap-3">
          <span>Substrate</span>
          <span>·</span>
          <span>{messages.length} msgs</span>
          <span>·</span>
          <span>{memories.length} memories</span>
          <span>·</span>
          <span>{files.length} files</span>
          {liveEvents.length > 0 && (
            <>
              <span>·</span>
              <span className="text-indigo-400/50">{liveEvents.length} live</span>
            </>
          )}
        </div>
        <span className="capitalize">{connectionState}</span>
      </footer>
    </div>
  );
}
