/**
 * ChatContext — Thin orchestrator that composes chat hooks
 *
 * Business logic is distributed across composable hooks:
 * - useChatMessages: message CRUD, dedup, history, infinite scroll
 * - useChatStreaming: stream rendering, processing stage, activity log
 * - useChatRecovery: recovery/retry, gap detection, generation guards
 * - useChatTTS: TTS playback, voice fallback, sound feedback
 *
 * This file handles:
 * - React context creation and provider
 * - Session-level state (isGenerating, showResetConfirm)
 * - Run state management (runsRef, activeRunIdRef, sequence tracking)
 * - Gateway event subscription (delegating to hook methods)
 * - Wiring hook outputs into the context value
 */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSessionContext } from './SessionContext';
import { useSettings } from './SettingsContext';
import { getSessionKey, type GatewayEvent } from '@/types';
import {
  getRootAgentSessionKey,
  isRootChildSession,
  isSubagentSessionKey,
  isTopLevelAgentSessionKey,
} from '@/features/sessions/sessionKeys';
import {
  loadChatHistory,
  processChatMessages,
  buildUserMessage,
  sendChatMessage,
  classifyStreamEvent,
  deriveProcessingStage,
  isActiveAgentState,
  mergeRecoveredTail,
  getOrCreateRunState,
  hasSeqGap,
  updateHighestSeq,
} from '@/features/chat/operations';
import { generateMsgId } from '@/features/chat/types';
import { renderMarkdown } from '@/utils/helpers';
import type { ImageAttachment, ChatMsg } from '@/features/chat/types';
import type { RecoveryReason, RunState } from '@/features/chat/operations';

import { useChatMessages, mergeFinalMessages } from '@/hooks/useChatMessages';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { useChatRecovery } from '@/hooks/useChatRecovery';
import { useChatTTS } from '@/hooks/useChatTTS';

// ─── Exported types (consumed by features/chat components) ──────────────────────

/** Processing stages for enhanced thinking indicator */
export type ProcessingStage = 'thinking' | 'tool_use' | 'streaming' | null;

/** A single entry in the activity log */
export interface ActivityLogEntry {
  id: string;           // toolCallId or generated unique id
  toolName: string;     // raw tool name (e.g., 'read', 'exec')
  description: string;  // human-friendly from describeToolUse()
  startedAt: number;    // Date.now() when tool started
  completedAt?: number; // Date.now() when result received
  phase: 'running' | 'completed';
}

export interface ChatStreamState {
  html: string;
  rawText?: string;
  runId?: string;
  isRecovering?: boolean;
  recoveryReason?: RecoveryReason | null;
}

interface ChatContextValue {
  messages: ChatMsg[];
  isGenerating: boolean;
  stream: ChatStreamState;
  processingStage: ProcessingStage;
  lastEventTimestamp: number;
  activityLog: ActivityLogEntry[];
  currentToolDescription: string | null;
  handleSend: (text: string, images?: ImageAttachment[]) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleReset: () => void;
  loadHistory: (session?: string) => Promise<void>;
  /** Load more (older) messages — returns true if there are still more to show */
  loadMore: () => boolean;
  /** Whether there are older messages available to load */
  hasMore: boolean;
  /** Reset confirmation dialog state — rendered by the consumer, not the provider */
  showResetConfirm: boolean;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { currentSession, sessions } = useSessionContext();
  const { soundEnabled, speak } = useSettings();

  // ─── Shared state ─────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ─── Refs for stable callback references ──────────────────────────────────
  const currentSessionRef = useRef(currentSession);
  const isGeneratingRef = useRef(isGenerating);
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession;
    isGeneratingRef.current = isGenerating;
    soundEnabledRef.current = soundEnabled;
    speakRef.current = speak;
  }, [currentSession, isGenerating, soundEnabled, speak]);

  // ─── Run state management ─────────────────────────────────────────────────
  const runsRef = useRef<Map<string, RunState>>(new Map());
  const activeRunIdRef = useRef<string | null>(null);
  const lastGatewaySeqRef = useRef<number | null>(null);
  const lastChatSeqRef = useRef<number | null>(null);
  const toolResultRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Compose hooks ────────────────────────────────────────────────────────
  const msgHook = useChatMessages({ rpc, currentSessionRef });
  const streamHook = useChatStreaming();
  const ttsHook = useChatTTS({ soundEnabled: soundEnabledRef, speak: speakRef });

  const recoveryHook = useChatRecovery({
    rpc,
    currentSessionRef,
    isGeneratingRef,
    activeRunIdRef,
    runsRef,
    getAllMessages: msgHook.getAllMessages,
    applyMessageWindow: msgHook.applyMessageWindow,
    setStream: streamHook.setStream,
  });

  // ─── Reset transient state on session switch ──────────────────────────────
  useEffect(() => {
    setIsGenerating(false);
    msgHook.resetMessageState();
    streamHook.resetStreamState();
    recoveryHook.resetRecoveryState();
    runsRef.current.clear();
    activeRunIdRef.current = null;
    lastGatewaySeqRef.current = null;
    lastChatSeqRef.current = null;
    if (toolResultRefreshRef.current) {
      clearTimeout(toolResultRefreshRef.current);
      toolResultRefreshRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession]);

  // ─── Load history on connect / recover on reconnect ───────────────────────
  const previousConnectionStateRef = useRef(connectionState);
  useEffect(() => {
    const prevConnection = previousConnectionStateRef.current;

    if (connectionState === 'connected') {
      if (prevConnection === 'reconnecting' && recoveryHook.wasGeneratingOnDisconnect()) {
        recoveryHook.triggerRecovery('reconnect');
      }
      recoveryHook.clearDisconnectState();
    }

    if (connectionState === 'reconnecting' && prevConnection === 'connected') {
      recoveryHook.captureDisconnectState();
    }

    previousConnectionStateRef.current = connectionState;
  }, [
    connectionState,
    currentSession,
    msgHook.loadHistory,
    recoveryHook.wasGeneratingOnDisconnect,
    recoveryHook.triggerRecovery,
    recoveryHook.clearDisconnectState,
    recoveryHook.captureDisconnectState,
  ]);

  useEffect(() => {
    if (connectionState !== 'connected' || !currentSession) return;
    msgHook.loadHistory(currentSession);
  }, [connectionState, currentSession, msgHook.loadHistory]);

  // ─── Periodic history poll for sub-agent sessions ─────────────────────────
  const isSubagentSession = currentSession ? isSubagentSessionKey(currentSession) : false;
  const subagentSessionState = isSubagentSession
    ? sessions.find(s => getSessionKey(s) === currentSession)?.state?.toLowerCase()
    : undefined;
  const DONE_STATES = new Set(['idle', 'done', 'completed', 'error', 'aborted', 'timeout', 'stopped', 'finished', 'ended', 'cancelled']);
  const isSubagentActive = isSubagentSession && !(subagentSessionState && DONE_STATES.has(subagentSessionState));
  const subagentPollInFlightRef = useRef(false);

  useEffect(() => {
    if (!isSubagentActive || connectionState !== 'connected') return;

    const pollInterval = setInterval(async () => {
      if (subagentPollInFlightRef.current) return;
      subagentPollInFlightRef.current = true;
      try {
        const sk = currentSessionRef.current;
        const result = await loadChatHistory({ rpc, sessionKey: sk, limit: 500 });
        if (sk !== currentSessionRef.current) return;
        const prev = msgHook.getAllMessages();
        if (
          result.length === prev.length &&
          result.length > 0 &&
          result[result.length - 1]?.rawText === prev[prev.length - 1]?.rawText &&
          result[result.length - 1]?.role === prev[prev.length - 1]?.role
        ) return;
        msgHook.applyMessageWindow(result, false);
      } catch { /* best-effort */ } finally {
        subagentPollInFlightRef.current = false;
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      subagentPollInFlightRef.current = false;
    };
  }, [isSubagentActive, connectionState, currentSession, rpc, msgHook.applyMessageWindow, msgHook.getAllMessages]);

  // ─── Watchdog: if stream stalls, recover once ─────────────────────────────
  useEffect(() => {
    if (!isGenerating || !streamHook.lastEventTimestamp) return;

    const timer = setTimeout(() => {
      const elapsed = Date.now() - streamHook.lastEventTimestamp;
      if (elapsed >= 12_000 && !recoveryHook.isRecoveryInFlight() && !recoveryHook.isRecoveryPending()) {
        recoveryHook.triggerRecovery('chat-gap');
      }
    }, 12_000);

    return () => clearTimeout(timer);
  }, [
    isGenerating,
    streamHook.lastEventTimestamp,
    recoveryHook.isRecoveryInFlight,
    recoveryHook.isRecoveryPending,
    recoveryHook.triggerRecovery,
  ]);

  // ─── Raw WS listener: process substrate_raw events (same payloads as original WebUI) ─
  // The gateway WS translation layer is unreliable for chat streaming.
  // broadcast_raw() sends the raw send_message_to_frontend payloads over the
  // already-authenticated gateway WS as 'substrate_raw' events.
  const rawStreamBufRef = useRef('');
  const thinkingBufRef = useRef('');
  const rawRunIdRef = useRef<string | null>(null);

  // ─── Subscribe to streaming events ────────────────────────────────────────
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      // ── substrate_raw: direct send_message_to_frontend payloads ──────
      // Same format the original WebUI uses. Bypasses the gateway translation layer.
      if (msg.event === 'substrate_raw' && msg.payload) {
        const raw = msg.payload as Record<string, unknown>;
        const status = raw.status as string | undefined;
        const rawType = raw.type as string | undefined;
        const result = raw.result as string | undefined;

        // Voice audio — play Kokoro TTS audio on this client
        if (rawType === 'voice-audio' && typeof raw.url === 'string') {
          window.dispatchEvent(new CustomEvent('substrate:voice-audio', { detail: { url: raw.url } }));
          return;
        }

        // Skip non-chat noise
        if (raw.suppress_chat) return;
        if (rawType === 'config' || rawType === 'config_update' || rawType === 'avatar' || rawType === 'avatar_emotions') return;
        // ── Accumulate thinking content for the collapsible thinking bubble ──
        if (rawType === 'thinking_start') {
          thinkingBufRef.current = '';
          return;
        }
        if (rawType === 'thinking_delta') {
          const chunk = (raw.content as string) || '';
          if (chunk) thinkingBufRef.current += chunk;
          return;
        }
        if (rawType === 'thinking_end') {
          const thinkingText = thinkingBufRef.current.trim();
          thinkingBufRef.current = '';
          if (thinkingText) {
            const thinkingMsg: ChatMsg = {
              msgId: generateMsgId(),
              role: 'assistant',
              html: renderMarkdown(thinkingText),
              rawText: thinkingText,
              timestamp: new Date(),
              isThinking: true,
              thinkingDurationMs: streamHook.getThinkingDuration(rawRunIdRef.current || '') ?? undefined,
            };
            msgHook.setAllMessages(prev => [...prev, thinkingMsg]);
            msgHook.setMessages((prev: ChatMsg[]) => [...prev, thinkingMsg]);
          }
          return;
        }
        if (typeof result === 'string' && (result.startsWith('[SILENT]') || result === 'CIRCUITS_OK' || result === 'HEARTBEAT_OK')) return;
        if (!status && !rawType) return;

        // Tool activity — update processing stage
        if (status === 'tool_executing' || status === 'tool_result') {
          streamHook.setProcessingStage('tool_use');
          streamHook.setLastEventTimestamp(Date.now());
          return;
        }

        // User messages from the other UI (WebUI /api/input broadcasts these)
        if (status === 'user_message' && typeof result === 'string' && result.trim()) {
          const alreadyExists = msgHook.getAllMessages().some(
            m => m.role === 'user' && m.rawText === result.trim()
              && Date.now() - m.timestamp.getTime() < 10_000
          );
          if (!alreadyExists) {
            const { msg: userMsg } = buildUserMessage({ text: result.trim() });
            userMsg.pending = false;
            msgHook.setAllMessages(prev => [...prev, userMsg]);
            msgHook.setMessages((prev: ChatMsg[]) => [...prev, userMsg]);
          }
          return;
        }

        // Thinking
        if (status === 'thinking' || rawType === 'thinking') {
          // Extract user message from thinking event (sent by both /api/input and chat.send)
          if (Array.isArray(raw.messages)) {
            const userContent = (raw.messages as Array<Record<string, unknown>>).find(m => m.role === 'user');
            if (userContent && typeof userContent.content === 'string' && userContent.content.trim()) {
              const text = userContent.content.trim();
              const alreadyExists = msgHook.getAllMessages().some(
                m => m.role === 'user' && m.rawText === text
                  && Date.now() - m.timestamp.getTime() < 10_000
              );
              if (!alreadyExists) {
                const { msg: userMsg } = buildUserMessage({ text });
                userMsg.pending = false;
                msgHook.setAllMessages(prev => [...prev, userMsg]);
                msgHook.setMessages((prev: ChatMsg[]) => [...prev, userMsg]);
              }
            }
          }
          if (!isGeneratingRef.current) setIsGenerating(true);
          streamHook.setProcessingStage('thinking');
          streamHook.setLastEventTimestamp(Date.now());
          rawStreamBufRef.current = '';
          thinkingBufRef.current = '';
          if (!rawRunIdRef.current) rawRunIdRef.current = 'raw-' + Date.now();
          streamHook.startThinking(rawRunIdRef.current);
          return;
        }

        // Streaming chunks (incremental — accumulate)
        if (status === 'streaming' && typeof result === 'string' && result) {
          if (!isGeneratingRef.current) setIsGenerating(true);
          rawStreamBufRef.current += result;
          const runId = rawRunIdRef.current || ('raw-' + Date.now());
          rawRunIdRef.current = runId;
          streamHook.captureThinkingDuration();
          streamHook.scheduleStreamingUpdate(runId, rawStreamBufRef.current);
          streamHook.setProcessingStage('streaming');
          streamHook.setLastEventTimestamp(Date.now());
          return;
        }

        // Final response
        if (status === 'done' || status === 'success') {
          let content = '';
          if (Array.isArray(raw.messages)) {
            for (let i = (raw.messages as Array<Record<string, unknown>>).length - 1; i >= 0; i--) {
              const m = (raw.messages as Array<Record<string, unknown>>)[i];
              if (m && m.role === 'assistant') {
                content = (typeof m.content === 'string' ? m.content : '') as string;
                break;
              }
            }
          }
          if (!content && typeof result === 'string') content = result;

          const trimmed = content.trim();
          if (trimmed && trimmed !== 'No response generated.' && trimmed !== 'No content') {
            const finalChatMessages = processChatMessages([
              { role: 'assistant', content: trimmed } as import('@/types').ChatMessage,
            ]);
            if (finalChatMessages.length > 0) {
              const existing = msgHook.getAllMessages();
              const merged = mergeFinalMessages(existing, finalChatMessages);
              msgHook.applyMessageWindow(merged, false);
            }
          }

          setIsGenerating(false);
          streamHook.setProcessingStage(null);
          streamHook.setActivityLog([]);
          streamHook.setLastEventTimestamp(0);
          streamHook.clearStreamBuffer();
          rawStreamBufRef.current = '';
          rawRunIdRef.current = null;
          return;
        }

        // Error
        if (status === 'error') {
          setIsGenerating(false);
          streamHook.setProcessingStage(null);
          streamHook.clearStreamBuffer();
          rawStreamBufRef.current = '';
          rawRunIdRef.current = null;
          return;
        }

        return; // substrate_raw handled — don't fall through to classifyStreamEvent
      }

      let recoveryTriggeredThisEvent = false;
      const triggerRecoveryOnce = (reason: RecoveryReason) => {
        if (recoveryTriggeredThisEvent) return;
        recoveryTriggeredThisEvent = true;
        recoveryHook.triggerRecovery(reason);
      };

      const classified = classifyStreamEvent(msg);
      if (!classified) return;

      const currentSk = currentSessionRef.current;
      if (classified.sessionKey !== currentSk) {
        if (
          isTopLevelAgentSessionKey(currentSk) &&
          classified.sessionKey &&
          isSubagentSessionKey(classified.sessionKey) &&
          isRootChildSession(classified.sessionKey, getRootAgentSessionKey(currentSk) || currentSk) &&
          (classified.type === 'chat_final' || classified.type === 'lifecycle_end')
        ) {
          recoveryHook.triggerRecovery('subagent-complete');
        }
        return;
      }

      // Track gateway frame sequence
      if (typeof msg.seq === 'number') {
        if (hasSeqGap(lastGatewaySeqRef.current, msg.seq) && (isGeneratingRef.current || Boolean(activeRunIdRef.current))) {
          triggerRecoveryOnce('frame-gap');
        }
        lastGatewaySeqRef.current = updateHighestSeq(lastGatewaySeqRef.current, msg.seq);
      }

      const { type } = classified;

      // ── Agent events ────────────────────────────────────────────────────
      if (classified.source === 'agent') {
        const ap = classified.agentPayload!;

        if (type === 'lifecycle_start') {
          setIsGenerating(true);
          streamHook.setProcessingStage('thinking');
          streamHook.setLastEventTimestamp(Date.now());
          return;
        }

        if (type === 'lifecycle_end') {
          setIsGenerating(false);
          streamHook.setProcessingStage(null);
          streamHook.setActivityLog([]);
          streamHook.setLastEventTimestamp(0);
          ttsHook.playCompletionPing();

          recoveryHook.incrementGeneration();

          const activeRun = activeRunIdRef.current;
          const runFinalized = activeRun ? runsRef.current.get(activeRun)?.finalized : false;
          if (!runFinalized) {
            recoveryHook.triggerRecovery('reconnect');
          }
          activeRunIdRef.current = null;
          return;
        }

        if (type === 'assistant_stream') {
          streamHook.setProcessingStage('streaming');
          streamHook.setLastEventTimestamp(Date.now());
          return;
        }

        const agentState = ap.state || ap.agentState;
        if (!isGeneratingRef.current && agentState && isActiveAgentState(agentState)) {
          setIsGenerating(true);
        }

        streamHook.setLastEventTimestamp(Date.now());

        if (type === 'agent_tool_start') {
          streamHook.setProcessingStage('tool_use');
          streamHook.addActivityEntry(ap);
          return;
        }

        if (type === 'agent_tool_result') {
          const completedId = ap.data?.toolCallId;
          if (completedId) streamHook.completeActivityEntry(completedId);

          if (toolResultRefreshRef.current) clearTimeout(toolResultRefreshRef.current);
          const capturedSession = currentSessionRef.current;
          const capturedGeneration = recoveryHook.getGeneration();
          toolResultRefreshRef.current = setTimeout(async () => {
            toolResultRefreshRef.current = null;
            try {
              const recovered = await loadChatHistory({ rpc, sessionKey: capturedSession, limit: 100 });
              if (capturedSession !== currentSessionRef.current) return;
              if (capturedGeneration !== recoveryHook.getGeneration()) return;
              if (recovered.length > 0) {
                const merged = mergeRecoveredTail(msgHook.getAllMessages(), recovered);
                msgHook.applyMessageWindow(merged, false);
              }
            } catch { /* best-effort */ }
          }, 300);
          return;
        }

        if (type === 'agent_state' && agentState) {
          const stage = deriveProcessingStage(agentState);
          if (stage) streamHook.setProcessingStage(stage);
        }
        return;
      }

      // ── Chat events — handled by SSE listener, skip in gateway WS ─────
      // The SSE listener (above) processes raw send_message_to_frontend payloads
      // directly — the same proven path used by the original WebUI.
    });
  }, [
    msgHook.getAllMessages,
    msgHook.applyMessageWindow,
    streamHook.setProcessingStage,
    streamHook.setLastEventTimestamp,
    streamHook.setActivityLog,
    streamHook.addActivityEntry,
    streamHook.completeActivityEntry,
    streamHook.startThinking,
    streamHook.captureThinkingDuration,
    streamHook.scheduleStreamingUpdate,
    streamHook.clearStreamBuffer,
    streamHook.getThinkingDuration,
    streamHook.resetThinking,
    recoveryHook.triggerRecovery,
    recoveryHook.incrementGeneration,
    recoveryHook.getGeneration,
    ttsHook.playCompletionPing,
    ttsHook.resetPlayedSounds,
    ttsHook.handleFinalTTS,
    subscribe,
    rpc,
  ]);

  // ─── Send message ─────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    ttsHook.trackVoiceMessage(text);

    const { msg: userMsg, tempId } = buildUserMessage({ text, images });

    recoveryHook.incrementGeneration();

    // Optimistic insert (functional updater to avoid read-then-write race)
    msgHook.setAllMessages(prev => [...prev, userMsg]);
    msgHook.setMessages((prev: ChatMsg[]) => [...prev, userMsg]);
    setIsGenerating(true);
    streamHook.setStream((prev: ChatStreamState) => ({ ...prev, html: '', runId: undefined }));
    streamHook.setProcessingStage('thinking');

    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : 'ik-' + Date.now();
    try {
      const ack = await sendChatMessage({
        rpc,
        sessionKey: currentSessionRef.current,
        text,
        images,
        idempotencyKey,
      });

      if (ack.runId) {
        const run = getOrCreateRunState(runsRef.current, ack.runId, currentSessionRef.current);
        run.status = ack.status;
        run.finalized = false;
        activeRunIdRef.current = ack.runId;
        streamHook.startThinking(ack.runId);
      }

      // Confirm the message (functional updater to avoid race after await)
      const confirmMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false } : m;
      msgHook.setAllMessages(prev => prev.map(confirmMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(confirmMsg));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      const failMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false, failed: true } : m;
      msgHook.setAllMessages(prev => prev.map(failMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(failMsg));

      const errMsgBubble: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: 'Send error: ' + errMsg,
        rawText: '',
        timestamp: new Date(),
      };
      msgHook.setAllMessages(prev => [...prev, errMsgBubble]);
      msgHook.setMessages((prev: ChatMsg[]) => [...prev, errMsgBubble]);
      setIsGenerating(false);
    }
  }, [rpc, msgHook, streamHook, ttsHook, recoveryHook]);

  // ─── Abort / Reset ────────────────────────────────────────────────────────
  const handleAbort = useCallback(async () => {
    try {
      await rpc('chat.abort', { sessionKey: currentSessionRef.current });
    } catch (err) {
      console.debug('[ChatContext] Abort request failed:', err);
    }
  }, [rpc]);

  const handleReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const confirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      await rpc('sessions.reset', { key: currentSessionRef.current });
      const msg: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: '⚙️ Session reset. Starting fresh.',
        rawText: '',
        timestamp: new Date(),
      };
      msgHook.setAllMessages([msg]);
      msgHook.applyMessageWindow([msg], true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const msg: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: `⚙️ Reset failed: ${errMsg}`,
        rawText: '',
        timestamp: new Date(),
      };
      msgHook.setAllMessages(prev => [...prev, msg]);
      msgHook.setMessages((prev: ChatMsg[]) => [...prev, msg]);
    }
  }, [msgHook, rpc]);

  const cancelReset = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  // ─── Context value ────────────────────────────────────────────────────────
  const value = useMemo<ChatContextValue>(() => ({
    messages: msgHook.messages,
    isGenerating,
    stream: streamHook.stream,
    processingStage: streamHook.processingStage,
    lastEventTimestamp: streamHook.lastEventTimestamp,
    activityLog: streamHook.activityLog,
    currentToolDescription: streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory: msgHook.loadHistory,
    loadMore: msgHook.loadMore,
    hasMore: msgHook.hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    msgHook.messages,
    isGenerating,
    streamHook.stream,
    streamHook.processingStage,
    streamHook.lastEventTimestamp,
    streamHook.activityLog,
    streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    msgHook.loadHistory,
    msgHook.loadMore,
    msgHook.hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  ]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook export is intentional
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
