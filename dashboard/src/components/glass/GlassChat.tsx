import { useState, useRef, useEffect, useCallback, lazy, Suspense, type KeyboardEvent, type ReactNode } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Copy, Check, ChevronRight, Wrench, Mic } from 'lucide-react';
import type { ChatMsg } from '@/features/chat/types';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { RichMessageCard } from './RichMessageCard';

const InlineChart = lazy(() => import('@/features/charts/InlineChart'));

// ─── Pipeline detection helper ──────────────────────────────────────────────
function isPipelineMessage(rawText?: string): boolean {
  if (!rawText) return false;
  return rawText.includes('[RESEARCH_PIPELINE]') ||
    (rawText.includes('Return ONLY the JSON object') && rawText.includes('"sections"'));
}

// ─── Compact tool call block (glass-styled) ─────────────────────────────────
function GlassToolBlock({ msg }: { msg: ChatMsg }) {
  const [expanded, setExpanded] = useState(false);
  const preview = msg.html?.replace(/<[^>]*>/g, '').trim() || msg.rawText?.slice(0, 80) || 'Tool call';

  // Grouped tool calls
  if (msg.toolGroup && msg.toolGroup.length > 0) {
    return (
      <div className="mx-1 my-0.5">
        <button onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full px-3 py-1.5 rounded-xl text-left bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all">
          <ChevronRight size={10} className={`text-white/20 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <Wrench size={10} className="text-indigo-400/50 shrink-0" />
          <span className="text-[10px] text-white/30 truncate">{msg.toolGroup.length} tool{msg.toolGroup.length > 1 ? 's' : ''}</span>
        </button>
        {expanded && (
          <div className="ml-5 mt-1 space-y-0.5 border-l border-white/[0.04] pl-2.5">
            {msg.toolGroup.map((entry, ei) => (
              <div key={ei} className="flex items-center gap-1.5 py-0.5">
                <span className="text-green-400/50 text-[9px]">✓</span>
                <span className="text-[10px] text-white/30 truncate">{entry.preview}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Single tool call
  return (
    <div className="mx-1 my-0.5">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-xl text-left bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all">
        <ChevronRight size={10} className={`text-white/20 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <Wrench size={10} className="text-indigo-400/50 shrink-0" />
        <span className="text-[10px] text-white/30 truncate">{preview}</span>
      </button>
      {expanded && msg.rawText && (
        <div className="ml-5 mt-1 border-l border-white/[0.04] pl-2.5">
          <pre className="text-[9px] text-white/20 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">{msg.rawText}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Thinking bubble (glass-styled) ─────────────────────────────────────────
function GlassThinkingBubble({ msg }: { msg: ChatMsg }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-1 my-0.5">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-xl text-left bg-indigo-500/[0.04] border border-indigo-400/[0.08] hover:bg-indigo-500/[0.07] transition-all">
        <ChevronRight size={10} className={`text-indigo-300/30 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="text-[10px]">💭</span>
        <span className="text-[10px] text-indigo-300/50 font-medium">Thinking</span>
        {msg.thinkingDurationMs && (
          <span className="text-[9px] text-indigo-300/30 tabular-nums">
            {msg.thinkingDurationMs >= 1000 ? `${(msg.thinkingDurationMs / 1000).toFixed(1)}s` : `${msg.thinkingDurationMs}ms`}
          </span>
        )}
        {!expanded && (
          <span className="text-[9px] text-indigo-300/20 truncate flex-1 min-w-0 italic">{msg.rawText.slice(0, 80)}</span>
        )}
      </button>
      {expanded && (
        <div className="ml-5 mt-1 border-l border-indigo-400/10 pl-2.5 pb-1">
          <div className="msg-body text-[11px] text-white/50 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <MarkdownRenderer content={msg.rawText} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Image display (glass-styled thumbnail) ─────────────────────────────────
function GlassImage({ src, alt }: { src: string; alt?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <img src={src} alt={alt || 'Image'} onClick={() => setExpanded(!expanded)}
        className={`rounded-lg border border-white/[0.08] object-contain cursor-pointer hover:border-white/20 transition-all ${expanded ? 'max-w-full max-h-[500px]' : 'max-w-[220px] max-h-[160px]'}`} />
      {expanded && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setExpanded(false)}>
          <img src={src} alt={alt || 'Image'} className="max-w-[90vw] max-h-[90vh] rounded-xl border border-white/10 object-contain" />
        </div>
      )}
    </>
  );
}

// ─── Copy button ────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  }, [text]);
  return (
    <button onClick={handleCopy} className="w-6 h-6 rounded-md flex items-center justify-center text-white/0 group-hover:text-white/20 hover:!text-white/50 hover:!bg-white/[0.06] transition-all" title="Copy">
      {copied ? <Check size={10} className="text-green-400/60" /> : <Copy size={10} />}
    </button>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

interface GlassChatProps {
  messages: ChatMsg[];
  isStreaming: boolean;
  streamingText: string;
  streamingRawText?: string;
  processingStage: string | null;
  onSend: (text: string, images?: string[]) => void;
  agentName: string;
}

export function GlassChat({
  messages,
  isStreaming,
  streamingText,
  streamingRawText = '',
  processingStage,
  onSend,
  agentName,
}: GlassChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  // Check if current streaming is for a pipeline request (hide from chat)
  const isPipelineStreaming = isStreaming && (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user') return isPipelineMessage(m.rawText);
      if (m.role === 'assistant') return false;
    }
    return false;
  })();

  // Render individual messages
  const renderMessage = (msg: ChatMsg, i: number): ReactNode => {
    const hasContent = msg.html || msg.rawText;
    if (!hasContent) return null;

    const isUser = msg.role === 'user';
    const isAssistant = msg.role === 'assistant';
    const isTool = msg.role === 'tool' || msg.role === 'toolResult';
    const isSystem = msg.role === 'system' || msg.role === 'event';

    // ── Pipeline filtering ──
    if (isUser && isPipelineMessage(msg.rawText)) return null;
    if (isAssistant) {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') {
          if (isPipelineMessage(messages[j].rawText)) return null;
          break;
        }
      }
    }

    // ── System / event messages — skip ──
    if (isSystem) return null;

    // ── Tool calls — compact collapsible block ──
    if (isTool) {
      return <GlassToolBlock key={msg.msgId || `tool-${i}`} msg={msg} />;
    }

    // ── Thinking bubbles ──
    if (msg.isThinking) {
      return <GlassThinkingBubble key={msg.msgId || `think-${i}`} msg={msg} />;
    }

    // ── Intermediate messages (narration between tool calls) ──
    if (msg.intermediate && isAssistant) {
      return (
        <div key={msg.msgId || `inter-${i}`} className="mx-1 my-0.5 flex items-start gap-2 px-2 py-1">
          <span className="text-[9px] text-white/15 mt-0.5">💬</span>
          <div className="text-[11px] text-white/30 leading-relaxed msg-body [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <MarkdownRenderer content={msg.rawText} />
          </div>
        </div>
      );
    }

    // Voice message detection
    const isVoice = isUser && (msg.isVoice || msg.rawText?.includes('[voice] '));
    let displayText = msg.rawText || msg.html?.replace(/<[^>]*>/g, '').trim() || '';
    if (isUser) {
      displayText = displayText.replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/g, '');
      displayText = displayText.replace(/\[voice\]\s*/g, '');
      displayText = displayText.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, '');
    }

    // ── Standard message bubble ──
    return (
      <div key={msg.msgId || i} className={`group flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isUser ? 'bg-cyan-500/15 border border-cyan-400/15' : 'bg-indigo-500/15 border border-indigo-400/15'}`}>
          {isUser ? <User size={13} className="text-cyan-300" /> : <Bot size={13} className="text-indigo-300" />}
        </div>

        {/* Content bubble */}
        <div className={`relative max-w-[85%] rounded-2xl text-[13px] leading-relaxed
          ${isUser
            ? 'bg-cyan-500/10 border border-cyan-400/10 text-white/85 rounded-tr-md px-3.5 py-2.5 overflow-hidden'
            : 'bg-white/[0.04] border border-white/[0.06] text-white/75 rounded-tl-md overflow-visible'
          }`}>

          {/* Voice badge */}
          {isVoice && (
            <div className="px-3.5 pt-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/10 text-[9px] text-indigo-300/60 font-medium">
                <Mic size={8} /> Voice
              </span>
            </div>
          )}

          {/* Attached images (base64 from user uploads) */}
          {msg.images && msg.images.length > 0 && (
            <div className={`flex gap-2 flex-wrap ${isUser ? 'px-3.5 pt-2 justify-end' : 'px-3.5 pt-2.5'}`}>
              {msg.images.map((img, j) => (
                <GlassImage key={j} src={img.preview} alt={img.name || 'image'} />
              ))}
            </div>
          )}

          {/* Text content */}
          {(displayText || (!isUser && msg.html)) && (
            <div className={isUser ? '' : 'px-3.5 py-2.5'}>
              {!isUser ? (
                <RichMessageCard html={msg.html} rawText={displayText} />
              ) : (
                <div className="whitespace-pre-wrap break-words">{displayText}</div>
              )}
            </div>
          )}

          {/* Inline charts */}
          {msg.charts && msg.charts.length > 0 && (
            <div className="px-3.5 pb-2.5">
              <Suspense fallback={<div className="text-white/20 text-[10px]">Loading chart…</div>}>
                {msg.charts.map((chart, ci) => (
                  <InlineChart key={ci} chart={chart} />
                ))}
              </Suspense>
            </div>
          )}

          {/* Extracted images (from agent responses — markdown images, URLs) */}
          {msg.extractedImages && msg.extractedImages.length > 0 && (
            <div className="flex flex-col gap-2 px-3.5 pb-2.5">
              {msg.extractedImages.map((img, idx) => (
                <GlassImage key={idx} src={img.url} alt={img.alt || 'Agent image'} />
              ))}
            </div>
          )}

          {/* Copy button — hover reveal */}
          {!isUser && !msg.streaming && msg.rawText && (
            <div className="absolute top-1.5 right-1.5">
              <CopyButton text={msg.rawText} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-auto glass-scroll px-4 py-3 space-y-2">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <Sparkles size={28} className="text-indigo-400" />
            <div className="text-sm text-white/50">Start a conversation with {agentName}</div>
          </div>
        )}

        {messages.map(renderMessage)}

        {/* Streaming message — hidden during pipeline requests */}
        {isStreaming && !isPipelineStreaming && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-indigo-500/15 border border-indigo-400/15">
              {processingStage === 'thinking' ? (
                <Loader2 size={13} className="text-indigo-300 animate-spin" />
              ) : (
                <Bot size={13} className="text-indigo-300" />
              )}
            </div>
            <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tl-md text-[13px] leading-relaxed bg-white/[0.04] border border-white/[0.06] text-white/75">
              {streamingText ? (
                <div className="break-words">
                  <RichMessageCard html={streamingText} rawText={streamingRawText} forceSimple />
                  <span className="inline-block w-1.5 h-4 bg-indigo-400/60 ml-0.5 animate-pulse rounded-sm" />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/40">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce [animation-delay:0ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                  <span className="text-[11px]">
                    {processingStage === 'thinking' ? 'Thinking…' : processingStage === 'tool_use' ? 'Using tools…' : 'Processing…'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 pb-3 pt-2">
        <div className="
          flex items-end gap-2 px-3 py-2
          bg-white/[0.04] border border-white/[0.08] rounded-xl
          focus-within:border-indigo-400/30 focus-within:bg-white/[0.06]
          transition-all duration-200
        ">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}…`}
            rows={1}
            className="
              flex-1 bg-transparent text-[13px] text-white/85 placeholder:text-white/25
              resize-none outline-none py-1 min-h-[24px] max-h-[160px]
            "
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={`
              w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200
              ${input.trim() && !isStreaming
                ? 'bg-indigo-500/25 border border-indigo-400/30 text-indigo-300 hover:bg-indigo-500/35 cursor-pointer'
                : 'bg-white/[0.03] border border-white/[0.05] text-white/20 cursor-not-allowed'
              }
            `}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
