/**
 * WorkspacePanel — Spatial file browser + editor for the Substrate workspace.
 * 3D card grid with glassmorphic effects, image thumbnails, and perspective transforms.
 * Reads/writes files via /api/local/* Vite middleware endpoints.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Folder, FileText, ChevronRight, Save, X, Loader2, ArrowLeft,
  Image, Code, FileJson, FileType, Music, Film, Database, Settings, Layers, Search,
} from 'lucide-react';

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size: number;
}

interface WorkspacePanelProps {
  onClose: () => void;
  onFileHover?: (filePath: string | null, entryType?: 'file' | 'directory') => void;
  onOpenFile?: (filePath: string) => void;
  initialPath?: string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const CODE_EXTS = new Set(['py', 'ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'c', 'cpp', 'h', 'css', 'html', 'sh', 'bat']);
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'csv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'mid', 'midi']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'avi', 'mov', 'mkv']);
const DB_EXTS = new Set(['db', 'sqlite', 'sqlite3']);

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function getFileIcon(name: string) {
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return { icon: Image, color: 'text-pink-400/70' };
  if (CODE_EXTS.has(ext)) return { icon: Code, color: 'text-cyan-400/70' };
  if (DATA_EXTS.has(ext)) return { icon: FileJson, color: 'text-amber-400/70' };
  if (ext === 'md') return { icon: FileType, color: 'text-green-400/70' };
  if (AUDIO_EXTS.has(ext)) return { icon: Music, color: 'text-purple-400/70' };
  if (VIDEO_EXTS.has(ext)) return { icon: Film, color: 'text-rose-400/70' };
  if (DB_EXTS.has(ext)) return { icon: Database, color: 'text-blue-400/70' };
  if (ext === 'cfg' || ext === 'ini' || ext === 'env') return { icon: Settings, color: 'text-orange-400/70' };
  return { icon: FileText, color: 'text-white/40' };
}

function getFileAccent(name: string): string {
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return 'hover:border-pink-500/25 hover:shadow-pink-500/10';
  if (CODE_EXTS.has(ext)) return 'hover:border-cyan-500/25 hover:shadow-cyan-500/10';
  if (DATA_EXTS.has(ext)) return 'hover:border-amber-500/25 hover:shadow-amber-500/10';
  if (ext === 'md') return 'hover:border-green-500/25 hover:shadow-green-500/10';
  return 'hover:border-white/10 hover:shadow-white/5';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export function WorkspacePanel({ onFileHover, onOpenFile, initialPath }: WorkspacePanelProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editFile, setEditFile] = useState<{ path: string; content: string; dirty: boolean; type?: 'text' | 'image' | 'audio' } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'spatial'>('spatial');
  const [spatialLayer, setSpatialLayer] = useState(0);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setThumbs({});
    setSpatialLayer(0);
    setSearchQuery('');
    try {
      const r = await fetch(`/api/local/dir?path=${encodeURIComponent(dirPath)}`);
      if (r.ok) {
        const d = await r.json();
        const newEntries: DirEntry[] = d.entries || [];
        setEntries(newEntries);
        setCurrentPath(dirPath);

        // Lazy-load thumbnails for image files
        const imageFiles = newEntries.filter(e => e.type === 'file' && IMAGE_EXTS.has(getExt(e.name))).slice(0, 20);
        for (const img of imageFiles) {
          fetch(`/api/local/file-read?path=${encodeURIComponent(img.path)}`)
            .then(r2 => r2.ok ? r2.json() : null)
            .then(d2 => {
              if (d2?.type === 'image' && d2.content) {
                setThumbs(prev => ({ ...prev, [img.path]: d2.content }));
              }
            })
            .catch(() => {});
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDir(initialPath || ''); }, [fetchDir, initialPath]);

  const openFile = useCallback(async (filePath: string) => {
    setEditLoading(true);
    setEditFile({ path: filePath, content: '', dirty: false, type: 'text' });
    try {
      const r = await fetch(`/api/local/file-read?path=${encodeURIComponent(filePath)}`);
      if (r.ok) {
        const d = await r.json();
        const fileType = d.type === 'image' ? 'image' as const : d.type === 'audio' ? 'audio' as const : 'text' as const;
        setEditFile({ path: filePath, content: d.content || '', dirty: false, type: fileType });
      } else {
        setEditFile({ path: filePath, content: `// Failed to load: ${r.status}`, dirty: false, type: 'text' });
      }
    } catch (err) {
      setEditFile({ path: filePath, content: `// Error: ${err}`, dirty: false, type: 'text' });
    }
    setEditLoading(false);
  }, []);

  const saveFile = useCallback(async () => {
    if (!editFile?.dirty) return;
    try {
      const r = await fetch('/api/local/file-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editFile.path, content: editFile.content }),
      });
      if (r.ok) setEditFile(prev => prev ? { ...prev, dirty: false } : null);
    } catch { /* ignore */ }
  }, [editFile]);

  const goUp = useCallback(() => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    fetchDir(parts.join('/'));
    setEditFile(null);
  }, [currentPath, fetchDir]);

  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const dirCount = entries.filter(e => e.type === 'directory').length;
  const fileCount = entries.filter(e => e.type === 'file').length;

  // Filter entries by search query — matches name, path, and extension
  const q = searchQuery.toLowerCase().trim();
  const filteredEntries = q ? entries.filter(e => {
    const name = e.name.toLowerCase();
    const path = e.path.toLowerCase();
    // Direct substring match on name or path
    if (name.includes(q) || path.includes(q)) return true;
    // Extension match: query like ".mp3" or "mp3" matches files ending with that ext
    const extQuery = q.startsWith('.') ? q : `.${q}`;
    if (name.endsWith(extQuery)) return true;
    return false;
  }) : entries;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar: search + view toggle + stats */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] shrink-0">
        {!editFile && (
          <div className="flex-1 flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2 py-1 focus-within:border-white/[0.12] transition-colors">
            <Search size={11} className="text-white/25 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search files…"
              className="flex-1 bg-transparent text-[11px] text-white/80 placeholder:text-white/20 outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-white/20 hover:text-white/50 transition-colors">
                <X size={10} />
              </button>
            )}
          </div>
        )}
        {!editFile && (
          <span className="text-[9px] text-white/25 shrink-0">{dirCount}d·{fileCount}f</span>
        )}
        {!editFile && (
          <button
            onClick={() => setViewMode(v => v === 'grid' ? 'list' : v === 'list' ? 'spatial' : 'grid')}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/[0.06] transition-all text-[9px] font-mono shrink-0"
            title={viewMode === 'grid' ? 'List view' : viewMode === 'list' ? 'Spatial view' : 'Grid view'}
          >
            {viewMode === 'grid' ? '≡' : viewMode === 'list' ? <Layers size={11} /> : '⊞'}
          </button>
        )}
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/[0.03] text-[10px] text-white/40 overflow-x-auto flex-shrink-0">
        {currentPath && (
          <button onClick={goUp} className="text-white/30 hover:text-white/60 transition-colors mr-1">
            <ArrowLeft size={11} />
          </button>
        )}
        <button onClick={() => { fetchDir(''); setEditFile(null); }} className="hover:text-white/60 transition-colors">root</button>
        {breadcrumbs.map((part, i) => {
          const pathTo = breadcrumbs.slice(0, i + 1).join('/');
          return (
            <span key={pathTo} className="flex items-center gap-1">
              <ChevronRight size={9} className="text-white/20" />
              <button onClick={() => { fetchDir(pathTo); setEditFile(null); }} className="hover:text-white/60 transition-colors">{part}</button>
            </span>
          );
        })}
      </div>

      {/* File editor or directory listing */}
      {editFile ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04] flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setEditFile(null)} className="text-white/30 hover:text-white/60 transition-colors">
                <ArrowLeft size={12} />
              </button>
              {(() => { const fi = getFileIcon(editFile.path); return <fi.icon size={12} className={`${fi.color} shrink-0`} />; })()}
              <span className="text-[11px] text-white/70 truncate font-mono">{editFile.path.split('/').pop()}</span>
              {editFile.dirty && <span className="text-[9px] text-amber-400/60">modified</span>}
            </div>
            {editFile.dirty && (
              <button onClick={saveFile} className="w-5 h-5 rounded flex items-center justify-center text-green-400/60 hover:text-green-400 hover:bg-white/[0.06] transition-all" title="Save">
                <Save size={11} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden relative">
            {editLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={16} className="text-indigo-400/50 animate-spin" />
              </div>
            ) : editFile.type === 'image' ? (
              <div className="flex flex-col items-center justify-center h-full p-3 gap-2 overflow-auto">
                <img
                  src={editFile.content}
                  alt={editFile.path}
                  className="max-w-full max-h-[calc(100%-1.5rem)] object-contain rounded-lg shadow-lg shadow-black/30 border border-white/[0.06]"
                />
                <span className="text-[9px] text-white/25 font-mono">{editFile.path.split('/').pop()}</span>
              </div>
            ) : editFile.type === 'audio' ? (
              <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 via-indigo-500/20 to-cyan-500/20 border border-white/[0.08] flex items-center justify-center shadow-lg shadow-purple-500/10">
                  <Music size={28} className="text-purple-400/60" />
                </div>
                <div className="text-center">
                  <div className="text-[11px] font-semibold text-white/80">{editFile.path.split('/').pop()}</div>
                  <div className="text-[9px] text-white/25 font-mono mt-0.5">{editFile.path}</div>
                </div>
                <audio
                  controls
                  src={editFile.content}
                  className="w-full max-w-xs"
                  style={{ filter: 'invert(0.85) hue-rotate(180deg)', borderRadius: '8px' }}
                />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={editFile.content}
                onChange={e => setEditFile(prev => prev ? { ...prev, content: e.target.value, dirty: true } : null)}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    saveFile();
                  }
                }}
                spellCheck={false}
                className="w-full h-full bg-transparent text-white/80 text-[11px] leading-relaxed font-mono p-3 resize-none focus:outline-none selection:bg-indigo-500/30"
                style={{ tabSize: 2 }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className={`flex-1 ${viewMode === 'spatial' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`} style={viewMode !== 'spatial' ? { perspective: '800px' } : undefined}>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={16} className="text-white/30 animate-spin" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center text-white/20 text-xs py-8">{q ? 'No matches' : 'Empty directory'}</div>
          ) : viewMode === 'grid' ? (
            /* ── Spatial 3D Card Grid ── */
            <div className="grid grid-cols-3 gap-2 p-2.5" style={{ transformStyle: 'preserve-3d' }}>
              {filteredEntries.map((entry, i) => {
                const isDir = entry.type === 'directory';
                const ext = getExt(entry.name);
                const isImg = !isDir && IMAGE_EXTS.has(ext);
                const fi = isDir ? null : getFileIcon(entry.name);
                const accent = isDir ? 'hover:border-amber-500/25 hover:shadow-amber-500/10' : getFileAccent(entry.name);
                const thumb = thumbs[entry.path];

                return (
                  <button
                    key={entry.path}
                    onClick={() => isDir ? fetchDir(entry.path) : (onOpenFile ? onOpenFile(entry.path) : openFile(entry.path))}
                    onMouseEnter={() => onFileHover?.(entry.path, entry.type as 'file' | 'directory')}
                    onMouseLeave={() => onFileHover?.(null)}
                    className={`
                      group relative flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl
                      border border-white/[0.05] bg-white/[0.02]
                      transition-all duration-200 ease-out cursor-pointer text-center
                      hover:bg-white/[0.06] hover:shadow-lg hover:-translate-y-0.5
                      ${accent}
                    `}
                    style={{
                      minHeight: isImg && thumb ? 90 : 72,
                      animationDelay: `${i * 20}ms`,
                      transformStyle: 'preserve-3d',
                    }}
                  >
                    {/* Thumbnail or icon */}
                    {isImg && thumb ? (
                      <div className="w-full h-14 rounded-lg overflow-hidden border border-white/[0.04] bg-black/20">
                        <img src={thumb} alt={entry.name} className="w-full h-full object-cover" />
                      </div>
                    ) : isDir ? (
                      <Folder size={22} className="text-amber-400/50 group-hover:text-amber-400/80 transition-colors" />
                    ) : fi ? (
                      <fi.icon size={20} className={`${fi.color} group-hover:opacity-100 opacity-60 transition-all`} />
                    ) : null}

                    {/* Label */}
                    <span className={`text-[9px] leading-tight truncate w-full ${isDir ? 'text-white/60 font-medium' : 'text-white/40 group-hover:text-white/65'} transition-colors`}>
                      {entry.name.length > 14 ? entry.name.slice(0, 12) + '…' : entry.name}
                    </span>

                    {/* Size badge */}
                    {!isDir && entry.size > 0 && (
                      <span className="absolute top-1 right-1.5 text-[7px] text-white/15 font-mono">{formatSize(entry.size)}</span>
                    )}

                    {/* Glow effect on hover */}
                    <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{ background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 70%)' }}
                    />
                  </button>
                );
              })}
            </div>
          ) : viewMode === 'list' ? (
            /* ── List view ── */
            <div className="py-1">
              {filteredEntries.map(entry => {
                const isDir = entry.type === 'directory';
                const fi = isDir ? null : getFileIcon(entry.name);
                return (
                  <button
                    key={entry.path}
                    onClick={() => isDir ? fetchDir(entry.path) : (onOpenFile ? onOpenFile(entry.path) : openFile(entry.path))}
                    onMouseEnter={() => onFileHover?.(entry.path, entry.type as 'file' | 'directory')}
                    onMouseLeave={() => onFileHover?.(null)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04] transition-colors group text-left"
                  >
                    {isDir ? (
                      <Folder size={13} className="text-amber-400/60 shrink-0" />
                    ) : fi ? (
                      <fi.icon size={13} className={`${fi.color} shrink-0`} />
                    ) : (
                      <FileText size={13} className="text-white/30 shrink-0" />
                    )}
                    <span className={`text-[11px] truncate flex-1 ${isDir ? 'text-white/70' : 'text-white/50 group-hover:text-white/70'}`}>
                      {entry.name}
                    </span>
                    {!isDir && entry.size > 0 && (
                      <span className="text-[9px] text-white/20 font-mono shrink-0">{formatSize(entry.size)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            /* ── Z-Stack Spatial View ── */
            (() => {
              // Group entries by category
              const dirs = filteredEntries.filter(e => e.type === 'directory');
              const filesByCategory: Record<string, DirEntry[]> = {};
              filteredEntries.filter(e => e.type === 'file').forEach(e => {
                const ext = getExt(e.name);
                const cat = IMAGE_EXTS.has(ext) ? 'Images'
                  : CODE_EXTS.has(ext) ? 'Code'
                  : DATA_EXTS.has(ext) ? 'Data'
                  : ext === 'md' ? 'Docs'
                  : AUDIO_EXTS.has(ext) ? 'Audio'
                  : VIDEO_EXTS.has(ext) ? 'Video'
                  : DB_EXTS.has(ext) ? 'Database'
                  : 'Other';
                (filesByCategory[cat] ??= []).push(e);
              });

              const groups: Array<{ label: string; icon: typeof Folder; color: string; hex: string; items: DirEntry[] }> = [];
              if (dirs.length > 0) groups.push({ label: 'Folders', icon: Folder, color: 'text-amber-400', hex: '#fbbf24', items: dirs });

              const cc: Record<string, { icon: typeof Folder; color: string; hex: string }> = {
                Code: { icon: Code, color: 'text-cyan-400', hex: '#22d3ee' },
                Data: { icon: FileJson, color: 'text-amber-400', hex: '#fbbf24' },
                Docs: { icon: FileType, color: 'text-green-400', hex: '#4ade80' },
                Images: { icon: Image, color: 'text-pink-400', hex: '#f472b6' },
                Audio: { icon: Music, color: 'text-purple-400', hex: '#c084fc' },
                Video: { icon: Film, color: 'text-rose-400', hex: '#fb7185' },
                Database: { icon: Database, color: 'text-blue-400', hex: '#60a5fa' },
                Other: { icon: FileText, color: 'text-white/50', hex: '#94a3b8' },
              };
              for (const [cat, items] of Object.entries(filesByCategory)) {
                const cfg = cc[cat] || cc.Other;
                groups.push({ label: cat, icon: cfg.icon, color: cfg.color, hex: cfg.hex, items });
              }

              const layerCount = groups.length;
              const activeLayer = Math.min(spatialLayer, layerCount - 1);

              return (
                <div
                  className="relative flex-1 overflow-hidden outline-none"
                  tabIndex={0}
                  onWheel={e => {
                    if (e.deltaY > 0) setSpatialLayer(l => Math.min(l + 1, layerCount - 1));
                    else setSpatialLayer(l => Math.max(l - 1, 0));
                  }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setSpatialLayer(l => Math.min(l + 1, layerCount - 1)); }
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setSpatialLayer(l => Math.max(l - 1, 0)); }
                  }}
                >
                  {/* All layers stacked absolutely */}
                  {groups.map((group, gi) => {
                    const offset = gi - activeLayer;
                    // active = 0: full size, fully visible, interactive
                    // behind (+1, +2…): scale down, push down, fade, blur
                    // passed (-1, -2…): slide up and vanish
                    const isActive = offset === 0;
                    const isBehind = offset > 0;
                    const scale = isActive ? 1 : isBehind ? Math.max(0.7, 1 - offset * 0.08) : 0.95;
                    const yPx = isActive ? 0 : isBehind ? offset * 40 : offset * 80;
                    const op = isActive ? 1 : isBehind ? Math.max(0, 0.6 - (offset - 1) * 0.25) : 0;
                    const bl = isActive ? 0 : isBehind ? offset * 3.5 : 0;

                    return (
                      <div
                        key={group.label}
                        className="absolute inset-0 flex flex-col"
                        style={{
                          transform: `translateY(${yPx}px) scale(${scale})`,
                          transformOrigin: '50% 0%',
                          opacity: op,
                          filter: bl > 0 ? `blur(${bl}px)` : 'none',
                          pointerEvents: isActive ? 'auto' : 'none',
                          transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease, filter 0.35s ease',
                          zIndex: isActive ? 50 : isBehind ? 40 - offset : 30,
                        }}
                      >
                        {/* Layer header */}
                        <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 shrink-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${group.hex}15`, border: `1px solid ${group.hex}25` }}>
                            <group.icon size={14} style={{ color: group.hex }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: group.hex }}>{group.label}</div>
                            <div className="text-[9px] text-white/25">{group.items.length} items</div>
                          </div>
                          {layerCount > 1 && (
                            <span className="text-[9px] text-white/20 font-mono shrink-0">{gi + 1}/{layerCount}</span>
                          )}
                        </div>

                        {/* Item grid — 2D barrel cylinder: curved by default, flattens on hover */}
                        <div
                          className="flex-1 overflow-y-auto px-2 pb-12"
                          style={{ scrollbarWidth: 'none' }}
                        >
                          {(() => {
                            const rows: DirEntry[][] = [];
                            for (let r = 0; r < group.items.length; r += 4) {
                              rows.push(group.items.slice(r, r + 4));
                            }
                            const totalRows = rows.length;
                            const midRow = (totalRows - 1) / 2;

                            // Per-card barrel offsets (2D simulation of cylinder):
                            // Edge cards: scale down, shift inward (translateX), shift down (translateY)
                            // Center cards: full size, no shift
                            const barrelCard = (ci: number, colCount: number) => {
                              const mid = (colCount - 1) / 2; // 1.5 for 4 cols
                              const dist = Math.abs(ci - mid) / mid; // 0 (center) .. 1 (edge)
                              const dist2 = dist * dist; // quadratic for smoother curve
                              const sign = ci < mid ? 1 : -1;     // left cards tilt right, right tilt left
                              return {
                                scale: 1 - dist2 * 0.22,          // 1.0 center, 0.78 edge
                                translateY: dist2 * 24,             // 0px center, 24px edge (curve down)
                                translateX: (ci - mid) * -dist * 7, // pinch inward at edges
                                rotateY: sign * dist * 35,          // 0° center, ±35° edge — real 3D tilt
                                opacity: 1 - dist2 * 0.35,          // 1.0 center, 0.65 edge
                              };
                            };

                            return rows.map((row, ri) => {
                              // Row-level barrel: rows far from center scale down, shift in
                              const rowDist = totalRows <= 1 ? 0 : Math.abs(ri - midRow) / Math.max(midRow, 1);
                              const rowDist2 = rowDist * rowDist;
                              const rowScale = 1 - rowDist2 * 0.14;
                              const rowOp = Math.max(0.35, 1 - rowDist2 * 0.55);

                              return (
                              <div
                                key={ri}
                                data-cyrow={ri}
                                className="flex gap-2 mb-2 justify-center"
                                style={{
                                  transformOrigin: '50% 50%',
                                  transform: `scale(${rowScale})`,
                                  opacity: rowOp,
                                  perspective: '400px',
                                  transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
                                }}
                                onMouseEnter={e => {
                                  const rowEl = e.currentTarget;
                                  rowEl.dataset.hovered = '1';
                                  // Flatten row: full scale, full opacity
                                  rowEl.style.transform = 'scale(1)';
                                  rowEl.style.opacity = '1';
                                  // Flatten cards
                                  const cards = rowEl.querySelectorAll<HTMLElement>('[data-cycard]');
                                  cards.forEach(card => {
                                    card.style.transform = 'translate(0px, 0px) scale(1) rotateY(0deg)';
                                    card.style.opacity = '1';
                                  });
                                }}
                                onMouseMove={e => {
                                  // Localized flattening: cards near cursor flatten, far keep barrel
                                  const rowEl = e.currentTarget;
                                  if (rowEl.dataset.hovered !== '1') return;
                                  const rect = rowEl.getBoundingClientRect();
                                  const mouseXpct = (e.clientX - rect.left) / rect.width;
                                  const cards = rowEl.querySelectorAll<HTMLElement>('[data-cycard]');
                                  const colCount = cards.length;
                                  cards.forEach(card => {
                                    const ci = parseInt(card.dataset.cycard || '0');
                                    const colPct = (ci + 0.5) / colCount;
                                    const proximity = Math.abs(colPct - mouseXpct);
                                    // Near cursor (proximity<0.15): almost flat. Far: partial barrel.
                                    const barrelKeep = Math.min(1, proximity * 3) * 0.6; // 0..0.6
                                    const b = barrelCard(ci, colCount);
                                    const ty = b.translateY * barrelKeep;
                                    const tx = b.translateX * barrelKeep;
                                    const sc = 1 - (1 - b.scale) * barrelKeep;
                                    const ry = b.rotateY * barrelKeep;
                                    card.style.transform = `translate(${tx}px, ${ty}px) scale(${sc}) rotateY(${ry}deg)`;
                                    card.style.opacity = `${1 - (1 - b.opacity) * barrelKeep}`;
                                  });
                                }}
                                onMouseLeave={e => {
                                  const rowEl = e.currentTarget;
                                  rowEl.dataset.hovered = '0';
                                  // Restore row barrel
                                  rowEl.style.transform = `scale(${rowScale})`;
                                  rowEl.style.opacity = `${rowOp}`;
                                  // Restore card barrel
                                  const cards = rowEl.querySelectorAll<HTMLElement>('[data-cycard]');
                                  const colCount = cards.length;
                                  cards.forEach(card => {
                                    const ci = parseInt(card.dataset.cycard || '0');
                                    const b = barrelCard(ci, colCount);
                                    card.style.transform = `translate(${b.translateX}px, ${b.translateY}px) scale(${b.scale}) rotateY(${b.rotateY}deg)`;
                                    card.style.opacity = `${b.opacity}`;
                                  });
                                }}
                              >
                                {row.map((entry, ci) => {
                                  const isDir = entry.type === 'directory';
                                  const ext = getExt(entry.name);
                                  const isImg = !isDir && IMAGE_EXTS.has(ext);
                                  const fi = isDir ? null : getFileIcon(entry.name);
                                  const thumb = thumbs[entry.path];
                                  const accent = isDir ? 'hover:border-amber-500/20' : getFileAccent(entry.name);
                                  const b = barrelCard(ci, row.length);

                                  return (
                                    <button
                                      key={entry.path}
                                      data-cycard={ci}
                                      onClick={() => isDir ? fetchDir(entry.path) : (onOpenFile ? onOpenFile(entry.path) : openFile(entry.path))}
                                      onMouseEnter={() => onFileHover?.(entry.path, entry.type as 'file' | 'directory')}
                                      onMouseLeave={() => onFileHover?.(null)}
                                      className={`group/card relative flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.06] cursor-pointer hover:shadow-lg ${accent}`}
                                      style={{
                                        width: 'calc(25% - 6px)',
                                        minHeight: isImg && thumb ? 80 : 68,
                                        transform: `translate(${b.translateX}px, ${b.translateY}px) scale(${b.scale}) rotateY(${b.rotateY}deg)`,
                                        transformOrigin: '50% 50%',
                                        opacity: b.opacity,
                                        transition: 'transform 0.3s ease-out, opacity 0.3s ease-out, background 0.2s, border-color 0.2s, box-shadow 0.2s',
                                      }}
                                    >
                                      {isImg && thumb ? (
                                        <div className="w-full h-12 rounded-lg overflow-hidden border border-white/[0.04] bg-black/20">
                                          <img src={thumb} alt={entry.name} className="w-full h-full object-cover" />
                                        </div>
                                      ) : isDir ? (
                                        <Folder size={22} className="text-amber-400/50 group-hover/card:text-amber-400/80 transition-colors" />
                                      ) : fi ? (
                                        <fi.icon size={20} className={`${fi.color} group-hover/card:opacity-100 opacity-60 transition-all`} />
                                      ) : null}

                                      <span className={`text-[8px] leading-tight truncate w-full text-center ${isDir ? 'text-white/60 font-medium' : 'text-white/40 group-hover/card:text-white/65'} transition-colors`}>
                                        {entry.name.length > 12 ? entry.name.slice(0, 11) + '…' : entry.name}
                                      </span>

                                      {!isDir && entry.size > 0 && (
                                        <span className="text-[6px] text-white/15 font-mono">{formatSize(entry.size)}</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    );
                  })}

                  {/* Layer navigation dots — bottom center */}
                  {layerCount > 1 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/[0.08]">
                      {groups.map((g, i) => (
                        <button
                          key={g.label}
                          onClick={() => setSpatialLayer(i)}
                          className="transition-all duration-200"
                          title={g.label}
                        >
                          <div
                            className="rounded-full transition-all duration-300"
                            style={{
                              width: i === activeLayer ? 20 : 6,
                              height: 6,
                              background: i === activeLayer ? g.hex : 'rgba(255,255,255,0.2)',
                              boxShadow: i === activeLayer ? `0 0 8px ${g.hex}50` : 'none',
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {layerCount === 0 && (
                    <div className="flex items-center justify-center h-full text-white/20 text-xs">Empty directory</div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
