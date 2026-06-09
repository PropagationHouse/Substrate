/**
 * MobileLayout — Phone-optimized layout with scrollable top icon bar.
 * All modules accessible: Chat, Tasks, Notes, Research, Workbench, Chess, Stats, History, Settings.
 * Each module renders fullscreen below the nav. The tablet (>640px) layout is completely unaffected.
 */
import { useState, useRef, useEffect, useCallback, Component } from 'react';
import {
  MessageSquare, LayoutGrid, StickyNote, Search, Film,
  Crown, BarChart3, Calendar, Settings, Monitor,
} from 'lucide-react';
import { GlassChat } from '@/components/glass/GlassChat';
import { MobileTasksView } from './MobileTasksView';
import { MobileSettingsView } from './MobileSettingsView';
import { GlassChess } from '@/components/GlassChess';
import { AgentStatsTab } from '@/components/AgentStatsTab';
import { NotesTab } from '@/features/workspace/tabs/NotesTab';
import { ResearchPanel } from '@/components/ResearchPanel';
import { MobileWorkbench } from './MobileWorkbench';
import { MobileWidgetView } from './MobileWidgetView';
import { MobilePeripheralsView } from './MobilePeripheralsView';
import { applyBackgroundSettings, loadBgImage } from '@/components/BackgroundSettings';
import type { ChatMsg } from '@/features/chat/types';

type MobileTab = 'chat' | 'tasks' | 'notes' | 'research' | 'workbench' | 'peripherals' | 'chess' | 'stats' | 'history' | 'settings';

interface MobileLayoutProps {
  messages: ChatMsg[];
  isStreaming: boolean;
  streamingText: string;
  streamingRawText?: string;
  processingStage: string | null;
  onSend: (text: string, images?: any[]) => void;
  agentName: string;
  connectionState: string;
}

const TABS: { key: MobileTab; label: string; icon: typeof MessageSquare }[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'tasks', label: 'Tasks', icon: LayoutGrid },
  { key: 'notes', label: 'Notes', icon: StickyNote },
  { key: 'research', label: 'Research', icon: Search },
  { key: 'workbench', label: 'Workbench', icon: Film },
  { key: 'peripherals', label: 'Cams', icon: Monitor },
  { key: 'chess', label: 'Chess', icon: Crown },
  { key: 'stats', label: 'Stats', icon: BarChart3 },
  { key: 'history', label: 'History', icon: Calendar },
  { key: 'settings', label: 'Settings', icon: Settings },
];

// Error boundary to prevent white-screen crashes
class MobileErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0a0a1a] px-6 text-center">
          <div className="text-red-400 text-sm font-medium mb-2">Something crashed</div>
          <div className="text-[11px] text-white/40 mb-4 max-w-[90vw] break-words">{this.state.error.message}</div>
          <button onClick={() => this.setState({ error: null })} className="px-4 py-2 bg-indigo-500/20 border border-indigo-400/25 text-indigo-300 rounded-lg text-xs">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MobileLayout({
  messages,
  isStreaming,
  streamingText,
  streamingRawText,
  processingStage,
  onSend,
  agentName,
  connectionState,
}: MobileLayoutProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeEl = nav.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeTab]);

  // Apply background settings on mount
  useEffect(() => {
    applyBackgroundSettings();
    loadBgImage();
  }, []);

  // Swipe gesture handlers for chat → widget
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (activeTab !== 'chat' || widgetOpen) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, [activeTab, widgetOpen]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || activeTab !== 'chat' || widgetOpen) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = Math.abs(e.touches[0].clientY - touchStartRef.current.y);
    // Only track horizontal swipes (dx > 0 = right swipe), ignore if more vertical
    if (dx > 10 && dy < dx * 0.7) {
      setSwipeX(Math.min(dx, window.innerWidth));
    }
  }, [activeTab, widgetOpen]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;
    // If swiped more than 30% of screen width, open widget
    if (swipeX > window.innerWidth * 0.3) {
      setWidgetOpen(true);
    }
    setSwipeX(0);
    touchStartRef.current = null;
  }, [swipeX]);

  const closeWidget = useCallback(() => {
    setWidgetOpen(false);
    setSwipeX(0);
  }, []);

  return (
    <MobileErrorBoundary>
    <div className="h-screen w-screen flex flex-col bg-[#0a0a1a] overflow-hidden relative" style={{ overscrollBehavior: 'none' }} data-substrate-app>
      {/* Background image */}
      <img
        id="substrate-bg-img"
        alt=""
        style={{ position: 'absolute', inset: '-30px', width: 'calc(100% + 60px)', height: 'calc(100% + 60px)', objectFit: 'cover', objectPosition: 'center', zIndex: 0, pointerEvents: 'none', display: 'none' }}
      />
      {/* Dark overlay */}
      <div id="substrate-bg-overlay" style={{ position: 'absolute', inset: 0, zIndex: 1, background: '#0a0a1a', opacity: 0.55, pointerEvents: 'none' }} />

      {/* Top bar: status + scrollable nav (includes safe-area top padding) */}
      <div className="bg-black/40 backdrop-blur-lg border-b border-white/[0.06]" style={{ position: 'relative', zIndex: 2, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {/* Connection status */}
        <div className="flex items-center justify-between px-4 py-1.5">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              connectionState === 'connected' ? 'bg-green-400' :
              connectionState === 'connecting' ? 'bg-amber-400 animate-pulse' :
              'bg-red-400'
            }`} />
            <span className="text-[11px] font-medium text-white/60">{agentName || 'Substrate'}</span>
          </div>
          <span className="text-[9px] text-white/25 capitalize">{connectionState}</span>
        </div>

        {/* Scrollable icon tabs */}
        <div
          ref={navRef}
          className="flex overflow-x-auto no-scrollbar px-2 pb-2 gap-1"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                data-tab={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                  active
                    ? 'bg-indigo-500/20 border border-indigo-400/25 text-indigo-300'
                    : 'bg-white/[0.03] border border-transparent text-white/35 active:bg-white/[0.08]'
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2 : 1.5} />
                <span className={`text-[8px] font-medium whitespace-nowrap ${active ? 'text-indigo-300' : 'text-white/30'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content area — each module renders full height */}
      <div className="flex-1 min-h-0 overflow-hidden" style={{ position: 'relative', zIndex: 2 }}>
        {activeTab === 'chat' && (
          <div
            className="h-full relative"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Widget view — covers entire screen when open */}
            <div
              style={{
                position: 'fixed', inset: 0,
                zIndex: 100,
                display: widgetOpen ? 'block' : 'none',
              }}
              onTouchStart={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onTouchEnd={e => e.stopPropagation()}
            >
              <MobileWidgetView agentName={agentName} onClose={closeWidget} messages={messages} isStreaming={isStreaming} streamingRawText={streamingRawText} />
            </div>
            {/* Chat view — hidden when widget is open to prevent scrollIntoView interference */}
            <div style={{ height: '100%', display: widgetOpen ? 'none' : 'block' }}>
              <GlassChat
                messages={messages}
                isStreaming={isStreaming}
                streamingText={streamingText}
                streamingRawText={streamingRawText}
                processingStage={processingStage}
                onSend={onSend}
                agentName={agentName}
              />
            </div>
          </div>
        )}
        {activeTab === 'tasks' && <MobileTasksView />}
        {activeTab === 'notes' && (
          <div className="h-full overflow-auto">
            <NotesTab />
          </div>
        )}
        {activeTab === 'research' && (
          <div className="h-full overflow-auto">
            <ResearchPanel
              onClose={() => setActiveTab('chat')}
              onSendToAgent={(text) => { onSend(text); setActiveTab('chat'); }}
              chatMessages={messages}
              isAgentGenerating={isStreaming}
              streamingText={streamingText}
              streamingRawText={streamingRawText}
            />
          </div>
        )}
        {activeTab === 'workbench' && <MobileWorkbench />}
        {activeTab === 'chess' && (
          <div className="h-full overflow-auto p-2">
            <GlassChess />
          </div>
        )}
        {activeTab === 'stats' && (
          <div className="h-full overflow-auto">
            <AgentStatsTab />
          </div>
        )}
        {activeTab === 'history' && <MobileChatHistory />}
        {activeTab === 'peripherals' && <MobilePeripheralsView />}
        {activeTab === 'settings' && <MobileSettingsView />}
      </div>

      
    </div>
    </MobileErrorBoundary>
  );
}

// ─── Chat History (lightweight calendar view of past conversations) ──
function MobileChatHistory() {
  const [dates, setDates] = useState<Array<{ date: string; count: number }>>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Array<{ user_message?: string; assistant_response?: string; timestamp: number }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/local/chat-dates')
      .then(r => r.json())
      .then(d => setDates(d?.dates || []))
      .catch(() => {});
  }, []);

  const loadDay = async (date: string) => {
    setSelectedDate(date);
    setLoading(true);
    try {
      const r = await fetch(`/api/local/chat-day?date=${date}`);
      const d = await r.json();
      setMsgs(d?.messages || []);
    } catch { setMsgs([]); }
    setLoading(false);
  };

  if (selectedDate) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button onClick={() => setSelectedDate(null)} className="text-[11px] text-indigo-300">← Back</button>
          <span className="text-[12px] text-white/60 font-medium">{selectedDate}</span>
          <span className="text-[10px] text-white/30">{msgs.length} messages</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && <div className="text-white/30 text-xs text-center py-8">Loading...</div>}
          {msgs.map((m, i) => (
            <div key={i} className="space-y-1.5">
              {m.user_message && (
                <div className="text-[12px] text-cyan-300/70 bg-cyan-500/5 border border-cyan-400/10 rounded-xl px-3 py-2">
                  {m.user_message.slice(0, 300)}{m.user_message.length > 300 ? '...' : ''}
                </div>
              )}
              {m.assistant_response && (
                <div className="text-[11px] text-white/50 bg-white/[0.02] border border-white/[0.05] rounded-xl px-3 py-2">
                  {m.assistant_response.slice(0, 400)}{m.assistant_response.length > 400 ? '...' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-2">
      <h3 className="text-[13px] font-medium text-white/70 mb-3">Chat History</h3>
      {dates.length === 0 && (
        <div className="text-white/25 text-xs text-center py-8">No chat history found</div>
      )}
      {dates.slice().reverse().map(d => (
        <button
          key={d.date}
          onClick={() => loadDay(d.date)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left hover:bg-white/[0.06] transition-all"
        >
          <span className="text-[12px] text-white/60">{d.date}</span>
          <span className="text-[10px] text-white/30 bg-white/[0.06] px-2 py-0.5 rounded-full">{d.count}</span>
        </button>
      ))}
    </div>
  );
}
