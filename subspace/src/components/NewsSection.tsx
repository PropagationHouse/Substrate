import React, { useState, useEffect } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Globe, Search, ArrowUpRight, Hash, Filter, RefreshCw, Newspaper, Bookmark, Share2 } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface NewsArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  timestamp: string;
  tags: string[];
  category: 'AI_RESEARCH' | 'CRYPTO_PROTOCOL' | 'HUMAN_CULTURE' | 'TECH_INDUSTRY';
  relevance: number;
}

export const NewsSection = ({ processing }: { processing: boolean }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'AI_RESEARCH' | 'CRYPTO_PROTOCOL' | 'HUMAN_CULTURE'>('ALL');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNews = async (query?: string) => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = query 
        ? `Find 6 recent, high-quality news articles about "${query}". For each, provide source, title, summary, url, and tags. Return JSON.`
        : `Find 6 recent, high-signal news articles relevant to: 1) Autonomous AI Agents, 2) Decentralized Protocols, 3) Human-AI Interaction. For each, provide source, title, summary, url, tags, and categorize them as AI_RESEARCH, CRYPTO_PROTOCOL, or HUMAN_CULTURE. Return JSON array.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json"
        },
      });

      const rawData = JSON.parse(response.text || '[]');
      
      const newsItems: NewsArticle[] = rawData.map((item: any, index: number) => ({
        id: `news-${Date.now()}-${index}`,
        source: item.source || 'Unknown Source',
        title: item.title || 'Untitled Article',
        summary: item.summary || 'No summary available.',
        url: item.url || '#',
        timestamp: 'Just now',
        tags: item.tags || ['Signal'],
        category: item.category || 'TECH_INDUSTRY',
        relevance: Math.floor(Math.random() * 15) + 85
      }));

      setArticles(newsItems);
    } catch (error) {
      console.error("Failed to fetch news:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      fetchNews(searchQuery);
    }
  };

  const filteredArticles = activeCategory === 'ALL' 
    ? articles 
    : articles.filter(a => a.category === activeCategory);

  return (
    <BrutalContainer title="GLOBAL_INTELLIGENCE_STREAM" processing={processing || loading} className="h-full flex flex-col">
      {/* Search & Filter Header */}
      <div className="p-4 border-b border-subspace-white/10 space-y-4">
        <form onSubmit={handleSearch} className="relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subspace-gray group-focus-within:text-subspace-green transition-colors" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="SEARCH_GLOBAL_INDEX..."
            className="w-full bg-subspace-black/50 border border-subspace-white/10 rounded-xl py-2 pl-9 pr-4 font-mono text-xs text-subspace-white focus:border-subspace-green focus:outline-none transition-all placeholder-subspace-gray/50"
          />
        </form>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {['ALL', 'AI_RESEARCH', 'CRYPTO_PROTOCOL', 'HUMAN_CULTURE'].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat as any)}
              className={`px-3 py-1.5 rounded-lg font-mono text-[10px] font-bold border transition-colors whitespace-nowrap ${
                activeCategory === cat 
                  ? 'border-subspace-green text-subspace-green bg-subspace-green/5' 
                  : 'border-transparent text-subspace-gray hover:text-subspace-white hover:bg-subspace-white/5'
              }`}
            >
              {cat.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* News Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
            <RefreshCw size={32} className="text-subspace-green animate-spin" />
            <div className="font-mono text-xs text-subspace-green animate-pulse">ESTABLISHING_UPLINK...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredArticles.map((article) => (
              <a 
                key={article.id} 
                href={article.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="group flex flex-col bg-subspace-white/5 border border-subspace-white/5 rounded-xl overflow-hidden hover:border-subspace-green/30 hover:bg-subspace-white/10 transition-all duration-300"
              >
                <div className="p-4 flex-1">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-subspace-amber border border-subspace-amber/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                        {article.source}
                      </span>
                      <span className="text-[9px] font-mono text-subspace-gray">{article.timestamp}</span>
                    </div>
                    <ArrowUpRight size={14} className="text-subspace-gray group-hover:text-subspace-green transition-colors" />
                  </div>

                  <h3 className="font-sans font-bold text-base text-subspace-white mb-2 leading-snug group-hover:text-subspace-green transition-colors line-clamp-2">
                    {article.title}
                  </h3>
                  
                  <p className="font-sans text-xs text-subspace-gray leading-relaxed mb-4 line-clamp-3">
                    {article.summary}
                  </p>
                </div>

                <div className="px-4 py-3 border-t border-subspace-white/5 bg-subspace-black/20 flex justify-between items-center">
                  <div className="flex gap-2 overflow-hidden">
                    {article.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[9px] font-mono text-subspace-gray/70 flex items-center gap-1 whitespace-nowrap">
                        <Hash size={8} />
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button className="text-subspace-gray hover:text-subspace-white transition-colors">
                      <Bookmark size={12} />
                    </button>
                    <button className="text-subspace-gray hover:text-subspace-white transition-colors">
                      <Share2 size={12} />
                    </button>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </BrutalContainer>
  );
};
