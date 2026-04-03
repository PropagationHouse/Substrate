import type { GranularAgentState } from '@/types';

/** Get badge display text */
export function getStatusBadgeText(state: GranularAgentState): string {
  if (state.toolName) return `TOOL: ${state.toolName}`;
  return state.status;
}

/** Get Tailwind classes for the status badge (uses project semantic theme tokens) */
export function getStatusBadgeClasses(state: GranularAgentState): string {
  if (state.toolName) {
    return 'bg-info/20 text-info animate-pulse';
  }

  switch (state.status) {
    case 'THINKING':
      return 'bg-orange/20 text-orange animate-pulse';
    case 'STREAMING':
      return 'bg-green/20 text-green animate-pulse';
    case 'DONE':
      return 'bg-green/20 text-green';
    case 'ERROR':
      return 'bg-red/20 text-red';
    case 'IDLE':
    default:
      return 'bg-muted-foreground/20 text-muted-foreground';
  }
}
