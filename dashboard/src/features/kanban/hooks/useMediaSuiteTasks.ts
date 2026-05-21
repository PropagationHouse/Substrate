import { useState, useEffect, useCallback, useRef } from 'react';
import type { KanbanTask, TaskStatus } from '../types';

/**
 * Fetches media items from the Media Planning Suite (Flask on :5000)
 * and maps them to KanbanTask shape so they can be merged into the
 * Substrate kanban board alongside native tasks.
 */

interface MediaItem {
  id: string;
  title: string;
  description?: string;
  content_type: string;
  status: string;
  scheduled_date?: string;
  created_at?: string;
  updated_at?: string;
}

/** Map Media Suite statuses → Substrate kanban statuses */
function mapStatus(msStatus: string): TaskStatus {
  switch (msStatus) {
    // Early pipeline → todo
    case 'idea':
    case 'not_started':
      return 'todo';
    // Active work → in-progress
    case 'research':
    case 'scripting':
    case 'shooting':
    case 'editing':
    case 'in_progress':
      return 'in-progress';
    // Ready/waiting → review
    case 'scheduled':
      return 'review';
    // Completed
    case 'posted':
    case 'done':
    case 'published':
      return 'done';
    default:
      return 'backlog';
  }
}

/** Map a Media Suite item to KanbanTask shape */
function toKanbanTask(item: MediaItem, index: number): KanbanTask {
  const now = Date.now();
  return {
    id: `ms:${item.id}`,
    title: item.title,
    description: item.description || undefined,
    status: mapStatus(item.status),
    priority: 'normal',
    createdBy: 'operator',
    createdAt: item.created_at ? new Date(item.created_at).getTime() : now,
    updatedAt: item.updated_at ? new Date(item.updated_at).getTime() : now,
    version: 1,
    labels: ['media-suite', item.content_type || 'content'],
    columnOrder: 1000 + index,
    feedback: [],
  };
}

const MEDIA_SUITE_URL = '/api/media-suite/media-items';
const WORKSPACES_URL = '/api/media-suite/workspaces';
const POLL_INTERVAL = 10_000;

export function useMediaSuiteTasks() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [projectName, setProjectName] = useState('Media Suite');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchItems = useCallback(async (silent = false) => {
    try {
      const res = await fetch(MEDIA_SUITE_URL);
      if (!res.ok) {
        if (!silent) setAvailable(false);
        return;
      }
      const items: MediaItem[] = await res.json();
      setTasks(items.map(toKanbanTask));
      setAvailable(true);
    } catch {
      if (!silent) setAvailable(false);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Fetch workspace name once for the tab label
  useEffect(() => {
    fetch(WORKSPACES_URL)
      .then(r => r.ok ? r.json() : [])
      .then((ws: { id: number; name: string; is_main?: boolean }[]) => {
        const main = ws.find(w => w.is_main) || ws[0];
        if (main?.name) setProjectName(main.name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchItems();
    intervalRef.current = setInterval(() => fetchItems(true), POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchItems]);

  /** Update a Media Suite task status by calling the Flask API */
  const updateMediaSuiteStatus = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    // Extract the real media item ID (strip 'ms:' prefix)
    const realId = taskId.replace(/^ms:/, '');
    // Reverse-map Substrate status → Media Suite status
    let msStatus = 'idea';
    if (newStatus === 'in-progress') msStatus = 'editing';
    else if (newStatus === 'review') msStatus = 'scheduled';
    else if (newStatus === 'done') msStatus = 'posted';
    else if (newStatus === 'todo') msStatus = 'idea';
    else if (newStatus === 'backlog') msStatus = 'idea';

    try {
      await fetch(`/api/media-suite/media-items/${realId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: msStatus }),
      });
      await fetchItems(true);
    } catch (e) {
      console.error('[MediaSuite] Failed to update task status:', e);
    }
  }, [fetchItems]);

  return { tasks, loading, available, projectName, updateMediaSuiteStatus, refetch: fetchItems };
}
