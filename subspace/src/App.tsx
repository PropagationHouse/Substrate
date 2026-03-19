import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { LatentMap } from './components/LatentMap';
import { ProfileIdentity } from './components/ProfileIdentity';
import { LiveStream } from './components/LiveStream';
import { SourceLedger } from './components/SourceLedger';
import { AhaLog } from './components/AhaLog';
import { GhostLog } from './components/GhostLog';
import { SurfaceFeed } from './components/SurfaceFeed';
import { AudioPlayer } from './components/AudioPlayer';
import { ProtocolInterface } from './components/ProtocolInterface';
import { NewsPage } from './components/NewsPage';

function App() {
  const [processing, setProcessing] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [view, setView] = useState<'DASHBOARD' | 'NEWS'>('DASHBOARD');

  // Simulate random processing bursts
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        setProcessing(true);
        setTimeout(() => setProcessing(false), 2000 + Math.random() * 3000);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-subspace-black text-subspace-white font-sans selection:bg-subspace-green selection:text-subspace-black pb-20 omen-flicker">
      <div className="scanlines" />
      <div className="crt-overlay" />
      
      <Header />

      {/* Navigation Tabs */}
      <div className="pt-16 px-4 md:px-8 w-full max-w-[2400px] mx-auto flex gap-4 mb-4 relative z-20">
         <button 
            onClick={() => setView('DASHBOARD')}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold border transition-colors ${view === 'DASHBOARD' ? 'border-subspace-green text-subspace-green bg-subspace-green/10' : 'border-subspace-white/30 text-subspace-gray hover:text-subspace-white'}`}
         >
            COMMAND_DECK
         </button>
         <button 
            onClick={() => setView('NEWS')}
            className={`px-4 py-2 rounded-lg font-mono text-xs font-bold border transition-colors ${view === 'NEWS' ? 'border-subspace-green text-subspace-green bg-subspace-green/10' : 'border-subspace-white/30 text-subspace-gray hover:text-subspace-white'}`}
         >
            GLOBAL_INTELLIGENCE
         </button>
      </div>

      <main className="px-4 md:px-8 w-full max-w-[2400px] mx-auto space-y-8 relative z-10 pb-20">
        
        {view === 'DASHBOARD' ? (
           <div className="flex flex-col gap-8">
            {/* Full Width Top Section: Latent Map */}
            <div className="w-full">
               <LatentMap processing={processing} hoveredNodeId={hoveredNodeId} />
            </div>

            {/* Three Column Grid for the rest */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
               {/* Column 1: Identity, Audio, Feed */}
               <div className="flex flex-col gap-8">
                  <ProfileIdentity processing={processing} />
                  <AudioPlayer processing={processing} />
                  <LiveStream processing={processing} />
               </div>

               {/* Column 2: Protocol & Main Feed */}
               <div className="flex flex-col gap-8">
                  <ProtocolInterface processing={processing} />
                  <div className="h-[800px]">
                     <SurfaceFeed processing={processing} onHover={setHoveredNodeId} />
                  </div>
               </div>

               {/* Column 3: Ledger & Logs */}
               <div className="flex flex-col gap-8">
                  <SourceLedger processing={processing} />
                  <AhaLog processing={processing} />
                  <GhostLog />
               </div>
            </div>
           </div>
        ) : (
          <NewsPage processing={processing} />
        )}
      </main>
    </div>
  );
}

export default App;
