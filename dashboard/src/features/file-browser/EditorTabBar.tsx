import { EditorTab } from './EditorTab';
import type { OpenFile } from './types';

interface EditorTabBarProps {
  activeTab: string;
  openFiles: OpenFile[];
  onSelectTab: (id: string) => void;
  onCloseTab: (path: string) => void;
}

export function EditorTabBar({
  activeTab,
  openFiles,
  onSelectTab,
  onCloseTab,
}: EditorTabBarProps) {
  // Don't render tab bar if no files are open (chat-only mode)
  if (openFiles.length === 0) return null;

  return (
    <div
      className="flex items-center h-9 border-b border-border bg-background overflow-x-auto scrollbar-hide"
      role="tablist"
      aria-label="Open files"
    >
      {/* Pinned chat tab */}
      <EditorTab
        id="chat"
        label="Chat"
        active={activeTab === 'chat'}
        pinned
        onSelect={() => onSelectTab('chat')}
      />

      {/* File tabs */}
      {openFiles.map((file) => (
        <EditorTab
          key={file.path}
          id={file.path}
          label={file.name}
          active={activeTab === file.path}
          dirty={file.dirty}
          locked={file.locked}
          tooltip={file.path}
          onSelect={() => onSelectTab(file.path)}
          onClose={() => onCloseTab(file.path)}
          onMiddleClick={() => onCloseTab(file.path)}
        />
      ))}
    </div>
  );
}
