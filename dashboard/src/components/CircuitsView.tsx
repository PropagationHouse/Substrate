/**
 * CircuitsView — Live real-time view of CIRCUITS.md + runner status.
 *
 * Polls the backend for:
 *  - /api/circuits        → raw CIRCUITS.md content
 *  - /api/circuits-tasks  → parsed active/completed task list
 *  - /api/circuits-config → runner status (enabled, running, interval, next due, run count)
 *
 * Renders a formatted, glassmorphic view with:
 *  - Status header (enabled/disabled, next run countdown, run count)
 *  - Active tasks with time badges and completion detection
 *  - Paused/notes sections
 *  - Inline editing of CIRCUITS.md via save endpoint
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap, Clock, Pause, RefreshCw, CheckCircle2,
  AlertTriangle, Edit3, Save, X, ChevronDown, ChevronRight,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────
interface CircuitsStatus {
  enabled: boolean;
  running: boolean;
  interval_seconds: number;
  next_due_in: string | null;
  run_count: number;
  active_start: string | null;
  active_end: string | null;
}

interface CircuitsTask {
  raw: string;
  time: string;
  label: string;
  detail: string;
  completed: boolean;
  completedAt?: string;
}

interface CircuitsData {
  content: string;
  tasks: CircuitsTask[];
  completedTasks: CircuitsTask[];
  status: CircuitsStatus | null;
  notes: string;
  paused: string;
}

// ── Parse a single task line ─────────────────────────────────────────
function parseTaskLine(raw: string): CircuitsTask {
  const cleaned = raw.replace(/^[-*]\s*/, '').trim();
  const completed = /\(COMPLETED[^)]*\)/i.test(cleaned);
  let completedAt: string | undefined;
  const compMatch = cleaned.match(/\(COMPLETED\s+([^)]+)\)/i);
  if (compMatch) completedAt = compMatch[1];

  // Extract time | label : detail pattern
  // e.g. "**08:00 AM | Morning Routine**: Dispatch, News Check..."
  const boldMatch = cleaned.match(/\*\*([^*]+)\*\*:?\s*(.*)/);
  if (boldMatch) {
    const inner = boldMatch[1];
    const detail = boldMatch[2].replace(/\(COMPLETED[^)]*\)/i, '').trim();
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx >= 0) {
      return {
        raw, completed, completedAt,
        time: inner.slice(0, pipeIdx).trim(),
        label: inner.slice(pipeIdx + 1).trim(),
        detail,
      };
    }
    return { raw, completed, completedAt, time: '', label: inner.trim(), detail };
  }
  return { raw, completed, completedAt, time: '', label: cleaned, detail: '' };
}

// ── Parse CIRCUITS.md content ────────────────────────────────────────
function parseCircuitsContent(content: string): { tasks: CircuitsTask[]; paused: string; notes: string } {
  const sections = content.split(/^##\s+/m);
  let tasks: CircuitsTask[] = [];
  let paused = '';
  let notes = '';

  for (const section of sections) {
    const lines = section.split('\n');
    const heading = lines[0]?.trim().toLowerCase() || '';
    const body = lines.slice(1).join('\n').trim();

    if (heading.includes('active')) {
      tasks = body.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-') || l.startsWith('*'))
        .map(parseTaskLine);
    } else if (heading.includes('paused') || heading.includes('hiatus')) {
      paused = body;
    } else if (heading.includes('note')) {
      notes = body;
    }
  }

  return { tasks, paused, notes };
}

// ── Format countdown ─────────────────────────────────────────────────
function formatCountdown(secondsStr: string | null): string {
  if (!secondsStr) return '—';
  const s = parseInt(secondsStr.replace('s', ''), 10);
  if (isNaN(s)) return secondsStr;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── Component ────────────────────────────────────────────────────────
const POLL_INTERVAL = 10_000; // 10s

export function CircuitsView() {
  const [data, setData] = useState<CircuitsData>({
    content: '', tasks: [], completedTasks: [], status: null, notes: '', paused: '',
  });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [contentRes, configRes] = await Promise.all([
        fetch('/api/circuits').then(r => r.json()),
        fetch('/api/circuits-config').then(r => r.json()),
      ]);

      const content = contentRes?.content || '';
      const { tasks, paused, notes } = parseCircuitsContent(content);
      const activeTasks = tasks.filter(t => !t.completed);
      const completedTasks = tasks.filter(t => t.completed);

      const status: CircuitsStatus = {
        enabled: configRes?.enabled ?? false,
        running: configRes?.running ?? false,
        interval_seconds: configRes?.interval_seconds ?? 1800,
        next_due_in: configRes?.next_due_in ?? null,
        run_count: configRes?.run_count ?? 0,
        active_start: configRes?.active_start ?? null,
        active_end: configRes?.active_end ?? null,
      };

      setData({ content, tasks: activeTasks, completedTasks, status, notes, paused });
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch circuits data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  const startEdit = useCallback(() => {
    setEditContent(data.content);
    setEditing(true);
  }, [data.content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditContent('');
  }, []);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/circuits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      setEditing(false);
      await fetchData();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [editContent, fetchData]);

  const { status, tasks, completedTasks, paused, notes } = data;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/30 text-xs">
        <RefreshCw size={14} className="animate-spin mr-2" /> Loading circuits…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col text-white/80 text-[11px] overflow-hidden">

      {/* ── Status Bar ────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Enabled/Running indicator */}
        <div className="flex items-center gap-1.5">
          {status?.running ? (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">Active</span>
            </div>
          ) : status?.enabled ? (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-amber-400 font-medium">Enabled</span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
              <span className="text-white/30">Disabled</span>
            </div>
          )}
        </div>

        {/* Next run countdown */}
        {status?.running && status.next_due_in && (
          <div className="flex items-center gap-1 text-white/40">
            <Clock size={10} />
            <span>Next: {formatCountdown(status.next_due_in)}</span>
          </div>
        )}

        {/* Interval */}
        {status?.running && (
          <div className="text-white/25">
            every {formatCountdown(`${status.interval_seconds}s`)}
          </div>
        )}

        {/* Run count */}
        {(status?.run_count ?? 0) > 0 && (
          <div className="text-white/25">
            {status!.run_count} run{status!.run_count !== 1 ? 's' : ''}
          </div>
        )}

        {/* Active hours */}
        {status?.active_start && status?.active_end && (
          <div className="text-white/20 ml-auto">
            {status.active_start}–{status.active_end}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={fetchData}
            className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
          {!editing && (
            <button
              onClick={startEdit}
              className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="Edit CIRCUITS.md"
            >
              <Edit3 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-[10px] flex items-center gap-1.5">
          <AlertTriangle size={10} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200"><X size={10} /></button>
        </div>
      )}

      {/* ── Edit mode ─────────────────────────────────────────── */}
      {editing ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            className="flex-1 bg-black/30 text-white/80 text-[11px] font-mono p-3 resize-none border-none outline-none"
            spellCheck={false}
          />
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-white/[0.06]">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-3 py-1 rounded-md bg-emerald-500/20 border border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors text-[10px] font-medium flex items-center gap-1"
            >
              <Save size={10} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="px-3 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white/60 transition-colors text-[10px]"
            >
              Cancel
            </button>
            <span className="ml-auto text-white/20 text-[9px]">Editing CIRCUITS.md</span>
          </div>
        </div>
      ) : (
        /* ── Task list ──────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">

          {/* Active tasks */}
          {tasks.length > 0 ? (
            tasks.map((task, i) => (
              <div
                key={i}
                className="flex items-start gap-2 py-1.5 px-2 rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
              >
                <Zap size={11} className="text-amber-400/70 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {task.time && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-400/15 text-indigo-300 text-[9px] font-mono">
                        {task.time}
                      </span>
                    )}
                    <span className="font-medium text-white/80 truncate">{task.label}</span>
                  </div>
                  {task.detail && (
                    <div className="text-white/40 text-[10px] mt-0.5 leading-relaxed">{task.detail}</div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-white/20 text-center py-6">
              No active circuits tasks
            </div>
          )}

          {/* Completed tasks */}
          {completedTasks.length > 0 && (
            <div className="mt-3 pt-2 border-t border-white/[0.04]">
              <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1 px-1">Completed</div>
              {completedTasks.map((task, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 py-1 px-2 rounded-md opacity-50"
                >
                  <CheckCircle2 size={11} className="text-emerald-400/50 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {task.time && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/10 text-emerald-400/50 text-[9px] font-mono">
                          {task.time}
                        </span>
                      )}
                      <span className="font-medium text-white/40 line-through truncate">{task.label}</span>
                    </div>
                    {task.completedAt && (
                      <div className="text-white/20 text-[9px] mt-0.5">{task.completedAt}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paused section */}
          {paused && (
            <div className="mt-3 pt-2 border-t border-white/[0.04]">
              <button
                onClick={() => setShowPaused(p => !p)}
                className="flex items-center gap-1 text-[9px] text-white/25 uppercase tracking-wider mb-1 px-1 hover:text-white/40 transition-colors"
              >
                {showPaused ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                <Pause size={9} /> Paused / On Hiatus
              </button>
              {showPaused && (
                <div className="px-2 py-1 text-white/30 text-[10px] whitespace-pre-wrap leading-relaxed">
                  {paused || 'Nothing paused.'}
                </div>
              )}
            </div>
          )}

          {/* Notes section */}
          {notes && (
            <div className="mt-3 pt-2 border-t border-white/[0.04]">
              <button
                onClick={() => setShowNotes(n => !n)}
                className="flex items-center gap-1 text-[9px] text-white/25 uppercase tracking-wider mb-1 px-1 hover:text-white/40 transition-colors"
              >
                {showNotes ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                Notes
              </button>
              {showNotes && (
                <div className="px-2 py-1 text-white/30 text-[10px] whitespace-pre-wrap leading-relaxed">
                  {notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
