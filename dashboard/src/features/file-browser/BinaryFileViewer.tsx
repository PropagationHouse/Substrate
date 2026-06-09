/**
 * BinaryFileViewer — Displays info for binary files that cannot be edited as text.
 *
 * Shows file name, type, and a message indicating the file cannot be opened
 * in the text editor (e.g. .db, .zip, .exe files).
 */

import { FileWarning } from 'lucide-react';
import type { OpenFile } from './types';

interface BinaryFileViewerProps {
  file: OpenFile;
}

function getExt(name: string): string {
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
}

const FILE_TYPE_LABELS: Record<string, string> = {
  '.db': 'SQLite Database',
  '.sqlite': 'SQLite Database',
  '.sqlite3': 'SQLite Database',
  '.zip': 'ZIP Archive',
  '.tar': 'TAR Archive',
  '.gz': 'Gzip Archive',
  '.bz2': 'Bzip2 Archive',
  '.7z': '7-Zip Archive',
  '.rar': 'RAR Archive',
  '.exe': 'Windows Executable',
  '.dll': 'Dynamic Library',
  '.so': 'Shared Object',
  '.dylib': 'Dynamic Library',
  '.bin': 'Binary Data',
  '.dat': 'Data File',
  '.o': 'Object File',
  '.obj': 'Object File',
  '.class': 'Java Class',
  '.pyc': 'Python Bytecode',
  '.pyd': 'Python Extension',
  '.wasm': 'WebAssembly',
  '.pdf': 'PDF Document',
  '.doc': 'Word Document',
  '.docx': 'Word Document',
  '.xls': 'Excel Spreadsheet',
  '.xlsx': 'Excel Spreadsheet',
  '.ppt': 'PowerPoint',
  '.pptx': 'PowerPoint',
  '.ttf': 'TrueType Font',
  '.otf': 'OpenType Font',
  '.woff': 'Web Font',
  '.woff2': 'Web Font',
  '.eot': 'Embedded OpenType Font',
};

export function BinaryFileViewer({ file }: BinaryFileViewerProps) {
  const ext = getExt(file.name);
  const typeLabel = FILE_TYPE_LABELS[ext] || 'Binary File';

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-4 text-muted-foreground">
      <FileWarning size={40} className="text-muted-foreground/60" />
      <div className="text-sm font-medium text-foreground">{file.name}</div>
      <div className="text-xs">{typeLabel}</div>
      <div className="text-xs text-center max-w-xs leading-relaxed">
        This file type cannot be displayed in the editor. You can rename, move, or delete it from the file tree.
      </div>
    </div>
  );
}
