import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Props for {@link AnimatedNumber}. */
interface AnimatedNumberProps {
  /** Target numeric value to animate towards. */
  value: number;
  /** Animation duration in milliseconds. @default 500 */
  duration?: number;
  /** Formatting function applied to the displayed value (e.g. `fmtK`). @default String */
  format?: (n: number) => string;
  /** Additional CSS class names for the wrapper `<span>`. */
  className?: string;
}

/**
 * Smoothly animates a number from its previous value to the new value.
 * Uses requestAnimationFrame with ease-out cubic easing.
 */
export function AnimatedNumber({ 
  value, 
  duration = 500, 
  format = String,
  className = ''
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);
  const frameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const startValue = prevValue.current;
    const endValue = value;
    const diff = endValue - startValue;
    
    // No animation needed if no change - but only skip if displayValue already matches
    // This avoids unnecessary setState while still syncing on initial mount
    if (diff === 0) {
      // Skip setState if already in sync to avoid cascading renders
      return;
    }
    
    // Cancel any in-progress animation
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
    }
    
    startTimeRef.current = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + diff * eased;
      
      setDisplayValue(Math.round(current));
      
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure we end at exact value
        setDisplayValue(endValue);
      }
    };
    
    frameRef.current = requestAnimationFrame(animate);
    prevValue.current = value;
    
    return () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [value, duration]);

  return (
    <span className={cn('tabular-nums', className)}>
      {format(displayValue)}
    </span>
  );
}
