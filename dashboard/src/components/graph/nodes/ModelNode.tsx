import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cpu } from 'lucide-react';

export function ModelNode({ data }: NodeProps) {
  const { model, state } = data as { model: string; state: string };
  const isActive = state !== 'idle';

  return (
    <div className="
      relative px-4 py-3 rounded-2xl min-w-[180px]
      bg-gradient-to-br from-violet-500/10 via-purple-500/8 to-indigo-500/6
      border border-violet-400/15
      backdrop-blur-xl shadow-[0_6px_24px_rgba(167,139,250,0.12)]
    ">
      <Handle type="target" position={Position.Bottom} className="!bg-violet-400/50 !border-violet-400/30 !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <div className={`
          w-7 h-7 rounded-lg flex items-center justify-center
          bg-violet-500/20 border border-violet-400/15
          ${isActive ? 'animate-pulse' : ''}
        `}>
          <Cpu size={14} className="text-violet-300" />
        </div>
        <div>
          <div className="text-[10px] text-white/35 uppercase tracking-wider">Model</div>
          <div className="text-xs font-semibold text-white/80 truncate max-w-[140px]">{model}</div>
        </div>
      </div>
    </div>
  );
}
