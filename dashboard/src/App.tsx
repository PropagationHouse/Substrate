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
  FolderOpen,
  FileCode,
  Sparkles,
  LayoutGrid,
  Code,
  Zap,
  BarChart3,
  Film,
  Clock,
} from 'lucide-react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { useChat } from '@/contexts/ChatContext';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { GlassBadge } from '@/components/glass/GlassCard';
import { GlassChat } from '@/components/glass/GlassChat';
import { ForceGraph, type LiveEvent } from '@/components/graph/ForceGraph3';
import { getWorkspaceAgentId } from '@/features/workspace/workspaceScope';
import { WorkspacePanel } from '@/components/WorkspacePanel';
import { FileEditorPanel } from '@/components/FileEditorPanel';
import { ResearchPanel } from '@/components/ResearchPanel';
import { FloatingWindow } from '@/components/FloatingWindow';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CircuitsView } from '@/components/CircuitsView';
import { AgentStatsTab } from '@/components/AgentStatsTab';
import type { GatewayEvent } from '@/types';
import '@/glass.css';

interface AppProps {
  onLogout?: () => void;
}

// ─── File tree fetcher (2-level deep) ─────────────────────────────
function useFlatFiles(ready: boolean) {
  const [files, setFiles] = useState<Array<{ name: string; path: string; type: string }>>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const fetchDir = async (dirPath?: string): Promise<Array<{ name: string; path: string; type: string }>> => {
      try {
        const url = dirPath
          ? `/api/files/tree?depth=1&path=${encodeURIComponent(dirPath)}`
          : '/api/files/tree?depth=1';
        const r = await fetch(url);
        if (!r.ok) return [];
        const d = await r.json();
        return (d.entries || []) as Array<{ name: string; path: string; type: string }>;
      } catch { return []; }
    };

    (async () => {
      try {
        // Level 0: root
        const rootEntries = await fetchDir();
        if (cancelled) return;

        const flat: Array<{ name: string; path: string; type: string }> = [];
        const level1Dirs: string[] = [];

        for (const e of rootEntries) {
          flat.push({ name: e.name, path: e.path, type: e.type });
          if (e.type === 'directory') level1Dirs.push(e.path);
        }

        // Level 1: subdirs of root
        const level1Results = await Promise.all(level1Dirs.map(d => fetchDir(d)));
        if (cancelled) return;

        const level2Dirs: string[] = [];
        for (const entries of level1Results) {
          for (const e of entries) {
            flat.push({ name: e.name, path: e.path, type: e.type });
            if (e.type === 'directory') level2Dirs.push(e.path);
          }
        }

        // Level 2: subdirs of subdirs (one more level)
        const level2Results = await Promise.all(level2Dirs.slice(0, 30).map(d => fetchDir(d)));
        if (cancelled) return;

        for (const entries of level2Results) {
          for (const e of entries) {
            flat.push({ name: e.name, path: e.path, type: e.type });
          }
        }

        console.debug('[useFlatFiles] Loaded', flat.length, 'entries across', level1Dirs.length, '+', level2Dirs.length, 'dirs');
        setFiles(flat.filter(f => f.type === 'file'));
      } catch (err) {
        console.debug('[useFlatFiles] Error:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [ready]);

  return files;
}

// ─── Real memory fetcher (user_facts.md, lessons.json, etc.) ──────
export interface RealMemoryData {
  facts: Array<{ key: string; value: string }>;
  lessons: Array<{ id: string; pattern: string; lesson: string; confidence: number; type: string }>;
  memoryEntryCount: number;
  configKeys: string[];
  configEntries: Array<{ key: string; preview: string }>;
  systemDocs: Array<{ name: string; path: string; size: number }>;
  visualMemory: Array<{ name: string; path: string; size: number; timestamp?: number }>;
}
function useRealMemory(ready: boolean): RealMemoryData | null {
  const [data, setData] = useState<RealMemoryData | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    fetch('/api/local/memory')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.ok) return;
        setData({ facts: d.facts || [], lessons: d.lessons || [], memoryEntryCount: d.memoryEntryCount || 0, configKeys: d.configKeys || [], configEntries: d.configEntries || [], systemDocs: d.systemDocs || [], visualMemory: d.visualMemory || [] });
        console.debug('[useRealMemory]', d.facts?.length, 'facts,', d.lessons?.length, 'lessons,', d.visualMemory?.length, 'visual');
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [ready]);

  return data;
}

// ─── Special folders fetcher (skills, macros, tools) ──────────────
export interface SpecialFolders {
  skills: Array<{ name: string; path: string; size: number }>;
  macros: Array<{ name: string; path: string; size: number }>;
  tools:  Array<{ name: string; path: string; size: number }>;
}
function useSpecialFolders(ready: boolean): SpecialFolders | null {
  const [data, setData] = useState<SpecialFolders | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    fetch('/api/files/special-folders')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.ok) return;
        setData(d.folders as SpecialFolders);
        console.debug('[useSpecialFolders]', Object.entries(d.folders).map(([k, v]: [string, any]) => `${k}: ${v.length}`).join(', '));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [ready]);

  return data;
}

// ─── Subagents fetcher (for ForceGraph visualization) ──────────────
interface SubagentInfo { id: string; name: string; status: string; parentSession?: string; message?: string }
function useSubagents(ready: boolean): SubagentInfo[] {
  const [subs, setSubs] = useState<SubagentInfo[]>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const fetchSubs = () => {
      fetch('/api/agent/stats')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled || !d?.ok) return;
          const subagents: SubagentInfo[] = (d.subagents || []).map((sa: any) => ({
            id: sa.id || sa.taskId || `sub-${Math.random().toString(36).slice(2, 8)}`,
            name: sa.name || sa.task || 'Subagent',
            status: sa.status || 'unknown',
            parentSession: sa.parentSession || sa.sessionKey,
            message: sa.message || sa.output?.slice(0, 120),
          }));
          setSubs(subagents);
        })
        .catch(() => {});
    };

    fetchSubs();
    const iv = setInterval(fetchSubs, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ready]);

  return subs;
}

// ─── Research items fetcher (for ForceGraph visualization) ──────────
interface ResearchGraphItem { id: string; title: string; type: string; topics: string[]; sourceUrls?: Array<{ url: string; label: string }>; parentId?: string; timestamp: number }
function useResearchItems(ready: boolean): ResearchGraphItem[] {
  const [items, setItems] = useState<ResearchGraphItem[]>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const fetchItems = () => {
      fetch('/api/local/research-feed')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled || !d?.ok) return;
          const raw: any[] = d.items || [];
          console.debug('[useResearchItems]', raw.length, 'items from research feed');
          setItems(raw.map((it: any) => ({
            id: it.id || `r-${Math.random().toString(36).slice(2, 8)}`,
            title: it.title || 'Untitled',
            type: it.type || 'research',
            topics: it.topics || [],
            sourceUrls: it.sourceUrls,
            parentId: it.parentId,
            timestamp: it.timestamp || Date.now(),
          })));
        })
        .catch(() => {});
    };

    fetchItems();
    // Refresh every 30s to pick up new research
    const iv = setInterval(fetchItems, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ready]);

  return items;
}

// ─── Chat timeline fetcher (reads dates from Vite middleware) ──────
interface ChatDateEntry { date: string; count: number }
function useChatTimeline(ready: boolean): ChatDateEntry[] {
  const [entries, setEntries] = useState<ChatDateEntry[]>([]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    fetch('/api/local/chat-dates')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.dates) return;
        setEntries(d.dates);
        console.debug('[useChatTimeline]', d.dates.length, 'dates');
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [ready]);

  return entries;
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

// ─── Standalone Code/HTML Preview (rendered inside FloatingWindow) ──
function CodePreviewContent({ code, language }: { code: string; language: string }) {
  const [showCode, setShowCode] = useState(false);

  const srcdoc = useMemo(() => {
    const isFullDoc = /<html[\s>]/i.test(code) || /<!doctype/i.test(code);
    if (isFullDoc) {
      return code.replace(/<head>/i, '<head><style>html,body{background:#0a0a1a!important;margin:0;}</style>');
    }
    return `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{background:#0a0a1a;color:#e0e0e0;font-family:Inter,system-ui,sans-serif;padding:16px;}</style></head><body>${code}</body></html>`;
  }, [code]);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
  }, [code]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.05] shrink-0">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">{language}</span>
        <button onClick={() => setShowCode(s => !s)}
          className="text-[10px] px-2.5 py-1 rounded border border-indigo-400/30 bg-indigo-500/10 text-indigo-300/70 hover:bg-indigo-500/20 transition-all">
          {showCode ? 'Preview' : 'Code'}
        </button>
        <button onClick={handleCopy}
          className="text-[10px] px-2.5 py-1 rounded border border-white/10 bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all">
          Copy
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {showCode ? (
          <pre className="p-4 text-[11px] text-white/60 font-mono whitespace-pre-wrap break-all leading-relaxed">{code}</pre>
        ) : (
          <iframe
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            className="w-full h-full border-none"
            style={{ background: '#0a0a1a' }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App({ onLogout }: AppProps) {
  const { connectionState, model, rpc } = useGateway();
  const { currentSession, agentName, agentStatus, sessions } = useSessionContext();
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
  const workspaceFiles = useFlatFiles(connectionState === 'connected');
  const liveEvents = useLiveEvents();
  const chatTimeline = useChatTimeline(connectionState === 'connected');
  const realMemory = useRealMemory(connectionState === 'connected');
  const specialFolders = useSpecialFolders(connectionState === 'connected');
  const subagents = useSubagents(connectionState === 'connected');
  const researchItems = useResearchItems(connectionState === 'connected');

  // Fetch gateway model catalog + discover models from API keys in custom_settings
  const [gatewayModels, setGatewayModels] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  useEffect(() => {
    if (connectionState !== 'connected') return;

    // Known models per provider (when API key exists)
    const PROVIDER_MODELS: Record<string, Array<{ id: string; label: string }>> = {
      google:    [{ id: 'gemini-3-flash', label: 'Gemini 3 Flash' }, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }, { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
      openai:    [{ id: 'gpt-4.1', label: 'GPT-4.1' }, { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' }, { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' }, { id: 'o3', label: 'o3' }, { id: 'o4-mini', label: 'o4-mini' }],
      anthropic: [{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' }, { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' }, { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }],
      xai:       [{ id: 'grok-3', label: 'Grok 3' }, { id: 'grok-3-fast', label: 'Grok 3 Fast' }, { id: 'grok-3-mini', label: 'Grok 3 Mini' }],
    };
    const KEY_MAP: Record<string, string> = {
      google_api_key: 'google', openai_api_key: 'openai',
      anthropic_api_key: 'anthropic', xai_api_key: 'xai',
    };

    fetch('/api/gateway/models').then(r => r.ok ? r.json() : null).catch(() => null)
      .then(async (gwData) => {
        const gwModels: Array<{ id: string; label: string; provider: string }> = gwData?.models || [];
        const seen = new Set(gwModels.map(m => m.id));

        // Try reading custom_settings to discover API keys
        let apiKeys: Record<string, string> = {};
        try {
          const agentId = workspaceAgentId || 'main';
          const r = await fetch(`/api/files/read?path=custom_settings.json&agentId=${encodeURIComponent(agentId)}`);
          if (r.ok) {
            const d = await r.json();
            const content = typeof d.content === 'string' ? JSON.parse(d.content) : d;
            apiKeys = content?.remote_api_keys || {};
          }
        } catch { /* ignore */ }

        // Discover providers from API keys
        for (const [keyName, provider] of Object.entries(KEY_MAP)) {
          const val = apiKeys[keyName];
          if (val && typeof val === 'string' && val.length > 5) {
            const provModels = PROVIDER_MODELS[provider] || [];
            for (const pm of provModels) {
              if (!seen.has(pm.id)) {
                seen.add(pm.id);
                gwModels.push({ id: pm.id, label: pm.label, provider });
              }
            }
          }
        }

        // If we still only have gateway models (file read failed), add all known providers
        // since we know from config that API keys exist for google, openai, anthropic, xai
        if (gwModels.length <= 1) {
          for (const [, provider] of Object.entries(KEY_MAP)) {
            const provModels = PROVIDER_MODELS[provider] || [];
            for (const pm of provModels) {
              if (!seen.has(pm.id)) {
                seen.add(pm.id);
                gwModels.push({ id: pm.id, label: pm.label, provider });
              }
            }
          }
        }

        // Also fetch local Ollama models from /api/models
        try {
          const localRes = await fetch('/api/models');
          if (localRes.ok) {
            const localData = await localRes.json();
            if (localData?.status === 'success' && Array.isArray(localData.models)) {
              for (const m of localData.models) {
                if (m.provider === 'ollama' && m.name && !seen.has(m.name)) {
                  seen.add(m.name);
                  const shortLabel = m.name.replace(/:latest$/, '');
                  gwModels.push({ id: m.name, label: shortLabel, provider: 'ollama' });
                }
              }
            }
          }
        } catch { /* Ollama not running — skip */ }

        console.debug('[App] Gateway models:', gwModels.length, gwModels.map(m => `${m.provider}/${m.id}`));
        setGatewayModels(gwModels);
      });
  }, [connectionState]);

  // Map sessions to simple format for graph
  const graphSessions = useMemo(() => {
    return sessions.map(s => ({
      key: s.sessionKey || s.key || s.id || '',
      label: s.label || s.displayName || s.sessionKey || s.key || '',
      model: s.model,
      lastActivity: s.lastActivity,
      state: s.state || s.agentState || 'idle',
    }));
  }, [sessions]);

  // Merge workspace files with key Substrate project files
  const files = useMemo(() => {
    const projectFiles = [
      { name: 'CIRCUITS.md', path: 'CIRCUITS.md', type: 'file' },
      { name: 'PRIME.md', path: 'PRIME.md', type: 'file' },
      { name: 'SUBSTRATE.md', path: 'SUBSTRATE.md', type: 'file' },
      { name: 'TOOL_PROMPT.md', path: 'TOOL_PROMPT.md', type: 'file' },
      { name: 'config.json', path: 'config.json', type: 'file' },
      { name: 'gateway.py', path: 'gateway.py', type: 'file' },
      { name: 'main.py', path: 'main.py', type: 'file' },
      { name: 'main.js', path: 'main.js', type: 'file' },
      { name: 'package.json', path: 'package.json', type: 'file' },
      { name: 'memory.json', path: 'memory.json', type: 'file' },
      { name: 'conversation_history.json', path: 'conversation_history.json', type: 'file' },
      { name: 'custom_settings.json', path: 'custom_settings.json', type: 'file' },
      { name: 'wake_circuits.py', path: 'wake_circuits.py', type: 'file' },
      { name: 'README.md', path: 'README.md', type: 'file' },
    ];
    const seen = new Set(workspaceFiles.map(f => f.name));
    const merged = [...workspaceFiles];
    for (const pf of projectFiles) {
      if (!seen.has(pf.name)) merged.push(pf);
    }
    return merged;
  }, [workspaceFiles]);

  // Debug: trace data reaching graph
  useEffect(() => {
    const withSlash = files.filter(f => f.path.includes('/'));
    console.debug('[App] Graph data:', { files: files.length, filesWithSubdir: withSlash.length, memories: memories.length, messages: messages.length, sessions: graphSessions.length, models: gatewayModels.length, connectionState });
    if (withSlash.length > 0) console.debug('[App] Sample subdir files:', withSlash.slice(0, 5).map(f => f.path));
    if (graphSessions.length > 0) console.debug('[App] Sessions:', graphSessions.slice(0, 5).map(s => `${s.key} [${s.state}]`));
  }, [files.length, memories.length, messages.length, connectionState, graphSessions.length, gatewayModels.length]);

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
  const clockChatActiveRef = useRef(false);
  const [widgetClosed, setWidgetClosed] = useState(() => {
    try { const s = localStorage.getItem('cmdHubState'); if (s) return JSON.parse(s).closed === true; } catch(e){}
    return false;
  });

  useEffect(() => {
    const onClosed = () => setWidgetClosed(true);
    const onReopened = () => setWidgetClosed(false);
    window.addEventListener('substrate:widget-closed', onClosed);
    window.addEventListener('substrate:widget-reopened', onReopened);
    return () => {
      window.removeEventListener('substrate:widget-closed', onClosed);
      window.removeEventListener('substrate:widget-reopened', onReopened);
    };
  }, []);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | undefined>(undefined);
  const hoveredFileRef = useRef<{ current: string | null }>({ current: null });
  const setHoveredFilePath = useCallback((filePath: string | null, entryType?: 'file' | 'directory') => {
    if (!filePath) { hoveredFileRef.current.current = null; return; }
    // WorkspacePanel paths are relative to Substrate root (e.g. workspace/data/x.json)
    // Graph node IDs use f: for files, dir: for directories (relative to workspace/)
    const normalized = filePath.replace(/^workspace\//, '');
    const prefix = entryType === 'directory' ? 'dir:' : 'f:';
    hoveredFileRef.current.current = `${prefix}${normalized}`;
  }, []);
  const [researchOpen, setResearchOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksTab, setTasksTab] = useState<'board' | 'circuits'>('board');
  const [mediaSuiteOpen, setMediaSuiteOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // Listen for postMessage from Media Suite iframe and custom DOM events from clock widget
  useEffect(() => {
    const msgHandler = (e: MessageEvent) => {
      if (e.data?.type === 'substrate:open-research') {
        setResearchOpen(true);
      }
      // Sync research results from Media Suite into Intelligence Hub awareness
      if (e.data?.type === 'substrate:research-result') {
        setResearchOpen(true);
        // Dispatch custom event so ResearchPanel can pick up the result
        window.dispatchEvent(new CustomEvent('substrate:media-suite-research', { detail: e.data }));
      }
    };
    // Clock widget dispatches this custom event to send chat messages
    // Responses are piped back to the widget's chat wall (no side panel)
    const clockChatHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        clockChatActiveRef.current = true;
        handleSend(detail.message);
      }
    };
    window.addEventListener('message', msgHandler);
    window.addEventListener('substrate:clock-chat', clockChatHandler);
    return () => {
      window.removeEventListener('message', msgHandler);
      window.removeEventListener('substrate:clock-chat', clockChatHandler);
    };
  }, [handleSend]);

  // Pipe streaming responses back to the clock widget's chat wall
  const lastMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (!clockChatActiveRef.current) return;
    // Stream in progress — send thinking indicator
    if (isGenerating && stream?.rawText) {
      window.dispatchEvent(new CustomEvent('substrate:clock-chat-response', {
        detail: { type: 'streaming', text: stream.rawText }
      }));
    }
  }, [isGenerating, stream?.rawText]);

  useEffect(() => {
    if (!clockChatActiveRef.current) return;
    // New assistant message arrived — send final response
    if (messages.length > lastMsgCountRef.current) {
      const newest = messages[messages.length - 1];
      if (newest?.role === 'assistant' && newest.rawText) {
        window.dispatchEvent(new CustomEvent('substrate:clock-chat-response', {
          detail: { type: 'final', text: newest.rawText }
        }));
        clockChatActiveRef.current = false;
      }
    }
    lastMsgCountRef.current = messages.length;
  }, [messages.length]);

  // Standalone code/HTML preview (survives chat close)
  const [codePreview, setCodePreview] = useState<{ code: string; language: string } | null>(null);

  // File editor state
  const [editFile, setEditFile] = useState<{ path: string; content: string; dirty: boolean; type?: 'text' | 'image' | 'audio' } | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Chat day preview state
  const [dayPreview, setDayPreview] = useState<{ date: string; messages: Array<{ time: string; user: string; assistant: string; model?: string }> } | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const openDayPreview = useCallback(async (date: string) => {
    setDayLoading(true);
    setDayPreview({ date, messages: [] });
    try {
      const r = await fetch(`/api/local/chat-day?date=${encodeURIComponent(date)}`);
      if (r.ok) {
        const d = await r.json();
        setDayPreview({ date, messages: d.messages || [] });
      }
    } catch { /* ignore */ }
    setDayLoading(false);
  }, []);

  const openFileEditor = useCallback(async (filePath: string) => {
    if (!filePath) return;
    setEditLoading(true);
    setEditFile({ path: filePath, content: '', dirty: false, type: 'text' });
    try {
      const r = await fetch(`/api/local/file-read?path=${encodeURIComponent(filePath)}`);
      if (r.ok) {
        const d = await r.json();
        const fileType = d.type === 'image' ? 'image' as const : d.type === 'audio' ? 'audio' as const : 'text' as const;
        const content = typeof d.content === 'string' ? d.content : JSON.stringify(d, null, 2);
        setEditFile({ path: filePath, content, dirty: false, type: fileType });
      } else {
        setEditFile({ path: filePath, content: `// Failed to load: ${r.status}`, dirty: false, type: 'text' });
      }
    } catch (err) {
      setEditFile({ path: filePath, content: `// Error: ${err}`, dirty: false, type: 'text' });
    } finally {
      setEditLoading(false);
    }
  }, []);

  const saveFile = useCallback(async () => {
    if (!editFile || !editFile.dirty) return;
    try {
      const r = await fetch('/api/local/file-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editFile.path, content: editFile.content }),
      });
      if (r.ok) setEditFile(prev => prev ? { ...prev, dirty: false } : null);
    } catch (err) {
      console.warn('[App] Save failed:', err);
    }
  }, [editFile]);

  // Listen for code preview events from MarkdownRenderer (survives chat close)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.code) setCodePreview({ code: detail.code, language: detail.language || 'html' });
    };
    window.addEventListener('open-code-preview', handler);
    return () => window.removeEventListener('open-code-preview', handler);
  }, []);

  // Boot after first connection + load chat history
  useEffect(() => {
    if (connectionState === 'connected' && !booted) {
      setBooted(true);
      loadHistory();
      // Tell clock widget that auth has passed
      window.dispatchEvent(new Event('substrate:authenticated'));
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
  const streamingRawText = useMemo(() => stream?.rawText || '', [stream]);

  const onChatSend = useCallback((text: string, images?: any[]) => { handleSend(text, images); }, [handleSend]);
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
    <div className="substrate-bg h-screen flex flex-col overflow-hidden relative" data-substrate-app style={{ zIndex: 1 }}>
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

          {/* Workspace toggle */}
          <button
            onClick={() => setWorkspaceOpen(o => !o)}
            className={`
              relative ml-2 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${workspaceOpen
                ? 'bg-amber-500/20 border border-amber-400/25 text-amber-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
            title="Workspace"
          >
            <FolderOpen size={15} />
          </button>

          {/* Research/Intelligence Hub toggle */}
          <button
            onClick={() => setResearchOpen(o => !o)}
            className={`
              relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${researchOpen
                ? 'bg-purple-500/20 border border-purple-400/25 text-purple-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
            title="Intelligence Hub"
          >
            <Sparkles size={15} />
          </button>

          {/* Agent Stats toggle */}
          <button
            onClick={() => setStatsOpen(o => !o)}
            className={`
              relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${statsOpen
                ? 'bg-fuchsia-500/20 border border-fuchsia-400/25 text-fuchsia-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
            title="Agent Stats"
          >
            <BarChart3 size={15} />
          </button>

          {/* Media Suite toggle */}
          <button
            onClick={() => setMediaSuiteOpen(o => !o)}
            className={`
              relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${mediaSuiteOpen
                ? 'bg-teal-500/20 border border-teal-400/25 text-teal-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
            title="Workbench"
          >
            <Film size={15} />
          </button>

          {/* Tasks toggle */}
          <button
            onClick={() => setTasksOpen(o => !o)}
            className={`
              relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
              ${tasksOpen
                ? 'bg-emerald-500/20 border border-emerald-400/25 text-emerald-300'
                : 'bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
              }
            `}
            title="Tasks"
          >
            <LayoutGrid size={15} />
          </button>

          {/* Chat toggle with hover flyout */}
          <div className="relative group">
            <button
              onClick={toggleChat}
              className={`
                relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200
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
            {/* Hover flyout */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:flex flex-col gap-1 p-1.5 rounded-xl bg-[#1a1a2e]/95 border border-white/[0.08] backdrop-blur-xl shadow-xl min-w-[120px] z-50">
              <button
                onClick={toggleChat}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                  chatOpen ? 'text-indigo-300 bg-indigo-500/15' : 'text-white/60 hover:text-white/80 hover:bg-white/[0.06]'
                }`}
              >
                <MessageSquare size={12} />
                Chat
              </button>
              {widgetClosed && (
                <button
                  onClick={() => window.dispatchEvent(new Event('substrate:widget-reopen'))}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white/80 hover:bg-white/[0.06] transition-all"
                >
                  <Clock size={12} />
                  Widget
                </button>
              )}
            </div>
          </div>

          {onLogout && (
            <button
              onClick={() => { window.dispatchEvent(new Event('substrate:logout')); onLogout(); }}
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
            gatewayModels={gatewayModels}
            sessions={graphSessions}
            chatDates={chatTimeline}
            realMemory={realMemory}
            specialFolders={specialFolders}
            subagents={subagents}
            researchItems={researchItems}
            externalHighlightRef={hoveredFileRef.current}
            onNodeClick={(kind, id, detail) => {
              if (id.startsWith('doc:')) {
                const filePath = detail || id.replace('doc:', '');
                openFileEditor(filePath);
              } else if (id.startsWith('cfg:')) {
                openFileEditor('custom_settings.json');
              } else if (id.startsWith('vimg:')) {
                if (detail) openFileEditor(detail);
              } else if (id.startsWith('dir:')) {
                const dirPath = detail || id.replace('dir:', '');
                setWorkspacePath(dirPath);
                setWorkspaceOpen(true);
              } else if (id.startsWith('f:')) {
                const filePath = detail || id.replace('f:', '');
                if (kind === 'file' && filePath) openFileEditor(filePath);
              } else if (id.startsWith('skills:') || id.startsWith('macros:') || id.startsWith('tools:')) {
                // Special folder files — open in editor
                if (detail) openFileEditor(detail);
              } else if (id.startsWith('day:')) {
                const date = id.replace('day:', '');
                openDayPreview(date);
              } else if (id === 'hub-ws' || id === 'hub-core') {
                // Workspace/Core hub — open file browser at root
                setWorkspacePath('');
                setWorkspaceOpen(true);
              } else if (id.startsWith('hub-skills') || id.startsWith('hub-macros') || id.startsWith('hub-tools')) {
                // Special folder hubs — open workspace at that folder
                const folder = id.replace('hub-', '');
                setWorkspacePath(folder);
                setWorkspaceOpen(true);
              } else if (id.startsWith('skills-dir:') || id.startsWith('macros-dir:') || id.startsWith('tools-dir:')) {
                // Special folder sub-directories
                const folder = id.split('-dir:')[0];
                const subDir = id.split('-dir:')[1];
                setWorkspacePath(`${folder}/${subDir}`);
                setWorkspaceOpen(true);
              } else if (kind === 'task' || id.startsWith('t:')) {
                setTasksOpen(true);
              } else if (kind === 'conversation' || id.startsWith('sess:') || id.startsWith('c:')) {
                setChatOpen(true);
              } else if (kind === 'memory' || id.startsWith('fact:') || id.startsWith('lesson:') || id.startsWith('mem-')) {
                // Memory nodes — open the memory.json file for viewing
                openFileEditor('memory.json');
              } else if (id.startsWith('research:') || id === 'hub-research' || id.startsWith('concept:')) {
                // Research / concept nodes — open Research/Intelligence Hub
                setResearchOpen(true);
              } else if (id.startsWith('source:')) {
                // Source URL nodes — open link in new tab
                if (detail) window.open(detail, '_blank', 'noopener,noreferrer');
              }
            }}
            onNodeDoubleClick={(kind, id, detail) => {
              if (id.startsWith('model:')) {
                // Model node — switch to this model as active
                const modelId = id.replace('model:', '');
                if (modelId && modelId !== model) {
                  rpc('sessions.patch', { key: currentSession, model: modelId }).then(() => {
                    console.log(`[Graph] Switched model to: ${modelId}`);
                  }).catch((err) => {
                    console.warn('[Graph] Model switch failed:', err);
                  });
                }
              } else if (id.startsWith('dir:')) {
                // Directory node — open workspace panel navigated to that folder
                const dirPath = detail || id.replace('dir:', '');
                setWorkspacePath(dirPath);
                setWorkspaceOpen(true);
              } else if ((kind === 'file' || kind === 'skill' || kind === 'macro' || kind === 'tool') && detail) {
                openFileEditor(detail);
              } else if (id.startsWith('day:')) {
                const date = id.replace('day:', '');
                openDayPreview(date);
              }
            }}
          />
        </main>

        {/* File Editor — Floating Window */}
        <div className={editFile ? '' : 'hidden'}>
          <FloatingWindow
            id="file-editor"
            title={editFile?.path.split('/').pop() || 'Editor'}
            titleIcon={<FileCode size={13} className="text-green-400" />}
            defaultWidth={640}
            defaultHeight={560}
            minWidth={380}
            minHeight={300}
            onClose={() => setEditFile(null)}
          >
            {editFile && (
              <FileEditorPanel
                file={editFile}
                loading={editLoading}
                onSave={saveFile}
                onClose={() => setEditFile(null)}
                onChange={(content) => setEditFile(prev => prev ? { ...prev, content, dirty: true } : null)}
              />
            )}
          </FloatingWindow>
        </div>

        {/* Workspace File Browser — Floating Window */}
        <div className={workspaceOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="workspace-browser"
            title="Workspace"
            titleIcon={<FolderOpen size={13} className="text-amber-400" />}
            defaultWidth={440}
            defaultHeight={620}
            minWidth={320}
            minHeight={300}
            onClose={() => setWorkspaceOpen(false)}
          >
            <WorkspacePanel onClose={() => setWorkspaceOpen(false)} onFileHover={setHoveredFilePath} onOpenFile={openFileEditor} initialPath={workspacePath} />
          </FloatingWindow>
        </div>

        {/* Chat Day Preview Panel */}
        <div
          className={`
            absolute top-0 left-0 h-full z-30
            transition-all duration-300 ease-in-out
            ${dayPreview && !editFile ? 'w-[520px] opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full'}
          `}
        >
          {dayPreview && (
            <div className="h-full glass-panel m-1 mr-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare size={14} className="text-purple-400 shrink-0" />
                  <span className="text-xs font-semibold text-white/80">{dayPreview.date}</span>
                  <span className="text-[10px] text-white/40">{dayPreview.messages.length} messages</span>
                </div>
                <button
                  onClick={() => setDayPreview(null)}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {dayLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 size={18} className="text-purple-400/50 animate-spin" />
                  </div>
                ) : dayPreview.messages.length === 0 ? (
                  <div className="text-center text-white/30 text-xs py-8">No messages found</div>
                ) : (
                  dayPreview.messages.map((m, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="text-[10px] text-white/25 font-mono">{m.time}{m.model ? ` · ${m.model}` : ''}</div>
                      {m.user && (
                        <div className="bg-white/[0.04] rounded-lg px-3 py-2">
                          <div className="text-[10px] text-indigo-300/60 mb-0.5 font-semibold">You</div>
                          <div className="text-xs text-white/70 leading-relaxed">{m.user}</div>
                        </div>
                      )}
                      {m.assistant && (
                        <div className="bg-purple-500/[0.06] rounded-lg px-3 py-2">
                          <div className="text-[10px] text-purple-300/60 mb-0.5 font-semibold">Agent</div>
                          <div className="text-xs text-white/60 leading-relaxed">{m.assistant}</div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Agent Stats — Floating Window */}
        <div className={statsOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="agent-stats"
            title="Agent Stats"
            titleIcon={<BarChart3 size={13} className="text-fuchsia-400" />}
            defaultWidth={780}
            defaultHeight={640}
            minWidth={520}
            minHeight={400}
            onClose={() => setStatsOpen(false)}
          >
            <AgentStatsTab />
          </FloatingWindow>
        </div>

        {/* Research / Intelligence Hub — Floating Window (always mounted to preserve state) */}
        <div className={researchOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="research-hub"
            title="Intelligence Hub"
            titleIcon={<Sparkles size={13} className="text-purple-400" />}
            defaultWidth={780}
            defaultHeight={640}
            minWidth={480}
            minHeight={400}
            onClose={() => setResearchOpen(false)}
          >
            <ResearchPanel
              onClose={() => setResearchOpen(false)}
              onSendToAgent={(text) => {
                handleSend(text);
              }}
              chatMessages={messages}
              isAgentGenerating={isGenerating}
              streamingText={streamingText}
              streamingRawText={streamingRawText}
            />
          </FloatingWindow>
        </div>

        {/* Chat — Floating Window (draggable, resizable, persistent position) */}
        <div className={chatOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="chat-window"
            title={`Chat${isGenerating ? (processingStage === 'thinking' ? ' · Thinking' : ' · Streaming') : ''}`}
            titleIcon={<MessageSquare size={13} className="text-indigo-300" />}
            defaultWidth={460}
            defaultHeight={640}
            minWidth={360}
            minHeight={400}
            onClose={() => setChatOpen(false)}
          >
            <GlassChat
              messages={messages}
              isStreaming={isGenerating}
              streamingText={streamingText}
              streamingRawText={streamingRawText}
              processingStage={processingStage}
              onSend={onChatSend}
              agentName={agentName || 'Substrate'}
            />
          </FloatingWindow>
        </div>

        {/* Tasks / Kanban Board + Circuits — Floating Window */}
        <div className={tasksOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="tasks-board"
            title={tasksTab === 'board' ? 'Tasks' : 'Circuits'}
            titleIcon={tasksTab === 'board'
              ? <LayoutGrid size={13} className="text-emerald-400" />
              : <Zap size={13} className="text-amber-400" />
            }
            defaultWidth={820}
            defaultHeight={560}
            minWidth={560}
            minHeight={400}
            onClose={() => setTasksOpen(false)}
          >
            <div className="h-full flex flex-col">
              {/* Tab bar */}
              <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.06] bg-white/[0.015]">
                <button
                  onClick={() => setTasksTab('board')}
                  className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all ${
                    tasksTab === 'board'
                      ? 'bg-emerald-500/15 border border-emerald-400/20 text-emerald-300'
                      : 'text-white/30 hover:text-white/50 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><LayoutGrid size={10} /> Board</span>
                </button>
                <button
                  onClick={() => setTasksTab('circuits')}
                  className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all ${
                    tasksTab === 'circuits'
                      ? 'bg-amber-500/15 border border-amber-400/20 text-amber-300'
                      : 'text-white/30 hover:text-white/50 hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><Zap size={10} /> Circuits</span>
                </button>
              </div>
              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {tasksTab === 'board' ? <KanbanBoard /> : <CircuitsView />}
              </div>
            </div>
          </FloatingWindow>
        </div>

        {/* Media Suite — iframe FloatingWindow */}
        <div className={mediaSuiteOpen ? '' : 'hidden'}>
          <FloatingWindow
            id="media-suite"
            title="Workbench"
            titleIcon={<Film size={13} className="text-teal-400" />}
            defaultWidth={1100}
            defaultHeight={720}
            minWidth={600}
            minHeight={400}
            onClose={() => setMediaSuiteOpen(false)}
          >
            <iframe
              src={`http://${window.location.hostname}:5000`}
              className="w-full h-full border-none"
              allow="clipboard-write; fullscreen"
              allowFullScreen
              style={{ background: '#1a1a2e' }}
            />
          </FloatingWindow>
        </div>

        {/* Standalone Code/HTML Preview — survives chat close */}
        {codePreview && (
          <FloatingWindow
            id="code-preview-standalone"
            title="Code Preview"
            titleIcon={<Code size={13} className="text-cyan-400" />}
            defaultWidth={800}
            defaultHeight={600}
            minWidth={400}
            minHeight={300}
            onClose={() => setCodePreview(null)}
          >
            <CodePreviewContent code={codePreview.code} language={codePreview.language} />
          </FloatingWindow>
        )}
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
        <span className={`capitalize ${
          connectionState === 'connected' ? 'text-green-400/50' :
          connectionState === 'connecting' || connectionState === 'reconnecting' ? 'text-amber-400/50' :
          'text-red-400/50'
        }`}>{connectionState}</span>
      </footer>
    </div>
  );
}
