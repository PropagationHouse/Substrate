/**
 * MessageSkeleton — Skeleton loader for chat messages.
 *
 * Displays a pulsing placeholder that matches the shape of actual messages.
 */

interface MessageSkeletonProps {
  variant?: 'user' | 'assistant';
}

export function MessageSkeleton({ variant = 'assistant' }: MessageSkeletonProps) {
  const isUser = variant === 'user';

  return (
    <div
      className={`animate-pulse px-4 py-3 ${
        isUser ? 'bg-message-user' : 'bg-message-assistant'
      }`}
    >
      {/* Header row: role badge + timestamp */}
      <div className={`flex items-center gap-2 mb-2 ${isUser ? 'flex-row-reverse' : ''}`}>
        <div
          className={`h-4 w-14 rounded-sm ${
            isUser ? 'bg-primary/20' : 'bg-green/20'
          }`}
        />
        <div className="h-3 w-10 bg-muted/20 rounded ml-auto" />
      </div>

      {/* Message body lines */}
      <div className={`space-y-2 ${isUser ? 'pr-10 mr-4' : 'pl-10 ml-4'}`}>
        <div className="h-3 w-4/5 bg-muted/30 rounded" />
        <div className="h-3 w-3/5 bg-muted/20 rounded" />
        {!isUser && <div className="h-3 w-2/5 bg-muted/15 rounded" />}
      </div>
    </div>
  );
}

/**
 * MessageSkeletonGroup — Multiple skeletons for loading state
 */
export function MessageSkeletonGroup({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} variant={i % 2 === 0 ? 'user' : 'assistant'} />
      ))}
    </>
  );
}
