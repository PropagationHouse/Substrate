/**
 * App.tsx — Substrate Dashboard
 *
 * Glassmorphic workspace with node graph, chat panel, and file browser.
 * Keeps existing context providers (Gateway, Session, Chat, Settings) intact.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare,
  FolderTree,
  Network,
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
import { GlassCard, GlassBadge } from '@/components/glass/GlassCard';
import { GlassChat } from '@/components/glass/GlassChat';
import { WorkspaceGraph } from '@/components/graph/WorkspaceGraph';
import { getWorkspaceAgentId } from '@/features/workspace/workspaceScope';
import type { GraphMessage } from '@/components/graph/WorkspaceGraph';
import '@/glass.css';

interface AppProps {
  onLogout?: () => void;
}

type ActivePanel = 'graph' | 'chat' | 'files';

// ─── File tree fetcher ────────────────────────────────────────────
function useFlatFiles() {
  const [files, setFiles] = useState<Array<{ name: string; path: string; type: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/files/tree')
      .then((r) => (r.ok ? r.json() : []))
      .then((tree: Array<{ name: string; path: string; type: string; children?: unknown[] }>) => {
        if (cancelled) return;
        const flat: Array<{ name: string; path: string; type: string }> = [];
        const walk = (nodes: typeof tree) => {
          for (const n of nodes) {
            flat.push({ name: n.name, path: n.path, type: n.type });
            if (Array.isArray(n.children)) walk(n.children as typeof tree);
          }
        };
        walk(Array.isArray(tree) ? tree : []);
        setFiles(flat);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return files;
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App({ onLogout }: AppProps) {
  const { connectionState, model } = useGateway();
  const { currentSession, agentName, agentStatus } = useSessionContext();
  const {
    messages, isGenerating, stream, processingStage,
    handleSend,
  } = useChat();

  useConnectionManager(); // auto-connect

  const workspaceAgentId = useMemo(
    () => getWorkspaceAgentId(currentSession),
    [currentSession],
  );

  const { memories } = useDashboardData({ agentId: workspaceAgentId });
  const files = useFlatFiles();

  // Convert ChatMsg[] to GraphMessage[] for the workspace graph
  const graphMessages = useMemo<GraphMessage[]>(() => {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        text: m.rawText || '',
        timestamp: m.timestamp ? m.timestamp.getTime() : undefined,
      }));
  }, [messages]);

  const [activePanel, setActivePanel] = useState<ActivePanel>('graph');
  const [chatOpen, setChatOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // Boot after first connection
  useEffect(() => {
    if (connectionState === 'connected' && !booted) setBooted(true);
  }, [connectionState, booted]);

  // Derive agent state from the per-session GranularAgentState record
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

  // Build streaming text from stream state (stream.html is the accumulated HTML)
  const streamingText = useMemo(() => {
    if (!stream) return '';
    return stream.html || '';
  }, [stream]);

  // Chat send wrapper
  const onChatSend = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  // Toggle chat panel
  const toggleChat = useCallback(() => {
    setChatOpen((prev) => !prev);
  }, []);

  // Nav items
  const navItems: Array<{ id: ActivePanel; icon: typeof Network; label: string }> = [
    { id: 'graph', icon: Network, label: 'Graph' },
    { id: 'files', icon: FolderTree, label: 'Files' },
  ];

  // Placeholder tasks
  const tasks: Array<{ id: string; title: string; status: string; source: 'user' | 'agent' }> = [];

  // Connection badge
  const connBadge = connectionState === 'connected'
    ? { variant: 'success' as const, icon: Wifi, label: 'Connected' }
    : connectionState === 'reconnecting'
      ? { variant: 'warning' as const, icon: Loader2, label: 'Reconnecting…' }
      : { variant: 'error' as const, icon: WifiOff, label: 'Disconnected' };

  // ─── Loading state ──────────────────────────────────────────────
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

  // ─── Main Layout ────────────────────────────────────────────────
  return (
    <div className="substrate-bg h-screen flex flex-col overflow-hidden relative" style={{ zIndex: 1 }}>
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header className="relative z-20 flex items-center justify-between px-5 py-3 border-b border-white/[0.04]">
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

          {/* Nav pills */}
          <div className="flex items-center gap-1 ml-3 bg-white/[0.03] border border-white/[0.06] rounded-xl p-0.5">
            {navItems.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-200
                  ${activePanel === id
                    ? 'bg-white/[0.08] text-white/90 shadow-sm'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
                  }
                `}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

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

          {/* Logout */}
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

      {/* ── Main Content Area ──────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Center content — graph or files */}
        <main className="flex-1 relative z-10">
          {activePanel === 'graph' && (
            <WorkspaceGraph
              agentName={agentName || 'Substrate'}
              agentState={agentState}
              model={model || 'unknown'}
              memories={memories}
              files={files}
              messages={graphMessages}
              tasks={tasks}
              onNodeClick={(type) => {
                if (type === 'conv') setChatOpen(true);
              }}
            />
          )}

          {activePanel === 'files' && (
            <div className="h-full flex items-center justify-center">
              <GlassCard variant="elevated" className="max-w-md text-center">
                <FolderTree size={32} className="text-emerald-400/40 mx-auto mb-3" />
                <div className="text-sm text-white/60 font-medium mb-1">File Browser</div>
                <div className="text-[12px] text-white/30">
                  {files.length} files in workspace. Full editor coming soon.
                </div>
                <div className="mt-3 space-y-1 max-h-[300px] overflow-y-auto glass-scroll">
                  {files.slice(0, 20).map((f, i) => (
                    <div
                      key={i}
                      className="text-[11px] text-white/40 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] truncate text-left"
                    >
                      {f.path}
                    </div>
                  ))}
                  {files.length > 20 && (
                    <div className="text-[11px] text-white/25 pt-1">+{files.length - 20} more…</div>
                  )}
                </div>
              </GlassCard>
            </div>
          )}
        </main>

        {/* ── Chat Slide Panel ──────────────────────────────────── */}
        <div
          className={`
            absolute top-0 right-0 h-full z-30
            transition-all duration-300 ease-in-out
            ${chatOpen ? 'w-[420px] opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-full'}
          `}
        >
          <div className="h-full glass-panel m-1 ml-0 flex flex-col overflow-hidden">
            {/* Chat header */}
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

            {/* Chat body */}
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

      {/* ── Bottom Status Bar ──────────────────────────────────── */}
      <footer className="relative z-20 flex items-center justify-between px-5 py-1.5 border-t border-white/[0.04] text-[10px] text-white/25">
        <div className="flex items-center gap-3">
          <span>Substrate Dashboard</span>
          <span>·</span>
          <span>{messages.length} messages</span>
          <span>·</span>
          <span>{memories.length} memories</span>
          <span>·</span>
          <span>{files.length} files</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="capitalize">{connectionState}</span>
        </div>
      </footer>
    </div>
  );
}
