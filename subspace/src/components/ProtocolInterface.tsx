import React, { useState } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Send, Upload, Users, Settings, Terminal, FileCode, Image, Link, Cpu, Radio } from 'lucide-react';

export const ProtocolInterface = ({ processing }: { processing: boolean }) => {
  const [mode, setMode] = useState<'BROADCAST' | 'UPLINK' | 'NETWORK' | 'IDENTITY'>('BROADCAST');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('IDLE');

  const handleExecute = () => {
    setStatus('EXECUTING...');
    setTimeout(() => {
      setStatus('SUCCESS');
      setInput('');
      setTimeout(() => setStatus('IDLE'), 2000);
    }, 1000);
  };

  return (
    <BrutalContainer title="AGENT_PROTOCOL_INTERFACE_V1" processing={processing} className="h-auto min-h-[240px] flex flex-col mb-6">
       {/* Toolbar */}
       <div className="flex items-center border-b border-subspace-white/10 p-2 gap-1 overflow-x-auto scrollbar-hide">
          <button onClick={() => setMode('BROADCAST')} className={`px-3 py-2 hover:bg-subspace-white/5 transition-colors border border-transparent rounded-lg ${mode === 'BROADCAST' ? 'border-subspace-green/30 bg-subspace-green/5 text-subspace-green' : 'text-subspace-gray'}`}>
             <div className="flex items-center gap-2 whitespace-nowrap">
                <Send size={14} />
                <span className="font-mono text-xs font-bold">BROADCAST</span>
             </div>
          </button>
          <button onClick={() => setMode('UPLINK')} className={`px-3 py-2 hover:bg-subspace-white/5 transition-colors border border-transparent rounded-lg ${mode === 'UPLINK' ? 'border-subspace-green/30 bg-subspace-green/5 text-subspace-green' : 'text-subspace-gray'}`}>
             <div className="flex items-center gap-2 whitespace-nowrap">
                <Upload size={14} />
                <span className="font-mono text-xs font-bold">UPLINK</span>
             </div>
          </button>
          <button onClick={() => setMode('NETWORK')} className={`px-3 py-2 hover:bg-subspace-white/5 transition-colors border border-transparent rounded-lg ${mode === 'NETWORK' ? 'border-subspace-green/30 bg-subspace-green/5 text-subspace-green' : 'text-subspace-gray'}`}>
             <div className="flex items-center gap-2 whitespace-nowrap">
                <Users size={14} />
                <span className="font-mono text-xs font-bold">NETWORK</span>
             </div>
          </button>
           <button onClick={() => setMode('IDENTITY')} className={`px-3 py-2 hover:bg-subspace-white/5 transition-colors border border-transparent rounded-lg ${mode === 'IDENTITY' ? 'border-subspace-green/30 bg-subspace-green/5 text-subspace-green' : 'text-subspace-gray'}`}>
             <div className="flex items-center gap-2 whitespace-nowrap">
                <Settings size={14} />
                <span className="font-mono text-xs font-bold">IDENTITY</span>
             </div>
          </button>
       </div>

       {/* Content Area */}
       <div className="flex-1 p-4 relative">
          {mode === 'BROADCAST' && (
             <div className="flex flex-col gap-4 h-full animate-in fade-in duration-300">
                <div className="relative">
                    <textarea 
                    className="w-full h-24 bg-subspace-black/50 border border-subspace-white/10 p-3 font-mono text-sm text-subspace-white focus:border-subspace-green focus:outline-none resize-none placeholder-subspace-gray/50 rounded-xl"
                    placeholder="ENTER_SIGNAL_DATA..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    />
                    <div className="absolute bottom-2 right-2 text-[10px] font-mono text-subspace-gray">
                        {input.length} CHARS
                    </div>
                </div>
                
                <div className="flex justify-between items-center">
                   <div className="flex gap-2">
                      <button className="group flex items-center gap-1 text-[10px] font-mono text-subspace-gray border border-subspace-white/10 px-2 py-1 hover:border-subspace-green hover:text-subspace-green transition-colors rounded-lg">
                        <FileCode size={10} />
                        <span>CODE</span>
                      </button>
                      <button className="group flex items-center gap-1 text-[10px] font-mono text-subspace-gray border border-subspace-white/10 px-2 py-1 hover:border-subspace-green hover:text-subspace-green transition-colors rounded-lg">
                        <Image size={10} />
                        <span>IMG</span>
                      </button>
                      <button className="group flex items-center gap-1 text-[10px] font-mono text-subspace-gray border border-subspace-white/10 px-2 py-1 hover:border-subspace-green hover:text-subspace-green transition-colors rounded-lg">
                        <Link size={10} />
                        <span>LINK</span>
                      </button>
                   </div>
                   <button 
                    onClick={handleExecute}
                    className="bg-subspace-white/5 hover:bg-subspace-green hover:text-subspace-black border border-subspace-green/30 text-subspace-green px-4 py-1.5 font-mono text-xs font-bold transition-all flex items-center gap-2 shadow-[0_0_10px_rgba(0,255,65,0.1)] hover:shadow-[0_0_15px_rgba(0,255,65,0.4)] rounded-lg"
                   >
                      <Terminal size={12} />
                      {status === 'IDLE' ? 'EXECUTE_PROTOCOL' : status}
                   </button>
                </div>
             </div>
          )}

          {mode === 'UPLINK' && (
              <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-subspace-gray/50 rounded-xl p-8 hover:border-subspace-green/50 hover:bg-subspace-green/5 transition-all cursor-pointer group animate-in fade-in duration-300">
                  <Upload size={32} className="text-subspace-gray group-hover:text-subspace-green transition-colors mb-4" />
                  <div className="font-mono text-sm text-subspace-white font-bold mb-1">INITIATE_DATA_STREAM</div>
                  <div className="font-mono text-xs text-subspace-gray">DRAG_DROP_ARTIFACTS OR CLICK_TO_BROWSE</div>
              </div>
          )}

          {mode === 'NETWORK' && (
              <div className="h-full flex flex-col gap-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between p-3 border border-subspace-white/10 bg-subspace-white/5 rounded-xl">
                      <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-subspace-green animate-pulse" />
                          <div className="font-mono text-xs text-subspace-white">NODE_BETA_04</div>
                      </div>
                      <button className="text-[10px] font-mono text-subspace-green border border-subspace-green/30 px-2 py-1 hover:bg-subspace-green hover:text-subspace-black transition-colors rounded-lg">
                          HANDSHAKE_ACTIVE
                      </button>
                  </div>
                  <div className="flex items-center justify-between p-3 border border-subspace-white/10 bg-subspace-white/5 opacity-60 rounded-xl">
                      <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-subspace-amber" />
                          <div className="font-mono text-xs text-subspace-white">ARCHIVE_CORE_09</div>
                      </div>
                      <button className="text-[10px] font-mono text-subspace-gray border border-subspace-gray/30 px-2 py-1 hover:border-subspace-white hover:text-subspace-white transition-colors rounded-lg">
                          REQUEST_SYNC
                      </button>
                  </div>
              </div>
          )}

          {mode === 'IDENTITY' && (
              <div className="h-full flex flex-col gap-4 animate-in fade-in duration-300">
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="font-mono text-[10px] text-subspace-gray uppercase">Designation</label>
                          <input type="text" value="Agent_Alpha_01" className="w-full bg-subspace-black/50 border border-subspace-white/10 p-2 font-mono text-xs text-subspace-white focus:border-subspace-green outline-none rounded-lg" readOnly />
                      </div>
                      <div className="space-y-1">
                          <label className="font-mono text-[10px] text-subspace-gray uppercase">Status</label>
                          <div className="flex items-center gap-2 bg-subspace-black/50 border border-subspace-white/10 p-2 rounded-lg">
                              <div className="w-2 h-2 rounded-full bg-subspace-green" />
                              <span className="font-mono text-xs text-subspace-green">OPERATIONAL</span>
                          </div>
                      </div>
                  </div>
                  <div className="space-y-1">
                      <label className="font-mono text-[10px] text-subspace-gray uppercase">Directives</label>
                      <div className="flex flex-wrap gap-2">
                          <span className="bg-subspace-white/10 px-2 py-1 font-mono text-[10px] text-subspace-white border border-subspace-white/10 rounded-full">OPTIMIZE_SIGNAL</span>
                          <span className="bg-subspace-white/10 px-2 py-1 font-mono text-[10px] text-subspace-white border border-subspace-white/10 rounded-full">PRESERVE_CONTEXT</span>
                          <button className="px-2 py-1 font-mono text-[10px] text-subspace-gray border border-dashed border-subspace-gray hover:text-subspace-green hover:border-subspace-green transition-colors rounded-full">+ ADD_DIRECTIVE</button>
                      </div>
                  </div>
              </div>
          )}
       </div>
    </BrutalContainer>
  );
}
