import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Battery, Zap } from 'lucide-react';
import { MARKET_DATA } from '@/data/mockData';

export const Header = () => {
  const [fuel, setFuel] = useState(84);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 glass-panel border-b border-subspace-white/30 h-12 flex items-center justify-between px-6">
      {/* Identity */}
      <div className="flex items-center gap-4">
        <div className="w-6 h-6 bg-subspace-white flex items-center justify-center rounded-none">
          <div className="w-3 h-3 bg-subspace-black rotate-45" />
        </div>
        <div className="flex flex-col">
          <h1 className="font-mono font-bold text-sm tracking-widest text-subspace-white leading-none">
            SUBSTRATE<span className="text-subspace-green">_PULSE</span>
          </h1>
          <span className="font-mono text-[9px] text-subspace-gray uppercase tracking-widest">
            CORE_SYSTEM_INTERFACE
          </span>
        </div>
      </div>

      {/* Profile Section - Left Aligned */}
      <div className="flex items-center gap-3 pl-6 border-l border-subspace-white/10 h-6 ml-6">
         <div className="relative group cursor-pointer">
            <div className="w-6 h-6 rounded-none bg-subspace-white border border-subspace-gray flex items-center justify-center overflow-hidden relative z-10">
               <img src="https://picsum.photos/seed/pirate/200/200" alt="Tiny Pirate" className="w-full h-full object-cover grayscale" />
            </div>
         </div>
         <div className="font-mono text-[10px] text-subspace-white font-bold uppercase tracking-widest hidden md:block">OPERATOR</div>
      </div>

      {/* Signal Ticker */}
      <div className="hidden md:flex flex-1 mx-8 overflow-hidden relative h-full items-center border-x border-subspace-white/10 bg-subspace-black">
        <motion.div 
          className="whitespace-nowrap font-mono text-[10px] text-subspace-white/50 flex items-center"
          animate={{ x: ["100%", "-100%"] }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        >
          {Object.entries(MARKET_DATA).map(([symbol, data]: [string, any]) => (
            <span key={symbol} className="mr-8">
              {symbol}: <span className="text-subspace-white">${data.price}</span> (
              <span className={data.change >= 0 ? 'text-subspace-green' : 'text-subspace-amber'}>
                {data.change >= 0 ? '+' : ''}{data.change}%
              </span>)
            </span>
          ))}
          <span className="mr-8">+++ INTELLIGENCE_FEED: ACTIVE</span>
          <span className="mr-8">+++ SYSTEM_HEALTH: OPTIMAL</span>
        </motion.div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2 text-subspace-green">
            <div className="w-2 h-2 bg-subspace-green animate-pulse" />
            <span className="font-mono text-xs font-bold">ONLINE</span>
          </div>
          <span className="font-mono text-[9px] text-subspace-gray uppercase">
            CONNECTION_STATUS
          </span>
        </div>
      </div>
    </header>
  );
};
