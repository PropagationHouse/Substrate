import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode } from './nodes/AgentNode';
import { MemoryNode } from './nodes/MemoryNode';
import { FileNode } from './nodes/FileNode';
import { ConversationNode } from './nodes/ConversationNode';
import { TaskNode } from './nodes/TaskNode';
import { ModelNode } from './nodes/ModelNode';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  memory: MemoryNode,
  file: FileNode,
  conversation: ConversationNode,
  task: TaskNode,
  model: ModelNode,
};

export interface GraphMessage {
  role: string;
  text: string;
  timestamp?: number;
}

interface WorkspaceGraphProps {
  agentName: string;
  agentState: string;
  model: string;
  memories: Array<{ type: string; text: string; date?: string }>;
  files: Array<{ name: string; path: string; type: string }>;
  messages: GraphMessage[];
  tasks: Array<{ id: string; title: string; status: string; source: 'user' | 'agent' }>;
  onNodeClick?: (type: string, id: string) => void;
}

const edgeDefaults = {
  animated: true,
  style: { stroke: 'rgba(129, 140, 248, 0.3)', strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(129, 140, 248, 0.4)', width: 16, height: 16 },
};

export function WorkspaceGraph(props: WorkspaceGraphProps) {
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '400px' }}>
      <ReactFlowProvider>
        <WorkspaceGraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function WorkspaceGraphInner({
  agentName,
  agentState,
  model,
  memories,
  files,
  messages,
  tasks,
  onNodeClick,
}: WorkspaceGraphProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Center: Agent node
    nodes.push({
      id: 'agent-main',
      type: 'agent',
      position: { x: 400, y: 300 },
      data: { name: agentName, state: agentState, model },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    // Model node (top)
    nodes.push({
      id: 'model-main',
      type: 'model',
      position: { x: 400, y: 80 },
      data: { model, state: agentState },
    });
    edges.push({
      id: 'e-agent-model',
      source: 'agent-main',
      target: 'model-main',
      ...edgeDefaults,
    });

    // Conversation cluster (right)
    const recentMsgs = messages.slice(-6);
    if (recentMsgs.length > 0) {
      nodes.push({
        id: 'conv-cluster',
        type: 'conversation',
        position: { x: 750, y: 240 },
        data: {
          messages: recentMsgs,
          totalCount: messages.length,
        },
      });
      edges.push({
        id: 'e-agent-conv',
        source: 'agent-main',
        target: 'conv-cluster',
        ...edgeDefaults,
        style: { ...edgeDefaults.style, stroke: 'rgba(34, 211, 238, 0.3)' },
        markerEnd: { ...edgeDefaults.markerEnd, color: 'rgba(34, 211, 238, 0.4)' },
      });
    }

    // Memory cluster (left)
    const recentMems = memories.slice(0, 5);
    if (recentMems.length > 0) {
      nodes.push({
        id: 'memory-cluster',
        type: 'memory',
        position: { x: 30, y: 200 },
        data: {
          memories: recentMems,
          totalCount: memories.length,
        },
      });
      edges.push({
        id: 'e-agent-mem',
        source: 'agent-main',
        target: 'memory-cluster',
        ...edgeDefaults,
        style: { ...edgeDefaults.style, stroke: 'rgba(244, 114, 182, 0.3)' },
        markerEnd: { ...edgeDefaults.markerEnd, color: 'rgba(244, 114, 182, 0.4)' },
      });
    }

    // File cluster (bottom-left)
    const topFiles = files.slice(0, 8);
    if (topFiles.length > 0) {
      nodes.push({
        id: 'file-cluster',
        type: 'file',
        position: { x: 80, y: 480 },
        data: {
          files: topFiles,
          totalCount: files.length,
        },
      });
      edges.push({
        id: 'e-agent-files',
        source: 'agent-main',
        target: 'file-cluster',
        ...edgeDefaults,
        style: { ...edgeDefaults.style, stroke: 'rgba(52, 211, 153, 0.3)' },
        markerEnd: { ...edgeDefaults.markerEnd, color: 'rgba(52, 211, 153, 0.4)' },
      });
    }

    // Tasks cluster (bottom-right)
    if (tasks.length > 0) {
      nodes.push({
        id: 'task-cluster',
        type: 'task',
        position: { x: 680, y: 500 },
        data: {
          tasks: tasks.slice(0, 6),
          totalCount: tasks.length,
        },
      });
      edges.push({
        id: 'e-agent-tasks',
        source: 'agent-main',
        target: 'task-cluster',
        ...edgeDefaults,
        style: { ...edgeDefaults.style, stroke: 'rgba(251, 191, 36, 0.3)' },
        markerEnd: { ...edgeDefaults.markerEnd, color: 'rgba(251, 191, 36, 0.4)' },
      });
    }

    return { initialNodes: nodes, initialEdges: edges };
  }, [agentName, agentState, model, memories, files, messages, tasks]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const [type] = node.id.split('-');
      onNodeClick?.(type, node.id);
    },
    [onNodeClick],
  );

  // Debug: log data counts
  useEffect(() => {
    console.debug('[WorkspaceGraph] Data:', {
      memories: memories.length,
      files: files.length,
      messages: messages.length,
      tasks: tasks.length,
      nodes: nodes.length,
      edges: edges.length,
    });
  }, [memories.length, files.length, messages.length, tasks.length, nodes.length, edges.length]);

  return (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={edgeDefaults}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255,255,255,0.04)"
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
        />
        <MiniMap
          nodeStrokeWidth={2}
          nodeColor={(n) => {
            if (n.type === 'agent') return '#818cf8';
            if (n.type === 'memory') return '#f472b6';
            if (n.type === 'file') return '#34d399';
            if (n.type === 'conversation') return '#22d3ee';
            if (n.type === 'task') return '#fbbf24';
            if (n.type === 'model') return '#a78bfa';
            return '#666';
          }}
          maskColor="rgba(0,0,0,0.7)"
          position="bottom-right"
        />
      </ReactFlow>
  );
}
