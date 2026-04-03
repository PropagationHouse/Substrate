/**
 * RichMessageCard — Research-card-quality rendering for assistant chat messages.
 *
 * Parses rawText/html for structure (sections, source URLs, code blocks, lists)
 * and renders a visually rich card with collapsible sections, source pills,
 * topic badges, and action buttons — matching the Intelligence Hub aesthetic.
 *
 * Falls back to simple dangerouslySetInnerHTML for short/unstructured messages.
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronRight, ExternalLink, Copy, Check, Layers,
  FileText, Hash, BookOpen,
} from 'lucide-react';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedSection {
  heading: string;
  body: string;
  level: number; // 1-3
}

interface ParsedSourceUrl {
  url: string;
  label: string;
}

interface ParsedMessage {
  /** Leading text before first heading (if any) */
  preamble: string;
  sections: ParsedSection[];
  sourceUrls: ParsedSourceUrl[];
  codeBlockCount: number;
  listItemCount: number;
  /** Whether the message is "rich" enough to warrant card rendering */
  isRich: boolean;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function extractSourceUrls(text: string): ParsedSourceUrl[] {
  const urls: ParsedSourceUrl[] = [];
  const seen = new Set<string>();

  // Markdown links: [label](url)
  const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(text)) !== null) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      urls.push({ url, label: m[1].slice(0, 40) });
    }
  }

  // Bare URLs not already captured
  const bareRe = /(?<!\()https?:\/\/[^\s)<>\]]+/g;
  while ((m = bareRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;:!?]+$/, ''); // strip trailing punctuation
    if (!seen.has(url)) {
      seen.add(url);
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        urls.push({ url, label: host });
      } catch {
        urls.push({ url, label: url.slice(0, 35) });
      }
    }
  }
  return urls;
}

function parseMessageStructure(rawText: string): ParsedMessage {
  if (!rawText) return { preamble: '', sections: [], sourceUrls: [], codeBlockCount: 0, listItemCount: 0, isRich: false };

  const sourceUrls = extractSourceUrls(rawText);

  // Count code blocks
  const codeBlockCount = (rawText.match(/```/g) || []).length / 2;

  // Count list items
  const listItemCount = (rawText.match(/^[-*+] |^\d+\. /gm) || []).length;

  // Split into sections by headings
  const lines = rawText.split('\n');
  const sections: ParsedSection[] = [];
  let preambleLines: string[] = [];
  let currentHeading = '';
  let currentLevel = 2;
  let currentBody: string[] = [];
  let foundFirstHeading = false;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (foundFirstHeading && (currentHeading || currentBody.length)) {
        sections.push({
          heading: currentHeading || 'Overview',
          body: currentBody.join('\n').trim(),
          level: currentLevel,
        });
      }
      foundFirstHeading = true;
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      currentBody = [];
    } else if (!foundFirstHeading) {
      preambleLines.push(line);
    } else {
      currentBody.push(line);
    }
  }
  // Push last section
  if (foundFirstHeading && (currentHeading || currentBody.length)) {
    sections.push({
      heading: currentHeading || 'Overview',
      body: currentBody.join('\n').trim(),
      level: currentLevel,
    });
  }

  const preamble = preambleLines.join('\n').trim();

  // Determine if "rich" enough for card rendering:
  // 2+ sections, or 1+ sections with sources, or lots of code/lists
  const isRich =
    sections.length >= 2 ||
    (sections.length >= 1 && sourceUrls.length > 0) ||
    (sections.length >= 1 && codeBlockCount >= 2) ||
    (sections.length >= 1 && listItemCount >= 5) ||
    rawText.length > 800;

  return { preamble, sections, sourceUrls, codeBlockCount, listItemCount, isRich };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionBlock({ section, defaultExpanded = true }: { section: ParsedSection; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { setExpanded(defaultExpanded); }, [defaultExpanded]);

  return (
    <div className="border-l-2 border-indigo-500/15 pl-3 py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left group/sec"
      >
        <ChevronRight
          size={10}
          className={`text-indigo-300/30 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-[11px] font-semibold text-white/65 leading-tight group-hover/sec:text-white/80 transition-colors">
          {section.heading}
        </span>
      </button>
      {expanded && section.body && (
        <div className="mt-1.5 ml-4 text-[12px] text-white/55 leading-relaxed">
          <div className="msg-body [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <MarkdownRenderer content={section.body} />
          </div>
        </div>
      )}
    </div>
  );
}

function SourcePill({ source }: { source: ParsedSourceUrl }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px]
        bg-cyan-500/[0.06] border border-cyan-400/10 text-cyan-300/50
        hover:text-cyan-300/80 hover:bg-cyan-500/10 hover:border-cyan-400/20
        transition-all duration-200"
    >
      <ExternalLink size={8} className="shrink-0" />
      <span className="truncate max-w-[120px]">{source.label}</span>
    </a>
  );
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* */ }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px]
        text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-all"
      title="Copy full response"
    >
      {copied ? <Check size={9} className="text-green-400/60" /> : <Copy size={9} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface RichMessageCardProps {
  html: string;
  rawText: string;
  /** When true, always use simple rendering (e.g. during streaming) */
  forceSimple?: boolean;
}

export function RichMessageCard({ html, rawText, forceSimple }: RichMessageCardProps) {
  const parsed = useMemo(() => parseMessageStructure(rawText), [rawText]);
  const [allExpanded, setAllExpanded] = useState(true);

  // Simple rendering for short / unstructured messages or forced-simple mode
  if (forceSimple || !parsed.isRich) {
    if (html) {
      return (
        <div
          className="msg-body max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    return (
      <div className="msg-body max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <MarkdownRenderer content={rawText} />
      </div>
    );
  }

  // ── Rich card rendering ──
  const { preamble, sections, sourceUrls } = parsed;
  const hasMultipleSections = sections.length > 1;

  return (
    <div className="space-y-2.5">
      {/* Preamble — text before first heading */}
      {preamble && (
        <div className="msg-body text-[12.5px] text-white/65 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <MarkdownRenderer content={preamble} />
        </div>
      )}

      {/* Section count header + collapse toggle */}
      {hasMultipleSections && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[9px] text-indigo-300/40">
            <Layers size={10} />
            <span>{sections.length} sections</span>
          </div>
          <button
            onClick={() => setAllExpanded(!allExpanded)}
            className="text-[9px] text-indigo-300/30 hover:text-indigo-300/60 transition-colors"
          >
            {allExpanded ? '▾ Collapse all' : '▸ Expand all'}
          </button>
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div className="space-y-2">
          {sections.map((section, i) => (
            <SectionBlock
              key={i}
              section={section}
              defaultExpanded={allExpanded}
            />
          ))}
        </div>
      )}

      {/* Source URLs */}
      {sourceUrls.length > 0 && (
        <div className="pt-1.5 border-t border-white/[0.04]">
          <div className="flex items-center gap-1 mb-1.5">
            <BookOpen size={9} className="text-white/20" />
            <span className="text-[8px] text-white/25 uppercase tracking-wider font-semibold">Sources</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {sourceUrls.slice(0, 8).map((src, i) => (
              <SourcePill key={i} source={src} />
            ))}
            {sourceUrls.length > 8 && (
              <span className="text-[8px] text-white/20">+{sourceUrls.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* Quick stats footer */}
      {(parsed.codeBlockCount > 0 || parsed.listItemCount > 3) && (
        <div className="flex items-center gap-3 text-[8px] text-white/15">
          {parsed.codeBlockCount > 0 && (
            <span className="flex items-center gap-1">
              <Hash size={8} /> {Math.round(parsed.codeBlockCount)} code block{Math.round(parsed.codeBlockCount) !== 1 ? 's' : ''}
            </span>
          )}
          {parsed.listItemCount > 3 && (
            <span className="flex items-center gap-1">
              <FileText size={8} /> {parsed.listItemCount} items
            </span>
          )}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-1 pt-0.5">
        <CopyTextButton text={rawText} />
      </div>
    </div>
  );
}
