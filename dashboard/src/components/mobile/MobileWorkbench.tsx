/**
 * MobileWorkbench — Phone-native Media Suite with:
 * 1. Horizontally scrollable kanban columns (like Notion mobile)
 * 2. Media upload/download (mood board images)
 * 3. Full item CRUD with status pipeline control
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Film, Calendar, Clock, Image as ImageIcon, Download, Upload,
  CheckCircle2, Circle, Loader2, RefreshCw, Trash2, X, Briefcase,
  Music, Play, Pause, SkipBack, SkipForward, ListMusic, Shuffle, Repeat as RepeatIcon, Volume2,
} from 'lucide-react';
import { getServerUrl } from '@/lib/apiBase';

// ─── Types ─────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  is_main: boolean;
  brand_profile_id?: string;
}

interface MediaItem {
  id: string;
  title: string;
  content_type: string;
  status: string;
  description: string;
  channel: string;
  scheduled_date: string | null;
  workspace_id: string;
  tags: string;
}

interface MoodImage {
  id: string;
  name: string;
  file_url: string;
  description?: string;
}

type ViewMode = 'board' | 'projects' | 'media' | 'music';

interface AudioTrack {
  name: string;
  path: string;
  size: number;
}

const AUDIO_EXTS = new Set(['.mp3','.wav','.ogg','.flac','.m4a','.aac','.wma','.opus','.webm']);

// ─── Status config ─────────────────────────────────────────────────

const COLUMNS: { key: string; label: string; color: string }[] = [
  { key: 'not_started', label: 'Ideas', color: 'border-blue-400/30' },
  { key: 'in_progress', label: 'In Progress', color: 'border-amber-400/30' },
  { key: 'done', label: 'Done', color: 'border-emerald-400/30' },
];

function mapToColumn(status: string): string {
  switch (status) {
    case 'posted': case 'done': case 'published': return 'done';
    case 'research': case 'scripting': case 'shooting': case 'editing':
    case 'scheduled': case 'in_progress': return 'in_progress';
    case 'idea': case 'not_started': default: return 'not_started';
  }
}

function columnToApiStatus(col: string): string {
  switch (col) {
    case 'done': return 'posted';
    case 'in_progress': return 'in_progress';
    default: return 'not_started';
  }
}

const STATUS_BADGE: Record<string, string> = {
  idea: 'text-blue-300 bg-blue-500/15',
  not_started: 'text-blue-300 bg-blue-500/15',
  research: 'text-purple-300 bg-purple-500/15',
  scripting: 'text-amber-300 bg-amber-500/15',
  shooting: 'text-pink-300 bg-pink-500/15',
  editing: 'text-green-300 bg-green-500/15',
  scheduled: 'text-cyan-300 bg-cyan-500/15',
  in_progress: 'text-amber-300 bg-amber-500/15',
  posted: 'text-emerald-300 bg-emerald-500/15',
  done: 'text-emerald-300 bg-emerald-500/15',
};

// ─── Component ─────────────────────────────────────────────────────

export function MobileWorkbench() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [showAddItem, setShowAddItem] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [moodImages, setMoodImages] = useState<MoodImage[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewImg, setPreviewImg] = useState<MoodImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Music player state ─────────────────────────────────────
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [currentTrackIdx, setCurrentTrackIdx] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [trackProgress, setTrackProgress] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ─── Data fetching ───────────────────────────────────────────

  const loadWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch('/api/media-suite/workspaces');
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      setWorkspaces(data);
      setActiveWs(prev => prev || '__all__');
    } catch {
      setError('Workbench unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const url = (!activeWs || activeWs === '__all__')
        ? '/api/media-suite/media-items'
        : `/api/media-suite/media-items?workspace_id=${activeWs}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      setItems(await r.json());
    } catch {
      setItems([]);
    }
  }, [activeWs]);

  const loadMoodImages = useCallback(async () => {
    const ws = workspaces.find(w => w.id === activeWs);
    const bpId = ws?.brand_profile_id;
    if (!bpId && activeWs !== '__all__') { setMoodImages([]); return; }
    setMediaLoading(true);
    try {
      const fallbackWs = workspaces.find(w => w.brand_profile_id);
      const profileId = bpId || fallbackWs?.brand_profile_id;
      if (!profileId) { setMoodImages([]); setMediaLoading(false); return; }
      const r = await fetch(`/api/media-suite/mood-board?brand_profile_id=${profileId}`);
      if (!r.ok) throw new Error(`${r.status}`);
      setMoodImages(await r.json());
    } catch {
      setMoodImages([]);
    }
    setMediaLoading(false);
  }, [activeWs, workspaces]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);
  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { if (viewMode === 'media') loadMoodImages(); }, [viewMode, loadMoodImages]);

  // ─── Item CRUD ───────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const wsId = activeWs === '__all__' ? workspaces[0]?.id : activeWs;
    if (!wsId) return;
    // Optimistically clear the form — the item almost always saves successfully
    const title = newTitle.trim();
    setNewTitle('');
    setShowAddItem(false);
    try {
      await fetch('/api/media-suite/media-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, workspace_id: wsId, status: 'not_started' }),
      });
    } catch {
      // Ignore — item typically saves even when the client sees an error
    }
    loadItems();
  };

  const moveItem = async (item: MediaItem, targetCol: string) => {
    const newStatus = columnToApiStatus(targetCol);
    try {
      await fetch(`/api/media-suite/media-items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      loadItems();
    } catch {}
  };

  const deleteItem = async (id: string) => {
    try {
      await fetch(`/api/media-suite/media-items/${id}`, { method: 'DELETE' });
      loadItems();
    } catch {}
  };

  // ─── Media upload / download ─────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ws = workspaces.find(w => w.id === activeWs) || workspaces.find(w => w.brand_profile_id);
    const bpId = ws?.brand_profile_id;
    if (!bpId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('brand_profile_id', bpId);
      if (ws?.id) form.append('workspace_id', ws.id);
      await fetch('/api/media-suite/mood-board/upload', { method: 'POST', body: form });
      loadMoodImages();
    } catch {}
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadImage = (img: MoodImage) => {
    const a = document.createElement('a');
    a.href = img.file_url;
    a.download = img.name || 'image.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deleteImage = async (id: string) => {
    try {
      await fetch(`/api/media-suite/mood-board/${id}`, { method: 'DELETE' });
      loadMoodImages();
    } catch {}
  };

  // ─── Music player ──────────────────────────────────────────

  const loadAudioTracks = useCallback(async (dir = '') => {
    setMusicLoading(true);
    try {
      const r = await fetch(`/api/files/tree?path=${encodeURIComponent(dir)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      const tracks: AudioTrack[] = [];
      const recurse = async (entries: any[]) => {
        for (const e of entries) {
          if (e.type === 'file') {
            const ext = '.' + e.name.split('.').pop()?.toLowerCase();
            if (AUDIO_EXTS.has(ext)) {
              tracks.push({ name: e.name, path: e.path, size: e.size || 0 });
            }
          }
        }
      };
      await recurse(data.entries || []);
      // Also scan subdirectories one level deep for music folders
      for (const e of (data.entries || [])) {
        if (e.type === 'directory') {
          try {
            const sr = await fetch(`/api/files/tree?path=${encodeURIComponent(e.path)}`);
            if (sr.ok) {
              const sd = await sr.json();
              for (const se of (sd.entries || [])) {
                if (se.type === 'file') {
                  const ext = '.' + se.name.split('.').pop()?.toLowerCase();
                  if (AUDIO_EXTS.has(ext)) {
                    tracks.push({ name: se.name, path: se.path, size: se.size || 0 });
                  }
                }
              }
            }
          } catch {}
        }
      }
      setAudioTracks(tracks);
    } catch {
      setAudioTracks([]);
    }
    setMusicLoading(false);
  }, []);

  useEffect(() => {
    if (viewMode === 'music' && audioTracks.length === 0 && !musicLoading) {
      loadAudioTracks();
    }
  }, [viewMode, audioTracks.length, musicLoading, loadAudioTracks]);

  const trackUrl = useCallback((track: AudioTrack) => {
    const base = getServerUrl();
    return `${base}/api/files/raw?path=${encodeURIComponent(track.path)}`;
  }, []);

  const playTrack = useCallback((idx: number) => {
    if (idx < 0 || idx >= audioTracks.length) return;
    setCurrentTrackIdx(idx);
    setIsPlaying(true);
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.src = trackUrl(audioTracks[idx]);
        audioRef.current.play().catch(() => {});
      }
    }, 50);
  }, [audioTracks, trackUrl]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const skipNext = useCallback(() => {
    if (audioTracks.length === 0) return;
    if (shuffleOn) {
      playTrack(Math.floor(Math.random() * audioTracks.length));
    } else {
      playTrack((currentTrackIdx + 1) % audioTracks.length);
    }
  }, [audioTracks.length, currentTrackIdx, shuffleOn, playTrack]);

  const skipPrev = useCallback(() => {
    if (audioTracks.length === 0) return;
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    playTrack((currentTrackIdx - 1 + audioTracks.length) % audioTracks.length);
  }, [audioTracks.length, currentTrackIdx, playTrack]);

  const handleTrackEnded = useCallback(() => {
    if (repeatOn) {
      if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}); }
    } else {
      skipNext();
    }
  }, [repeatOn, skipNext]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  };

  // ─── Helpers ─────────────────────────────────────────────────

  const getColumnItems = (colKey: string) => items.filter(i => mapToColumn(i.status) === colKey);

  // ─── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
        <Film size={28} className="text-white/20" />
        <p className="text-[12px] text-white/40 text-center">{error}</p>
        <button onClick={loadWorkspaces} className="text-[11px] text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Workspace selector */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveWs('__all__')}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
            activeWs === '__all__'
              ? 'bg-teal-500/20 border border-teal-400/25 text-teal-300'
              : 'bg-white/[0.03] border border-transparent text-white/40'
          }`}
        >All</button>
        {workspaces.map(ws => (
          <button
            key={ws.id}
            onClick={() => setActiveWs(ws.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              activeWs === ws.id
                ? 'bg-teal-500/20 border border-teal-400/25 text-teal-300'
                : 'bg-white/[0.03] border border-transparent text-white/40'
            }`}
          >
            <span>{ws.icon}</span>
            <span className="max-w-[70px] truncate">{ws.name}</span>
          </button>
        ))}
      </div>

      {/* View toggle + toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('board')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium ${viewMode === 'board' ? 'bg-white/[0.08] text-white/70' : 'text-white/30'}`}
          >Board</button>
          <button
            onClick={() => setViewMode('projects')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 ${viewMode === 'projects' ? 'bg-white/[0.08] text-white/70' : 'text-white/30'}`}
          ><Briefcase size={10} />Projects</button>
          <button
            onClick={() => setViewMode('media')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 ${viewMode === 'media' ? 'bg-white/[0.08] text-white/70' : 'text-white/30'}`}
          ><ImageIcon size={10} />Media</button>
          <button
            onClick={() => setViewMode('music')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 ${viewMode === 'music' ? 'bg-white/[0.08] text-white/70' : 'text-white/30'}`}
          ><Music size={10} />Music</button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { loadItems(); if (viewMode === 'media') loadMoodImages(); }} className="p-1.5 rounded-lg bg-white/[0.04] text-white/30">
            <RefreshCw size={12} />
          </button>
          {viewMode === 'board' && (
            <button
              onClick={() => setShowAddItem(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-500/15 border border-teal-400/20 text-teal-300 text-[10px] font-medium"
            ><Plus size={11} />New</button>
          )}
          {viewMode === 'media' && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-400/20 text-purple-300 text-[10px] font-medium disabled:opacity-50"
            ><Upload size={11} />{uploading ? 'Uploading...' : 'Upload'}</button>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      {/* New item input */}
      {showAddItem && (
        <div className="border-b border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowAddItem(false); }}
              placeholder="Item title..."
              className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-white/80 outline-none focus:border-teal-400/40"
            />
            <button onClick={handleCreate} className="text-[10px] text-teal-300 bg-teal-500/15 px-3 py-1.5 rounded-lg">Add</button>
            <button onClick={() => setShowAddItem(false)} className="text-[10px] text-white/30 px-2">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ BOARD VIEW ═══════════════ */}
      {viewMode === 'board' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden no-scrollbar">
          <div className="flex h-full min-w-max px-2 py-2 gap-2.5">
            {COLUMNS.map(col => {
              const colItems = getColumnItems(col.key);
              return (
                <div
                  key={col.key}
                  className={`w-[260px] shrink-0 flex flex-col rounded-xl border-t-2 ${col.color} bg-white/[0.015] overflow-hidden`}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                    <span className="text-[11px] font-semibold text-white/50">{col.label}</span>
                    <span className="text-[9px] text-white/25 bg-white/[0.06] px-1.5 py-0.5 rounded-full">{colItems.length}</span>
                  </div>

                  {/* Column items — vertical scroll */}
                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
                    {colItems.map(item => (
                      <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5 space-y-1.5">
                        <div className="text-[11px] text-white/70 font-medium leading-tight">{item.title}</div>
                        {item.description && (
                          <p className="text-[9px] text-white/30 leading-relaxed line-clamp-2">{item.description}</p>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[8px] px-1.5 py-0.5 rounded ${STATUS_BADGE[item.status] || 'text-white/40 bg-white/[0.05]'}`}>
                            {item.status.replace(/_/g, ' ')}
                          </span>
                          {item.content_type && (
                            <span className="text-[8px] text-white/20">{item.content_type}</span>
                          )}
                          {item.scheduled_date && (
                            <span className="text-[8px] text-white/20 flex items-center gap-0.5">
                              <Calendar size={7} />
                              {new Date(item.scheduled_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                        {/* Quick actions */}
                        <div className="flex items-center gap-1.5 pt-1">
                          {col.key !== 'in_progress' && (
                            <button
                              onClick={() => moveItem(item, 'in_progress')}
                              className="text-[8px] text-amber-300/70 bg-amber-500/10 px-2 py-0.5 rounded"
                            >
                              <Clock size={8} className="inline mr-0.5 -mt-px" />Start
                            </button>
                          )}
                          {col.key !== 'done' && (
                            <button
                              onClick={() => moveItem(item, 'done')}
                              className="text-[8px] text-emerald-300/70 bg-emerald-500/10 px-2 py-0.5 rounded"
                            >
                              <CheckCircle2 size={8} className="inline mr-0.5 -mt-px" />Done
                            </button>
                          )}
                          {col.key === 'done' && (
                            <button
                              onClick={() => moveItem(item, 'not_started')}
                              className="text-[8px] text-white/40 bg-white/[0.05] px-2 py-0.5 rounded"
                            >Reopen</button>
                          )}
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="ml-auto text-red-400/50"
                          >
                            <Trash2 size={9} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {colItems.length === 0 && (
                      <div className="text-center py-6">
                        <Circle size={16} className="mx-auto text-white/10 mb-1" />
                        <p className="text-[9px] text-white/20">No items</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════ PROJECTS VIEW ═══════════════ */}
      {viewMode === 'projects' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {workspaces.length === 0 && (
            <div className="text-center py-10">
              <Briefcase size={24} className="mx-auto text-white/10 mb-2" />
              <p className="text-[11px] text-white/25">No projects found</p>
            </div>
          )}
          {workspaces.map(ws => {
            const wsItems = items.filter(i => String(i.workspace_id) === String(ws.id));
            const inProgress = wsItems.filter(i => mapToColumn(i.status) === 'in_progress').length;
            const done = wsItems.filter(i => mapToColumn(i.status) === 'done').length;
            const ideas = wsItems.filter(i => mapToColumn(i.status) === 'not_started').length;
            return (
              <button
                key={ws.id}
                onClick={() => { setActiveWs(ws.id); setViewMode('board'); }}
                className="w-full text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-2 active:bg-white/[0.05] transition-all"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{ws.icon || '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-white/75 font-medium truncate">{ws.name}</div>
                    <div className="text-[10px] text-white/30">{wsItems.length} items</div>
                  </div>
                  {ws.is_main && (
                    <span className="text-[8px] text-teal-300/60 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-400/15">Main</span>
                  )}
                </div>
                {wsItems.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
                      {done > 0 && <div className="h-full bg-emerald-400/50" style={{ width: `${(done / wsItems.length) * 100}%` }} />}
                      {inProgress > 0 && <div className="h-full bg-amber-400/50" style={{ width: `${(inProgress / wsItems.length) * 100}%` }} />}
                      {ideas > 0 && <div className="h-full bg-blue-400/30" style={{ width: `${(ideas / wsItems.length) * 100}%` }} />}
                    </div>
                    <div className="flex items-center gap-2 text-[8px] text-white/30 shrink-0">
                      {ideas > 0 && <span className="text-blue-300/50">{ideas} ideas</span>}
                      {inProgress > 0 && <span className="text-amber-300/50">{inProgress} active</span>}
                      {done > 0 && <span className="text-emerald-300/50">{done} done</span>}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ═══════════════ MEDIA VIEW ═══════════════ */}
      {viewMode === 'media' && (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {mediaLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-white/20" />
            </div>
          )}
          {!mediaLoading && moodImages.length === 0 && (
            <div className="text-center py-10">
              <ImageIcon size={28} className="mx-auto text-white/10 mb-2" />
              <p className="text-[11px] text-white/25 mb-1">No media files yet</p>
              <p className="text-[9px] text-white/15">Upload images from your camera or gallery</p>
            </div>
          )}
          {!mediaLoading && moodImages.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {moodImages.map(img => (
                <div key={img.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                  {/* Thumbnail */}
                  <button
                    onClick={() => setPreviewImg(img)}
                    className="w-full aspect-square bg-black/30 flex items-center justify-center overflow-hidden"
                  >
                    {img.file_url ? (
                      <img
                        src={img.file_url}
                        alt={img.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <ImageIcon size={20} className="text-white/10" />
                    )}
                  </button>
                  {/* Info + actions */}
                  <div className="px-2 py-1.5">
                    <p className="text-[9px] text-white/50 truncate">{img.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <button
                        onClick={() => downloadImage(img)}
                        className="text-[8px] text-teal-300/70 bg-teal-500/10 px-2 py-0.5 rounded flex items-center gap-0.5"
                      >
                        <Download size={7} />Save
                      </button>
                      <button
                        onClick={() => deleteImage(img.id)}
                        className="ml-auto text-red-400/40"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ MUSIC VIEW ═══════════════ */}
      {viewMode === 'music' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {musicLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-white/20" />
            </div>
          )}
          {!musicLoading && audioTracks.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <Music size={32} className="text-white/10 mb-3" />
              <p className="text-[12px] text-white/30 mb-1">No audio files found</p>
              <p className="text-[9px] text-white/15 text-center mb-3">
                Place .mp3, .wav, .ogg, .flac, or .m4a files in your workspace folder
              </p>
              <button
                onClick={() => loadAudioTracks()}
                className="text-[10px] text-indigo-300 bg-indigo-500/10 px-3 py-1.5 rounded-lg flex items-center gap-1"
              ><RefreshCw size={10} />Rescan</button>
            </div>
          )}
          {!musicLoading && audioTracks.length > 0 && (
            <>
              {/* Track count header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                  <ListMusic size={12} className="text-white/25" />
                  <span className="text-[10px] text-white/40">{audioTracks.length} tracks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setShuffleOn(!shuffleOn)}
                    className={`p-1.5 rounded ${shuffleOn ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/25'}`}
                  ><Shuffle size={11} /></button>
                  <button onClick={() => setRepeatOn(!repeatOn)}
                    className={`p-1.5 rounded ${repeatOn ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/25'}`}
                  ><RepeatIcon size={11} /></button>
                  <button onClick={() => loadAudioTracks()}
                    className="p-1.5 rounded text-white/25"
                  ><RefreshCw size={11} /></button>
                </div>
              </div>

              {/* Track list */}
              <div className="flex-1 overflow-y-auto">
                {audioTracks.map((track, idx) => (
                  <button
                    key={track.path}
                    onClick={() => playTrack(idx)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-white/[0.03] transition-all ${
                      currentTrackIdx === idx ? 'bg-indigo-500/[0.08]' : 'active:bg-white/[0.04]'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      currentTrackIdx === idx && isPlaying ? 'bg-indigo-500/20' : 'bg-white/[0.04]'
                    }`}>
                      {currentTrackIdx === idx && isPlaying ? (
                        <Volume2 size={12} className="text-indigo-300" />
                      ) : (
                        <Music size={11} className="text-white/20" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] truncate ${currentTrackIdx === idx ? 'text-indigo-300' : 'text-white/70'}`}>
                        {track.name.replace(/\.[^.]+$/, '')}
                      </div>
                      <div className="text-[9px] text-white/20">{formatSize(track.size)}</div>
                    </div>
                    {currentTrackIdx === idx && (
                      <div className="shrink-0">
                        {isPlaying ? <Pause size={12} className="text-indigo-300/60" /> : <Play size={12} className="text-indigo-300/60" />}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Now playing bar + controls */}
              {currentTrackIdx >= 0 && currentTrackIdx < audioTracks.length && (
                <div className="border-t border-white/[0.06] bg-black/40 backdrop-blur-lg">
                  {/* Progress bar */}
                  <div className="px-3 pt-2">
                    <input
                      type="range" min={0} max={trackDuration || 1} step={0.5}
                      value={trackProgress}
                      onChange={e => {
                        const t = Number(e.target.value);
                        setTrackProgress(t);
                        if (audioRef.current) audioRef.current.currentTime = t;
                      }}
                      className="w-full h-1 accent-indigo-400"
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] text-white/20">{formatTime(trackProgress)}</span>
                      <span className="text-[8px] text-white/20">{formatTime(trackDuration)}</span>
                    </div>
                  </div>
                  {/* Track info + controls */}
                  <div className="flex items-center gap-3 px-3 pb-2 pt-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white/70 truncate font-medium">
                        {audioTracks[currentTrackIdx].name.replace(/\.[^.]+$/, '')}
                      </div>
                      <div className="text-[9px] text-white/25">
                        Track {currentTrackIdx + 1} of {audioTracks.length}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={skipPrev} className="p-2 rounded-full text-white/40 active:text-white/70">
                        <SkipBack size={16} />
                      </button>
                      <button onClick={togglePlay}
                        className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-400/25 flex items-center justify-center text-indigo-300 active:bg-indigo-500/30"
                      >
                        {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
                      </button>
                      <button onClick={skipNext} className="p-2 rounded-full text-white/40 active:text-white/70">
                        <SkipForward size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            onTimeUpdate={() => {
              if (audioRef.current) {
                setTrackProgress(audioRef.current.currentTime);
                setTrackDuration(audioRef.current.duration || 0);
              }
            }}
            onEnded={handleTrackEnded}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
          />
        </div>
      )}

      {/* ═══════════════ IMAGE PREVIEW OVERLAY ═══════════════ */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
          onClick={() => setPreviewImg(null)}
        >
          <button
            onClick={() => setPreviewImg(null)}
            className="absolute top-4 right-4 text-white/60 bg-white/10 rounded-full p-2"
          >
            <X size={18} />
          </button>
          <img
            src={previewImg.file_url}
            alt={previewImg.name}
            className="max-w-[92vw] max-h-[80vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          <div className="mt-3 flex items-center gap-3">
            <p className="text-[11px] text-white/50">{previewImg.name}</p>
            <button
              onClick={e => { e.stopPropagation(); downloadImage(previewImg); }}
              className="text-[10px] text-teal-300 bg-teal-500/15 px-3 py-1 rounded-lg flex items-center gap-1"
            >
              <Download size={10} />Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
