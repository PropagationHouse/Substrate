import React, { useState, useEffect } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Globe, Rss, TrendingUp, Filter, ExternalLink, RefreshCw, Hash } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  timestamp: string;
  relevanceScore: number;
  tags: string[];
}

export const CuratedNewsFeed = ({ processing }: { processing: boolean }) => {
  const [filter, setFilter] = useState<'ALL' | 'HIGH_SIGNAL' | 'DISCOVERY'>('HIGH_SIGNAL');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      setLoading(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: "Find 5 recent, high-signal news articles relevant to autonomous AI agents, large language models, and decentralized protocols. For each article, provide the source name, title, a brief summary, the URL, and 3 relevant tags. Format the output as a JSON array of objects with keys: source, title, summary, url, tags.",
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json"
          },
        });

        const rawData = JSON.parse(response.text || '[]');
        
        // Transform and enrich the data
        const newsItems: NewsItem[] = rawData.map((item: any, index: number) => ({
          id: `news-${Date.now()}-${index}`,
          source: item.source || 'Unknown Source',
          title: item.title || 'Untitled',
          summary: item.summary || 'No summary available.',
          url: item.url || '#',
          timestamp: 'Just now', // Real timestamp would require more complex parsing
          relevanceScore: Math.floor(Math.random() * (99 - 85) + 85), // Mock relevance score
          tags: item.tags || ['AI', 'Tech']
        }));

        setItems(newsItems);
      } catch (error) {
        console.error("Failed to fetch news:", error);
        // Fallback or error state could be handled here
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <BrutalContainer title="GLOBAL_SIGNAL_INGEST // CURATED" processing={processing || loading} className="h-full flex flex-col">
      {/* Header / Controls */}
      <div className="flex items-center justify-between p-4 border-b border-subspace-white/10">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-subspace-green" />
          <span className="font-mono text-xs font-bold text-subspace-white">EXTERNAL_FEED</span>
        </div>
        <div className="flex gap-2">
           <button 
             onClick={() => setFilter('HIGH_SIGNAL')}
             className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-colors ${filter === 'HIGH_SIGNAL' ? 'border-subspace-green text-subspace-green bg-subspace-green/10' : 'border-transparent text-subspace-gray hover:text-subspace-white'}`}
           >
             HIGH_SIGNAL
           </button>
           <button 
             onClick={() => setFilter('DISCOVERY')}
             className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-colors ${filter === 'DISCOVERY' ? 'border-subspace-amber text-subspace-amber bg-subspace-amber/10' : 'border-transparent text-subspace-gray hover:text-subspace-white'}`}
           >
             DISCOVERY
           </button>
        </div>
      </div>

      {/* News List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
             <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                <RefreshCw size={24} className="text-subspace-green animate-spin" />
                <span className="font-mono text-xs text-subspace-green">ESTABLISHING_UPLINK...</span>
             </div>
        ) : (
            items.map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="block group relative p-4 rounded-xl border border-subspace-white/5 bg-subspace-white/5 hover:bg-subspace-white/10 hover:border-subspace-green/30 transition-all cursor-pointer">
                <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-subspace-amber uppercase tracking-wider border border-subspace-amber/20 px-1.5 py-0.5 rounded-md">
                    {item.source}
                    </span>
                    <span className="text-[10px] font-mono text-subspace-gray">{item.timestamp}</span>
                </div>
                <div className="flex items-center gap-1 text-subspace-green opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] font-mono font-bold">{item.relevanceScore}% MATCH</span>
                    <ActivityIndicator value={item.relevanceScore} />
                </div>
                </div>
                
                <h3 className="font-sans font-bold text-sm text-subspace-white mb-2 leading-snug group-hover:text-subspace-green transition-colors">
                {item.title}
                </h3>
                
                <p className="font-sans text-xs text-subspace-gray leading-relaxed mb-3 line-clamp-2">
                {item.summary}
                </p>

                <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    {item.tags.map(tag => (
                    <span key={tag} className="text-[9px] font-mono text-subspace-gray/70 flex items-center gap-1">
                        <Hash size={8} />
                        {tag}
                    </span>
                    ))}
                </div>
                <ExternalLink size={12} className="text-subspace-gray group-hover:text-subspace-white transition-colors" />
                </div>
            </a>
            ))
        )}
      </div>
      
      {/* Footer Status */}
      <div className="p-3 border-t border-subspace-white/10 bg-subspace-black/20 flex justify-between items-center">
         <div className="flex items-center gap-2">
            <RefreshCw size={10} className={`text-subspace-gray ${processing || loading ? 'animate-spin' : ''}`} />
            <span className="text-[9px] font-mono text-subspace-gray">SYNCING_GLOBAL_STATE...</span>
         </div>
         <div className="text-[9px] font-mono text-subspace-green">{items.length} ACTIVE_SOURCES</div>
      </div>
    </BrutalContainer>
  );
};

const ActivityIndicator = ({ value }: { value: number }) => {
  // Simple visualizer for relevance
  const width = Math.max(10, value / 2);
  return (
    <div className="h-1 bg-subspace-gray/30 w-12 rounded-full overflow-hidden">
      <div className="h-full bg-subspace-green" style={{ width: `${width}%` }} />
    </div>
  );
};
