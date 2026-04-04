/**
 * AgentStatsTab — Comprehensive agent statistics dashboard panel.
 *
 * Displays uptime, token costs, tool history, errors, subagent activity,
 * and event summaries fetched from /api/agent/stats.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Clock, DollarSign, Wrench, AlertTriangle, Bot, Activity,
  RefreshCw, ChevronDown, ChevronRight, Cpu, Zap, Settings, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────
interface AgentStats {
  ok: boolean;
  uptime?: {
    startedAt: number;
    durationMinutes: number;
    durationSeconds: number;
  };
  cost?: {
    session?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      callCount: number;
      startedAt: number;
      lastCallAt: number;
      durationMinutes: number;
      byModel: Record<string, { input: number; output: number; calls: number; cost: number }>;
    };
    cumulative?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
      callCount: number;
      firstSeen: number;
    };
  };
  eventBus?: {
    totalEmitted?: number;
    subscriberCount?: number;
    historySize?: number;
  };
  eventSummary?: {
    date: string;
    totalEvents: number;
    byType: Record<string, number>;
  };
  eventDates?: string[];
  events?: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
  toolHistory?: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
  toolSummary?: {
    totalCalls: number;
    uniqueTools: number;
    errorCount: number;
    byTool: Record<string, number>;
  };
  errors?: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
  subagentHistory?: {
    spawned: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
    completed: Array<{ ts: number; event: string; data: Record<string, unknown> }>;
    totalSpawned: number;
    totalCompleted: number;
    successCount: number;
    failCount: number;
  };
  activeSubagents?: Array<{
    id: string;
    name: string;
    status: string;
    parentSession: string;
    message: string;
  }>;
  sessionsOverview?: {
    total: number;
    sessions: Array<Record<string, unknown>>;
  };
}

// ─── Palette ──────────────────────────────────────────────────────
const CHART_COLORS = [
  '#818cf8', '#a78bfa', '#c084fc', '#e879f9',
  '#f472b6', '#fb7185', '#f97316', '#facc15',
  '#4ade80', '#34d399', '#22d3ee', '#38bdf8',
];

const TOOL_COLORS: Record<string, string> = {
  text_editor: '#818cf8',
  web_search: '#22d3ee',
  execute: '#f97316',
  agent: '#e879f9',
  browser: '#34d399',
  skills: '#facc15',
  memory: '#fb7185',
};

function getToolColor(name: string, idx: number): string {
  return TOOL_COLORS[name] || CHART_COLORS[idx % CHART_COLORS.length];
}

// ─── Helpers ──────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatCost(usd: number): string {
  if (usd === 0) return 'Free (local)';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


// ─── Stat Card ────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="glass-panel p-3 rounded-xl flex items-start gap-3 min-w-[160px]">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}20`, border: `1px solid ${color}30` }}
      >
        <Icon size={14} style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] text-white/35 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-semibold text-white/90 mt-0.5">{value}</div>
        {sub && <div className="text-[10px] text-white/30 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────
function Section({ title, icon: Icon, color, defaultOpen = true, children, badge }: {
  title: string;
  icon: typeof Clock;
  color: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-all"
      >
        {open ? <ChevronDown size={12} className="text-white/30" /> : <ChevronRight size={12} className="text-white/30" />}
        <Icon size={13} style={{ color }} />
        <span className="text-xs font-semibold text-white/70">{title}</span>
        {badge !== undefined && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-3 border-t border-white/[0.04]">{children}</div>}
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a2e]/95 border border-white/10 rounded-lg px-3 py-2 text-[10px] shadow-xl backdrop-blur-md">
      {label && <div className="text-white/50 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-white/60">{p.name}:</span>
          <span className="text-white/90 font-medium">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Tool Timeline (Horizontal) ──────────────────────────────────
interface ToolEvent {
  ts: number;
  event: string;
  data?: Record<string, unknown>;
}

const TIMELINE_COLORS: Record<string, string> = {
  read_file: '#818cf8',
  text_editor: '#818cf8',
  write_file: '#34d399',
  edit_file: '#fbbf24',
  run_command: '#f97316',
  execute: '#f97316',
  search: '#38bdf8',
  web_search: '#38bdf8',
  browser: '#c084fc',
  agent: '#e879f9',
  skills: '#facc15',
  memory: '#fb7185',
  default: '#94a3b8',
  failed: '#fb7185',
};

function getTimelineColor(name: string, failed?: boolean): string {
  if (failed) return TIMELINE_COLORS.failed;
  const lower = name.toLowerCase();
  for (const [key, color] of Object.entries(TIMELINE_COLORS)) {
    if (key !== 'default' && key !== 'failed' && lower.includes(key)) return color;
  }
  return TIMELINE_COLORS.default;
}

// Horizontal tool summary strip — replaces vertical bar chart
function ToolSummaryStrip({ byTool }: { byTool: Record<string, number> }) {
  const sorted = useMemo(() =>
    Object.entries(byTool)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20),
    [byTool]
  );
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <div className="text-[10px] text-white/25 mb-2">Tool Breakdown</div>
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-4 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(to right, rgba(10,10,20,0.8), transparent)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-4 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(to left, rgba(10,10,20,0.8), transparent)' }} />
        <div className="overflow-x-auto scrollbar-none px-2 py-1">
          <div className="flex items-end gap-1.5 min-w-max" style={{ height: 64 }}>
            {sorted.map(([name, count]) => {
              const color = getTimelineColor(name);
              const ratio = count / maxCount;
              const barH = Math.max(8, ratio * 48);
              const isHov = hovered === name;
              return (
                <div
                  key={name}
                  className="relative flex flex-col items-center"
                  onMouseEnter={() => setHovered(name)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ minWidth: 28 }}
                >
                  {/* Hover tooltip */}
                  {isHov && (
                    <div className="absolute bottom-full mb-1.5 z-20 px-2 py-1 rounded-lg whitespace-nowrap text-[10px] border border-white/10 shadow-xl pointer-events-none"
                      style={{ background: 'rgba(15,15,30,0.95)', backdropFilter: 'blur(12px)' }}>
                      <div className="font-medium text-white/80">{name}</div>
                      <div className="text-white/40">{count} call{count !== 1 ? 's' : ''}</div>
                    </div>
                  )}
                  {/* Bar */}
                  <div
                    className="rounded-t-md transition-all duration-300 cursor-pointer"
                    style={{
                      width: isHov ? 22 : 16,
                      height: isHov ? barH + 6 : barH,
                      backgroundColor: color,
                      boxShadow: isHov
                        ? `0 0 14px ${color}60, 0 0 4px ${color}40, inset 0 1px 0 rgba(255,255,255,0.15)`
                        : `0 0 6px ${color}30`,
                      transform: isHov ? 'translateY(-3px)' : 'none',
                    }}
                  />
                  {/* Label */}
                  <div className="text-[7px] text-white/25 mt-1 font-mono truncate text-center" style={{ maxWidth: 36 }}>
                    {name.length > 6 ? name.slice(0, 5) + '…' : name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Horizontal event-level timeline
function ToolTimeline({ events }: { events: ToolEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const grouped = useMemo(() => {
    const groups: { label: string; events: (ToolEvent & { idx: number })[] }[] = [];
    let currentLabel = '';
    events.forEach((ev, idx) => {
      const d = new Date(typeof ev.ts === 'number' ? ev.ts * 1000 : ev.ts);
      const mins = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      if (mins !== currentLabel) {
        currentLabel = mins;
        groups.push({ label: mins, events: [] });
      }
      groups[groups.length - 1].events.push({ ...ev, idx });
    });
    return groups;
  }, [events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [events.length]);

  return (
    <div className="mt-3">
      <div className="text-[10px] text-white/25 mb-2">Recent Activity Timeline</div>
      <div className="relative">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-6 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(to right, rgba(10,10,20,0.9), transparent)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-6 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(to left, rgba(10,10,20,0.9), transparent)' }} />

        <div
          ref={scrollRef}
          className="overflow-x-auto scrollbar-none py-2 px-3"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="flex items-end gap-0.5 min-w-max relative">
            {/* Timeline rail */}
            <div className="absolute bottom-[11px] left-0 right-0 h-px" style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 10%, rgba(255,255,255,0.08) 90%, transparent)',
            }} />

            {grouped.map((group, gi) => (
              <div key={gi} className="flex flex-col items-center" style={{ marginLeft: gi > 0 ? 6 : 0 }}>
                {/* Time tick */}
                <div className="text-[7px] text-white/20 mb-1 font-mono tracking-wide">{group.label}</div>
                {/* Cluster of nodes */}
                <div className="flex items-end gap-[3px]">
                  {group.events.map((ev) => {
                    const name = (ev.data?.name as string) || 'unknown';
                    const failed = ev.event === 'tool_failed';
                    const color = getTimelineColor(name, failed);
                    const isHovered = hoveredIdx === ev.idx;
                    const recency = 1 - (ev.idx / events.length);
                    const size = 5 + recency * 7;
                    const durationMs = (ev.data?.duration_ms as number) || 0;

                    return (
                      <div
                        key={ev.idx}
                        className="relative flex flex-col items-center"
                        onMouseEnter={() => setHoveredIdx(ev.idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                      >
                        {/* Tooltip */}
                        {isHovered && (
                          <div className="absolute bottom-full mb-2 z-20 px-2.5 py-1.5 rounded-lg whitespace-nowrap text-[10px] border border-white/10 shadow-xl pointer-events-none"
                            style={{ background: 'rgba(12,12,28,0.96)', backdropFilter: 'blur(16px)' }}>
                            <div className="font-semibold text-white/90" style={{ color }}>{name}</div>
                            <div className="text-white/35 text-[9px] mt-0.5">
                              {new Date(typeof ev.ts === 'number' ? ev.ts * 1000 : ev.ts).toLocaleTimeString()}
                              {durationMs > 0 && <span className="ml-1.5 text-white/25">{durationMs}ms</span>}
                              {failed && <span className="text-red-400 ml-1.5 font-medium">FAILED</span>}
                            </div>
                          </div>
                        )}
                        {/* Glow ring + dot */}
                        <div
                          className="rounded-full cursor-pointer transition-all duration-200"
                          style={{
                            width: isHovered ? 14 : size,
                            height: isHovered ? 14 : size,
                            backgroundColor: color,
                            boxShadow: isHovered
                              ? `0 0 16px ${color}80, 0 0 6px ${color}60, inset 0 0 2px rgba(255,255,255,0.2)`
                              : `0 0 5px ${color}35`,
                            border: failed ? '1.5px solid rgba(251,113,133,0.6)' : '0.5px solid rgba(255,255,255,0.08)',
                            transform: isHovered ? 'translateY(-3px) scale(1.1)' : 'none',
                          }}
                        />
                        {/* Connector stem */}
                        <div className="w-px h-1.5" style={{ background: `${color}25` }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend row */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 px-1">
        {[
          { label: 'Read/Edit', color: TIMELINE_COLORS.read_file },
          { label: 'Write', color: TIMELINE_COLORS.write_file },
          { label: 'Execute', color: TIMELINE_COLORS.run_command },
          { label: 'Search', color: TIMELINE_COLORS.search },
          { label: 'Browser', color: TIMELINE_COLORS.browser },
          { label: 'Agent', color: TIMELINE_COLORS.agent },
          { label: 'Failed', color: TIMELINE_COLORS.failed },
        ].map(({ label, color }) => (
          <span key={label} className="flex items-center gap-1 text-[7px] text-white/20">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}40` }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard Settings Panel (Inline) ──────────────────────────
function DashboardSettingsPanel({ onClose }: { onClose: () => void }) {
  const [refreshInterval, setRefreshInterval] = useState(() => {
    try { return parseInt(localStorage.getItem('substrate:stats-refresh') || '5000', 10); } catch { return 5000; }
  });
  const [maxEvents, setMaxEvents] = useState(() => {
    try { return parseInt(localStorage.getItem('substrate:stats-maxEvents') || '30', 10); } catch { return 30; }
  });
  const [compactMode, setCompactMode] = useState(() => {
    try { return localStorage.getItem('substrate:stats-compact') === 'true'; } catch { return false; }
  });

  const save = (key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  };

  return (
    <div className="glass-panel rounded-xl overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Settings size={12} className="text-indigo-400" />
          <span className="text-[11px] font-semibold text-white/70">Dashboard Settings</span>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
        >
          <X size={10} />
        </button>
      </div>
      <div className="p-3 space-y-3">
        {/* Refresh Interval */}
        <label className="block">
          <span className="text-[10px] text-white/40 block mb-1">Auto-Refresh Interval</span>
          <select
            value={refreshInterval}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setRefreshInterval(v);
              save('substrate:stats-refresh', String(v));
            }}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg text-[11px] text-white/70 px-2 py-1.5 focus:outline-none focus:border-indigo-400/30"
          >
            <option value="2000">2 seconds</option>
            <option value="5000">5 seconds</option>
            <option value="10000">10 seconds</option>
            <option value="30000">30 seconds</option>
          </select>
        </label>

        {/* Max Timeline Events */}
        <label className="block">
          <span className="text-[10px] text-white/40 block mb-1">Timeline Events (max)</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={maxEvents}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setMaxEvents(v);
              save('substrate:stats-maxEvents', String(v));
            }}
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-[9px] text-white/25 mt-0.5">
            <span>10</span>
            <span className="text-indigo-300/60 font-medium">{maxEvents}</span>
            <span>100</span>
          </div>
        </label>

        {/* Compact Mode */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Compact Mode</span>
          <button
            onClick={() => {
              const next = !compactMode;
              setCompactMode(next);
              save('substrate:stats-compact', String(next));
            }}
            className={`w-8 h-4.5 rounded-full transition-all relative ${
              compactMode ? 'bg-indigo-500/40' : 'bg-white/10'
            }`}
            style={{ height: 18 }}
          >
            <div
              className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white/80 transition-all shadow-sm"
              style={{ left: compactMode ? 16 : 2 }}
            />
          </button>
        </div>

        <div className="pt-1 border-t border-white/[0.05]">
          <div className="text-[9px] text-white/20">
            Settings are saved to local storage and persist across sessions.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────
export function AgentStatsTab() {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/stats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStats(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    if (!autoRefresh) return;
    const iv = setInterval(fetchStats, 5000);
    return () => clearInterval(iv);
  }, [fetchStats, autoRefresh]);

  // ─── Derived data ────────────────────────────────────────────
  const sessionCost = stats?.cost?.session;
  const cumulativeCost = stats?.cost?.cumulative;
  const toolSummary = stats?.toolSummary;
  const subagents = stats?.subagentHistory;

  const toolChartData = useMemo(() => {
    if (!toolSummary?.byTool) return [];
    return Object.entries(toolSummary.byTool)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([name, count], i) => ({
        name: name.length > 14 ? name.slice(0, 12) + '…' : name,
        fullName: name,
        count,
        fill: getToolColor(name, i),
      }));
  }, [toolSummary]);

  const modelChartData = useMemo(() => {
    if (!sessionCost?.byModel) return [];
    return Object.entries(sessionCost.byModel).map(([model, data], i) => ({
      name: model.length > 18 ? model.slice(0, 16) + '…' : model,
      fullName: model,
      calls: data.calls,
      input: data.input,
      output: data.output,
      cost: data.cost,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [sessionCost]);

  const eventTypeData = useMemo(() => {
    if (!stats?.eventSummary?.byType) return [];
    return Object.entries(stats.eventSummary.byType)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count], i) => ({
        name: name.replace(/_/g, ' '),
        count,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [stats?.eventSummary]);

  const tokenPieData = useMemo(() => {
    if (!sessionCost) return [];
    return [
      { name: 'Input', value: sessionCost.inputTokens || 0, fill: '#818cf8' },
      { name: 'Output', value: sessionCost.outputTokens || 0, fill: '#e879f9' },
    ].filter(d => d.value > 0);
  }, [sessionCost]);

  // ─── Render ──────────────────────────────────────────────────
  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="text-indigo-400/50 animate-spin" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertTriangle size={20} className="text-red-400/60" />
        <div className="text-xs text-white/40">{error}</div>
        <button onClick={fetchStats} className="text-xs text-indigo-400 hover:text-indigo-300">Retry</button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* Header controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-indigo-400" />
          <span className="text-xs font-semibold text-white/70">Agent Statistics</span>
          {stats?.eventSummary?.date && (
            <span className="text-[10px] text-white/30">{stats.eventSummary.date}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(a => !a)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-all ${
              autoRefresh
                ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300'
                : 'border-white/10 text-white/30 hover:text-white/50'
            }`}
          >
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={fetchStats}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
              settingsOpen
                ? 'text-indigo-300 bg-indigo-500/15'
                : 'text-white/30 hover:text-white/60 hover:bg-white/[0.06]'
            }`}
            title="Dashboard Settings"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {/* Inline Settings Panel */}
      {settingsOpen && <DashboardSettingsPanel onClose={() => setSettingsOpen(false)} />}

      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard
          icon={Clock}
          label="Uptime"
          value={formatDuration(stats?.uptime?.durationSeconds || 0)}
          sub={stats?.uptime?.startedAt ? `Since ${formatTime(stats.uptime.startedAt)}` : undefined}
          color="#818cf8"
        />
        <StatCard
          icon={DollarSign}
          label="Session Cost"
          value={formatCost(sessionCost?.costUsd || 0)}
          sub={`${sessionCost?.callCount || 0} API calls`}
          color="#4ade80"
        />
        <StatCard
          icon={Wrench}
          label="Tool Calls"
          value={String(toolSummary?.totalCalls || 0)}
          sub={`${toolSummary?.uniqueTools || 0} unique tools`}
          color="#f97316"
        />
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          value={String((stats?.errors?.length || 0) + (toolSummary?.errorCount || 0))}
          sub={toolSummary?.errorCount ? `${toolSummary.errorCount} tool failures` : 'No errors'}
          color="#fb7185"
        />
      </div>

      {/* Token & Cost section — Enhanced with emissive glow */}
      <Section title="Tokens & Cost" icon={Cpu} color="#818cf8" badge={formatTokens(sessionCost?.totalTokens || 0)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {/* Token breakdown pie — with glow */}
          {tokenPieData.length > 0 && (
            <div className="relative">
              {/* Ambient glow behind the chart */}
              <div className="absolute inset-0 rounded-xl opacity-40 blur-2xl pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(129,140,248,0.2) 0%, rgba(232,121,249,0.12) 50%, transparent 80%)' }} />
              <div className="relative">
                <div className="text-[10px] text-white/30 mb-2">Session Token Split</div>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <defs>
                      <filter id="glow-input">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feFlood floodColor="#818cf8" floodOpacity="0.6" />
                        <feComposite in2="blur" operator="in" />
                        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glow-output">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feFlood floodColor="#e879f9" floodOpacity="0.6" />
                        <feComposite in2="blur" operator="in" />
                        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <linearGradient id="pie-input-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                      <linearGradient id="pie-output-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#e879f9" />
                        <stop offset="100%" stopColor="#c084fc" />
                      </linearGradient>
                    </defs>
                    <Pie
                      data={tokenPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {tokenPieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={i === 0 ? 'url(#pie-input-grad)' : 'url(#pie-output-grad)'}
                          style={{ filter: i === 0 ? 'url(#glow-input)' : 'url(#glow-output)' }}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-4 text-[10px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#818cf8] shadow-[0_0_6px_rgba(129,140,248,0.6)]" />
                    <span className="text-white/50">Input: {formatTokens(sessionCost?.inputTokens || 0)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#e879f9] shadow-[0_0_6px_rgba(232,121,249,0.6)]" />
                    <span className="text-white/50">Output: {formatTokens(sessionCost?.outputTokens || 0)}</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Model breakdown — with glow bars */}
          {modelChartData.length > 0 && (
            <div className="relative">
              <div className="absolute inset-0 rounded-xl opacity-30 blur-2xl pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />
              <div className="relative">
                <div className="text-[10px] text-white/30 mb-2">By Model</div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={modelChartData} layout="vertical" margin={{ left: 0, right: 8 }}>
                    <defs>
                      {modelChartData.map((d, i) => (
                        <filter key={i} id={`bar-glow-${i}`}>
                          <feGaussianBlur stdDeviation="2" result="blur" />
                          <feFlood floodColor={d.fill} floodOpacity="0.4" />
                          <feComposite in2="blur" operator="in" />
                          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                      ))}
                    </defs>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="calls" name="Calls" radius={[0, 4, 4, 0]}>
                      {modelChartData.map((d, i) => (
                        <Cell key={i} fill={d.fill} style={{ filter: `url(#bar-glow-${i})` }} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Session cost hero — glowing cost display */}
        {sessionCost && (sessionCost.costUsd > 0 || sessionCost.callCount > 0) && (
          <div className="mt-3 relative overflow-hidden rounded-xl border border-indigo-400/10">
            <div className="absolute inset-0 opacity-50 pointer-events-none"
              style={{ background: 'linear-gradient(135deg, rgba(129,140,248,0.08) 0%, rgba(232,121,249,0.06) 50%, rgba(34,211,238,0.04) 100%)' }} />
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-20 blur-2xl pointer-events-none"
              style={{ background: 'radial-gradient(circle, #818cf8, transparent)' }} />
            <div className="relative p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(129,140,248,0.2), rgba(232,121,249,0.15))',
                    border: '1px solid rgba(129,140,248,0.2)',
                    boxShadow: '0 0 20px -4px rgba(129,140,248,0.3), inset 0 0 12px -4px rgba(129,140,248,0.15)',
                  }}>
                  <DollarSign size={16} className="text-indigo-300" />
                </div>
                <div>
                  <div className="text-lg font-bold text-white/90"
                    style={{ textShadow: '0 0 20px rgba(129,140,248,0.3)' }}>
                    {formatCost(sessionCost.costUsd)}
                  </div>
                  <div className="text-[10px] text-white/35">session cost · {sessionCost.callCount} calls</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-white/70">{formatTokens(sessionCost.totalTokens)}</div>
                <div className="text-[10px] text-white/30">total tokens</div>
              </div>
            </div>
          </div>
        )}

        {/* Cumulative stats */}
        {cumulativeCost && (cumulativeCost.totalTokens || 0) > 0 && (
          <div className="mt-3 p-2.5 rounded-xl border border-white/[0.05]" style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(129,140,248,0.03) 100%)',
          }}>
            <div className="text-[10px] text-white/25 mb-1.5">All-Time Cumulative</div>
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              <div>
                <div className="text-white/30">Tokens</div>
                <div className="text-white/70 font-medium">{formatTokens(cumulativeCost.totalTokens)}</div>
              </div>
              <div>
                <div className="text-white/30">Cost</div>
                <div className="text-white/70 font-medium">{formatCost(cumulativeCost.costUsd)}</div>
              </div>
              <div>
                <div className="text-white/30">API Calls</div>
                <div className="text-white/70 font-medium">{cumulativeCost.callCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-white/30">First Seen</div>
                <div className="text-white/70 font-medium">
                  {cumulativeCost.firstSeen ? new Date(cumulativeCost.firstSeen * 1000).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Tool Usage section */}
      <Section title="Tool Usage" icon={Wrench} color="#f97316" badge={toolSummary?.totalCalls}>
        {/* Horizontal tool summary strip */}
        {toolSummary?.byTool && Object.keys(toolSummary.byTool).length > 0 ? (
          <ToolSummaryStrip byTool={toolSummary.byTool} />
        ) : (
          <div className="text-[10px] text-white/25 py-4 text-center">No tool calls recorded</div>
        )}

        {/* Horizontal event timeline */}
        {(stats?.toolHistory?.length || 0) > 0 && (
          <ToolTimeline events={stats!.toolHistory!.slice(0, 60)} />
        )}

        {/* Quick stats row */}
        {toolSummary && toolSummary.totalCalls > 0 && (
          <div className="flex items-center gap-3 mt-2 px-1">
            <span className="text-[9px] text-white/25">{toolSummary.totalCalls} calls</span>
            <span className="text-[9px] text-white/15">·</span>
            <span className="text-[9px] text-white/25">{toolSummary.uniqueTools} tools</span>
            {toolSummary.errorCount > 0 && (
              <>
                <span className="text-[9px] text-white/15">·</span>
                <span className="text-[9px] text-red-400/40">{toolSummary.errorCount} failed</span>
              </>
            )}
          </div>
        )}
      </Section>

      {/* Subagent Activity */}
      <Section title="Subagent Activity" icon={Bot} color="#e879f9" badge={subagents?.totalSpawned} defaultOpen={!!subagents?.totalSpawned}>
        {/* Active subagents */}
        {(stats?.activeSubagents?.length || 0) > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-white/30 mb-1">Active Now</div>
            <div className="space-y-1">
              {stats!.activeSubagents!.map((sa) => (
                <div key={sa.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-purple-500/[0.06] border border-purple-400/10">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-white/60 font-medium truncate">{sa.name}</div>
                    <div className="text-[9px] text-white/30 truncate">{sa.message}</div>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300/70 shrink-0">
                    {sa.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary stats */}
        {subagents && subagents.totalSpawned > 0 ? (
          <div className="mt-2 grid grid-cols-4 gap-2 text-[10px]">
            <div>
              <div className="text-white/30">Spawned</div>
              <div className="text-white/70 font-medium">{subagents.totalSpawned}</div>
            </div>
            <div>
              <div className="text-white/30">Completed</div>
              <div className="text-white/70 font-medium">{subagents.totalCompleted}</div>
            </div>
            <div>
              <div className="text-green-400/50">Success</div>
              <div className="text-green-400/70 font-medium">{subagents.successCount}</div>
            </div>
            <div>
              <div className="text-red-400/50">Failed</div>
              <div className="text-red-400/70 font-medium">{subagents.failCount}</div>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-white/25 py-3 text-center mt-1">No subagent activity</div>
        )}

        {/* Subagent spawn history */}
        {(subagents?.spawned?.length || 0) > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-white/25 mb-1">Spawn History</div>
            <div className="max-h-[120px] overflow-y-auto space-y-0.5">
              {subagents!.spawned.slice(0, 20).map((ev, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] py-0.5 px-1 rounded hover:bg-white/[0.02]">
                  <span className="text-white/20 font-mono w-[60px] shrink-0">{formatTime(ev.ts)}</span>
                  <span className="text-purple-300/60 truncate">{(ev.data?.name as string) || 'subagent'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Event Summary */}
      <Section title="Event Summary" icon={Zap} color="#facc15" badge={stats?.eventSummary?.totalEvents}>
        {eventTypeData.length > 0 ? (
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={Math.max(100, eventTypeData.length * 22)}>
              <BarChart data={eventTypeData} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
                  {eventTypeData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-[10px] text-white/25 py-3 text-center">No events recorded today</div>
        )}

        {/* Event dates */}
        {(stats?.eventDates?.length || 0) > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-[9px] text-white/20">Log dates:</span>
            {stats!.eventDates!.slice(-7).map((d) => (
              <span key={d} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/30">{d}</span>
            ))}
          </div>
        )}
      </Section>

      {/* Errors section */}
      {(stats?.errors?.length || 0) > 0 && (
        <Section title="Errors & Failures" icon={AlertTriangle} color="#fb7185" badge={stats?.errors?.length} defaultOpen={false}>
          <div className="mt-2 max-h-[200px] overflow-y-auto space-y-1">
            {stats!.errors!.slice(0, 25).map((ev, i) => (
              <div key={i} className="p-1.5 rounded-lg bg-red-500/[0.04] border border-red-400/10 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-white/20 font-mono">{formatTime(ev.ts)}</span>
                  <span className="text-red-400/60 font-medium">{ev.event.replace(/_/g, ' ')}</span>
                </div>
                {ev.data?.error ? (
                  <div className="text-white/30 mt-0.5 truncate">{String(ev.data.error)}</div>
                ) : null}
                {ev.data?.name ? (
                  <div className="text-white/25 mt-0.5">Tool: {String(ev.data.name)}</div>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Sessions overview */}
      {stats?.sessionsOverview && stats.sessionsOverview.total > 0 && (
        <Section title="Sessions" icon={Activity} color="#34d399" badge={stats.sessionsOverview.total} defaultOpen={false}>
          <div className="mt-2 space-y-1">
            {stats.sessionsOverview.sessions.slice(0, 10).map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-0.5 px-1 rounded hover:bg-white/[0.02]">
                <span className="text-white/50 font-medium truncate">{String(s.key || s.session_key || s.id || `session-${i}`)}</span>
                <span className="text-white/20 ml-auto shrink-0">{String(s.type || s.kind || '')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
