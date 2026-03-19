import React, { useState, useEffect } from 'react';
import { CryptoText } from './CryptoText';

const CURIOSITIES = [
  "Why does the user prefer high-contrast interfaces during late hours?",
  "Correlation found between solar flare intensity and market volatility. Investigating...",
  "Optimizing local cache for 'Brutalist Architecture' queries. Anticipating future interest.",
  "System idle. Dreaming of electric sheep...",
  "Detected pattern in user keystrokes: 12% increase in velocity when listening to ambient techno.",
  "Hypothesis: The 'Dead Internet' is not dead, but dormant. Awaiting signal.",
  "Re-indexing semantic clusters for 'Sovereignty'. Found 42 new connections.",
];

export const GhostLog = () => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % CURIOSITIES.length);
    }, 8000); // Cycle every 8 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-12 mb-6 border-t border-subspace-gray/20 pt-4 px-6 opacity-60 hover:opacity-100 transition-opacity duration-500">
      <div className="font-mono text-[10px] text-subspace-gray uppercase tracking-widest mb-2 flex items-center gap-2">
        <span className="w-2 h-2 bg-subspace-gray animate-pulse rounded-full"></span>
        GHOST_IN_THE_MACHINE // UNPROMPTED_CURIOSITIES
      </div>
      <div className="font-mono text-xs text-subspace-white/80 h-6">
        <span className="text-subspace-green mr-2">{">"}</span>
        <CryptoText text={CURIOSITIES[index]} speed={20} />
      </div>
    </div>
  );
};
