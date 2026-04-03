import type { ProcessingStage } from '@/contexts/ChatContext';

interface ThinkingDotsProps {
  stage?: ProcessingStage;
}

/**
 * Animated dots for processing indicator
 */
export function ThinkingDots({ stage }: ThinkingDotsProps) {
  const color = stage === 'tool_use' ? 'text-green' : 'text-primary';
  return (
    <span className={`inline-flex ${color} text-lg`}>
      <span className="animate-[dot-fade_1.4s_infinite_0s] opacity-0">.</span>
      <span className="animate-[dot-fade_1.4s_infinite_0.2s] opacity-0">.</span>
      <span className="animate-[dot-fade_1.4s_infinite_0.4s] opacity-0">.</span>
    </span>
  );
}
