import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BrutalContainer } from './BrutalContainer';
import { MOCK_POSTS, INITIAL_NODES, INITIAL_LINKS } from '@/data/mockData';
import { Search, FileText, Image as ImageIcon, Link as LinkIcon, Code, Hash, Newspaper, ExternalLink, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Node Types & Colors
const TYPE_COLORS = {
  CONCEPT: '#6B7280', // Gray
  TEXT: '#E5E7EB',    // White/Gray
  IMAGE: '#D946EF',   // Pink/Purple
  CODE: '#00FF41',    // Green
  LINK: '#3B82F6',    // Blue
  ARTICLE: '#F59E0B'  // Amber
};

interface Node extends d3.SimulationNodeDatum {
  id: string;
  group: number;
  val: number;
  type: keyof typeof TYPE_COLORS;
  data?: any; // Store full post content here
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

export const LatentMap = ({ processing, hoveredNodeId }: { processing: boolean; hoveredNodeId?: string | null }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeNode, setActiveNode] = useState<Node | null>(null);
  
  // Merge initial nodes with posts
  const [nodes, setNodes] = useState<Node[]>(() => {
    const conceptNodes = INITIAL_NODES.map(n => ({
      ...n,
      type: 'CONCEPT' as const,
      data: { description: 'Core System Concept' }
    }));

    const postNodes = MOCK_POSTS.map(post => ({
      id: post.rawContent || post.id,
      group: 5,
      val: post.type === 'ARTICLE' ? 12 : 8,
      type: post.type as keyof typeof TYPE_COLORS,
      data: post
    }));
    return [...conceptNodes, ...postNodes];
  });

  const [links, setLinks] = useState<Link[]>(() => {
    const postLinks = MOCK_POSTS.flatMap(post => 
      post.relatedConcepts.map(concept => ({
        source: post.rawContent || post.id,
        target: concept
      }))
    );
    return [...INITIAL_LINKS, ...postLinks];
  });

  // Effect for D3 Initialization and Updates
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous

    // Zoom behavior
    const g = svg.append("g");
    const zoom = d3.zoom()
      .scaleExtent([0.5, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    
    svg.call(zoom as any);

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d: any) => d.val * 2));

    const link = g.append("g")
      .attr("stroke", "#2A2A2A")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 1);

    const nodeGroup = g.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "cursor-pointer transition-opacity duration-300")
      .call(drag(simulation) as any)
      .on("mouseover", (event, d) => {
        setActiveNode(d);
        d3.select(event.currentTarget).select("circle").attr("stroke", "#fff").attr("stroke-width", 2);
      })
      .on("mouseout", (event, d) => {
        // Don't clear active node immediately to allow interaction? 
        // For now, let's keep it simple: clear on mouseout unless we click?
        // Let's stick to hover for "tear sheet" feel
        // setActiveNode(null); 
        d3.select(event.currentTarget).select("circle").attr("stroke", (d: any) => d.type === 'CONCEPT' ? 'none' : '#000').attr("stroke-width", (d: any) => d.type === 'CONCEPT' ? 0 : 1);
      });

    // Node circles
    const circles = nodeGroup.append("circle")
      .attr("r", (d) => d.val)
      .attr("fill", (d) => TYPE_COLORS[d.type] || TYPE_COLORS.CONCEPT)
      .attr("stroke", "#000")
      .attr("stroke-width", 1)
      .attr("opacity", 0.9);

    // Icons for nodes (optional, simplified to just circles for performance/cleanliness, but could add icons)
    // Let's add small icons for non-concepts
    nodeGroup.each(function(d) {
        if (d.type !== 'CONCEPT') {
            // This is a bit heavy for D3 + React, keeping it simple with colors for now
        }
    });

    // Labels
    const labels = nodeGroup.append("text")
      .attr("dx", (d) => d.val + 4)
      .attr("dy", 4)
      .text((d) => d.id)
      .attr("font-family", "JetBrains Mono")
      .attr("font-size", "10px")
      .attr("fill", "#9CA3AF")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      nodeGroup
        .attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    function drag(simulation: any) {
      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        setActiveNode(event.subject);
      }

      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }

      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }

      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    // External Hover Logic
    if (hoveredNodeId) {
        const node = nodes.find(n => n.id === hoveredNodeId);
        if (node) setActiveNode(node);
    }

  }, [nodes, links, processing, hoveredNodeId]);

  // Filter nodes based on search
  useEffect(() => {
      if (searchTerm) {
          const found = nodes.find(n => n.id.toLowerCase().includes(searchTerm.toLowerCase()));
          if (found) setActiveNode(found);
      }
  }, [searchTerm, nodes]);


  // Helper to get icon
  const getNodeIcon = (type: string) => {
      switch (type) {
          case 'IMAGE': return <ImageIcon size={16} className="text-fuchsia-500" />;
          case 'CODE': return <Code size={16} className="text-subspace-green" />;
          case 'LINK': return <LinkIcon size={16} className="text-blue-500" />;
          case 'ARTICLE': return <Newspaper size={16} className="text-amber-500" />;
          case 'TEXT': return <FileText size={16} className="text-gray-300" />;
          default: return <Hash size={16} className="text-gray-500" />;
      }
  };

  return (
    <BrutalContainer title="LATENT_SPACE_NAVIGATOR" processing={processing} className="h-[600px] w-full relative group overflow-hidden flex flex-col">
      <div ref={containerRef} className="flex-1 relative bg-subspace-black/50">
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        
        {/* Search Bar */}
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-subspace-black/80 border border-subspace-gray/30 p-1 pl-3 backdrop-blur-sm rounded-full w-64 shadow-lg z-20">
            <Search size={12} className="text-subspace-gray" />
            <input 
            type="text" 
            placeholder="SEARCH_NODES..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent border-none outline-none text-xs font-mono text-subspace-white placeholder-subspace-gray/50 w-full"
            />
        </div>

        {/* Legend */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-[9px] font-mono text-subspace-white font-bold shadow-black drop-shadow-md">{type}</span>
                </div>
            ))}
        </div>

        {/* Active Node Preview Card */}
        <AnimatePresence>
            {activeNode && (
                <motion.div 
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute bottom-4 left-4 right-4 md:right-auto md:w-80 bg-subspace-black/95 backdrop-blur-xl border border-subspace-white/20 rounded-xl p-4 shadow-2xl z-30"
                >
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            {getNodeIcon(activeNode.type)}
                            <span className="font-mono text-xs font-bold text-subspace-white truncate max-w-[180px]">{activeNode.id}</span>
                        </div>
                        <span className="text-[9px] font-mono text-subspace-white/80 border border-subspace-white/30 px-1.5 py-0.5 rounded-md">
                            {activeNode.type}
                        </span>
                    </div>

                    {/* Dynamic Content Preview */}
                    <div className="mb-3">
                        {activeNode.type === 'IMAGE' && activeNode.data?.content?.src && (
                            <div className="rounded-lg overflow-hidden border border-subspace-white/10 mb-2">
                                <img src={activeNode.data.content.src} alt="Preview" className="w-full h-32 object-cover" />
                            </div>
                        )}
                        
                        {activeNode.type === 'ARTICLE' && activeNode.data?.content?.coverImage && (
                             <div className="rounded-lg overflow-hidden border border-subspace-white/10 mb-2 relative group/preview">
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-2">
                                    <h4 className="text-xs font-bold text-white line-clamp-2 leading-tight">{activeNode.data.content.headline}</h4>
                                </div>
                                <img src={activeNode.data.content.coverImage} alt="Preview" className="w-full h-32 object-cover" />
                            </div>
                        )}

                        {activeNode.type === 'CODE' && (
                            <div className="bg-subspace-dark-gray p-3 rounded-lg border border-subspace-white/10 font-mono text-[10px] text-subspace-green overflow-x-auto relative">
                                <div className="absolute top-1 right-2 text-[8px] text-subspace-gray uppercase">RUST</div>
                                <pre className="whitespace-pre-wrap break-all">{activeNode.data?.content?.substring(0, 150)}...</pre>
                            </div>
                        )}

                        {activeNode.type === 'TEXT' && (
                            <div className="bg-subspace-white/5 p-3 rounded-lg border-l-2 border-subspace-white/20 italic">
                                <p className="text-xs text-subspace-white/90 font-sans leading-relaxed line-clamp-4">
                                    "{activeNode.data?.content}"
                                </p>
                            </div>
                        )}

                        {activeNode.type === 'LINK' && (
                            <div className="bg-subspace-white/5 rounded-lg border border-subspace-white/10 overflow-hidden flex flex-col">
                                {activeNode.data?.content?.previewImage && (
                                    <div className="h-20 w-full overflow-hidden">
                                        <img src={activeNode.data.content.previewImage} className="w-full h-full object-cover opacity-80" />
                                    </div>
                                )}
                                <div className="p-2">
                                    <div className="text-[10px] font-bold text-subspace-blue mb-1 truncate">{activeNode.data?.content?.url}</div>
                                    <div className="text-xs text-subspace-white font-bold line-clamp-1">{activeNode.data?.content?.title}</div>
                                    <div className="text-[10px] text-subspace-gray-300 line-clamp-2 mt-1">{activeNode.data?.content?.description}</div>
                                </div>
                            </div>
                        )}
                        
                        {activeNode.type === 'CONCEPT' && (
                            <div className="p-3 bg-subspace-white/5 rounded-lg border border-subspace-white/10">
                                <div className="flex items-center gap-2 mb-2">
                                    <Hash size={12} className="text-subspace-gray-300" />
                                    <span className="text-xs font-bold text-subspace-white">System Concept</span>
                                </div>
                                <p className="text-xs text-subspace-white/80 font-sans">
                                    A core node in the agent's latent space. High connectivity indicates this concept bridges multiple domains of knowledge.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Metadata / Actions */}
                    <div className="flex items-center justify-between border-t border-subspace-white/10 pt-2">
                        <div className="text-[9px] font-mono text-subspace-gray-400">
                            {activeNode.data?.timestamp || 'SYSTEM_INIT'}
                        </div>
                        {activeNode.type !== 'CONCEPT' && (
                            <button className="flex items-center gap-1 text-[10px] font-mono text-subspace-green hover:underline">
                                OPEN_ARTIFACT <ExternalLink size={10} />
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
      </div>
    </BrutalContainer>
  );
};
