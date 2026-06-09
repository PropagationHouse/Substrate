/**
 * useNotes — Hook for managing notes (CRUD operations against /api/notes/*).
 */

import { useState, useCallback, useRef } from 'react';

export interface NoteEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  modified?: number;
}

interface NotesState {
  entries: NoteEntry[];
  isLoading: boolean;
  error: string | null;
}


const INITIAL_STATE: NotesState = {
  entries: [],
  isLoading: false,
  error: null,
};

export function useNotes() {
  const [state, setState] = useState<NotesState>(INITIAL_STATE);
  const [activeNote, setActiveNote] = useState<{ path: string; content: string; modified: number } | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController>(undefined);

  const loadTree = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState(s => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch('/api/notes/tree', { signal: controller.signal });
      const data = await res.json() as { ok: boolean; entries?: NoteEntry[]; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to load notes');
      setState({ entries: data.entries || [], isLoading: false, error: null });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState(s => ({ ...s, isLoading: false, error: (err as Error).message }));
    }
  }, []);

  const readNote = useCallback(async (path: string) => {
    setNoteLoading(true);
    try {
      const res = await fetch(`/api/notes/read?path=${encodeURIComponent(path)}`);
      const data = await res.json() as { ok: boolean; content?: string; modified?: number; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to read note');
      const note = { path, content: data.content ?? '', modified: data.modified ?? 0 };
      setActiveNote(note);
      setNoteLoading(false);
      return note;
    } catch (err) {
      setNoteLoading(false);
      throw err;
    }
  }, []);

  const saveNote = useCallback(async (path: string, content: string): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch('/api/notes/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json() as { ok: boolean; modified?: number; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to save');
      setActiveNote(prev => prev?.path === path ? { ...prev, content, modified: data.modified ?? Date.now() / 1000 } : prev);
      setSaving(false);
      return true;
    } catch {
      setSaving(false);
      return false;
    }
  }, []);

  const createNote = useCallback(async (path: string, content = ''): Promise<boolean> => {
    try {
      const res = await fetch('/api/notes/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to create note');
      await loadTree();
      return true;
    } catch {
      return false;
    }
  }, [loadTree]);

  const createFolder = useCallback(async (path: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/notes/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to create folder');
      await loadTree();
      return true;
    } catch {
      return false;
    }
  }, [loadTree]);

  const deleteNote = useCallback(async (path: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/notes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to delete');
      if (activeNote?.path === path) setActiveNote(null);
      await loadTree();
      return true;
    } catch {
      return false;
    }
  }, [activeNote, loadTree]);

  const renameNote = useCallback(async (oldPath: string, newPath: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/notes/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to rename');
      if (activeNote?.path === oldPath) {
        setActiveNote(prev => prev ? { ...prev, path: newPath } : null);
      }
      await loadTree();
      return true;
    } catch {
      return false;
    }
  }, [activeNote, loadTree]);

  return {
    ...state,
    activeNote,
    noteLoading,
    saving,
    loadTree,
    readNote,
    saveNote,
    createNote,
    createFolder,
    deleteNote,
    renameNote,
    setActiveNote,
  };
}
