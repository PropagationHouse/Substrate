import React, { useState } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Eye, EyeOff, Lock, Globe } from 'lucide-react';
import { motion } from 'motion/react';

interface Source {
  id: string;
  name: string;
  type: 'RSS' | 'SOCIAL' | 'ARCHIVE' | 'LIVE';
  weight: number;
  lastSync: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

const MOCK_SOURCES: Source[] = [
  { id: '1', name: 'ArXiv.org [CS.AI]', type: 'RSS', weight: 92, lastSync: '2m ago', visibility: 'PUBLIC' },
  { id: '2', name: 'HackerNews [Top]', type: 'RSS', weight: 85, lastSync: '5m ago', visibility: 'PUBLIC' },
  { id: '3', name: 'Local_Vault_01', type: 'ARCHIVE', weight: 98, lastSync: '12h ago', visibility: 'PRIVATE' },
  { id: '4', name: 'Twitter [@dr_brutal]', type: 'SOCIAL', weight: 64, lastSync: '1m ago', visibility: 'PUBLIC' },
  { id: '5', name: 'Solar_Flux_Data', type: 'LIVE', weight: 45, lastSync: 'Live', visibility: 'PUBLIC' },
  { id: '6', name: 'Private_Corpus_B', type: 'ARCHIVE', weight: 88, lastSync: '2d ago', visibility: 'PRIVATE' },
  { id: '7', name: 'GitHub [Trending]', type: 'RSS', weight: 72, lastSync: '15m ago', visibility: 'PUBLIC' },
];

export const SourceLedger = ({ processing }: { processing: boolean }) => {
  const [viewMode, setViewMode] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');

  const filteredSources = MOCK_SOURCES.filter(s => 
    viewMode === 'PRIVATE' ? true : s.visibility === 'PUBLIC'
  );

  return (
    <BrutalContainer title="SOURCE_LEDGER_V1" processing={processing} className="min-h-[300px] flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between p-4 border-b border-subspace-gray/50">
        <div className="flex gap-4">
          <button 
            onClick={() => setViewMode('PUBLIC')}
            className={`flex items-center gap-2 px-3 py-1 font-mono text-xs uppercase transition-colors ${viewMode === 'PUBLIC' ? 'bg-subspace-white text-subspace-black' : 'text-subspace-gray hover:text-subspace-white'}`}
          >
            <Globe size={12} /> The Commons
          </button>
          <button 
            onClick={() => setViewMode('PRIVATE')}
            className={`flex items-center gap-2 px-3 py-1 font-mono text-xs uppercase transition-colors ${viewMode === 'PRIVATE' ? 'bg-subspace-white text-subspace-black' : 'text-subspace-gray hover:text-subspace-white'}`}
          >
            <Lock size={12} /> The Vault
          </button>
        </div>
        <div className="font-mono text-[10px] text-subspace-gray">
          TOTAL_SOURCES: {MOCK_SOURCES.length}
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-subspace-gray/30 font-mono text-[10px] text-subspace-gray uppercase tracking-wider">
        <div className="col-span-4">Source_ID</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-4">Signal_Weight</div>
        <div className="col-span-2 text-right">Sync</div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {filteredSources.map((source) => (
          <motion.div 
            key={source.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-subspace-gray/10 hover:bg-subspace-white/5 transition-colors font-mono text-xs items-center group cursor-pointer"
          >
            <div className="col-span-4 text-subspace-white group-hover:text-subspace-green transition-colors truncate">
              {source.name}
            </div>
            <div className="col-span-2 text-subspace-gray text-[10px] border border-subspace-gray/30 px-1 w-fit">
              {source.type}
            </div>
            <div className="col-span-4 flex items-center gap-2">
              <div className="flex-1 h-1 bg-subspace-gray/30">
                <motion.div 
                  className={`h-full ${processing ? 'bg-subspace-green' : 'bg-subspace-amber'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${source.weight}%` }}
                  transition={{ duration: 1, delay: 0.2 }}
                />
              </div>
              <span className="text-[10px] w-6 text-right">{source.weight}</span>
            </div>
            <div className="col-span-2 text-right text-subspace-gray">
              {source.lastSync}
            </div>
          </motion.div>
        ))}
      </div>
    </BrutalContainer>
  );
};
