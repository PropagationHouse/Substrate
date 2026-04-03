import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CheckSquare, Circle, CheckCircle2, User, Bot } from 'lucide-react';

export function TaskNode({ data }: NodeProps) {
  const { tasks, totalCount } = data as {
    tasks: Array<{ id: string; title: string; status: string; source: 'user' | 'agent' }>;
    totalCount: number;
  };

  const statusIcon = (status: string) => {
    if (status === 'done' || status === 'completed') return <CheckCircle2 size={10} className="text-amber-400/70" />;
    return <Circle size={10} className="text-amber-300/40" />;
  };

  return (
    <div className="
      relative px-4 py-3 rounded-2xl min-w-[220px] max-w-[280px]
      bg-gradient-to-br from-amber-500/10 via-yellow-500/8 to-orange-500/6
      border border-amber-400/15
      backdrop-blur-xl shadow-[0_6px_24px_rgba(251,191,36,0.12)]
    ">
      <Handle type="target" position={Position.Top} className="!bg-amber-400/50 !border-amber-400/30 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-500/20 border border-amber-400/15">
          <CheckSquare size={14} className="text-amber-300" />
        </div>
        <div>
          <div className="text-xs font-semibold text-white/80">Tasks</div>
          <div className="text-[10px] text-white/35">{totalCount} items</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {tasks.slice(0, 4).map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-1.5 text-[10px] text-white/50 px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]"
          >
            {statusIcon(task.status)}
            <span className="truncate flex-1">{task.title}</span>
            {task.source === 'user' ? (
              <User size={9} className="text-cyan-400/40 shrink-0" />
            ) : (
              <Bot size={9} className="text-indigo-400/40 shrink-0" />
            )}
          </div>
        ))}
        {totalCount > 4 && (
          <div className="text-[10px] text-amber-300/50 text-center pt-0.5">
            +{totalCount - 4} more
          </div>
        )}
      </div>
    </div>
  );
}
