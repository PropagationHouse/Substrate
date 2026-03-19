import React, { useState, useEffect } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { Globe, Search, ArrowUpRight, Hash, Filter, RefreshCw, Newspaper, Bookmark, Share2, TrendingUp, Clock, Zap } from 'lucide-react';
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
  imageUrl?: string;
}

export const NewsPage = ({ processing }: { processing: boolean }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'AI_RESEARCH' | 'CRYPTO_PROTOCOL' | 'HUMAN_CULTURE'>('ALL');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredArticle, setFeaturedArticle] = useState<NewsArticle | null>(null);

  const fetchNews = async (query?: string) => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = query 
        ? `Find 7 recent, high-quality news articles about "${query}". For each, provide source, title, summary, url, and tags. Return JSON.`
        : `Find 7 recent, high-signal news articles relevant to: 1) Autonomous AI Agents, 2) Decentralized Protocols, 3) Human-AI Interaction. For each, provide source, title, summary, url, tags, and categorize them as AI_RESEARCH, CRYPTO_PROTOCOL, or HUMAN_CULTURE. Return JSON array.`;

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
        relevance: Math.floor(Math.random() * 15) + 85,
        imageUrl: `https://picsum.photos/seed/${item.title}/800/400`
      }));

      setFeaturedArticle(newsItems[0]);
      setArticles(newsItems.slice(1));
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
    <div className="space-y-6">
      {/* Header / Search Bar */}
      <BrutalContainer className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
         <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-subspace-green/10 flex items-center justify-center border border-subspace-green/30">
               <Globe className="text-subspace-green" size={20} />
            </div>
            <div>
               <h1 className="font-mono font-bold text-xl text-subspace-white leading-none">GLOBAL_INTELLIGENCE</h1>
               <div className="font-mono text-xs text-subspace-gray mt-1">REAL_TIME_SIGNAL_INGEST</div>
            </div>
         </div>

         <form onSubmit={handleSearch} className="relative group w-full md:w-96">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subspace-gray group-focus-within:text-subspace-green transition-colors" />
            <input 
               type="text" 
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               placeholder="SEARCH_GLOBAL_INDEX..."
               className="w-full bg-subspace-black/50 border border-subspace-white/10 rounded-xl py-2.5 pl-9 pr-4 font-mono text-sm text-subspace-white focus:border-subspace-green focus:outline-none transition-all placeholder-subspace-gray/50"
            />
         </form>
      </BrutalContainer>

      {/* Featured Article */}
      {featuredArticle && (
         <BrutalContainer className="relative overflow-hidden group cursor-pointer h-[400px]">
            <div className="absolute inset-0">
               <img src={featuredArticle.imageUrl} alt={featuredArticle.title} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-700 group-hover:scale-105 transform" />
               <div className="absolute inset-0 bg-gradient-to-t from-subspace-black via-subspace-black/60 to-transparent" />
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 p-8 z-10">
               <div className="flex items-center gap-3 mb-3">
                  <span className="bg-subspace-green text-subspace-black font-mono text-xs font-bold px-2 py-1 rounded-md uppercase">Featured_Signal</span>
                  <span className="text-subspace-white/80 font-mono text-xs flex items-center gap-1">
                     <Clock size={12} /> {featuredArticle.timestamp}
                  </span>
               </div>
               <h2 className="font-sans font-bold text-3xl md:text-4xl text-subspace-white mb-3 leading-tight max-w-3xl group-hover:text-subspace-green transition-colors">
                  {featuredArticle.title}
               </h2>
               <p className="font-sans text-subspace-gray text-lg max-w-2xl line-clamp-2 mb-6">
                  {featuredArticle.summary}
               </p>
               <div className="flex items-center gap-4">
                  <a href={featuredArticle.url} target="_blank" rel="noopener noreferrer" className="bg-subspace-white text-subspace-black font-mono font-bold text-sm px-6 py-2 rounded-lg hover:bg-subspace-green transition-colors flex items-center gap-2">
                     READ_FULL_REPORT <ArrowUpRight size={14} />
                  </a>
                  <button className="p-2 rounded-lg border border-subspace-white/20 text-subspace-white hover:border-subspace-green hover:text-subspace-green transition-colors">
                     <Bookmark size={18} />
                  </button>
               </div>
            </div>
         </BrutalContainer>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Left Column: Feed */}
         <div className="lg:col-span-2 space-y-6">
            {/* Filter Tabs */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 border-b border-subspace-white/10">
               {['ALL', 'AI_RESEARCH', 'CRYPTO_PROTOCOL', 'HUMAN_CULTURE'].map((cat) => (
                  <button
                  key={cat}
                  onClick={() => setActiveCategory(cat as any)}
                  className={`px-4 py-2 rounded-lg font-mono text-xs font-bold border transition-colors whitespace-nowrap ${
                     activeCategory === cat 
                        ? 'border-subspace-green text-subspace-green bg-subspace-green/5' 
                        : 'border-transparent text-subspace-gray hover:text-subspace-white hover:bg-subspace-white/5'
                  }`}
                  >
                  {cat.replace('_', ' ')}
                  </button>
               ))}
            </div>

            {/* Articles List */}
            <div className="space-y-4">
               {loading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-50">
                     <RefreshCw size={32} className="text-subspace-green animate-spin" />
                     <div className="font-mono text-xs text-subspace-green animate-pulse">ESTABLISHING_UPLINK...</div>
                  </div>
               ) : (
                  filteredArticles.map((article) => (
                     <BrutalContainer key={article.id} className="group flex flex-col md:flex-row gap-6 p-6 hover:border-subspace-green/30 transition-all cursor-pointer">
                        <div className="w-full md:w-48 h-32 rounded-xl overflow-hidden shrink-0 relative">
                           <img src={article.imageUrl} alt={article.title} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                           <div className="absolute top-2 left-2 bg-subspace-black/80 backdrop-blur-sm px-2 py-1 rounded-md border border-subspace-white/10">
                              <span className="text-[10px] font-mono text-subspace-white font-bold">{article.source}</span>
                           </div>
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-mono text-subspace-amber border border-subspace-amber/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                                 {article.category.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] font-mono text-subspace-gray">{article.timestamp}</span>
                           </div>
                           <h3 className="font-sans font-bold text-xl text-subspace-white mb-2 leading-tight group-hover:text-subspace-green transition-colors">
                              {article.title}
                           </h3>
                           <p className="font-sans text-sm text-subspace-gray leading-relaxed line-clamp-2 mb-3">
                              {article.summary}
                           </p>
                           <div className="flex items-center justify-between">
                              <div className="flex gap-2">
                                 {article.tags.slice(0, 3).map(tag => (
                                    <span key={tag} className="text-[10px] font-mono text-subspace-gray/70 flex items-center gap-1 bg-subspace-white/5 px-2 py-1 rounded-full">
                                       <Hash size={10} /> {tag}
                                    </span>
                                 ))}
                              </div>
                              <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button className="text-subspace-gray hover:text-subspace-white transition-colors"><Bookmark size={14} /></button>
                                 <button className="text-subspace-gray hover:text-subspace-white transition-colors"><Share2 size={14} /></button>
                              </div>
                           </div>
                        </div>
                     </BrutalContainer>
                  ))
               )}
            </div>
         </div>

         {/* Right Column: Trending & Stats */}
         <div className="space-y-6">
            <BrutalContainer title="TRENDING_TOPICS" className="p-4">
               <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                     <div key={i} className="flex items-center gap-3 p-2 hover:bg-subspace-white/5 rounded-lg cursor-pointer group transition-colors">
                        <span className="font-mono text-subspace-gray/50 text-sm font-bold">0{i}</span>
                        <div className="flex-1">
                           <div className="font-mono text-xs font-bold text-subspace-white group-hover:text-subspace-green transition-colors">AGENT_AUTONOMY_PROTOCOLS</div>
                           <div className="text-[10px] text-subspace-gray">12.4k signals • Trending up</div>
                        </div>
                        <TrendingUp size={14} className="text-subspace-green" />
                     </div>
                  ))}
               </div>
            </BrutalContainer>

            <BrutalContainer title="SIGNAL_SOURCES" className="p-4">
               <div className="grid grid-cols-2 gap-3">
                  {['ArXiv', 'TechCrunch', 'Wired', 'HackerNews', 'Decrypt', 'Nature'].map((source) => (
                     <div key={source} className="bg-subspace-white/5 border border-subspace-white/10 rounded-lg p-3 flex flex-col items-center justify-center gap-2 hover:border-subspace-green/50 hover:bg-subspace-green/5 cursor-pointer transition-all">
                        <Newspaper size={16} className="text-subspace-gray" />
                        <span className="font-mono text-[10px] font-bold text-subspace-white">{source}</span>
                     </div>
                  ))}
               </div>
            </BrutalContainer>
         </div>
      </div>
    </div>
  );
};
