/**
 * research-standalone.tsx — Standalone entry point for the Intelligence Hub.
 *
 * Renders the ResearchPanel in isolation (no dashboard chrome, no graph).
 * Used when the Workbench embeds the Hub inside a channel via iframe.
 *
 * URL params:
 *   ?channel=<id>&name=<channel_name>
 *
 * In standalone mode:
 *   - Deep research is the default (works via /api/local/deep-research)
 *   - Quick research sends prompts to the parent dashboard via postMessage
 *   - Data is stored per-channel: /api/local/research-feed?channel=<id>
 */
import { StrictMode, useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ResearchPanel } from '@/components/ResearchPanel';
import type { ChatMsg } from '@/features/chat/types';
import { getSessionToken } from '@/features/auth/useAuth';
import { applyTheme, themeNames, type ThemeName } from '@/lib/themes';
import { applyFont, fontNames, type FontName } from '@/lib/fonts';

// ── Apply theme + font immediately (before React renders) so CSS vars are defined ──
const savedTheme = localStorage.getItem('substrate:theme') as ThemeName | null;
applyTheme(savedTheme && themeNames.includes(savedTheme) ? savedTheme : 'ayu-dark');
const savedFont = localStorage.getItem('substrate:font') as FontName | null;
if (savedFont && fontNames.includes(savedFont)) applyFont(savedFont);

// ── Global fetch interceptor (same as main.tsx) ────────────────────────
const _origFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const token = getSessionToken();
  if (token && url.startsWith('/api/')) {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return _origFetch(input, { ...init, headers });
  }
  return _origFetch(input, init);
};

// ── Parse URL params ───────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const channelId = params.get('channel') || '';
const channelName = params.get('name') || 'Channel';

/**
 * StandaloneResearch — wrapper that provides the chat bridge for ResearchPanel.
 * In standalone mode, we relay agent requests to the parent dashboard via postMessage
 * and listen for streamed responses back.
 */
function StandaloneResearch() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingRawText, setStreamingRawText] = useState('');

  // Remove Tailwind's body gradient, keep only the flat theme bg color
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `body { background-image: none !important; }`;
    document.head.appendChild(style);
  }, []);

  // Listen for chat responses from parent dashboard
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'substrate:research-chat-response') {
        const { text, done, rawText } = e.data;
        if (text !== undefined) setStreamingText(text);
        if (rawText !== undefined) setStreamingRawText(rawText);
        if (done) {
          setIsGenerating(false);
          const content = rawText || text || '';
          setMessages(prev => [...prev, {
            role: 'assistant' as const,
            html: content,
            rawText: content,
            timestamp: new Date(),
          }]);
          setStreamingText('');
          setStreamingRawText('');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleSend = useCallback((text: string) => {
    // Add user message to local messages
    setMessages(prev => [...prev, {
      role: 'user' as const,
      html: text,
      rawText: text,
      timestamp: new Date(),
    }]);
    setIsGenerating(true);
    setStreamingText('');
    setStreamingRawText('');
    // Forward to top-level dashboard for LLM processing
    // (research iframe → Workbench iframe → Dashboard, so use window.top)
    const target = window.top || window.parent;
    target.postMessage({
      type: 'substrate:research-chat-request',
      text,
      channelId,
      channelName,
    }, '*');
  }, []);

  const channel = channelId ? { id: channelId, name: channelName } : null;

  return (
    <div className="h-full w-full overflow-hidden" style={{ background: 'transparent' }}>
      <ResearchPanel
        onClose={() => {}}
        onSendToAgent={handleSend}
        chatMessages={messages}
        isAgentGenerating={isGenerating}
        streamingText={streamingText}
        streamingRawText={streamingRawText}
        channel={channel}
        standalone={true}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneResearch />
  </StrictMode>,
);
