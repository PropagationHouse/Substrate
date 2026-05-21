/**
 * KanbanBoard — Full-featured Notion-style task board with glassmorphic styling.
 *
 * Features:
 * - Server-backed persistence (data/tasks.json via API)
 * - Notion bidirectional sync (pull/push)
 * - Human vs Agent task delineation
 * - Full inline editing: title, description, due dates, recurring config, progress, status notes
 * - Priority: critical/high/medium/low · Schedule: immediate/scheduled/recurring/whenever
 * - Drag-and-drop between columns · Completion timestamps
 * - Agent context endpoint for organic awareness
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Plus, User, Bot, Repeat, Zap, Coffee, Trash2, Calendar,
  Edit3, Check, X, ChevronDown, ChevronRight, ExternalLink,
  RefreshCw, Link2, AlertTriangle, Clock, MessageSquare,
  ChevronLeft, LayoutGrid,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────
export type TaskOwner = 'human' | 'agent';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskSchedule = 'immediate' | 'scheduled' | 'recurring' | 'whenever';
export type TaskColumn = 'backlog' | 'in_progress' | 'done';

export interface RecurringConfig {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  dayOfWeek?: number;   // 0-6 for weekly
  dayOfMonth?: number;  // 1-31 for monthly
  nextDue?: string;     // ISO date
}

export interface KanbanTask {
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
  progress?: number;         // 0-100
  statusNote?: string;       // agent or human status update
  recurringConfig?: RecurringConfig;
  notionId?: string;
  notionUrl?: string;
  channel?: string;          // workspace/channel name (e.g. 'MILLET')
}

// ── Constants ────────────────────────────────────────────────────────
const COLUMNS: { key: TaskColumn; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: 'text-white/40' },
  { key: 'in_progress', label: 'In Progress', color: 'text-amber-400/70' },
  { key: 'done', label: 'Done', color: 'text-green-400/70' },
];

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'text-red-400', dot: 'bg-red-400' },
  high:     { label: 'High', color: 'text-orange-400', dot: 'bg-orange-400' },
  medium:   { label: 'Medium', color: 'text-yellow-400', dot: 'bg-yellow-400' },
  low:      { label: 'Low', color: 'text-white/40', dot: 'bg-white/30' },
};

const SCHEDULE_CONFIG: Record<TaskSchedule, { label: string; icon: typeof Zap }> = {
  immediate: { label: 'Immediate', icon: Zap },
  scheduled: { label: 'Scheduled', icon: Calendar },
  recurring: { label: 'Recurring', icon: Repeat },
  whenever:  { label: 'Whenever', icon: Coffee },
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SCHEDULE_ORDER: Record<TaskSchedule, number> = { immediate: 0, scheduled: 1, recurring: 2, whenever: 3 };

// ── API helpers ──────────────────────────────────────────────────────
async function apiFetchTasks(): Promise<{ tasks: KanbanTask[]; notionDatabaseId?: string }> {
  try {
    const r = await fetch('/api/local/tasks');
    const d = await r.json();
    return { tasks: d.tasks || [], notionDatabaseId: d.notionDatabaseId };
  } catch { return { tasks: [] }; }
}

async function apiSaveTasks(tasks: KanbanTask[]) {
  try { await fetch('/api/local/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', tasks }) }); } catch { /* ignore */ }
}

async function apiUpsertTask(task: KanbanTask) {
  try { await fetch('/api/local/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', task }) }); } catch { /* ignore */ }
}

async function apiDeleteTask(taskId: string) {
  try { await fetch('/api/local/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', taskId }) }); } catch { /* ignore */ }
}

async function notionListDatabases(): Promise<Array<{ id: string; title: string; url: string }>> {
  try {
    const r = await fetch('/api/local/notion/databases');
    const d = await r.json();
    return d.databases || [];
  } catch { return []; }
}

async function notionLinkDatabase(databaseId: string) {
  try { await fetch('/api/local/notion/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ databaseId }) }); } catch { /* ignore */ }
}

async function notionPull(): Promise<{ pulled: number; tasks: KanbanTask[] }> {
  try {
    const r = await fetch('/api/local/notion/pull');
    const d = await r.json();
    return { pulled: d.pulled || 0, tasks: d.tasks || [] };
  } catch { return { pulled: 0, tasks: [] }; }
}

async function notionPushTask(task: KanbanTask): Promise<{ ok: boolean; notionId?: string; notionUrl?: string }> {
  try {
    const r = await fetch('/api/local/notion/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) });
    return await r.json();
  } catch { return { ok: false }; }
}

// ── Media Suite helpers ──────────────────────────────────────────────
interface MediaSuiteItem {
  id: string | number;
  title: string;
  description?: string;
  content_type?: string;
  status: string;
  scheduled_date?: string;
  created_at?: string;
  updated_at?: string;
  workspace_id?: number | string;
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

// ── Owner filter ─────────────────────────────────────────────────────
type OwnerFilter = 'all' | 'human' | 'agent' | 'media-suite' | string;
type ViewMode = 'board' | 'calendar' | 'settings';

interface MsWorkspace {
  id: string;
  name: string;
  is_main?: boolean;
}

// ── Media Suite API helpers ──────────────────────────────────────────
function msRealId(taskId: string) { return taskId.replace(/^ms:/, ''); }

async function msDeleteItem(msId: string) {
  try { await fetch(`/api/media-suite/media-items/${msId}`, { method: 'DELETE' }); } catch { /* ignore */ }
}

async function msUpdateItem(msId: string, updates: Record<string, unknown>) {
  try { await fetch(`/api/media-suite/media-items/${msId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }); } catch { /* ignore */ }
}

function reverseMapStatus(col: TaskColumn): string {
  switch (col) {
    case 'done': return 'posted';
    case 'in_progress': return 'in_progress';
    case 'backlog': default: return 'not_started';
  }
}

// ── Main Component ───────────────────────────────────────────────────
export function KanbanBoard() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [filter, setFilter] = useState<OwnerFilter>('all');
  const [addingTo, setAddingTo] = useState<TaskColumn | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskColumn | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [notionDbId, setNotionDbId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msTasks, setMsTasks] = useState<KanbanTask[]>([]);
  const [msWorkspaces, setMsWorkspaces] = useState<MsWorkspace[]>([]);

  // Load from server on mount
  useEffect(() => {
    apiFetchTasks().then(d => {
      setTasks(d.tasks);
      if (d.notionDatabaseId) setNotionDbId(d.notionDatabaseId);
      setLoaded(true);
    });
  }, []);

  // Fetch ALL Media Suite workspaces on mount — each becomes a channel
  useEffect(() => {
    fetch('/api/media-suite/workspaces')
      .then(r => r.ok ? r.json() : [])
      .then((ws: MsWorkspace[]) => {
        setMsWorkspaces(ws);
      })
      .catch(() => {});
  }, []);

  // Build workspace_id → name mapping for channel tagging
  const wsIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ws of msWorkspaces) map[String(ws.id)] = ws.name;
    return map;
  }, [msWorkspaces]);

  // Fetch ALL Media Suite tasks (no workspace filter) — tag each with channel name
  const refreshMsTasks = useCallback(() => {
    fetch('/api/media-suite/media-items')
      .then(r => r.ok ? r.json() : [])
      .then((items: MediaSuiteItem[]) => {
        const mapped = items.map(item => {
          const chName = item.workspace_id ? wsIdToName[String(item.workspace_id)] : undefined;
          return msItemToTask(item, chName);
        });
        console.log('[KanbanBoard] Media Suite items:', mapped.length, 'channels:', Object.keys(wsIdToName));
        setMsTasks(mapped);
      })
      .catch((err) => console.warn('[KanbanBoard] MS fetch error:', err));
  }, [wsIdToName]);

  // Fetch Media Suite tasks on mount + poll every 10s
  useEffect(() => {
    refreshMsTasks();
    const iv = setInterval(refreshMsTasks, 10_000);
    return () => clearInterval(iv);
  }, [refreshMsTasks]);

  // Auto-save to server when tasks change (debounced)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => { apiSaveTasks(tasks); }, 500);
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
  }, [tasks, loaded]);

  // ── Task operations ──────────────────────────────────────────────
  const addTask = useCallback((task: Partial<KanbanTask> & { title: string; column: TaskColumn }) => {
    const newTask: KanbanTask = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      owner: 'human',
      priority: 'medium',
      schedule: 'whenever',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...task,
    };
    setTasks(prev => [...prev, newTask]);
    setAddingTo(null);
    apiUpsertTask(newTask);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<KanbanTask>) => {
    // Media Suite task — update via Flask API, then refresh
    if (taskId.startsWith('ms:')) {
      const flaskUpdates: Record<string, unknown> = {};
      if (updates.column) flaskUpdates.status = reverseMapStatus(updates.column);
      if (updates.title) flaskUpdates.title = updates.title;
      if (updates.description !== undefined) flaskUpdates.description = updates.description;
      if (updates.dueDate !== undefined) flaskUpdates.scheduled_date = updates.dueDate || null;
      msUpdateItem(msRealId(taskId), flaskUpdates).then(refreshMsTasks);
      // Optimistic local update
      setMsTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t));
      return;
    }
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const updated = { ...t, ...updates, updatedAt: Date.now() };
      // When moved to done, stamp completedAt
      if (updates.column === 'done' && t.column !== 'done') updated.completedAt = Date.now();
      // When moved out of done, clear completedAt
      if (updates.column && updates.column !== 'done' && t.column === 'done') updated.completedAt = undefined;
      return updated;
    }));
  }, [refreshMsTasks]);

  const deleteTask = useCallback((taskId: string) => {
    // Media Suite task — delete via Flask API, then refresh
    if (taskId.startsWith('ms:')) {
      setMsTasks(prev => prev.filter(t => t.id !== taskId));
      msDeleteItem(msRealId(taskId)).then(refreshMsTasks);
      return;
    }
    setTasks(prev => prev.filter(t => t.id !== taskId));
    apiDeleteTask(taskId);
  }, [refreshMsTasks]);

  // ── Notion sync ──────────────────────────────────────────────────
  const handleNotionPull = useCallback(async () => {
    setSyncing(true);
    setSyncMsg('Pulling from Notion…');
    const result = await notionPull();
    setTasks(result.tasks);
    setSyncMsg(`Pulled ${result.pulled} task(s) from Notion`);
    setSyncing(false);
    setTimeout(() => setSyncMsg(''), 3000);
  }, []);

  const handleNotionPush = useCallback(async (task: KanbanTask) => {
    setSyncing(true);
    setSyncMsg('Pushing to Notion…');
    const result = await notionPushTask(task);
    if (result.ok && result.notionId) {
      updateTask(task.id, { notionId: result.notionId, notionUrl: result.notionUrl });
    }
    setSyncMsg(result.ok ? 'Pushed to Notion' : 'Push failed');
    setSyncing(false);
    setTimeout(() => setSyncMsg(''), 3000);
  }, [updateTask]);

  // ── Channel names derived from workspaces ──────────────────────────
  const channelNames = useMemo(() => msWorkspaces.map(ws => ws.name), [msWorkspaces]);

  // ── Filtering & sorting ──────────────────────────────────────────
  const allTasks = useMemo(() => [...tasks, ...msTasks], [tasks, msTasks]);
  const filteredTasks = useMemo(() => {
    if (filter === 'all') return allTasks;
    if (filter === 'media-suite') return msTasks;
    if (filter === 'human') return tasks.filter(t => t.owner === 'human');
    if (filter === 'agent') return tasks.filter(t => t.owner === 'agent');
    // Channel filter — match by channel name
    return allTasks.filter(t => t.channel === filter);
  }, [allTasks, tasks, msTasks, filter]);

  const sortedColumn = useCallback((col: TaskColumn) =>
    filteredTasks
      .filter(t => t.column === col)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || SCHEDULE_ORDER[a.schedule] - SCHEDULE_ORDER[b.schedule]),
    [filteredTasks]
  );

  // ── Drag handlers ────────────────────────────────────────────────
  const handleDragStart = useCallback((taskId: string) => { setDragId(taskId); }, []);
  const handleColumnDrop = useCallback((col: TaskColumn) => {
    if (dragId) updateTask(dragId, { column: col });
    setDragId(null);
    setDropTarget(null);
  }, [dragId, updateTask]);
  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
  }, []);

  // ── Stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = allTasks.filter(t => t.column !== 'done');
    const overdue = active.filter(t => t.dueDate && new Date(t.dueDate).getTime() < Date.now());
    return { total: allTasks.length, active: active.length, done: allTasks.length - active.length, overdue: overdue.length };
  }, [allTasks]);

  if (!loaded) {
    return <div className="h-full flex items-center justify-center text-white/20 text-[11px]">Loading tasks…</div>;
  }

  if (viewMode === 'settings') {
    return <NotionSettings
      notionDbId={notionDbId}
      onLink={async (id) => { await notionLinkDatabase(id); setNotionDbId(id); }}
      onBack={() => setViewMode('board')}
      onPull={handleNotionPull}
      syncing={syncing}
      syncMsg={syncMsg}
    />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.05] shrink-0">
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5 mr-1">
          <button onClick={() => setViewMode('board')}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
              viewMode === 'board' ? 'bg-white/[0.1] text-white/80 shadow-sm' : 'text-white/35 hover:text-white/55'
            }`}>
            <span className="flex items-center gap-1"><LayoutGrid size={10} /> Board</span>
          </button>
          <button onClick={() => setViewMode('calendar')}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
              viewMode === 'calendar' ? 'bg-white/[0.1] text-white/80 shadow-sm' : 'text-white/35 hover:text-white/55'
            }`}>
            <span className="flex items-center gap-1"><Calendar size={10} /> Calendar</span>
          </button>
        </div>

        {/* Filter tabs — includes channel names */}
        <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-0.5 overflow-x-auto">
          {([
            { key: 'all', label: 'All' },
            { key: 'human', label: 'Human' },
            { key: 'agent', label: 'Agent' },
            ...channelNames.map(name => ({ key: name, label: name })),
          ] as { key: OwnerFilter; label: string }[]).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap ${
                filter === f.key ? 'bg-white/[0.1] text-white/80 shadow-sm' : 'text-white/35 hover:text-white/55'
              }`}>
              <span className="flex items-center gap-1.5">
                {f.key === 'human' && <User size={10} />}
                {f.key === 'agent' && <Bot size={10} />}
                {f.label}
              </span>
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 ml-auto text-[9px] text-white/20">
          {stats.overdue > 0 && (
            <span className="flex items-center gap-1 text-red-400/60">
              <AlertTriangle size={9} /> {stats.overdue} overdue
            </span>
          )}
          <span>{stats.active} active · {stats.done} done</span>
        </div>

        {/* Notion sync */}
        {notionDbId && (
          <button onClick={handleNotionPull} disabled={syncing}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-indigo-300/60 hover:text-indigo-300/80 bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-400/15 transition-all disabled:opacity-50">
            <RefreshCw size={9} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
        )}

        {/* Calendar sidebar toggle (board mode only) */}
        {viewMode === 'board' && (
          <button onClick={() => setCalendarOpen(o => !o)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] transition-all ${
              calendarOpen
                ? 'text-indigo-300/80 bg-indigo-500/15 border border-indigo-400/20'
                : 'text-white/30 hover:text-white/50 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06]'
            }`}>
            <Calendar size={9} /> {calendarOpen ? 'Hide Calendar' : 'Show Calendar'}
          </button>
        )}

        {/* Settings */}
        <button onClick={() => setViewMode('settings')}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-white/30 hover:text-white/50 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-all">
          <Link2 size={9} /> Notion
        </button>
      </div>

      {/* Sync message */}
      {syncMsg && (
        <div className="px-4 py-1.5 text-[9px] text-indigo-300/60 bg-indigo-500/[0.05] border-b border-indigo-400/10">
          {syncMsg}
        </div>
      )}

      {/* Board or Calendar view */}
      {viewMode === 'board' ? (
        <div className="flex-1 flex min-h-0 overflow-hidden"
          onDragOver={e => { e.preventDefault(); }}
        >
          {/* Board columns */}
          <div className={`flex-1 flex gap-2 p-3 overflow-x-auto overflow-y-hidden min-h-0 transition-all ${calendarOpen ? 'max-w-[60%]' : ''}`}>
            {COLUMNS.map(col => {
              const colTasks = sortedColumn(col.key);
              const isDropping = dropTarget === col.key && dragId != null;

              return (
                <div key={col.key}
                  className={`flex-1 min-w-[180px] flex flex-col rounded-xl border transition-colors ${
                    isDropping ? 'border-indigo-400/30 bg-indigo-500/[0.04]' : 'border-white/[0.04] bg-white/[0.02]'
                  }`}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropTarget(col.key); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); handleColumnDrop(col.key); }}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04] shrink-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${col.color}`}>{col.label}</span>
                      <span className="text-[9px] text-white/20 bg-white/[0.04] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{colTasks.length}</span>
                    </div>
                    <button onClick={() => setAddingTo(addingTo === col.key ? null : col.key)}
                      className="w-5 h-5 rounded-md flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-all">
                      <Plus size={11} />
                    </button>
                  </div>

                  {/* Add task form */}
                  {addingTo === col.key && (
                    <AddTaskForm column={col.key} onAdd={addTask} onCancel={() => setAddingTo(null)} channels={channelNames} />
                  )}

                  {/* Task cards */}
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5 min-h-0">
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isEditing={editingId === task.id}
                        onStartEdit={() => setEditingId(task.id)}
                        onStopEdit={() => setEditingId(null)}
                        onUpdate={(updates) => updateTask(task.id, updates)}
                        onDelete={() => deleteTask(task.id)}
                        onDragStart={() => handleDragStart(task.id)}
                        onDragEnd={handleDragEnd}
                        onPushNotion={() => handleNotionPush(task)}
                        isDragging={dragId === task.id}
                        hasNotion={!!notionDbId}
                      />
                    ))}
                    {colTasks.length === 0 && addingTo !== col.key && (
                      <div className="text-center text-[10px] text-white/15 py-6">No tasks</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collapsible calendar sidebar — drag board tasks here to set dates */}
          {calendarOpen && (
            <div className="w-[40%] min-w-[280px] border-l border-white/[0.04] shrink-0"
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            >
              <CalendarView tasks={filteredTasks} onUpdateTask={updateTask} />
            </div>
          )}
        </div>
      ) : (
        <CalendarView tasks={filteredTasks} onUpdateTask={updateTask} />
      )}
    </div>
  );
}

// ── Task Card ────────────────────────────────────────────────────────
function TaskCard({ task, isEditing, onStartEdit, onStopEdit, onUpdate, onDelete, onDragStart, onDragEnd, onPushNotion, isDragging, hasNotion }: {
  task: KanbanTask;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onUpdate: (updates: Partial<KanbanTask>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPushNotion: () => void;
  isDragging: boolean;
  hasNotion: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const pri = PRIORITY_CONFIG[task.priority];
  const sched = SCHEDULE_CONFIG[task.schedule];
  const SchedIcon = sched.icon;
  const isOverdue = task.dueDate && new Date(task.dueDate).getTime() < Date.now() && task.column !== 'done';

  if (isEditing) {
    return <TaskEditForm task={task} onSave={onUpdate} onCancel={onStopEdit} />;
  }

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`group relative rounded-lg border px-2.5 py-2 cursor-grab active:cursor-grabbing transition-all ${
        isDragging
          ? 'opacity-40 border-indigo-400/30 bg-indigo-500/10'
          : isOverdue
            ? 'border-red-400/20 bg-red-500/[0.04] hover:bg-red-500/[0.06]'
            : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/[0.1]'
      }`}
    >
      {/* Top row: priority + owner + actions */}
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`w-1.5 h-1.5 rounded-full ${pri.dot} shrink-0`} />
        <span className={`text-[9px] font-medium ${pri.color}`}>{pri.label}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium ${
            task.owner === 'human'
              ? 'bg-cyan-500/10 text-cyan-400/70 border border-cyan-400/15'
              : 'bg-purple-500/10 text-purple-400/70 border border-purple-400/15'
          }`}>
            {task.owner === 'human' ? <User size={8} /> : <Bot size={8} />}
            {task.owner === 'human' ? 'Human' : 'Agent'}
          </div>
          {task.channel && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium bg-teal-500/10 text-teal-400/70 border border-teal-400/15">
              {task.channel}
            </div>
          )}
          <button onClick={e => { e.stopPropagation(); onStartEdit(); }}
            className="w-4 h-4 rounded flex items-center justify-center text-white/0 group-hover:text-white/25 hover:!text-indigo-400/60 hover:bg-indigo-500/10 transition-all">
            <Edit3 size={8} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="w-4 h-4 rounded flex items-center justify-center text-white/0 group-hover:text-white/20 hover:!text-red-400/60 hover:bg-red-500/10 transition-all">
            <Trash2 size={8} />
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="text-[11px] text-white/75 font-medium leading-snug mb-1">{task.title}</div>

      {/* Description preview */}
      {task.description && !expanded && (
        <div className="text-[9px] text-white/30 leading-relaxed mb-1 line-clamp-2">{task.description}</div>
      )}

      {/* Progress bar */}
      {task.progress != null && task.progress > 0 && (
        <div className="mb-1">
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{
              width: `${task.progress}%`,
              background: task.progress >= 100 ? 'rgb(74,222,128)' : task.progress >= 50 ? 'rgb(250,204,21)' : 'rgb(129,140,248)',
            }} />
          </div>
          <span className="text-[8px] text-white/20 mt-0.5 block">{task.progress}%</span>
        </div>
      )}

      {/* Bottom row: schedule, due date, Notion link */}
      <div className="flex items-center gap-1.5 text-[9px] text-white/25 flex-wrap">
        <span className="flex items-center gap-0.5"><SchedIcon size={9} /> {sched.label}</span>
        {task.dueDate && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-400/60' : ''}`}>
            <Clock size={8} /> {task.dueDate}
          </span>
        )}
        {task.recurringConfig && (
          <span className="flex items-center gap-0.5 text-purple-400/40">
            <Repeat size={8} /> {task.recurringConfig.frequency}
          </span>
        )}
        {task.notionUrl && (
          <a href={task.notionUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-indigo-400/40 hover:text-indigo-400/70 transition-colors"
            onClick={e => e.stopPropagation()}>
            <ExternalLink size={8} /> Notion
          </a>
        )}
        {hasNotion && !task.notionId && (
          <button onClick={e => { e.stopPropagation(); onPushNotion(); }}
            className="flex items-center gap-0.5 text-white/15 hover:text-indigo-400/50 transition-colors">
            <Link2 size={8} /> Push
          </button>
        )}
      </div>

      {/* Status note */}
      {task.statusNote && (
        <div className="mt-1.5 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.04] text-[9px] text-white/35 flex items-start gap-1">
          <MessageSquare size={8} className="shrink-0 mt-0.5" />
          <span>{task.statusNote}</span>
        </div>
      )}

      {/* Expand toggle for description */}
      {task.description && task.description.length > 80 && (
        <button onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[8px] text-white/15 hover:text-white/30 mt-1 transition-colors flex items-center gap-0.5">
          {expanded ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
          {expanded ? 'Less' : 'More'}
        </button>
      )}
      {expanded && task.description && (
        <div className="text-[9px] text-white/35 leading-relaxed mt-1 whitespace-pre-wrap">{task.description}</div>
      )}
    </div>
  );
}

// ── Task Edit Form (inline) ──────────────────────────────────────────
function TaskEditForm({ task, onSave, onCancel }: {
  task: KanbanTask;
  onSave: (updates: Partial<KanbanTask>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [owner, setOwner] = useState<TaskOwner>(task.owner);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [schedule, setSchedule] = useState<TaskSchedule>(task.schedule);
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [progress, setProgress] = useState(task.progress ?? 0);
  const [statusNote, setStatusNote] = useState(task.statusNote || '');
  const [recurFreq, setRecurFreq] = useState<RecurringConfig['frequency']>(task.recurringConfig?.frequency || 'weekly');
  const [showRecurring, setShowRecurring] = useState(!!task.recurringConfig);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = () => {
    if (!title.trim()) return;
    const updates: Partial<KanbanTask> = {
      title: title.trim(),
      description: description.trim() || undefined,
      owner,
      priority,
      schedule,
      dueDate: dueDate || undefined,
      progress,
      statusNote: statusNote.trim() || undefined,
    };
    if (showRecurring) {
      updates.recurringConfig = { frequency: recurFreq };
      updates.schedule = 'recurring';
    } else if (task.recurringConfig) {
      updates.recurringConfig = undefined;
    }
    onSave(updates);
    onCancel();
  };

  return (
    <div className="rounded-lg border border-indigo-400/25 bg-indigo-500/[0.06] p-2.5 space-y-2">
      {/* Title */}
      <input ref={inputRef} type="text" value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        placeholder="Task title…"
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-indigo-400/30 transition-colors" />

      {/* Description */}
      <textarea value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)…"
        rows={2}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[10px] text-white/60 placeholder:text-white/15 outline-none focus:border-indigo-400/30 transition-colors resize-none" />

      {/* Owner + Priority */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-white/25 w-10">Owner</span>
          {(['human', 'agent'] as TaskOwner[]).map(o => (
            <button key={o} onClick={() => setOwner(o)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
                owner === o
                  ? o === 'human' ? 'bg-cyan-500/15 text-cyan-400/80 border border-cyan-400/20' : 'bg-purple-500/15 text-purple-400/80 border border-purple-400/20'
                  : 'bg-white/[0.03] text-white/25 border border-white/[0.06] hover:text-white/40'
              }`}>
              {o === 'human' ? <User size={9} /> : <Bot size={9} />}
              {o === 'human' ? 'Human' : 'Agent'}
            </button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-white/25 w-10">Priority</span>
        {(['critical', 'high', 'medium', 'low'] as TaskPriority[]).map(p => {
          const cfg = PRIORITY_CONFIG[p];
          return (
            <button key={p} onClick={() => setPriority(p)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-all ${
                priority === p ? `${cfg.color} bg-white/[0.08] border border-white/[0.12]` : 'text-white/25 border border-transparent hover:text-white/40'
              }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Schedule */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-white/25 w-10">When</span>
        {(['immediate', 'scheduled', 'recurring', 'whenever'] as TaskSchedule[]).map(s => {
          const cfg = SCHEDULE_CONFIG[s];
          const Icon = cfg.icon;
          return (
            <button key={s} onClick={() => { setSchedule(s); if (s === 'recurring') setShowRecurring(true); }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-all ${
                schedule === s ? 'text-white/70 bg-white/[0.08] border border-white/[0.12]' : 'text-white/25 border border-transparent hover:text-white/40'
              }`}>
              <Icon size={9} />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Due date */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">Due</span>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-0.5 text-[10px] text-white/60 outline-none focus:border-indigo-400/30 transition-colors [color-scheme:dark]" />
        {dueDate && (
          <button onClick={() => setDueDate('')} className="text-[9px] text-white/20 hover:text-white/40">
            <X size={9} />
          </button>
        )}
      </div>

      {/* Recurring config */}
      {showRecurring && (
        <div className="flex items-center gap-1.5 pl-[52px]">
          <Repeat size={9} className="text-purple-400/40 shrink-0" />
          {(['daily', 'weekly', 'biweekly', 'monthly'] as const).map(f => (
            <button key={f} onClick={() => setRecurFreq(f)}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${
                recurFreq === f ? 'text-purple-300/70 bg-purple-500/15 border border-purple-400/20' : 'text-white/25 border border-transparent hover:text-white/40'
              }`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={() => setShowRecurring(false)} className="text-[9px] text-white/15 hover:text-white/30 ml-1">
            <X size={9} />
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">Progress</span>
        <input type="range" min={0} max={100} step={5} value={progress} onChange={e => setProgress(parseInt(e.target.value))}
          className="flex-1 h-1 appearance-none bg-white/[0.08] rounded-full accent-indigo-400 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:appearance-none" />
        <span className="text-[9px] text-white/30 w-8 text-right">{progress}%</span>
      </div>

      {/* Status note */}
      <div className="flex items-start gap-1.5">
        <span className="text-[9px] text-white/25 w-10 mt-1">Note</span>
        <input type="text" value={statusNote} onChange={e => setStatusNote(e.target.value)}
          placeholder="Status update…"
          className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-1 text-[10px] text-white/60 placeholder:text-white/15 outline-none focus:border-indigo-400/30 transition-colors" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button onClick={handleSave}
          className="px-3 py-1 rounded-md text-[10px] font-medium bg-indigo-500/20 text-indigo-300/80 border border-indigo-400/20 hover:bg-indigo-500/30 transition-all flex items-center gap-1">
          <Check size={9} /> Save
        </button>
        <button onClick={onCancel}
          className="px-2 py-1 rounded-md text-[10px] text-white/30 hover:text-white/50 transition-all">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Add Task Form ────────────────────────────────────────────────────
function AddTaskForm({ column, onAdd, onCancel, channels = [] }: {
  column: TaskColumn;
  onAdd: (task: Partial<KanbanTask> & { title: string; column: TaskColumn }) => void;
  onCancel: () => void;
  channels?: string[];
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<TaskOwner>('human');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [schedule, setSchedule] = useState<TaskSchedule>('whenever');
  const [dueDate, setDueDate] = useState('');
  const [channel, setChannel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const t = title.trim();
    if (!t) return;
    onAdd({
      title: t,
      description: description.trim() || undefined,
      column,
      owner,
      priority,
      schedule,
      dueDate: dueDate || undefined,
      channel: channel || undefined,
    });
  };

  return (
    <div className="mx-1.5 mt-1.5 p-2.5 rounded-lg border border-indigo-400/20 bg-indigo-500/[0.06] space-y-2">
      <input ref={inputRef} type="text" value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Task title…"
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-indigo-400/30 transition-colors" />

      <textarea value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)…" rows={2}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[10px] text-white/60 placeholder:text-white/15 outline-none focus:border-indigo-400/30 transition-colors resize-none" />

      {/* Owner */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">Owner</span>
        <div className="flex gap-1">
          {(['human', 'agent'] as TaskOwner[]).map(o => (
            <button key={o} onClick={() => setOwner(o)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
                owner === o
                  ? o === 'human' ? 'bg-cyan-500/15 text-cyan-400/80 border border-cyan-400/20' : 'bg-purple-500/15 text-purple-400/80 border border-purple-400/20'
                  : 'bg-white/[0.03] text-white/25 border border-white/[0.06] hover:text-white/40'
              }`}>
              {o === 'human' ? <User size={9} /> : <Bot size={9} />}
              {o === 'human' ? 'Human' : 'Agent'}
            </button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">Priority</span>
        <div className="flex gap-1">
          {(['critical', 'high', 'medium', 'low'] as TaskPriority[]).map(p => {
            const cfg = PRIORITY_CONFIG[p];
            return (
              <button key={p} onClick={() => setPriority(p)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-all ${
                  priority === p ? `${cfg.color} bg-white/[0.08] border border-white/[0.12]` : 'text-white/25 border border-transparent hover:text-white/40'
                }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">When</span>
        <div className="flex gap-1">
          {(['immediate', 'scheduled', 'recurring', 'whenever'] as TaskSchedule[]).map(s => {
            const cfg = SCHEDULE_CONFIG[s];
            const Icon = cfg.icon;
            return (
              <button key={s} onClick={() => setSchedule(s)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-all ${
                  schedule === s ? 'text-white/70 bg-white/[0.08] border border-white/[0.12]' : 'text-white/25 border border-transparent hover:text-white/40'
                }`}>
                <Icon size={9} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Due date */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-white/25 w-10">Due</span>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-0.5 text-[10px] text-white/60 outline-none focus:border-indigo-400/30 transition-colors [color-scheme:dark]" />
      </div>

      {/* Channel */}
      {channels.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/25 w-10">Channel</span>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setChannel('')}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${
                !channel ? 'text-white/70 bg-white/[0.08] border border-white/[0.12]' : 'text-white/25 border border-transparent hover:text-white/40'
              }`}>
              None
            </button>
            {channels.map(ch => (
              <button key={ch} onClick={() => setChannel(ch)}
                className={`px-1.5 py-0.5 rounded text-[9px] transition-all ${
                  channel === ch ? 'text-teal-300/80 bg-teal-500/15 border border-teal-400/20' : 'text-white/25 border border-transparent hover:text-white/40'
                }`}>
                {ch}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button onClick={handleSubmit}
          className="px-3 py-1 rounded-md text-[10px] font-medium bg-indigo-500/20 text-indigo-300/80 border border-indigo-400/20 hover:bg-indigo-500/30 transition-all">
          Add Task
        </button>
        <button onClick={onCancel}
          className="px-2 py-1 rounded-md text-[10px] text-white/30 hover:text-white/50 transition-all">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Calendar View ─────────────────────────────────────────────────────
function CalendarView({ tasks, onUpdateTask }: {
  tasks: KanbanTask[];
  onUpdateTask: (taskId: string, updates: Partial<KanbanTask>) => void;
}) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Build calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group tasks by dueDate
  const tasksByDate = useMemo(() => {
    const map: Record<string, KanbanTask[]> = {};
    for (const t of tasks) {
      if (t.dueDate) {
        if (!map[t.dueDate]) map[t.dueDate] = [];
        map[t.dueDate].push(t);
      }
    }
    return map;
  }, [tasks]);

  // Unscheduled tasks (no dueDate)
  const unscheduled = useMemo(() => tasks.filter(t => !t.dueDate && t.column !== 'done'), [tasks]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  // Format a date key for a given day of the month
  const dateKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Drag handlers for calendar cells
  const handleCellDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  const handleCellDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setDragOverDate(null);
  };

  const handleCellDrop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      onUpdateTask(taskId, { dueDate: date, schedule: 'scheduled' });
    }
  };

  // Drag start for calendar task pills
  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Unscheduled sidebar drop — clears the date
  const handleUnschedDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      onUpdateTask(taskId, { dueDate: undefined, schedule: 'whenever' });
    }
  };

  // Build cells: empty leading + days
  const cells: Array<{ day: number | null; date: string }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null, date: '' });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: dateKey(d) });

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
    >
      {/* Calendar grid */}
      <div className="flex-1 flex flex-col min-h-0 p-3">
        {/* Month navigation */}
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <button onClick={prevMonth} className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all">
            <ChevronLeft size={14} />
          </button>
          <span className="text-[12px] font-bold text-white/70 min-w-[140px] text-center">{monthName}</span>
          <button onClick={nextMonth} className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all">
            <ChevronRight size={14} />
          </button>
          <button onClick={goToday}
            className="ml-2 px-2 py-0.5 rounded text-[9px] text-white/30 hover:text-white/60 border border-white/[0.06] hover:bg-white/[0.04] transition-all">
            Today
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-px shrink-0">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-[9px] font-bold text-white/25 text-center py-1 uppercase tracking-wider">{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7 gap-px flex-1 auto-rows-fr min-h-0 overflow-y-auto">
          {cells.map((cell, i) => {
            if (cell.day === null) {
              return <div key={`empty-${i}`} className="bg-white/[0.01] rounded" />;
            }
            const isToday = cell.date === todayStr;
            const isOver = dragOverDate === cell.date;
            const dayTasks = tasksByDate[cell.date] || [];

            return (
              <div
                key={cell.date}
                className={`rounded border p-0.5 flex flex-col min-h-[48px] transition-colors ${
                  isOver
                    ? 'border-indigo-400/40 bg-indigo-500/[0.08]'
                    : isToday
                      ? 'border-indigo-400/20 bg-indigo-500/[0.04]'
                      : 'border-white/[0.03] bg-white/[0.015] hover:bg-white/[0.03]'
                }`}
                onDragOver={e => handleCellDragOver(e, cell.date)}
                onDragLeave={handleCellDragLeave}
                onDrop={e => handleCellDrop(e, cell.date)}
              >
                <div className={`text-[9px] font-medium px-0.5 mb-0.5 ${
                  isToday ? 'text-indigo-300' : 'text-white/30'
                }`}>{cell.day}</div>
                <div className="flex-1 space-y-0.5 overflow-y-auto min-h-0">
                  {dayTasks.map(task => {
                    const pri = PRIORITY_CONFIG[task.priority];
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={e => handleTaskDragStart(e, task.id)}
                        className="group/pill flex items-center gap-1 px-1 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] cursor-grab active:cursor-grabbing transition-all"
                        title={task.title}
                      >
                        <div className={`w-1 h-1 rounded-full ${pri.dot} shrink-0`} />
                        <span className="text-[8px] text-white/60 truncate flex-1">{task.title}</span>
                        {task.channel && (
                          <span className="text-[7px] text-teal-400/50 shrink-0">{task.channel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unscheduled sidebar — drag tasks here to remove date, or drag from here to calendar */}
      <div
        className="w-[180px] shrink-0 border-l border-white/[0.04] flex flex-col min-h-0"
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={handleUnschedDrop}
      >
        <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
          <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Unscheduled</div>
          <div className="text-[9px] text-white/20 mt-0.5">{unscheduled.length} task(s)</div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">
          {unscheduled.map(task => {
            const pri = PRIORITY_CONFIG[task.priority];
            return (
              <div
                key={task.id}
                draggable
                onDragStart={e => handleTaskDragStart(e, task.id)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] cursor-grab active:cursor-grabbing transition-all"
              >
                <div className={`w-1.5 h-1.5 rounded-full ${pri.dot} shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-white/60 truncate">{task.title}</div>
                  {task.channel && (
                    <div className="text-[8px] text-teal-400/40">{task.channel}</div>
                  )}
                </div>
              </div>
            );
          })}
          {unscheduled.length === 0 && (
            <div className="text-[9px] text-white/15 text-center py-4">All tasks scheduled</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Notion Settings Panel ────────────────────────────────────────────
function NotionSettings({ notionDbId, onLink, onBack, onPull, syncing, syncMsg }: {
  notionDbId: string | null;
  onLink: (id: string) => Promise<void>;
  onBack: () => void;
  onPull: () => void;
  syncing: boolean;
  syncMsg: string;
}) {
  const [databases, setDatabases] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDatabases = useCallback(async () => {
    setLoading(true);
    setError('');
    const dbs = await notionListDatabases();
    if (dbs.length === 0) setError('No databases found. Make sure your Notion integration has access to a database.');
    setDatabases(dbs);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDatabases(); }, [fetchDatabases]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05] shrink-0">
        <button onClick={onBack}
          className="text-[10px] text-white/40 hover:text-white/60 transition-colors flex items-center gap-1">
          ← Back to Board
        </button>
        <span className="text-[11px] font-bold text-white/60 ml-auto">Notion Integration</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Connection status */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-bold text-white/50 mb-2">Connection</div>
          {notionDbId ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-green-400/70">Linked to database</span>
              <span className="text-[9px] text-white/20 font-mono truncate flex-1">{notionDbId}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <span className="text-[10px] text-white/35">Not linked — select a database below</span>
            </div>
          )}
        </div>

        {/* Sync actions */}
        {notionDbId && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="text-[10px] font-bold text-white/50 mb-2">Sync</div>
            <div className="flex items-center gap-2">
              <button onClick={onPull} disabled={syncing}
                className="px-3 py-1.5 rounded-md text-[10px] font-medium bg-indigo-500/20 text-indigo-300/80 border border-indigo-400/20 hover:bg-indigo-500/30 transition-all disabled:opacity-50 flex items-center gap-1">
                <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
                Pull from Notion
              </button>
              <span className="text-[9px] text-white/25">Imports all tasks from the linked database</span>
            </div>
            {syncMsg && <div className="text-[9px] text-indigo-300/50">{syncMsg}</div>}
            <div className="text-[9px] text-white/20 leading-relaxed">
              Individual tasks can be pushed to Notion via the "Push" button on each task card.
              Tasks synced from Notion will update when you pull again.
            </div>
          </div>
        )}

        {/* Database list */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-bold text-white/50">Available Databases</div>
            <button onClick={fetchDatabases} disabled={loading}
              className="text-[9px] text-white/25 hover:text-white/45 transition-colors flex items-center gap-1">
              <RefreshCw size={9} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {error && <div className="text-[10px] text-amber-400/60 mb-2">{error}</div>}

          {loading ? (
            <div className="text-[10px] text-white/20 py-4 text-center">Searching Notion…</div>
          ) : (
            <div className="space-y-1.5">
              {databases.map(db => (
                <div key={db.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                    notionDbId === db.id
                      ? 'border-indigo-400/25 bg-indigo-500/10'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]'
                  }`}
                  onClick={() => onLink(db.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-white/70 font-medium truncate">{db.title}</div>
                    <div className="text-[9px] text-white/20 font-mono truncate">{db.id}</div>
                  </div>
                  {notionDbId === db.id && (
                    <Check size={12} className="text-indigo-400/70 shrink-0" />
                  )}
                  <a href={db.url} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-white/15 hover:text-white/40 transition-colors shrink-0">
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))}
              {databases.length === 0 && !loading && !error && (
                <div className="text-[10px] text-white/20 py-4 text-center">No databases found</div>
              )}
            </div>
          )}
        </div>

        {/* Setup instructions */}
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-3">
          <div className="text-[10px] font-bold text-white/30 mb-1.5">Setup Guide</div>
          <div className="text-[9px] text-white/20 leading-relaxed space-y-1">
            <p>1. Go to your Notion database and click <strong className="text-white/30">••• → Connections → Add connections</strong></p>
            <p>2. Select your Substrate integration</p>
            <p>3. Click "Refresh" above — your database will appear</p>
            <p>4. Click a database to link it for sync</p>
            <p className="mt-2 text-white/15">For best results, add these properties to your Notion database: <strong className="text-white/25">Title</strong> (title), <strong className="text-white/25">Status</strong> (select: Backlog/In Progress/Done), <strong className="text-white/25">Owner</strong> (select: Human/Agent), <strong className="text-white/25">Priority</strong> (select: Critical/High/Medium/Low), <strong className="text-white/25">Schedule</strong> (select: Immediate/Scheduled/Recurring/Whenever), <strong className="text-white/25">Description</strong> (rich text), <strong className="text-white/25">Due Date</strong> (date).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
