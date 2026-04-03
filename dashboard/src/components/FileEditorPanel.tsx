/**
 * FileEditorPanel — Code editor with integrated micro audit agent.
 *
 * Features:
 * - Code editing with Ctrl+S save
 * - "Audit" button → isolated code-audit agent reviews the file
 * - Findings display with severity badges
 * - Inline chat input to ask for edits (apply-fix)
 * - Fully isolated from main agent — own system prompt, own context
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  X,
  Save,
  FileCode,
  Loader2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  AlertCircle,
  Send,
  Sparkles,
  Check,
  RotateCcw,
  Music,
} from 'lucide-react';

interface AuditFinding {
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  title: string;
  description: string;
  suggestion: string;
}

interface AuditResult {
  summary: string;
  score: number;
  findings: AuditFinding[];
}

interface FileEditorPanelProps {
  file: {
    path: string;
    content: string;
    dirty: boolean;
    type?: 'text' | 'image' | 'audio';
  };
  loading: boolean;
  onSave: () => void;
  onClose: () => void;
  onChange: (content: string) => void;
}

const CORE_FILES = new Set([
  'CIRCUITS.md', 'PRIME.md', 'SUBSTRATE.md', 'TOOL_PROMPT.md',
  'config.json', 'gateway.py', 'main.py', 'main.js', 'package.json',
  'memory.json', 'conversation_history.json', 'wake_circuits.py',
  'README.md', 'custom_settings.json',
]);

function isCoreFile(filePath: string): boolean {
  const name = filePath.replace(/\\/g, '/').split('/').pop() || '';
  // Core files are root-level project files (no subdirectory)
  return !filePath.includes('/') && CORE_FILES.has(name);
}

const SEVERITY_CONFIG = {
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20', label: 'Error' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', label: 'Warning' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20', label: 'Info' },
};

export function FileEditorPanel({ file, loading, onSave, onClose, onChange }: FileEditorPanelProps) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Audit state
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditRaw, setAuditRaw] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  // Edit chat state
  const [editInput, setEditInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editPreview, setEditPreview] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState<string | null>(null);

  // Reset audit when file changes
  useEffect(() => {
    setAuditResult(null);
    setAuditRaw(null);
    setAuditError(null);
    setShowAudit(false);
    setEditPreview(null);
    setEditInstruction(null);
  }, [file.path]);

  const runAudit = useCallback(async () => {
    setAuditing(true);
    setAuditError(null);
    setAuditResult(null);
    setAuditRaw(null);
    setShowAudit(true);
    try {
      const resp = await fetch('/api/audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setAuditError(data.error || 'Audit failed');
        return;
      }
      if (data.audit) {
        setAuditResult(data.audit);
      } else if (data.raw) {
        setAuditRaw(data.raw);
      }
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditing(false);
    }
  }, [file.path]);

  const sendEdit = useCallback(async () => {
    if (!editInput.trim()) return;
    setEditing(true);
    setEditPreview(null);
    const instruction = editInput.trim();
    setEditInstruction(instruction);
    setEditInput('');
    try {
      const resp = await fetch('/api/audit/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file.path,
          instruction,
          content: file.content,
        }),
      });
      const data = await resp.json();
      if (data.ok && data.content) {
        setEditPreview(data.content);
      } else {
        setAuditError(data.error || 'Edit failed');
      }
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditing(false);
    }
  }, [editInput, file.path, file.content]);

  const applyEdit = useCallback(() => {
    if (editPreview) {
      onChange(editPreview);
      setEditPreview(null);
      setEditInstruction(null);
    }
  }, [editPreview, onChange]);

  const discardEdit = useCallback(() => {
    setEditPreview(null);
    setEditInstruction(null);
  }, []);

  const scoreColor = (score: number) => {
    if (score >= 8) return 'text-green-400';
    if (score >= 5) return 'text-amber-400';
    return 'text-red-400';
  };

  const scoreIcon = (score: number) => {
    if (score >= 8) return ShieldCheck;
    if (score >= 5) return Shield;
    return ShieldAlert;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode size={14} className="text-green-400 shrink-0" />
          <span className="text-xs font-semibold text-white/80 truncate">{file.path}</span>
          {file.dirty && <span className="text-[10px] text-amber-400/70">modified</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* Audit button */}
          <button
            onClick={runAudit}
            disabled={auditing || loading}
            className="h-6 px-2 rounded-md flex items-center gap-1 text-[10px] font-medium text-violet-400/70 hover:text-violet-400 hover:bg-violet-400/[0.08] transition-all disabled:opacity-30"
            title="Run code audit"
          >
            {auditing ? <Loader2 size={11} className="animate-spin" /> : <Shield size={11} />}
            <span>Audit</span>
          </button>
          {file.dirty && (
            <button
              onClick={onSave}
              className="w-6 h-6 rounded-md flex items-center justify-center text-green-400/60 hover:text-green-400 hover:bg-white/[0.06] transition-all"
              title="Save (Ctrl+S)"
            >
              <Save size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Core file warning */}
      {isCoreFile(file.path) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/[0.07] border-b border-amber-500/20 shrink-0">
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          <span className="text-[10px] text-amber-300/80 leading-tight">
            <strong className="text-amber-300">Core project file</strong> — Modifications may affect system behavior. Edit with caution and avoid deleting.
          </span>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={18} className="text-indigo-400/50 animate-spin" />
            </div>
          ) : file.type === 'image' ? (
            <div className="flex flex-col items-center justify-center h-full p-4 gap-3 overflow-auto">
              <img
                src={file.content}
                alt={file.path}
                className="max-w-full max-h-[calc(100%-2rem)] object-contain rounded-lg shadow-lg shadow-black/30 border border-white/[0.06]"
              />
              <span className="text-[10px] text-white/30 font-mono">{file.path}</span>
            </div>
          ) : file.type === 'audio' ? (
            <div className="flex flex-col items-center justify-center h-full p-6 gap-5">
              {/* Album art placeholder */}
              <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-purple-500/20 via-indigo-500/20 to-cyan-500/20 border border-white/[0.08] flex items-center justify-center shadow-xl shadow-purple-500/10">
                <Music size={40} className="text-purple-400/60" />
              </div>
              {/* File name */}
              <div className="text-center">
                <div className="text-sm font-semibold text-white/80">{file.path.split('/').pop()}</div>
                <div className="text-[10px] text-white/30 font-mono mt-1">{file.path}</div>
              </div>
              {/* Audio player */}
              <audio
                controls
                src={file.content}
                className="w-full max-w-sm"
                style={{ filter: 'invert(0.85) hue-rotate(180deg)', borderRadius: '8px' }}
              />
            </div>
          ) : (
            <textarea
              ref={editRef}
              value={editPreview ?? file.content}
              onChange={e => {
                if (editPreview) return; // Don't allow editing preview
                onChange(e.target.value);
              }}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  onSave();
                }
              }}
              readOnly={!!editPreview}
              spellCheck={false}
              className={`w-full h-full bg-transparent text-[12px] leading-relaxed font-mono p-4 resize-none focus:outline-none selection:bg-indigo-500/30 ${
                editPreview ? 'text-emerald-300/80' : 'text-white/80'
              }`}
              style={{ tabSize: 2 }}
            />
          )}

          {/* Edit preview banner */}
          {editPreview && (
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20">
              <div className="flex items-center gap-2">
                <Sparkles size={11} className="text-emerald-400" />
                <span className="text-[10px] text-emerald-300/80 font-medium">
                  Preview: {editInstruction}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={applyEdit}
                  className="h-5 px-2 rounded flex items-center gap-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-400/20 transition-all"
                >
                  <Check size={10} /> Apply
                </button>
                <button
                  onClick={discardEdit}
                  className="h-5 px-2 rounded flex items-center gap-1 text-[10px] font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-all"
                >
                  <RotateCcw size={10} /> Discard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Audit panel (right side) */}
        {showAudit && (
          <div className="w-[240px] border-l border-white/[0.04] flex flex-col overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
              <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Audit</span>
              <button
                onClick={() => setShowAudit(false)}
                className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/50 transition-all"
              >
                <X size={10} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {auditing && (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Loader2 size={16} className="text-violet-400/50 animate-spin" />
                  <span className="text-[10px] text-white/40">Auditing...</span>
                </div>
              )}

              {auditError && (
                <div className="p-2 rounded-lg bg-red-400/10 border border-red-400/20">
                  <p className="text-[10px] text-red-400">{auditError}</p>
                </div>
              )}

              {auditResult && (
                <>
                  {/* Score */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    {(() => {
                      const ScoreIcon = scoreIcon(auditResult.score);
                      return <ScoreIcon size={16} className={scoreColor(auditResult.score)} />;
                    })()}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-bold ${scoreColor(auditResult.score)}`}>
                        {auditResult.score}/10
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="text-[10px] text-white/50 leading-relaxed">{auditResult.summary}</p>

                  {/* Findings */}
                  {auditResult.findings.length === 0 ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-green-400/10 border border-green-400/20">
                      <ShieldCheck size={12} className="text-green-400" />
                      <span className="text-[10px] text-green-400 font-medium">No issues found</span>
                    </div>
                  ) : (
                    auditResult.findings.map((f, i) => {
                      const sev = SEVERITY_CONFIG[f.severity] || SEVERITY_CONFIG.info;
                      const SevIcon = sev.icon;
                      return (
                        <div key={i} className={`p-2 rounded-lg ${sev.bg} border ${sev.border} space-y-1`}>
                          <div className="flex items-start gap-1.5">
                            <SevIcon size={11} className={`${sev.color} mt-0.5 shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-bold ${sev.color}`}>{f.title}</span>
                                {f.line && (
                                  <span className="text-[9px] text-white/30 font-mono">L{f.line}</span>
                                )}
                              </div>
                              <p className="text-[10px] text-white/50 leading-relaxed mt-0.5">{f.description}</p>
                              {f.suggestion && (
                                <div className="mt-1.5">
                                  <p className="text-[10px] text-white/40 font-mono leading-relaxed bg-black/20 rounded p-1.5 break-all">
                                    {f.suggestion}
                                  </p>
                                  <button
                                    onClick={() => {
                                      setEditInput(`Apply this fix: ${f.suggestion}`);
                                      chatInputRef.current?.focus();
                                    }}
                                    className="mt-1 text-[9px] text-violet-400/70 hover:text-violet-400 transition-all"
                                  >
                                    Apply this fix →
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* Raw fallback (if model didn't return structured JSON) */}
              {auditRaw && (
                <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                  <p className="text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap font-mono">{auditRaw}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom chat bar for edit requests */}
      {file.type !== 'image' && (
        <div className="shrink-0 border-t border-white/[0.04] px-3 py-2">
          <form
            onSubmit={e => {
              e.preventDefault();
              sendEdit();
            }}
            className="flex items-center gap-2"
          >
            <Sparkles size={12} className="text-violet-400/40 shrink-0" />
            <input
              ref={chatInputRef}
              type="text"
              value={editInput}
              onChange={e => setEditInput(e.target.value)}
              placeholder="Ask for an edit... (e.g. 'add error handling')"
              disabled={editing}
              className="flex-1 bg-transparent text-[11px] text-white/70 placeholder:text-white/20 focus:outline-none"
            />
            {editing ? (
              <Loader2 size={12} className="text-violet-400/50 animate-spin shrink-0" />
            ) : (
              <button
                type="submit"
                disabled={!editInput.trim()}
                className="w-6 h-6 rounded-md flex items-center justify-center text-violet-400/50 hover:text-violet-400 hover:bg-violet-400/[0.08] disabled:opacity-20 transition-all shrink-0"
              >
                <Send size={11} />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
