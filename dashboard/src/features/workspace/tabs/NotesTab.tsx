/**
 * NotesTab — Premium Obsidian-style markdown note editor.
 * Features: Rich editor with syntax highlighting, quick switcher (Ctrl+P),
 * full-text search (Ctrl+Shift+F), formatting hotkeys, auto-save,
 * word count, inline rename, wiki-style [[links]].
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  FilePlus, FolderPlus, Trash2, Eye, Pencil, Search, Command,
  ChevronRight, ChevronDown, FileText, Folder, X, Hash, Clock,
  Edit3, MoreHorizontal, Pin, PinOff, Sparkles, Mic, MicOff, Loader2,
} from 'lucide-react';
import { useNotes, type NoteEntry } from '../hooks/useNotes';
import { EditorView, keymap, placeholder as placeholderExt, highlightActiveLine, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';

// ─── Constants ─────────────────────────────────────────────────

const AUTOSAVE_DELAY = 1500;
const RECENT_NOTES_KEY = 'substrate:notes:recent';
const PINNED_NOTES_KEY = 'substrate:notes:pinned';
const MAX_RECENT = 8;

// ─── Utilities ─────────────────────────────────────────────────

function getWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function getCharCount(text: string): number {
  return text.length;
}

function getReadingTime(words: number): string {
  const mins = Math.ceil(words / 200);
  return mins <= 1 ? '< 1 min' : `${mins} min`;
}

function getParentPath(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

function getFileName(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function stripMdExt(name: string): string {
  return name.replace(/\.md$/, '');
}

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_NOTES_KEY) || '[]'); } catch { return []; }
}

function saveRecent(paths: string[]) {
  try { localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(paths.slice(0, MAX_RECENT))); } catch {}
}

function loadPinned(): string[] {
  try { return JSON.parse(localStorage.getItem(PINNED_NOTES_KEY) || '[]'); } catch { return []; }
}

function savePinned(paths: string[]) {
  try { localStorage.setItem(PINNED_NOTES_KEY, JSON.stringify(paths)); } catch {}
}

// ─── Tree Builder ──────────────────────────────────────────────

interface TreeNode {
  entry: NoteEntry;
  children: TreeNode[];
}

function buildTree(entries: NoteEntry[]): TreeNode[] {
  const folders = entries.filter(e => e.type === 'folder');
  const files = entries.filter(e => e.type === 'file');
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const f of folders) nodeMap.set(f.path, { entry: f, children: [] });

  for (const f of folders) {
    const parent = getParentPath(f.path);
    if (parent && nodeMap.has(parent)) nodeMap.get(parent)!.children.push(nodeMap.get(f.path)!);
    else roots.push(nodeMap.get(f.path)!);
  }

  for (const f of files) {
    const node: TreeNode = { entry: f, children: [] };
    const parent = getParentPath(f.path);
    if (parent && nodeMap.has(parent)) nodeMap.get(parent)!.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.entry.type !== b.entry.type) return a.entry.type === 'folder' ? -1 : 1;
      return a.entry.name.localeCompare(b.entry.name);
    });
    nodes.forEach(n => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

// ─── Note Tree Item ────────────────────────────────────────────

interface NoteTreeItemProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (entry: NoteEntry) => void;
  onDelete: (entry: NoteEntry) => void;
  onRename: (entry: NoteEntry) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  pinnedPaths: string[];
  onTogglePin: (path: string) => void;
}

function NoteTreeItem({ node, depth, activePath, onSelect, onDelete, onRename, expandedFolders, toggleFolder, pinnedPaths, onTogglePin }: NoteTreeItemProps) {
  const { entry } = node;
  const isFolder = entry.type === 'folder';
  const isExpanded = expandedFolders.has(entry.path);
  const isActive = activePath === entry.path;
  const isPinned = pinnedPaths.includes(entry.path);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      <div
        className={`flex items-center gap-1 px-1 py-[3px] cursor-pointer rounded-[3px] text-[11px] transition-all group relative ${
          isActive
            ? 'bg-white/[0.08] text-white/90'
            : 'text-white/55 hover:bg-white/[0.04] hover:text-white/75'
        }`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={() => isFolder ? toggleFolder(entry.path) : onSelect(entry)}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(s => !s); }}
      >
        {isFolder ? (
          <span className="w-3 flex items-center justify-center shrink-0">
            {isExpanded ? <ChevronDown size={10} className="text-white/30" /> : <ChevronRight size={10} className="text-white/30" />}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isFolder ? (
          <Folder size={11} className="text-amber-400/60 shrink-0" />
        ) : (
          <FileText size={11} className={`shrink-0 ${isActive ? 'text-purple-400/80' : 'text-white/25'}`} />
        )}
        <span className="flex-1 truncate select-none">{stripMdExt(entry.name)}</span>
        {isPinned && <Pin size={8} className="text-amber-400/50 shrink-0" />}
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(s => !s); }}
          className="opacity-0 group-hover:opacity-50 hover:!opacity-100 p-0.5 transition-opacity shrink-0"
        >
          <MoreHorizontal size={10} />
        </button>

        {/* Context menu */}
        {showMenu && (
          <div
            className="absolute right-0 top-full z-50 mt-0.5 py-1 min-w-[120px] rounded-md bg-[#1a1a2e] border border-white/[0.08] shadow-xl shadow-black/40"
            onMouseLeave={() => setShowMenu(false)}
          >
            {!isFolder && (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(entry.path); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-white/60 hover:text-white/90 hover:bg-white/[0.06] transition-colors"
              >
                {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
                {isPinned ? 'Unpin' : 'Pin to top'}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onRename(entry); setShowMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-white/60 hover:text-white/90 hover:bg-white/[0.06] transition-colors"
            >
              <Edit3 size={10} />
              Rename
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(entry); setShowMenu(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-400/[0.06] transition-colors"
            >
              <Trash2 size={10} />
              Delete
            </button>
          </div>
        )}
      </div>
      {isFolder && isExpanded && node.children.map(child => (
        <NoteTreeItem
          key={child.entry.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          pinnedPaths={pinnedPaths}
          onTogglePin={onTogglePin}
        />
      ))}
    </>
  );
}

// ─── Quick Switcher Modal ──────────────────────────────────────

interface QuickSwitcherProps {
  entries: NoteEntry[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

function QuickSwitcher({ entries, onSelect, onClose }: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const files = useMemo(() => entries.filter(e => e.type === 'file'), [entries]);
  const filtered = useMemo(() => {
    if (!query.trim()) return files.slice(0, 15);
    const q = query.toLowerCase();
    return files
      .filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 15);
  }, [files, query]);

  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => { setSelectedIdx(0); }, [filtered]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[selectedIdx]) { onSelect(filtered[selectedIdx].path); }
    else if (e.key === 'Escape') { onClose(); }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15%]" onClick={onClose}>
      <div
        className="w-[320px] max-h-[360px] rounded-lg bg-[#0d0d1a]/95 border border-white/[0.08] shadow-2xl shadow-black/60 backdrop-blur-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <Search size={13} className="text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Quick open note…"
            className="flex-1 bg-transparent text-[12px] text-white/90 placeholder:text-white/25 outline-none"
          />
          <kbd className="text-[9px] text-white/20 bg-white/[0.04] px-1.5 py-0.5 rounded">Esc</kbd>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="text-center text-white/20 text-[11px] py-6">No notes found</div>
          )}
          {filtered.map((f, i) => (
            <button
              key={f.path}
              onClick={() => onSelect(f.path)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                i === selectedIdx ? 'bg-purple-500/10 text-white/90' : 'text-white/55 hover:bg-white/[0.03]'
              }`}
            >
              <FileText size={12} className={i === selectedIdx ? 'text-purple-400/70' : 'text-white/20'} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate">{stripMdExt(f.name)}</div>
                {f.path !== f.name && (
                  <div className="text-[9px] text-white/20 truncate">{getParentPath(f.path)}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Search Panel ──────────────────────────────────────────────

interface SearchResult {
  path: string;
  name: string;
  matches: { line: number; text: string }[];
  matchCount: number;
}

interface SearchPanelProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

function SearchPanel({ onSelect, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/notes/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.ok) setResults(data.results || []);
    } catch {}
    setSearching(false);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[10%]" onClick={onClose}>
      <div
        className="w-[360px] max-h-[420px] rounded-lg bg-[#0d0d1a]/95 border border-white/[0.08] shadow-2xl shadow-black/60 backdrop-blur-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <Search size={13} className="text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
            placeholder="Search across all notes…"
            className="flex-1 bg-transparent text-[12px] text-white/90 placeholder:text-white/25 outline-none"
          />
          {searching && <div className="w-3 h-3 border border-white/20 border-t-purple-400 rounded-full animate-spin" />}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {results.length === 0 && query && !searching && (
            <div className="text-center text-white/20 text-[11px] py-6">No results</div>
          )}
          {results.map(r => (
            <button
              key={r.path}
              onClick={() => { onSelect(r.path); onClose(); }}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors border-b border-white/[0.03] last:border-0"
            >
              <div className="flex items-center gap-2">
                <FileText size={11} className="text-purple-400/50 shrink-0" />
                <span className="text-[11px] text-white/80 truncate">{stripMdExt(r.name)}</span>
                <span className="text-[9px] text-white/20 ml-auto shrink-0">{r.matchCount} match{r.matchCount > 1 ? 'es' : ''}</span>
              </div>
              {r.matches.slice(0, 2).map((m, i) => (
                <div key={i} className="text-[10px] text-white/30 truncate pl-5 mt-0.5">
                  <span className="text-white/15 mr-1">L{m.line}</span>
                  {m.text}
                </div>
              ))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Editor Component ──────────────────────────────────────────

interface NoteEditorProps {
  content: string;
  onChange: (value: string) => void;
  onSave?: () => void;
}

function NoteEditor({ content, onChange, onSave }: NoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!editorRef.current) return;

    const customKeymap = keymap.of([
      { key: 'Mod-s', run: () => { onSaveRef.current?.(); return true; } },
      { key: 'Mod-b', run: (view) => { wrapSelection(view, '**'); return true; } },
      { key: 'Mod-i', run: (view) => { wrapSelection(view, '_'); return true; } },
      { key: 'Mod-k', run: (view) => { insertLink(view); return true; } },
      { key: 'Mod-Shift-x', run: (view) => { wrapSelection(view, '~~'); return true; } },
      { key: 'Mod-Shift-c', run: (view) => { wrapSelection(view, '`'); return true; } },
    ]);

    const state = EditorState.create({
      doc: content,
      extensions: [
        customKeymap,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        drawSelection(),
        placeholderExt('Start writing…\n\nUse Ctrl+B for bold, Ctrl+I for italic, Ctrl+K for links.'),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13.5px',
            backgroundColor: 'transparent',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            padding: '0',
          },
          '.cm-content': {
            padding: '24px 32px',
            maxWidth: '720px',
            margin: '0 auto',
            caretColor: '#a78bfa',
          },
          '.cm-cursor': {
            borderLeftColor: '#a78bfa',
            borderLeftWidth: '2px',
          },
          '.cm-gutters': { display: 'none' },
          '&.cm-focused': { outline: 'none' },
          '.cm-line': {
            lineHeight: '1.75',
            padding: '0 2px',
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(167, 139, 250, 0.03)',
          },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(167, 139, 250, 0.15) !important',
          },
          '.cm-matchingBracket': {
            backgroundColor: 'rgba(167, 139, 250, 0.2)',
            outline: 'none',
          },
          // Markdown heading styles
          '.cm-header-1': { fontSize: '1.6em', fontWeight: '700', color: '#e2e8f0' },
          '.cm-header-2': { fontSize: '1.35em', fontWeight: '600', color: '#cbd5e1' },
          '.cm-header-3': { fontSize: '1.15em', fontWeight: '600', color: '#94a3b8' },
          '.cm-header-4': { fontSize: '1.05em', fontWeight: '500', color: '#94a3b8' },
          // Emphasis
          '.cm-strong': { fontWeight: '600', color: '#f1f5f9' },
          '.cm-emphasis': { fontStyle: 'italic', color: '#c4b5fd' },
          '.cm-strikethrough': { textDecoration: 'line-through', color: 'rgba(255,255,255,0.35)' },
          // Code
          '.cm-monospace': {
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
            fontSize: '0.88em',
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: '3px',
            padding: '1px 4px',
          },
          // Links
          '.cm-link': { color: '#818cf8', textDecoration: 'underline' },
          '.cm-url': { color: 'rgba(129, 140, 248, 0.5)' },
          // Lists
          '.cm-list': { color: '#94a3b8' },
          // Search match highlight
          '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.2)', borderRadius: '2px' },
          '.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.35)' },
          // Placeholder
          '.cm-placeholder': { color: 'rgba(255,255,255,0.15)', fontStyle: 'italic' },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return <div ref={editorRef} className="h-full w-full overflow-hidden bg-transparent" />;
}

// ─── Formatting Helpers ────────────────────────────────────────

function wrapSelection(view: EditorView, marker: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const wrapped = `${marker}${selected}${marker}`;
  view.dispatch({ changes: { from, to, insert: wrapped }, selection: { anchor: from + marker.length, head: from + marker.length + selected.length } });
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected) {
    const inserted = `[${selected}](url)`;
    view.dispatch({ changes: { from, to, insert: inserted }, selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 } });
  } else {
    const inserted = '[text](url)';
    view.dispatch({ changes: { from, to, insert: inserted }, selection: { anchor: from + 1, head: from + 5 } });
  }
}

// ─── Main Notes Tab ────────────────────────────────────────────

// ─── Analysis Panel Component ─────────────────────────────────

interface AnalysisResult {
  noteType: string;
  analysis: string;
  suggestions: string[];
}

function AnalysisPanel({ result, onClose }: { result: AnalysisResult; onClose: () => void }) {
  const typeLabels: Record<string, string> = {
    brain_dump: 'Brain Dump',
    dream: 'Dream',
    project_plan: 'Project Plan',
    research: 'Research',
    personal_reflection: 'Personal Reflection',
    meeting_notes: 'Meeting Notes',
    creative_writing: 'Creative Writing',
    todo_list: 'To-Do List',
    journal: 'Journal',
    technical: 'Technical',
    other: 'General',
  };

  return (
    <div className="border-t border-white/[0.06] bg-white/[0.02] overflow-y-auto max-h-[40%] min-h-[120px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Sparkles size={12} className="text-purple-400/70" />
          <span className="text-[11px] font-medium text-white/60">Analysis</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-300/70">
            {typeLabels[result.noteType] || result.noteType}
          </span>
        </div>
        <button onClick={onClose} className="text-white/20 hover:text-white/50 p-0.5 transition-colors">
          <X size={12} />
        </button>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap">{result.analysis}</div>
        {result.suggestions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-white/25 font-medium">Suggested Actions</div>
            {result.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-white/50">
                <span className="text-purple-400/50 mt-0.5 shrink-0">{'\u2022'}</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesTab() {
  const {
    entries, isLoading, loadTree,
    activeNote, noteLoading, saving,
    readNote, saveNote, createNote, createFolder, deleteNote, renameNote,
  } = useNotes();

  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewNote, setShowNewNote] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>(loadRecent);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>(loadPinned);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<NoteEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Analysis state
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Voice transcription state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const isTranscribingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tree = useMemo(() => buildTree(entries), [entries]);
  const wordCount = useMemo(() => getWordCount(draft), [draft]);
  const charCount = useMemo(() => getCharCount(draft), [draft]);

  // Analyze note
  const handleAnalyze = useCallback(async () => {
    if (!draft.trim() || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/notes/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft, path: activeNote?.path }),
      });
      const data = await res.json();
      if (data.ok) {
        setAnalysisResult({
          noteType: data.noteType || 'other',
          analysis: data.analysis || '',
          suggestions: data.suggestions || [],
        });
      }
    } catch {}
    setAnalyzing(false);
  }, [draft, activeNote, analyzing]);

  // Voice transcription — creates a fresh SpeechRecognition instance each time
  const createRecognition = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (finalText) {
        setInterimText('');
        setDraft(prev => {
          const separator = prev && !prev.endsWith('\n') && !prev.endsWith(' ') ? ' ' : '';
          return prev + separator + finalText;
        });
        setDirty(true);
      } else {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event: any) => {
      const err = event?.error;
      // Fatal errors — stop entirely
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
        setInterimText('');
        recognitionRef.current = null;
        return;
      }
      // 'no-speech', 'aborted', 'network' — non-fatal, onend will handle restart
    };

    recognition.onend = () => {
      // If user still wants transcription, spin up a new instance after a brief delay
      if (isTranscribingRef.current) {
        // Clear stale ref
        recognitionRef.current = null;
        // Small delay lets the browser release the mic before we grab it again
        restartTimerRef.current = setTimeout(() => {
          if (!isTranscribingRef.current) return;
          const next = createRecognition();
          if (next) {
            recognitionRef.current = next;
            try { next.start(); } catch { /* give up gracefully */ }
          }
        }, 150);
      } else {
        recognitionRef.current = null;
        setIsTranscribing(false);
        setInterimText('');
      }
    };

    return recognition;
  }, []);

  const startTranscription = useCallback(() => {
    if (isTranscribingRef.current) return; // already active
    const recognition = createRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;
    isTranscribingRef.current = true;
    setIsTranscribing(true);
    setInterimText('');
    try { recognition.start(); } catch {}
  }, [createRecognition]);

  const stopTranscription = useCallback(() => {
    isTranscribingRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsTranscribing(false);
    setInterimText('');
  }, []);

  const toggleTranscription = useCallback(() => {
    if (isTranscribing) stopTranscription();
    else startTranscription();
  }, [isTranscribing, startTranscription, stopTranscription]);

  // Load tree on mount
  useEffect(() => { loadTree(); }, [loadTree]);

  // Sync draft with active note
  useEffect(() => {
    if (activeNote) {
      setDraft(activeNote.content);
      setDirty(false);
      setAnalysisResult(null);
      // Stop transcription when switching notes
      stopTranscription();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote, stopTranscription]);

  // Track recent notes
  const addToRecent = useCallback((path: string) => {
    setRecentPaths(prev => {
      const next = [path, ...prev.filter(p => p !== path)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, []);

  const handleSelect = useCallback(async (entry: NoteEntry) => {
    if (entry.type === 'file') {
      await readNote(entry.path);
      addToRecent(entry.path);
      setMode('edit');
    }
  }, [readNote, addToRecent]);

  const handleSelectPath = useCallback(async (path: string) => {
    await readNote(path);
    addToRecent(path);
    setMode('edit');
    setShowSwitcher(false);
    setShowSearch(false);
  }, [readNote, addToRecent]);

  const handleDelete = useCallback(async (entry: NoteEntry) => {
    const label = entry.type === 'folder' ? 'folder' : 'note';
    if (!confirm(`Delete ${label} "${stripMdExt(entry.name)}"?`)) return;
    await deleteNote(entry.path);
  }, [deleteNote]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeNote || !dirty) return;
    const ok = await saveNote(activeNote.path, draft);
    if (ok) { setDirty(false); setLastSaved(new Date()); }
  }, [activeNote, draft, dirty, saveNote]);

  // Auto-save on idle
  const handleEditorChange = useCallback((value: string) => {
    setDraft(value);
    setDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Trigger auto-save — need to use a ref to get latest values
    }, AUTOSAVE_DELAY);
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!dirty || !activeNote) return;
    const timer = setTimeout(async () => {
      const ok = await saveNote(activeNote.path, draft);
      if (ok) { setDirty(false); setLastSaved(new Date()); }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, dirty, activeNote, saveNote]);

  const handleCreateNote = useCallback(async () => {
    if (!newName.trim()) return;
    const path = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
    const ok = await createNote(path, `# ${stripMdExt(newName.trim())}\n\n`);
    if (ok) {
      setShowNewNote(false);
      setNewName('');
      await readNote(path);
      addToRecent(path);
    }
  }, [newName, createNote, readNote, addToRecent]);

  const handleCreateFolder = useCallback(async () => {
    if (!newName.trim()) return;
    const ok = await createFolder(newName.trim());
    if (ok) {
      setShowNewFolder(false);
      setNewName('');
      setExpandedFolders(prev => new Set([...prev, newName.trim()]));
    }
  }, [newName, createFolder]);

  const handleRename = useCallback((entry: NoteEntry) => {
    setRenamingEntry(entry);
    setRenameValue(stripMdExt(entry.name));
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingEntry || !renameValue.trim()) { setRenamingEntry(null); return; }
    const parent = getParentPath(renamingEntry.path);
    const newFileName = renamingEntry.type === 'file'
      ? (renameValue.trim().endsWith('.md') ? renameValue.trim() : `${renameValue.trim()}.md`)
      : renameValue.trim();
    const newPath = parent ? `${parent}/${newFileName}` : newFileName;
    if (newPath !== renamingEntry.path) {
      await renameNote(renamingEntry.path, newPath);
    }
    setRenamingEntry(null);
  }, [renamingEntry, renameValue, renameNote]);

  const handleTogglePin = useCallback((path: string) => {
    setPinnedPaths(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      savePinned(next);
      return next;
    });
  }, []);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (showNewNote) handleCreateNote();
      else if (showNewFolder) handleCreateFolder();
    }
    if (e.key === 'Escape') { setShowNewNote(false); setShowNewFolder(false); setNewName(''); }
  }, [showNewNote, showNewFolder, handleCreateNote, handleCreateFolder]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setShowSwitcher(s => !s);
        setShowSearch(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowSearch(s => !s);
        setShowSwitcher(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !isInput) {
        e.preventDefault();
        setShowNewNote(true);
        setShowNewFolder(false);
        setNewName('');
      }
    };
    const el = containerRef.current;
    if (el) el.addEventListener('keydown', handler as any);
    return () => { if (el) el.removeEventListener('keydown', handler as any); };
  }, []);

  return (
    <div ref={containerRef} className="h-full flex flex-col min-h-0 relative" tabIndex={-1}>
      {/* Quick Switcher */}
      {showSwitcher && (
        <QuickSwitcher entries={entries} onSelect={handleSelectPath} onClose={() => setShowSwitcher(false)} />
      )}

      {/* Search Panel */}
      {showSearch && (
        <SearchPanel onSelect={handleSelectPath} onClose={() => setShowSearch(false)} />
      )}

      {/* Rename Dialog */}
      {renamingEntry && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setRenamingEntry(null)}>
          <div className="bg-[#0d0d1a] border border-white/[0.08] rounded-lg p-4 w-[260px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-[11px] text-white/50 mb-2">Rename {renamingEntry.type === 'folder' ? 'folder' : 'note'}</div>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenamingEntry(null); }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-white/90 outline-none focus:border-purple-400/40"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setRenamingEntry(null)} className="text-[10px] text-white/40 hover:text-white/60 px-2 py-1">Cancel</button>
              <button onClick={handleRenameSubmit} className="text-[10px] text-purple-400 hover:text-purple-300 bg-purple-400/10 px-3 py-1 rounded">Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area: sidebar + editor */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <div className="w-fit max-w-[120px] min-w-[80px] border-r border-white/[0.04] flex flex-col overflow-hidden bg-white/[0.01]">
          {/* Sidebar toolbar */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04]">
            <button
              onClick={() => { setShowNewNote(true); setShowNewFolder(false); setNewName(''); }}
              className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="New Note (Ctrl+N)"
            >
              <FilePlus size={13} />
            </button>
            <button
              onClick={() => { setShowNewFolder(true); setShowNewNote(false); setNewName(''); }}
              className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="New Folder"
            >
              <FolderPlus size={13} />
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowSwitcher(true)}
              className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="Quick Open (Ctrl+P)"
            >
              <Command size={13} />
            </button>
            <button
              onClick={() => setShowSearch(true)}
              className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              title="Search All (Ctrl+Shift+F)"
            >
              <Search size={13} />
            </button>
          </div>

          {/* New note/folder input */}
          {(showNewNote || showNewFolder) && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04] bg-white/[0.02]">
              {showNewNote ? <FileText size={10} className="text-purple-400/60 shrink-0" /> : <Folder size={10} className="text-amber-400/60 shrink-0" />}
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={showNewNote ? 'Note name…' : 'Folder name…'}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-[11px] text-white/80 placeholder:text-white/20"
              />
              <button onClick={() => { setShowNewNote(false); setShowNewFolder(false); setNewName(''); }} className="text-white/20 hover:text-white/50 p-0.5">
                <X size={10} />
              </button>
            </div>
          )}

          {/* File tree */}
          <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
            {/* Pinned section */}
            {pinnedPaths.length > 0 && (
              <>
                <div className="px-3 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-white/20 font-medium">Pinned</div>
                {pinnedPaths.map(path => {
                  const entry = entries.find(e => e.path === path && e.type === 'file');
                  if (!entry) return null;
                  return (
                    <div
                      key={`pin-${path}`}
                      className={`flex items-center gap-1 px-2 py-[3px] mx-1 cursor-pointer rounded-[3px] text-[11px] transition-all ${
                        activeNote?.path === path ? 'bg-white/[0.08] text-white/90' : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70'
                      }`}
                      onClick={() => handleSelectPath(path)}
                    >
                      <Pin size={9} className="text-amber-400/50 shrink-0" />
                      <span className="truncate">{stripMdExt(entry.name)}</span>
                    </div>
                  );
                })}
                <div className="mx-3 my-1 border-b border-white/[0.04]" />
              </>
            )}

            {/* Tree */}
            {tree.length === 0 && !isLoading && (
              <div className="text-[10px] text-white/15 text-center py-8 px-3 leading-relaxed">
                No notes yet<br />
                <span className="text-white/10">Ctrl+N to create</span>
              </div>
            )}
            {tree.map(node => (
              <NoteTreeItem
                key={node.entry.path}
                node={node}
                depth={0}
                activePath={activeNote?.path ?? null}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onRename={handleRename}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                pinnedPaths={pinnedPaths}
                onTogglePin={handleTogglePin}
              />
            ))}

            {/* Recent section */}
            {recentPaths.length > 0 && tree.length > 0 && (
              <>
                <div className="mx-3 my-2 border-b border-white/[0.04]" />
                <div className="px-3 pt-0.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/20 font-medium flex items-center gap-1">
                  <Clock size={8} />
                  Recent
                </div>
                {recentPaths.slice(0, 5).map(path => {
                  const entry = entries.find(e => e.path === path && e.type === 'file');
                  if (!entry) return null;
                  return (
                    <div
                      key={`recent-${path}`}
                      className={`flex items-center gap-1 px-2 py-[2px] mx-1 cursor-pointer rounded-[3px] text-[10px] transition-all ${
                        activeNote?.path === path ? 'text-white/60' : 'text-white/25 hover:text-white/50 hover:bg-white/[0.03]'
                      }`}
                      onClick={() => handleSelectPath(path)}
                    >
                      <FileText size={9} className="text-white/15 shrink-0" />
                      <span className="truncate">{stripMdExt(entry.name)}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Editor / Preview area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Editor header */}
          {activeNote && (
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/[0.04] shrink-0">
              <Hash size={11} className="text-white/15" />
              <span className="text-[11px] text-white/40 truncate flex-1">{stripMdExt(getFileName(activeNote.path))}</span>
              <button
                onClick={toggleTranscription}
                className={`p-1 rounded transition-colors ${isTranscribing ? 'bg-red-400/10 text-red-400/80 animate-pulse' : 'text-white/25 hover:text-white/50'}`}
                title={isTranscribing ? 'Stop dictation' : 'Start voice dictation'}
              >
                {isTranscribing ? <MicOff size={12} /> : <Mic size={12} />}
              </button>
              <button
                onClick={() => setMode('edit')}
                className={`p-1 rounded transition-colors ${mode === 'edit' ? 'bg-white/[0.06] text-white/70' : 'text-white/25 hover:text-white/50'}`}
                title="Edit (Ctrl+E)"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => setMode('preview')}
                className={`p-1 rounded transition-colors ${mode === 'preview' ? 'bg-white/[0.06] text-white/70' : 'text-white/25 hover:text-white/50'}`}
                title="Preview"
              >
                <Eye size={12} />
              </button>
            </div>
          )}

          {/* Editor content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {!activeNote && !noteLoading && (
              <div className="h-full flex flex-col items-center justify-center text-white/15 gap-3">
                <FileText size={32} className="text-white/8" />
                <div className="text-[11px]">Select or create a note</div>
                <div className="flex gap-3 text-[9px] text-white/10">
                  <span><kbd className="bg-white/[0.04] px-1.5 py-0.5 rounded text-white/20">Ctrl+N</kbd> New</span>
                  <span><kbd className="bg-white/[0.04] px-1.5 py-0.5 rounded text-white/20">Ctrl+P</kbd> Open</span>
                </div>
              </div>
            )}
            {noteLoading && (
              <div className="h-full flex items-center justify-center">
                <div className="w-4 h-4 border border-white/10 border-t-purple-400/60 rounded-full animate-spin" />
              </div>
            )}
            {activeNote && !noteLoading && mode === 'edit' && (
              <NoteEditor content={draft} onChange={handleEditorChange} onSave={handleSave} />
            )}
            {activeNote && !noteLoading && mode === 'preview' && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-[720px] mx-auto px-8 py-6 prose prose-sm prose-invert max-w-none prose-headings:text-white/90 prose-p:text-white/65 prose-a:text-purple-400 prose-strong:text-white/80 prose-code:text-purple-300 prose-code:bg-white/[0.04]">
                  <MarkdownRenderer content={draft} />
                </div>
              </div>
            )}
          </div>

          {/* Analysis panel */}
          {analysisResult && activeNote && (
            <AnalysisPanel result={analysisResult} onClose={() => setAnalysisResult(null)} />
          )}

          {/* Status bar */}
          {activeNote && (
            <div className="flex items-center gap-3 px-4 py-1 border-t border-white/[0.04] shrink-0 text-[9px] text-white/20">
              <span>{wordCount} words</span>
              <span>{charCount} chars</span>
              <span>{getReadingTime(wordCount)} read</span>
              <div className="flex-1" />
              {isTranscribing && <span className="text-red-400/50 flex items-center gap-1"><Mic size={8} /> recording{interimText && <span className="text-white/30 ml-1 truncate max-w-[200px] italic">{interimText}</span>}</span>}
              {dirty && <span className="text-amber-400/40">unsaved</span>}
              {!dirty && lastSaved && <span className="text-green-400/30">saved</span>}
              {saving && <span className="text-purple-400/40">saving…</span>}
              <button
                onClick={handleAnalyze}
                disabled={analyzing || !draft.trim()}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] transition-colors disabled:opacity-30 bg-purple-400/[0.08] text-purple-300/60 hover:text-purple-300/90 hover:bg-purple-400/[0.15]"
                title="Analyze this note with AI"
              >
                {analyzing ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                {analyzing ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
