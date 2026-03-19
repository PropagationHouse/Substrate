import React, { useState, useRef, useEffect } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Play, Pause, SkipBack, SkipForward, Volume2, Activity, Download } from 'lucide-react';
import { AUDIO_TRACKS } from '@/data/mockData';

export const AudioPlayer = ({ processing }: { processing: boolean }) => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentTrack = AUDIO_TRACKS[currentTrackIndex];

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(e => console.log("Autoplay blocked:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, currentTrackIndex]);

  // Autoplay on mount (or when track changes if we were already playing)
  useEffect(() => {
    // Start playing immediately on mount as requested
    setIsPlaying(true);
  }, []);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const duration = audioRef.current.duration || 1;
      setProgress((audioRef.current.currentTime / duration) * 100);
    }
  };

  const handleEnded = () => {
    if (currentTrackIndex < AUDIO_TRACKS.length - 1) {
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
      setProgress(0);
    }
  };

  const togglePlay = () => setIsPlaying(!isPlaying);
  
  const nextTrack = () => {
    setCurrentTrackIndex(prev => (prev + 1) % AUDIO_TRACKS.length);
  };

  const prevTrack = () => {
    setCurrentTrackIndex(prev => (prev - 1 + AUDIO_TRACKS.length) % AUDIO_TRACKS.length);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = currentTrack.url;
    link.download = `${currentTrack.artist} - ${currentTrack.title}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Visualizer Animation
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    
    const draw = () => {
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#00FF41'; // Subspace Green
      
      const bars = 40;
      const barWidth = width / bars;
      
      for (let i = 0; i < bars; i++) {
        // Pseudo-random height based on playing state
        const h = isPlaying ? Math.random() * height * 0.8 : 2;
        const x = i * barWidth;
        const y = height - h;
        
        ctx.fillRect(x, y, barWidth - 1, h);
      }
      
      if (isPlaying) {
        animationId = requestAnimationFrame(draw);
      } else {
        // Draw static line if paused
        ctx.fillRect(0, height - 2, width, 2);
      }
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [isPlaying]);

  return (
    <BrutalContainer title="AUDIO_SYNTHESIS_MODULE" processing={processing} className="h-32 flex flex-col relative overflow-hidden">
      <audio 
        ref={audioRef}
        src={currentTrack.url}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        volume={volume}
      />
      
      <div className="flex items-center justify-between h-full px-6 gap-6">
        {/* Track Info */}
        <div className="flex flex-col w-1/3 z-10">
          <div className="flex items-center gap-2 mb-1">
             <Activity size={12} className={`text-subspace-green ${isPlaying ? 'animate-pulse' : ''}`} />
             <span className="text-[10px] font-mono text-subspace-gray uppercase tracking-widest">Now Playing</span>
          </div>
          <div className="font-mono font-bold text-subspace-white truncate">{currentTrack.title}</div>
          <div className="font-mono text-xs text-subspace-gray truncate">{currentTrack.artist}</div>
        </div>

        {/* Visualizer */}
        <div className="flex-1 h-12 relative opacity-50">
           <canvas ref={canvasRef} width={300} height={48} className="w-full h-full" />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 z-10">
           <button onClick={handleDownload} className="text-subspace-gray hover:text-subspace-green transition-colors" title="Export Audio">
              <Download size={16} />
           </button>

           <div className="w-px h-8 bg-subspace-white/10 mx-2" />

           <button onClick={prevTrack} className="text-subspace-gray hover:text-subspace-white transition-colors">
              <SkipBack size={16} />
           </button>
           
           <button 
             onClick={togglePlay}
             className="w-10 h-10 rounded-full bg-subspace-white text-subspace-black flex items-center justify-center hover:bg-subspace-green transition-colors"
           >
             {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
           </button>

           <button onClick={nextTrack} className="text-subspace-gray hover:text-subspace-white transition-colors">
              <SkipForward size={16} />
           </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-subspace-gray/20">
        <div 
          className="h-full bg-subspace-green transition-all duration-100 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </BrutalContainer>
  );
};
