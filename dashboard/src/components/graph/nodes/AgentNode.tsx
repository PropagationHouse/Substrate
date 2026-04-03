import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, Loader2 } from 'lucide-react';

export function AgentNode({ data }: NodeProps) {
  const { name, state, model } = data as { name: string; state: string; model: string };
  const isActive = state !== 'idle';

  const stateColors: Record<string, string> = {
    idle: 'bg-white/20',
    thinking: 'bg-indigo-400',
    streaming: 'bg-cyan-400',
    running: 'bg-emerald-400',
    error: 'bg-red-400',
  };

  const stateLabels: Record<string, string> = {
    idle: 'Idle',
    thinking: 'Thinking…',
    streaming: 'Streaming',
    running: 'Running',
    error: 'Error',
  };

  return (
    <div className={`
      relative px-6 py-5 rounded-2xl min-w-[200px] text-center
      bg-gradient-to-br from-indigo-500/15 via-purple-500/10 to-cyan-500/10
      border border-indigo-400/20
      backdrop-blur-xl shadow-[0_8px_40px_rgba(99,102,241,0.2)]
      transition-all duration-500
      ${isActive ? 'animate-glow-pulse' : ''}
    `}>
      <Handle type="target" position={Position.Left} className="!bg-indigo-400/50 !border-indigo-400/30 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-400/50 !border-indigo-400/30 !w-2 !h-2" />
      <Handle type="source" position={Position.Top} id="top" className="!bg-indigo-400/50 !border-indigo-400/30 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-indigo-400/50 !border-indigo-400/30 !w-2 !h-2" />

      <div className="flex flex-col items-center gap-2">
        <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center
          bg-gradient-to-br from-indigo-500/30 to-purple-500/30
          border border-indigo-400/20
          ${isActive ? 'animate-pulse' : ''}
        `}>
          {state === 'thinking' ? (
            <Loader2 size={22} className="text-indigo-300 animate-spin" />
          ) : (
            <Bot size={22} className="text-indigo-300" />
          )}
        </div>

        <div>
          <div className="text-sm font-semibold text-white/90">{name}</div>
          <div className="text-[10px] text-white/40 mt-0.5 truncate max-w-[160px]">{model}</div>
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          <div className={`w-2 h-2 rounded-full ${stateColors[state] || stateColors.idle} ${isActive ? 'animate-pulse' : ''}`} />
          <span className={`text-[11px] font-medium ${isActive ? 'text-indigo-300' : 'text-white/40'}`}>
            {stateLabels[state] || state}
          </span>
        </div>
      </div>

      {isActive && (
        <div className="absolute inset-0 rounded-2xl pointer-events-none">
          <div className="absolute inset-0 rounded-2xl border border-indigo-400/30 animate-ping opacity-20" />
        </div>
      )}
    </div>
  );
}
