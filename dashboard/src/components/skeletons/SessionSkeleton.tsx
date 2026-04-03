/**
 * SessionSkeleton — Skeleton loader for session list items.
 *
 * Matches the shape of actual session items with label, progress bar, token count, and status.
 */

export function SessionSkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-2 px-3 py-2 border-b border-border/40">
      {/* Session label */}
      <div className="h-3 w-20 bg-muted/40 rounded flex-1" />

      {/* Context bar */}
      <div className="w-12 h-1.5 bg-background border border-border/40 overflow-hidden shrink-0">
        <div className="h-full w-1/3 bg-muted/30" />
      </div>

      {/* Token count */}
      <div className="h-3 w-10 bg-muted/20 rounded shrink-0" />

      {/* Status badge */}
      <div className="h-4 w-14 bg-muted/25 rounded-sm shrink-0" />
    </div>
  );
}

/**
 * SessionSkeletonGroup — Multiple skeletons for loading state
 */
export function SessionSkeletonGroup({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SessionSkeleton key={i} />
      ))}
    </>
  );
}
