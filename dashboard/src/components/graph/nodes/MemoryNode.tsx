import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Brain } from 'lucide-react';

export function MemoryNode({ data }: NodeProps) {
  const { memories, totalCount } = data as {
    memories: Array<{ type: string; text: string; date?: string }>;
    totalCount: number;
  };

  return (
    <div className="
      relative px-4 py-3 rounded-2xl min-w-[220px] max-w-[280px]
      bg-gradient-to-br from-pink-500/10 via-rose-500/8 to-fuchsia-500/6
      border border-pink-400/15
      backdrop-blur-xl shadow-[0_6px_24px_rgba(244,114,182,0.12)]
    ">
      <Handle type="target" position={Position.Right} className="!bg-pink-400/50 !border-pink-400/30 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-pink-500/20 border border-pink-400/15">
          <Brain size={14} className="text-pink-300" />
        </div>
        <div>
          <div className="text-xs font-semibold text-white/80">Memories</div>
          <div className="text-[10px] text-white/35">{totalCount} stored</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {memories.slice(0, 3).map((mem, i) => (
          <div
            key={i}
            className="text-[10px] text-white/50 leading-relaxed px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] truncate"
          >
            {mem.text.slice(0, 60)}…
          </div>
        ))}
        {totalCount > 3 && (
          <div className="text-[10px] text-pink-300/50 text-center pt-0.5">
            +{totalCount - 3} more
          </div>
        )}
      </div>
    </div>
  );
}
