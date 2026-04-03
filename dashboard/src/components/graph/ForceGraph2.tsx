/**
 * ForceGraph — d3-force physics workspace graph with fluid drag, curved
 * elastic links, and stable simulation that never resets node positions.
 *
 * Key design choices:
 *  - Simulation runs in a ref, never destroyed on data changes
 *  - New data is MERGED into existing nodes (preserving x/y positions)
 *  - Links are drawn as quadratic bezier curves with subtle curvature
 *  - Drag uses warm restart + velocity decay for springy feel
 *  - Canvas-rendered at 60fps with requestAnimationFrame
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { select, type Selection } from 'd3-selection';
import { zoom as d3Zoom, type ZoomTransform } from 'd3-zoom';

// ─── Types ────────────────────────────────────────────────────────
export type NodeKind = 'agent' | 'model' | 'memory' | 'file' | 'conversation' | 'task' | 'live';

export interface LiveEvent {
  id: string;
  kind: 'tool_call' | 'streaming' | 'thinking' | 'memory_search';
  label: string;
  detail?: string;
  timestamp: number;
}

export interface GNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  detail?: string;
  radius: number;
  color: string;
  glow: string;
  pulse?: boolean;
  birthTime?: number; // timestamp for spawn animation
}

export interface GLink extends SimulationLinkDatum<GNode> {
  id: string;
  color: string;
  width: number;
}

// ─── Palette ──────────────────────────────────────────────────────
const P: Record<NodeKind, { fill: string; glow: string; line: string }> = {
  agent:        { fill: '#818cf8', glow: 'rgba(129,140,248,0.4)',  line: 'rgba(129,140,248,0.25)' },
  model:        { fill: '#a78bfa', glow: 'rgba(167,139,250,0.35)', line: 'rgba(167,139,250,0.2)'  },
  memory:       { fill: '#f472b6', glow: 'rgba(244,114,182,0.35)', line: 'rgba(244,114,182,0.18)' },
  file:         { fill: '#34d399', glow: 'rgba(52,211,153,0.3)',   line: 'rgba(52,211,153,0.15)'  },
  conversation: { fill: '#22d3ee', glow: 'rgba(34,211,238,0.35)',  line: 'rgba(34,211,238,0.2)'   },
  task:         { fill: '#fbbf24', glow: 'rgba(251,191,36,0.3)',   line: 'rgba(251,191,36,0.18)'  },
  live:         { fill: '#fb923c', glow: 'rgba(251,146,60,0.5)',   line: 'rgba(251,146,60,0.3)'   },
};

const LIVE_COLORS: Record<string, string> = {
  tool_call: '#fb923c',
  streaming: '#818cf8',
  thinking: '#c084fc',
  memory_search: '#f472b6',
};

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
  onNodeClick?: (kind: NodeKind, id: string) => void;
}

// ─── Build flat node/link arrays (pure, no positions) ─────────────
function buildDesired(
  agentName: string, agentState: string, model: string,
  memories: ForceGraphProps['memories'],
  files: ForceGraphProps['files'],
  messages: ForceGraphProps['messages'],
  tasks: ForceGraphProps['tasks'],
  liveEvents: LiveEvent[] = [],
): { nodes: Omit<GNode, 'x' | 'y'>[]; links: { id: string; source: string; target: string; color: string; width: number }[] } {
  const nodes: Omit<GNode, 'x' | 'y'>[] = [];
  const links: { id: string; source: string; target: string; color: string; width: number }[] = [];
  const A = 'agent-main';
  const HUB_WS = 'hub-workspace';
  const HUB_MEM = 'hub-memory';
  const HUB_CHAT = 'hub-chat';

  // ── Agent (no fx/fy — participates in physics) ──────────────────
  nodes.push({ id: A, kind: 'agent', label: agentName, detail: agentState, radius: 32, color: P.agent.fill, glow: P.agent.glow, pulse: agentState !== 'idle' });

  // ── Model ───────────────────────────────────────────────────────
  if (model && model !== 'unknown') {
    nodes.push({ id: 'model', kind: 'model', label: model.split('/').pop() || model, detail: model, radius: 16, color: P.model.fill, glow: P.model.glow });
    links.push({ id: 'l-model', source: A, target: 'model', color: P.model.line, width: 1.5 });
  }

  // ── Workspace hub — files cluster off this ──────────────────────
  if (files.length > 0) {
    nodes.push({ id: HUB_WS, kind: 'file', label: 'Workspace', detail: `${files.length} files`, radius: 20, color: '#22c55e', glow: 'rgba(34,197,94,0.4)' });
    links.push({ id: 'l-hub-ws', source: A, target: HUB_WS, color: 'rgba(34,197,94,0.25)', width: 2 });

    const KEY_FILES = new Set(['CIRCUITS.md','PRIME.md','SUBSTRATE.md','TOOL_PROMPT.md','config.json','gateway.py','main.py','main.js','package.json','memory.json','conversation_history.json','wake_circuits.py','README.md','custom_settings.json']);
    files.slice(0, 60).forEach((f) => {
      const id = `file-${f.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const isKey = KEY_FILES.has(f.name);
      const ext = f.name.split('.').pop() || '';
      const isMd = ext === 'md';
      const isConfig = ext === 'json';
      const isPy = ext === 'py';
      nodes.push({
        id, kind: 'file', label: f.name, detail: f.path,
        radius: isKey ? 11 : 5,
        color: isKey ? (isMd ? '#4ade80' : isConfig ? '#fbbf24' : isPy ? '#38bdf8' : '#34d399') : P.file.fill,
        glow: isKey ? (isMd ? 'rgba(74,222,128,0.35)' : isConfig ? 'rgba(251,191,36,0.3)' : isPy ? 'rgba(56,189,248,0.3)' : P.file.glow) : P.file.glow,
      });
      links.push({ id: `lf-${id}`, source: HUB_WS, target: id, color: isKey ? 'rgba(74,222,128,0.2)' : P.file.line, width: isKey ? 0.8 : 0.4 });
    });
  }

  // ── Memory hub — memories cluster off this ──────────────────────
  if (memories.length > 0) {
    nodes.push({ id: HUB_MEM, kind: 'memory', label: 'Memory', detail: `${memories.length} memories`, radius: 18, color: '#ec4899', glow: 'rgba(236,72,153,0.4)' });
    links.push({ id: 'l-hub-mem', source: A, target: HUB_MEM, color: 'rgba(236,72,153,0.2)', width: 1.8 });

    memories.slice(0, 20).forEach((m, i) => {
      const id = `mem-${i}`;
      nodes.push({ id, kind: 'memory', label: m.text.slice(0, 30) + (m.text.length > 30 ? '…' : ''), detail: m.text.slice(0, 200), radius: 6 + Math.min(m.text.length / 80, 4), color: P.memory.fill, glow: P.memory.glow });
      links.push({ id: `lm-${i}`, source: HUB_MEM, target: id, color: P.memory.line, width: 0.6 });
    });
  }

  // ── Chat hub — conversations cluster off this ───────────────────
  const msgs = messages.slice(-20);
  if (msgs.length > 0) {
    nodes.push({ id: HUB_CHAT, kind: 'conversation', label: 'Chat', detail: `${messages.length} messages`, radius: 18, color: '#06b6d4', glow: 'rgba(6,182,212,0.4)' });
    links.push({ id: 'l-hub-chat', source: A, target: HUB_CHAT, color: 'rgba(6,182,212,0.2)', width: 1.8 });

    let prev = HUB_CHAT;
    msgs.forEach((m, i) => {
      const id = `msg-${i}`;
      const u = m.role === 'user';
      nodes.push({ id, kind: 'conversation', label: (u ? '⟩ ' : '') + m.text.slice(0, 28) + (m.text.length > 28 ? '…' : ''), detail: m.text.slice(0, 300), radius: u ? 8 : 10, color: u ? '#38bdf8' : P.conversation.fill, glow: u ? 'rgba(56,189,248,0.3)' : P.conversation.glow });
      links.push({ id: `lc-${i}`, source: prev, target: id, color: P.conversation.line, width: 0.6 });
      prev = id;
    });
  }

  // ── Tasks ───────────────────────────────────────────────────────
  tasks.slice(0, 10).forEach((t, i) => {
    const id = `task-${i}`;
    nodes.push({ id, kind: 'task', label: t.title.slice(0, 36), detail: `${t.source} · ${t.status}`, radius: 8, color: P.task.fill, glow: P.task.glow });
    links.push({ id: `lt-${i}`, source: A, target: id, color: P.task.line, width: 0.7 });
  });

  // ── Live events ─────────────────────────────────────────────────
  liveEvents.forEach((ev) => {
    const col = LIVE_COLORS[ev.kind] || '#fb923c';
    nodes.push({
      id: ev.id, kind: 'live', label: ev.label, detail: ev.detail || ev.label, radius: 6,
      color: col, glow: col.replace(')', ',0.5)').replace('rgb', 'rgba'), pulse: true,
    });
    links.push({ id: `ll-${ev.id}`, source: A, target: ev.id, color: col.replace(')', ',0.25)').replace('rgb', 'rgba'), width: 1.2 });
  });

  return { nodes, links };
}

// ─── Component ────────────────────────────────────────────────────
export function ForceGraph({ agentName, agentState, model, memories, files, messages, tasks, liveEvents = [], onNodeClick }: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const transformRef = useRef<ZoomTransform | null>(null);
  const hovRef = useRef<GNode | null>(null);
  const dragNodeRef = useRef<GNode | null>(null);
  const [hovered, setHovered] = useState<GNode | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const rafRef = useRef(0);
  const mountedRef = useRef(true);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;

  // ── Resize ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Canvas DPR ──────────────────────────────────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    c.width = dims.w * dpr;
    c.height = dims.h * dpr;
    c.style.width = `${dims.w}px`;
    c.style.height = `${dims.h}px`;
  }, [dims]);

  // ── Hit test ────────────────────────────────────────────────────
  const nodeAtRef = useRef<(mx: number, my: number) => GNode | null>(() => null);
  nodeAtRef.current = (mx: number, my: number): GNode | null => {
    const t = transformRef.current;
    const k = t?.k ?? 1;
    const tx = t?.x ?? 0;
    const ty = t?.y ?? 0;
    const gx = (mx - dims.w / 2 - tx) / k;
    const gy = (my - dims.h / 2 - ty) / k;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      if (n.x == null || n.y == null) continue;
      const dx = gx - n.x, dy = gy - n.y;
      if (dx * dx + dy * dy < (n.radius + 5) ** 2) return n;
    }
    return null;
  };

  // ── Birth animation helper ──────────────────────────────────────
  const BIRTH_DURATION = 600; // ms

  // ── Render frame ────────────────────────────────────────────────
  const paint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio || 1;
    const { w, h } = dims;
    const t = transformRef.current;
    const k = t?.k ?? 1;
    const tx = t?.x ?? 0;
    const ty = t?.y ?? 0;
    const now = performance.now();

    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(w / 2 + tx, h / 2 + ty);
    ctx.scale(k, k);

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hov = hovRef.current;

    // ── Draw curved links ─────────────────────────────────────────
    for (const link of links) {
      const s = link.source as GNode;
      const t2 = link.target as GNode;
      if (s.x == null || s.y == null || t2.x == null || t2.y == null) continue;

      // Birth fade for target node
      const tgtBirth = (t2 as GNode).birthTime;
      const tgtAge = tgtBirth ? now - tgtBirth : BIRTH_DURATION;
      const linkAlpha = Math.min(tgtAge / BIRTH_DURATION, 1) * 0.6;
      if (linkAlpha <= 0) continue;

      const dx = t2.x - s.x;
      const dy = t2.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const curve = dist * 0.15;
      const mx = (s.x + t2.x) / 2 - (dy / dist) * curve;
      const my = (s.y + t2.y) / 2 + (dx / dist) * curve;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(mx, my, t2.x, t2.y);
      ctx.strokeStyle = link.color;
      ctx.lineWidth = link.width;
      ctx.globalAlpha = linkAlpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Draw nodes ────────────────────────────────────────────────
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      const isHov = hov?.id === n.id;
      const isDrag = dragNodeRef.current?.id === n.id;

      // Birth animation — scale + opacity ease-out
      const age = n.birthTime ? now - n.birthTime : BIRTH_DURATION;
      const birthProgress = Math.min(age / BIRTH_DURATION, 1);
      const eased = 1 - (1 - birthProgress) ** 3; // ease-out cubic
      const scale = 0.2 + eased * 0.8;
      const alpha = eased;
      const r = n.radius * scale;

      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;

      // Birth burst ring (expanding ring that fades)
      if (birthProgress < 1) {
        const burstR = n.radius * (1 + birthProgress * 2.5);
        const burstAlpha = (1 - birthProgress) * 0.4;
        ctx.beginPath();
        ctx.arc(n.x, n.y, burstR, 0, Math.PI * 2);
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1.5 * (1 - birthProgress);
        ctx.globalAlpha = burstAlpha;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }

      // Outer glow
      if (n.pulse || isHov || isDrag || n.kind === 'agent') {
        const pr = r + (n.pulse ? 10 + Math.sin(now / 350) * 4 : isHov ? 8 : 4);
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, pr);
        g.addColorStop(0, n.glow);
        g.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(n.x, n.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      // Node body
      const bodyGrad = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, 0, n.x, n.y, r);
      bodyGrad.addColorStop(0, n.color + (isHov ? 'ff' : 'cc'));
      bodyGrad.addColorStop(1, n.color + (isHov ? 'bb' : '55'));
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.strokeStyle = isHov || isDrag ? n.color : n.color + '40';
      ctx.lineWidth = isHov || isDrag ? 2 : 0.8;
      ctx.stroke();

      // 3D highlight
      const hl = ctx.createRadialGradient(n.x - r * 0.25, n.y - r * 0.35, 0, n.x, n.y, r);
      hl.addColorStop(0, 'rgba(255,255,255,0.15)');
      hl.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      hl.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = hl;
      ctx.fill();

      // Label — always show, scale by importance
      {
        const isHub = n.id.startsWith('hub-') || n.kind === 'agent' || n.kind === 'model';
        const isKeyFile = n.kind === 'file' && r >= 10;
        const showLabel = isHub || isKeyFile || isHov || isDrag || r >= 8;
        if (showLabel) {
          const fs = isHub ? Math.max(10, r * 0.38) : isKeyFile ? 9 : Math.max(7, Math.min(9, r * 0.5));
          ctx.font = `${isHub || isHov ? '600 ' : '400 '}${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          ctx.fillStyle = isHub ? 'rgba(255,255,255,0.88)' : isHov ? 'rgba(255,255,255,0.92)' : isKeyFile ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const maxC = isHov ? 32 : isHub ? 20 : isKeyFile ? 18 : 12;
          const txt = n.label.length > maxC ? n.label.slice(0, maxC) + '…' : n.label;
          ctx.fillText(txt, n.x, n.y + r + 4);
        }
      }

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [dims]);

  // ── Animation loop ──────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const loop = () => {
      if (!mountedRef.current) return;
      paint();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [paint]);

  // ── Create simulation ONCE ──────────────────────────────────────
  useEffect(() => {
    const sim = forceSimulation<GNode>([])
      .force('charge', forceManyBody<GNode>().strength(d => {
        if (d.kind === 'agent') return -1200;
        if (d.id.startsWith('hub-')) return -400;
        return -80;
      }).distanceMax(500))
      .force('collide', forceCollide<GNode>(d => d.radius + 5).strength(0.7).iterations(2))
      .force('x', forceX<GNode>(0).strength(0.003))
      .force('y', forceY<GNode>(0).strength(0.003))
      .alphaDecay(0.006)
      .velocityDecay(0.12)
      .on('tick', () => { /* paint is driven by RAF */ });

    simRef.current = sim;
    return () => { sim.stop(); };
  }, []);

  // ── Merge data into simulation (never reset positions) ──────────
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    const desired = buildDesired(agentName, agentState, model, memories, files, messages, tasks, liveEvents);
    const oldMap = new Map(nodesRef.current.map(n => [n.id, n]));
    const now = performance.now();
    const newNodes: GNode[] = desired.nodes.map(d => {
      const existing = oldMap.get(d.id);
      if (existing) {
        Object.assign(existing, { label: d.label, detail: d.detail, radius: d.radius, color: d.color, glow: d.glow, pulse: d.pulse });
        return existing;
      }
      // New node — spawn near center with birth animation
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 60;
      return { ...d, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, birthTime: now } as GNode;
    });

    const nodeMap = new Map(newNodes.map(n => [n.id, n]));
    const newLinks: GLink[] = desired.links.map(l => ({
      id: l.id,
      source: nodeMap.get(l.source) || l.source,
      target: nodeMap.get(l.target) || l.target,
      color: l.color,
      width: l.width,
    } as GLink));

    nodesRef.current = newNodes;
    linksRef.current = newLinks;

    sim.nodes(newNodes);
    sim.force('link', forceLink<GNode, GLink>(newLinks).id(d => d.id)
      .distance(d => {
        const s = d.source as GNode;
        const t2 = d.target as GNode;
        return (s.radius + t2.radius) * 2.5 + 40;
      })
      .strength(0.2));

    sim.alpha(Math.max(sim.alpha(), 0.15)).restart();
  }, [agentName, agentState, model, memories, files, messages, tasks, liveEvents]);

  // ── Manual drag + d3-zoom + hover + click ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = select(canvas) as Selection<HTMLCanvasElement, unknown, null, undefined>;

    // d3-zoom for pan/zoom — filtered to skip when dragging a node
    const zoomB = d3Zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 6])
      .filter((event: Event) => {
        // Allow wheel zoom always
        if (event.type === 'wheel') return true;
        // For mouse events, only allow if NOT over a node
        if (event instanceof MouseEvent) {
          const rect = canvas.getBoundingClientRect();
          const n = nodeAtRef.current(event.clientX - rect.left, event.clientY - rect.top);
          return !n; // block zoom-pan when over a node (drag takes over)
        }
        return true;
      })
      .on('zoom', (event) => { transformRef.current = event.transform; });
    sel.call(zoomB);

    // Manual node drag via native mouse events
    let dragging: GNode | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const rect = canvas.getBoundingClientRect();
      const n = nodeAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
      if (!n) return;
      dragging = n;
      dragNodeRef.current = n;
      n.fx = n.x;
      n.fy = n.y;
      simRef.current?.alphaTarget(0.12).restart();
      canvas.style.cursor = 'grabbing';
      e.stopPropagation(); // prevent zoom from capturing this
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();

      if (dragging) {
        const t = transformRef.current;
        const k = t?.k ?? 1;
        const tx = t?.x ?? 0;
        const ty = t?.y ?? 0;
        dragging.fx = (e.clientX - rect.left - dims.w / 2 - tx) / k;
        dragging.fy = (e.clientY - rect.top - dims.h / 2 - ty) / k;
        canvas.style.cursor = 'grabbing';
        return;
      }

      // Hover
      const n = nodeAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
      if (hovRef.current?.id !== n?.id) {
        hovRef.current = n;
        setHovered(n);
      }
      canvas.style.cursor = n ? 'grab' : 'default';
    };

    const onMouseUp = () => {
      if (!dragging) return;
      // Unpin (except agent) — gives springy release feel
      if (dragging.id !== 'agent-main') {
        dragging.fx = null;
        dragging.fy = null;
      }
      dragNodeRef.current = null;
      dragging = null;
      // Let momentum carry — slow decay gives springy feel
      simRef.current?.alphaTarget(0).alpha(0.15).restart();
      canvas.style.cursor = 'default';
    };

    const onClick = (e: MouseEvent) => {
      if (dragNodeRef.current) return; // don't fire click during drag
      const rect = canvas.getBoundingClientRect();
      const n = nodeAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
      if (n) onClickRef.current?.(n.kind, n.id);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
      sel.on('.zoom', null);
    };
  }, [dims]);

  return (
    <div ref={wrapRef} className="relative w-full h-full" style={{ minHeight: 400 }}>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ background: 'transparent' }} />

      {/* Hover card */}
      {hovered && hovered.x != null && hovered.y != null && (() => {
        const t = transformRef.current;
        const k = t?.k ?? 1;
        const tx = t?.x ?? 0;
        const ty = t?.y ?? 0;
        const sx = hovered.x * k + tx + dims.w / 2 + hovered.radius * k + 14;
        const sy = hovered.y * k + ty + dims.h / 2 - 16;
        return (
          <div className="absolute pointer-events-none z-30 max-w-[260px] transition-opacity duration-150"
               style={{ left: sx, top: sy, opacity: 1 }}>
            <div className="glass-card p-2.5 text-[11px] leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: hovered.color }} />
                <span className="font-semibold text-white/70 uppercase tracking-wider text-[9px]">{hovered.kind}</span>
              </div>
              <div className="text-white/60 break-words">{hovered.detail || hovered.label}</div>
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/25">
        {(Object.entries(P) as [NodeKind, typeof P[NodeKind]][]).map(([kind, { fill }]) => (
          <div key={kind} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: fill }} />
            <span className="capitalize">{kind}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute top-3 right-3 text-[10px] text-white/20">
        {nodesRef.current.length} nodes · {linksRef.current.length} links
      </div>
    </div>
  );
}
