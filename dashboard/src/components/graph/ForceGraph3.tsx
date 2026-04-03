/**
 * ForceGraph — react-force-graph-2d workspace graph (same lib as Composure).
 *
 * Features:
 *  - Hub hierarchy: Agent → Workspace / Memory / Chat / Sessions
 *  - Workspace files grouped by subfolder (deep nesting)
 *  - Memory categorized into Preferences / Lessons / Facts / Reminders
 *  - Chat pairs user Q → agent A with direct links
 *  - Previous sessions shown as day nodes
 *  - Live activity (tool calls, thinking) visible as ephemeral nodes
 *  - Click-to-isolate: click a node to highlight it + neighbors, dim rest
 *  - Physics sliders panel for force / gravity / link distance
 */
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceX, forceY } from 'd3-force';
import { SlidersHorizontal, RotateCcw, ZoomIn, ZoomOut, X, Search } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────
export type NodeKind = 'agent' | 'model' | 'memory' | 'file' | 'conversation' | 'task' | 'live' | 'skill' | 'macro' | 'tool';

export interface LiveEvent {
  id: string;
  kind: 'tool_call' | 'streaming' | 'thinking' | 'memory_search';
  label: string;
  detail?: string;
  timestamp: number;
}

interface GNode {
  id: string;
  kind: NodeKind;
  nodeType: 'hub' | 'leaf' | 'agent';
  label: string;
  detail?: string;
  size: number;
  color: string;
  colorRgb: string;
  icon?: string;
  count?: number;
  pulse?: boolean;
}

interface GLink {
  source: string;
  target: string;
  linkType: string;
}

// ─── Palette ──────────────────────────────────────────────────────
const PAL: Record<string, { color: string; rgb: string }> = {
  agent:  { color: '#818cf8', rgb: '129,140,248' },
  model:  { color: '#a78bfa', rgb: '167,139,250' },
  memory: { color: '#f472b6', rgb: '244,114,182' },
  core:   { color: '#f59e0b', rgb: '245,158,11' },
  file:   { color: '#34d399', rgb: '52,211,153' },
  conversation: { color: '#22d3ee', rgb: '34,211,238' },
  task:   { color: '#fbbf24', rgb: '251,191,36' },
  live:   { color: '#fb923c', rgb: '251,146,60' },
  skill:  { color: '#f59e0b', rgb: '245,158,11' },
  macro:  { color: '#06b6d4', rgb: '6,182,212' },
  tool:   { color: '#ef4444', rgb: '239,68,68' },
};

const KEY_FILES = new Set([
  'CIRCUITS.md','PRIME.md','SUBSTRATE.md','TOOL_PROMPT.md',
  'config.json','gateway.py','main.py','main.js','package.json',
  'memory.json','conversation_history.json','wake_circuits.py',
  'README.md','custom_settings.json',
]);

// ─── File extension color map ────────────────────────────────────
const EXT_COLORS: Record<string, { color: string; rgb: string }> = {
  // Python
  py:    { color: '#38bdf8', rgb: '56,189,248' },
  pyw:   { color: '#38bdf8', rgb: '56,189,248' },
  pyi:   { color: '#7dd3fc', rgb: '125,211,252' },
  // JavaScript / TypeScript
  js:    { color: '#facc15', rgb: '250,204,21' },
  jsx:   { color: '#fde047', rgb: '253,224,71' },
  ts:    { color: '#2563eb', rgb: '37,99,235' },
  tsx:   { color: '#3b82f6', rgb: '59,130,246' },
  mjs:   { color: '#facc15', rgb: '250,204,21' },
  cjs:   { color: '#facc15', rgb: '250,204,21' },
  // Web
  html:  { color: '#f97316', rgb: '249,115,22' },
  htm:   { color: '#f97316', rgb: '249,115,22' },
  css:   { color: '#a855f7', rgb: '168,85,247' },
  scss:  { color: '#c084fc', rgb: '192,132,252' },
  less:  { color: '#c084fc', rgb: '192,132,252' },
  svg:   { color: '#fb923c', rgb: '251,146,60' },
  // Data / Config
  json:  { color: '#fbbf24', rgb: '251,191,36' },
  yaml:  { color: '#f472b6', rgb: '244,114,182' },
  yml:   { color: '#f472b6', rgb: '244,114,182' },
  toml:  { color: '#fb7185', rgb: '251,113,133' },
  xml:   { color: '#fdba74', rgb: '253,186,116' },
  csv:   { color: '#4ade80', rgb: '74,222,128' },
  env:   { color: '#a3a3a3', rgb: '163,163,163' },
  ini:   { color: '#d4d4d4', rgb: '212,212,212' },
  // Markdown / Docs
  md:    { color: '#60a5fa', rgb: '96,165,250' },
  mdx:   { color: '#60a5fa', rgb: '96,165,250' },
  txt:   { color: '#d4d4d8', rgb: '212,212,216' },
  rst:   { color: '#93c5fd', rgb: '147,197,253' },
  // Shell / Scripts
  sh:    { color: '#22c55e', rgb: '34,197,94' },
  bash:  { color: '#22c55e', rgb: '34,197,94' },
  zsh:   { color: '#22c55e', rgb: '34,197,94' },
  bat:   { color: '#86efac', rgb: '134,239,172' },
  ps1:   { color: '#60a5fa', rgb: '96,165,250' },
  // Systems
  rs:    { color: '#fb923c', rgb: '251,146,60' },
  go:    { color: '#06b6d4', rgb: '6,182,212' },
  c:     { color: '#64748b', rgb: '100,116,139' },
  cpp:   { color: '#6366f1', rgb: '99,102,241' },
  h:     { color: '#818cf8', rgb: '129,140,248' },
  hpp:   { color: '#818cf8', rgb: '129,140,248' },
  java:  { color: '#ef4444', rgb: '239,68,68' },
  kt:    { color: '#a78bfa', rgb: '167,139,250' },
  swift: { color: '#f97316', rgb: '249,115,22' },
  // Ruby / PHP / Perl
  rb:    { color: '#dc2626', rgb: '220,38,38' },
  php:   { color: '#7c3aed', rgb: '124,58,237' },
  pl:    { color: '#0ea5e9', rgb: '14,165,233' },
  // Images
  png:   { color: '#14b8a6', rgb: '20,184,166' },
  jpg:   { color: '#14b8a6', rgb: '20,184,166' },
  jpeg:  { color: '#14b8a6', rgb: '20,184,166' },
  gif:   { color: '#2dd4bf', rgb: '45,212,191' },
  webp:  { color: '#14b8a6', rgb: '20,184,166' },
  ico:   { color: '#5eead4', rgb: '94,234,212' },
  bmp:   { color: '#14b8a6', rgb: '20,184,166' },
  // Audio / Video
  mp3:   { color: '#e879f9', rgb: '232,121,249' },
  wav:   { color: '#e879f9', rgb: '232,121,249' },
  ogg:   { color: '#d946ef', rgb: '217,70,239' },
  mp4:   { color: '#f43f5e', rgb: '244,63,94' },
  webm:  { color: '#f43f5e', rgb: '244,63,94' },
  // Database
  sql:   { color: '#f59e0b', rgb: '245,158,11' },
  db:    { color: '#d97706', rgb: '217,119,6' },
  sqlite:{ color: '#d97706', rgb: '217,119,6' },
  // Archives
  zip:   { color: '#a3a3a3', rgb: '163,163,163' },
  tar:   { color: '#a3a3a3', rgb: '163,163,163' },
  gz:    { color: '#a3a3a3', rgb: '163,163,163' },
  // Lock / Generated
  lock:  { color: '#737373', rgb: '115,115,115' },
  map:   { color: '#737373', rgb: '115,115,115' },
};

function getExtColor(filename: string): { color: string; rgb: string } {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || PAL.file;
}

// ─── Props ────────────────────────────────────────────────────────
export interface ForceGraphProps {
  agentName: string;
  agentState: string;
  model: string;
  memories: Array<{ type: string; text: string; date?: string }>;
  files: Array<{ name: string; path: string; type: string }>;
  messages: Array<{ role: string; text: string; timestamp?: number }>;
  tasks: Array<{ id: string; title: string; status: string; source: 'user' | 'agent' }>;
  liveEvents?: LiveEvent[];
  gatewayModels?: Array<{ id: string; label: string; provider: string }>;
  sessions?: Array<{ key: string; label: string; model?: string; lastActivity?: string | number; state: string }>;
  chatDates?: Array<{ date: string; count: number }>;
  realMemory?: {
    facts: Array<{ key: string; value: string }>;
    lessons: Array<{ id: string; pattern: string; lesson: string; confidence: number; type: string }>;
    memoryEntryCount: number;
    configKeys: string[];
    configEntries: Array<{ key: string; preview: string }>;
    systemDocs: Array<{ name: string; path: string; size: number }>;
    visualMemory: Array<{ name: string; path: string; size: number; timestamp?: number }>;
  } | null;
  specialFolders?: {
    skills: Array<{ name: string; path: string; size: number }>;
    macros: Array<{ name: string; path: string; size: number }>;
    tools:  Array<{ name: string; path: string; size: number }>;
  } | null;
  externalHighlightRef?: { current: string | null };
  onNodeClick?: (kind: NodeKind, id: string, detail?: string) => void;
  onNodeDoubleClick?: (kind: NodeKind, id: string, detail?: string) => void;
}

// Memory sub-hub metadata for real system files
const MEM_HUB_META: Record<string, { label: string; color: string; rgb: string }> = {
  facts:   { label: 'User Facts',   color: '#93c5fd', rgb: '147,197,253' },
  lessons: { label: 'Lessons',      color: '#c084fc', rgb: '192,132,252' },
  config:  { label: 'Config',       color: '#34d399', rgb: '52,211,153'  },
  entries: { label: 'Memory Store', color: '#f9a8d4', rgb: '249,168,212' },
  visual:  { label: 'Visual Memory',color: '#f472b6', rgb: '244,114,182' },
};

// ─── Build graph data ─────────────────────────────────────────────
function buildGraphData(
  agentName: string, agentState: string, model: string,
  memories: ForceGraphProps['memories'],
  files: ForceGraphProps['files'],
  messages: ForceGraphProps['messages'],
  tasks: ForceGraphProps['tasks'],
  liveEvents: LiveEvent[] = [],
  gatewayModels: ForceGraphProps['gatewayModels'] = [],
  sessions: ForceGraphProps['sessions'] = [],
  chatDates: ForceGraphProps['chatDates'] = [],
  realMemory: ForceGraphProps['realMemory'] = null,
  specialFolders: ForceGraphProps['specialFolders'] = null,
  daysShown: number = 20,
) {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const A = 'agent-main';

  nodes.push({ id: A, kind: 'agent', nodeType: 'agent', label: agentName, detail: agentState, size: 22, color: PAL.agent.color, colorRgb: PAL.agent.rgb, icon: '◉', pulse: agentState !== 'idle' });

  // ── Models hub — all available models grouped by provider ────────
  {
    const models = gatewayModels || [];
    const activeModelId = model || '';
    const hasModels = models.length > 0 || (activeModelId && activeModelId !== 'unknown');

    if (hasModels) {
      nodes.push({ id: 'hub-models', kind: 'model', nodeType: 'hub', label: 'Models', detail: `${models.length || 1} models`, size: 10, color: PAL.model.color, colorRgb: PAL.model.rgb, count: models.length || 1 });
      links.push({ source: A, target: 'hub-models', linkType: 'core' });

      // Group by provider
      const providerMap = new Map<string, Array<{ id: string; label: string }>>();
      if (models.length > 0) {
        models.forEach(m => {
          const p = m.provider || 'unknown';
          if (!providerMap.has(p)) providerMap.set(p, []);
          providerMap.get(p)!.push({ id: m.id, label: m.label || m.id });
        });
      } else if (activeModelId && activeModelId !== 'unknown') {
        const parts = activeModelId.split('/');
        const provider = parts.length > 1 ? parts[0] : 'default';
        const label = parts.length > 1 ? parts.slice(1).join('/') : activeModelId;
        providerMap.set(provider, [{ id: activeModelId, label }]);
      }

      providerMap.forEach((provModels, provider) => {
        if (providerMap.size > 1) {
          const pId = `provider:${provider}`;
          nodes.push({ id: pId, kind: 'model', nodeType: 'hub', label: provider, detail: `${provModels.length} models`, size: 5, color: '#c4b5fd', colorRgb: '196,181,253', count: provModels.length });
          links.push({ source: 'hub-models', target: pId, linkType: 'provider' });

          provModels.forEach(m => {
            const isActive = m.id === activeModelId || activeModelId.endsWith('/' + m.label) || activeModelId.includes(m.label);
            nodes.push({ id: `model:${m.id}`, kind: 'model', nodeType: 'leaf', label: m.label, detail: `${provider}/${m.label}`, size: isActive ? 6 : 3, color: isActive ? '#818cf8' : '#a78bfa', colorRgb: isActive ? '129,140,248' : '167,139,250', pulse: isActive });
            links.push({ source: pId, target: `model:${m.id}`, linkType: 'model' });
          });
        } else {
          provModels.forEach(m => {
            const isActive = m.id === activeModelId || activeModelId.endsWith('/' + m.label) || activeModelId.includes(m.label);
            nodes.push({ id: `model:${m.id}`, kind: 'model', nodeType: 'leaf', label: m.label, detail: `${provider}/${m.label}`, size: isActive ? 6 : 3, color: isActive ? '#818cf8' : '#a78bfa', colorRgb: isActive ? '129,140,248' : '167,139,250', pulse: isActive });
            links.push({ source: 'hub-models', target: `model:${m.id}`, linkType: 'model' });
          });
        }
      });
    }
  }

  // ── Workspace — deep subfolder hierarchy ────────────────────────
  if (files.length > 0) {
    // Normalize paths (Windows backslashes → forward slashes)
    const normFiles = files.map(f => ({ ...f, path: f.path.replace(/\\/g, '/') }));

    // Separate core root project files from workspace files
    const coreFiles = normFiles.filter(f => !f.path.includes('/') && KEY_FILES.has(f.name));
    const wsFiles = normFiles.filter(f => f.path.includes('/') || !KEY_FILES.has(f.name));

    // ── Core project files — own hub linked directly to agent ──
    if (coreFiles.length > 0) {
      nodes.push({ id: 'hub-core', kind: 'file', nodeType: 'hub', label: 'Core', detail: `${coreFiles.length} project files — edit with caution`, size: 12, color: '#f59e0b', colorRgb: '245,158,11', count: coreFiles.length });
      links.push({ source: A, target: 'hub-core', linkType: 'core' });

      coreFiles.forEach(f => {
        const id = `f:${f.path}`;
        const ec = getExtColor(f.name);
        nodes.push({ id, kind: 'file', nodeType: 'leaf', label: f.name, detail: f.path, size: 5, color: ec.color, colorRgb: ec.rgb });
        links.push({ source: 'hub-core', target: id, linkType: 'key-file' });
      });
    }

    // ── Workspace files ──
    nodes.push({ id: 'hub-ws', kind: 'file', nodeType: 'hub', label: 'Workspace', detail: `${wsFiles.length} files`, size: 14, color: '#22c55e', colorRgb: '34,197,94', count: wsFiles.length });
    links.push({ source: A, target: 'hub-ws', linkType: 'core' });

    const addedDirs = new Set<string>();

    // Ensure all ancestor directories exist as hub nodes
    const ensureDir = (dirPath: string) => {
      if (!dirPath || addedDirs.has(dirPath)) return;
      addedDirs.add(dirPath);
      const parts = dirPath.split('/');
      const parentDir = parts.slice(0, -1).join('/');
      const parentId = parentDir ? `dir:${parentDir}` : 'hub-ws';
      // Recurse to create parent first
      if (parentDir) ensureDir(parentDir);
      const dirName = parts[parts.length - 1];
      nodes.push({ id: `dir:${dirPath}`, kind: 'file', nodeType: 'hub', label: dirName, detail: dirPath, size: 5, color: '#4ade80', colorRgb: '74,222,128' });
      links.push({ source: parentId, target: `dir:${dirPath}`, linkType: 'directory' });
    };

    wsFiles.slice(0, 200).forEach(f => {
      const parts = f.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (dir) ensureDir(dir);

      const parentId = dir ? `dir:${dir}` : 'hub-ws';
      const id = `f:${f.path}`;
      const ec = getExtColor(f.name);
      nodes.push({ id, kind: 'file', nodeType: 'leaf', label: f.name, detail: f.path, size: 2, color: ec.color, colorRgb: ec.rgb });
      links.push({ source: parentId, target: id, linkType: 'file' });
    });

    // Update dir counts
    addedDirs.forEach(d => {
      const n = nodes.find(nd => nd.id === `dir:${d}`);
      if (n) {
        const kids = links.filter(l => {
          const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
          return s === `dir:${d}`;
        });
        n.count = kids.length;
        n.detail = `${kids.length} items`;
      }
    });
  }

  // ── Memory — real system files (user_facts.md, lessons.json, config) ──
  {
    const rm = realMemory;
    const totalItems = (rm?.facts.length || 0) + (rm?.lessons.length || 0) + (rm?.memoryEntryCount || 0) + (rm?.configKeys.length || 0);

    if (totalItems > 0) {
      nodes.push({ id: 'hub-mem', kind: 'memory', nodeType: 'hub', label: 'Memory', detail: `${totalItems} items across system files`, size: 14, color: '#ec4899', colorRgb: '236,72,153', count: totalItems });
      links.push({ source: A, target: 'hub-mem', linkType: 'core' });

      // User Facts (from data/user_facts.md)
      if (rm && rm.facts.length > 0) {
        const meta = MEM_HUB_META.facts;
        const subId = 'mem-facts';
        nodes.push({ id: subId, kind: 'memory', nodeType: 'hub', label: meta.label, detail: `${rm.facts.length} entries · user_facts.md`, size: 7, color: meta.color, colorRgb: meta.rgb, count: rm.facts.length });
        links.push({ source: 'hub-mem', target: subId, linkType: 'memory-cat' });

        rm.facts.slice(0, 12).forEach((f, i) => {
          const id = `fact:${i}`;
          const label = f.key.replace(/_/g, ' ').slice(0, 24);
          nodes.push({ id, kind: 'memory', nodeType: 'leaf', label, detail: `${f.key}: ${f.value}`, size: 2, color: meta.color, colorRgb: meta.rgb });
          links.push({ source: subId, target: id, linkType: 'memory' });
        });
      }

      // Lessons (from workspace/state/lessons.json)
      if (rm && rm.lessons.length > 0) {
        const meta = MEM_HUB_META.lessons;
        const subId = 'mem-lessons';
        nodes.push({ id: subId, kind: 'memory', nodeType: 'hub', label: meta.label, detail: `${rm.lessons.length} learned patterns · lessons.json`, size: 6, color: meta.color, colorRgb: meta.rgb, count: rm.lessons.length });
        links.push({ source: 'hub-mem', target: subId, linkType: 'memory-cat' });

        rm.lessons.slice(0, 8).forEach((l, i) => {
          const id = `lesson:${i}`;
          const label = l.pattern.slice(0, 24);
          nodes.push({ id, kind: 'memory', nodeType: 'leaf', label, detail: `${l.pattern} → ${l.lesson} (${(l.confidence * 100).toFixed(0)}%)`, size: 2, color: meta.color, colorRgb: meta.rgb });
          links.push({ source: subId, target: id, linkType: 'memory' });
        });
      }

      // Config hub — system .md files as primary nodes, config keys as highlighted clickable nodes
      const hasDocs = rm && rm.systemDocs && rm.systemDocs.length > 0;
      const hasConfig = rm && rm.configEntries && rm.configEntries.length > 0;
      if (hasDocs || hasConfig) {
        const meta = MEM_HUB_META.config;
        const docCount = rm?.systemDocs?.length || 0;
        const cfgCount = rm?.configEntries?.length || 0;
        const subId = 'mem-config';
        nodes.push({ id: subId, kind: 'memory', nodeType: 'hub', label: meta.label, detail: `${docCount} docs · ${cfgCount} settings`, size: 8, color: meta.color, colorRgb: meta.rgb, count: docCount + cfgCount });
        links.push({ source: 'hub-mem', target: subId, linkType: 'memory-cat' });

        // System .md files as primary larger nodes (PRIME, CIRCUITS, SUBSTRATE, etc.)
        if (rm?.systemDocs) {
          rm.systemDocs.forEach((doc) => {
            const id = `doc:${doc.name}`;
            nodes.push({ id, kind: 'file', nodeType: 'leaf', label: doc.name.replace('.md', ''), detail: doc.path, size: 5, color: '#4ade80', colorRgb: '74,222,128', pulse: true });
            links.push({ source: subId, target: id, linkType: 'config-doc' });
          });
        }

        // Config keys as smaller highlighted nodes — clicking opens custom_settings.json
        if (rm?.configEntries) {
          rm.configEntries.slice(0, 12).forEach((c, i) => {
            const id = `cfg:${i}`;
            const label = c.key.replace(/_/g, ' ').slice(0, 20);
            nodes.push({ id, kind: 'file', nodeType: 'leaf', label, detail: `custom_settings.json`, size: 2, color: '#fcd34d', colorRgb: '252,211,77' });
            links.push({ source: subId, target: id, linkType: 'config-key' });
          });
        }
      }

      // Memory store count (memory.json)
      if (rm && rm.memoryEntryCount > 0) {
        const meta = MEM_HUB_META.entries;
        const subId = 'mem-store';
        nodes.push({ id: subId, kind: 'memory', nodeType: 'hub', label: meta.label, detail: `${rm.memoryEntryCount} entries · memory.json`, size: 5, color: meta.color, colorRgb: meta.rgb, count: rm.memoryEntryCount });
        links.push({ source: 'hub-mem', target: subId, linkType: 'memory-cat' });
      }

      // Visual Memory — screenshots and visual_memory images
      if (rm?.visualMemory && rm.visualMemory.length > 0) {
        const meta = MEM_HUB_META.visual;
        const subId = 'mem-visual';
        nodes.push({ id: subId, kind: 'memory', nodeType: 'hub', label: meta.label, detail: `${rm.visualMemory.length} images`, size: 7, color: meta.color, colorRgb: meta.rgb, count: rm.visualMemory.length });
        links.push({ source: 'hub-mem', target: subId, linkType: 'memory-cat' });

        // Show most recent images as leaf nodes
        rm.visualMemory.slice(-15).forEach((img, i) => {
          const id = `vimg:${i}`;
          const label = img.timestamp
            ? new Date(img.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : img.name.replace(/\.[^.]+$/, '').slice(0, 18);
          const isScreenshot = img.path.startsWith('screenshots/');
          nodes.push({ id, kind: 'file', nodeType: 'leaf', label: isScreenshot ? `📸 ${label}` : `🖼 ${label}`, detail: img.path, size: 3, color: isScreenshot ? '#fb7185' : meta.color, colorRgb: isScreenshot ? '251,113,133' : meta.rgb });
          links.push({ source: subId, target: id, linkType: 'visual' });
        });
      }
    }
  }

  // ── Conversation timeline — from conversation_history.json dates ──
  {
    const dates = chatDates && chatDates.length > 0 ? chatDates : [];
    // Fallback to memory dates if no chat history
    if (dates.length === 0) {
      const memDates = new Map<string, number>();
      memories.forEach(m => { if (m.date) memDates.set(m.date, (memDates.get(m.date) || 0) + 1); });
      memDates.forEach((count, date) => dates.push({ date, count }));
      dates.sort((a, b) => b.date.localeCompare(a.date));
    }

    if (dates.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      nodes.push({ id: 'hub-timeline', kind: 'conversation', nodeType: 'hub', label: 'History', detail: `${dates.length} days of chat`, size: 10, color: '#8b5cf6', colorRgb: '139,92,246', count: dates.length });
      links.push({ source: A, target: 'hub-timeline', linkType: 'core' });

      dates.slice(0, daysShown).forEach((entry) => {
        const isToday = entry.date === today;
        const label = isToday ? 'Today' : new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        nodes.push({ id: `day:${entry.date}`, kind: 'conversation', nodeType: 'leaf', label, detail: `${entry.count} messages · ${entry.date}`, size: isToday ? 5 : 3, color: isToday ? '#a78bfa' : '#7c3aed', colorRgb: isToday ? '167,139,250' : '124,58,237' });
        links.push({ source: 'hub-timeline', target: `day:${entry.date}`, linkType: 'timeline' });
      });
    }
  }

  // ── Sessions hub — real gateway sessions ─────────────────────────
  if (sessions && sessions.length > 0) {
    nodes.push({ id: 'hub-sessions', kind: 'conversation', nodeType: 'hub', label: 'Sessions', detail: `${sessions.length} sessions`, size: 10, color: '#a78bfa', colorRgb: '167,139,250', count: sessions.length });
    links.push({ source: A, target: 'hub-sessions', linkType: 'core' });

    sessions.slice(0, 15).forEach((s, i) => {
      const id = `sess:${s.key}`;
      const isActive = s.state === 'running' || s.state === 'thinking' || s.state === 'busy';
      const isCurrent = i === 0;
      const shortLabel = s.label ? (s.label.length > 22 ? s.label.slice(0, 22) + '…' : s.label) : s.key.split(':').pop() || `Session ${i + 1}`;
      let detail = s.key;
      if (s.model) detail += ` · ${s.model}`;
      if (s.lastActivity) {
        const d = new Date(typeof s.lastActivity === 'string' ? s.lastActivity : s.lastActivity);
        detail += ` · ${d.toLocaleDateString()}`;
      }
      nodes.push({ id, kind: 'conversation', nodeType: 'leaf', label: shortLabel, detail, size: isCurrent ? 5 : isActive ? 4 : 3, color: isActive ? '#818cf8' : isCurrent ? '#a78bfa' : '#8b5cf6', colorRgb: isActive ? '129,140,248' : isCurrent ? '167,139,250' : '139,92,246', pulse: isActive });
      links.push({ source: 'hub-sessions', target: id, linkType: 'session' });
    });
  }

  // ── Chat — recent session flow with user + agent replies ────────
  const msgs = messages.slice(-20);
  if (msgs.length > 0) {
    nodes.push({ id: 'hub-chat', kind: 'conversation', nodeType: 'hub', label: 'Chat', detail: `${messages.length} messages this session`, size: 12, color: '#06b6d4', colorRgb: '6,182,212', count: messages.length });
    links.push({ source: A, target: 'hub-chat', linkType: 'core' });

    // Build session flow: user → agent pairs, chained sequentially
    let lastUserId: string | null = null;
    let prevAgentId: string | null = null;
    msgs.forEach((m, i) => {
      const id = `c:${i}`;
      const u = m.role === 'user';
      const recency = (i + 1) / msgs.length;
      const snippet = m.text.slice(0, 28) + (m.text.length > 28 ? '…' : '');
      nodes.push({
        id, kind: 'conversation', nodeType: 'leaf',
        label: u ? `You: ${snippet}` : `Agent: ${snippet}`,
        detail: m.text.slice(0, 400),
        size: u ? 2.5 + recency * 1.5 : 3 + recency * 2,
        color: u ? '#38bdf8' : '#06b6d4',
        colorRgb: u ? '56,189,248' : '6,182,212',
      });
      links.push({ source: 'hub-chat', target: id, linkType: 'chat' });

      // User→agent pair link
      if (u) {
        // Chain from previous agent reply to this user message
        if (prevAgentId) links.push({ source: prevAgentId, target: id, linkType: 'flow' });
        lastUserId = id;
      } else {
        if (lastUserId) {
          links.push({ source: lastUserId, target: id, linkType: 'qa-pair' });
          lastUserId = null;
        }
        prevAgentId = id;
      }
    });
  }

  // ── Special folders — Skills, Macros, Tools ─────────────────────
  if (specialFolders) {
    const FOLDER_META: Record<string, { kind: NodeKind; label: string; icon: string; color: string; rgb: string; hubColor: string; hubRgb: string }> = {
      skills: { kind: 'skill', label: 'Skills',  icon: '⚡', color: '#fbbf24', rgb: '251,191,36',  hubColor: '#f59e0b', hubRgb: '245,158,11' },
      macros: { kind: 'macro', label: 'Macros',  icon: '⚙',  color: '#22d3ee', rgb: '34,211,238',  hubColor: '#06b6d4', hubRgb: '6,182,212'  },
      tools:  { kind: 'tool',  label: 'Tools',   icon: '🔧', color: '#f87171', rgb: '248,113,113', hubColor: '#ef4444', hubRgb: '239,68,68'  },
    };

    for (const [folderKey, meta] of Object.entries(FOLDER_META)) {
      const items = (specialFolders as any)[folderKey] as Array<{ name: string; path: string; size: number }> || [];
      if (items.length === 0) continue;

      const hubId = `hub-${folderKey}`;
      nodes.push({ id: hubId, kind: meta.kind as NodeKind, nodeType: 'hub', label: meta.label, detail: `${items.length} ${folderKey}`, size: 12, color: meta.hubColor, colorRgb: meta.hubRgb, icon: meta.icon, count: items.length });
      links.push({ source: A, target: hubId, linkType: 'core' });

      // Group by subdirectory
      const subDirs = new Map<string, Array<{ name: string; path: string }>>(); 
      const rootItems: Array<{ name: string; path: string }> = [];

      items.forEach(f => {
        const rel = f.path.replace(`${folderKey}/`, '');
        const parts = rel.split('/');
        if (parts.length > 1) {
          const sub = parts[0];
          if (!subDirs.has(sub)) subDirs.set(sub, []);
          subDirs.get(sub)!.push({ name: f.name, path: f.path });
        } else {
          rootItems.push({ name: f.name, path: f.path });
        }
      });

      // Sub-directory hub nodes
      subDirs.forEach((files, subName) => {
        const subId = `${folderKey}-dir:${subName}`;
        nodes.push({ id: subId, kind: meta.kind as NodeKind, nodeType: 'hub', label: subName, detail: `${files.length} files`, size: 5, color: meta.color, colorRgb: meta.rgb, count: files.length });
        links.push({ source: hubId, target: subId, linkType: `${folderKey}-dir` });

        files.slice(0, 20).forEach(f => {
          const id = `${folderKey}:${f.path}`;
          nodes.push({ id, kind: meta.kind as NodeKind, nodeType: 'leaf', label: f.name.replace(/\.[^.]+$/, ''), detail: f.path, size: 2.5, color: meta.color, colorRgb: meta.rgb });
          links.push({ source: subId, target: id, linkType: folderKey });
        });
      });

      // Root-level files
      rootItems.slice(0, 30).forEach(f => {
        const id = `${folderKey}:${f.path}`;
        nodes.push({ id, kind: meta.kind as NodeKind, nodeType: 'leaf', label: f.name.replace(/\.[^.]+$/, ''), detail: f.path, size: 2.5, color: meta.color, colorRgb: meta.rgb });
        links.push({ source: hubId, target: id, linkType: folderKey });
      });
    }
  }

  // Tasks
  tasks.slice(0, 10).forEach((t, i) => {
    const id = `t:${i}`;
    nodes.push({ id, kind: 'task', nodeType: 'leaf', label: t.title.slice(0, 30), detail: `${t.source} · ${t.status}`, size: 3, color: PAL.task.color, colorRgb: PAL.task.rgb });
    links.push({ source: A, target: id, linkType: 'task' });
  });

  // Live activity events (ephemeral)
  liveEvents.forEach(ev => {
    nodes.push({ id: ev.id, kind: 'live', nodeType: 'leaf', label: ev.label, detail: ev.detail || ev.label, size: 2.5, color: PAL.live.color, colorRgb: PAL.live.rgb, pulse: true });
    links.push({ source: A, target: ev.id, linkType: 'live' });
  });

  return { nodes, links };
}

// ─── Component ────────────────────────────────────────────────────
export function ForceGraph({ agentName, agentState, model, memories, files, messages, tasks, liveEvents = [], gatewayModels = [], sessions = [], chatDates = [], realMemory = null, specialFolders = null, externalHighlightRef, onNodeClick, onNodeDoubleClick }: ForceGraphProps) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ w: 800, h: 600 });
  const [hoveredNode, setHoveredNode] = useState<GNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const highlightedNodeRef = useRef<string | null>(null);
  highlightedNodeRef.current = highlightedNode;
  const [showPhysics, setShowPhysics] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const onDblClickRef = useRef(onNodeDoubleClick);
  onDblClickRef.current = onNodeDoubleClick;

  // Physics sliders — persisted in localStorage
  const [gp, setGp] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('substrate-graph-physics') || '{}'); } catch { return {}; }
  });
  const gpVal = (k: string, def: number) => gp[k] ?? def;
  const updateGp = (k: string, v: number) => {
    setGp(prev => {
      const next = { ...prev, [k]: v };
      localStorage.setItem('substrate-graph-physics', JSON.stringify(next));
      return next;
    });
  };

  // Container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setGraphSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mouse tracking for tooltip
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => setTooltipPos({ x: e.clientX, y: e.clientY });
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, []);

  // Store liveEvents + agentState in refs so they don't trigger graph rebuild
  const liveEventsRef = useRef(liveEvents);
  liveEventsRef.current = liveEvents;
  const agentStateRef = useRef(agentState);
  agentStateRef.current = agentState;

  // Build graph data — only rebuild on structural changes (files, memories, etc.)
  // liveEvents and agentState are read from refs inside buildGraphData
  const prevGraphRef = useRef<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const prevSignatureRef = useRef('');
  const graphData = useMemo(
    () => {
      const next = buildGraphData(agentName, agentStateRef.current, model, memories, files, messages, tasks, liveEventsRef.current, gatewayModels, sessions, chatDates, realMemory, specialFolders, Math.round(gpVal('daysShown', 20)));
      // Only return a new object if the graph structure actually changed
      // This prevents react-force-graph-2d from reheating on cosmetic changes
      const sig = next.nodes.length + ':' + next.links.length + ':' + next.nodes.map(n => n.id).join(',');
      if (sig === prevSignatureRef.current && prevGraphRef.current) {
        return prevGraphRef.current;
      }
      prevSignatureRef.current = sig;
      prevGraphRef.current = next;
      return next;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentName, model, memories, files, messages, tasks, gatewayModels, sessions, chatDates, realMemory, specialFolders, gpVal('daysShown', 20)],
  );

  // Pre-compute neighbor sets for click isolation
  const neighborMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    graphData.nodes.forEach(n => m.set(n.id, new Set()));
    graphData.links.forEach(l => {
      const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
      m.get(s)?.add(t);
      m.get(t)?.add(s);
    });
    return m;
  }, [graphData]);

  // External highlight via shared ref — no re-render, no physics reheat
  const extHighlightRef = externalHighlightRef ?? { current: null };

  const isHighlighted = useCallback((nodeId: string) => {
    const hn = highlightedNodeRef.current;
    if (!hn) return true;
    return nodeId === hn || (neighborMap.get(hn)?.has(nodeId) ?? false);
  }, [neighborMap]);

  const initDoneRef = useRef(false);

  // Hover repulsion — gently push nearby nodes away from hovered node.
  // Forces read LIVE node positions each d3 tick (no stale snapshots).
  const hoverRepulsionRef = useRef<string | null>(null);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const hovId = hoveredNode?.id || extHighlightRef.current;

    if (hovId === hoverRepulsionRef.current) return;
    hoverRepulsionRef.current = hovId;

    if (hovId) {
      // Find the target node object — d3 mutates .x/.y in place, so we
      // hold the reference and read live coords each force tick.
      const targetNode = graphData.nodes.find((nd: any) => nd.id === hovId) as any;
      if (targetNode) {
        const radius = 100;
        const push = 4;
        const str = 0.018;
        fg.d3Force('hoverRepel', forceX((d: any) => {
          const tx = targetNode.x ?? 0;
          if (d.id === hovId) return tx;
          const dx = (d.x || 0) - tx;
          const dy = (d.y || 0) - (targetNode.y ?? 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist > radius) return d.x || 0;
          const falloff = 1 - dist / radius;
          return (d.x || 0) + (dx / dist) * push * falloff;
        }).strength(str));
        fg.d3Force('hoverRepelY', forceY((d: any) => {
          const ty = targetNode.y ?? 0;
          if (d.id === hovId) return ty;
          const dx = (d.x || 0) - (targetNode.x ?? 0);
          const dy = (d.y || 0) - ty;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist > radius) return d.y || 0;
          const falloff = 1 - dist / radius;
          return (d.y || 0) + (dy / dist) * push * falloff;
        }).strength(str));
      }
    } else {
      fg.d3Force('hoverRepel', null);
      fg.d3Force('hoverRepelY', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredNode, graphData]);

  // Configure forces — only on mount + physics slider changes
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const spread = gpVal('spread', 1);
    const linkDist = gpVal('linkDist', 1);
    const subDist = gpVal('subDist', 1);
    const gravity = gpVal('gravity', 1);

    fg.d3Force('charge')?.strength((d: GNode) => {
      const base = d.kind === 'agent' ? -250 : d.nodeType === 'hub' ? -100 : -25;
      return base * spread;
    });
    fg.d3Force('link')?.distance((l: any) => {
      const lt = l.linkType;
      const isCore = lt === 'core';
      const base = lt === 'core' ? 35 : lt === 'directory' ? 20 : lt === 'memory-cat' ? 22 : lt === 'provider' ? 22 : lt === 'model' ? 16 : lt === 'key-file' ? 18 : lt === 'qa-pair' ? 10 : lt === 'chat' ? 14 : lt === 'session' ? 16 : lt === 'timeline' ? 16 : 15;
      return base * (isCore ? linkDist : linkDist * subDist);
    });
    fg.d3Force('center', null);
    fg.d3Force('gravX', forceX(0).strength(0.06 * gravity));
    fg.d3Force('gravY', forceY(0).strength(0.06 * gravity));

    if (initDoneRef.current) {
      // Physics sliders changed after init — reheat to apply
      fg.d3ReheatSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gp]);

  // Initial zoom to fit — once after first render
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    setTimeout(() => fgRef.current?.zoomToFit?.(400, 60), 800);
  }, [graphData]);


  // Double-click detection: first click → isolate, second click within 400ms → open
  const lastClickRef = useRef<{ id: string; ts: number } | null>(null);

  const handleNodeClick = useCallback((node: any) => {
    const now = Date.now();
    const last = lastClickRef.current;

    if (last && last.id === node.id && now - last.ts < 400) {
      // Double-click → open file / trigger action
      lastClickRef.current = null;
      onDblClickRef.current?.(node.kind, node.id, node.detail);
      return;
    }

    // Single click → isolate
    lastClickRef.current = { id: node.id, ts: now };
    setHighlightedNode(prev => prev === node.id ? null : node.id);
    onClickRef.current?.(node.kind, node.id, node.detail);
  }, []);

  const handleBgClick = useCallback(() => { setHighlightedNode(null); lastClickRef.current = null; }, []);

  // Search — filter nodes by label/detail
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return graphData.nodes
      .filter(n => n.label.toLowerCase().includes(q) || (n.detail || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [searchQuery, graphData]);

  const navigateToNode = useCallback((node: GNode) => {
    const fg = fgRef.current;
    if (!fg) return;
    const n = node as any;
    if (n.x != null && n.y != null) {
      fg.centerAt(n.x, n.y, 600);
      fg.zoom(3, 600);
    }
    setHighlightedNode(node.id);
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ minHeight: 400 }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={graphSize.w}
        height={graphSize.h}
        backgroundColor="transparent"
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBgClick}
        onNodeHover={(node: any) => {
          if (!node) { setHoveredNode(null); setTooltipPos(null); return; }
          setHoveredNode(node as GNode);
        }}
        cooldownTime={Infinity}
        d3AlphaDecay={0.04}
        d3AlphaMin={0}
        d3VelocityDecay={0.55}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, gs: number) => {
          if (node.x == null || node.y == null) return;
          const n = node as GNode & { x: number; y: number };
          const rgb = n.colorRgb;
          const now = performance.now();
          const lit = isHighlighted(n.id);
          const dimAlpha = lit ? 1 : 0.1;
          // External hover glow — brightens node without dimming others
          const isExtGlow = extHighlightRef.current === n.id;

          // ── Hub & agent nodes ───────────────────────────────────
          if (n.nodeType === 'hub' || n.nodeType === 'agent') {
            const cloudR = (n.nodeType === 'agent' ? 55 : n.size > 10 ? 40 : 28) / gs;

            // External hover glow for hub/directory nodes
            if (isExtGlow) {
              const glowR = cloudR * 1.8;
              const g = ctx.createRadialGradient(n.x, n.y, cloudR * 0.3, n.x, n.y, glowR);
              g.addColorStop(0, `rgba(${rgb},${0.6 + Math.sin(now / 200) * 0.15})`);
              g.addColorStop(0.4, `rgba(${rgb},0.25)`);
              g.addColorStop(1, `rgba(${rgb},0)`);
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2); ctx.fill();
            }

            const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, cloudR);
            const pulse = n.pulse ? 0.2 + Math.sin(now / 400) * 0.05 : 0.14;
            grad.addColorStop(0, `rgba(${rgb},${(isExtGlow ? 0.35 : pulse) * dimAlpha})`);
            grad.addColorStop(0.6, `rgba(${rgb},${(isExtGlow ? 0.1 : 0.04) * dimAlpha})`);
            grad.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(n.x, n.y, cloudR, 0, Math.PI * 2); ctx.fill();

            const hubR = (n.nodeType === 'agent' ? 12 : n.size > 10 ? 9 : 6) / gs;
            ctx.beginPath(); ctx.arc(n.x, n.y, hubR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb},${(isExtGlow ? 0.5 : 0.25) * dimAlpha})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${rgb.split(',').join(',')},${isExtGlow ? 1 : dimAlpha})`;
            ctx.lineWidth = (isExtGlow ? 3 : 2) / gs;
            ctx.stroke();

            // Bright ring for ext glow
            if (isExtGlow) {
              ctx.beginPath(); ctx.arc(n.x, n.y, hubR * 1.6, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(${rgb},0.7)`;
              ctx.lineWidth = 1.5 / gs;
              ctx.stroke();
            }

            const fs = Math.max((n.nodeType === 'agent' ? 14 : n.size > 10 ? 12 : 10) / gs, 3);
            ctx.font = `bold ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(${rgb.split(',').join(',')},${isExtGlow ? 1 : 0.9 * dimAlpha})`;
            ctx.fillText(n.label, n.x, n.y + hubR + fs * 0.8);

            if (n.count) {
              const cfs = Math.max(8 / gs, 2.5);
              ctx.font = `${cfs}px -apple-system, sans-serif`;
              ctx.fillStyle = `rgba(255,255,255,${isExtGlow ? 0.7 : 0.4 * dimAlpha})`;
              ctx.fillText(`${n.count} items`, n.x, n.y + hubR + fs * 0.8 + cfs * 1.2);
            }
            return;
          }

          // ── Leaf nodes ──────────────────────────────────────────
          const isKey = n.kind === 'file' && KEY_FILES.has(n.label);
          const baseR = Math.sqrt(n.size || 2) * 2.5 / gs;

          // External hover glow ring — large bright pulse
          if (isExtGlow) {
            const glowR = baseR * 5;
            const g = ctx.createRadialGradient(n.x, n.y, baseR * 0.5, n.x, n.y, glowR);
            g.addColorStop(0, `rgba(${rgb},${0.5 + Math.sin(now / 200) * 0.15})`);
            g.addColorStop(0.4, `rgba(${rgb},0.2)`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2); ctx.fill();
            // Bright ring
            ctx.beginPath(); ctx.arc(n.x, n.y, baseR * 2.5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${rgb},0.8)`;
            ctx.lineWidth = 2 / gs;
            ctx.stroke();
          } else if ((isKey || n.pulse) && lit) {
            const glowR = baseR * 3;
            const g = ctx.createRadialGradient(n.x, n.y, baseR * 0.3, n.x, n.y, glowR);
            g.addColorStop(0, `rgba(${rgb},${n.pulse ? 0.25 + Math.sin(now / 300) * 0.1 : 0.15})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2); ctx.fill();
          }

          ctx.beginPath(); ctx.arc(n.x, n.y, isExtGlow ? baseR * 1.8 : baseR, 0, Math.PI * 2);
          ctx.fillStyle = (lit || isExtGlow) ? n.color : `rgba(${rgb},${dimAlpha})`;
          ctx.fill();

          if (lit || isExtGlow) {
            ctx.beginPath(); ctx.arc(n.x, n.y, (isExtGlow ? baseR * 1.8 : baseR) * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fill();
          }

          const showLabel = isKey || isExtGlow || gs < 2.5 || n.kind === 'model' || n.pulse;
          if (showLabel && (lit || isExtGlow)) {
            const fs = Math.max(((isKey || isExtGlow) ? 9 : 7) / gs, 2);
            ctx.font = `${(isKey || isExtGlow) ? 'bold ' : ''}${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(255,255,255,${isExtGlow ? 0.95 : isKey ? 0.85 : 0.6})`;
            const maxC = isExtGlow ? 30 : isKey ? 20 : 14;
            const txt = n.label.length > maxC ? n.label.slice(0, maxC) + '…' : n.label;
            ctx.fillText(txt, n.x, n.y + (isExtGlow ? baseR * 1.8 : baseR) + fs * 0.7);
          }
        }}
        linkColor={(link: any) => {
          const lt = link.linkType;
          const sid = link.source?.id ?? link.source;
          const tid = link.target?.id ?? link.target;
          // Dim links not connected to highlighted node
          const hn = highlightedNodeRef.current;
          if (hn && sid !== hn && tid !== hn) {
            return 'rgba(255,255,255,0.008)';
          }
          if (lt === 'core') {
            const tgt = graphData.nodes.find(nd => nd.id === tid);
            return tgt ? `rgba(${tgt.colorRgb},0.15)` : 'rgba(255,255,255,0.05)';
          }
          if (lt === 'directory') return 'rgba(74,222,128,0.1)';
          if (lt === 'key-file') return 'rgba(74,222,128,0.15)';
          if (lt === 'file') return 'rgba(52,211,153,0.05)';
          if (lt === 'memory-cat') return 'rgba(236,72,153,0.12)';
          if (lt === 'memory') return 'rgba(244,114,182,0.06)';
          if (lt === 'chat') return 'rgba(34,211,238,0.08)';
          if (lt === 'qa-pair') return 'rgba(56,189,248,0.2)';
          if (lt === 'provider') return 'rgba(196,181,253,0.12)';
          if (lt === 'model') return 'rgba(167,139,250,0.1)';
          if (lt === 'session') return 'rgba(167,139,250,0.1)';
          if (lt === 'timeline') return 'rgba(139,92,246,0.12)';
          if (lt === 'task') return 'rgba(251,191,36,0.08)';
          if (lt === 'live') return 'rgba(251,146,60,0.15)';
          if (lt === 'skills' || lt === 'skills-dir') return 'rgba(245,158,11,0.12)';
          if (lt === 'macros' || lt === 'macros-dir') return 'rgba(6,182,212,0.12)';
          if (lt === 'tools' || lt === 'tools-dir') return 'rgba(239,68,68,0.12)';
          return 'rgba(255,255,255,0.04)';
        }}
        linkWidth={(link: any) => {
          if (link.linkType === 'core') return 1.5;
          if (link.linkType === 'qa-pair') return 1;
          if (link.linkType === 'provider') return 0.8;
          if (link.linkType === 'directory') return 0.8;
          if (link.linkType === 'memory-cat') return 0.8;
          if (link.linkType === 'live') return 0.8;
          return 0.3;
        }}
        linkCurvature={(link: any) => {
          if (link.linkType === 'qa-pair') return 0.25;
          if (link.linkType === 'memory-cat') return 0.15;
          if (link.linkType === 'provider') return 0.12;
          if (link.linkType === 'directory') return 0.1;
          if (link.linkType === 'model') return 0.08;
          if (link.linkType === 'core') return 0.05;
          return 0.08;
        }}
        linkLineDash={(link: any) => {
          if (link.linkType === 'qa-pair') return [4, 3];
          if (link.linkType === 'session') return [3, 3];
          if (link.linkType === 'timeline') return [3, 2];
          if (link.linkType === 'live') return [2, 3];
          return null;
        }}
      />

      {/* Hover tooltip */}
      {hoveredNode && tooltipPos && (
        <div className="fixed z-50 pointer-events-none" style={{ left: Math.min(tooltipPos.x + 16, window.innerWidth - 280), top: Math.min(tooltipPos.y + 16, window.innerHeight - 120) }}>
          <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-2.5 text-[11px] leading-relaxed max-w-[260px] shadow-2xl">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: hoveredNode.color }} />
              <span className="font-semibold text-white/60 uppercase tracking-wider text-[9px]">{hoveredNode.kind}</span>
            </div>
            <div className="text-white/85 font-medium text-xs mb-0.5">{hoveredNode.label}</div>
            {hoveredNode.detail && hoveredNode.detail !== hoveredNode.label && (
              <div className="text-white/45 break-words text-[10px]">{hoveredNode.detail}</div>
            )}
          </div>
        </div>
      )}

      {/* Search bar — top left */}
      <div className="absolute top-3 left-3 z-30" style={{ width: searchOpen ? 260 : 'auto' }}>
        {searchOpen ? (
          <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2">
              <Search size={13} className="text-white/40 shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                  if (e.key === 'Enter' && searchResults.length > 0) navigateToNode(searchResults[0]);
                }}
                placeholder="Search nodes…"
                autoFocus
                className="flex-1 bg-transparent text-white/80 text-[11px] placeholder-white/25 focus:outline-none"
              />
              <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
            </div>
            {searchQuery.trim() && (
              <div className="border-t border-white/[0.06] max-h-60 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-3 py-3 text-[10px] text-white/25 text-center">No matches</div>
                ) : (
                  searchResults.map(n => (
                    <button
                      key={n.id}
                      onClick={() => navigateToNode(n)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.06] transition-colors text-left group"
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: n.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-white/70 truncate group-hover:text-white/90">{n.label}</div>
                        {n.detail && n.detail !== n.label && (
                          <div className="text-[9px] text-white/30 truncate">{n.detail}</div>
                        )}
                      </div>
                      <span className="text-[8px] text-white/20 uppercase shrink-0">{n.kind}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
            className="p-1.5 rounded-lg border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 transition-all bg-black/40 backdrop-blur-sm"
            title="Search nodes (Ctrl+F)"
          >
            <Search size={13} />
          </button>
        )}
      </div>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
        <span className="text-[10px] text-white/20 mr-1">{graphData.nodes.length} nodes</span>
        <button onClick={() => setShowPhysics(!showPhysics)} className={`p-1.5 rounded-lg border transition-all ${showPhysics ? 'border-[#818cf8] text-[#818cf8] bg-[#818cf8]/10' : 'border-white/10 text-white/30 hover:text-white/60 hover:border-white/20'}`} title="Physics"><SlidersHorizontal size={13} /></button>
        <button onClick={() => fgRef.current?.zoomToFit(400, 60)} className="p-1.5 rounded-lg border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 transition-all" title="Reset view"><RotateCcw size={13} /></button>
        <button onClick={() => { const z = fgRef.current?.zoom(); fgRef.current?.zoom((z || 1) * 1.4, 300); }} className="p-1.5 rounded-lg border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 transition-all" title="Zoom in"><ZoomIn size={13} /></button>
        <button onClick={() => { const z = fgRef.current?.zoom(); fgRef.current?.zoom((z || 1) * 0.7, 300); }} className="p-1.5 rounded-lg border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 transition-all" title="Zoom out"><ZoomOut size={13} /></button>
      </div>

      {/* Physics sliders panel */}
      {showPhysics && (
        <div className="absolute top-14 right-3 z-30 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl w-52">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-white/70">Graph Physics</h4>
            <button onClick={() => setShowPhysics(false)} className="text-white/30 hover:text-white/60"><X size={12} /></button>
          </div>
          {[
            ['spread', 'Repulsion', 0.2, 3, 1],
            ['linkDist', 'Link Distance', 0.3, 3, 1],
            ['subDist', 'Sub-node Distance', 0.3, 3, 1],
            ['gravity', 'Center Pull', 0.2, 4, 1],
          ].map(([key, label, min, max, def]) => (
            <div key={key as string} className="mb-2.5">
              <div className="flex justify-between text-[10px] font-mono text-white/40 mb-0.5">
                <span>{label as string}</span><span>{gpVal(key as string, def as number).toFixed(1)}</span>
              </div>
              <input type="range" min={min as number} max={max as number} step={0.1} value={gpVal(key as string, def as number)} onChange={e => updateGp(key as string, parseFloat(e.target.value))} className="w-full h-1 accent-[#818cf8] cursor-pointer" />
            </div>
          ))}
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="mb-2.5">
              <div className="flex justify-between text-[10px] font-mono text-white/40 mb-0.5">
                <span>Days Shown</span><span>{Math.round(gpVal('daysShown', 20))}</span>
              </div>
              <input type="range" min={5} max={365} step={1} value={Math.round(gpVal('daysShown', 20))} onChange={e => updateGp('daysShown', parseInt(e.target.value))} className="w-full h-1 accent-[#8b5cf6] cursor-pointer" />
            </div>
          </div>
          <button onClick={() => { setGp({}); localStorage.removeItem('substrate-graph-physics'); }} className="w-full mt-1 py-1 text-[10px] font-mono text-white/30 hover:text-white/60 border border-white/10 rounded-lg transition-all">Reset Defaults</button>
        </div>
      )}

      {/* Isolation indicator */}
      {highlightedNode && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
          <button onClick={() => setHighlightedNode(null)} className="px-3 py-1.5 bg-black/70 backdrop-blur-xl border border-white/15 rounded-full text-[10px] text-white/60 hover:text-white/80 transition-all flex items-center gap-1.5">
            <X size={10} /> Click to clear isolation
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/20 pointer-events-none">
        {Object.entries(PAL).filter(([k]) => k !== 'live').map(([kind, { color }]) => (
          <div key={kind} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="capitalize">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

