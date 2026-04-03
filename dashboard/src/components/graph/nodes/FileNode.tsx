import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FolderTree, FileCode, FileText } from 'lucide-react';

export function FileNode({ data }: NodeProps) {
  const { files, totalCount } = data as {
    files: Array<{ name: string; path: string; type: string }>;
    totalCount: number;
  };

  const getIcon = (name: string) => {
    if (name.endsWith('.py') || name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js'))
      return <FileCode size={10} className="text-emerald-400/70" />;
    return <FileText size={10} className="text-emerald-300/50" />;
  };

  return (
    <div className="
      relative px-4 py-3 rounded-2xl min-w-[200px] max-w-[260px]
      bg-gradient-to-br from-emerald-500/10 via-green-500/8 to-teal-500/6
      border border-emerald-400/15
      backdrop-blur-xl shadow-[0_6px_24px_rgba(52,211,153,0.12)]
    ">
      <Handle type="target" position={Position.Top} className="!bg-emerald-400/50 !border-emerald-400/30 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/20 border border-emerald-400/15">
          <FolderTree size={14} className="text-emerald-300" />
        </div>
        <div>
          <div className="text-xs font-semibold text-white/80">Workspace</div>
          <div className="text-[10px] text-white/35">{totalCount} files</div>
        </div>
      </div>

      <div className="space-y-1">
        {files.slice(0, 5).map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 text-[10px] text-white/45 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.04] truncate"
          >
            {getIcon(f.name)}
            <span className="truncate">{f.name}</span>
          </div>
        ))}
        {totalCount > 5 && (
          <div className="text-[10px] text-emerald-300/50 text-center pt-0.5">
            +{totalCount - 5} more
          </div>
        )}
      </div>
    </div>
  );
}
