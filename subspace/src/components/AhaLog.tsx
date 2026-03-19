import React from 'react';
import { BrutalContainer } from './BrutalContainer';

const AHA_MOMENTS = [
  { time: "10:42:01", sourceA: "Brutalism", sourceB: "User Intent", insight: "Minimalism as a function of clarity, not aesthetic." },
  { time: "09:15:33", sourceA: "Agentic Systems", sourceB: "Sovereignty", insight: "Local-first AI prevents drift via cryptographic tether." },
  { time: "08:02:12", sourceA: "Privacy", sourceB: "Encryption", insight: "Zero-knowledge proofs for social graph validation." },
];

export const AhaLog = ({ processing }: { processing: boolean }) => {
  return (
    <BrutalContainer title="AHA_LOG_SYNTHESIS" processing={processing} className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {AHA_MOMENTS.map((moment, i) => (
          <div key={i} className="border-l-2 border-subspace-gray pl-4 py-1 hover:border-subspace-green transition-colors group cursor-help">
            <div className="flex gap-2 font-mono text-[10px] text-subspace-gray mb-1">
              <span>[{moment.time}]</span>
              <span className="text-subspace-amber">SYNTHETIC_CONNECTION_FOUND</span>
            </div>
            <div className="font-mono text-xs text-subspace-white mb-2">
              {moment.sourceA} + {moment.sourceB}
            </div>
            <div className="font-sans text-sm text-subspace-white/80 italic group-hover:text-subspace-green transition-colors">
              "{moment.insight}"
            </div>
          </div>
        ))}
      </div>
    </BrutalContainer>
  );
};
