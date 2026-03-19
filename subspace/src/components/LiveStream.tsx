import React, { useEffect, useState, useRef } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { motion } from 'motion/react';

const LOCATIONS = [
  { name: "SECTOR_7_FOREST", coords: "47.6062° N, 122.3321° W" },
  { name: "COASTAL_OUTPOST_ALPHA", coords: "34.0522° N, 118.2437° W" },
  { name: "ALPINE_MONITORING_STATION", coords: "46.8182° N, 8.2275° E" },
  { name: "DESERT_RELAY_NODE", coords: "36.1699° N, 115.1398° W" },
  { name: "TROPICAL_BIO_DOME", coords: "1.3521° N, 103.8198° E" },
  { name: "ARCTIC_VAULT_EXTERIOR", coords: "78.2232° N, 15.6267° E" },
];

const LOG_MESSAGES = [
  "SCANNING_LOCAL_DB...",
  "FETCHING_RSS_FEED: ARXIV_CS_AI...",
  "ANALYZING_SENTIMENT: POSITIVE...",
  "OPTIMIZING_VECTOR_INDEX...",
  "PRUNING_LOW_SIGNAL_NODES...",
  "HANDSHAKE_INITIATED: NODE_02...",
  "SYNTHESIZING_CONTEXT...",
  "UPDATING_WEIGHTS...",
  "GARBAGE_COLLECTION_RUNNING...",
  "VERIFYING_INTEGRITY...",
];

export const LiveStream = ({ processing }: { processing: boolean }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [location, setLocation] = useState(LOCATIONS[0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Randomize location on mount
    setLocation(LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)]);

    const interval = setInterval(() => {
      if (Math.random() > 0.6) {
        const msg = LOG_MESSAGES[Math.floor(Math.random() * LOG_MESSAGES.length)];
        const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
        setLogs(prev => [...prev.slice(-8), `[${timestamp}] ${msg}`]);
      }
    }, 800);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <BrutalContainer title="VISUAL_FEED // NATURE_RESERVE" processing={processing} className="h-[180px] relative overflow-hidden group">
      {/* Camera Feed Layer */}
      <div className="absolute inset-0 z-0 bg-subspace-black">
        <img 
          src={`https://picsum.photos/seed/${location.name}/600/400?grayscale`} 
          alt="Live Feed" 
          className="w-full h-full object-cover opacity-50 group-hover:opacity-70 transition-opacity duration-500 mix-blend-luminosity"
        />
        <div className="absolute inset-0 bg-subspace-green/5 mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-t from-subspace-black via-subspace-black/50 to-transparent" />
        
        {/* Scanline overlay for video feel */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10 bg-[length:100%_2px,3px_100%] pointer-events-none" />
      </div>

      {/* Camera UI Overlays */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
        <span className="text-[10px] font-mono text-red-500 font-bold tracking-widest drop-shadow-md">REC</span>
      </div>

      <div className="absolute top-3 right-3 z-20 text-right">
        <div className="text-[10px] font-mono text-subspace-white font-bold drop-shadow-md">{location.name}</div>
        <div className="text-[8px] font-mono text-subspace-gray drop-shadow-md">{location.coords}</div>
      </div>

      {/* Crosshairs */}
      <div className="absolute inset-0 z-10 pointer-events-none opacity-30">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border border-subspace-white/50 rounded-sm" />
        <div className="absolute top-1/2 left-4 w-2 h-[1px] bg-subspace-white/50" />
        <div className="absolute top-1/2 right-4 w-2 h-[1px] bg-subspace-white/50" />
        <div className="absolute top-4 left-1/2 w-[1px] h-2 bg-subspace-white/50" />
        <div className="absolute bottom-4 left-1/2 w-[1px] h-2 bg-subspace-white/50" />
      </div>

      {/* Terminal Log Overlay */}
      <div ref={scrollRef} className="absolute bottom-0 left-0 right-0 h-[100px] overflow-hidden p-3 space-y-1 z-20 mask-image-linear-gradient-to-t">
        {logs.map((log, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-[9px] font-mono text-subspace-green/90 drop-shadow-sm truncate"
          >
            <span className="text-subspace-gray mr-2 opacity-70">{'>'}</span>
            {log}
          </motion.div>
        ))}
      </div>
    </BrutalContainer>
  );
};
