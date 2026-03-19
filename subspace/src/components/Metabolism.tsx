import React from 'react';
import { BrutalContainer } from './BrutalContainer';
import { motion } from 'motion/react';

export const Metabolism = ({ processing }: { processing: boolean }) => {
  return (
    <BrutalContainer title="COGNITIVE_METABOLISM" processing={processing} className="h-[200px] flex flex-col p-4">
      <div className="flex justify-between items-end mb-4">
        <div>
          <div className="text-subspace-gray text-[10px] uppercase tracking-widest mb-1">Token Velocity</div>
          <div className={`font-mono text-3xl font-bold ${processing ? 'text-subspace-green' : 'text-subspace-amber'}`}>
            {processing ? '842' : '124'} <span className="text-sm text-subspace-gray font-normal">t/s</span>
          </div>
        </div>
        <div>
          <div className="text-subspace-gray text-[10px] uppercase tracking-widest mb-1">Entropy</div>
          <div className="font-mono text-xl text-subspace-white">
            -4.2%
          </div>
        </div>
      </div>

      {/* Heartbeat Visualization */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-subspace-dark-gray/30 border border-subspace-gray/20">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <motion.path
            d="M0,50 L20,50 L25,30 L30,70 L35,50 L45,50 L50,20 L55,80 L60,50 L100,50"
            fill="none"
            stroke={processing ? "#00FF41" : "#FFB000"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ 
              pathLength: 1, 
              opacity: [0.5, 1, 0.5],
              d: processing 
                ? "M0,50 L10,50 L15,10 L20,90 L25,50 L35,50 L40,0 L45,100 L50,50 L100,50" 
                : "M0,50 L20,50 L25,40 L30,60 L35,50 L45,50 L50,45 L55,55 L60,50 L100,50"
            }}
            transition={{ 
              duration: processing ? 0.5 : 1.5, 
              repeat: Infinity,
              ease: "linear"
            }}
          />
        </svg>
        
        {/* Grid lines */}
        <div className="absolute inset-0 grid grid-cols-6 pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="border-r border-subspace-gray/10 h-full" />
          ))}
        </div>
      </div>
    </BrutalContainer>
  );
};
