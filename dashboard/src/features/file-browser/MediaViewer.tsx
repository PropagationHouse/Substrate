/**
 * MediaViewer — Renders audio and video files using native HTML5 elements.
 */

import { Loader2, AlertTriangle } from 'lucide-react';
import { isAudioFile } from './utils/fileTypes';
import type { OpenFile } from './types';

interface MediaViewerProps {
  file: OpenFile;
  agentId: string;
}

export function MediaViewer({ file, agentId }: MediaViewerProps) {
  if (file.loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs gap-2">
        <Loader2 className="animate-spin" size={14} />
        Loading {file.name}...
      </div>
    );
  }

  if (file.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertTriangle size={24} className="text-destructive" />
        <div className="text-sm">Failed to load media</div>
        <div className="text-xs">{file.error}</div>
      </div>
    );
  }

  const rawUrl = `/api/files/raw?path=${encodeURIComponent(file.path)}&agentId=${encodeURIComponent(agentId)}`;
  const isAudio = isAudioFile(file.name);

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-4 overflow-auto bg-[#0a0a0a]">
      <div className="text-sm font-medium text-foreground">{file.name}</div>
      {isAudio ? (
        <audio
          controls
          src={rawUrl}
          className="w-full max-w-md"
          preload="metadata"
        >
          Your browser does not support the audio element.
        </audio>
      ) : (
        <video
          controls
          src={rawUrl}
          className="max-w-full max-h-[70vh] rounded"
          preload="metadata"
        >
          Your browser does not support the video element.
        </video>
      )}
    </div>
  );
}
