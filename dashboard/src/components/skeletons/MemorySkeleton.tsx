/**
 * MemorySkeleton — Skeleton loader for memory list items.
 *
 * Matches the shape of actual memory items with icon and text.
 */

export function MemorySkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-2 px-3 py-1.5 border-b border-border/40">
      {/* Icon placeholder */}
      <div className="w-3 h-3 bg-primary/20 rounded-sm shrink-0" />

      {/* Text content */}
      <div className="flex-1 flex gap-2">
        <div className="h-3 flex-1 bg-muted/30 rounded" />
        <div className="h-3 w-1/4 bg-muted/20 rounded" />
      </div>
    </div>
  );
}

/**
 * MemorySkeletonGroup — Multiple skeletons for loading state
 */
export function MemorySkeletonGroup({ count = 6 }: { count?: number }) {
  // Mix up the skeleton widths for a more natural look
  const patterns = [
    { icon: true, width: 'w-3/4' },
    { icon: false, width: 'w-full' },
    { icon: true, width: 'w-2/3' },
    { icon: false, width: 'w-4/5' },
    { icon: true, width: 'w-1/2' },
    { icon: false, width: 'w-3/4' },
  ];

  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const pattern = patterns[i % patterns.length];
        return (
          <div
            key={i}
            className="animate-pulse flex items-center gap-2 px-3 py-1.5 border-b border-border/40"
          >
            {/* Section icon for some items */}
            {pattern.icon ? (
              <div className="w-2.5 h-2.5 bg-primary/25 rounded-sm shrink-0" />
            ) : (
              <div className="w-2.5 h-2.5 bg-muted/20 rounded-full shrink-0" />
            )}

            {/* Text content with varying widths */}
            <div className={`h-3 ${pattern.width} bg-muted/25 rounded`} />
          </div>
        );
      })}
    </>
  );
}
