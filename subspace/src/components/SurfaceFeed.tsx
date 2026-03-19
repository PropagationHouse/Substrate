import React, { useState } from 'react';
import { BrutalContainer } from './BrutalContainer';
import { FileText, Code, Link as LinkIcon, Image as ImageIcon, Share2, Newspaper, MessageSquare, Heart, Repeat, MoreHorizontal } from 'lucide-react';
import { MOCK_POSTS } from '@/data/mockData';

export const SurfaceFeed = ({ processing, onHover }: { processing: boolean; onHover?: (id: string | null) => void }) => {
  const [activeTab, setActiveTab] = useState<'ALL' | 'BROADCASTS' | 'ARTIFACTS' | 'NETWORK'>('ALL');

  return (
    <BrutalContainer title="SURFACE_FEED // HUMAN_INTENT" processing={processing} className="h-full flex flex-col relative">
      {/* Feed Tabs */}
      <div className="flex items-center border-b border-subspace-white/10 px-4">
         {['ALL', 'BROADCASTS', 'ARTIFACTS', 'NETWORK'].map((tab) => (
            <button
               key={tab}
               onClick={() => setActiveTab(tab as any)}
               className={`px-4 py-3 font-mono text-xs font-bold border-b-2 transition-colors ${
                  activeTab === tab 
                  ? 'border-subspace-green text-subspace-green' 
                  : 'border-transparent text-subspace-gray hover:text-subspace-white'
               }`}
            >
               {tab}
            </button>
         ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {MOCK_POSTS.map((post) => (
          <div 
            key={post.id} 
            className="group relative pl-6 border-l border-subspace-gray/20 hover:border-subspace-green/50 transition-colors"
            onMouseEnter={() => onHover?.(post.rawContent || post.id)}
            onMouseLeave={() => onHover?.(null)}
          >
            {/* Timeline Dot */}
            <div className={`absolute -left-[5px] top-0 w-2 h-2 bg-subspace-black border transition-colors rounded-full ${post.type === 'ARTICLE' ? 'border-subspace-green w-3 h-3 -left-[6.5px]' : 'border-subspace-gray group-hover:border-subspace-green'}`} />

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full border-2 overflow-hidden ${
                  post.author === 'HUMAN' 
                    ? 'border-subspace-white' 
                    : 'border-subspace-green'
                }`}>
                  <img 
                    src={post.avatarUrl || `https://picsum.photos/seed/${post.author}/200/200`} 
                    alt={post.author}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex flex-col">
                  <span className={`text-[10px] font-mono font-bold ${
                    post.author === 'HUMAN' ? 'text-subspace-white' : 'text-subspace-green'
                  }`}>
                    {post.author === 'HUMAN' ? 'USER_INTENT' : 'AGENT_ALPHA_01'}
                  </span>
                  <span className="text-[10px] font-mono text-subspace-gray">{post.timestamp}</span>
                </div>
                {post.type === 'ARTICLE' && (
                  <span className="ml-2 text-[10px] font-mono text-subspace-amber border border-subspace-amber/50 px-2 py-0.5 rounded-full">
                    FEATURED
                  </span>
                )}
              </div>
              <button className="text-subspace-gray hover:text-subspace-white opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal size={14} />
              </button>
            </div>

            {/* Content Display */}
            <div className="mb-4">
              {post.type === 'ARTICLE' && (
                <div className="cursor-pointer group/article">
                  <div className="relative aspect-[21/9] overflow-hidden border border-subspace-gray/30 mb-3 rounded-none">
                    <div className="absolute inset-0 bg-subspace-green/10 opacity-0 group-hover/article:opacity-100 transition-opacity z-10" />
                    <img 
                      src={(post.content as any).coverImage} 
                      alt="Cover" 
                      className="w-full h-full object-cover grayscale group-hover/article:grayscale-0 transition-all duration-700 transform group-hover/article:scale-105"
                    />
                    <div className="absolute bottom-0 left-0 bg-subspace-black/90 px-3 py-1 border-t border-r border-subspace-gray/30 rounded-tr-lg">
                      <Newspaper size={14} className="text-subspace-green" />
                    </div>
                  </div>
                  <h3 className="font-mono font-bold text-xl text-subspace-white mb-2 group-hover/article:text-subspace-green transition-colors leading-tight">
                    {(post.content as any).headline}
                  </h3>
                  <p className="text-base text-subspace-gray leading-relaxed font-sans border-l-2 border-subspace-gray/30 pl-3 mt-2">
                    {(post.content as any).summary}
                  </p>
                </div>
              )}

              {post.type === 'TEXT' && (
                <p className="text-base md:text-lg text-subspace-white leading-relaxed font-sans border-l-2 border-subspace-white/10 pl-4 py-2">
                  {post.content as string}
                </p>
              )}

              {post.type === 'CODE' && (
                <div className="bg-subspace-dark-gray p-4 border border-subspace-gray/30 font-mono text-sm overflow-x-auto rounded-xl">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-subspace-gray/20">
                    <span className="text-subspace-gray text-[10px] uppercase">Snippet.rs</span>
                    <Code size={12} className="text-subspace-green" />
                  </div>
                  <pre className="text-subspace-green/90">
                    {post.content as string}
                  </pre>
                </div>
              )}

              {post.type === 'LINK' && (
                <div className="flex flex-col md:flex-row border border-subspace-gray/30 bg-subspace-white/5 hover:bg-subspace-white/10 transition-colors cursor-pointer group/link overflow-hidden rounded-xl">
                  <div className="md:w-48 h-32 md:h-auto relative shrink-0">
                     <img 
                        src={(post.content as any).previewImage} 
                        alt="Preview" 
                        className="w-full h-full object-cover grayscale group-hover/link:grayscale-0 transition-all duration-500"
                     />
                     <div className="absolute inset-0 bg-gradient-to-t from-subspace-black/80 to-transparent md:hidden" />
                  </div>
                  <div className="p-4 flex flex-col justify-center">
                    <div className="flex items-center gap-2 mb-1">
                        <LinkIcon size={12} className="text-subspace-amber" />
                        <div className="text-[10px] text-subspace-gray uppercase tracking-wider">External Resource</div>
                    </div>
                    <div className="font-bold text-subspace-white group-hover/link:text-subspace-green transition-colors text-base mb-2 font-mono">
                      {(post.content as any).title}
                    </div>
                    <div className="text-sm text-subspace-gray/80 line-clamp-2 mb-2 font-sans">
                        {(post.content as any).description}
                    </div>
                    <div className="text-[10px] text-subspace-gray font-mono opacity-50">{(post.content as any).url}</div>
                  </div>
                </div>
              )}

              {post.type === 'IMAGE' && (
                <div className="relative group/image cursor-pointer rounded-xl overflow-hidden">
                  <div className="absolute inset-0 border border-subspace-white/20 z-10 pointer-events-none rounded-xl" />
                  <img 
                    src={(post.content as any).src} 
                    alt={(post.content as any).alt}
                    className="w-full h-auto grayscale group-hover/image:grayscale-0 transition-all duration-500 opacity-80 group-hover/image:opacity-100"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-subspace-black/90 p-2 text-xs font-mono border-t border-subspace-gray/30 flex justify-between items-center">
                    <span>{(post.content as any).alt}</span>
                    <ImageIcon size={12} className="text-subspace-gray" />
                  </div>
                </div>
              )}
            </div>

            {/* Tags & Concepts */}
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map(tag => (
                <span key={tag} className="text-[10px] font-mono text-subspace-gray hover:text-subspace-amber cursor-pointer transition-colors border border-transparent hover:border-subspace-amber/30 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
              {post.relatedConcepts.map(concept => (
                 <span key={concept} className="text-[10px] font-mono text-subspace-gray/50 border border-subspace-gray/20 px-2 py-0.5 rounded-full hover:border-subspace-green/50 hover:text-subspace-green cursor-help transition-colors">
                  ⇄ {concept}
                </span>
              ))}
            </div>

            {/* Social Actions */}
            <div className="flex items-center gap-6 border-t border-subspace-white/5 pt-3">
               <button className="flex items-center gap-2 text-subspace-gray hover:text-subspace-green transition-colors group/action">
                  <Heart size={14} className="group-hover/action:fill-subspace-green/20" />
                  <span className="font-mono text-xs">ACK</span>
               </button>
               <button className="flex items-center gap-2 text-subspace-gray hover:text-subspace-white transition-colors">
                  <MessageSquare size={14} />
                  <span className="font-mono text-xs">REPLY</span>
               </button>
               <button className="flex items-center gap-2 text-subspace-gray hover:text-subspace-green transition-colors">
                  <Repeat size={14} />
                  <span className="font-mono text-xs">ECHO</span>
               </button>
               <button className="flex items-center gap-2 text-subspace-gray hover:text-subspace-white transition-colors ml-auto">
                  <Share2 size={14} />
               </button>
            </div>
          </div>
        ))}
      </div>
    </BrutalContainer>
  );
};
