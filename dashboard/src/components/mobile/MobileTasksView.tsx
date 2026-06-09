/**
 * MobileTasksView — Phone-optimized task list.
 * Shows tasks as vertical cards grouped by status, with swipe-friendly interactions.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Check, Clock, AlertTriangle, ChevronDown, ChevronRight, ChevronLeft,
  Zap, Calendar, Repeat, Coffee, Trash2, User, Bot, Filter, Cpu, Pencil, Save, X,
} from 'lucide-react';
import { CircuitsView } from '@/components/CircuitsView';

// ── Types (mirror KanbanBoard) ──
type TaskOwner = 'human' | 'agent';
type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
type TaskSchedule = 'immediate' | 'scheduled' | 'recurring' | 'whenever';
type TaskColumn = 'backlog' | 'in_progress' | 'done';

interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  owner: TaskOwner;
  priority: TaskPriority;
  schedule: TaskSchedule;
  column: TaskColumn;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  dueDate?: string;
  progress?: number;
  statusNote?: string;
  channel?: string;
}

// ── Media Suite types ──
interface MediaSuiteItem {
  id: string | number;
  title: string;
  description?: string;
  content_type?: string;
  status: string;
  scheduled_date?: string;
  created_at?: string;
  updated_at?: string;
  workspace_id?: string | number;
}

interface MsWorkspace {
  id: string;
  name: string;
  is_main?: boolean;
}

function mapMsStatus(s: string): TaskColumn {
  switch (s) {
    case 'posted': case 'done': case 'published': return 'done';
    case 'research': case 'scripting': case 'shooting': case 'editing': case 'scheduled': case 'in_progress': return 'in_progress';
    case 'idea': case 'not_started': default: return 'backlog';
  }
}

function msItemToTask(item: MediaSuiteItem, channelName?: string): KanbanTask {
  return {
    id: `ms:${item.id}`,
    title: item.title,
    description: item.description || undefined,
    owner: 'human',
    priority: 'medium',
    schedule: item.scheduled_date ? 'scheduled' : 'whenever',
    column: mapMsStatus(item.status),
    createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
    updatedAt: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
    dueDate: item.scheduled_date || undefined,
    channel: channelName,
  };
}

// ── Config ──
const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'text-red-400', dot: 'bg-red-400' },
  high: { label: 'High', color: 'text-orange-400', dot: 'bg-orange-400' },
  medium: { label: 'Medium', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  low: { label: 'Low', color: 'text-white/40', dot: 'bg-white/30' },
};

const SCHEDULE_ICONS: Record<TaskSchedule, typeof Zap> = {
  immediate: Zap,
  scheduled: Calendar,
  recurring: Repeat,
  whenever: Coffee,
};

const TABS: { key: TaskColumn; label: string; icon: typeof Clock }[] = [
  { key: 'in_progress', label: 'Active', icon: Clock },
  { key: 'backlog', label: 'Backlog', icon: AlertTriangle },
  { key: 'done', label: 'Done', icon: Check },
];

// ── API (matches KanbanBoard's API pattern) ──
async function fetchTasks(): Promise<KanbanTask[]> {
  try {
    const r = await fetch('/api/local/tasks');
    if (!r.ok) return [];
    const d = await r.json();
    return d.tasks || [];
  } catch { return []; }
}

async function apiUpsertTask(task: KanbanTask) {
  try {
    await fetch('/api/local/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', task }),
    });
  } catch { /* */ }
}

async function apiDeleteTask(taskId: string) {
  try {
    await fetch('/api/local/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', taskId }),
    });
  } catch { /* */ }
}

type TaskViewMode = 'list' | 'calendar' | 'circuits';

export function MobileTasksView() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [msTasks, setMsTasks] = useState<KanbanTask[]>([]);
  const [channelNames, setChannelNames] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TaskColumn>('in_progress');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<KanbanTask>>({});
  const [calMonth, setCalMonth] = useState(() => new Date());

  // Load local tasks
  useEffect(() => {
    fetchTasks().then(setTasks);
  }, []);

  // Load Media Suite items (same as desktop KanbanBoard)
  useEffect(() => {
    let wsMap: Record<string, string> = {};
    let mainName: string | undefined;

    fetch('/api/media-suite/workspaces')
      .then(r => r.ok ? r.json() : [])
      .then((workspaces: MsWorkspace[]) => {
        const names: string[] = [];
        for (const ws of workspaces) { wsMap[String(ws.id)] = ws.name; names.push(ws.name); }
        setChannelNames(names);
        const main = workspaces.find(ws => ws.is_main);
        mainName = main?.name || (workspaces.length > 0 ? workspaces[0].name : undefined);
        return fetch('/api/media-suite/media-items');
      })
      .then(r => r.ok ? r.json() : [])
      .then((items: MediaSuiteItem[]) => {
        const mapped = items.map(item => {
          const chName = item.workspace_id ? wsMap[String(item.workspace_id)] : mainName;
          return msItemToTask(item, chName);
        });
        setMsTasks(mapped);
      })
      .catch(() => {});
  }, []);

  // Merge local tasks + media suite tasks (same as desktop)
  const allTasks = [...tasks, ...msTasks];

  // Apply channel filter
  const channelFiltered = channelFilter === 'all'
    ? allTasks
    : allTasks.filter(t => t.channel === channelFilter);

  const filtered = channelFiltered
    .filter(t => t.column === activeTab)
    .sort((a, b) => {
      const po = { critical: 0, high: 1, medium: 2, low: 3 };
      return po[a.priority] - po[b.priority] || b.createdAt - a.createdAt;
    });

  // Calendar data
  const calYear = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const calMonthName = calMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
  const firstDay = new Date(calYear, calMo, 1).getDay();
  const daysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();

  const tasksByDate = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    for (const t of channelFiltered) {
      if (t.dueDate) {
        if (!map[t.dueDate]) map[t.dueDate] = [];
        map[t.dueDate].push(t);
      }
    }
    return map;
  }, [channelFiltered]);

  const addTask = useCallback(() => {
    if (!newTitle.trim()) return;
    const task: KanbanTask = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: newTitle.trim(),
      owner: 'human',
      priority: 'medium',
      schedule: 'whenever',
      column: 'backlog',
      createdAt: Date.now(),
      channel: newChannel || undefined,
    };
    setTasks(prev => [...prev, task]);
    apiUpsertTask(task);
    setNewTitle('');
    setNewChannel('');
    setAdding(false);
  }, [newTitle, newChannel]);

  const moveTask = useCallback((id: string, to: TaskColumn) => {
    if (id.startsWith('ms:')) {
      // Media Suite item — update via media-suite API
      const msId = id.replace(/^ms:/, '');
      const statusMap: Record<TaskColumn, string> = { done: 'posted', in_progress: 'in_progress', backlog: 'not_started' };
      fetch(`/api/media-suite/media-items/${msId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusMap[to] }),
      }).catch(() => {});
      setMsTasks(prev => prev.map(t => t.id === id ? { ...t, column: to, updatedAt: Date.now() } : t));
    } else {
      setTasks(prev => prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, column: to, updatedAt: Date.now(), ...(to === 'done' ? { completedAt: Date.now() } : {}) };
        apiUpsertTask(updated);
        return updated;
      }));
    }
  }, []);

  const startEditing = useCallback((task: KanbanTask) => {
    setEditingId(task.id);
    setEditDraft({ title: task.title, description: task.description || '', priority: task.priority, schedule: task.schedule, dueDate: task.dueDate || '', owner: task.owner, progress: task.progress ?? 0, statusNote: task.statusNote || '', channel: task.channel || '' });
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    if (editingId.startsWith('ms:')) {
      const msId = editingId.replace(/^ms:/, '');
      const body: Record<string, unknown> = {};
      if (editDraft.title) body.title = editDraft.title;
      if (editDraft.description !== undefined) body.description = editDraft.description;
      if (editDraft.dueDate !== undefined) body.scheduled_date = editDraft.dueDate || null;
      fetch(`/api/media-suite/media-items/${msId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
      setMsTasks(prev => prev.map(t => t.id === editingId ? { ...t, ...editDraft, updatedAt: Date.now() } : t));
    } else {
      setTasks(prev => prev.map(t => {
        if (t.id !== editingId) return t;
        const updated = { ...t, ...editDraft, updatedAt: Date.now() };
        apiUpsertTask(updated as KanbanTask);
        return updated as KanbanTask;
      }));
    }
    setEditingId(null);
    setEditDraft({});
  }, [editingId, editDraft]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft({});
  }, []);

  const deleteTask = useCallback((id: string) => {
    if (id.startsWith('ms:')) {
      const msId = id.replace(/^ms:/, '');
      fetch(`/api/media-suite/media-items/${msId}`, { method: 'DELETE' }).catch(() => {});
      setMsTasks(prev => prev.filter(t => t.id !== id));
    } else {
      setTasks(prev => prev.filter(t => t.id !== id));
      apiDeleteTask(id);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Tab bar + view toggle */}
      <div className="flex items-center border-b border-white/[0.06] px-2">
        {TABS.map(tab => {
          const count = channelFiltered.filter(t => t.column === tab.key).length;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'border-indigo-400 text-white/80'
                  : 'border-transparent text-white/35'
              }`}
            >
              <Icon size={13} />
              {tab.label}
              {count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/[0.08] text-[9px] text-white/40">{count}</span>
              )}
            </button>
          );
        })}
        {/* Calendar toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'calendar' ? 'list' : 'calendar')}
          className={`shrink-0 px-2.5 py-2 border-b-2 ${viewMode === 'calendar' ? 'border-indigo-400 text-white/70' : 'border-transparent text-white/30'}`}
        >
          <Calendar size={14} />
        </button>
        {/* Circuits toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'circuits' ? 'list' : 'circuits')}
          className={`shrink-0 px-2.5 py-2 border-b-2 ${viewMode === 'circuits' ? 'border-indigo-400 text-white/70' : 'border-transparent text-white/30'}`}
        >
          <Cpu size={14} />
        </button>
      </div>

      {/* Channel filter bar */}
      {channelNames.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.04] overflow-x-auto no-scrollbar">
          <Filter size={10} className="text-white/20 shrink-0" />
          <button
            onClick={() => setChannelFilter('all')}
            className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-medium ${channelFilter === 'all' ? 'bg-white/[0.08] text-white/70' : 'text-white/30'}`}
          >All</button>
          {channelNames.map(ch => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap ${channelFilter === ch ? 'bg-teal-500/15 text-teal-300' : 'text-white/30'}`}
            >{ch}</button>
          ))}
        </div>
      )}

      {/* ═══ CALENDAR VIEW ═══ */}
      {viewMode === 'calendar' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {/* Month nav */}
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))} className="p-1 text-white/30"><ChevronLeft size={14} /></button>
            <span className="text-[12px] font-medium text-white/60 flex-1 text-center">{calMonthName}</span>
            <button onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))} className="p-1 text-white/30"><ChevronRight size={14} /></button>
          </div>
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-1">
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <div key={i} className="text-[8px] text-white/25 text-center font-bold">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dateKey = `${calYear}-${String(calMo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const dayTasks = tasksByDate[dateKey] || [];
              const isToday = dateKey === todayStr;
              return (
                <div key={dateKey} className={`min-h-[42px] rounded p-0.5 ${isToday ? 'bg-indigo-500/10 border border-indigo-400/20' : 'bg-white/[0.015]'}`}>
                  <div className={`text-[8px] font-medium ${isToday ? 'text-indigo-300' : 'text-white/30'}`}>{day}</div>
                  {dayTasks.slice(0, 2).map(t => (
                    <div key={t.id} className="text-[7px] text-white/50 truncate px-0.5 rounded bg-white/[0.04] mt-0.5">{t.title}</div>
                  ))}
                  {dayTasks.length > 2 && <div className="text-[7px] text-white/20 px-0.5">+{dayTasks.length - 2}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ CIRCUITS VIEW ═══ */}
      {viewMode === 'circuits' && (
        <div className="flex-1 overflow-y-auto">
          <CircuitsView />
        </div>
      )}

      {/* ═══ LIST VIEW ═══ */}
      {viewMode === 'list' && (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {filtered.length === 0 && !adding && (
              <div className="flex flex-col items-center justify-center h-32 text-white/25 text-xs">
                <Check size={20} className="mb-2 opacity-40" />
                No tasks in {TABS.find(t => t.key === activeTab)?.label}
              </div>
            )}

            {filtered.map(task => {
              const pri = PRIORITY_CONFIG[task.priority];
              const SchedIcon = SCHEDULE_ICONS[task.schedule];
              const expanded = expandedId === task.id;
              const isOverdue = task.dueDate && new Date(task.dueDate).getTime() < Date.now() && task.column !== 'done';

              return (
                <div
                  key={task.id}
                  className={`rounded-xl border overflow-hidden ${isOverdue ? 'border-red-400/20 bg-red-500/[0.03]' : 'border-white/[0.06] bg-white/[0.03]'}`}
                >
                  {/* Main row */}
                  <button
                    onClick={() => setExpandedId(expanded ? null : task.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 ${pri.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-white/80 truncate">{task.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.channel && (
                          <span className="text-[9px] text-teal-400/50">{task.channel}</span>
                        )}
                        {task.dueDate && (
                          <span className={`text-[9px] flex items-center gap-0.5 ${isOverdue ? 'text-red-400/60' : 'text-white/25'}`}>
                            <Clock size={8} />{task.dueDate}
                          </span>
                        )}
                        {task.statusNote && !task.channel && !task.dueDate && (
                          <span className="text-[9px] text-white/30">{task.statusNote}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {task.owner === 'agent' ? (
                        <Bot size={11} className="text-indigo-400/50" />
                      ) : (
                        <User size={11} className="text-white/25" />
                      )}
                      <SchedIcon size={10} className="text-white/20" />
                      {expanded ? <ChevronDown size={12} className="text-white/20" /> : <ChevronRight size={12} className="text-white/20" />}
                    </div>
                  </button>

                  {/* Expanded actions */}
                  {expanded && editingId === task.id && (
                    <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] space-y-2.5">
                      {/* Title */}
                      <input
                        value={editDraft.title || ''}
                        onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                        className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[12px] text-white/80 outline-none focus:border-indigo-400/30"
                        placeholder="Title"
                      />
                      {/* Description */}
                      <textarea
                        value={editDraft.description || ''}
                        onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                        rows={2}
                        className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[11px] text-white/60 outline-none focus:border-indigo-400/30 resize-none"
                        placeholder="Description (optional)"
                      />
                      {/* Priority + Schedule row */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <div className="text-[9px] text-white/25 mb-1">Priority</div>
                          <div className="flex gap-1">
                            {(['critical','high','medium','low'] as TaskPriority[]).map(p => (
                              <button key={p} onClick={() => setEditDraft(d => ({ ...d, priority: p }))}
                                className={`flex-1 py-1 rounded text-[9px] font-medium ${editDraft.priority === p ? `${PRIORITY_CONFIG[p].dot} text-black/80` : 'bg-white/[0.04] text-white/30'}`}
                              >{PRIORITY_CONFIG[p].label[0]}</button>
                            ))}
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] text-white/25 mb-1">Schedule</div>
                          <div className="flex gap-1">
                            {(['immediate','scheduled','recurring','whenever'] as TaskSchedule[]).map(s => {
                              const SIcon = SCHEDULE_ICONS[s];
                              return (
                                <button key={s} onClick={() => setEditDraft(d => ({ ...d, schedule: s }))}
                                  className={`flex-1 py-1 rounded flex items-center justify-center ${editDraft.schedule === s ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/[0.04] text-white/25'}`}
                                ><SIcon size={10} /></button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      {/* Owner + Due date row */}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <div className="text-[9px] text-white/25 mb-1">Owner</div>
                          <div className="flex gap-1">
                            <button onClick={() => setEditDraft(d => ({ ...d, owner: 'human' }))}
                              className={`flex-1 py-1 rounded text-[9px] flex items-center justify-center gap-1 ${editDraft.owner === 'human' ? 'bg-white/[0.08] text-white/70' : 'bg-white/[0.04] text-white/25'}`}
                            ><User size={9} />Me</button>
                            <button onClick={() => setEditDraft(d => ({ ...d, owner: 'agent' }))}
                              className={`flex-1 py-1 rounded text-[9px] flex items-center justify-center gap-1 ${editDraft.owner === 'agent' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/[0.04] text-white/25'}`}
                            ><Bot size={9} />Agent</button>
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] text-white/25 mb-1">Due date</div>
                          <input type="date"
                            value={editDraft.dueDate || ''}
                            onChange={e => setEditDraft(d => ({ ...d, dueDate: e.target.value }))}
                            className="w-full bg-black/20 border border-white/[0.08] rounded px-2 py-1 text-[10px] text-white/60 outline-none"
                          />
                        </div>
                      </div>
                      {/* Progress slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-white/25">Progress</span>
                          <span className="text-[9px] text-white/40">{editDraft.progress ?? 0}%</span>
                        </div>
                        <input type="range" min={0} max={100} step={5}
                          value={editDraft.progress ?? 0}
                          onChange={e => setEditDraft(d => ({ ...d, progress: Number(e.target.value) }))}
                          className="w-full h-1.5 accent-indigo-400"
                        />
                      </div>
                      {/* Status note */}
                      <input
                        value={editDraft.statusNote || ''}
                        onChange={e => setEditDraft(d => ({ ...d, statusNote: e.target.value }))}
                        className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[10px] text-white/50 outline-none focus:border-indigo-400/30"
                        placeholder="Status note (optional)"
                      />
                      {/* Save / Cancel */}
                      <div className="flex gap-2">
                        <button onClick={saveEdit}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/25 text-[10px] text-indigo-300 font-medium"
                        ><Save size={10} />Save</button>
                        <button onClick={cancelEdit}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/40 font-medium"
                        ><X size={10} />Cancel</button>
                      </div>
                    </div>
                  )}
                  {expanded && editingId !== task.id && (
                    <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] space-y-2">
                      {task.description && (
                        <p className="text-[11px] text-white/40 leading-relaxed">{task.description}</p>
                      )}
                      {task.statusNote && (
                        <p className="text-[10px] text-white/30 italic">{task.statusNote}</p>
                      )}
                      {task.progress != null && task.progress > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full rounded-full bg-indigo-400/50" style={{ width: `${task.progress}%` }} />
                          </div>
                          <span className="text-[9px] text-white/30">{task.progress}%</span>
                        </div>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => startEditing(task)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-400/20 text-[10px] text-indigo-300/70 font-medium"
                        ><Pencil size={10} />Edit</button>
                        {task.column !== 'in_progress' && (
                          <button
                            onClick={() => moveTask(task.id, 'in_progress')}
                            className="flex-1 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/20 text-[10px] text-amber-300/70 font-medium"
                          >Start</button>
                        )}
                        {task.column !== 'done' && (
                          <button
                            onClick={() => moveTask(task.id, 'done')}
                            className="flex-1 py-1.5 rounded-lg bg-green-500/10 border border-green-400/20 text-[10px] text-green-300/70 font-medium"
                          >Done</button>
                        )}
                        {task.column === 'done' && (
                          <button
                            onClick={() => moveTask(task.id, 'backlog')}
                            className="flex-1 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/40 font-medium"
                          >Reopen</button>
                        )}
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="w-8 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 flex items-center justify-center"
                        >
                          <Trash2 size={11} className="text-red-400/60" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add task inline */}
            {adding && (
              <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-3 space-y-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') setAdding(false); }}
                  placeholder="Task title..."
                  className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/25 outline-none"
                />
                {/* Channel selector in add form */}
                {channelNames.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <span className="text-[9px] text-white/25 shrink-0">Channel:</span>
                    <button
                      onClick={() => setNewChannel('')}
                      className={`shrink-0 px-2 py-0.5 rounded text-[9px] ${!newChannel ? 'bg-white/[0.08] text-white/60' : 'text-white/25'}`}
                    >None</button>
                    {channelNames.map(ch => (
                      <button
                        key={ch}
                        onClick={() => setNewChannel(ch)}
                        className={`shrink-0 px-2 py-0.5 rounded text-[9px] whitespace-nowrap ${newChannel === ch ? 'bg-teal-500/15 text-teal-300' : 'text-white/25'}`}
                      >{ch}</button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={addTask} className="flex-1 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/25 text-[10px] text-indigo-300 font-medium">
                    Add
                  </button>
                  <button onClick={() => { setAdding(false); setNewTitle(''); setNewChannel(''); }} className="flex-1 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/40 font-medium">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Add button */}
          {!adding && (
            <div className="px-3 pb-3">
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-all text-xs font-medium"
              >
                <Plus size={14} />
                Add Task
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
