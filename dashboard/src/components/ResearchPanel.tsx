/**
 * ResearchPanel -- Intelligence & Content Pipeline for the Substrate dashboard.
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
  html?: string;  // Agent-generated styled HTML -- full creative freedom within the slide canvas
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
  return cut + '...';
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

  // Section slides -- use section headings as contextual titles
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
  streamingRawText?: string;
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

Include 4-7 sections covering different angles. Be detailed and analytical.

SECTION BODY FORMATTING -- use these conventions to create data-rich, visualizable content:
* Start each section with a 1-2 sentence overview paragraph.
* Use bullet points with **bold lead-ins**: "* **Key Point**: explanation..."
* REQUIRED: Include 2-4 stat callouts per section where relevant, on their own line:
  [STAT: 73% | of enterprises adopted AI in 2025]
  Format is [STAT: value | description]. Use real data from your research.
* For comparisons, include a [COMPARE] block on its own line:
  [COMPARE: Label A = value A | Label B = value B | Label C = value C]
  Example: [COMPARE: WTI Crude = $78/bbl | Brent Crude = $82/bbl | OPEC Basket = $80/bbl]
* For trends over time, include a [TIMELINE] block:
  [TIMELINE: 2023 = value | 2024 = value | 2025 = value | 2026 = value]
  Example: [TIMELINE: Q1 2024 = $72 | Q2 2024 = $78 | Q3 2024 = $85 | Q1 2025 = $92]
* For processes or chains, include a [FLOW] block:
  [FLOW: Step 1 -> Step 2 -> Step 3 -> Result]
  Example: [FLOW: Extraction -> Refining -> Distribution -> Retail]
* Optionally include one pull quote: > "Notable quote" -- Attribution
* Separate distinct ideas with blank lines between paragraphs.
* Keep each section focused -- one key idea or angle per section.
* PRIORITIZE hard numbers, percentages, dollar amounts, and rankings. Vague descriptions are less useful than concrete data.

Example section body:
"The landscape shifted dramatically in Q1 2025 as major players consolidated their positions.\n\n[STAT: $4.2B | Total AI infrastructure investment in Q1 2025]\n[STAT: 78% | NVIDIA GPU market share]\n\n[COMPARE: AWS = 32% market share | Azure = 28% market share | GCP = 21% market share]\n\n* **Market Leaders**: NVIDIA maintained dominance with 78% GPU market share...\n* **Cloud Shift**: AWS and Azure both launched dedicated AI compute tiers...\n\n[TIMELINE: 2022 = $1.8B | 2023 = $2.9B | 2024 = $3.6B | 2025 = $4.2B]\n\n> \"This is the fastest technology adoption curve we've seen since the smartphone\" -- Industry Analyst"

CRITICAL: For sources, ONLY include real URLs that you found during your web search. Do NOT fabricate or hallucinate URLs. If you did not find a real source URL, omit the sources array entirely rather than making up fake URLs. Each source must be a real, working link.

Include 3 suggested follow-up questions that would deepen the research.

IMPORTANT: Return ONLY the JSON object, no markdown fences, no extra text.

Topic to research: "{{QUERY}}"`,

  brief: `You are an intelligence analyst with web search capabilities. Generate a daily intelligence brief as a JSON object with this exact structure:
{
  "title": "Daily Intelligence Brief -- {{DATE}}",
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

SECTION BODY FORMATTING -- use these conventions for each section body:
* Start with a 1-2 sentence overview paragraph.
* Use bullet points with **bold lead-ins**: "* **Key Point**: explanation..."
* Include stat callouts where relevant: [STAT: value | description]
* Optionally include a pull quote: > "Notable quote or key insight"
* Separate ideas with blank lines.

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

SECTION BODY FORMATTING -- use these conventions:
* Write rich prose paragraphs, separated by blank lines.
* Use bullet points with **bold lead-ins** for key arguments: "* **Key Point**: explanation..."
* Include stat callouts for important data: [STAT: value | description]
* Include pull quotes for impactful statements: > "Notable quote or insight"
* Mix prose paragraphs with structured elements for visual variety.

IMPORTANT: Return ONLY the JSON object.

Research to base article on:
{{RESEARCH}}`,

  linkedin: `You are a LinkedIn content strategist. Transform this research into {{COUNT}} engaging LinkedIn posts.

Return as JSON:
{
  "title": "LinkedIn Series: {{TOPIC}}",
  "summary": "Series overview",
  "sections": [
    { "heading": "Post 1: Hook Title", "body": "Full post text with line breaks, emojis where appropriate, hashtags at end. Optimize for LinkedIn engagement -- use hooks, storytelling, clear takeaways. 150-300 words per post." }
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
    { "heading": "Slide 1: Hook", "body": "Slide text -- punchy, visual-friendly, short paragraphs. Think infographic text." },
    { "heading": "Slide 2: Key Point", "body": "..." },
    { "heading": "Caption", "body": "Full Instagram caption with hashtags, CTA, and emoji." }
  ],
  "sources": [/* preserve real sources */],
  "keyTopics": ["instagram", "{{TOPIC}}"]
}

Design for visual impact -- each slide should have a clear single idea. Last section is always the caption.

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

Each section = one slide. Design for visual impact -- one key idea per slide.

SLIDE BODY FORMATTING -- use these conventions:
* Start with a bold thesis sentence.
* Use bullet points with **bold lead-ins**: "* **Key Point**: explanation..."
* Include 1 stat callout per slide where data exists: [STAT: value | description]
* Optionally include a pull quote: > "Notable quote or insight"
* Keep text concise -- slides should be scannable, not dense paragraphs.

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

SECTION BODY FORMATTING -- use these conventions:
* Start with a 1-2 sentence overview paragraph.
* Use bullet points with **bold lead-ins**: "* **Key Point**: explanation..."
* Include stat callouts where relevant: [STAT: value | description]
* Optionally include a pull quote: > "Notable quote or key insight"
* Separate ideas with blank lines.

CRITICAL: Only include real URLs from search results. Do NOT fabricate URLs.

IMPORTANT: Return ONLY the JSON object.

Original research context:
{{RESEARCH}}

Follow-up question: {{QUESTION}}`,

  slideDesigner: `You are an elite research analyst and storytelling expert. Your job: distill research into a structured slide deck outline with punchy headings and data-dense body text.

You do NOT generate HTML or visual design -- a separate design engine handles that. Focus 100% on content structure, narrative arc, and data extraction.

Return as JSON:
{
  "title": "{{TOPIC}}",
  "summary": "A sharp, memorable subtitle -- think tagline not description",
  "sections": [
    {
      "heading": "Punchy insight heading, max 8 words",
      "body": "Data-rich body text with 2+ data markers (see below). 3-6 sentences."
    }
  ],
  "sources": [/* preserve real source URLs from research */],
  "keyTopics": ["topic1", "topic2"],
  "followUpQuestions": ["question?", "question?"]
}

=== DATA MARKERS (the design engine converts these to rich visuals -- use 2+ per section) ===
* [STAT: value | description] -- hero statistics (e.g. [STAT: 73% | of enterprises adopted AI in 2025])
* [COMPARE: A = val | B = val | C = val] -- comparisons / bar charts
* [TIMELINE: 2023 = event | 2024 = event | 2025 = event] -- chronological data
* [FLOW: Step1 -> Step2 -> Step3] -- processes and pipelines
* > "quote text" -- Attribution -- cinematic quotes
* **Bold lead-ins** for key bullet points

=== HEADING EXAMPLES (lead with INSIGHT not topic) ===
BAD: "Market Overview" -> GOOD: "A $4.2T Market Nobody Saw Coming"
BAD: "Key Players" -> GOOD: "Three Companies Own 81% of the Market"
BAD: "Safety Tips" -> GOOD: "The 5-Minute Check That Saves Lives"
BAD: "History" -> GOOD: "From Garage Project to Global Standard"

=== CONTENT RULES ===
1. HEADINGS: Lead with insight, surprise, or a concrete number. Max 8 words. Each heading should make the reader curious.
2. BODY DENSITY: Each section body MUST have 3-6 rich sentences AND at least 2 data markers ([STAT], [COMPARE], [TIMELINE], [FLOW], or quote). More data = better slides.
3. ONE core idea per slide, but pack supporting evidence around it. 2-3 bullet points max.
4. NARRATIVE ARC across the deck: hook -> context -> evidence -> insight -> implications -> takeaway.
5. Use REAL DATA from the research. Concrete numbers, percentages, dollar amounts, rankings. Vague descriptions are useless.
6. VARY the data markers across slides. Don't use [STAT] on every slide -- mix in [COMPARE], [TIMELINE], [FLOW], and quotes.
7. If the topic involves a GEOGRAPHIC PLACE, include location-specific details: distances, coordinates, neighborhood names, trail names, route details, local landmarks.

YOU MUST RETURN EXACTLY {{COUNT}} sections. Returning fewer is unacceptable.

IMPORTANT: Return ONLY the JSON object, no markdown fences. Do NOT include an "html" field.

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
  "body": "Updated plain-text body content (fallback)",
  "html": "<div style=\\"...\\">YOUR REDESIGNED SLIDE HTML</div>"
}

You have full creative freedom. The "html" field renders inside a dark glassmorphic card (~600px wide, dark bg #0a0a12). Use inline styles only (no class names, no <style> tags). Use rgba(255,255,255,...) for text, accent colors from: #818cf8, #22d3ee, #f59e0b, #fb7185, #34d399, #a78bfa.

If the user asks to change layout, tone, emphasis, data, or style -- redesign completely. Be bold and creative. ONE idea per slide, generous whitespace, scannable text.

IMPORTANT: Return ONLY the JSON object for the single updated slide, no markdown fences.`,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

// Geo detection moved to backend -- LLM extracts locations directly (no keyword pre-filter)

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
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    // If agent returned a raw array, wrap it as sections
    if (Array.isArray(direct) && direct.length > 0 && direct[0].heading) {
      return { title: direct[0].heading, summary: '', sections: direct };
    }
  } catch { /* continue */ }

  // Try to find JSON object in the text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj && typeof obj === 'object') return obj;
    } catch { /* continue */ }
  }

  // Try to find JSON array in the text
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr) && arr.length > 0 && arr[0].heading) {
        return { title: arr[0].heading, summary: '', sections: arr };
      }
    } catch { /* continue */ }
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

/** Parse agent response text into a FeedItem -- handles both JSON and freeform text */
function parseResponseToFeedItem(
  rawText: string,
  query: string,
  type: FeedItemType,
  extras?: Partial<FeedItem>,
): FeedItem & { followUpQuestions?: string[] } {
  const parsed = parseAgentJSON(rawText);

  if (parsed && parsed.title) {
    const sections: SlideSection[] = Array.isArray(parsed.sections)
      ? (parsed.sections as Array<{ heading?: string; body?: string; html?: string; layout?: string; layoutMeta?: Record<string, unknown> }>)
          .filter(s => s.heading && (s.body || s.html))
          .map(s => ({
            heading: String(s.heading),
            body: String(s.body || ''),
            ...(s.html ? { html: String(s.html) } : {}),
            ...(s.layout ? { layout: s.layout as SlideLayout } : {}),
            ...(s.layoutMeta ? { layoutMeta: s.layoutMeta as SlideSection['layoutMeta'] } : {}),
          }))
      : [];

    // Filter out dummy/fabricated URLs
    const sources = Array.isArray(parsed.sources)
      ? (parsed.sources as Array<{ url?: string; label?: string }>)
          .filter(s => s.url && isRealUrl(String(s.url)))
          .map(s => { try { return { url: String(s.url), label: String(s.label || new URL(String(s.url)).hostname.replace('www.', '')) }; } catch { return { url: String(s.url), label: String(s.url).slice(0, 40) }; } })
      : [];

    const topics = Array.isArray(parsed.keyTopics)
      ? (parsed.keyTopics as string[]).slice(0, 5)
      : [query.toLowerCase()];

    const followUpQuestions = Array.isArray(parsed.followUpQuestions)
      ? (parsed.followUpQuestions as string[]).slice(0, 5)
      : undefined;

    // Ensure summary is always clean readable text, never raw JSON
    let summary = '';
    if (parsed.summary && typeof parsed.summary === 'string') {
      const trimmed = parsed.summary.trim();
      // If agent returned a JSON fragment as summary, ignore it
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        summary = trimmed;
      }
    }
    // Fallback: derive from first section
    if (!summary && sections.length > 0) {
      summary = sections[0].body?.slice(0, 200) || sections[0].heading;
    }

    return {
      id: genId(),
      type,
      title: String(parsed.title),
      summary,
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

  // Build a clean summary -- never show raw JSON
  let summary = '';
  if (sections[0]?.body) {
    summary = sections[0].body.slice(0, 200);
  } else {
    // If rawText looks like JSON, don't use it as summary
    const trimmedRaw = rawText.trim();
    if (trimmedRaw.startsWith('{') || trimmedRaw.startsWith('[')) {
      // Try to extract any readable text from the JSON
      const textBits = trimmedRaw.replace(/[{}\[\]"]/g, ' ').replace(/\s+/g, ' ').trim();
      // Extract values that look like prose (>20 chars, no colons at start)
      const proseMatch = textBits.match(/(?:body|summary|description|content)\s*:\s*([^,]{20,})/i);
      summary = proseMatch ? proseMatch[1].trim().slice(0, 200) : '';
    } else {
      summary = trimmedRaw.slice(0, 200);
    }
  }

  return {
    id: genId(),
    type,
    title: query,
    summary: summary ? summary + (summary.length >= 200 ? '...' : '') : '',
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
  streamingRawText,
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
  const [researchMode, setResearchMode] = useState<'quick' | 'deep'>('quick');
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [prompts, setPrompts] = useState<PromptTemplates>({ ...DEFAULT_PROMPTS });
  const [followUpInputs, setFollowUpInputs] = useState<Record<string, string>>({});

  // Track pending research requests
  const pendingRef = useRef<PendingRequest | null>(null);
  const prevGeneratingRef = useRef(false);
  // Track the last consumed assistant msgId to prevent re-consuming the same response
  const lastConsumedMsgIdRef = useRef<string | null>(null);
  // Track per-slide edit targets for the Slide Designer
  const slideEditTargetRef = useRef<{ itemId: string; sectionIndex: number } | null>(null);
  // Design pass: track which item is being designed + progress
  const [designingItemId, setDesigningItemId] = useState<string | null>(null);
  const [designProgress, setDesignProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const designAbortRef = useRef<AbortController | null>(null);
  // Queue a design pass after content generation completes
  const pendingDesignPassRef = useRef<string | null>(null);
  const runDesignPassRef = useRef<(itemId: string) => void>(() => {});

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
  // Keep feedItems accessible via ref for async callbacks (redesign, design pass)
  const feedItemsRef = useRef(feedItems);
  feedItemsRef.current = feedItems;
  // Capture streaming raw text so we can use it as a fallback when chatMessages hasn't updated yet
  const lastStreamingTextRef = useRef('');
  const rawStream = streamingRawText || streamingText;
  if (rawStream) lastStreamingTextRef.current = rawStream;

  const consumePending = useCallback((pending: PendingRequest) => {
    const msgs = chatMessagesRef.current;
    // Find our [RESEARCH_PIPELINE] user message by scanning for it.
    // chatMessages is windowed (~50 items), so index-based slicing doesn't work.
    // Search backwards for the last user message containing [RESEARCH_PIPELINE].
    let userMsgIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user' && msgs[i].rawText?.includes('[RESEARCH_PIPELINE]')) {
        userMsgIdx = i;
        break;
      }
    }

    // Look for assistant messages AFTER our user message
    let lastAssistant: typeof msgs[0] | undefined;
    if (userMsgIdx >= 0) {
      const afterUser = msgs.slice(userMsgIdx + 1);
      lastAssistant = [...afterUser].reverse().find(m => m.role === 'assistant');
    } else {
      // User message not in window — just take the very last assistant message
      // This handles the case where the window has scrolled past our user message
      lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
    }

    // Streaming text fallback
    let rawText = lastAssistant?.rawText || '';
    if (!rawText && lastStreamingTextRef.current) {
      const streamRaw = lastStreamingTextRef.current.replace(/<[^>]*>/g, '').trim();
      if (streamRaw.length > 20) {
        console.log(`[ResearchPanel] consumePending: using streamingText fallback (${streamRaw.length} chars)`);
        rawText = streamRaw;
      }
    }

    // Guard: if we found an assistant message but it was already consumed for a previous
    // request, skip it. We track this via lastConsumedMsgIdRef.
    if (lastAssistant && lastAssistant.msgId && lastAssistant.msgId === lastConsumedMsgIdRef.current) {
      console.log('[ResearchPanel] consumePending: skipping already-consumed msgId:', lastAssistant.msgId);
      rawText = '';
    }

    console.log('[ResearchPanel] consumePending:', pending.query,
      '| msgs:', msgs.length, '| userMsgIdx:', userMsgIdx,
      '| lastAssistant:', lastAssistant ? `msgId=${lastAssistant.msgId} rawText=${rawText?.slice(0, 80)}...` : 'NONE (streamFallback=' + (rawText.length > 0) + ')');

    if (!rawText) return false;

    // Track this message as consumed so we don't re-use it for a future request
    if (lastAssistant?.msgId) lastConsumedMsgIdRef.current = lastAssistant.msgId;

    try {
      // Handle per-slide edit -- update just one section in an existing item
      const editTarget = slideEditTargetRef.current;
      if (editTarget) {
        slideEditTargetRef.current = null;
        const parsed = parseAgentJSON(rawText);
        if (parsed && parsed.heading) {
          setFeedItems(prev => {
            const updated = prev.map(fi => {
              if (fi.id !== editTarget.itemId || !fi.sections) return fi;
              const newSections = [...fi.sections];
              newSections[editTarget.sectionIndex] = {
                heading: String(parsed.heading),
                body: String(parsed.body || ''),
                ...(parsed.html ? { html: String(parsed.html) } : {}),
                layout: (parsed.layout as SlideLayout) || newSections[editTarget.sectionIndex]?.layout,
                layoutMeta: parsed.layoutMeta as SlideSection['layoutMeta'] || newSections[editTarget.sectionIndex]?.layoutMeta,
              };
              return { ...fi, sections: newSections };
            }).filter(i => !(i.pending && i.title === pending.query));
            fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
            return updated;
          });
        }
        // Always return true for slide edits -- don't fall through to create a bogus new feed item
        return true;
      }

      // Normal case -- parse as full feed item
      const item = parseResponseToFeedItem(rawText, pending.query, pending.type, {
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
      // Clear streaming fallback after successful consumption
      lastStreamingTextRef.current = '';
      console.log(`[ResearchPanel] Parsed item: id=${item.id}, title="${item.title}", sections=${item.sections?.length ?? 0}, hasHtml=${item.sections?.some(s => s.html) ?? false}, sectionHeadings=${item.sections?.map(s => s.heading).join(' | ')}`);
      // Auto-trigger design pass for any item with sections that lack html
      if (item.sections?.length && !item.sections.some(s => s.html)) {
        console.log(`[ResearchPanel] Queuing design pass for ${item.sections.length} sections, itemId=${item.id}`);
        pendingDesignPassRef.current = item.id;
      }
      return true;
    } catch (e) {
      console.error('[ResearchPanel] consumePending CRASHED:', e);
      return false;
    }
  }, []);

  // Unconsumed pending -- when isGenerating goes false but the assistant message
  // isn't in chatMessages yet, park it here so the message-change watcher can retry.
  const unconsumedPendingRef = useRef<PendingRequest | null>(null);

  useEffect(() => {
    const wasGenerating = prevGeneratingRef.current;
    prevGeneratingRef.current = isAgentGenerating;
    if (wasGenerating && !isAgentGenerating) {
      console.log('[ResearchPanel] isAgentGenerating went false. pendingRef:', pendingRef.current?.query || 'null',
        '| msgs:', chatMessages.length,
        '| streamRef:', lastStreamingTextRef.current.length, 'chars',
        '| rawStream:', (streamingRawText || streamingText || '').length, 'chars');
    }
    if (wasGenerating && !isAgentGenerating && pendingRef.current) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (consumePending(pending)) {
        console.log('[ResearchPanel] ✓ consumePending succeeded on isAgentGenerating transition');
        setTimeout(() => {
          const queuedId = pendingDesignPassRef.current;
          if (queuedId) { pendingDesignPassRef.current = null; runDesignPassRef.current(queuedId); }
        }, 300);
      } else {
        console.log('[ResearchPanel] ✗ consumePending failed on transition, parking to unconsumedPendingRef');
        unconsumedPendingRef.current = pending;
      }
    }
  }, [isAgentGenerating, chatMessages, consumePending]);

  // Secondary watcher: when chatMessages changes and there's an unconsumed pending,
  // retry consumePending. This covers the race where the final assistant message
  // arrives in a later render cycle after isGenerating already went false.
  useEffect(() => {
    const pending = unconsumedPendingRef.current;
    if (!pending) return;
    console.log('[ResearchPanel] Secondary watcher retrying consumePending for:', pending.query, '| msgs:', chatMessages.length, '| streamRef:', lastStreamingTextRef.current.length);
    if (consumePending(pending)) {
      console.log('[ResearchPanel] ✓ Secondary watcher consumed pending');
      unconsumedPendingRef.current = null;
      setTimeout(() => {
        const queuedId = pendingDesignPassRef.current;
        if (queuedId) { pendingDesignPassRef.current = null; runDesignPassRef.current(queuedId); }
      }, 300);
    }
  }, [chatMessages, consumePending]);

  // Safety timeout: clear stale pending/unconsumed after 90s so future requests aren't blocked
  useEffect(() => {
    const iv = setInterval(() => {
      if (unconsumedPendingRef.current && !isAgentGenerating) {
        console.warn('[ResearchPanel] Clearing stale unconsumed pending after timeout');
        // Remove the blank pending item from feed
        const staleQuery = unconsumedPendingRef.current.query;
        setFeedItems(prev => prev.filter(i => !(i.pending && i.title === staleQuery)));
        unconsumedPendingRef.current = null;
      }
      if (pendingRef.current && !isAgentGenerating) {
        console.warn('[ResearchPanel] Clearing stale pendingRef after timeout');
        const staleQuery = pendingRef.current.query;
        setFeedItems(prev => prev.filter(i => !(i.pending && i.title === staleQuery)));
        pendingRef.current = null;
      }
    }, 15_000);
    return () => clearInterval(iv);
  }, [isAgentGenerating]);

  // ─── Persistence ────────────────────────────────────────────────
  const saveTopics = useCallback(async (t: Topic[]) => {
    setTopics(t);
    try { await fetch('/api/local/research-topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topics: t }) }); } catch { /* */ }
  }, []);
  // saveFeed removed -- all callers now use setFeedItems(prev => ...) with inline persist to avoid stale closures
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
    // If there's a stale pending from a previous request and the agent isn't generating, force-clear it
    if (pendingRef.current && !isAgentGenerating) {
      console.warn('[ResearchPanel] Force-clearing stale pendingRef:', pendingRef.current.query);
      const staleQuery = pendingRef.current.query;
      setFeedItems(prev => prev.filter(i => !(i.pending && i.title === staleQuery)));
      pendingRef.current = null;
      unconsumedPendingRef.current = null;
    }
    if (pendingRef.current) {
      console.warn('[ResearchPanel] sendPipelineRequest blocked -- agent still generating for:', pendingRef.current.query);
      return;
    }
    console.log('[ResearchPanel] sendPipelineRequest:', opts.query, 'msgs:', chatMessages.length);
    pendingRef.current = { query: opts.query, type: opts.type, msgCount: chatMessages.length, parentId: opts.parentId, outputFormat: opts.outputFormat, extras: opts.extras };
    setFeedItems(prev => [{ id: genId(), type: opts.type, title: opts.query, summary: '', topics: [], timestamp: Date.now(), pending: true, parentId: opts.parentId, outputFormat: opts.outputFormat }, ...prev]);
    setView('research'); setSlideIndex(0);
    onSendToAgent('[RESEARCH_PIPELINE] ' + opts.prompt);
  }, [chatMessages.length, onSendToAgent, isAgentGenerating]);

  // ─── Research ───────────────────────────────────────────────────
  const doResearch = useCallback((query: string) => {
    if (!query.trim()) return;
    if (researchMode === 'deep') {
      doDeepResearch(query.trim());
      return;
    }
    sendPipelineRequest({ prompt: buildPrompt(prompts.research, { QUERY: query.trim() }), query: query.trim(), type: 'research' });
    setResearchQuery('');
  }, [prompts.research, sendPipelineRequest, researchMode]);

  const doDeepResearch = useCallback(async (query: string, context?: string, parentId?: string) => {
    if (!query.trim() || deepResearchLoading) return;
    setDeepResearchLoading(true);
    setResearchQuery('');
    setView('research');
    setSlideIndex(0);

    // Add a pending placeholder
    const pendingId = genId();
    setFeedItems(prev => [{ id: pendingId, type: 'research', title: query.trim(), summary: '', topics: [], timestamp: Date.now(), pending: true, parentId }, ...prev]);

    try {
      const resp = await fetch('/api/local/deep-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), context: context || '' }),
      });
      const data = await resp.json();

      if (data.ok && data.result) {
        const r = data.result;
        const sections: SlideSection[] = (r.sections || []).map((s: any) => ({
          heading: String(s.heading || ''),
          body: String(s.body || ''),
        }));
        const sources = (r.sources || []).filter((s: any) => s.url && s.url.startsWith('http')).map((s: any) => ({
          url: String(s.url),
          label: String(s.label || new URL(String(s.url)).hostname.replace('www.', '')),
        }));
        const followUpQuestions = Array.isArray(r.followUpQuestions) ? r.followUpQuestions.slice(0, 5) : undefined;

        const item: FeedItem & { followUpQuestions?: string[] } = {
          id: pendingId,
          type: 'research',
          title: String(r.title || query),
          summary: String(r.summary || ''),
          content: sections.map(s => `## ${s.heading}\n${s.body}`).join('\n\n'),
          sections,
          sourceUrls: sources.length > 0 ? sources : undefined,
          sourceUrl: sources[0]?.url,
          sourceName: sources[0]?.label,
          topics: Array.isArray(r.keyTopics) ? r.keyTopics.slice(0, 5) : [query.toLowerCase()],
          timestamp: Date.now(),
          parentId,
          followUpQuestions,
        };

        setFeedItems(prev => {
          const updated = prev.map(i => i.id === pendingId ? item : i);
          fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
          return updated;
        });
        setSelectedItemId(pendingId);

        // Auto-trigger design pass
        if (sections.length > 0) {
          pendingDesignPassRef.current = pendingId;
          setTimeout(() => {
            const queuedId = pendingDesignPassRef.current;
            if (queuedId) { pendingDesignPassRef.current = null; runDesignPassRef.current(queuedId); }
          }, 300);
        }
      } else {
        // Remove pending placeholder on error
        setFeedItems(prev => prev.filter(i => i.id !== pendingId));
        console.error('[DeepResearch] Error:', data.error || 'Unknown error');
      }
    } catch (e) {
      setFeedItems(prev => prev.filter(i => i.id !== pendingId));
      console.error('[DeepResearch] Fetch failed:', e);
    } finally {
      setDeepResearchLoading(false);
    }
  }, [deepResearchLoading, setView]);

  const requestBrief = useCallback(() => {
    // Check if a brief for today already exists
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const existingBrief = feedItems.find(item =>
      item.type === 'brief' && item.title.includes(todayStr) && !item.pending
    );
    if (existingBrief) {
      // Already have today's brief -- just scroll to it / highlight it
      setActiveFilter(null);
      setView('feed');
      return;
    }
    const activeTopics = topics.filter(t => t.active).map(t => t.label).join(', ');
    const title = `Daily Brief -- ${todayStr}`;
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
    // Use the slideDesigner prompt for slides -- it has data markers, narrative arc, and strict count enforcement
    const template = format === 'slides' ? prompts.slideDesigner : prompts[format];
    const prompt = buildPrompt(template, { RESEARCH: feedItemToContext(item), TOPIC: item.title, COUNT: String(count), WORD_COUNT: format === 'article' ? '1500' : '800' });
    const typeMap: Record<OutputFormat, FeedItemType> = { article: 'article', linkedin: 'social', x: 'social', instagram: 'social', slides: 'slide' };
    const label = format === 'article' ? 'Article' : format === 'slides' ? `${count}-Slide Deck` : `${count} ${format.charAt(0).toUpperCase() + format.slice(1)} Posts`;
    sendPipelineRequest({ prompt, query: `${label}: ${item.title}`, type: typeMap[format], parentId: item.id, outputFormat: format, extras: { slideCount: count } });
  }, [prompts, sendPipelineRequest]);

  // ─── Slide Designer Agent ───────────────────────────────────────
  // designSlides removed -- replaced by runDesignPass which calls /api/local/slide-design per-slide

  const editSlide = useCallback(async (item: FeedItem, sectionIndex: number, editRequest: string) => {
    if (!editRequest.trim()) return;
    // Use ref for fresh data (item param may be stale after rapid edits)
    const freshItem = feedItemsRef.current.find(i => i.id === item.id) || item;
    if (!freshItem.sections?.[sectionIndex]) return;
    const section = freshItem.sections[sectionIndex];
    const sections = freshItem.sections;
    const deckOutline = sections.map((s, i) => `${i + 1}. ${s.heading}`).join(' | ');
    const accent = SLIDE_ACCENT_COLORS[sectionIndex % SLIDE_ACCENT_COLORS.length].glow;

    setDesigningItemId(freshItem.id);
    setDesignProgress({ done: 0, total: 1 });

    try {
      console.log('[DesignPass] editSlide via backend:', { sectionIndex, editRequest });
      const resp = await fetch('/api/local/slide-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heading: section.heading,
          body: section.body,
          slideIndex: sectionIndex,
          totalSlides: sections.length,
          deckTitle: item.title,
          deckOutline,
          accentColor: accent,
          editInstruction: editRequest.trim(),
          existingHtml: section.html || '',
        }),
      });
      const data = await resp.json();
      console.log('[DesignPass] editSlide response:', { ok: data.ok, hasHtml: !!data.html, htmlLen: data.html?.length });
      if (data.ok && data.html) {
        setFeedItems(prev => {
          const updated = prev.map(fi => {
            if (fi.id !== item.id || !fi.sections) return fi;
            const newSections = [...fi.sections];
            if (newSections[sectionIndex]) {
              newSections[sectionIndex] = { ...newSections[sectionIndex], html: data.html };
            }
            return { ...fi, sections: newSections };
          });
          fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
          return updated;
        });
      }
    } catch (e) {
      console.warn('[DesignPass] editSlide failed:', e);
    }

    setDesigningItemId(null);
    setDesignProgress({ done: 0, total: 0 });
  }, []);

  // ─── Design Pass -- generates HTML for each slide via dedicated LLM call ───
  const runDesignPass = useCallback(async (itemId: string) => {
    // Find the item in current state via ref (avoids broken setFeedItems side-effect read)
    const item = feedItemsRef.current.find(i => i.id === itemId);
    console.log(`[DesignPass] runDesignPass called for itemId=${itemId}, found=${!!item}, sections=${item?.sections?.length ?? 0}, allItemIds=${feedItemsRef.current.map(i => i.id).join(',')}`);
    if (!item?.sections?.length) {
      console.warn(`[DesignPass] SKIPPED -- no item or no sections for itemId=${itemId}`);
      return;
    }

    // Abort any in-progress design pass
    designAbortRef.current?.abort();
    const abort = new AbortController();
    designAbortRef.current = abort;

    const sections = item.sections;
    const deckOutline = sections.map((s, i) => `${i + 1}. ${s.heading}`).join(' | ');
    setDesigningItemId(itemId);
    setDesignProgress({ done: 0, total: sections.length });

    // Only design slides that don't already have HTML (skip already-designed)
    const needsDesign = sections.map((s, i) => ({ index: i, hasHtml: !!s.html }));
    const toDesign = needsDesign.filter(s => !s.hasHtml).map(s => s.index);
    const alreadyDone = needsDesign.filter(s => s.hasHtml).length;
    console.log(`[DesignPass] Starting design pass for ${sections.length} slides, itemId=${itemId}. ${alreadyDone} already designed, ${toDesign.length} to design.`);
    
    if (toDesign.length === 0) {
      console.log(`[DesignPass] All ${sections.length} slides already have HTML — nothing to do.`);
      setDesigningItemId(null);
      setDesignProgress({ done: 0, total: 0 });
      designAbortRef.current = null;
      return;
    }

    // ── Step 1: Batch pre-compute UNIQUE map locations for all slides at once ──
    let batchMaps: Array<{ mapContext: string; coords: number[][] }> = [];
    try {
      console.log(`[DesignPass] Calling batch-map-locations for ${sections.length} slides...`);
      const batchResp = await fetch('/api/local/batch-map-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          slides: sections.map(s => ({ heading: s.heading, body: s.body })),
          researchQuery: item!.title,
          accentColor: SLIDE_ACCENT_COLORS[0].glow,
        }),
      });
      if (batchResp.ok) {
        const batchData = await batchResp.json();
        if (batchData.ok && batchData.maps) {
          batchMaps = batchData.maps;
          const mapsCount = batchMaps.filter((m: { mapContext: string }) => m.mapContext).length;
          console.log(`[DesignPass] Batch maps: ${mapsCount}/${sections.length} slides have unique maps`);
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setDesigningItemId(null); return; }
      console.warn('[DesignPass] Batch map failed, will fall back to per-slide:', e);
    }

    // ── Step 2: Design all slides in PARALLEL with pre-assigned map data ──
    let completedCount = alreadyDone;

    const designOneSlide = async (i: number): Promise<boolean> => {
      const section = sections[i];
      const accent = SLIDE_ACCENT_COLORS[i % SLIDE_ACCENT_COLORS.length].glow;
      const precomputedMap = batchMaps[i]?.mapContext || '';
      if (abort.signal.aborted) return false;
      try {
        console.log(`[DesignPass] Requesting slide ${i + 1}/${sections.length}: "${section.heading}"${precomputedMap ? ' (with precomputed map)' : ''}`);
        const resp = await fetch('/api/local/slide-design', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({
            heading: section.heading,
            body: section.body,
            slideIndex: i,
            totalSlides: sections.length,
            deckTitle: item!.title,
            deckOutline,
            accentColor: accent,
            skipMap: !!precomputedMap,
            researchQuery: item!.title,
            precomputedMapContext: precomputedMap,
          }),
        });
        if (abort.signal.aborted) return false;
        if (!resp.ok) {
          const errorText = await resp.text().catch(() => '');
          console.warn(`[DesignPass] Slide ${i + 1} HTTP ${resp.status}: ${errorText.slice(0, 200)}`);
          return false;
        }
        const data = await resp.json();
        console.log(`[DesignPass] Slide ${i + 1}:`, { ok: data.ok, htmlLen: data.html?.length, error: data.error });
        if (data.ok && data.html) {
          setFeedItems(prev => {
            const targetItem = prev.find(fi => fi.id === itemId);
            if (!targetItem) {
              console.error(`[DesignPass] CRITICAL: item ${itemId} NOT FOUND in feedItems! itemIds: ${prev.map(fi => fi.id).join(',')}`);
              return prev;
            }
            const updated = prev.map(fi => {
              if (fi.id !== itemId || !fi.sections) return fi;
              const newSections = [...fi.sections];
              if (newSections[i]) newSections[i] = { ...newSections[i], html: data.html };
              return { ...fi, sections: newSections };
            });
            fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
            return updated;
          });
          completedCount++;
          setDesignProgress({ done: completedCount, total: sections.length });
          return true;
        }
        return false;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return false;
        console.warn(`[DesignPass] Slide ${i + 1} error:`, e);
        return false;
      }
    };

    // Fire all slide designs in parallel (max 3 concurrent to avoid overwhelming backend)
    const MAX_CONCURRENT = 3;
    const failed: number[] = [];
    for (let batch = 0; batch < toDesign.length; batch += MAX_CONCURRENT) {
      if (abort.signal.aborted) break;
      const chunk = toDesign.slice(batch, batch + MAX_CONCURRENT);
      const results = await Promise.all(chunk.map(i => designOneSlide(i)));
      results.forEach((ok, idx) => {
        if (!ok && !abort.signal.aborted) failed.push(chunk[idx]);
      });
    }

    // Retry pass for any slides that failed
    if (failed.length > 0 && !abort.signal.aborted) {
      console.log(`[DesignPass] Retry pass for ${failed.length} failed slides: [${failed.map(i => i + 1).join(', ')}]`);
      await new Promise(r => setTimeout(r, 3000));
      for (const i of failed) {
        if (abort.signal.aborted) break;
        const ok = await designOneSlide(i);
        console.log(`[DesignPass] Retry slide ${i + 1}: ${ok ? 'SUCCESS' : 'FAILED'}`);
      }
    }

    // Definitive diagnostic: check which slides actually have HTML in state
    const finalItem = feedItemsRef.current.find(fi => fi.id === itemId);
    if (finalItem?.sections) {
      const slideStatus = finalItem.sections.map((s, idx) => `${idx + 1}:${s.html ? 'OK(' + s.html.length + ')' : 'MISSING'}`);
      const designed = finalItem.sections.filter(s => s.html).length;
      console.log(`[DesignPass] FINAL STATUS for itemId=${itemId}: ${designed}/${finalItem.sections.length} designed. ${slideStatus.join(' | ')}`);
      if (failed.length > 0) console.warn(`[DesignPass] Failed slide indices (0-based): [${failed.join(', ')}]`);
    } else {
      console.error(`[DesignPass] CRITICAL: item ${itemId} not found in feedItemsRef at end of pass!`);
    }
    setDesigningItemId(null);
    setDesignProgress({ done: 0, total: 0 });
    designAbortRef.current = null;
  }, []);
  // Keep ref in sync so the useEffect can call it
  runDesignPassRef.current = runDesignPass;

  const redesignSingleSlide = useCallback(async (itemId: string, sectionIndex: number) => {
    console.log('[DesignPass] redesignSingleSlide called:', { itemId, sectionIndex });
    const item = feedItemsRef.current.find(i => i.id === itemId);
    if (!item?.sections?.[sectionIndex]) {
      console.warn('[DesignPass] redesignSingleSlide: item or section not found', { itemId, sectionIndex, itemFound: !!item, sectionsLen: item?.sections?.length });
      return;
    }

    const section = item.sections[sectionIndex];
    const sections = item.sections;
    const deckOutline = sections.map((s, i) => `${i + 1}. ${s.heading}`).join(' | ');
    const accent = SLIDE_ACCENT_COLORS[sectionIndex % SLIDE_ACCENT_COLORS.length].glow;

    setDesigningItemId(itemId);
    setDesignProgress({ done: 0, total: 1 });

    try {
      console.log('[DesignPass] Fetching /api/local/slide-design for slide', sectionIndex + 1, section.heading);
      const resp = await fetch('/api/local/slide-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heading: section.heading,
          body: section.body,
          slideIndex: sectionIndex,
          totalSlides: sections.length,
          deckTitle: item.title,
          deckOutline,
          accentColor: accent,
        }),
      });
      const data = await resp.json();
      console.log('[DesignPass] Response:', { ok: data.ok, hasHtml: !!data.html, error: data.error, htmlLen: data.html?.length });
      if (data.ok && data.html) {
        setFeedItems(prev => {
          const updated = prev.map(fi => {
            if (fi.id !== itemId || !fi.sections) return fi;
            const newSections = [...fi.sections];
            if (newSections[sectionIndex]) {
              newSections[sectionIndex] = { ...newSections[sectionIndex], html: data.html };
            }
            return { ...fi, sections: newSections };
          });
          fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
          return updated;
        });
      }
    } catch (e) {
      console.warn(`[DesignPass] Single slide ${sectionIndex + 1} failed:`, e);
    }

    setDesigningItemId(null);
    setDesignProgress({ done: 0, total: 0 });
  }, []);

  // ─── Other actions ──────────────────────────────────────────────
  const digDeeper = useCallback((item: FeedItem) => {
    const context = feedItemToContext(item);
    doDeepResearch(`Dig deeper into: ${item.title}. Expand on key findings, find additional sources, and explore angles not covered.`, context, item.id);
  }, [doDeepResearch]);
  const exportSlide = useCallback(async (el: HTMLElement | null, transparent = false) => {
    if (!el) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(el, { backgroundColor: transparent ? null : '#0a0a12', scale: 2, useCORS: true, allowTaint: true });
      const link = document.createElement('a');
      link.download = `research-slide-${Date.now()}${transparent ? '-transparent' : ''}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // Fallback: copy slide text to clipboard
      const text = el.innerText || '';
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch { /* clipboard also failed -- nothing we can do */ }
      }
    }
  }, []);
  const copyContent = useCallback(async (item: FeedItem) => {
    // Build readable text: prefer sections (slide decks), then content, then summary
    let text = '';
    if (item.sections && item.sections.length > 0) {
      text = item.sections.map(s => `## ${s.heading}\n${s.body}`).join('\n\n');
    }
    if (!text) text = item.content || item.summary || '';
    if (text) await navigator.clipboard.writeText(text).catch(() => {});
  }, []);
  const toggleSaved = useCallback((id: string) => {
    setFeedItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, saved: !i.saved } : i);
      fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
      return updated;
    });
  }, []);
  const deleteFeedItem = useCallback((id: string) => {
    setFeedItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
      return updated;
    });
  }, []);
  const editFeedItem = useCallback((id: string, patch: Partial<FeedItem>) => {
    setFeedItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, ...patch } : i);
      fetch('/api/local/research-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: updated }) }).catch(() => {});
      return updated;
    });
  }, []);

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
          label: heading.length > 35 ? heading.slice(0, 32) + '...' : heading,
          query: `Expand on: ${heading}. Provide deeper analysis, latest developments, and expert perspectives.`,
          kind: 'deepen',
        });
      }
    }

    // 2. Cross-reference suggestions -- find connections between different research items
    if (recentTitles.length >= 2) {
      const t1 = recentTitles[0], t2 = recentTitles[1];
      suggestions.push({
        label: `Connect: ${t1.slice(0, 18)}... + ${t2.slice(0, 18)}...`,
        query: `Analyze the intersection and connections between "${t1}" and "${t2}". How do these topics relate, influence, or contradict each other?`,
        kind: 'cross',
      });
    }

    // 3. Trend/future suggestions based on existing research
    if (completed.length > 0) {
      const latest = completed[0];
      suggestions.push({
        label: `Future of ${latest.title.slice(0, 28)}...`,
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
                  placeholder="Topic or keywords (comma-separated)..."
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
                placeholder="Optional: RSS feed or news URL..."
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
          {/* Search bar -- always visible */}
          <div className="px-4 py-3 border-b border-white/[0.04] shrink-0">
            <div className="flex items-center gap-2">
              {selectedItemId && (
                <button onClick={() => { setSelectedItemId(null); setSlideIndex(0); }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] border border-white/[0.06] transition-all shrink-0" title="Back to gallery">
                  <ChevronLeft size={14} />
                </button>
              )}
              <div className={`flex-1 flex items-center gap-1.5 bg-white/[0.04] border rounded-xl px-3 py-2 transition-all ${
                researchMode === 'deep' ? 'border-violet-400/20 focus-within:border-violet-400/35' : 'border-white/[0.06] focus-within:border-indigo-400/25'
              }`}>
                <Search size={12} className="text-white/25 shrink-0" />
                <input value={researchQuery} onChange={e => setResearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doResearch(researchQuery); }}
                  placeholder={researchMode === 'deep' ? 'Deep research (Gemini + Google Search)...' : 'Research anything...'}
                  className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/20 outline-none" disabled={isPending || deepResearchLoading} />
              </div>
              {/* Quick / Deep mode toggle */}
              <button
                onClick={() => setResearchMode(m => m === 'quick' ? 'deep' : 'quick')}
                className={`px-2.5 py-2 rounded-xl border text-[10px] font-semibold transition-all shrink-0 ${
                  researchMode === 'deep'
                    ? 'bg-violet-500/20 border-violet-400/25 text-violet-300'
                    : 'bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]'
                }`}
                title={researchMode === 'deep' ? 'Deep Research: Gemini with Google Search grounding (slower, more thorough)' : 'Quick Research: Agent pipeline (faster)'}
              >
                {researchMode === 'deep' ? '◉ Deep' : '○ Quick'}
              </button>
              <button onClick={() => doResearch(researchQuery)} disabled={!researchQuery.trim() || isPending || deepResearchLoading}
                className={`px-4 py-2 rounded-xl border text-[11px] font-medium transition-all disabled:opacity-30 ${
                  researchMode === 'deep'
                    ? 'bg-violet-500/15 border-violet-400/15 text-violet-300/80 hover:bg-violet-500/25'
                    : 'bg-indigo-500/15 border-indigo-400/15 text-indigo-300/80 hover:bg-indigo-500/25'
                }`}>
                {(isPending || deepResearchLoading) ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
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
                      const designedCount = item.sections?.filter(s => s.html)?.length ?? 0;
                      const isFullyDesigned = sectionCount > 0 && designedCount === sectionCount;
                      const isPartialDesigned = designedCount > 0 && designedCount < sectionCount;
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
                          {/* Type badge + design status */}
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${typeBg[item.type]}`}>{typeIcons[item.type]}</span>
                            <span className="text-[8px] text-white/25 uppercase tracking-wider font-semibold">{item.type}</span>
                            {isFullyDesigned && (
                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/15 text-emerald-400/60">
                                <Check size={7} /> Designed
                              </span>
                            )}
                            {isPartialDesigned && (
                              <span className="text-[7px] font-bold uppercase tracking-wider text-amber-400/40">{designedCount}/{sectionCount}</span>
                            )}
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
            <div className="flex-1 overflow-hidden flex flex-col"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'ArrowLeft' && slideIndex > 0) { e.preventDefault(); setSlideIndex(slideIndex - 1); }
                if (e.key === 'ArrowRight' && slideIndex < presentationSlides.length - 1) { e.preventDefault(); setSlideIndex(slideIndex + 1); }
                if (e.key === 'Home') { e.preventDefault(); setSlideIndex(0); }
                if (e.key === 'End') { e.preventDefault(); setSlideIndex(presentationSlides.length - 1); }
              }}
              style={{ outline: 'none' }}
            >
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
                  {/* Thumbnail strip */}
                  <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto shrink-0 border-b border-white/[0.02]" style={{ scrollbarWidth: 'none' }}>
                    {presentationSlides.map((s, i) => {
                      const thumbAccent = SLIDE_ACCENT_COLORS[(s.sectionIndex ?? i) % SLIDE_ACCENT_COLORS.length];
                      const isActive = i === slideIndex;
                      const isSection = s.kind === 'section';
                      const hasHtml = isSection && s.sectionIndex != null && s.feedItem.sections?.[s.sectionIndex]?.html;
                      return (
                        <button key={i} onClick={() => setSlideIndex(i)}
                          className={`shrink-0 rounded-lg transition-all duration-200 flex flex-col items-center justify-center gap-0.5 ${isActive ? 'ring-1 scale-105' : 'opacity-50 hover:opacity-80'}`}
                          style={{
                            width: 52, height: 36,
                            background: isActive ? `linear-gradient(135deg, ${thumbAccent.glow}15, ${thumbAccent.glow}05)` : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${isActive ? thumbAccent.glow + '40' : 'rgba(255,255,255,0.04)'}`,
                            boxShadow: isActive ? `0 0 0 1px ${thumbAccent.glow}50` : undefined,
                          }}>
                          <span className="text-[6px] font-bold uppercase tracking-wider truncate max-w-[46px] px-0.5"
                            style={{ color: isActive ? `${thumbAccent.glow}cc` : 'rgba(255,255,255,0.25)' }}>
                            {s.kind === 'title' ? 'Title' : s.kind === 'sources' ? 'Src' : s.kind === 'actions' ? 'More' : `${(s.sectionIndex ?? 0) + 1}`}
                          </span>
                          {isSection && (
                            <div className="w-4 h-[2px] rounded-full" style={{
                              background: hasHtml ? `${thumbAccent.glow}60` : 'rgba(255,255,255,0.08)',
                            }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {/* Active slide with fade transition */}
                  <div className="flex-1 overflow-y-auto p-4" ref={slideRef}>
                    {presentationSlides[slideIndex] && (() => {
                      const currentSlide = presentationSlides[slideIndex];
                      const isCurrentDesigning = designingItemId === currentSlide.feedItem.id;
                      const isSection = currentSlide.kind === 'section' && currentSlide.sectionIndex != null;
                      const sectionHasHtml = isSection && currentSlide.feedItem.sections?.[currentSlide.sectionIndex!]?.html;
                      const sectionHasContent = isSection && currentSlide.feedItem.sections?.[currentSlide.sectionIndex!]?.body;
                      const showDesignOverlay = isCurrentDesigning && isSection && !sectionHasHtml;

                      return (
                        <div key={slideIndex} className="animate-[fadeIn_200ms_ease-out] relative">
                          {/* Always show the SlideCard — it renders the default layout or designed HTML */}
                          <SlideCard slide={currentSlide}
                            onExport={(el, transparent) => exportSlide(el || slideRef.current?.firstElementChild as HTMLElement || slideRef.current, transparent)}
                            onDigDeeper={() => digDeeper(currentSlide.feedItem)}
                            onSave={() => toggleSaved(currentSlide.feedItem.id)}
                            onCopy={() => copyContent(currentSlide.feedItem)}
                            onFollowUp={(q: string) => askFollowUp(currentSlide.feedItem, q)}
                            onGenerate={(f: OutputFormat, c: number) => generateOutput(currentSlide.feedItem, f, c)}
                            onEditItem={(patch: Partial<FeedItem>) => editFeedItem(currentSlide.feedItem.id, patch)}
                            onDesignSlides={() => runDesignPass(currentSlide.feedItem.id)}
                            onEditSlide={(si: number, req: string) => editSlide(currentSlide.feedItem, si, req)}
                            onRedesignSlide={(si: number) => redesignSingleSlide(currentSlide.feedItem.id, si)}
                            isDesigning={isCurrentDesigning}
                            designProgress={designProgress}
                            isPending={isPending} />
                          {/* Designing overlay — shown on top of existing content while design is in progress */}
                          {showDesignOverlay && sectionHasContent && (
                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-400/15 z-10"
                              style={{ background: 'rgba(10,10,18,0.85)', backdropFilter: 'blur(8px)' }}>
                              <Loader2 size={10} className="text-indigo-400/60 animate-spin" />
                              <span className="text-[9px] text-indigo-300/50 font-medium">Designing slide {(currentSlide.sectionIndex ?? 0) + 1}...</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
        {text ? (<>{text.slice(0, 500)}{text.length > 500 && '...'}<span className="inline-block w-1 h-3 bg-indigo-400/50 ml-0.5 animate-pulse rounded-sm" /></>) : (
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
            placeholder="Ask a follow-up..." disabled={isPending}
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
      {/* Pipeline -- generate outputs */}
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

    // Bullet with bold lead: * **Lead**: text  or  - **Lead**: text
    const bulletBoldMatch = line.match(/^[*\-\*]\s*\*\*(.+?)\*\*:?\s*(.*)/);
    if (bulletBoldMatch) { flushParagraph(); blocks.push({ type: 'bullet', lead: bulletBoldMatch[1], text: bulletBoldMatch[2] }); continue; }

    // Plain bullet: * text or - text
    const bulletPlainMatch = line.match(/^[*\-\*]\s+(.+)/);
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
    return <div className="text-[12px] text-white/45 leading-[1.85] whitespace-pre-wrap font-light">{body}</div>;
  }

  // Track bullet index for numbered styling
  let bulletIdx = 0;

  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'stat':
            return (
              <div key={i} className="relative py-4 px-5 rounded-2xl overflow-hidden"
                style={{ backgroundColor: `${accentColor}05`, border: `1px solid ${accentColor}0c`, boxShadow: `0 8px 32px ${accentColor}06, inset 0 1px 0 ${accentColor}08` }}>
                {/* Large stat value -- hero scale */}
                <div className="flex items-end gap-4">
                  <div className="flex-shrink-0 relative">
                    <div className="text-[36px] font-black tracking-[-0.04em] leading-none bg-clip-text text-transparent"
                      style={{ backgroundImage: `linear-gradient(145deg, ${accentColor}ff, ${accentColor}80, ${accentColor}50)` }}>
                      {block.value}
                    </div>
                    {/* Double glow halo */}
                    <div className="absolute -inset-6 rounded-full opacity-[0.06] blur-2xl pointer-events-none" style={{ backgroundColor: accentColor }} />
                    <div className="absolute -inset-12 rounded-full opacity-[0.03] blur-3xl pointer-events-none" style={{ backgroundColor: accentColor }} />
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="w-8 h-[1px] rounded-full mb-2" style={{ background: `linear-gradient(90deg, ${accentColor}40, transparent)` }} />
                    <div className="text-[11px] text-white/45 leading-[1.6] font-light">{block.description}</div>
                  </div>
                </div>
                {/* Corner glow */}
                <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-[0.03] pointer-events-none" style={{ backgroundColor: accentColor }} />
              </div>
            );

          case 'quote':
            return (
              <div key={i} className="relative py-4 px-6 my-1 rounded-xl overflow-hidden"
                style={{ backgroundColor: `${accentColor}03`, border: `1px solid ${accentColor}08` }}>
                {/* Thick accent left border */}
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full"
                  style={{ background: `linear-gradient(180deg, ${accentColor}70, ${accentColor}30, ${accentColor}08)` }} />
                {/* Oversized decorative quote mark -- watermark style */}
                <div className="absolute -top-2 -left-1 text-[80px] leading-none font-serif select-none pointer-events-none"
                  style={{ color: `${accentColor}08` }}>{'\u201C'}</div>
                {/* Quote text -- larger, more dramatic */}
                <div className="relative z-10 text-[14px] text-white/55 italic leading-[1.8] font-light">{renderInlineBold(block.text)}</div>
              </div>
            );

          case 'bullet': {
            const idx = ++bulletIdx;
            return (
              <div key={i} className="flex items-start gap-3.5 pl-0.5">
                {/* Gradient number instead of dot */}
                <div className="flex-shrink-0 mt-[1px]">
                  <span className="text-[16px] font-black tabular-nums leading-none bg-clip-text text-transparent"
                    style={{ backgroundImage: `linear-gradient(160deg, ${accentColor}bb, ${accentColor}50)` }}>
                    {String(idx).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex-1 pt-[2px]">
                  <div className="text-[11.5px] font-bold text-white/70 leading-[1.4] mb-0.5">{block.lead}</div>
                  {block.text && <div className="text-[10.5px] text-white/35 leading-[1.75] font-light">{renderInlineBold(block.text)}</div>}
                </div>
              </div>
            );
          }

          case 'bullet-plain': {
            return (
              <div key={i} className="flex items-start gap-3 pl-0.5">
                <div className="flex-shrink-0 mt-[3px]">
                  <div className="w-[6px] h-[6px] rounded-sm"
                    style={{ backgroundColor: `${accentColor}30`, boxShadow: `0 0 8px ${accentColor}10` }} />
                </div>
                <div className="text-[11px] text-white/42 leading-[1.75]">{renderInlineBold(block.text)}</div>
              </div>
            );
          }

          case 'paragraph':
            return (
              <p key={i} className="text-[11.5px] text-white/40 leading-[1.85] font-light">{renderInlineBold(block.text)}</p>
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
    <div className="flex flex-col justify-center flex-1 relative overflow-hidden">
      {/* Diagonal accent band -- sweeps across the slide */}
      <div className="absolute -top-20 -right-20 w-[200%] h-40 rotate-[-8deg] pointer-events-none"
        style={{ background: `linear-gradient(180deg, transparent, ${accentColor}04, transparent)` }} />
      {/* Asymmetric layout: huge number left, context right */}
      <div className="flex items-end gap-6 relative z-10">
        <div className="flex-shrink-0 relative">
          {/* The hero number */}
          <div className="text-[64px] font-black tracking-[-0.05em] leading-[0.85] bg-clip-text text-transparent"
            style={{ backgroundImage: `linear-gradient(160deg, ${accentColor}ff, ${accentColor}90, ${accentColor}40)` }}>
            {meta?.statValue || '\u2014'}
          </div>
          {/* Underline accent bar */}
          <div className="h-[3px] rounded-full mt-2"
            style={{ background: `linear-gradient(90deg, ${accentColor}cc, ${accentColor}30, transparent)`, width: '80%' }} />
          {/* Glow halo */}
          <div className="absolute -inset-8 rounded-full opacity-[0.05] blur-3xl pointer-events-none" style={{ backgroundColor: accentColor }} />
        </div>
        {/* Label + context */}
        <div className="flex-1 pb-2">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] mb-2"
            style={{ color: `${accentColor}70` }}>
            {'\u25B8'} Key Metric
          </div>
          <div className="text-[14px] text-white/55 leading-[1.65] font-light">
            {meta?.statLabel || section.body}
          </div>
        </div>
      </div>
      {/* Supporting body below if different */}
      {section.body && meta?.statLabel && (
        <div className="mt-5 pt-4 relative z-10" style={{ borderTop: `1px solid ${accentColor}0a` }}>
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
}

function LayoutBigNumber({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center relative overflow-hidden">
      {/* Background: concentric rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[280px] h-[280px] rounded-full border opacity-[0.03]" style={{ borderColor: accentColor }} />
        <div className="absolute w-[200px] h-[200px] rounded-full border opacity-[0.05]" style={{ borderColor: accentColor }} />
        <div className="absolute w-[120px] h-[120px] rounded-full border opacity-[0.07]" style={{ borderColor: accentColor }} />
      </div>
      {/* Micro label above */}
      <div className="text-[8px] font-bold uppercase tracking-[0.3em] mb-4 relative z-10"
        style={{ color: `${accentColor}60` }}>
        {'\u2588\u2588'} Data Point
      </div>
      {/* The colossal number */}
      <div className="relative z-10">
        <div className="text-[72px] font-black tracking-[-0.05em] leading-[0.8] bg-clip-text text-transparent"
          style={{ backgroundImage: `linear-gradient(170deg, rgba(255,255,255,0.95) 20%, ${accentColor}cc 60%, ${accentColor}50 100%)` }}>
          {meta?.statValue || '\u2014'}
        </div>
      </div>
      {/* Wide gradient divider */}
      <div className="w-24 h-[2px] rounded-full my-5 z-10"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}60, transparent)` }} />
      {/* Description text -- wider */}
      {meta?.statLabel && (
        <div className="text-[14px] text-white/42 font-light max-w-[85%] leading-[1.7] tracking-wide z-10">
          {meta.statLabel}
        </div>
      )}
    </div>
  );
}

function LayoutTwoColumn({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col flex-1 gap-3">
      <div className="flex-1 relative" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Left column -- accent top border */}
        <div className="rounded-2xl p-4 relative overflow-hidden"
          style={{ backgroundColor: `${accentColor}04`, borderTop: `2px solid ${accentColor}30` }}>
          {/* Column indicator */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[20px] font-black leading-none bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}cc, ${accentColor}50)` }}>A</span>
            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${accentColor}20, transparent)` }} />
          </div>
          <RichSlideBody body={meta?.leftColumn || ''} accentColor={accentColor} />
        </div>
        {/* Right column -- neutral top border */}
        <div className="rounded-2xl p-4 relative overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderTop: '2px solid rgba(255,255,255,0.08)' }}>
          {/* Column indicator */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[20px] font-black text-white/20 leading-none">B</span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
          <RichSlideBody body={meta?.rightColumn || ''} accentColor={accentColor} />
        </div>
        {/* Arrow between columns */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px]"
            style={{ backgroundColor: 'rgba(10,10,18,0.9)', border: `1px solid ${accentColor}20`, color: `${accentColor}70` }}>
            {'\u21C0'}
          </div>
        </div>
      </div>
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
  const maxPoints = Math.max(left?.points?.length || 0, right?.points?.length || 0);
  return (
    <div className="flex flex-col flex-1 gap-2">
      {/* Scorecard-style table */}
      <div className="flex-1 rounded-2xl overflow-hidden" style={{ border: `1px solid ${accentColor}0c` }}>
        {/* Header row */}
        <div className="grid grid-cols-2 relative">
          <div className="px-4 py-2.5" style={{ backgroundColor: `${accentColor}08`, borderBottom: `1px solid ${accentColor}12` }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `${accentColor}cc`, boxShadow: `0 0 8px ${accentColor}40` }} />
              <span className="text-[11px] font-bold bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}ee, ${accentColor}80)` }}>
                {left?.title || 'Option A'}
              </span>
            </div>
          </div>
          <div className="px-4 py-2.5" style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <span className="text-[11px] font-bold text-white/50">{right?.title || 'Option B'}</span>
            </div>
          </div>
          {/* Centered VS divider */}
          <div className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-px z-10"
            style={{ background: `linear-gradient(180deg, ${accentColor}30, rgba(255,255,255,0.06))` }} />
        </div>
        {/* Data rows */}
        {Array.from({ length: maxPoints }).map((_, i) => (
          <div key={i} className="grid grid-cols-2 relative"
            style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
            <div className="px-4 py-2" style={{ borderBottom: `1px solid ${accentColor}06` }}>
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-bold tabular-nums mt-0.5 bg-clip-text text-transparent"
                  style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}90, ${accentColor}50)` }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[10px] text-white/45 leading-[1.6]">{left?.points?.[i] ? renderInlineBold(left.points[i]) : '\u2014'}</span>
              </div>
            </div>
            <div className="px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-bold tabular-nums text-white/15 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[10px] text-white/40 leading-[1.6]">{right?.points?.[i] ? renderInlineBold(right.points[i]) : '\u2014'}</span>
              </div>
            </div>
            <div className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-px"
              style={{ background: i % 2 === 0 ? `${accentColor}06` : 'rgba(255,255,255,0.02)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LayoutQuoteHighlight({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 relative overflow-hidden">
      {/* Massive watermark quote mark -- truly cinematic scale */}
      <div className="absolute top-[-30px] left-[-10px] text-[160px] leading-none font-serif select-none pointer-events-none"
        style={{ color: `${accentColor}06` }}>{'\u201C'}</div>
      <div className="absolute bottom-[-50px] right-[-10px] text-[160px] leading-none font-serif select-none pointer-events-none rotate-180"
        style={{ color: `${accentColor}04` }}>{'\u201C'}</div>
      {/* Accent top rule */}
      <div className="w-12 h-[2px] rounded-full mb-6"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)` }} />
      {/* Quote text -- large, dramatic, centered */}
      <div className="relative z-10 max-w-[92%]">
        <div className="text-[20px] text-white/60 italic leading-[1.7] font-light tracking-[-0.01em]">
          {meta?.quoteText || section.body}
        </div>
      </div>
      {/* Attribution with decorative flanking elements */}
      {meta?.quoteAttribution && (
        <div className="flex items-center gap-4 mt-6 relative z-10">
          <div className="w-16 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}25)` }} />
          <div className="flex items-center gap-2">
            <div className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: `${accentColor}60` }} />
            <span className="text-[9px] font-bold uppercase tracking-[0.25em]" style={{ color: `${accentColor}90` }}>
              {meta.quoteAttribution}
            </span>
          </div>
          <div className="w-16 h-px" style={{ background: `linear-gradient(90deg, ${accentColor}25, transparent)` }} />
        </div>
      )}
      {/* Supporting body if different from quote */}
      {section.body && meta?.quoteText && section.body !== meta.quoteText && (
        <div className="mt-5 max-w-[85%] relative z-10">
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
    <div className="flex flex-col flex-1 gap-3">
      {/* Timeline as horizontal cards connected by arrows */}
      <div className="flex-1 overflow-y-auto glass-scroll">
        <div className="space-y-2">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            const progress = items.length > 1 ? i / (items.length - 1) : 0;
            return (
              <div key={i}>
                {/* Event card */}
                <div className="flex items-start gap-3 rounded-xl p-3 relative overflow-hidden"
                  style={{
                    backgroundColor: isLast ? `${accentColor}06` : 'rgba(255,255,255,0.015)',
                    border: isLast ? `1px solid ${accentColor}15` : '1px solid rgba(255,255,255,0.04)',
                  }}>
                  {/* Left: date badge */}
                  <div className="flex-shrink-0 w-[52px] text-center">
                    <div className="rounded-lg px-2 py-1.5"
                      style={{
                        backgroundColor: isLast ? `${accentColor}12` : 'rgba(255,255,255,0.03)',
                        border: isLast ? `1px solid ${accentColor}20` : '1px solid rgba(255,255,255,0.04)',
                      }}>
                      <div className="text-[9px] font-black uppercase tracking-[0.1em] bg-clip-text text-transparent"
                        style={{ backgroundImage: isLast
                          ? `linear-gradient(135deg, ${accentColor}ee, ${accentColor}80)`
                          : `linear-gradient(135deg, rgba(255,255,255,${0.3 + progress * 0.3}), rgba(255,255,255,${0.15 + progress * 0.2}))` }}>
                        {item.date}
                      </div>
                    </div>
                  </div>
                  {/* Right: event text */}
                  <div className="flex-1 pt-0.5">
                    <div className={`text-[11px] leading-[1.65] ${isLast ? 'text-white/60 font-medium' : 'text-white/40'}`}>
                      {renderInlineBold(item.event)}
                    </div>
                  </div>
                  {/* Progress indicator bar on left edge */}
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full"
                    style={{ background: `linear-gradient(180deg, ${accentColor}${isLast ? '80' : Math.round(20 + progress * 40).toString(16).padStart(2, '0')}, transparent)` }} />
                </div>
                {/* Connector arrow between events */}
                {!isLast && (
                  <div className="flex justify-center py-0.5">
                    <div className="text-[10px]" style={{ color: `${accentColor}25` }}>{'\u25BE'}</div>
                  </div>
                )}
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
      {items.length === 0 && (
        <RichSlideBody body={section.body} accentColor={accentColor} />
      )}
    </div>
  );
}

function LayoutKeyTakeaway({ section, accentColor }: { section: SlideSection; accentColor: string }) {
  const meta = section.layoutMeta;
  return (
    <div className="flex flex-col justify-center flex-1 px-2 relative overflow-hidden">
      {/* Background: diagonal accent strip */}
      <div className="absolute -top-10 -left-10 w-[120%] h-[120%] rotate-[-3deg] pointer-events-none"
        style={{ background: `linear-gradient(180deg, transparent 45%, ${accentColor}03 50%, transparent 55%)` }} />
      {/* Takeaway callout box */}
      <div className="relative z-10 rounded-2xl p-6 overflow-hidden"
        style={{
          backgroundColor: `${accentColor}04`,
          border: `1px solid ${accentColor}10`,
          borderLeft: `4px solid ${accentColor}60`,
          boxShadow: `0 12px 40px ${accentColor}06`,
        }}>
        {/* Label */}
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={13} style={{ color: `${accentColor}bb` }} />
          <span className="text-[8px] font-bold uppercase tracking-[0.25em]" style={{ color: `${accentColor}70` }}>
            Key Takeaway
          </span>
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${accentColor}15, transparent)` }} />
        </div>
        {/* Big statement -- gradient text, much larger */}
        <div className="text-[20px] font-bold leading-[1.45] tracking-[-0.02em] bg-clip-text text-transparent"
          style={{ backgroundImage: `linear-gradient(160deg, rgba(255,255,255,0.92) 10%, rgba(255,255,255,0.60) 50%, ${accentColor}60 120%)` }}>
          {meta?.takeaway || section.body}
        </div>
      </div>
      {/* Supporting body below the callout */}
      {section.body && meta?.takeaway && section.body !== meta.takeaway && (
        <div className="mt-5 px-1 relative z-10">
          <RichSlideBody body={section.body} accentColor={accentColor} />
        </div>
      )}
    </div>
  );
}

/** Sanitize agent-generated HTML -- strip dangerous tags but keep styling */
function sanitizeSlideHtml(html: string): string {
  // Remove script, iframe, link, style, object, embed, form tags
  let clean = html.replace(/<\s*\/?\s*(script|iframe|link|style|object|embed|form|meta|base)\b[^>]*>/gi, '');
  // Remove event handlers (onclick, onerror, onload, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s+on\w+\s*=\s*\S+/gi, '');
  // Remove javascript: urls
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  // Strip max-height + overflow:hidden ONLY from the root div (first tag), not descendants
  const rootClose = clean.indexOf('>');
  if (rootClose > 0) {
    let rootTag = clean.slice(0, rootClose + 1);
    rootTag = rootTag.replace(/max-height\s*:\s*\d+px\s*;?/gi, '');
    rootTag = rootTag.replace(/overflow\s*:\s*hidden\s*;?/gi, '');
    clean = rootTag + clean.slice(rootClose + 1);
  }
  return clean;
}

/** WYSIWYG + raw HTML slide editor -- click text to edit, floating toolbar for styles */
function AgentHtmlSlide({ html, onEdit }: { html: string; onEdit?: (newHtml: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'view' | 'wysiwyg' | 'code'>('view');
  const [editHtml, setEditHtml] = useState(html);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 });
  const [dirty, setDirty] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setEditHtml(html); setDirty(false); }, [html]);
  const sanitized = useMemo(() => sanitizeSlideHtml(html), [html]);

  // Commit WYSIWYG changes back
  const commitWysiwyg = useCallback(() => {
    if (containerRef.current && onEdit) {
      const newHtml = containerRef.current.innerHTML;
      onEdit(newHtml);
      setEditHtml(newHtml);
      setDirty(false);
    }
  }, [onEdit]);

  // Show floating toolbar on text selection inside wysiwyg mode
  const handleSelectionChange = useCallback(() => {
    if (mode !== 'wysiwyg') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setShowToolbar(false); return; }
    const range = sel.getRangeAt(0);
    if (!containerRef.current?.contains(range.commonAncestorContainer)) { setShowToolbar(false); return; }
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setToolbarPos({ x: rect.left - containerRect.left + rect.width / 2, y: rect.top - containerRect.top - 8 });
    setShowToolbar(true);
  }, [mode]);

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  // execCommand helpers for inline formatting
  const execCmd = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    setDirty(true);
    containerRef.current?.focus();
  }, []);

  // ── Code editing mode ──
  if (mode === 'code' && onEdit) {
    return (
      <div className="flex flex-col flex-1 gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-white/20 uppercase tracking-wider font-bold">HTML Source</span>
          <div className="flex items-center gap-1">
            <button onClick={() => { setMode('wysiwyg'); }}
              className="px-2 py-1 rounded-md text-[9px] font-medium text-blue-300/60 hover:bg-blue-500/10 transition-all">
              Visual
            </button>
            <button onClick={() => { onEdit(editHtml); setMode('view'); setDirty(false); }}
              className="px-2 py-1 rounded-md text-[9px] font-medium bg-green-500/15 text-green-300/70 border border-green-400/15 hover:bg-green-500/25 transition-all">
              Save
            </button>
            <button onClick={() => { setEditHtml(html); setMode('view'); setDirty(false); }}
              className="px-2 py-1 rounded-md text-[9px] font-medium text-white/30 hover:text-white/60 transition-all">
              Cancel
            </button>
          </div>
        </div>
        <textarea
          value={editHtml}
          onChange={e => { setEditHtml(e.target.value); setDirty(true); }}
          className="flex-1 min-h-[200px] bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 text-[10px] text-white/60 font-mono leading-relaxed outline-none focus:border-indigo-400/20 resize-y"
          spellCheck={false}
        />
        <div className="text-[8px] text-white/15 uppercase tracking-wider font-bold mt-1">Preview</div>
        <div className="rounded-lg p-3 border border-white/[0.04] overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.01)' }}
          dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(editHtml) }} />
      </div>
    );
  }

  // ── WYSIWYG mode ──
  if (mode === 'wysiwyg' && onEdit) {
    return (
      <div className="relative flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-white/20 uppercase tracking-wider font-bold">Editing</span>
            {dirty && <span className="text-[7px] text-amber-400/50">* unsaved</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setMode('code'); setEditHtml(containerRef.current?.innerHTML || html); }}
              className="px-2 py-1 rounded-md text-[8px] font-medium text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-all"
              title="Edit raw HTML">
              {'</>'}
            </button>
            <button onClick={() => { commitWysiwyg(); setMode('view'); }}
              className="px-2 py-1 rounded-md text-[9px] font-medium bg-green-500/15 text-green-300/70 border border-green-400/15 hover:bg-green-500/25 transition-all">
              Done
            </button>
            <button onClick={() => { setMode('view'); setDirty(false); }}
              className="px-2 py-1 rounded-md text-[9px] font-medium text-white/30 hover:text-white/60 transition-all">
              Cancel
            </button>
          </div>
        </div>

        {/* Floating selection toolbar */}
        {showToolbar && (
          <div ref={toolbarRef}
            className="absolute z-50 flex items-center gap-0.5 p-1 rounded-lg shadow-2xl"
            style={{
              left: `${toolbarPos.x}px`, top: `${toolbarPos.y}px`, transform: 'translate(-50%, -100%)',
              backgroundColor: 'rgba(20,20,30,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(12px)',
            }}>
            <button onClick={() => execCmd('bold')} className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white/50 hover:text-white hover:bg-white/10" title="Bold">B</button>
            <button onClick={() => execCmd('italic')} className="w-6 h-6 rounded flex items-center justify-center text-[10px] italic text-white/50 hover:text-white hover:bg-white/10" title="Italic">I</button>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <button onClick={() => execCmd('fontSize', '5')} className="w-6 h-6 rounded flex items-center justify-center text-[10px] text-white/50 hover:text-white hover:bg-white/10" title="Larger">A↑</button>
            <button onClick={() => execCmd('fontSize', '2')} className="w-6 h-6 rounded flex items-center justify-center text-[8px] text-white/50 hover:text-white hover:bg-white/10" title="Smaller">A↓</button>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <button onClick={() => execCmd('foreColor', '#818cf8')} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10" title="Accent color">
              <div className="w-3 h-3 rounded-full" style={{ background: '#818cf8' }} />
            </button>
            <button onClick={() => execCmd('foreColor', 'rgba(255,255,255,0.88)')} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10" title="White">
              <div className="w-3 h-3 rounded-full bg-white/80" />
            </button>
            <button onClick={() => execCmd('foreColor', '#f472b6')} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10" title="Pink">
              <div className="w-3 h-3 rounded-full" style={{ background: '#f472b6' }} />
            </button>
            <button onClick={() => execCmd('foreColor', '#34d399')} className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10" title="Green">
              <div className="w-3 h-3 rounded-full" style={{ background: '#34d399' }} />
            </button>
          </div>
        )}

        {/* Editable canvas */}
        <div
          ref={containerRef}
          contentEditable
          suppressContentEditableWarning
          className="flex-1 overflow-y-auto glass-scroll outline-none rounded-lg"
          style={{ border: '1px dashed rgba(129,140,248,0.15)', padding: '4px', cursor: 'text' }}
          dangerouslySetInnerHTML={{ __html: sanitized }}
          onInput={() => setDirty(true)}
          onBlur={() => setTimeout(() => setShowToolbar(false), 200)}
        />
      </div>
    );
  }

  // ── View mode (default) — scale-to-fit so entire agent output is visible ──
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = innerRef.current;
    const wrapper = wrapperRef.current;
    if (!inner || !wrapper) return;

    let applied = false;

    const measure = () => {
      const wW = wrapper.clientWidth;
      const wH = wrapper.clientHeight;
      if (wW === 0 || wH === 0) return;

      // Measure natural height using an invisible offscreen clone (no visual flash)
      const clone = inner.cloneNode(true) as HTMLDivElement;
      clone.style.cssText = `position:absolute;left:-9999px;top:0;width:${wW}px;transform:none;visibility:hidden;pointer-events:none`;
      wrapper.appendChild(clone);
      const naturalH = clone.scrollHeight;
      wrapper.removeChild(clone);

      if (naturalH > 0 && naturalH > wH) {
        const s = Math.max((wH - 4) / naturalH, 0.55);
        inner.style.transform = `scale(${s})`;
        inner.style.transformOrigin = 'top center';
        inner.style.width = `${wW / s}px`;
        inner.style.marginLeft = `${-(wW / s - wW) / 2}px`;
      } else {
        inner.style.transform = 'none';
        inner.style.width = `${wW}px`;
        inner.style.marginLeft = '0';
      }
      applied = true;
    };

    // Initial measure on next frame so DOM is settled
    const raf = requestAnimationFrame(measure);

    // Re-measure only on genuine wrapper resizes
    let resizeTid: ReturnType<typeof setTimeout> | null = null;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      if (applied && Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
      lastW = r.width; lastH = r.height;
      if (resizeTid) clearTimeout(resizeTid);
      resizeTid = setTimeout(measure, 100);
    });
    ro.observe(wrapper);
    return () => { cancelAnimationFrame(raf); if (resizeTid) clearTimeout(resizeTid); ro.disconnect(); };
  }, [sanitized]);

  return (
    <div className="relative flex-1 flex flex-col group/html">
      {onEdit && (
        <div className="absolute top-0 right-0 z-20 flex items-center gap-0.5 opacity-0 group-hover/html:opacity-100 transition-opacity">
          <button onClick={() => setMode('wysiwyg')}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all"
            title="Edit slide visually">
            <Edit2 size={10} />
          </button>
          <button onClick={() => setMode('code')}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-all text-[9px] font-mono"
            title="Edit HTML source">
            {'</>'}
          </button>
        </div>
      )}
      {/* Wrapper takes the available flex space; inner scales to fit */}
      <div ref={wrapperRef} className="flex-1 overflow-hidden">
        <div
          ref={innerRef}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      </div>
    </div>
  );
}

/** Layout picker dropdown -- lets users swap layout type on any section slide */
const LAYOUT_OPTIONS: { value: SlideLayout; label: string; icon: string }[] = [
  { value: 'default', label: 'Default', icon: '▤' },
  { value: 'hero-stat', label: 'Hero Stat', icon: '▣' },
  { value: 'big-number', label: 'Big Number', icon: '#' },
  { value: 'two-column', label: 'Two Column', icon: '▥' },
  { value: 'comparison', label: 'Comparison', icon: '⇄' },
  { value: 'quote-highlight', label: 'Quote', icon: '"' },
  { value: 'timeline', label: 'Timeline', icon: '↕' },
  { value: 'key-takeaway', label: 'Takeaway', icon: '★' },
];

function LayoutPicker({ current, accentColor, onChange }: { current: SlideLayout; accentColor: string; onChange: (layout: SlideLayout) => void }) {
  const [open, setOpen] = useState(false);
  const currentOption = LAYOUT_OPTIONS.find(o => o.value === current) || LAYOUT_OPTIONS[0];

  return (
    <div className="relative inline-block mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-[2px] rounded-md text-[6.5px] font-bold uppercase tracking-[0.12em] transition-all hover:opacity-80"
        style={{
          backgroundColor: `${accentColor}08`,
          border: `1px solid ${accentColor}0c`,
          color: `${accentColor}50`,
        }}
        title="Change slide layout"
      >
        <span>{currentOption.icon}</span>
        <span>{currentOption.label}</span>
        <span className="text-[5px] ml-0.5">▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-40 rounded-xl overflow-hidden shadow-2xl border border-white/[0.08]"
            style={{ backgroundColor: 'rgba(14,14,24,0.97)', backdropFilter: 'blur(16px)', minWidth: 140 }}>
            {LAYOUT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-[9px] text-left transition-all ${
                  opt.value === current
                    ? 'text-white/70 font-semibold'
                    : 'text-white/35 hover:text-white/60 hover:bg-white/[0.04]'
                }`}
                style={opt.value === current ? { backgroundColor: `${accentColor}10` } : {}}
              >
                <span className="w-4 text-center opacity-60">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
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
  onExport: (el: HTMLElement | null, transparent?: boolean) => void;
  onDigDeeper: () => void;
  onSave: () => void;
  onCopy: () => void;
  onFollowUp: (question: string) => void;
  onGenerate: (format: OutputFormat, count: number) => void;
  onEditItem: (patch: Partial<FeedItem>) => void;
  onDesignSlides?: (count?: number) => void;
  onEditSlide?: (sectionIndex: number, editRequest: string) => void;
  onRedesignSlide?: (sectionIndex: number) => void;
  isDesigning?: boolean;
  designProgress?: { done: number; total: number };
  isPending: boolean;
}

function SlideCard({ slide, onExport, onDigDeeper, onSave, onCopy, onFollowUp, onGenerate, onEditItem, onDesignSlides, onEditSlide, onRedesignSlide, isDesigning, designProgress, isPending }: SlideCardProps) {
  const { kind, feedItem: item, slideNumber, totalSlides, sectionIndex } = slide;
  const accent = SLIDE_ACCENT_COLORS[(sectionIndex ?? 0) % SLIDE_ACCENT_COLORS.length];
  const slideCardRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState('');
  const [showGen, setShowGen] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
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
    newSections[sectionIndex] = { ...newSections[sectionIndex], heading: editHeading, body: editBody };
    onEditItem({ sections: newSections, content: newSections.map(s => `## ${s.heading}\n${s.body}`).join('\n\n') });
    setEditing(false);
  };

  // Shared slide shell -- cinematic glassmorphic card
  const Shell = ({ children, accentColor, accentColor2 }: { children: ReactNode; accentColor?: string; accentColor2?: string }) => {
    const clr = accentColor || '#818cf8';
    const clr2 = accentColor2 || clr;
    return (
      <div className="relative rounded-[22px] shadow-2xl overflow-hidden flex flex-col"
        style={{
          minHeight: 280,
          border: `1px solid ${clr}14`,
          background: `linear-gradient(150deg, ${clr}07 0%, rgba(8,8,18,0.96) 35%, rgba(8,8,18,0.98) 65%, ${clr2}04 100%)`,
          boxShadow: `0 25px 60px -15px rgba(0,0,0,0.5), 0 0 0 1px ${clr}08 inset`,
        }}>
        {/* Top accent bar -- vivid gradient edge */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px]"
          style={{ background: `linear-gradient(90deg, transparent 5%, ${clr}80 25%, ${clr2}60 75%, transparent 95%)` }} />
        {/* Bottom accent bar -- subtle mirror of top */}
        <div className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent 15%, ${clr}10 40%, ${clr2}08 60%, transparent 85%)` }} />
        {/* Left accent strip */}
        <div className="absolute top-0 left-0 bottom-0 w-px"
          style={{ background: `linear-gradient(180deg, ${clr}28 0%, ${clr}08 30%, transparent 60%, ${clr2}0a 100%)` }} />
        {/* Right accent strip -- very subtle */}
        <div className="absolute top-0 right-0 bottom-0 w-px"
          style={{ background: `linear-gradient(180deg, ${clr}0a 0%, transparent 40%, transparent 60%, ${clr2}08 100%)` }} />
        {/* Primary glow -- top right, large and diffuse */}
        <div className="absolute -top-28 -right-28 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${clr}10 0%, ${clr}04 35%, transparent 65%)` }} />
        {/* Secondary glow -- bottom left, warm complementary tone */}
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${clr2}08 0%, ${clr2}02 40%, transparent 70%)` }} />
        {/* Center mesh glow -- subtle mid-card luminosity */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/3 w-96 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(ellipse, ${clr}05 0%, transparent 55%)` }} />
        {/* Fine noise texture overlay for depth */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-overlay"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")` }} />
        {/* Inner padding container */}
        <div className="relative flex-1 p-7 flex flex-col">
          {/* Slide header -- title + number + edit toggle */}
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
          {/* Bottom bar -- elegant gradient rule + brand */}
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
    const sectionCount = item.sections?.length || 0;
    return (
      <div ref={slideCardRef}>
      <Shell accentColor="#818cf8" accentColor2="#6366f1">
        {/* Decorative geometric accents */}
        <div className="absolute top-6 right-7 pointer-events-none" style={{ opacity: 0.04 }}>
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="55" stroke="#818cf8" strokeWidth="0.5" strokeDasharray="4 6" />
            <circle cx="60" cy="60" r="35" stroke="#a78bfa" strokeWidth="0.5" strokeDasharray="2 4" />
            <line x1="5" y1="60" x2="115" y2="60" stroke="#818cf8" strokeWidth="0.3" />
            <line x1="60" y1="5" x2="60" y2="115" stroke="#818cf8" strokeWidth="0.3" />
          </svg>
        </div>
        <div className="absolute bottom-8 left-6 pointer-events-none" style={{ opacity: 0.035 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <rect x="5" y="5" width="70" height="70" rx="4" stroke="#6366f1" strokeWidth="0.5" />
            <rect x="15" y="15" width="50" height="50" rx="3" stroke="#818cf8" strokeWidth="0.4" strokeDasharray="3 5" />
          </svg>
        </div>
        <div className="flex flex-col justify-center flex-1 py-4">
          {/* Top bar: type badge + timestamp + section count */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: '#818cf8', boxShadow: '0 0 12px rgba(129,140,248,0.4), 0 0 24px rgba(129,140,248,0.15)' }} />
              </div>
              <span className="text-[8px] font-black uppercase tracking-[0.3em] bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, rgba(165,180,252,0.7), rgba(129,140,248,0.45))' }}>{item.type || 'RESEARCH'}</span>
            </div>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(129,140,248,0.12), transparent 60%)' }} />
            {sectionCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: 'rgba(129,140,248,0.05)', border: '1px solid rgba(129,140,248,0.08)' }}>
                <Layers size={8} style={{ color: 'rgba(165,180,252,0.35)' }} />
                <span className="text-[7.5px] font-bold tabular-nums" style={{ color: 'rgba(165,180,252,0.3)' }}>{sectionCount} slides</span>
              </div>
            )}
            <span className="text-[7.5px] text-white/12 font-mono tabular-nums tracking-wide">{timeAgo(item.timestamp)}</span>
          </div>
          {/* Large cinematic title -- dramatic gradient text */}
          {editing ? (
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
              className="text-[28px] font-extrabold text-white/90 leading-[1.12] mb-5 tracking-[-0.03em] bg-transparent border-b border-indigo-400/25 outline-none w-full"
              autoFocus />
          ) : (
            <h2 className="text-[28px] font-extrabold leading-[1.12] mb-5 tracking-[-0.035em] bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.95) 10%, rgba(255,255,255,0.72) 50%, rgba(129,140,248,0.55) 100%)' }}>
              {item.title}
            </h2>
          )}
          {/* Accent divider -- wide cinematic gradient bar with layered glow */}
          <div className="relative mb-6" style={{ height: 3 }}>
            <div className="absolute left-0 top-0 rounded-full" style={{ width: '40%', height: '100%', background: 'linear-gradient(90deg, #818cf8cc, #6366f180, #a78bfa40, transparent)' }} />
            <div className="absolute left-0 top-0 rounded-full blur-sm" style={{ width: '35%', height: 4, top: -0.5, background: 'linear-gradient(90deg, rgba(129,140,248,0.4), transparent)' }} />
            <div className="absolute left-0 top-0 rounded-full blur-md" style={{ width: '25%', height: 6, top: -1.5, background: 'linear-gradient(90deg, rgba(129,140,248,0.2), transparent)' }} />
          </div>
          {/* Summary -- elegant subtitle with left accent */}
          {editing ? (
            <textarea value={editSummary} onChange={e => setEditSummary(e.target.value)} rows={3}
              className="text-[12.5px] text-white/35 leading-[1.8] font-light mb-5 max-w-[90%] bg-transparent rounded-xl p-3 outline-none resize-y w-full"
              style={{ border: '1px solid rgba(129,140,248,0.10)', backgroundColor: 'rgba(129,140,248,0.02)' }} />
          ) : (
            item.summary && (
              <div className="flex gap-3 mb-5 max-w-[92%]">
                <div className="w-[2px] rounded-full shrink-0 mt-0.5" style={{ background: 'linear-gradient(180deg, rgba(129,140,248,0.25), rgba(129,140,248,0.05), transparent)', minHeight: 20 }} />
                <p className="text-[12px] text-white/38 leading-[1.85] font-light">{item.summary}</p>
              </div>
            )
          )}
          {/* Image (if available) */}
          {item.imageUrl && (
            <div className="w-full h-28 rounded-2xl overflow-hidden mb-4 bg-black/30"
              style={{ border: '1px solid rgba(129,140,248,0.06)' }}>
              <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          {/* Design progress on title slide */}
          {isDesigning && designProgress && designProgress.total > 0 && (
            <div className="flex items-center gap-2.5 mb-4 w-full max-w-[85%]">
              <div className="flex-1 h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(129,140,248,0.1)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(designProgress.done / designProgress.total) * 100}%`, background: 'linear-gradient(90deg, #818cf8cc, #a78bfa80)' }} />
              </div>
              <span className="text-[8px] font-bold tabular-nums shrink-0" style={{ color: 'rgba(129,140,248,0.45)' }}>
                Designing {designProgress.done}/{designProgress.total}
              </span>
            </div>
          )}
          {/* Bottom: topic pills with enhanced styling */}
          <div className="mt-auto flex items-end justify-between gap-3">
            {item.topics.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {item.topics.slice(0, 5).map((t, i) => (
                  <span key={i} className="px-3 py-[4px] rounded-lg text-[7px] font-bold uppercase tracking-[0.12em] transition-colors"
                    style={{
                      backgroundColor: `rgba(129,140,248,${0.04 + i * 0.01})`,
                      color: `rgba(165,180,252,${0.45 - i * 0.04})`,
                      border: `1px solid rgba(129,140,248,${0.08 - i * 0.01})`,
                    }}>{t}</span>
                ))}
              </div>
            )}
            {/* Design All button on title slide */}
            {sectionCount > 0 && !isDesigning && onDesignSlides && (
              <button onClick={() => onDesignSlides()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-[0.08em] transition-all shrink-0"
                style={{ backgroundColor: 'rgba(129,140,248,0.06)', color: 'rgba(165,180,252,0.4)', border: '1px solid rgba(129,140,248,0.10)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(129,140,248,0.12)'; e.currentTarget.style.color = 'rgba(165,180,252,0.7)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(129,140,248,0.06)'; e.currentTarget.style.color = 'rgba(165,180,252,0.4)'; }}>
                <Sparkles size={9} /> Design All
              </button>
            )}
          </div>
        </div>
      </Shell>
      </div>
    );
  }

  // ── Section Slide ────────────────────────────
  if (kind === 'section' && sectionIndex != null && item.sections?.[sectionIndex]) {
    const section = item.sections[sectionIndex];
    return (
      <div ref={slideCardRef}>
      <Shell accentColor={accent.glow} accentColor2={accent.glow2}>
        <div className="flex flex-col flex-1">
          {/* Section heading -- premium with gradient number + accent line */}
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
              {/* Layout type badge -- clickable to switch */}
              {!section.html && (
                <LayoutPicker
                  current={section.layout || 'default'}
                  accentColor={accent.glow}
                  onChange={(newLayout) => {
                    if (sectionIndex == null || !item.sections) return;
                    const newSections = [...item.sections];
                    newSections[sectionIndex] = { ...newSections[sectionIndex], layout: newLayout };
                    onEditItem({ sections: newSections });
                  }}
                />
              )}
            </div>
          </div>
          {/* Section body -- agent HTML canvas or layout-aware fallback */}
          {editing ? (
            <textarea value={editBody} onChange={e => setEditBody(e.target.value)}
              className="text-[11px] text-white/55 leading-[1.7] whitespace-pre-wrap flex-1 overflow-y-auto glass-scroll pr-1 bg-transparent rounded-xl p-3 outline-none resize-y w-full min-h-[120px]"
              style={{ border: `1px solid ${accent.glow}10`, backgroundColor: `${accent.glow}03` }} />
          ) : section.html ? (
            <AgentHtmlSlide
              html={section.html}
              onEdit={(newHtml) => {
                if (sectionIndex == null || !item.sections) return;
                const newSections = [...item.sections];
                newSections[sectionIndex] = { ...newSections[sectionIndex], html: newHtml };
                onEditItem({ sections: newSections });
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto glass-scroll pr-1">
              <LayoutRenderer section={section} accentColor={accent.glow} />
            </div>
          )}
          {/* Per-slide design + edit controls */}
          <div className="mt-3 shrink-0">
            {/* Designing progress indicator */}
            {isDesigning && designProgress && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="flex-1 h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: `${accent.glow}10` }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${designProgress.total > 0 ? (designProgress.done / designProgress.total) * 100 : 0}%`, background: `linear-gradient(90deg, ${accent.glow}cc, ${accent.glow}60)` }} />
                </div>
                <span className="text-[8px] font-bold tabular-nums" style={{ color: `${accent.glow}60` }}>
                  Designing {designProgress.done}/{designProgress.total}
                </span>
              </div>
            )}
            {showSlideEdit ? (
              <div className="flex items-center gap-1.5 p-1 rounded-xl"
                style={{ backgroundColor: `${accent.glow}04`, border: `1px solid ${accent.glow}0c` }}>
                <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5">
                  <Wand2 size={10} style={{ color: `${accent.glow}50` }} className="shrink-0" />
                  <input value={slideEditInput} onChange={e => setSlideEditInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && slideEditInput.trim() && onEditSlide) { onEditSlide(sectionIndex!, slideEditInput); setSlideEditInput(''); setShowSlideEdit(false); }
                      if (e.key === 'Escape') setShowSlideEdit(false);
                    }}
                    placeholder="Describe changes..."
                    disabled={isPending || isDesigning}
                    className="flex-1 bg-transparent text-[10px] text-white/55 placeholder:text-white/15 outline-none disabled:opacity-40"
                    autoFocus />
                </div>
                <button onClick={() => { if (slideEditInput.trim() && onEditSlide) { onEditSlide(sectionIndex!, slideEditInput); setSlideEditInput(''); setShowSlideEdit(false); } }}
                  disabled={!slideEditInput.trim() || isPending || isDesigning}
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
              <div className="flex items-center gap-1.5">
                {/* Auto-design this slide button */}
                {onRedesignSlide && sectionIndex != null && (
                  <button onClick={() => onRedesignSlide(sectionIndex)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-medium transition-all"
                    style={{ color: `${accent.glow}50`, backgroundColor: `${accent.glow}04`, border: `1px solid ${accent.glow}0a` }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent.glow}10`; e.currentTarget.style.color = `${accent.glow}90`; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = `${accent.glow}04`; e.currentTarget.style.color = `${accent.glow}50`; }}
                    disabled={isDesigning}>
                    <Sparkles size={9} /> Auto-design
                  </button>
                )}
                {/* Text-based edit */}
                {onEditSlide && (
                  <button onClick={() => setShowSlideEdit(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-medium transition-all"
                    style={{ color: `${accent.glow}35` }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent.glow}06`; e.currentTarget.style.color = `${accent.glow}70`; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = `${accent.glow}35`; }}
                    disabled={isDesigning}>
                    <Wand2 size={9} /> Edit with prompt
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Shell>
      </div>
    );
  }

  // ── Sources Slide ────────────────────────────
  if (kind === 'sources') {
    return (
      <div ref={slideCardRef}>
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
            <div className="relative">
              <button onClick={() => setShowExportMenu(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-medium transition-all hover:bg-emerald-500/10" style={{ color: '#34d39970', border: '1px solid #34d39912' }}><Download size={9} /> Export</button>
              {showExportMenu && (
                <div className="absolute bottom-full left-0 mb-1.5 rounded-xl overflow-hidden shadow-2xl z-50" style={{ backgroundColor: 'rgba(12,12,20,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(34,211,238,0.12)', minWidth: 150 }}>
                  <button onClick={() => { onExport(slideCardRef.current); setShowExportMenu(false); }} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[9.5px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all"><Download size={10} /> With Background</button>
                  <button onClick={() => { onExport(slideCardRef.current, true); setShowExportMenu(false); }} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[9.5px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}><Download size={10} /> Transparent</button>
                </div>
              )}
            </div>
            <button onClick={onCopy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/20 text-[9px] font-medium hover:text-white/45 transition-all" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}><Copy size={9} /> Copy All</button>
            <button onClick={onSave} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-medium transition-all ${item.saved ? 'bg-amber-500/15 border-amber-400/15 text-amber-300/70' : 'text-white/20 hover:text-amber-300/50'}`} style={item.saved ? {} : { backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}><Bookmark size={9} /> {item.saved ? 'Saved' : 'Save'}</button>
          </div>
        </div>
      </Shell>
      </div>
    );
  }

  // ── Actions Slide (follow-up + generate) ─────
  return (
    <div ref={slideCardRef}>
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
              placeholder="Ask a follow-up question..." disabled={isPending}
              className="flex-1 bg-transparent text-[10.5px] text-white/55 placeholder:text-white/12 outline-none disabled:opacity-40" />
          </div>
          <button onClick={() => { if (followUp.trim()) { onFollowUp(followUp); setFollowUp(''); } }} disabled={!followUp.trim() || isPending}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-15"
            style={{ backgroundColor: 'rgba(167,139,250,0.1)', color: 'rgba(167,139,250,0.6)', border: '1px solid rgba(167,139,250,0.1)' }}><Send size={11} /></button>
        </div>

        {/* Design progress bar */}
        {isDesigning && designProgress && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(167,139,250,0.1)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${designProgress.total > 0 ? (designProgress.done / designProgress.total) * 100 : 0}%`, background: 'linear-gradient(90deg, #a78bfa, #ec4899)' }} />
            </div>
            <span className="text-[9px] font-bold tabular-nums text-violet-300/60">
              Designing {designProgress.done}/{designProgress.total}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {onDesignSlides && (
            <button onClick={() => onDesignSlides()} disabled={isPending || isDesigning}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-semibold transition-all disabled:opacity-30 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(236,72,153,0.08))',
                border: '1px solid rgba(167,139,250,0.18)',
                color: 'rgba(221,214,254,0.85)',
                boxShadow: '0 4px 24px rgba(139,92,246,0.06), 0 0 0 1px rgba(167,139,250,0.05) inset',
              }}>
              <Wand2 size={11} /> {isDesigning ? 'Designing...' : 'Design All Slides'}
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

        {/* Export + Save row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="relative">
            <button onClick={() => setShowExportMenu(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-medium transition-all hover:bg-emerald-500/10" style={{ color: '#34d39970', border: '1px solid #34d39912' }}><Download size={9} /> Export</button>
            {showExportMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 rounded-xl overflow-hidden shadow-2xl z-50" style={{ backgroundColor: 'rgba(12,12,20,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(167,139,250,0.12)', minWidth: 150 }}>
                <button onClick={() => { onExport(slideCardRef.current); setShowExportMenu(false); }} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[9.5px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all"><Download size={10} /> With Background</button>
                <button onClick={() => { onExport(slideCardRef.current, true); setShowExportMenu(false); }} className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[9.5px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}><Download size={10} /> Transparent</button>
              </div>
            )}
          </div>
          <button onClick={onSave} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-medium transition-all ${item.saved ? 'bg-amber-500/15 border-amber-400/15 text-amber-300/70' : 'text-white/20 hover:text-amber-300/50'}`} style={item.saved ? {} : { backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}><Bookmark size={9} /> {item.saved ? 'Saved' : 'Save'}</button>
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
    </div>
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
