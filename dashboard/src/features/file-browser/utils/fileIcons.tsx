import { File, Folder, FolderOpen } from 'lucide-react';

const EXT_COLORS: Record<string, string> = {
  '.md': 'text-blue-400',
  '.json': 'text-yellow-400',
  '.ts': 'text-blue-400',
  '.tsx': 'text-blue-300',
  '.js': 'text-yellow-300',
  '.jsx': 'text-yellow-200',
  '.yaml': 'text-purple-400',
  '.yml': 'text-purple-400',
  '.toml': 'text-orange-400',
  '.txt': 'text-muted-foreground',
  '.sh': 'text-green-400',
  '.css': 'text-pink-400',
  '.html': 'text-orange-400',
  '.py': 'text-yellow-400',
  '.png': 'text-emerald-400',
  '.jpg': 'text-emerald-400',
  '.jpeg': 'text-emerald-400',
  '.gif': 'text-emerald-400',
  '.svg': 'text-emerald-400',
  '.webp': 'text-emerald-400',
};

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  const color = EXT_COLORS[ext] || 'text-muted-foreground';
  return <File className={`${color} ${className || ''}`} size={14} />;
}

export function FolderIcon({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon className={`text-muted-foreground ${className || ''}`} size={14} />;
}
