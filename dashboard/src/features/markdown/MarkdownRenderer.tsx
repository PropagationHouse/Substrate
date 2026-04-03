import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { hljs } from '@/lib/highlight';
import { sanitizeHtml } from '@/lib/sanitize';
import { escapeRegex } from '@/lib/constants';
import { CodeBlockActions } from './CodeBlockActions';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  searchQuery?: string;
  suppressImages?: boolean;
  onOpenWorkspacePath?: (path: string) => void | Promise<void>;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(regex);
  
  // split() with a capture group alternates: non-match, match, non-match, ...
  // Odd indices are always the captured matches — no regex.test() needed
  return parts.map((part, i) => 
    i % 2 === 1 ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part
  );
}

// Process React children to apply search highlighting to text nodes
function processChildren(children: React.ReactNode, searchQuery?: string): React.ReactNode {
  if (!searchQuery?.trim()) return children;
  
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return highlightText(child, searchQuery);
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      if (child.props.children) {
        return React.cloneElement(child, {
          children: processChildren(child.props.children, searchQuery),
        });
      }
    }
    return child;
  });
}

function isWorkspacePathLink(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return false;
  if (trimmed.startsWith('//')) return false;
  return true;
}

function decodeWorkspacePathLink(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

// ─── Mermaid diagram renderer ────────────────────────────────────────────────────

let mermaidInitialized = false;

function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            themeVariables: {
              darkMode: true,
              background: 'transparent',
              primaryColor: '#6366f1',
              primaryTextColor: '#e0e0e0',
              primaryBorderColor: '#4f46e5',
              lineColor: '#6366f1',
              secondaryColor: '#1e1b4b',
              tertiaryColor: '#312e81',
            },
          });
          mermaidInitialized = true;
        }
        if (cancelled || !containerRef.current) return;
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return <div className="text-red-400/60 text-[11px] italic p-2">{error}</div>;
  }

  return (
    <div className="my-2 p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto text-center">
      <div className="text-[9px] text-white/20 uppercase tracking-wider text-right mb-2">Diagram</div>
      <div ref={containerRef} className="[&>svg]:max-w-full [&>svg]:h-auto" />
    </div>
  );
}

// ─── Live HTML Preview ────────────────────────────────────────────────────────

function LiveHtmlPreview({ code, language }: { code: string; language: string }) {
  const [showCode, setShowCode] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 300 });
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number; edge: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build srcdoc content
  const srcdoc = useMemo(() => {
    const isFullDoc = /<html[\s>]/i.test(code) || /<!doctype/i.test(code);
    const heightScript = `<script>
      function _postH(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);window.parent.postMessage({type:'iframe-height',height:h},'*');}
      new ResizeObserver(_postH).observe(document.body);
      setTimeout(_postH,50);setTimeout(_postH,300);setTimeout(_postH,1000);setTimeout(_postH,3000);
    <\/script>`;
    if (isFullDoc) {
      let c = code.replace(/<head>/i, '<head><style>html,body{background:#0a0a1a!important;margin:0;overflow:visible!important;height:auto!important;min-height:0!important;}</style>');
      c = c.replace(/<\/body>/i, heightScript + '</body>');
      return c;
    }
    return `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{background:#0a0a1a;color:#e0e0e0;font-family:Inter,system-ui,sans-serif;padding:16px;overflow:visible;height:auto;min-height:0;}</style></head><body>${code}${heightScript}</body></html>`;
  }, [code]);

  // Listen for height messages from iframe — only auto-grow if user hasn't manually resized
  const userResized = useRef(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'iframe-height' && typeof e.data.height === 'number' && !userResized.current) {
        const h = Math.max(200, e.data.height);
        setSize(prev => ({ ...prev, h: Math.max(prev.h, h) }));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 2D drag resize (edges + corner)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setSize(prev => {
        const next = { ...prev };
        if (d.edge.includes('s')) next.h = Math.max(150, d.startH + dy);
        if (d.edge.includes('e')) next.w = Math.max(250, d.startW + dx);
        return next;
      });
    };
    const onUp = () => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const startDrag = useCallback((edge: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    userResized.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.w || (rect?.width ?? 400),
      startH: size.h,
      edge,
    };
    const cursor = edge === 'se' ? 'nwse-resize' : edge === 's' ? 'ns-resize' : 'ew-resize';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
  }, [size]);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); } catch {}
  }, [code]);

  // Width style: 0 means "fill parent", otherwise explicit
  const wrapStyle: React.CSSProperties = {
    background: '#0a0a1a',
    height: size.h,
    ...(size.w > 0 ? { width: size.w, maxWidth: '90vw' } : {}),
  };

  const previewIframe = (
    <iframe
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="border-none rounded-md"
      style={{ width: '100%', height: '100%', background: '#0a0a1a' }}
    />
  );

  // Fullscreen → dispatch global event so App renders an independent FloatingWindow
  const openFullscreen = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-code-preview', { detail: { code, language } }));
  }, [code, language]);

  return (
    <div className="relative my-2" style={{ overflow: 'visible' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] text-white/25 uppercase tracking-wider">HTML Preview</span>
        <button onClick={() => setShowCode(!showCode)}
          className="text-[9px] px-2 py-0.5 rounded border border-indigo-400/30 bg-indigo-500/10 text-indigo-300/70 hover:bg-indigo-500/20 transition-all">
          {showCode ? 'Preview' : 'Code'}
        </button>
        <button onClick={handleCopy}
          className="text-[9px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all">
          Copy
        </button>
        <button onClick={openFullscreen}
          className="text-[9px] px-2 py-0.5 rounded border border-white/10 bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all">
          Fullscreen
        </button>
      </div>
      {showCode ? (
        <CodeBlock code={code} language={language} />
      ) : (
        <div ref={containerRef} className="relative rounded-md border border-white/[0.04]" style={wrapStyle}>
          {previewIframe}
          {/* Corner drag — both axes */}
          <div onMouseDown={startDrag('se')}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-indigo-400/30 transition-colors rounded-br-md"
            title="Drag to resize">
            <svg className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 text-white/20" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="8" cy="8" r="1.2" /><circle cx="4" cy="8" r="1.2" /><circle cx="8" cy="4" r="1.2" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Code Block with actions ─────────────────────────────────────────────────

function CodeBlock({ code, language, highlightedHtml }: {
  code: string;
  language: string;
  highlightedHtml?: string;
}) {
  return (
    <div className="code-block-wrapper">
      <CodeBlockActions code={code} language={language} />
      <pre className="hljs">
        <span className="code-lang">{language}</span>
        {highlightedHtml
          ? <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          : <code>{code}</code>
        }
      </pre>
    </div>
  );
}

// ─── Main renderer ───────────────────────────────────────────────────────────

/** Render markdown content with syntax highlighting, search-term highlighting, and inline charts. */
export function MarkdownRenderer({ content, className = '', searchQuery, suppressImages, onOpenWorkspacePath }: MarkdownRendererProps) {
  // Memoize components object to avoid unnecessary ReactMarkdown re-renders.
  // Only recreated when searchQuery or suppressImages changes.
  const components = useMemo(() => ({
    // Highlight search terms in text nodes
    p: ({ children }: { children?: React.ReactNode }) => (
      <p>{processChildren(children, searchQuery)}</p>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li>{processChildren(children, searchQuery)}</li>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td>{processChildren(children, searchQuery)}</td>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th>{processChildren(children, searchQuery)}</th>
    ),
    code: ({ className: codeClassName, children, ...props }: { className?: string; children?: React.ReactNode }) => {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const lang = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      const inline = !codeClassName;

      if (!inline && lang) {
        // Mermaid diagrams
        if (lang === 'mermaid') {
          return <MermaidBlock code={codeString} />;
        }

        // Live HTML preview for html blocks containing markup
        if (lang === 'html' && codeString.includes('<')) {
          return <LiveHtmlPreview code={codeString} language={lang} />;
        }

        try {
          const highlighted = hljs.getLanguage(lang)
            ? hljs.highlight(codeString, { language: lang }).value
            : hljs.highlightAuto(codeString).value;

          return (
            <CodeBlock
              code={codeString}
              language={lang}
              highlightedHtml={sanitizeHtml(highlighted)}
            />
          );
        } catch {
          return (
            <CodeBlock code={codeString} language={lang} />
          );
        }
      }

      return (
        <code className={codeClassName} {...props}>
          {children}
        </code>
      );
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="table-wrapper">
        <table className="markdown-table">{children}</table>
      </div>
    ),
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => {
      if (!href) {
        return <span>{children}</span>;
      }

      if (onOpenWorkspacePath && isWorkspacePathLink(href)) {
        return (
          <a
            href={href}
            className="markdown-link"
            onClick={(event) => {
              event.preventDefault();
              void onOpenWorkspacePath(decodeWorkspacePathLink(href));
            }}
          >
            {children}
          </a>
        );
      }

      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
          {children}
        </a>
      );
    },
    ...(suppressImages ? { img: () => null } : {}), // When set, images handled by extractedImages + ImageLightbox
  }), [onOpenWorkspacePath, searchQuery, suppressImages]);

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
