/**
 * ForceGraph — d3-force physics-based workspace visualization.
 *
 * Renders agent, memories, files, conversations, and tasks as organic
 * force-directed nodes with drag, zoom, pan, and hover interactions.
 * Canvas-rendered for performance with HTML overlays for hover details.
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { drag as d3Drag } from 'd3-drag';
import { zoom as d3Zoom } from 'd3-zoom';

// ─── Types ────────────────────────────────────────────────────────
export type NodeKind = 'agent' | 'model' | 'memory' | 'file' | 'conversation' | 'task';

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  detail?: string;
  radius: number;
  color: string;
  glowColor: string;
  pulse?: boolean;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string;
  color: string;
  width: number;
}

// ─── Color palette ────────────────────────────────────────────────
const PALETTE: Record<NodeKind, { fill: string; glow: string; stroke: string }> = {
  agent:        { fill: '#818cf8', glow: 'rgba(129,140,248,0.35)', stroke: 'rgba(129,140,248,0.5)' },
  model:        { fill: '#a78bfa', glow: 'rgba(167,139,250,0.30)', stroke: 'rgba(167,139,250,0.4)' },
  memory:       { fill: '#f472b6', glow: 'rgba(244,114,182,0.30)', stroke: 'rgba(244,114,182,0.4)' },
  file:         { fill: '#34d399', glow: 'rgba(52,211,153,0.25)',  stroke: 'rgba(52,211,153,0.4)'  },
  conversation: { fill: '#22d3ee', glow: 'rgba(34,211,238,0.30)',  stroke: 'rgba(34,211,238,0.4)'  },
  task:         { fill: '#fbbf24', glow: 'rgba(251,191,36,0.25)',  stroke: 'rgba(251,191,36,0.4)'  },
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
  onNodeClick?: (kind: NodeKind, id: string) => void;
}

// ─── Build graph data from workspace ──────────────────────────────
function buildGraphData(
  agentName: string,
  agentState: string,
  model: string,
  memories: ForceGraphProps['memories'],
  files: ForceGraphProps['files'],
  messages: ForceGraphProps['messages'],
  tasks: ForceGraphProps['tasks'],
) {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Central agent
  const agentId = 'agent-main';
  nodes.push({
    id: agentId,
    kind: 'agent',
    label: agentName,
    detail: agentState,
    radius: 28,
    color: PALETTE.agent.fill,
    glowColor: PALETTE.agent.glow,
    pulse: agentState !== 'idle',
    fx: 0, fy: 0, // pin to center
  });

  // Model
  if (model && model !== 'unknown') {
    const modelId = 'model-main';
    nodes.push({
      id: modelId,
      kind: 'model',
      label: model.split('/').pop() || model,
      detail: model,
      radius: 16,
      color: PALETTE.model.fill,
      glowColor: PALETTE.model.glow,
    });
    links.push({ id: 'l-agent-model', source: agentId, target: modelId, color: PALETTE.model.stroke, width: 1.5 });
  }

  // Memories (sample up to 20)
  const memSample = memories.slice(0, 20);
  memSample.forEach((mem, i) => {
    const id = `mem-${i}`;
    nodes.push({
      id,
      kind: 'memory',
      label: mem.text.slice(0, 40) + (mem.text.length > 40 ? '…' : ''),
      detail: mem.text.slice(0, 200),
      radius: 8 + Math.min(mem.text.length / 50, 6),
      color: PALETTE.memory.fill,
      glowColor: PALETTE.memory.glow,
    });
    links.push({ id: `l-mem-${i}`, source: agentId, target: id, color: PALETTE.memory.stroke, width: 0.8 });
  });

  // Files (sample up to 25)
  const fileSample = files.slice(0, 25);
  fileSample.forEach((f, i) => {
    const id = `file-${i}`;
    const ext = f.name.split('.').pop() || '';
    const isCode = ['py', 'ts', 'tsx', 'js', 'jsx', 'css', 'html'].includes(ext);
    nodes.push({
      id,
      kind: 'file',
      label: f.name,
      detail: f.path,
      radius: isCode ? 9 : 7,
      color: PALETTE.file.fill,
      glowColor: PALETTE.file.glow,
    });
    links.push({ id: `l-file-${i}`, source: agentId, target: id, color: PALETTE.file.stroke, width: 0.6 });
  });

  // Conversations (each message as a node, connected in sequence)
  const convMsgs = messages.slice(-30);
  let prevConvId = agentId;
  convMsgs.forEach((msg, i) => {
    const id = `msg-${i}`;
    const isUser = msg.role === 'user';
    nodes.push({
      id,
      kind: 'conversation',
      label: (isUser ? 'You: ' : 'AI: ') + msg.text.slice(0, 35) + (msg.text.length > 35 ? '…' : ''),
      detail: msg.text.slice(0, 300),
      radius: isUser ? 10 : 12,
      color: isUser ? '#38bdf8' : PALETTE.conversation.fill,
      glowColor: isUser ? 'rgba(56,189,248,0.25)' : PALETTE.conversation.glow,
    });
    links.push({
      id: `l-msg-${i}`,
      source: i === 0 ? agentId : prevConvId,
      target: id,
      color: PALETTE.conversation.stroke,
      width: 0.7,
    });
    prevConvId = id;
  });

  // Tasks
  tasks.slice(0, 10).forEach((t, i) => {
    const id = `task-${i}`;
    nodes.push({
      id,
      kind: 'task',
      label: t.title.slice(0, 40),
      detail: `${t.source === 'user' ? 'User' : 'Agent'} · ${t.status}`,
      radius: 9,
      color: PALETTE.task.fill,
      glowColor: PALETTE.task.glow,
    });
    links.push({ id: `l-task-${i}`, source: agentId, target: id, color: PALETTE.task.stroke, width: 0.8 });
  });

  return { nodes, links };
}

// ─── Component ────────────────────────────────────────────────────
export function ForceGraph({
  agentName,
  agentState,
  model,
  memories,
  files,
  messages,
  tasks,
  onNodeClick,
}: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const hoveredRef = useRef<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const animFrameRef = useRef<number>(0);
  const dataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });

  // Build graph data
  const graphData = useMemo(
    () => buildGraphData(agentName, agentState, model, memories, files, messages, tasks),
    [agentName, agentState, model, memories, files, messages, tasks],
  );

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Update canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
  }, [dimensions]);

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = dimensions;
    const t = transformRef.current;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(t.x + width / 2, t.y + height / 2);
    ctx.scale(t.k, t.k);

    const { nodes, links } = dataRef.current;
    const hov = hoveredRef.current;

    // Draw links
    for (const link of links) {
      const s = link.source as GraphNode;
      const tgt = link.target as GraphNode;
      if (s.x == null || s.y == null || tgt.x == null || tgt.y == null) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = link.color;
      ctx.lineWidth = link.width;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw nodes
    const now = performance.now();
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const r = node.radius;
      const isHovered = hov?.id === node.id;

      // Glow
      if (node.pulse || isHovered) {
        const pulseR = r + 6 + Math.sin(now / 400) * 3;
        const grad = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, pulseR);
        grad.addColorStop(0, node.glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? node.color : node.color + '90';
      ctx.fill();
      ctx.strokeStyle = isHovered ? node.color : node.color + '50';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Label (only for larger nodes or hovered)
      if (r >= 12 || isHovered) {
        ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(9, r * 0.45)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxChars = isHovered ? 30 : 15;
        const text = node.label.length > maxChars ? node.label.slice(0, maxChars) + '…' : node.label;
        ctx.fillText(text, node.x, node.y + r + 10);
      }

      // Kind icon letter
      const iconLetter = node.kind === 'agent' ? 'S' :
                         node.kind === 'model' ? 'M' :
                         node.kind === 'memory' ? '◆' :
                         node.kind === 'file' ? '◇' :
                         node.kind === 'conversation' ? '●' :
                         node.kind === 'task' ? '✓' : '?';
      ctx.font = `bold ${Math.max(8, r * 0.55)}px -apple-system, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconLetter, node.x, node.y);
    }

    ctx.restore();
  }, [dimensions]);

  // Animation loop
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      render();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [render]);

  // Simulation setup
  useEffect(() => {
    const { nodes, links } = graphData;
    dataRef.current = { nodes, links };

    // Stop old sim
    simRef.current?.stop();

    const sim = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(d => {
        const src = d.source as GraphNode;
        const tgt = d.target as GraphNode;
        return (src.radius + tgt.radius) * 2.5 + 40;
      }).strength(0.3))
      .force('charge', forceManyBody<GraphNode>().strength(d => d.kind === 'agent' ? -500 : -80))
      .force('center', forceCenter(0, 0).strength(0.05))
      .force('collide', forceCollide<GraphNode>(d => d.radius + 4).strength(0.8))
      .force('x', forceX(0).strength(0.02))
      .force('y', forceY(0).strength(0.02))
      .alphaDecay(0.01)
      .velocityDecay(0.3);

    simRef.current = sim;

    return () => { sim.stop(); };
  }, [graphData]);

  // Interaction: drag + zoom + hover + click
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = dimensions;

    const getNodeAt = (mx: number, my: number): GraphNode | null => {
      const t = transformRef.current;
      const gx = (mx - width / 2 - t.x) / t.k;
      const gy = (my - height / 2 - t.y) / t.k;
      const { nodes } = dataRef.current;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.x == null || n.y == null) continue;
        const dx = gx - n.x, dy = gy - n.y;
        if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) return n;
      }
      return null;
    };

    // Zoom
    const zoomBehavior = d3Zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        transformRef.current = { x: event.transform.x, y: event.transform.y, k: event.transform.k };
      });

    const sel = select(canvas);
    sel.call(zoomBehavior as any);

    // Drag
    const dragBehavior = d3Drag<HTMLCanvasElement, unknown>()
      .subject((event) => {
        const rect = canvas.getBoundingClientRect();
        const n = getNodeAt(event.x - rect.left, event.y - rect.top);
        return n || undefined;
      })
      .on('start', (event) => {
        const n = event.subject as GraphNode;
        if (!n) return;
        simRef.current?.alphaTarget(0.3).restart();
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (event) => {
        const n = event.subject as GraphNode;
        if (!n) return;
        const t = transformRef.current;
        n.fx = (event.x - dimensions.width / 2 - t.x) / t.k;
        n.fy = (event.y - dimensions.height / 2 - t.y) / t.k;
      })
      .on('end', (event) => {
        const n = event.subject as GraphNode;
        if (!n) return;
        simRef.current?.alphaTarget(0);
        if (n.kind !== 'agent') { // keep agent pinned
          n.fx = null;
          n.fy = null;
        }
      });

    sel.call(dragBehavior as any);

    // Hover
    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const n = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      hoveredRef.current = n;
      setHovered(n);
      canvas.style.cursor = n ? 'pointer' : 'grab';
    };

    // Click
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const n = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
      if (n) onNodeClick?.(n.kind, n.id);
    };

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [dimensions, onNodeClick]);

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ minHeight: '400px' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: 'transparent' }}
      />

      {/* Hover tooltip */}
      {hovered && hovered.x != null && hovered.y != null && (
        <div
          className="absolute pointer-events-none z-20 max-w-[280px]"
          style={{
            left: `${(hovered.x * transformRef.current.k) + transformRef.current.x + dimensions.width / 2 + hovered.radius + 12}px`,
            top: `${(hovered.y * transformRef.current.k) + transformRef.current.y + dimensions.height / 2 - 20}px`,
          }}
        >
          <div className="glass-card p-3 text-[11px]">
            <div className="flex items-center gap-1.5 mb-1">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: hovered.color }}
              />
              <span className="font-semibold text-white/80 uppercase tracking-wider text-[9px]">
                {hovered.kind}
              </span>
            </div>
            <div className="text-white/70 leading-relaxed break-words">
              {hovered.detail || hovered.label}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex gap-3 text-[10px] text-white/30">
        {Object.entries(PALETTE).map(([kind, { fill }]) => (
          <div key={kind} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: fill }} />
            <span className="capitalize">{kind}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="absolute top-3 right-3 text-[10px] text-white/25">
        {graphData.nodes.length} nodes · {graphData.links.length} links
      </div>
    </div>
  );
}
