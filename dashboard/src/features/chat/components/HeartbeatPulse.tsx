interface HeartbeatPulseProps {
  lastEventTimestamp: number;
  stage?: 'thinking' | 'tool_use' | 'streaming' | null;
}

/**
 * A small pulsing dot that restarts its animation whenever lastEventTimestamp changes.
 * Provides visual proof-of-life during agent processing.
 */
export function HeartbeatPulse({ lastEventTimestamp, stage }: HeartbeatPulseProps) {
  const color = stage === 'tool_use' ? 'text-green' : 'text-primary';

  return (
    <span
      key={lastEventTimestamp}
      className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${color} heartbeat-pulse`}
      aria-hidden="true"
    />
  );
}
