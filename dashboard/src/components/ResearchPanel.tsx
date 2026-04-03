/**
 * ResearchPanel — Intelligence & Content Pipeline for the Substrate dashboard.
 *
 * Full pipeline: Research → Article → Social Posts
 * - Research: structured queries with real source URLs
 * - Articles: generate long-form content from research findings
 * - Social: format for LinkedIn, X, Instagram, Published Article
 * - Settings: edit all system prompts directly
 */
import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import {
  Loader2, Search, Plus, Trash2, ExternalLink, Download, ChevronLeft, ChevronRight,
  Newspaper, Bookmark, Sparkles, Globe, ArrowRight, RefreshCw, Image as ImageIcon, Tag,
  Copy, MessageSquare, FileText, Share2, Layers, Send, Hash, PenTool, Edit2, Check, Wand2, X,
} from 'lucide-react';
import type { ChatMsg } from '@/features/chat/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  label: string;
  keywords: string[];
  url?: string;
  color: string;
  active: boolean;
}

type FeedItemType = 'article' | 'brief' | 'slide' | 'research' | 'social';
type OutputFormat = 'linkedin' | 'x' | 'instagram' | 'article' | 'slides';

interface FeedItem {
  id: string;
  type: FeedItemType;
  title: string;
  summary: string;
  content?: string;
  sections?: SlideSection[];
  imageUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  sourceUrls?: { url: string; label: string }[];
  topics: string[];
  timestamp: number;
  saved?: boolean;
  pending?: boolean;
  parentId?: string;
  outputFormat?: OutputFormat;
  slideCount?: number;
}

type SlideLayout = 'default' | 'hero-stat' | 'two-column' | 'quote-highlight' | 'timeline' | 'big-number' | 'comparison' | 'key-takeaway';

interface SlideSection {
  heading: string;
  body: string;
  layout?: SlideLayout;
  layoutMeta?: {
    statValue?: string;
    statLabel?: string;
    leftColumn?: string;
    rightColumn?: string;
    quoteText?: string;
    quoteAttribution?: string;
    timelineItems?: { date: string; event: string }[];
    comparisonLeft?: { title: string; points: string[] };
    comparisonRight?: { title: string; points: string[] };
    takeaway?: string;
  };
}

type SlideKind = 'title' | 'section' | 'sources' | 'actions';

interface PresentationSlide {
  kind: SlideKind;
  feedItem: FeedItem;
  sectionIndex?: number;        // for 'section' slides
  slideNumber: number;          // 1-based
  totalSlides: number;
  slideTitle: string;            // contextual title like "THE OVERVIEW", "WHY IT MATTERS"
  followUpQuestions?: string[];  // only on actions slide
}

const SLIDE_ACCENT_COLORS = [
  { border: 'border-indigo-500/20', glow: '#818cf8', glow2: '#6366f1', bg: 'from-indigo-500/[0.06]', text: 'text-indigo-200', badge: 'bg-indigo-500/15 text-indigo-300/70 border-indigo-400/15' },
  { border: 'border-cyan-500/20', glow: '#22d3ee', glow2: '#06b6d4', bg: 'from-cyan-500/[0.06]', text: 'text-cyan-200', badge: 'bg-cyan-500/15 text-cyan-300/70 border-cyan-400/15' },
  { border: 'border-amber-500/20', glow: '#fbbf24', glow2: '#f59e0b', bg: 'from-amber-500/[0.06]', text: 'text-amber-200', badge: 'bg-amber-500/15 text-amber-300/70 border-amber-400/15' },
  { border: 'border-rose-500/20', glow: '#fb7185', glow2: '#e11d48', bg: 'from-rose-500/[0.06]', text: 'text-rose-200', badge: 'bg-rose-500/15 text-rose-300/70 border-rose-400/15' },
  { border: 'border-emerald-500/20', glow: '#34d399', glow2: '#059669', bg: 'from-emerald-500/[0.06]', text: 'text-emerald-200', badge: 'bg-emerald-500/15 text-emerald-300/70 border-emerald-400/15' },
  { border: 'border-violet-500/20', glow: '#a78bfa', glow2: '#7c3aed', bg: 'from-violet-500/[0.06]', text: 'text-violet-200', badge: 'bg-violet-500/15 text-violet-300/70 border-violet-400/15' },
];

/** Generate a short contextual title for a section heading (Wired IG carousel style) */
function contextualSectionTitle(heading: string): string {
  const h = heading.trim().toUpperCase();
  // If heading is already short and punchy (≤30 chars), use it directly
  if (h.length <= 30) return h;
  // Truncate long headings to first meaningful phrase
  const cut = h.slice(0, 28).replace(/\s+\S*$/, '');
  return cut + '…';
}

/** Explode a FeedItem into individual presentation slides */
function feedItemToSlides(item: FeedItem, followUpQuestions?: string[]): PresentationSlide[] {
  const deck: PresentationSlide[] = [];
  const sections = item.sections || [];
  const hasSources = (item.sourceUrls?.length ?? 0) > 0;

  // Total = title + sections + sources(if any) + actions
  const total = 1 + sections.length + (hasSources ? 1 : 0) + 1;

  // Title slide
  deck.push({ kind: 'title', feedItem: item, slideNumber: 1, totalSlides: total, slideTitle: 'THE OVERVIEW' });

  // Section slides — use section headings as contextual titles
  sections.forEach((s, idx) => {
    deck.push({ kind: 'section', feedItem: item, sectionIndex: idx, slideNumber: deck.length + 1, totalSlides: total, slideTitle: contextualSectionTitle(s.heading) });
  });

  // Sources slide
  if (hasSources) {
    deck.push({ kind: 'sources', feedItem: item, slideNumber: deck.length + 1, totalSlides: total, slideTitle: 'SOURCES & REFERENCES' });
  }

  // Actions slide (follow-up, generate)
  deck.push({ kind: 'actions', feedItem: item, slideNumber: deck.length + 1, totalSlides: total, slideTitle: "WHAT'S NEXT", followUpQuestions });

  return deck;
}

interface PromptTemplates {
  research: string;
  brief: string;
  article: string;
  linkedin: string;
  x: string;
  instagram: string;
  slides: string;
  followUp: string;
  slideDesigner: string;
  slideEdit: string;
}

interface ResearchPanelProps {
  onClose: () => void;
  onSendToAgent: (text: string) => void;
  chatMessages: ChatMsg[];
  isAgentGenerating: boolean;
  streamingText: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TOPIC_COLORS = [
  '#818cf8', '#fb7185', '#34d399', '#fbbf24', '#a78bfa',
  '#f472b6', '#22d3ee', '#f97316', '#84cc16', '#e879f9',
];

const DEFAULT_TOPICS: Topic[] = [
  { id: 't-ai', label: 'AI & Machine Learning', keywords: ['artificial intelligence', 'machine learning', 'LLM', 'neural network'], color: '#818cf8', active: true },
  { id: 't-tech', label: 'Tech Industry', keywords: ['technology', 'startup', 'silicon valley', 'software'], color: '#22d3ee', active: true },
  { id: 't-music', label: 'Music Production', keywords: ['music production', 'synthesizer', 'DAW', 'MIDI', 'audio'], color: '#f472b6', active: false },
];

const DUMMY_URL_PATTERNS = [
  'example.com', 'web_search_result', 'placeholder', 'dummy',
  'source1.com', 'source2.com', 'www.source', 'notarealurl',
];

function isRealUrl(url: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  return !DUMMY_URL_PATTERNS.some(p => lower.includes(p));
}

const DEFAULT_PROMPTS: PromptTemplates = {
  research: `You are a research analyst with access to web search. Research the following topic thoroughly using your search tools and return your findings as a JSON object with this exact structure:
{
  "title": "concise title",
  "summary": "2-3 sentence executive summary",
  "sections": [
    { "heading": "Section Title", "body": "structured body text (see formatting rules below)" }
  ],
  "sources": [
    { "url": "https://real-url-from-search-results.com/page", "label": "Source Name" }
  ],
  "keyTopics": ["topic1", "topic2"],
  "followUpQuestions": ["question 1?", "question 2?", "question 3?"]
}

Include 3-6 sections covering different angles. Be detailed and analytical.

SECTION BODY FORMATTING — use these conventions to create visually rich slides:
• Start each section with a 1-2 sentence overview paragraph.
• Use bullet points with **bold lead-ins**: "• **Key Point**: explanation of this point..."
• Include 1-2 stat callouts where relevant, on their own line: [STAT: 73% | of enterprises adopted AI in 2025]
  Format is [STAT: value | description]. Use real data from your research.
• Optionally include one pull quote on its own line: > "Notable quote or key takeaway statement"
• Separate distinct ideas with blank lines between paragraphs.
• Keep each section focused — one key idea or angle per section.

Example section body:
"The landscape shifted dramatically in Q1 2025 as major players consolidated their positions.\n\n[STAT: $4.2B | Total AI infrastructure investment in Q1 2025]\n\n• **Market Leaders**: NVIDIA maintained dominance with 78% GPU market share...\n• **Cloud Shift**: AWS and Azure both launched dedicated AI compute tiers...\n• **Open Source Surge**: Meta's Llama 3 drove a wave of enterprise adoption...\n\n> \"This is the fastest technology adoption curve we've seen since the smartphone\" — Industry Analyst\n\nLooking ahead, the competitive dynamics suggest further consolidation..."

CRITICAL: For sources, ONLY include real URLs that you found during your web search. Do NOT fabricate or hallucinate URLs. If you did not find a real source URL, omit the sources array entirely rather than making up fake URLs. Each source must be a real, working link.

Include 3 suggested follow-up questions that would deepen the research.

IMPORTANT: Return ONLY the JSON object, no markdown fences, no extra text.

Topic to research: "{{QUERY}}"`,

  brief: `You are an intelligence analyst with web search capabilities. Generate a daily intelligence brief as a JSON object with this exact structure:
{
  "title": "Daily Intelligence Brief — {{DATE}}",
  "summary": "Executive overview of today's key developments",
  "sections": [
    { "heading": "Headline or Topic", "body": "structured body text (see formatting rules below)" }
  ],
  "sources": [
    { "url": "https://real-url-from-search.com/article", "label": "Source Name" }
  ],
  "keyTopics": ["topic1", "topic2"],
  "followUpQuestions": ["question 1?", "question 2?"]
}

Cover these topics: {{TOPICS}}.
Include 4-6 sections, each covering a different headline or development.

SECTION BODY FORMATTING — use these conventions for each section body:
• Start with a 1-2 sentence overview paragraph.
• Use bullet points with **bold lead-ins**: "• **Key Point**: explanation..."
• Include stat callouts where relevant: [STAT: value | description]
• Optionally include a pull quote: > "Notable quote or key insight"
• Separate ideas with blank lines.

CRITICAL: Only include real URLs from your search results. Do NOT make up URLs.

IMPORTANT: Return ONLY the JSON object, no markdown fences, no extra text.`,

  article: `You are a professional writer. Using the research below, write a polished, publication-ready article.

Return as JSON:
{
  "title": "Article Title",
  "summary": "Article subtitle or deck",
  "sections": [
    { "heading": "Section", "body": "structured body (see formatting rules)" }
  ],
  "sources": [/* preserve real sources from original research */],
  "keyTopics": ["topic1"]
}

Write in a professional, engaging style. Use clear transitions between sections. Target {{WORD_COUNT}} words total.

SECTION BODY FORMATTING — use these conventions:
• Write rich prose paragraphs, separated by blank lines.
• Use bullet points with **bold lead-ins** for key arguments: "• **Key Point**: explanation..."
• Include stat callouts for important data: [STAT: value | description]
• Include pull quotes for impactful statements: > "Notable quote or insight"
• Mix prose paragraphs with structured elements for visual variety.

IMPORTANT: Return ONLY the JSON object.

Research to base article on:
{{RESEARCH}}`,

  linkedin: `You are a LinkedIn content strategist. Transform this research into {{COUNT}} engaging LinkedIn posts.

Return as JSON:
{
  "title": "LinkedIn Series: {{TOPIC}}",
  "summary": "Series overview",
  "sections": [
    { "heading": "Post 1: Hook Title", "body": "Full post text with line breaks, emojis where appropriate, hashtags at end. Optimize for LinkedIn engagement — use hooks, storytelling, clear takeaways. 150-300 words per post." }
  ],
  "sources": [/* preserve real sources */],
  "keyTopics": ["linkedin", "{{TOPIC}}"]
}

IMPORTANT: Return ONLY the JSON object.

Source research:
{{RESEARCH}}`,

  x: `You are a Twitter/X content strategist. Transform this research into {{COUNT}} tweet threads or standalone posts.

Return as JSON:
{
  "title": "X Thread: {{TOPIC}}",
  "summary": "Thread overview",
  "sections": [
    { "heading": "Tweet 1", "body": "Tweet text (max 280 chars). Use hooks, be punchy, controversial takes welcome." }
  ],
  "sources": [/* preserve real sources */],
  "keyTopics": ["twitter", "{{TOPIC}}"]
}

Each post should work standalone but flow as a thread. Include relevant hashtags.

IMPORTANT: Return ONLY the JSON object.

Source research:
{{RESEARCH}}`,

  instagram: `You are an Instagram content strategist. Transform this research into {{COUNT}} Instagram carousel slide sets.

Return as JSON:
{
  "title": "IG Carousel: {{TOPIC}}",
  "summary": "Carousel overview",
  "sections": [
    { "heading": "Slide 1: Hook", "body": "Slide text — punchy, visual-friendly, short paragraphs. Think infographic text." },
    { "heading": "Slide 2: Key Point", "body": "..." },
    { "heading": "Caption", "body": "Full Instagram caption with hashtags, CTA, and emoji." }
  ],
  "sources": [/* preserve real sources */],
  "keyTopics": ["instagram", "{{TOPIC}}"]
}

Design for visual impact — each slide should have a clear single idea. Last section is always the caption.

IMPORTANT: Return ONLY the JSON object.

Source research:
{{RESEARCH}}`,

  slides: `You are a presentation designer. Transform this research into a {{COUNT}}-slide presentation deck.

Return as JSON:
{
  "title": "{{TOPIC}}",
  "summary": "Presentation subtitle",
  "sections": [
    { "heading": "Slide 1: Title Slide", "body": "Subtitle or tagline" },
    { "heading": "Slide 2: The Problem", "body": "structured body (see formatting rules)" }
  ],
  "sources": [/* preserve real sources */],
  "keyTopics": ["presentation", "{{TOPIC}}"]
}

Each section = one slide. Design for visual impact — one key idea per slide.

SLIDE BODY FORMATTING — use these conventions:
• Start with a bold thesis sentence.
• Use bullet points with **bold lead-ins**: "• **Key Point**: explanation..."
• Include 1 stat callout per slide where data exists: [STAT: value | description]
• Optionally include a pull quote: > "Notable quote or insight"
• Keep text concise — slides should be scannable, not dense paragraphs.

IMPORTANT: Return ONLY the JSON object.

Source research:
{{RESEARCH}}`,

  followUp: `Based on the research context below, answer this follow-up question thoroughly.

Return as JSON:
{
  "title": "{{QUESTION}}",
  "summary": "Brief answer summary",
  "sections": [
    { "heading": "Section", "body": "structured body (see formatting rules)" }
  ],
  "sources": [/* include real URLs only */],
  "keyTopics": ["follow-up"],
  "followUpQuestions": ["next question 1?", "next question 2?"]
}

SECTION BODY FORMATTING — use these conventions:
• Start with a 1-2 sentence overview paragraph.
• Use bullet points with **bold lead-ins**: "• **Key Point**: explanation..."
• Include stat callouts where relevant: [STAT: value | description]
• Optionally include a pull quote: > "Notable quote or key insight"
• Separate ideas with blank lines.

CRITICAL: Only include real URLs from search results. Do NOT fabricate URLs.

IMPORTANT: Return ONLY the JSON object.

Original research context:
{{RESEARCH}}

Follow-up question: {{QUESTION}}`,

  slideDesigner: `You are a world-class presentation designer at a top-tier strategy consultancy (McKinsey, Bain, or IDEO caliber). Your job is to transform raw research into a visually stunning, executive-level slide deck that would be at home in a Fortune 500 boardroom or a TED talk.

Return as JSON:
{
  "title": "{{TOPIC}}",
  "summary": "A sharp, memorable subtitle — think tagline, not description",
  "sections": [
    {
      "heading": "Slide heading — short, punchy, max 8 words",
      "body": "structured body content (see formatting rules)",
      "layout": "one of: hero-stat | two-column | quote-highlight | timeline | big-number | comparison | key-takeaway | default",
      "layoutMeta": { /* layout-specific structured data — see below */ }
    }
  ],
  "sources": [/* preserve real source URLs */],
  "keyTopics": ["topic1", "topic2"],
  "followUpQuestions": ["question about the slides?", "want to adjust something?"]
}

DESIGN PRINCIPLES:
1. ONE idea per slide. No walls of text. If a slide has more than 3 bullet points, split it.
2. Lead with insight, not information. Every heading should be a conclusion, not a topic label.
   BAD: "Market Overview"  GOOD: "The Market Has Shifted Irreversibly"
3. Vary layouts across the deck for visual rhythm. Don't repeat the same layout twice in a row.
4. Use concrete numbers and data points wherever possible.
5. Create a narrative arc: hook → context → evidence → insight → implications → call to action.

LAYOUT TYPES & layoutMeta:

• "hero-stat" — One massive number + context sentence. Use for shocking/impressive data.
  layoutMeta: { "statValue": "73%", "statLabel": "of enterprises adopted AI in 2025" }

• "big-number" — Similar to hero-stat but for a single dramatic figure with minimal text.
  layoutMeta: { "statValue": "$4.2T", "statLabel": "projected market value by 2030" }

• "two-column" — Side-by-side comparison or contrasting points.
  layoutMeta: { "leftColumn": "Before: bullet points...", "rightColumn": "After: bullet points..." }

• "comparison" — Structured head-to-head with titled columns and point lists.
  layoutMeta: { "comparisonLeft": { "title": "Option A", "points": ["point 1", "point 2"] }, "comparisonRight": { "title": "Option B", "points": ["point 1", "point 2"] } }

• "quote-highlight" — A powerful quote as the centerpiece.
  layoutMeta: { "quoteText": "The best way to predict the future is to create it.", "quoteAttribution": "Peter Drucker" }

• "timeline" — Chronological events or milestones.
  layoutMeta: { "timelineItems": [{ "date": "2023", "event": "GPT-4 launched" }, { "date": "2024", "event": "Open source catches up" }] }

• "key-takeaway" — Final slide-style bold statement with supporting context.
  layoutMeta: { "takeaway": "The window of opportunity is 18 months." }

• "default" — Standard rich body content (bullets, stats, quotes mixed).

BODY FORMATTING (for all layouts, used as supporting content):
• Use bullet points with **bold lead-ins**: "• **Key Point**: explanation..."
• Include stat callouts: [STAT: value | description]
• Include pull quotes: > "Notable quote"
• Keep text scannable — no dense paragraphs on slides.

TARGET: {{COUNT}} slides total (excluding title and sources slides).
Mix at least 3 different layout types across the deck.

IMPORTANT: Return ONLY the JSON object, no markdown fences.

Source research:
{{RESEARCH}}`,

  slideEdit: `You are the same world-class presentation designer. The user wants to edit a specific slide in an existing deck.

Current slide:
- Heading: "{{SLIDE_HEADING}}"
- Layout: {{SLIDE_LAYOUT}}
- Body: {{SLIDE_BODY}}

Full deck context (for consistency):
{{DECK_CONTEXT}}

User's edit request: "{{EDIT_REQUEST}}"

Return the updated slide as a JSON object with this structure:
{
  "heading": "Updated heading",
  "body": "Updated body content",
  "layout": "layout type",
  "layoutMeta": { /* updated layout-specific data */ }
}

Maintain the same design quality standards. If the user asks to change the layout type, do so. If they ask for more/fewer bullets, data, quotes, etc., adjust accordingly. Keep it executive-level quality.

IMPORTANT: Return ONLY the JSON object for the single updated slide, no markdown fences.`,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function genId(): string {
  return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Try to parse JSON from agent response (handles markdown fences, leading text) */
function parseAgentJSON(text: string): Record<string, unknown> | null {
  // Strip markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Try direct parse
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Try to find JSON object in the text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* continue */ }
  }

  return null;
}

/** Serialize a FeedItem's content for use in prompts */
function feedItemToContext(item: FeedItem): string {
  let ctx = `Title: ${item.title}\nSummary: ${item.summary}\n`;
  if (item.sections) {
    for (const s of item.sections) ctx += `\n## ${s.heading}\n${s.body}\n`;
  } else if (item.content) {
    ctx += `\n${item.content}\n`;
  }
  if (item.sourceUrls?.length) {
    ctx += '\nSources:\n' + item.sourceUrls.map(s => `- ${s.label}: ${s.url}`).join('\n');
  }
  return ctx;
}

/** Build prompt from template with variable substitution */
function buildPrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return out;
}

/** Parse agent response text into a FeedItem — handles both JSON and freeform text */
function parseResponseToFeedItem(
  rawText: string,
  query: string,
  type: FeedItemType,
  extras?: Partial<FeedItem>,
): FeedItem & { followUpQuestions?: string[] } {
  const parsed = parseAgentJSON(rawText);

  if (parsed && parsed.title) {
    const sections: SlideSection[] = Array.isArray(parsed.sections)
      ? (parsed.sections as Array<{ heading?: string; body?: string; layout?: string; layoutMeta?: Record<string, unknown> }>)
          .filter(s => s.heading && s.body)
          .map(s => ({
            heading: String(s.heading),
            body: String(s.body),
            ...(s.layout ? { layout: s.layout as SlideLayout } : {}),
            ...(s.layoutMeta ? { layoutMeta: s.layoutMeta as SlideSection['layoutMeta'] } : {}),
          }))
      : [];

    // Filter out dummy/fabricated URLs
    const sources = Array.isArray(parsed.sources)
      ? (parsed.sources as Array<{ url?: string; label?: string }>)
          .filter(s => s.url && isRealUrl(String(s.url)))
          .map(s => ({ url: String(s.url), label: String(s.label || new URL(String(s.url)).hostname.replace('www.', '')) }))
      : [];

    const topics = Array.isArray(parsed.keyTopics)
      ? (parsed.keyTopics as string[]).slice(0, 5)
      : [query.toLowerCase()];

    const followUpQuestions = Array.isArray(parsed.followUpQuestions)
      ? (parsed.followUpQuestions as string[]).slice(0, 5)
      : undefined;

    return {
      id: genId(),
      type,
      title: String(parsed.title),
      summary: String(parsed.summary || ''),
      content: sections.map(s => `## ${s.heading}\n${s.body}`).join('\n\n'),
      sections,
      sourceUrls: sources.length > 0 ? sources : undefined,
      sourceUrl: sources[0]?.url,
      sourceName: sources[0]?.label,
      topics,
      timestamp: Date.now(),
      followUpQuestions,
      ...extras,
    };
  }

  // Fallback: parse freeform markdown text into sections
  const lines = rawText.split('\n');
  const sections: { heading: string; body: string }[] = [];
  let currentHeading = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentBody.length) {
        sections.push({ heading: currentHeading || 'Overview', body: currentBody.join('\n').trim() });
      }
      currentHeading = headingMatch[1];
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentHeading || currentBody.length) {
    sections.push({ heading: currentHeading || 'Overview', body: currentBody.join('\n').trim() });
  }

  // Extract real URLs from text
  const urlRegex = /https?:\/\/[^\s)>\]"']+/g;
  const foundUrls = [...new Set(rawText.match(urlRegex) || [])].filter(isRealUrl);
  const sourceUrls = foundUrls.slice(0, 8).map(url => {
    try { return { url, label: new URL(url).hostname.replace('www.', '') }; }
    catch { return { url, label: url.slice(0, 40) }; }
  });

  const summary = sections[0]?.body?.slice(0, 200) || rawText.slice(0, 200);

  return {
    id: genId(),
    type,
    title: query,
    summary: summary + (summary.length >= 200 ? '…' : ''),
    content: rawText,
    sections: sections.length > 0 ? sections : undefined,
    sourceUrls: sourceUrls.length > 0 ? sourceUrls : undefined,
    sourceUrl: sourceUrls[0]?.url,
    sourceName: sourceUrls[0]?.label,
    topics: [query.toLowerCase()],
    timestamp: Date.now(),
    ...extras,
  };
}

// ─── Output Format Config ────────────────────────────────────────────────────

const OUTPUT_FORMATS: { key: OutputFormat; label: string; icon: typeof Newspaper; defaultCount: number }[] = [
  { key: 'article', label: 'Article', icon: FileText, defaultCount: 1 },
  { key: 'linkedin', label: 'LinkedIn', icon: Share2, defaultCount: 3 },
  { key: 'x', label: 'X / Twitter', icon: Hash, defaultCount: 5 },
  { key: 'instagram', label: 'Instagram', icon: ImageIcon, defaultCount: 5 },
  { key: 'slides', label: 'Slide Deck', icon: Layers, defaultCount: 8 },
];

const PROMPT_LABELS: Record<keyof PromptTemplates, { label: string; desc: string }> = {
  research: { label: 'Research Query', desc: 'Variables: {{QUERY}}' },
  brief: { label: 'Daily Brief', desc: 'Variables: {{DATE}}, {{TOPICS}}' },
  followUp: { label: 'Follow-Up', desc: 'Variables: {{RESEARCH}}, {{QUESTION}}' },
  article: { label: 'Article', desc: 'Variables: {{RESEARCH}}, {{WORD_COUNT}}' },
  linkedin: { label: 'LinkedIn', desc: 'Variables: {{RESEARCH}}, {{TOPIC}}, {{COUNT}}' },
  x: { label: 'X / Twitter', desc: 'Variables: {{RESEARCH}}, {{TOPIC}}, {{COUNT}}' },
  instagram: { label: 'Instagram', desc: 'Variables: {{RESEARCH}}, {{TOPIC}}, {{COUNT}}' },
  slides: { label: 'Slide Deck', desc: 'Variables: {{RESEARCH}}, {{TOPIC}}, {{COUNT}}' },
  slideDesigner: { label: 'Slide Designer', desc: 'Variables: {{RESEARCH}}, {{TOPIC}}, {{COUNT}}' },
  slideEdit: { label: 'Slide Edit', desc: 'Variables: {{SLIDE_HEADING}}, {{SLIDE_LAYOUT}}, {{SLIDE_BODY}}, {{DECK_CONTEXT}}, {{EDIT_REQUEST}}' },
};

// ─── Component ──────────────────────────────────────────────────────────────

type PendingRequest = { query: string; type: FeedItemType; msgCount: number; parentId?: string; outputFormat?: OutputFormat; extras?: Partial<FeedItem> };

export function ResearchPanel({
  onClose: _onClose,
  onSendToAgent,
  chatMessages,
  isAgentGenerating,
  streamingText,
}: ResearchPanelProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setViewRaw] = useState<'feed' | 'topics' | 'research' | 'settings'>(() => {
    try { const v = localStorage.getItem('rp-view'); if (v === 'feed' || v === 'topics' || v === 'research' || v === 'settings') return v; } catch { /* ignore */ }
    return 'feed';
  });
  const setView = useCallback((v: 'feed' | 'topics' | 'research' | 'settings') => {
    setViewRaw(v);
    try { localStorage.setItem('rp-view', v); } catch { /* ignore */ }
  }, []);
  const [newTopic, setNewTopic] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [researchQuery, setResearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [prompts, setPrompts] = useState<PromptTemplates>({ ...DEFAULT_PROMPTS });
  const [followUpInputs, setFollowUpInputs] = useState<Record<string, string>>({});

  // Track pending research requests
  const pendingRef = useRef<PendingRequest | null>(null);
  const prevGeneratingRef = useRef(false);
  // Track per-slide edit targets for the Slide Designer
  const slideEditTargetRef = useRef<{ itemId: string; sectionIndex: number } | null>(null);

  // Load persisted data on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/local/research-topics').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/local/research-feed').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/local/research-prompts').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([topicsData, feedData, promptsData]) => {
      if (cancelled) return;
      const loadedTopics = topicsData?.topics?.length > 0 ? topicsData.topics : DEFAULT_TOPICS;
      setTopics(loadedTopics);
      setFeedItems(feedData?.items || []);
      if (promptsData?.prompts) setPrompts(prev => ({ ...prev, ...promptsData.prompts }));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ─── Watch for agent response completion ────────────────────────
  // Stash chatMessages ref so the retry can always read the latest
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  const consumePending = useCallback((pending: PendingRequest) => {
    const msgs = chatMessagesRef.current;
    const fromSlice = msgs.slice(pending.msgCount);
    const fromTail = msgs.slice(-10);
    const candidates = fromSlice.length > 0 ? fromSlice : fromTail;
    const lastAssistant = [...candidates].reverse().find(m => m.role === 'assistant');

    if (lastAssistant?.rawText) {
      // Handle per-slide edit — update just one section in an existing item
      const editTarget = slideEditTargetRef.current;
      if (editTarget) {
        slideEditTargetRef.current = null;
        const parsed = parseAgentJSON(lastAssistant.rawText);
        if (parsed && parsed.heading) {
          setFeedItems(prev => {
            const updated = prev.map(fi => {
              if (fi.id !== editTarget.itemId || !fi.sections) return fi;
              const newSections = [...fi.sections];
              newSections[editTarget.sectionIndex] = {
                heading: String(parsed.heading),
                body: String(parsed.body || ''),
                layout: (parsed.layout as SlideLayout) || newSections[editTarget.sectionIndex]?.layout,
                layoutMeta: parsed.layoutMeta as SlideSection['layoutMeta'] || newSections[editTarget.sectionIndex]?.layoutMeta,
              };
              return { ...fi, sections: newSections };
            }).filter(i => !(i.pending && i.title === pending.query));
            fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
            return updated;
          });
          return true;
        }
      }

      // Normal case — parse as full feed item
      const item = parseResponseToFeedItem(lastAssistant.rawText, pending.query, pending.type, {
        parentId: pending.parentId, outputFormat: pending.outputFormat, ...pending.extras,
      });
      setFeedItems(prev => {
        const without = prev.filter(i => !(i.pending && i.title === pending.query));
        const updated = [item, ...without];
        fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
        return updated;
      });
      setSelectedItemId(item.id);
      setSlideIndex(0);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const wasGenerating = prevGeneratingRef.current;
    prevGeneratingRef.current = isAgentGenerating;
    if (wasGenerating && !isAgentGenerating && pendingRef.current) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!consumePending(pending)) {
        const retryPending = { ...pending };
        setTimeout(() => { consumePending(retryPending); }, 500);
      }
    }
  }, [isAgentGenerating, chatMessages, consumePending]);

  // ─── Persistence ────────────────────────────────────────────────
  const saveTopics = useCallback(async (t: Topic[]) => {
    setTopics(t);
    try { await fetch('/api/local/research-topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topics: t }) }); } catch { /* */ }
  }, []);
  const saveFeed = useCallback(async (items: FeedItem[]) => {
    setFeedItems(items);
    try { await fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); } catch { /* */ }
  }, []);
  const savePrompts = useCallback(async (p: PromptTemplates) => {
    setPrompts(p);
    try { await fetch('/api/local/research-prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompts: p }) }); } catch { /* */ }
  }, []);

  // ─── Topic CRUD ─────────────────────────────────────────────────
  const addTopic = useCallback(() => {
    const label = newTopic.trim();
    if (!label) return;
    const keywords = label.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    saveTopics([...topics, { id: genId(), label: keywords[0].charAt(0).toUpperCase() + keywords[0].slice(1), keywords, url: newUrl.trim() || undefined, color: TOPIC_COLORS[topics.length % TOPIC_COLORS.length], active: true }]);
    setNewTopic(''); setNewUrl('');
  }, [newTopic, newUrl, topics, saveTopics]);
  const removeTopic = useCallback((id: string) => { saveTopics(topics.filter(t => t.id !== id)); }, [topics, saveTopics]);
  const toggleTopic = useCallback((id: string) => { saveTopics(topics.map(t => t.id === id ? { ...t, active: !t.active } : t)); }, [topics, saveTopics]);

  // ─── Core dispatch ──────────────────────────────────────────────
  const sendPipelineRequest = useCallback((opts: { prompt: string; query: string; type: FeedItemType; parentId?: string; outputFormat?: OutputFormat; extras?: Partial<FeedItem> }) => {
    if (pendingRef.current) return;
    pendingRef.current = { query: opts.query, type: opts.type, msgCount: chatMessages.length, parentId: opts.parentId, outputFormat: opts.outputFormat, extras: opts.extras };
    setFeedItems(prev => [{ id: genId(), type: opts.type, title: opts.query, summary: '', topics: [], timestamp: Date.now(), pending: true, parentId: opts.parentId, outputFormat: opts.outputFormat }, ...prev]);
    setView('research'); setSlideIndex(0);
    onSendToAgent('[RESEARCH_PIPELINE] ' + opts.prompt);
  }, [chatMessages.length, onSendToAgent]);

  // ─── Research ───────────────────────────────────────────────────
  const doResearch = useCallback((query: string) => {
    if (!query.trim()) return;
    sendPipelineRequest({ prompt: buildPrompt(prompts.research, { QUERY: query.trim() }), query: query.trim(), type: 'research' });
    setResearchQuery('');
  }, [prompts.research, sendPipelineRequest]);

  const requestBrief = useCallback(() => {
    // Check if a brief for today already exists
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const existingBrief = feedItems.find(item =>
      item.type === 'brief' && item.title.includes(todayStr) && !item.pending
    );
    if (existingBrief) {
      // Already have today's brief — just scroll to it / highlight it
      setActiveFilter(null);
      setView('feed');
      return;
    }
    const activeTopics = topics.filter(t => t.active).map(t => t.label).join(', ');
    const title = `Daily Brief — ${todayStr}`;
    sendPipelineRequest({ prompt: buildPrompt(prompts.brief, { DATE: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), TOPICS: activeTopics || 'technology, AI, business, science' }), query: title, type: 'brief' });
  }, [topics, feedItems, prompts.brief, sendPipelineRequest]);

  // ─── Follow-up ──────────────────────────────────────────────────
  const askFollowUp = useCallback((item: FeedItem, question: string) => {
    if (!question.trim()) return;
    sendPipelineRequest({ prompt: buildPrompt(prompts.followUp, { RESEARCH: feedItemToContext(item), QUESTION: question.trim() }), query: question.trim(), type: 'research', parentId: item.id });
    setFollowUpInputs(prev => ({ ...prev, [item.id]: '' }));
  }, [prompts.followUp, sendPipelineRequest]);

  // ─── Generate output from research ─────────────────────────────
  const generateOutput = useCallback((item: FeedItem, format: OutputFormat, count: number) => {
    const template = prompts[format];
    const prompt = buildPrompt(template, { RESEARCH: feedItemToContext(item), TOPIC: item.title, COUNT: String(count), WORD_COUNT: format === 'article' ? '1500' : '800' });
    const typeMap: Record<OutputFormat, FeedItemType> = { article: 'article', linkedin: 'social', x: 'social', instagram: 'social', slides: 'slide' };
    const label = format === 'article' ? 'Article' : format === 'slides' ? `${count}-Slide Deck` : `${count} ${format.charAt(0).toUpperCase() + format.slice(1)} Posts`;
    sendPipelineRequest({ prompt, query: `${label}: ${item.title}`, type: typeMap[format], parentId: item.id, outputFormat: format, extras: { slideCount: count } });
  }, [prompts, sendPipelineRequest]);

  // ─── Slide Designer Agent ───────────────────────────────────────
  const designSlides = useCallback((item: FeedItem, count: number = 8) => {
    const prompt = buildPrompt(prompts.slideDesigner, { RESEARCH: feedItemToContext(item), TOPIC: item.title, COUNT: String(count) });
    sendPipelineRequest({ prompt, query: `✦ Designed Deck: ${item.title}`, type: 'slide', parentId: item.id, outputFormat: 'slides', extras: { slideCount: count } });
  }, [prompts.slideDesigner, sendPipelineRequest]);

  const editSlide = useCallback((item: FeedItem, sectionIndex: number, editRequest: string) => {
    if (!editRequest.trim() || !item.sections?.[sectionIndex]) return;
    const section = item.sections[sectionIndex];
    const deckContext = item.sections.map((s, i) => `Slide ${i + 1} [${s.layout || 'default'}]: ${s.heading}`).join('\n');
    const prompt = buildPrompt(prompts.slideEdit, {
      SLIDE_HEADING: section.heading,
      SLIDE_LAYOUT: section.layout || 'default',
      SLIDE_BODY: section.body,
      DECK_CONTEXT: deckContext,
      EDIT_REQUEST: editRequest.trim(),
    });
    // Send as a pipeline request and handle the response specially
    if (pendingRef.current) return;
    pendingRef.current = {
      query: `Edit slide: ${section.heading}`,
      type: 'slide',
      msgCount: chatMessages.length,
      parentId: item.id,
      outputFormat: 'slides',
    };
    // We'll track which slide to update
    slideEditTargetRef.current = { itemId: item.id, sectionIndex };
    onSendToAgent('[RESEARCH_PIPELINE] ' + prompt);
  }, [prompts.slideEdit, chatMessages.length, onSendToAgent]);

  // ─── Other actions ──────────────────────────────────────────────
  const digDeeper = useCallback((item: FeedItem) => { doResearch(`Dig deeper into: ${item.title}. Expand on key findings and find additional sources.`); }, [doResearch]);
  const exportSlide = useCallback(async (el: HTMLElement | null) => {
    if (!el) return;
    try { const html2canvas = (await import('html2canvas')).default; const canvas = await html2canvas(el, { backgroundColor: null, scale: 2 }); const link = document.createElement('a'); link.download = `research-slide-${Date.now()}.png`; link.href = canvas.toDataURL('image/png'); link.click(); }
    catch { await navigator.clipboard.writeText(el.innerText).catch(() => {}); }
  }, []);
  const copyContent = useCallback(async (item: FeedItem) => { await navigator.clipboard.writeText(item.content || item.summary).catch(() => {}); }, []);
  const toggleSaved = useCallback((id: string) => { saveFeed(feedItems.map(i => i.id === id ? { ...i, saved: !i.saved } : i)); }, [feedItems, saveFeed]);
  const deleteFeedItem = useCallback((id: string) => { saveFeed(feedItems.filter(i => i.id !== id)); }, [feedItems, saveFeed]);
  const editFeedItem = useCallback((id: string, patch: Partial<FeedItem>) => {
    saveFeed(feedItems.map(i => i.id === id ? { ...i, ...patch } : i));
  }, [feedItems, saveFeed]);

  // ─── Derived ────────────────────────────────────────────────────
  const filteredItems = activeFilter ? feedItems.filter(item => item.topics.some(t => t.toLowerCase().includes(activeFilter.toLowerCase()))) : feedItems;
  const presentationSlides = useMemo(() => {
    const completed = filteredItems.filter(i => !i.pending);
    if (completed.length === 0) return [];
    // Use selected item if set, otherwise most recent
    const target = selectedItemId ? completed.find(i => i.id === selectedItemId) : completed[0];
    if (!target) return feedItemToSlides(completed[0]);
    const followUps = (target as FeedItem & { followUpQuestions?: string[] }).followUpQuestions;
    return feedItemToSlides(target, followUps);
  }, [filteredItems, selectedItemId]);

  const openSlideView = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    setSlideIndex(0);
    setView('research');
  }, [setView]);
  const isPending = !!pendingRef.current && isAgentGenerating;

  // ─── Contextual research suggestions ──────────────────────────
  const contextualSuggestions = useMemo(() => {
    const suggestions: { label: string; query: string; kind: 'deepen' | 'cross' | 'trend' | 'topic' }[] = [];
    const completed = feedItems.filter(i => !i.pending);
    const activeTopics = topics.filter(t => t.active);

    // Extract key themes from recent research
    const recentTitles = completed.slice(0, 5).map(i => i.title);
    const recentSections = completed.slice(0, 3).flatMap(i => (i.sections || []).map(s => s.heading));
    // 1. "Dig deeper" suggestions based on recent section headings
    for (const heading of recentSections.slice(0, 3)) {
      if (heading && heading.length > 3 && heading.length < 80) {
        suggestions.push({
          label: heading.length > 35 ? heading.slice(0, 32) + '…' : heading,
          query: `Expand on: ${heading}. Provide deeper analysis, latest developments, and expert perspectives.`,
          kind: 'deepen',
        });
      }
    }

    // 2. Cross-reference suggestions — find connections between different research items
    if (recentTitles.length >= 2) {
      const t1 = recentTitles[0], t2 = recentTitles[1];
      suggestions.push({
        label: `Connect: ${t1.slice(0, 18)}… + ${t2.slice(0, 18)}…`,
        query: `Analyze the intersection and connections between "${t1}" and "${t2}". How do these topics relate, influence, or contradict each other?`,
        kind: 'cross',
      });
    }

    // 3. Trend/future suggestions based on existing research
    if (completed.length > 0) {
      const latest = completed[0];
      suggestions.push({
        label: `Future of ${latest.title.slice(0, 28)}…`,
        query: `What are the emerging trends and future implications of "${latest.title}"? What should we watch for in the next 6-12 months?`,
        kind: 'trend',
      });
    }

    // 4. Fill in with user-defined topics that haven't been researched yet
    for (const t of activeTopics) {
      const alreadyResearched = completed.some(i =>
        i.title.toLowerCase().includes(t.label.toLowerCase()) ||
        i.topics.some(tp => tp.toLowerCase() === t.label.toLowerCase())
      );
      if (!alreadyResearched) {
        suggestions.push({
          label: t.label,
          query: `Research: ${t.label}. Provide a comprehensive overview with latest developments, key players, and emerging trends.`,
          kind: 'topic',
        });
      }
    }

    // 5. Remaining active topics as fallback
    for (const t of activeTopics) {
      if (!suggestions.some(s => s.label === t.label)) {
        suggestions.push({ label: t.label, query: t.label, kind: 'topic' });
      }
    }

    return suggestions.slice(0, 8);
  }, [feedItems, topics]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={20} className="text-white/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-1">
          {(['feed', 'topics', 'research', 'settings'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${view === v ? 'bg-white/[0.08] text-white/80 border border-white/[0.08]' : 'text-white/35 hover:text-white/55'}`}>
              {v === 'feed' ? 'Feed' : v === 'topics' ? 'Topics' : v === 'research' ? 'Research' : 'Prompts'}
            </button>
          ))}
        </div>
        {isPending && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] bg-indigo-500/15 text-indigo-300/70 border border-indigo-400/10">
            <Loader2 size={9} className="animate-spin" /> Working
          </span>
        )}
      </div>

      {/* ─── Feed View ──────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden ${view !== 'feed' ? 'hidden' : ''}`}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.03] shrink-0">
            <button onClick={requestBrief} disabled={isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/15 text-amber-300/80 text-[10px] font-medium hover:bg-amber-500/20 transition-all disabled:opacity-40">
              <Newspaper size={11} /> Daily Brief
            </button>
            <button onClick={() => setView('research')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/15 text-indigo-300/80 text-[10px] font-medium hover:bg-indigo-500/20 transition-all">
              <Search size={11} /> Research
            </button>
            <div className="flex-1 flex items-center gap-1 overflow-x-auto ml-1">
              {topics.filter(t => t.active).map(t => (
                <button key={t.id} onClick={() => setActiveFilter(activeFilter === t.label ? null : t.label)}
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-medium border transition-all ${activeFilter === t.label ? 'border-white/20 bg-white/[0.08] text-white/70' : 'border-white/[0.05] text-white/30 hover:text-white/50'}`}
                  style={{ borderColor: activeFilter === t.label ? t.color + '40' : undefined }}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredItems.length === 0 && !isPending ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/25">
                <Globe size={28} /><div className="text-xs">No intelligence yet</div>
                <div className="text-[10px]">Request a daily brief or start a research query</div>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {isPending && <StreamingCard query={pendingRef.current?.query || 'Working'} text={streamingText} />}
                {filteredItems.filter(i => !i.pending).map(item => (
                  <FeedCard key={item.id} item={item} onSave={() => toggleSaved(item.id)} onDelete={() => deleteFeedItem(item.id)}
                    onDigDeeper={() => digDeeper(item)} onExport={(el) => exportSlide(el)} onCopy={() => copyContent(item)}
                    onFollowUp={(q) => askFollowUp(item, q)} onGenerate={(fmt, c) => generateOutput(item, fmt, c)}
                    onOpenSlides={() => openSlideView(item.id)}
                    followUpValue={followUpInputs[item.id] || ''} onFollowUpChange={(v) => setFollowUpInputs(p => ({ ...p, [item.id]: v }))} isPending={isPending} />
                ))}
              </div>
            )}
          </div>
      </div>

      {/* ─── Topics View ────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden ${view !== 'topics' ? 'hidden' : ''}`}>
          <div className="px-4 py-3 border-b border-white/[0.04] space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
                <Tag size={11} className="text-white/25 shrink-0" />
                <input
                  value={newTopic}
                  onChange={e => setNewTopic(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTopic()}
                  placeholder="Topic or keywords (comma-separated)…"
                  className="flex-1 bg-transparent text-[11px] text-white/75 placeholder:text-white/20 outline-none"
                />
              </div>
              <button
                onClick={addTopic}
                disabled={!newTopic.trim()}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/15 border border-indigo-400/15 text-indigo-300/70 hover:bg-indigo-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus size={13} />
              </button>
            </div>
            <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
              <Globe size={11} className="text-white/25 shrink-0" />
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTopic()}
                placeholder="Optional: RSS feed or news URL…"
                className="flex-1 bg-transparent text-[11px] text-white/75 placeholder:text-white/20 outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {topics.map(topic => (
              <div
                key={topic.id}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                  topic.active
                    ? 'bg-white/[0.04] border-white/[0.06]'
                    : 'bg-white/[0.01] border-white/[0.03] opacity-50'
                }`}
              >
                <button
                  onClick={() => toggleTopic(topic.id)}
                  className="w-3 h-3 rounded-full border-2 shrink-0 transition-all"
                  style={{
                    borderColor: topic.color,
                    backgroundColor: topic.active ? topic.color : 'transparent',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-white/70 truncate">{topic.label}</div>
                  <div className="text-[9px] text-white/30 truncate">
                    {topic.keywords.join(', ')}
                    {topic.url && ` · ${topic.url}`}
                  </div>
                </div>
                <button
                  onClick={() => doResearch(topic.label)}
                  disabled={isPending}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white/20 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all disabled:opacity-30"
                  title="Research this topic"
                >
                  <Search size={11} />
                </button>
                <button
                  onClick={() => removeTopic(topic.id)}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {topics.length === 0 && (
              <div className="text-center text-white/20 text-xs py-8">Add topics to curate your intelligence feed</div>
            )}
          </div>
      </div>

      {/* ─── Research View (Gallery → Slide Carousel) ────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden ${view !== 'research' ? 'hidden' : ''}`}>
          {/* Search bar — always visible */}
          <div className="px-4 py-3 border-b border-white/[0.04] shrink-0">
            <div className="flex items-center gap-2">
              {selectedItemId && (
                <button onClick={() => { setSelectedItemId(null); setSlideIndex(0); }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] border border-white/[0.06] transition-all shrink-0" title="Back to gallery">
                  <ChevronLeft size={14} />
                </button>
              )}
              <div className="flex-1 flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-indigo-400/25 transition-all">
                <Search size={12} className="text-white/25 shrink-0" />
                <input value={researchQuery} onChange={e => setResearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doResearch(researchQuery); }}
                  placeholder="Research anything…" className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/20 outline-none" disabled={isPending} />
              </div>
              <button onClick={() => doResearch(researchQuery)} disabled={!researchQuery.trim() || isPending}
                className="px-4 py-2 rounded-xl bg-indigo-500/15 border border-indigo-400/15 text-indigo-300/80 text-[11px] font-medium hover:bg-indigo-500/25 transition-all disabled:opacity-30">
                {isPending ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
              </button>
            </div>
            {!selectedItemId && contextualSuggestions.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {contextualSuggestions.map((s, i) => {
                  const kindStyles: Record<string, string> = {
                    deepen: 'border-indigo-400/15 text-indigo-300/50 hover:text-indigo-300/80 hover:bg-indigo-500/10',
                    cross: 'border-cyan-400/15 text-cyan-300/50 hover:text-cyan-300/80 hover:bg-cyan-500/10',
                    trend: 'border-amber-400/15 text-amber-300/50 hover:text-amber-300/80 hover:bg-amber-500/10',
                    topic: 'border-white/[0.05] text-white/35 hover:text-white/60 hover:bg-white/[0.04]',
                  };
                  const kindPrefix: Record<string, string> = { deepen: '↓ ', cross: '⇄ ', trend: '→ ', topic: '' };
                  return (
                    <button key={i} onClick={() => doResearch(s.query)} disabled={isPending}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-medium border transition-all disabled:opacity-30 ${kindStyles[s.kind]}`}>
                      {kindPrefix[s.kind]}{s.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Streaming indicator */}
          {isPending && <div className="px-4 py-3 border-b border-white/[0.04] shrink-0"><StreamingCard query={pendingRef.current?.query || 'Working'} text={streamingText} /></div>}

          {/* ── Level 1: Gallery of all items ──────────────── */}
          {!selectedItemId && (
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const completed = filteredItems.filter(i => !i.pending);
                if (completed.length === 0 && !isPending) {
                  return (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/25 h-full min-h-[200px]">
                      <Sparkles size={28} /><div className="text-xs">Enter a query to start researching</div>
                      <div className="text-[10px]">Results appear as browsable slide decks</div>
                    </div>
                  );
                }
                const typeIcons: Record<FeedItemType, ReactNode> = {
                  article: <Newspaper size={12} className="text-cyan-400/70" />,
                  brief: <Sparkles size={12} className="text-amber-400/70" />,
                  slide: <Layers size={12} className="text-pink-400/70" />,
                  research: <Search size={12} className="text-indigo-400/70" />,
                  social: <Share2 size={12} className="text-green-400/70" />,
                };
                const typeBg: Record<FeedItemType, string> = {
                  article: 'bg-cyan-500/10 border-cyan-500/15',
                  brief: 'bg-amber-500/10 border-amber-500/15',
                  slide: 'bg-pink-500/10 border-pink-500/15',
                  research: 'bg-indigo-500/10 border-indigo-500/15',
                  social: 'bg-green-500/10 border-green-500/15',
                };
                return (
                  <div className="p-3 grid grid-cols-2 gap-2.5">
                    {completed.map(item => {
                      const sectionCount = item.sections?.length ?? 0;
                      const slideCount = sectionCount + 2; // title + sections + sources/actions
                      const accentIdx = completed.indexOf(item) % SLIDE_ACCENT_COLORS.length;
                      const accent = SLIDE_ACCENT_COLORS[accentIdx];
                      return (
                        <div key={item.id} onClick={() => { setSelectedItemId(item.id); setSlideIndex(0); }}
                          className={`group relative text-left rounded-xl border ${accent.border} bg-gradient-to-br ${accent.bg} to-white/[0.01] p-3.5 hover:border-white/20 hover:scale-[1.02] transition-all duration-200 overflow-hidden cursor-pointer`}>
                          {/* Corner glow */}
                          <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full opacity-[0.06] pointer-events-none"
                            style={{ background: `radial-gradient(circle, ${accent.glow}, transparent)` }} />
                          {/* Delete button */}
                          <button onClick={(e) => { e.stopPropagation(); deleteFeedItem(item.id); }}
                            className="absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center text-white/0 group-hover:text-white/25 hover:!text-red-400/70 hover:!bg-red-500/10 transition-all z-10" title="Delete">
                            <Trash2 size={9} />
                          </button>
                          {/* Type badge */}
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${typeBg[item.type]}`}>{typeIcons[item.type]}</span>
                            <span className="text-[8px] text-white/25 uppercase tracking-wider font-semibold">{item.type}</span>
                            {item.saved && <Bookmark size={8} className="text-amber-400/60 ml-auto" />}
                          </div>
                          {/* Title */}
                          <h4 className="text-[11px] font-bold text-white/80 leading-snug mb-1 line-clamp-2 group-hover:text-white/95 transition-colors">{item.title}</h4>
                          {/* Summary preview */}
                          <p className="text-[9px] text-white/30 leading-relaxed line-clamp-2 mb-2">{item.summary}</p>
                          {/* Footer meta */}
                          <div className="flex items-center gap-2 mt-auto">
                            {sectionCount > 0 && (
                              <span className="flex items-center gap-1 text-[8px] text-white/20"><Layers size={8} /> {slideCount} slides</span>
                            )}
                            {item.sourceUrls && item.sourceUrls.length > 0 && (
                              <span className="flex items-center gap-1 text-[8px] text-white/20"><ExternalLink size={7} /> {item.sourceUrls.length}</span>
                            )}
                            <span className="text-[8px] text-white/15 ml-auto">{timeAgo(item.timestamp)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Level 2: Slide carousel for selected item ── */}
          {selectedItemId && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {presentationSlides.length > 0 ? (
                <>
                  {/* Carousel nav */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.03] shrink-0">
                    <button onClick={() => setSlideIndex(Math.max(0, slideIndex - 1))} disabled={slideIndex === 0}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all disabled:opacity-20"><ChevronLeft size={14} /></button>
                    <div className="flex flex-col items-center gap-0.5">
                      {presentationSlides[slideIndex] && (
                        <span className="text-[9px] text-white/50 font-bold uppercase tracking-widest leading-none">{presentationSlides[slideIndex].slideTitle}</span>
                      )}
                      <span className="text-[8px] text-white/20 font-mono">{slideIndex + 1} / {presentationSlides.length}</span>
                    </div>
                    <button onClick={() => setSlideIndex(Math.min(presentationSlides.length - 1, slideIndex + 1))} disabled={slideIndex >= presentationSlides.length - 1}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all disabled:opacity-20"><ChevronRight size={14} /></button>
                  </div>
                  {/* Slide progress dots */}
                  <div className="flex items-center justify-center gap-1 py-1.5 shrink-0">
                    {presentationSlides.map((_, i) => (
                      <button key={i} onClick={() => setSlideIndex(i)}
                        className={`rounded-full transition-all ${i === slideIndex ? 'w-4 h-1.5 bg-indigo-400/60' : 'w-1.5 h-1.5 bg-white/15 hover:bg-white/30'}`} />
                    ))}
                  </div>
                  {/* Active slide */}
                  <div className="flex-1 overflow-y-auto p-4" ref={slideRef}>
                    {presentationSlides[slideIndex] && (
                      <SlideCard slide={presentationSlides[slideIndex]}
                        onExport={() => exportSlide(slideRef.current)}
                        onDigDeeper={() => digDeeper(presentationSlides[slideIndex].feedItem)}
                        onSave={() => toggleSaved(presentationSlides[slideIndex].feedItem.id)}
                        onCopy={() => copyContent(presentationSlides[slideIndex].feedItem)}
                        onFollowUp={(q: string) => askFollowUp(presentationSlides[slideIndex].feedItem, q)}
                        onGenerate={(f: OutputFormat, c: number) => generateOutput(presentationSlides[slideIndex].feedItem, f, c)}
                        onEditItem={(patch: Partial<FeedItem>) => editFeedItem(presentationSlides[slideIndex].feedItem.id, patch)}
                        onDesignSlides={(count?: number) => designSlides(presentationSlides[slideIndex].feedItem, count)}
                        onEditSlide={(si: number, req: string) => editSlide(presentationSlides[slideIndex].feedItem, si, req)}
                        isPending={isPending} />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/25">
                  <Sparkles size={28} /><div className="text-xs">No slides for this item</div>
                </div>
              )}
            </div>
          )}
      </div>

      {/* ─── Settings / Prompts View ───────────────────────────────── */}
      <div className={view !== 'settings' ? 'hidden' : 'flex-1 overflow-hidden'}>
        <PromptSettings prompts={prompts} onSave={savePrompts} />
      </div>
    </div>
  );
}

// ─── Streaming Card ──────────────────────────────────────────────────────────

function StreamingCard({ query, text }: { query: string; text: string }) {
  return (
    <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Loader2 size={10} className="text-indigo-400 animate-spin" />
        <span className="text-[10px] font-semibold text-indigo-300/70">{query}</span>
      </div>
      <div className="text-[10px] text-white/40 leading-relaxed max-h-32 overflow-hidden">
        {text ? (<>{text.slice(0, 500)}{text.length > 500 && '…'}<span className="inline-block w-1 h-3 bg-indigo-400/50 ml-0.5 animate-pulse rounded-sm" /></>) : (
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/40 animate-bounce [animation-delay:0ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/40 animate-bounce [animation-delay:150ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/40 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Feed Card Component ────────────────────────────────────────────────────

interface FeedCardProps {
  item: FeedItem;
  onSave: () => void;
  onDelete: () => void;
  onDigDeeper: () => void;
  onExport: (el: HTMLElement | null) => void;
  onCopy: () => void;
  onFollowUp: (question: string) => void;
  onGenerate: (format: OutputFormat, count: number) => void;
  onOpenSlides: () => void;
  followUpValue: string;
  onFollowUpChange: (val: string) => void;
  isPending: boolean;
}

function FeedCard({ item, onSave, onDelete, onDigDeeper, onExport, onCopy, onFollowUp, onGenerate, onOpenSlides, followUpValue, onFollowUpChange, isPending }: FeedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [showPipeline, setShowPipeline] = useState(false);
  const [outputCounts, setOutputCounts] = useState<Record<OutputFormat, number>>({ article: 1, linkedin: 3, x: 5, instagram: 5, slides: 8 });

  const typeIcon: Record<FeedItemType, ReactNode> = {
    article: <Newspaper size={10} className="text-cyan-400/70" />,
    brief: <Sparkles size={10} className="text-amber-400/70" />,
    slide: <Layers size={10} className="text-pink-400/70" />,
    research: <Search size={10} className="text-indigo-400/70" />,
    social: <Share2 size={10} className="text-green-400/70" />,
  };
  const typeBg: Record<FeedItemType, string> = {
    article: 'border-cyan-500/10 hover:border-cyan-500/20',
    brief: 'border-amber-500/10 hover:border-amber-500/20',
    slide: 'border-pink-500/10 hover:border-pink-500/20',
    research: 'border-indigo-500/10 hover:border-indigo-500/20',
    social: 'border-green-500/10 hover:border-green-500/20',
  };
  const followUpQuestions = (item as FeedItem & { followUpQuestions?: string[] }).followUpQuestions;

  return (
    <div ref={cardRef} className={`relative rounded-xl border bg-white/[0.02] p-3 transition-all duration-200 hover:bg-white/[0.04] hover:shadow-lg group ${typeBg[item.type]}`}>
      <div className="flex items-start gap-2 mb-1.5">
        <div className="mt-0.5">{typeIcon[item.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-white/75 leading-tight">{item.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-white/25">{timeAgo(item.timestamp)}</span>
            {item.outputFormat && <span className="text-[8px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40 uppercase">{item.outputFormat}</span>}
            {item.sections && <span className="text-[9px] text-white/15">{item.sections.length} sections</span>}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-white/50 leading-relaxed mb-1.5">{item.summary}</div>
      {item.sections && item.sections.length > 0 && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[9px] text-indigo-300/50 hover:text-indigo-300/80 transition-colors mb-1">
            {expanded ? '▾ Collapse' : `▸ ${item.sections.length} sections`}
          </button>
          {expanded && (<div className="space-y-2 mt-1.5">{item.sections.map((s, i) => (
            <div key={i} className="pl-2 border-l border-white/[0.06]">
              <div className="text-[9px] font-semibold text-white/50 mb-0.5">{s.heading}</div>
              <div className="text-[9px] text-white/35 leading-relaxed line-clamp-4">{s.body}</div>
            </div>
          ))}</div>)}
        </>
      )}
      {item.sourceUrls && item.sourceUrls.length > 0 && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {item.sourceUrls.slice(0, 4).map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[8px] text-cyan-300/40 hover:text-cyan-300/70 flex items-center gap-0.5 transition-colors">
              <ExternalLink size={7} /> {s.label}
            </a>
          ))}
        </div>
      )}
      {item.topics.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {item.topics.slice(0, 5).map((t, i) => (<span key={i} className="px-1.5 py-0.5 rounded text-[8px] bg-white/[0.04] text-white/25 border border-white/[0.04]">{t}</span>))}
        </div>
      )}
      {/* Suggested follow-up questions */}
      {followUpQuestions && followUpQuestions.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[8px] text-white/25 uppercase tracking-wider font-semibold">Follow up</div>
          {followUpQuestions.map((q, i) => (
            <button key={i} onClick={() => !isPending && onFollowUp(q)} disabled={isPending}
              className="block w-full text-left text-[9px] text-indigo-300/50 hover:text-indigo-300/80 hover:bg-indigo-500/5 rounded px-2 py-1 transition-all disabled:opacity-30">→ {q}</button>
          ))}
        </div>
      )}
      {/* Follow-up input */}
      <div className="flex items-center gap-1.5 mt-2">
        <div className="flex-1 flex items-center gap-1 bg-white/[0.03] border border-white/[0.05] rounded-lg px-2 py-1">
          <MessageSquare size={9} className="text-white/20 shrink-0" />
          <input value={followUpValue} onChange={e => onFollowUpChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onFollowUp(followUpValue); }}
            placeholder="Ask a follow-up…" disabled={isPending}
            className="flex-1 bg-transparent text-[9px] text-white/60 placeholder:text-white/15 outline-none disabled:opacity-40" />
        </div>
        <button onClick={() => onFollowUp(followUpValue)} disabled={!followUpValue.trim() || isPending}
          className="w-6 h-6 rounded-md flex items-center justify-center text-indigo-300/50 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all disabled:opacity-20"><Send size={9} /></button>
      </div>
      {/* Actions */}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onOpenSlides} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-pink-300/60 hover:text-pink-300 hover:bg-pink-500/10 transition-all"><Layers size={9} /> Slides</button>
        <button onClick={onDigDeeper} disabled={isPending} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-indigo-300/60 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all disabled:opacity-30"><RefreshCw size={9} /> Dig deeper</button>
        <button onClick={() => setShowPipeline(!showPipeline)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-purple-300/60 hover:text-purple-300 hover:bg-purple-500/10 transition-all"><PenTool size={9} /> Create</button>
        <button onClick={onCopy} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all"><Copy size={9} /></button>
        <button onClick={onSave} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] transition-all ${item.saved ? 'text-amber-300' : 'text-white/25 hover:text-amber-300/60'}`}><Bookmark size={9} /></button>
        <button onClick={() => onExport(cardRef.current)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-white/25 hover:text-green-300/60 hover:bg-green-500/10 transition-all"><Download size={9} /></button>
        <button onClick={onDelete} className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-white/15 hover:text-red-400/60 hover:bg-red-500/10 transition-all ml-auto"><Trash2 size={9} /></button>
      </div>
      {/* Pipeline — generate outputs */}
      {showPipeline && (
        <div className="mt-2 p-2.5 rounded-lg border border-purple-500/10 bg-purple-500/[0.03] space-y-2">
          <div className="text-[9px] font-semibold text-purple-300/60 uppercase tracking-wider">Generate from this research</div>
          {OUTPUT_FORMATS.map(fmt => (
            <div key={fmt.key} className="flex items-center gap-2">
              <fmt.icon size={10} className="text-white/30 shrink-0" />
              <span className="text-[9px] text-white/50 w-16">{fmt.label}</span>
              <input type="number" min={1} max={30} value={outputCounts[fmt.key]}
                onChange={e => setOutputCounts(prev => ({ ...prev, [fmt.key]: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-12 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[9px] text-white/60 text-center outline-none" />
              <span className="text-[8px] text-white/25">{fmt.key === 'article' ? 'article' : fmt.key === 'slides' ? 'slides' : 'posts'}</span>
              <button onClick={() => { onGenerate(fmt.key, outputCounts[fmt.key]); setShowPipeline(false); }} disabled={isPending}
                className="ml-auto px-2.5 py-1 rounded-md text-[9px] font-medium bg-purple-500/15 text-purple-300/70 hover:bg-purple-500/25 transition-all disabled:opacity-30">Generate</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rich Slide Body Renderer ────────────────────────────────────────────────

/** Parse a section body string into structured visual blocks */
type BodyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'stat'; value: string; description: string }
  | { type: 'quote'; text: string }
  | { type: 'bullet'; lead: string; text: string }
  | { type: 'bullet-plain'; text: string };

function parseBodyBlocks(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  const lines = body.split('\n');
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    const text = currentParagraph.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    currentParagraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Empty line → flush paragraph
    if (!line) { flushParagraph(); continue; }

    // Stat callout: [STAT: value | description]
    const statMatch = line.match(/^\[STAT:\s*(.+?)\s*\|\s*(.+?)\]$/);
    if (statMatch) { flushParagraph(); blocks.push({ type: 'stat', value: statMatch[1], description: statMatch[2] }); continue; }

    // Pull quote: > "text" or > text
    const quoteMatch = line.match(/^>\s*"?(.+?)"?\s*$/);
    if (quoteMatch && line.startsWith('>')) { flushParagraph(); blocks.push({ type: 'quote', text: quoteMatch[1] }); continue; }

    // Bullet with bold lead: • **Lead**: text  or  - **Lead**: text
    const bulletBoldMatch = line.match(/^[•\-\*]\s*\*\*(.+?)\*\*:?\s*(.*)/);
    if (bulletBoldMatch) { flushParagraph(); blocks.push({ type: 'bullet', lead: bulletBoldMatch[1], text: bulletBoldMatch[2] }); continue; }

    // Plain bullet: • text or - text
    const bulletPlainMatch = line.match(/^[•\-\*]\s+(.+)/);
    if (bulletPlainMatch) { flushParagraph(); blocks.push({ type: 'bullet-plain', text: bulletPlainMatch[1] }); continue; }

    // Regular text → accumulate into paragraph
    currentParagraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Render inline bold (**text**) within a string */
function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="text-white/75 font-semibold">{part}</strong>
      : <span key={i}>{part}</span>
  );
}

function RichSlideBody({ body, accentColor }: { body: string; accentColor: string }) {
  const blocks = parseBodyBlocks(body);

  // Fallback: if parsing produced nothing meaningful, just render as plain text
  if (blocks.length === 0) {
    return <div className="text-[11px] text-white/50 leading-[1.8] whitespace-pre-wrap">{body}</div>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'stat':
            return (
              <div key={i} className="flex items-center gap-4 py-3.5 px-4 rounded-xl relative overflow-hidden"
                style={{ backgroundColor: `${accentColor}04`, border: `1px solid ${accentColor}0a`, boxShadow: `inset 0 1px 0 ${accentColor}06` }}>
                {/* Stat value with gradient */}
                <div className="flex-shrink-0 relative">
                  <div className="text-[22px] font-black tracking-[-0.03em] leading-none bg-clip-text text-transparent"
                    style={{ backgroundImage: `linear-gradient(150deg, ${accentColor}ee, ${accentColor}65)` }}>
                    {block.value}
                  </div>
                  <div className="absolute -inset-4 rounded-full opacity-[0.04] blur-xl pointer-events-none" style={{ backgroundColor: accentColor }} />
                </div>
                {/* Gradient divider */}
                <div className="h-8 w-px rounded-full flex-shrink-0" style={{ background: `linear-gradient(180deg, ${accentColor}22, ${accentColor}06)` }} />
                <div className="text-[10.5px] text-white/38 leading-[1.65] font-light">{block.description}</div>
                {/* Corner accent glow */}
                <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full opacity-[0.025] pointer-events-none" style={{ backgroundColor: accentColor }} />
              </div>
            );

          case 'quote':
            return (
              <div key={i} className="relative py-3 my-0.5 ml-1 rounded-r-lg" style={{ paddingLeft: '20px', backgroundColor: `${accentColor}02` }}>
                {/* Gradient left border — wider and more vivid */}
                <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
                  style={{ background: `linear-gradient(180deg, ${accentColor}50, ${accentColor}18, ${accentColor}04)` }} />
                {/* Tiny decorative quote mark */}
                <div className="text-[22px] leading-none font-serif -mb-3 select-none" style={{ color: `${accentColor}14` }}>“</div>
                <div className="text-[11px] text-white/42 italic leading-[1.9] font-light">{renderInlineBold(block.text)}</div>
              </div>
            );

          case 'bullet':
            return (
              <div key={i} className="flex items-start gap-2.5 pl-0.5">
                <div className="w-[4px] h-[4px] rounded-full mt-[7px] flex-shrink-0"
                  style={{ backgroundColor: `${accentColor}38`, boxShadow: `0 0 5px ${accentColor}0a` }} />
                <div className="text-[10.5px] text-white/40 leading-[1.7]">
                  <span className="font-semibold text-white/65">{block.lead}</span>
                  {block.text && <span className="text-white/35">: {renderInlineBold(block.text)}</span>}
                </div>
              </div>
            );

          case 'bullet-plain':
            return (
              <div key={i} className="flex items-start gap-2.5 pl-0.5">
                <div className="w-[3px] h-[3px] rounded-full mt-[7px] flex-shrink-0 bg-white/12" />
                <div className="text-[10.5px] text-white/40 leading-[1.7]">{renderInlineBold(block.text)}</div>
              </div>
            );

          case 'paragraph':
            return (
              <p key={i} className="text-[11px] text-white/38 leading-[1.9] font-light">{renderInlineBold(block.text)}</p>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

// ─── Premium Layout Renderers ─────────────────────────────────────────────────

function LayoutHeroStat({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center gap-5 py-2 relative">
      {/* Background radial glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-72 h-40 rounded-full" style={{ background: `radial-gradient(ellipse, ${accentColor}06 0%, transparent 65%)` }} />
      </div>
      {/* Massive stat with gradient text + layered glow */}
      <div className="relative z-10">
        <div className="text-[52px] font-black tracking-[-0.04em] leading-none bg-clip-text text-transparent"
          style={{ backgroundImage: `linear-gradient(150deg, ${accentColor}ee, ${accentColor}80, ${accentColor}50)` }}>
          {meta?.statValue || '\u2014'}
        </div>
        {/* Layered glow rings */}
        <div className="absolute -inset-6 rounded-full opacity-[0.05] blur-2xl pointer-events-none" style={{ backgroundColor: accentColor }} />
        <div className="absolute -inset-14 rounded-full opacity-[0.025] blur-3xl pointer-events-none" style={{ backgroundColor: accentColor }} />
      </div>
      {/* Accent divider — triple-layer glow */}
      <div className="relative z-10">
        <div className="w-10 h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}45, transparent)` }} />
        <div className="absolute -inset-1 rounded-full opacity-20 blur-sm" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />
      </div>
      {/* Label */}
      <div className="text-[13px] text-white/40 leading-[1.65] max-w-[80%] font-light tracking-wide z-10">
        {meta?.statLabel || section.body}
      </div>
      {/* Supporting body */}
      {section.body && meta?.statLabel && (
        <div className="mt-1 max-w-[85%] z-10">
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
}

function LayoutBigNumber({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center gap-5 py-2 relative">
      {/* Background radial glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-80 h-44 rounded-full" style={{ background: `radial-gradient(ellipse, ${accentColor}05 0%, transparent 60%)` }} />
      </div>
      <div className="relative z-10">
        <div className="text-[64px] font-black tracking-[-0.05em] leading-none bg-clip-text text-transparent"
          style={{ backgroundImage: `linear-gradient(155deg, ${accentColor}ee, ${accentColor}65, ${accentColor}35)` }}>
          {meta?.statValue || '\u2014'}
        </div>
        {/* Triple-layer glow */}
        <div className="absolute -inset-5 rounded-full opacity-[0.06] blur-xl pointer-events-none" style={{ backgroundColor: accentColor }} />
        <div className="absolute -inset-12 rounded-full opacity-[0.03] blur-2xl pointer-events-none" style={{ backgroundColor: accentColor }} />
        <div className="absolute -inset-20 rounded-full opacity-[0.015] blur-3xl pointer-events-none" style={{ backgroundColor: accentColor }} />
      </div>
      {meta?.statLabel && (
        <>
          <div className="w-8 h-px rounded-full z-10" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}35, transparent)` }} />
          <div className="text-[13px] text-white/35 font-light max-w-[75%] tracking-wide leading-[1.55] z-10">
            {meta.statLabel}
          </div>
        </>
      )}
    </div>
  );
}

function LayoutTwoColumn({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col flex-1 gap-3">
      <div className="grid grid-cols-2 gap-3 flex-1">
        {/* Left column — accent-tinted */}
        <div className="rounded-xl p-4 relative overflow-hidden"
          style={{ backgroundColor: `${accentColor}05`, border: `1px solid ${accentColor}0c` }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: `${accentColor}50` }} />
            <div className="w-6 h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, ${accentColor}50, ${accentColor}15)` }} />
          </div>
          <RichSlideBody body={meta?.leftColumn || ''} accentColor={accentColor} />
          <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full opacity-[0.03] pointer-events-none" style={{ backgroundColor: accentColor }} />
        </div>
        {/* Right column — neutral */}
        <div className="rounded-xl bg-white/[0.015] p-4 relative overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-white/15" />
            <div className="w-6 h-[1.5px] rounded-full bg-white/[0.06]" />
          </div>
          <RichSlideBody body={meta?.rightColumn || ''} accentColor={accentColor} />
        </div>
      </div>
      {/* Supporting body below columns */}
      {section.body && !meta?.leftColumn && (
        <RichSlideBody body={section.body} accentColor={accentColor} />
      )}
    </div>
  );
}

function LayoutComparison({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  const left = meta?.comparisonLeft;
  const right = meta?.comparisonRight;
  return (
    <div className="flex flex-col flex-1 gap-2">
      <div className="grid grid-cols-2 gap-3 flex-1 relative">
        {/* VS badge — centered between columns with glow */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="relative">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[7px] font-black uppercase tracking-widest"
              style={{ backgroundColor: `${accentColor}12`, color: `${accentColor}70`, border: `1px solid ${accentColor}18` }}>
              vs
            </div>
            <div className="absolute -inset-2 rounded-full opacity-[0.06] blur-md pointer-events-none" style={{ backgroundColor: accentColor }} />
          </div>
        </div>
        {/* Left — accent-tinted */}
        <div className="rounded-xl p-4 relative overflow-hidden"
          style={{ backgroundColor: `${accentColor}05`, border: `1px solid ${accentColor}0c` }}>
          <div className="text-[10px] font-bold mb-3 pb-2 flex items-center gap-2" style={{ borderBottom: `1px solid ${accentColor}10` }}>
            <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: `${accentColor}90`, boxShadow: `0 0 6px ${accentColor}25` }} />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}dd, ${accentColor}80)` }}>
              {left?.title || 'Option A'}
            </span>
          </div>
          <div className="space-y-2.5">
            {left?.points?.map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-[3px] h-[3px] rounded-full mt-[7px] shrink-0" style={{ backgroundColor: `${accentColor}45` }} />
                <span className="text-[10px] text-white/42 leading-[1.65]">{renderInlineBold(p)}</span>
              </div>
            ))}
          </div>
          <div className="absolute -bottom-6 -left-6 w-16 h-16 rounded-full opacity-[0.03] pointer-events-none" style={{ backgroundColor: accentColor }} />
        </div>
        {/* Right — neutral */}
        <div className="rounded-xl bg-white/[0.015] p-4 relative overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="text-[10px] font-bold text-white/45 mb-3 pb-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="w-[5px] h-[5px] rounded-full bg-white/18" />
            {right?.title || 'Option B'}
          </div>
          <div className="space-y-2.5">
            {right?.points?.map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-[3px] h-[3px] rounded-full mt-[7px] shrink-0 bg-white/12" />
                <span className="text-[10px] text-white/42 leading-[1.65]">{renderInlineBold(p)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutQuoteHighlight({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-6 gap-3 py-2 relative">
      {/* Background radial glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-48 h-28 rounded-full" style={{ background: `radial-gradient(ellipse, ${accentColor}06 0%, transparent 70%)` }} />
      </div>
      {/* Large decorative quote mark with gradient */}
      <div className="text-[80px] leading-none font-serif -mb-12 bg-clip-text text-transparent select-none relative z-10"
        style={{ backgroundImage: `linear-gradient(180deg, ${accentColor}20, ${accentColor}05)` }}>
        &ldquo;
      </div>
      {/* Quote text — premium serif-like italic */}
      <div className="text-[14px] text-white/55 leading-[2] italic font-light max-w-[88%] relative z-10">
        {meta?.quoteText || section.body}
      </div>
      {/* Attribution — refined with gradient lines */}
      {meta?.quoteAttribution && (
        <div className="flex items-center gap-3 mt-2 relative z-10">
          <div className="w-10 h-[1px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30)` }} />
          <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: `${accentColor}80` }}>
            {meta.quoteAttribution}
          </span>
          <div className="w-10 h-[1px] rounded-full" style={{ background: `linear-gradient(90deg, ${accentColor}30, transparent)` }} />
        </div>
      )}
      {/* Supporting body if different from quote */}
      {section.body && meta?.quoteText && section.body !== meta.quoteText && (
        <div className="mt-3 max-w-[85%] relative z-10">
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
}

function LayoutTimeline({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  const items = meta?.timelineItems || [];
  return (
    <div className="flex flex-col flex-1 gap-2">
      {/* Timeline items */}
      <div className="relative flex-1 overflow-y-auto glass-scroll pl-6">
        {/* Gradient vertical line */}
        <div className="absolute left-[8px] top-2 bottom-2 w-px rounded-full"
          style={{ background: `linear-gradient(180deg, ${accentColor}35, ${accentColor}12, ${accentColor}05)` }} />
        <div className="space-y-3 py-1">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            const isFirst = i === 0;
            return (
              <div key={i} className="relative flex items-start gap-3.5">
                {/* Dot on timeline — filled last, ring others */}
                <div className="absolute -left-6 top-[5px] z-10">
                  <div className="w-[9px] h-[9px] rounded-full flex items-center justify-center"
                    style={{
                      border: `1.5px solid ${isLast ? `${accentColor}cc` : `${accentColor}40`}`,
                      backgroundColor: isLast ? `${accentColor}cc` : 'transparent',
                      boxShadow: isLast ? `0 0 12px ${accentColor}30, 0 0 4px ${accentColor}40` : 'none',
                    }}>
                    {!isLast && <div className="w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${accentColor}35` }} />}
                  </div>
                </div>
                {/* Event card */}
                <div className="flex-1 rounded-lg p-2.5 -mt-0.5 transition-colors"
                  style={{
                    backgroundColor: isLast ? `${accentColor}05` : (isFirst ? `${accentColor}02` : 'transparent'),
                    border: isLast ? `1px solid ${accentColor}0c` : '1px solid transparent',
                  }}>
                  <div className="text-[8.5px] font-bold uppercase tracking-[0.15em] mb-1 bg-clip-text text-transparent"
                    style={{ backgroundImage: isLast ? `linear-gradient(135deg, ${accentColor}dd, ${accentColor}80)` : `linear-gradient(135deg, ${accentColor}70, ${accentColor}45)` }}>
                    {item.date}
                  </div>
                  <div className={`text-[10.5px] leading-[1.65] ${isLast ? 'text-white/50' : 'text-white/40'}`}>{renderInlineBold(item.event)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Supporting body */}
      {section.body && items.length > 0 && (
        <div className="mt-1 pt-2" style={{ borderTop: `1px solid rgba(255,255,255,0.03)` }}>
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
      {/* Fallback: if no timeline items, render body */}
      {items.length === 0 && (
        <RichSlideBody body={section.body} accentColor={accentColor} />
      )}
    </div>
  );
}

function LayoutKeyTakeaway({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center gap-4 px-5 py-2 relative">
      {/* Background radial glow behind takeaway — deeper */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-80 h-44 rounded-full" style={{ background: `radial-gradient(ellipse, ${accentColor}06 0%, transparent 65%)` }} />
      </div>
      {/* Icon with multi-layer glow */}
      <div className="relative z-10">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}08`, border: `1px solid ${accentColor}12`, boxShadow: `0 0 24px ${accentColor}08, inset 0 1px 0 ${accentColor}10` }}>
          <Sparkles size={16} style={{ color: `${accentColor}bb` }} />
        </div>
        <div className="absolute -inset-4 rounded-full opacity-[0.04] blur-xl pointer-events-none" style={{ backgroundColor: accentColor }} />
      </div>
      {/* Accent line above text */}
      <div className="relative z-10">
        <div className="w-8 h-[1.5px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}40, transparent)` }} />
        <div className="absolute -inset-1 rounded-full opacity-15 blur-sm" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />
      </div>
      {/* Big takeaway statement — gradient text */}
      <div className="text-[17px] font-bold leading-[1.5] max-w-[88%] tracking-[-0.015em] z-10 bg-clip-text text-transparent"
        style={{ backgroundImage: `linear-gradient(160deg, rgba(255,255,255,0.88) 10%, rgba(255,255,255,0.55) 60%, ${accentColor}50 110%)` }}>
        {meta?.takeaway || section.body}
      </div>
      {/* Supporting body */}
      {section.body && meta?.takeaway && section.body !== meta.takeaway && (
        <div className="max-w-[80%] mt-1 z-10">
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
      {/* Decorative bottom accent — wider gradient with glow */}
      <div className="relative z-10 mt-1">
        <div className="w-16 h-px rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30, transparent)` }} />
        <div className="absolute -inset-1 rounded-full opacity-10 blur-sm" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />
      </div>
    </div>
  );
}

/** Route to the correct layout renderer based on section.layout */
function LayoutRenderer({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  switch (section.layout) {
    case 'hero-stat':
      return <LayoutHeroStat section={section} accentColor={accentColor} />;
    case 'big-number':
      return <LayoutBigNumber section={section} accentColor={accentColor} />;
    case 'two-column':
      return <LayoutTwoColumn section={section} accentColor={accentColor} />;
    case 'comparison':
      return <LayoutComparison section={section} accentColor={accentColor} />;
    case 'quote-highlight':
      return <LayoutQuoteHighlight section={section} accentColor={accentColor} />;
    case 'timeline':
      return <LayoutTimeline section={section} accentColor={accentColor} />;
    case 'key-takeaway':
      return <LayoutKeyTakeaway section={section} accentColor={accentColor} />;
    default:
      return <RichSlideBody body={section.body} accentColor={accentColor} />;
  }
}

// ─── Presentation Slide Card ─────────────────────────────────────────────────

interface SlideCardProps {
  slide: PresentationSlide;
  onExport: () => void;
  onDigDeeper: () => void;
  onSave: () => void;
  onCopy: () => void;
  onFollowUp: (question: string) => void;
  onGenerate: (format: OutputFormat, count: number) => void;
  onEditItem: (patch: Partial<FeedItem>) => void;
  onDesignSlides?: (count?: number) => void;
  onEditSlide?: (sectionIndex: number, editRequest: string) => void;
  isPending: boolean;
}

function SlideCard({ slide, onExport, onDigDeeper, onSave, onCopy, onFollowUp, onGenerate, onEditItem, onDesignSlides, onEditSlide, isPending }: SlideCardProps) {
  const { kind, feedItem: item, slideNumber, totalSlides, sectionIndex } = slide;
  const accent = SLIDE_ACCENT_COLORS[(sectionIndex ?? 0) % SLIDE_ACCENT_COLORS.length];
  const [followUp, setFollowUp] = useState('');
  const [showGen, setShowGen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editSummary, setEditSummary] = useState(item.summary);
  const [editHeading, setEditHeading] = useState(item.sections?.[sectionIndex ?? 0]?.heading || '');
  const [editBody, setEditBody] = useState(item.sections?.[sectionIndex ?? 0]?.body || '');
  const [slideEditInput, setSlideEditInput] = useState('');
  const [showSlideEdit, setShowSlideEdit] = useState(false);

  // Sync edit fields when slide changes
  useEffect(() => {
    setEditing(false);
    setEditTitle(item.title);
    setEditSummary(item.summary);
    setEditHeading(item.sections?.[sectionIndex ?? 0]?.heading || '');
    setEditBody(item.sections?.[sectionIndex ?? 0]?.body || '');
  }, [item.id, sectionIndex, item.title, item.summary, item.sections]);

  const commitTitleEdit = () => {
    onEditItem({ title: editTitle, summary: editSummary });
    setEditing(false);
  };

  const commitSectionEdit = () => {
    if (sectionIndex == null || !item.sections) return;
    const newSections = [...item.sections];
    newSections[sectionIndex] = { heading: editHeading, body: editBody };
    onEditItem({ sections: newSections, content: newSections.map(s => `## ${s.heading}\n${s.body}`).join('\n\n') });
    setEditing(false);
  };

  // Shared slide shell — cinematic glassmorphic card
  const Shell = ({ children, accentColor, accentColor2 }: { children: ReactNode; accentColor?: string; accentColor2?: string }) => {
    const clr = accentColor || '#818cf8';
    const clr2 = accentColor2 || clr;
    return (
      <div className="relative rounded-[22px] shadow-2xl overflow-hidden"
        style={{
          minHeight: 340,
          aspectRatio: '16/10',
          border: `1px solid ${clr}14`,
          background: `linear-gradient(150deg, ${clr}07 0%, rgba(8,8,18,0.96) 35%, rgba(8,8,18,0.98) 65%, ${clr2}04 100%)`,
          boxShadow: `0 25px 60px -15px rgba(0,0,0,0.5), 0 0 0 1px ${clr}08 inset`,
        }}>
        {/* Top accent bar — vivid gradient edge */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px]"
          style={{ background: `linear-gradient(90deg, transparent 5%, ${clr}80 25%, ${clr2}60 75%, transparent 95%)` }} />
        {/* Bottom accent bar — subtle mirror of top */}
        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent 15%, ${clr}10 40%, ${clr2}08 60%, transparent 85%)` }} />
        {/* Left accent strip */}
        <div className="absolute top-0 left-0 bottom-0 w-px"
          style={{ background: `linear-gradient(180deg, ${clr}28 0%, ${clr}08 30%, transparent 60%, ${clr2}0a 100%)` }} />
        {/* Right accent strip — very subtle */}
        <div className="absolute top-0 right-0 bottom-0 w-px"
          style={{ background: `linear-gradient(180deg, ${clr}0a 0%, transparent 40%, transparent 60%, ${clr2}08 100%)` }} />
        {/* Primary glow — top right, large and diffuse */}
        <div className="absolute -top-28 -right-28 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${clr}10 0%, ${clr}04 35%, transparent 65%)` }} />
        {/* Secondary glow — bottom left, warm complementary tone */}
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${clr2}08 0%, ${clr2}02 40%, transparent 70%)` }} />
        {/* Center mesh glow — subtle mid-card luminosity */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/3 w-96 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(ellipse, ${clr}05 0%, transparent 55%)` }} />
        {/* Fine noise texture overlay for depth */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-overlay"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }} />
        {/* Inner padding container */}
        <div className="relative h-full p-7 flex flex-col">
          {/* Slide header — title + number + edit toggle */}
          <div className="flex items-center justify-between mb-2.5 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-[3px] h-3 rounded-full" style={{ background: `linear-gradient(180deg, ${clr}cc, ${clr2}50)` }} />
              <span className="text-[7.5px] font-bold text-white/25 uppercase tracking-[0.25em] leading-none">{slide.slideTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              {(kind === 'title' || kind === 'section') && (
                editing ? (
                  <button onClick={kind === 'title' ? commitTitleEdit : commitSectionEdit}
                    className="w-5 h-5 rounded-md flex items-center justify-center text-green-400/50 hover:text-green-400 hover:bg-green-500/10 transition-all" title="Save edits">
                    <Check size={10} />
                  </button>
                ) : (
                  <button onClick={() => setEditing(true)}
                    className="w-5 h-5 rounded-md flex items-center justify-center text-white/8 hover:text-white/35 hover:bg-white/[0.04] transition-all" title="Edit slide">
                    <Edit2 size={9} />
                  </button>
                )
              )}
              <span className="text-[7.5px] text-white/10 font-mono tabular-nums tracking-wide">{slideNumber} / {totalSlides}</span>
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0">
            {children}
          </div>
          {/* Bottom bar — elegant gradient rule + brand */}
          <div className="flex items-center gap-3 mt-3 shrink-0">
            <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${clr}18, ${clr2}0a, transparent)` }} />
            <div className="flex items-center gap-2">
              <div className="w-[3px] h-[3px] rounded-full" style={{ backgroundColor: `${clr}20`, boxShadow: `0 0 4px ${clr}10` }} />
              <span className="text-[6.5px] font-bold tracking-[0.35em] uppercase bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))` }}>substrate</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Title Slide ──────────────────────────────
  if (kind === 'title') {
    return (
      <Shell accentColor="#818cf8" accentColor2="#6366f1">
        <div className="flex flex-col justify-center flex-1 py-2">
          {/* Minimal type label with gradient dot accent */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-[5px] h-[5px] rounded-full" style={{ backgroundColor: 'rgba(129,140,248,0.5)', boxShadow: '0 0 8px rgba(129,140,248,0.25)' }} />
              </div>
              <span className="text-[7.5px] font-bold uppercase tracking-[0.3em] bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, rgba(165,180,252,0.55), rgba(129,140,248,0.35))' }}>{item.type}</span>
            </div>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(129,140,248,0.10), transparent 50%)' }} />
            <span className="text-[7.5px] text-white/10 font-mono tabular-nums tracking-wide">{timeAgo(item.timestamp)}</span>
          </div>
          {/* Large cinematic title — gradient text */}
          {editing ? (
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
              className="text-[24px] font-extrabold text-white/90 leading-[1.15] mb-5 tracking-[-0.03em] bg-transparent border-b border-indigo-400/25 outline-none w-full"
              autoFocus />
          ) : (
            <h2 className="text-[24px] font-extrabold leading-[1.15] mb-5 tracking-[-0.03em] bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.92) 15%, rgba(255,255,255,0.65) 55%, rgba(129,140,248,0.45) 105%)' }}>
              {item.title}
            </h2>
          )}
          {/* Accent divider — refined gradient with layered glow */}
          <div className="w-14 h-[1.5px] rounded-full mb-5 relative">
            <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg, #818cf8bb, #6366f150, transparent)' }} />
            <div className="absolute -inset-1.5 rounded-full opacity-25 blur-sm" style={{ background: 'linear-gradient(90deg, #818cf8, transparent)' }} />
            <div className="absolute -inset-3 rounded-full opacity-10 blur-md" style={{ background: 'linear-gradient(90deg, #818cf8, transparent)' }} />
          </div>
          {/* Summary — elegant subtitle */}
          {editing ? (
            <textarea value={editSummary} onChange={e => setEditSummary(e.target.value)} rows={3}
              className="text-[12.5px] text-white/35 leading-[1.8] font-light mb-5 max-w-[90%] bg-transparent rounded-xl p-3 outline-none resize-y w-full"
              style={{ border: '1px solid rgba(129,140,248,0.10)', backgroundColor: 'rgba(129,140,248,0.02)' }} />
          ) : (
            item.summary && <p className="text-[12.5px] text-white/35 leading-[1.8] font-light mb-5 max-w-[90%]">{item.summary}</p>
          )}
          {/* Image (if available) */}
          {item.imageUrl && (
            <div className="w-full h-28 rounded-2xl overflow-hidden mb-4 bg-black/30"
              style={{ border: '1px solid rgba(129,140,248,0.06)' }}>
              <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          {/* Bottom: topic pills + section count */}
          <div className="mt-auto flex items-end justify-between">
            {item.topics.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.topics.slice(0, 4).map((t, i) => (
                  <span key={i} className="px-2.5 py-[3px] rounded-lg text-[7px] font-bold uppercase tracking-[0.1em]"
                    style={{
                      backgroundColor: 'rgba(129,140,248,0.05)',
                      color: 'rgba(165,180,252,0.35)',
                      border: '1px solid rgba(129,140,248,0.06)',
                    }}>{t}</span>
                ))}
              </div>
            )}
            {item.sections && item.sections.length > 0 && (
              <div className="text-[7.5px] flex items-center gap-1.5 shrink-0 ml-3 font-medium" style={{ color: 'rgba(165,180,252,0.15)' }}>
                <Layers size={8} style={{ color: 'rgba(165,180,252,0.18)' }} /> {item.sections.length} slides
              </div>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  // ── Section Slide ────────────────────────────
  if (kind === 'section' && sectionIndex != null && item.sections?.[sectionIndex]) {
    const section = item.sections[sectionIndex];
    const hasLayout = section.layout && section.layout !== 'default';
    return (
      <Shell accentColor={accent.glow} accentColor2={accent.glow2}>
        <div className="flex flex-col flex-1">
          {/* Section heading — premium with gradient number + accent line */}
          <div className="flex items-start gap-3.5 mb-4 mt-0.5">
            {/* Gradient number badge + vertical accent */}
            <div className="flex flex-col items-center gap-1.5 pt-0.5 shrink-0">
              <div className="relative">
                <span className="text-[10px] font-black tabular-nums bg-clip-text text-transparent"
                  style={{ backgroundImage: `linear-gradient(160deg, ${accent.glow}cc, ${accent.glow}60)` }}>
                  {String(sectionIndex + 1).padStart(2, '0')}
                </span>
                <div className="absolute -inset-2 rounded-full opacity-[0.06] blur-sm pointer-events-none"
                  style={{ backgroundColor: accent.glow }} />
              </div>
              <div className="w-[1.5px] h-5 rounded-full"
                style={{ background: `linear-gradient(180deg, ${accent.glow}35, ${accent.glow}08, transparent)` }} />
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <input value={editHeading} onChange={e => setEditHeading(e.target.value)}
                  className="text-[16px] font-bold text-white/90 leading-[1.3] tracking-[-0.015em] bg-transparent border-b outline-none w-full"
                  style={{ borderColor: `${accent.glow}30` }}
                  autoFocus />
              ) : (
                <h3 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] bg-clip-text text-transparent"
                  style={{ backgroundImage: `linear-gradient(160deg, rgba(255,255,255,0.88) 30%, ${accent.glow}90 120%)` }}>
                  {section.heading}
                </h3>
              )}
              {hasLayout && (
                <span className="inline-block mt-2 px-2 py-[2px] rounded-md text-[6.5px] font-bold uppercase tracking-[0.12em]"
                  style={{
                    backgroundColor: `${accent.glow}08`,
                    border: `1px solid ${accent.glow}0c`,
                    color: `${accent.glow}35`,
                  }}>
                  {section.layout}
                </span>
              )}
            </div>
          </div>
          {/* Section body — layout-aware rendering */}
          {editing ? (
            <textarea value={editBody} onChange={e => setEditBody(e.target.value)}
              className="text-[11px] text-white/55 leading-[1.7] whitespace-pre-wrap flex-1 overflow-y-auto glass-scroll pr-1 bg-transparent rounded-xl p-3 outline-none resize-y w-full min-h-[120px]"
              style={{ border: `1px solid ${accent.glow}10`, backgroundColor: `${accent.glow}03` }} />
          ) : (
            <div className="flex-1 overflow-y-auto glass-scroll pr-1">
              <LayoutRenderer section={section} accentColor={accent.glow} />
            </div>
          )}
          {/* Per-slide edit chat — Slide Designer follow-up */}
          {onEditSlide && (
            <div className="mt-3 shrink-0">
              {showSlideEdit ? (
                <div className="flex items-center gap-1.5 p-1 rounded-xl"
                  style={{ backgroundColor: `${accent.glow}04`, border: `1px solid ${accent.glow}0c` }}>
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5">
                    <Wand2 size={10} style={{ color: `${accent.glow}50` }} className="shrink-0" />
                    <input value={slideEditInput} onChange={e => setSlideEditInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && slideEditInput.trim()) { onEditSlide(sectionIndex, slideEditInput); setSlideEditInput(''); setShowSlideEdit(false); }
                        if (e.key === 'Escape') setShowSlideEdit(false);
                      }}
                      placeholder="Redesign this slide…"
                      disabled={isPending}
                      className="flex-1 bg-transparent text-[10px] text-white/55 placeholder:text-white/15 outline-none disabled:opacity-40"
                      autoFocus />
                  </div>
                  <button onClick={() => { if (slideEditInput.trim()) { onEditSlide(sectionIndex, slideEditInput); setSlideEditInput(''); setShowSlideEdit(false); } }}
                    disabled={!slideEditInput.trim() || isPending}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-15"
                    style={{ backgroundColor: `${accent.glow}10`, color: `${accent.glow}70` }}>
                    <Send size={10} />
                  </button>
                  <button onClick={() => setShowSlideEdit(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/15 hover:text-white/40 hover:bg-white/[0.04] transition-all">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowSlideEdit(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-medium transition-all"
                  style={{ color: `${accent.glow}40` }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent.glow}06`; e.currentTarget.style.color = `${accent.glow}70`; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = `${accent.glow}40`; }}
                  disabled={isPending}>
                  <Wand2 size={9} /> Redesign slide
                </button>
              )}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── Sources Slide ────────────────────────────
  if (kind === 'sources') {
    return (
      <Shell accentColor="#22d3ee" accentColor2="#06b6d4">
        <div className="flex flex-col flex-1">
          <div className="flex items-center gap-3 mb-4 mt-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center relative"
              style={{ backgroundColor: '#22d3ee08', border: '1px solid #22d3ee12' }}>
              <ExternalLink size={13} className="text-cyan-400/60" />
              <div className="absolute -inset-1 rounded-xl opacity-[0.06] blur-md pointer-events-none" style={{ backgroundColor: '#22d3ee' }} />
            </div>
            <div>
              <h3 className="text-[14px] font-bold tracking-[-0.01em] bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, rgba(165,243,252,0.9), rgba(34,211,238,0.7))' }}>
                {slide.slideTitle}
              </h3>
              <span className="text-[8px] text-white/18 font-medium">{item.sourceUrls?.length || 0} verified sources</span>
            </div>
          </div>
          <div className="space-y-1.5 flex-1 overflow-y-auto glass-scroll">
            {item.sourceUrls?.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-2.5 rounded-xl transition-all group"
                style={{ backgroundColor: 'rgba(34,211,238,0.015)', border: '1px solid rgba(34,211,238,0.04)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(34,211,238,0.04)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(34,211,238,0.015)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.04)'; }}>
                <span className="text-[9px] font-bold tabular-nums w-5 text-center shrink-0 bg-clip-text text-transparent"
                  style={{ backgroundImage: 'linear-gradient(180deg, rgba(34,211,238,0.5), rgba(34,211,238,0.25))' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="w-px h-5 shrink-0" style={{ background: 'linear-gradient(180deg, rgba(34,211,238,0.12), transparent)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] font-semibold text-white/50 group-hover:text-cyan-200/80 transition-colors truncate">{s.label}</div>
                  <div className="text-[7.5px] text-white/12 truncate mt-0.5 font-mono">{s.url}</div>
                </div>
                <ExternalLink size={10} className="text-white/8 group-hover:text-cyan-300/40 transition-colors shrink-0" />
              </a>
            ))}
          </div>
          {/* Quick actions row */}
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(34,211,238,0.06)' }}>
            <button onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-medium transition-all hover:bg-emerald-500/10" style={{ color: '#34d39970', border: '1px solid #34d39912' }}><Download size={9} /> Export</button>
            <button onClick={onCopy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/20 text-[9px] font-medium hover:text-white/45 transition-all" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}><Copy size={9} /> Copy All</button>
            <button onClick={onSave} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-medium transition-all ${item.saved ? 'bg-amber-500/15 border-amber-400/15 text-amber-300/70' : 'text-white/20 hover:text-amber-300/50'}`} style={item.saved ? {} : { backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}><Bookmark size={9} /> {item.saved ? 'Saved' : 'Save'}</button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Actions Slide (follow-up + generate) ─────
  return (
    <Shell accentColor="#a78bfa" accentColor2="#7c3aed">
      <div className="flex flex-col flex-1">
        <div className="flex items-center gap-3 mb-4 mt-1">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center relative"
            style={{ backgroundColor: '#a78bfa08', border: '1px solid #a78bfa12' }}>
            <Sparkles size={13} className="text-violet-400/60" />
            <div className="absolute -inset-1 rounded-xl opacity-[0.06] blur-md pointer-events-none" style={{ backgroundColor: '#a78bfa' }} />
          </div>
          <h3 className="text-[14px] font-bold tracking-[-0.01em] bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(135deg, rgba(221,214,254,0.9), rgba(167,139,250,0.7))' }}>
            {slide.slideTitle}
          </h3>
        </div>

        {/* Follow-up questions */}
        {slide.followUpQuestions && slide.followUpQuestions.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-3 h-[1px] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(167,139,250,0.3), transparent)' }} />
              <div className="text-[7.5px] text-white/22 uppercase tracking-[0.2em] font-bold">Continue exploring</div>
            </div>
            <div className="space-y-1.5">
              {slide.followUpQuestions.map((q, i) => (
                <button key={i} onClick={() => !isPending && onFollowUp(q)} disabled={isPending}
                  className="block w-full text-left text-[10px] text-white/35 rounded-xl px-3.5 py-2.5 transition-all disabled:opacity-30"
                  style={{ backgroundColor: 'rgba(167,139,250,0.02)', border: '1px solid rgba(167,139,250,0.05)' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(167,139,250,0.05)'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.12)'; e.currentTarget.style.color = 'rgba(221,214,254,0.7)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(167,139,250,0.02)'; e.currentTarget.style.borderColor = 'rgba(167,139,250,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}>
                  <span className="text-violet-400/25 mr-2 text-[8px]">&#9656;</span>{q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom follow-up input */}
        <div className="flex items-center gap-1.5 mb-4">
          <div className="flex-1 flex items-center gap-2 rounded-xl px-3.5 py-2.5"
            style={{ backgroundColor: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.08)' }}>
            <MessageSquare size={11} className="text-violet-400/25 shrink-0" />
            <input value={followUp} onChange={e => setFollowUp(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && followUp.trim()) { onFollowUp(followUp); setFollowUp(''); } }}
              placeholder="Ask a follow-up question…" disabled={isPending}
              className="flex-1 bg-transparent text-[10.5px] text-white/55 placeholder:text-white/12 outline-none disabled:opacity-40" />
          </div>
          <button onClick={() => { if (followUp.trim()) { onFollowUp(followUp); setFollowUp(''); } }} disabled={!followUp.trim() || isPending}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-15"
            style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: 'rgba(167,139,250,0.6)', border: '1px solid rgba(167,139,250,0.1)' }}><Send size={11} /></button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {onDesignSlides && (
            <button onClick={() => onDesignSlides()} disabled={isPending}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-semibold transition-all disabled:opacity-30 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(236,72,153,0.08))',
                border: '1px solid rgba(167,139,250,0.18)',
                color: 'rgba(221,214,254,0.85)',
                boxShadow: '0 4px 24px rgba(139,92,246,0.06), 0 0 0 1px rgba(167,139,250,0.05) inset',
              }}>
              <Wand2 size={11} /> Design Premium Slides
            </button>
          )}
          <button onClick={onDigDeeper} disabled={isPending}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-medium transition-all disabled:opacity-30"
            style={{ backgroundColor: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.08)', color: 'rgba(165,180,252,0.5)' }}>
            <RefreshCw size={10} /> Dig Deeper
          </button>
          <button onClick={() => setShowGen(!showGen)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-medium transition-all"
            style={{ backgroundColor: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.07)', color: 'rgba(196,181,253,0.45)' }}>
            <PenTool size={10} /> Create Content
          </button>
        </div>

        {/* Generate pipeline panel */}
        {showGen && (
          <div className="p-4 rounded-xl space-y-3 mt-auto"
            style={{ backgroundColor: 'rgba(167,139,250,0.03)', border: '1px solid rgba(167,139,250,0.07)' }}>
            <div className="text-[7.5px] font-bold text-violet-300/35 uppercase tracking-[0.2em]">Generate from this research</div>
            {OUTPUT_FORMATS.map(fmt => (
              <div key={fmt.key} className="flex items-center gap-2.5">
                <fmt.icon size={12} className="text-white/20 shrink-0" />
                <span className="text-[10px] text-white/35 flex-1">{fmt.label}</span>
                <button onClick={() => { onGenerate(fmt.key, fmt.key === 'article' ? 1 : fmt.key === 'slides' ? 8 : 5); setShowGen(false); }} disabled={isPending}
                  className="px-3.5 py-1.5 rounded-lg text-[9px] font-medium transition-all disabled:opacity-30"
                  style={{ backgroundColor: 'rgba(167,139,250,0.08)', color: 'rgba(196,181,253,0.55)', border: '1px solid rgba(167,139,250,0.08)' }}>
                  Generate
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─── Prompt Settings Component ──────────────────────────────────────────────

function PromptSettings({ prompts, onSave }: { prompts: PromptTemplates; onSave: (p: PromptTemplates) => void }) {
  const [local, setLocal] = useState<PromptTemplates>(() => ({ ...prompts }));
  const [dirty, setDirty] = useState(false);

  const handleChange = (key: keyof PromptTemplates, value: string) => {
    setLocal(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between shrink-0">
        <div className="text-[11px] font-semibold text-white/60">Prompt Templates</div>
        <button onClick={() => { onSave(local); setDirty(false); }} disabled={!dirty}
          className="px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-400/15 text-indigo-300/70 text-[10px] font-medium hover:bg-indigo-500/25 transition-all disabled:opacity-30">
          Save Changes
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 glass-scroll">
        {(Object.entries(PROMPT_LABELS) as [keyof PromptTemplates, { label: string; desc: string }][]).map(([key, meta]) => (
          <div key={key} className="space-y-1.5">
            <label className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">{meta.label}</label>
            <textarea value={local[key]} onChange={e => handleChange(key, e.target.value)} rows={6}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-[10px] text-white/60 leading-relaxed outline-none focus:border-indigo-400/20 resize-y glass-scroll font-mono" />
            <div className="text-[8px] text-white/20">
              Variables: {'{{QUERY}}, {{RESEARCH}}, {{COUNT}}, {{FORMAT}}'.split(', ').map(v => (
                <span key={v} className="inline-block px-1 py-0.5 rounded bg-white/[0.04] mr-1 mb-0.5">{v}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
