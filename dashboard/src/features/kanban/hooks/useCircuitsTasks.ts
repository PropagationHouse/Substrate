import { useState, useEffect, useCallback, useRef } from 'react';
import type { KanbanTask } from '../types';

/**
 * Fetches active circuit tasks from /api/circuits and maps them
 * to KanbanTask shape for display on the unified kanban board.
 * Circuit tasks appear as read-only "in-progress" items with a 'circuit' label.
 */

interface CircuitTaskRaw {
  raw: string;
  time: string;
  label: string;
  detail: string;
  completed: boolean;
  completedAt?: string;
}

function parseTaskLine(raw: string): CircuitTaskRaw {
  const cleaned = raw.replace(/^[-*]\s*/, '').trim();
  const completed = /\(COMPLETED[^)]*\)/i.test(cleaned);
  let completedAt: string | undefined;
  const compMatch = cleaned.match(/\(COMPLETED\s+([^)]+)\)/i);
  if (compMatch) completedAt = compMatch[1];

  const boldMatch = cleaned.match(/\*\*([^*]+)\*\*:?\s*(.*)/);
  if (boldMatch) {
    const inner = boldMatch[1];
    const detail = boldMatch[2].replace(/\(COMPLETED[^)]*\)/i, '').trim();
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx >= 0) {
      return { raw, completed, completedAt, time: inner.slice(0, pipeIdx).trim(), label: inner.slice(pipeIdx + 1).trim(), detail };
    }
    return { raw, completed, completedAt, time: '', label: inner.trim(), detail };
  }
  return { raw, completed, completedAt, time: '', label: cleaned, detail: '' };
}

function parseCircuitsContent(content: string): CircuitTaskRaw[] {
  const sections = content.split(/^##\s+/m);
  for (const section of sections) {
    const lines = section.split('\n');
    const heading = lines[0]?.trim().toLowerCase() || '';
    if (heading.includes('active')) {
      return lines.slice(1)
        .map(l => l.trim())
        .filter(l => l.startsWith('-') || l.startsWith('*'))
        .map(parseTaskLine);
    }
  }
  return [];
}

function toKanbanTask(ct: CircuitTaskRaw, index: number): KanbanTask {
  const now = Date.now();
  const title = ct.label || ct.raw.slice(0, 60);
  const description = ct.detail ? `${ct.time ? ct.time + ' — ' : ''}${ct.detail}` : ct.time || undefined;

  return {
    id: `circuit:${index}:${title.slice(0, 20)}`,
    title,
    description,
    status: ct.completed ? 'done' : 'in-progress',
    priority: 'normal',
    createdBy: 'agent:circuits',
    createdAt: now,
    updatedAt: now,
    version: 1,
    labels: ['circuit', ...(ct.time ? [`⏰ ${ct.time}`] : [])],
    columnOrder: 2000 + index,
    feedback: [],
  };
}

const POLL_INTERVAL = 15_000;

export function useCircuitsTasks() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [available, setAvailable] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      const res = await fetch('/api/circuits');
      if (!res.ok) { if (!silent) setAvailable(false); return; }
      const data = await res.json();
      const content = data?.content || '';
      const parsed = parseCircuitsContent(content);
      // Only show active (non-completed) circuit tasks on the board
      const active = parsed.filter(t => !t.completed);
      setTasks(active.map(toKanbanTask));
      setAvailable(true);
    } catch {
      if (!silent) setAvailable(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(true), POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  return { tasks, available };
}
