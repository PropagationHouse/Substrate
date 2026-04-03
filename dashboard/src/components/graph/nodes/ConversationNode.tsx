import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageSquare, User, Bot } from 'lucide-react';

export function ConversationNode({ data }: NodeProps) {
  const { messages, totalCount } = data as {
    messages: Array<{ role: string; text: string; timestamp?: number }>;
    totalCount: number;
  };

  return (
    <div className="
      relative px-4 py-3 rounded-2xl min-w-[240px] max-w-[300px]
      bg-gradient-to-br from-cyan-500/10 via-sky-500/8 to-blue-500/6
      border border-cyan-400/15
      backdrop-blur-xl shadow-[0_6px_24px_rgba(34,211,238,0.12)]
    ">
      <Handle type="target" position={Position.Left} className="!bg-cyan-400/50 !border-cyan-400/30 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-cyan-500/20 border border-cyan-400/15">
          <MessageSquare size={14} className="text-cyan-300" />
        </div>
        <div>
          <div className="text-xs font-semibold text-white/80">Conversation</div>
          <div className="text-[10px] text-white/35">{totalCount} messages</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {messages.slice(-4).map((msg, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 text-[10px] text-white/50 leading-relaxed px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]"
          >
            {msg.role === 'user' ? (
              <User size={10} className="text-cyan-400/60 mt-0.5 shrink-0" />
            ) : (
              <Bot size={10} className="text-indigo-400/60 mt-0.5 shrink-0" />
            )}
            <span className="truncate">
              {msg.text.slice(0, 80)}
              {msg.text.length > 80 ? '…' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
