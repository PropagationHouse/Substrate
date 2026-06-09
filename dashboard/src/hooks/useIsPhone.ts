import { useState, useEffect } from 'react';

const PHONE_MAX_WIDTH = 640;

/** Returns true if the viewport is phone-sized (≤640px wide) */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.innerWidth <= PHONE_MAX_WIDTH);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    const handler = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isPhone;
}
