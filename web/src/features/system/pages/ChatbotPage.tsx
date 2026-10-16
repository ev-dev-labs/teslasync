import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useDeferredValue,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, History as HistoryIcon } from 'lucide-react';
import { HelixMark } from '@/components/branding/HelixMark';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button, Drawer, Textarea, Text, Icon, IconBox, IconButton } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { VisuallyHidden } from '@/components/a11y';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { iconSize, neonColorMap } from '@/lib/tokens';
import {
  useChatSessions,
  useChatHistory,
  useSendChatMessage,
  useRenameChatSession,
  useDeleteChatSession,
} from '@/api/hooks/useChat';
import type { ChatMessage } from '@/api/types';
import { useAiEnabled } from '@/hooks/useAiEnabled';
import { useAiStream, mergeAiToolActivity, type AiStreamEvent } from '@/hooks/useAiStream';

import {
  ChatMessageItem,
  type UIChatMessage,
} from '../components/chatbot/ChatMessageItem';
import { SessionList } from '../components/chatbot/SessionList';
import { extractKnowledgeEvidence, mergeKnowledgeEvidence } from '../components/chatbot/knowledgeEvidence';
import { ChatWelcome } from '../components/chatbot/ChatWelcome';
// Chatbot LLM surface
// rendered conditionally via withAiFeature('chatbot-llm', …); absent
// in off mode (ADR-015 §I5 + §I6).
import { AIChatbotIndicator } from '@/components/ai';
// Optional browser STT/TTS panel
// mounted above the conversation; absent in off mode via withAiFeature.
import { AIVoiceMode } from '@/components/ai';

// History sidebar visibility persists across reloads via localStorage so
// that a desktop user who opens the History panel finds it still open
// after a refresh. Default is hidden (matches the cleaner "focused on
// the conversation" first-launch experience the design wants).
const HISTORY_VISIBLE_LS_KEY = 'teslasync-chatbot-history-visible';

function readStoredHistoryVisible(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HISTORY_VISIBLE_LS_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistHistoryVisible(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_VISIBLE_LS_KEY, value ? 'true' : 'false');
  } catch {
    // localStorage unavailable (private browsing, quota, SSR) — toggle
    // still works for the current tab, just doesn't survive reload.
  }
}

/**
 * Chatbot page.
 * Two code paths driven by `useAiEnabled('chatbot-llm')`:
 *   • AI off (baseline) — `useSendChatMessage` POSTs the legacy
 *     heuristic `/chatbot` route and runs a client-side typewriter on
 *     the full reply. This is the canonical baseline for users with
 *     `ai_mode='off'` (ADR-015 §I3).
 *   • AI on — `useAiStream` opens an SSE stream against
 *     `POST /api/v1/ai/chatbot` and accumulates `delta` events directly
 *     into the streaming assistant message. The typewriter is skipped
 *     (real streaming replaces the simulated reveal).
 * Both hooks are called unconditionally at the top of the component
 * (React Hooks rule). The branch lives inside the submit handlers.
 * Keyboard contract:
 *   Enter         submit
 *   Shift+Enter   newline
 *   Escape        stop streaming reveal (instant complete) / cancel SSE
 *   ↑ (empty input) recall last user message into the input
 */
export default function ChatbotPage() {
  const { t } = useTranslation();
  usePageTitle(t('chatbot.title', 'Helix'));
  const motion = useMotionPreference();

  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const sessionIdRef = useRef('');
  const generationRef = useRef(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const localTranscriptRef = useRef(false);
  const requestRef = useRef<{
    generation: number;
    sessionId: string;
    revision?: { prefix: UIChatMessage[]; resolve: (accepted: boolean) => void };
  } | null>(null);
  const [baselinePending, setBaselinePending] = useState(false);
  const isMobile = useIsMobile();
  // History panel visibility:
  //   - Default: hidden (cleaner first-launch focus on the conversation).
  //   - Desktop: persists across reloads via localStorage so a user who
  //     explicitly opens the panel finds it open again after a refresh.
  //   - Mobile: always starts hidden (the sidebar would consume the
  //     small viewport); flipping back to desktop restores the stored
  //     preference.
  const [showSessions, setShowSessionsState] = useState<boolean>(() => {
    // `window.matchMedia` is absent under SSR and in some test/jsdom
    // environments — guard it the same way useMediaQuery does so the
    // initializer never throws before the effect below can sync.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    const isMobileView = window.matchMedia('(max-width: 640px)').matches;
    if (isMobileView) return false;
    return readStoredHistoryVisible();
  });
  const setShowSessions = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setShowSessionsState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        persistHistoryVisible(value);
        return value;
      });
    },
    [],
  );
  // When the viewport breakpoint flips: on mobile force-close so the
  // sidebar doesn't consume the screen (without touching the persisted
  // desktop preference); on desktop restore the user's stored choice.
  useEffect(() => {
    if (isMobile) {
      setShowSessionsState(false);
    } else {
      setShowSessionsState(readStoredHistoryVisible());
    }
  }, [isMobile]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionsQuery = useChatSessions();
  const sessions = sessionsQuery.data ?? [];

  const historyQuery = useChatHistory(sessionId);

  // Hydrate local messages whenever the loaded history changes (switching
  // sessions or first load). Keeps the typewriter-managed local state as
  // the source of truth for the in-flight session.
  // Race guards (matter especially when the History sidebar is open and
  // the user starts a brand-new chat then submits):
  //   1. While the SSE is in flight for the *current* session, the local
  //      optimistic messages (user + streaming assistant placeholder) are
  //      authoritative. A history GET that races with the stream can
  //      resolve with `[]` (server hasn't persisted yet) OR with `[user]`
  //      only (user message persisted, assistant still streaming) — in
  //      both cases, blindly replacing local state would erase the
  //      placeholder the SSE deltas are targeting by id and the
  //      conversation would silently fail to display in the chat panel
  //      while still appearing as "N msgs" in the sidebar after `done`.
  //   2. Even outside an active stream, an empty server response paired
  //      with non-empty local optimistic messages for the *same* sid is
  //      almost certainly a stale read of a brand-new session — keep
  //      local. (We compare `prev[0].session_id` to the current
  //      sessionId so switching to a *different* session that happens to
  //      be empty still clears the panel correctly.)
  useEffect(() => {
    if (!historyQuery.data || historyQuery.isPlaceholderData || sessionId !== sessionIdRef.current ||
        localTranscriptRef.current || requestRef.current) return;
    const data = historyQuery.data;
    if (data.some((message) => message.session_id !== sessionId)) return;
    setMessages(data.map(toUIMessage));
  }, [historyQuery.data, historyQuery.isPlaceholderData, sessionId, sessionGeneration]);

  const renameMut = useRenameChatSession();
  const deleteMut = useDeleteChatSession();

  // Typewriter state — fully encapsulated so the page logic stays small.
  const stream = useTypewriterStream({
    reduceMotion: motion.reduce,
    onTick: (id, partial) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, streamedText: partial } : m)),
      ),
    onComplete: (id) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, isStreaming: false, streamedText: undefined } : m,
        ),
      );
      // Return focus to the input after the reveal completes.
      inputRef.current?.focus();
    },
  });

  const sendMut = useSendChatMessage();

  /* ─── AI-on path ─────────────────────────────────────────────────────── */

  // Gate: when true, submitMessage and friends call the SSE LLM
  // endpoint at POST /api/v1/ai/chatbot instead of the heuristic
  // baseline POST /chatbot. Both hooks below are called
  // unconditionally — React Hooks rule. Branching lives in handlers.
  const aiEnabled = useAiEnabled('chatbot-llm');

  // The non-null body that triggers the SSE start() via the
  // pendingAiRequest → useEffect → aiStream.start() pipeline. Reset
  // to null on done/error so a subsequent click fires a fresh stream.
  const [pendingAiRequest, setPendingAiRequest] = useState<
    { message: string; session_id: string } | null
  >(null);

  // Which assistant message receives streamed delta text. Cleared
  // on done/error/stop so the next click can target a fresh row.
  const [streamingMsgId, setStreamingMsgId] = useState<number | null>(null);
  const streamingMsgIdRef = useRef<number | null>(null);
  const finishAiRequest = useCallback((accepted: boolean) => {
    const request = requestRef.current;
    if (request?.revision && accepted) {
      const id = streamingMsgIdRef.current;
      setMessages((previous) => [
        ...request.revision!.prefix.map((message) => ({ ...message, session_id: request.sessionId })),
        ...previous.filter((message) => message.id === id),
      ]);
    }
    request?.revision?.resolve(accepted);
    requestRef.current = null;
    streamingMsgIdRef.current = null;
    setStreamingMsgId(null);
    setPendingAiRequest(null);
  }, []);

  const handleAiEvent = useCallback(
    (ev: AiStreamEvent) => {
      const id = streamingMsgIdRef.current;
      const request = requestRef.current;
      if (id === null || !request || request.generation !== generationRef.current ||
          request.sessionId !== sessionIdRef.current) return;
      if (ev.type === 'delta') {
        aiStreamTextRef.current += ev.text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, streamedText: (m.streamedText ?? '') + ev.text }
              : m,
          ),
        );
      } else if (ev.type === 'tool_call') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  aiActivity: mergeAiToolActivity(m.aiActivity ?? [], {
                    id: ev.id,
                    name: ev.name,
                    status: 'running',
                  }),
                }
              : m,
          ),
        );
      } else if (ev.type === 'tool_result') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  aiActivity: mergeAiToolActivity(m.aiActivity ?? [], {
                    id: ev.id,
                    name: ev.name,
                    status: ev.ok ? 'succeeded' : 'failed',
                  }),
                  knowledgeEvidence: ev.ok && ev.name === 'retrieve_app_knowledge'
                    ? mergeKnowledgeEvidence(m.knowledgeEvidence ?? [], extractKnowledgeEvidence(ev.data, pendingAiRequest?.message ?? ''))
                    : m.knowledgeEvidence,
                }
              : m,
          ),
        );
      } else if (ev.type === 'done') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  isStreaming: false,
                  content: m.streamedText ?? m.content,
                  streamedText: undefined,
                  aiUsage: ev.usage,
                  aiActivity: settlePendingActivity(m.aiActivity),
                  aiState: 'done',
                  outcome: (m.streamedText ?? m.content).trim() ? undefined : 'empty',
                }
              : m,
          ),
        );
        // Only an actual text delta accepts a revision; tool execution alone is not an answer.
        finishAiRequest(aiStreamTextRef.current.trim().length > 0);
        sessionsQuery.refetch();
      } else if (ev.type === 'error') {
        // AI error: keep what was streamed so far (if any) and append
        // a short failure marker. The user can resubmit; we don't
        // auto-fall-back to the legacy heuristic because that would
        // hide the AI failure from the user.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  isStreaming: false,
                  content:
                    (m.streamedText && m.streamedText.length > 0
                      ? m.streamedText + '\n\n'
                      : '') +
                    t('chatbot.aiError', '(AI error: {{message}})', {
                      message: ev.message,
                    }),
                  streamedText: undefined,
                  aiActivity: settlePendingActivity(m.aiActivity),
                  aiState: 'error',
                  outcome: 'error',
                }
              : m,
          ),
        );
        finishAiRequest(false);
      } else if (ev.type === 'confirm_request') {
        setMessages((prev) => prev.map((m) => m.id === id ? {
          ...m, isStreaming: false, content: m.streamedText ?? m.content,
          streamedText: undefined, aiActivity: settlePendingActivity(m.aiActivity),
          aiState: 'paused-confirm', outcome: 'canceled',
        } : m));
        finishAiRequest(false);
      }
    },
    [sessionsQuery, t, pendingAiRequest?.message, finishAiRequest],
  );

  const aiStreamTextRef = useRef('');
  const aiStream = useAiStream({
    url: '/ai/chatbot',
    body: pendingAiRequest,
    onEvent: handleAiEvent,
    scopeKey: `${sessionGeneration}:${sessionId}`,
  });

  // Trigger the stream whenever a fresh pendingAiRequest is set. The
  // hook's start() is a no-op while runningRef is true and while
  // pendingAiRequest is null/undefined; we reset pendingAiRequest to
  // null inside handleAiEvent on done/error so the next click fires
  // cleanly.
  useEffect(() => {
    if (pendingAiRequest) aiStream.start();
    // intentionally omit aiStream from deps — start is idempotent and
    // including it would re-fire on every state change inside the hook
  }, [pendingAiRequest]);

  useEffect(() => {
    if (aiStream.state === 'paused-confirm') aiStream.cancel();
  }, [aiStream.state, aiStream.cancel]);

  // When the AI feature is toggled off mid-stream, cancel the SSE and
  // clear in-flight state. Keeps any user message already persisted
  // visible; the streaming assistant row gets finalized with whatever
  // arrived.
  useEffect(() => {
    if (!aiEnabled && streamingMsgId) {
      aiStream.cancel();
      const id = streamingMsgId;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isStreaming: false,
                content: m.streamedText ?? m.content,
                streamedText: undefined,
                aiActivity: settlePendingActivity(m.aiActivity),
                aiState: 'idle',
                outcome: 'canceled',
              }
            : m,
        ),
      );
      finishAiRequest(false);
    }
  }, [aiEnabled, streamingMsgId, aiStream, finishAiRequest]);

  // Transport-level SSE failure (non-2xx response, dropped connection)
  // flips useAiStream to state='error' WITHOUT emitting an 'error' event
  // to onEvent — so handleAiEvent never runs. Without this effect the
  // optimistic assistant placeholder would stay pinned as "streaming"
  // forever and pendingAiRequest would never clear, permanently blocking
  // every subsequent send (the submit guard bails while pendingAiRequest
  // is non-null). Finalize the row with a user-visible error marker and
  // reset the in-flight state so the user can retry. SSE 'error' *frames*
  // are handled earlier by handleAiEvent, which clears streamingMsgId /
  // pendingAiRequest first — so this effect is a no-op for that path.
  useEffect(() => {
    if (aiStream.state !== 'error') return;
    const id = streamingMsgIdRef.current;
    if (id === null && pendingAiRequest === null) return;
    if (id !== null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isStreaming: false,
                content:
                  (m.streamedText && m.streamedText.length > 0
                    ? m.streamedText + '\n\n'
                    : '') +
                  t('chatbot.aiError', '(AI error: {{message}})', {
                    message: aiStream.error ?? 'stream failed',
                  }),
                streamedText: undefined,
                aiActivity: settlePendingActivity(m.aiActivity),
                aiState: 'error',
                outcome: 'error',
              }
            : m,
        ),
      );
    }
    finishAiRequest(false);
  }, [aiStream.state, aiStream.error, t, finishAiRequest]);

  // Auto-scroll on every new message AND while a reveal is in progress
  // (so the user sees the text grow rather than having it appear below
  // the viewport). useDeferredValue keeps the dependency stable while
  // many other state pieces change in the same render — without it the
  // effect would fire on every keystroke into the input box.
  const deferredCount = useDeferredValue(messages.length);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: motion.reduce ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [deferredCount, motion.reduce]);

  // Light-weight tick-driven scroll while a stream is active (either
  // the typewriter on the legacy path or the SSE stream on the AI
  // path). We only fire while either is active so it costs nothing
  // the rest of the time. `behavior: 'auto'` keeps it cheap (no smooth
  // animation queue) — the visual effect is "the text grows downward
  // and the viewport tracks it".
  useEffect(() => {
    if (!stream.isActive && aiStream.state !== 'streaming') return;
    const id = window.setInterval(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }, 200);
    return () => window.clearInterval(id);
  }, [stream.isActive, aiStream.state]);

  /* ─── handlers ─────────────────────────────────────────────────────── */

  const newAiSessionId = () => `s_${crypto.randomUUID()}`;

  const submitMessage = useCallback(
    (text: string, revision?: { prefix: UIChatMessage[]; resolve: (accepted: boolean) => void }) => {
      const msg = text.trim();
      if (!msg || requestRef.current || stream.isActive ||
          (sessionId && !localTranscriptRef.current && (historyQuery.isPending || historyQuery.isError)) ||
          (deleteMut.isPending && deleteMut.variables?.sessionId === sessionId)) return false;
      if (aiEnabled) {
        // AI-on path: SSE stream against /api/v1/ai/chatbot.
        if (aiStream.state === 'streaming' || pendingAiRequest) return false;
        localTranscriptRef.current = true;
        const sid = sessionId || newAiSessionId();
        if (!sessionId) {
          sessionIdRef.current = sid;
          setSessionId(sid);
        }
        requestRef.current = { generation: generationRef.current, sessionId: sid, revision };
        aiStreamTextRef.current = '';
        const userId = nextLocalId();
        const assistantId = nextLocalId();
        const created = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          ...(!revision ? [{
            id: userId,
            session_id: sid,
            role: 'user' as const,
            content: msg,
            created_at: created,
          }] : []),
          {
            id: assistantId,
            session_id: sid,
            role: 'assistant',
            content: '',
            created_at: created,
            isStreaming: true,
            streamedText: '',
          },
        ]);
        streamingMsgIdRef.current = assistantId;
        setStreamingMsgId(assistantId);
        setPendingAiRequest({ message: msg, session_id: sid });
        return true;
      }
      // AI-off path: legacy heuristic POST /chatbot.
      localTranscriptRef.current = true;
      const request = { generation: generationRef.current, sessionId: sessionIdRef.current, revision };
      requestRef.current = request;
      setBaselinePending(true);
      const userId = nextLocalId();
      if (!revision) setMessages((prev) => [
        ...prev,
        {
          id: userId,
          session_id: sessionId || 'pending',
          role: 'user',
          content: msg,
          created_at: new Date().toISOString(),
        },
      ]);
      sendMut.mutate({ message: msg, sessionId: sessionId || undefined }, {
        onSuccess: (data) => {
          if (requestRef.current !== request || request.generation !== generationRef.current ||
              request.sessionId !== sessionIdRef.current) return;
          const accepted = !!data.response?.trim() &&
            (!request.sessionId || request.sessionId === data.session_id);
          if (!accepted) {
            requestRef.current = null;
            setBaselinePending(false);
            revision?.resolve(false);
            setMessages((prev) => [...prev, {
              id: nextLocalId(), session_id: sessionIdRef.current, role: 'assistant',
              content: '', created_at: new Date().toISOString(), outcome: 'empty',
            }]);
            return;
          }
          sessionIdRef.current = data.session_id;
          setSessionId(data.session_id);
          const assistantId = nextLocalId();
          const assistantMsg: UIChatMessage = {
            id: assistantId, session_id: data.session_id, role: 'assistant',
            content: data.response, created_at: new Date().toISOString(),
            isStreaming: true, streamedText: '', links: data.links ?? [],
          };
          setMessages((prev) => [
            ...(revision?.prefix ?? prev).map((m) => ({ ...m, session_id: data.session_id })),
            assistantMsg,
          ]);
          requestRef.current = null;
          setBaselinePending(false);
          revision?.resolve(true);
          stream.start(assistantId, data.response);
          void sessionsQuery.refetch();
        },
        onError: () => {
          if (requestRef.current !== request) return;
          requestRef.current = null;
          setBaselinePending(false);
          revision?.resolve(false);
          setMessages((prev) => [...prev, {
            id: nextLocalId(), session_id: sessionIdRef.current, role: 'assistant',
            content: '', created_at: new Date().toISOString(), outcome: 'error',
          }]);
        },
      });
      return true;
    },
    [aiEnabled, aiStream.state, pendingAiRequest, sendMut, sessionId, stream,
      historyQuery.isPending, historyQuery.isError, deleteMut.isPending, deleteMut.variables, sessionsQuery],
  );

  const handleSend = useCallback(() => {
    if (submitMessage(input)) setInput('');
  }, [input, submitMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter submits; Shift+Enter inserts a newline (default behavior).
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
      // ↑ on an empty input recalls the last user message for quick edit.
      if (e.key === 'ArrowUp' && input === '') {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          e.preventDefault();
          setInput(lastUser.content);
        }
      }
    },
    [handleSend, input, messages],
  );

  // Esc cancels the streaming reveal AND aborts an in-flight SSE.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (stream.isActive) stream.stop();
        if (aiStream.state === 'streaming') {
          aiStream.cancel();
          // Finalize the streaming assistant row with whatever arrived.
          const id = streamingMsgIdRef.current;
          if (id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      isStreaming: false,
                      content: m.streamedText ?? m.content,
                      streamedText: undefined,
                      aiActivity: settlePendingActivity(m.aiActivity),
                      aiState: 'idle',
                      outcome: 'canceled',
                    }
                  : m,
              ),
            );
            finishAiRequest(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stream, aiStream, finishAiRequest]);

  const startNewSession = useCallback(() => {
    generationRef.current++;
    setSessionGeneration(generationRef.current);
    sessionIdRef.current = '';
    localTranscriptRef.current = false;
    requestRef.current?.revision?.resolve(false);
    requestRef.current = null;
    streamingMsgIdRef.current = null;
    setBaselinePending(false);
    stream.stop();
    aiStream.cancel();
    setStreamingMsgId(null);
    setPendingAiRequest(null);
    setSessionId('');
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }, [stream, aiStream]);

  const loadSession = useCallback(
    (sid: string) => {
      generationRef.current++;
      setSessionGeneration(generationRef.current);
      sessionIdRef.current = sid;
      localTranscriptRef.current = false;
      requestRef.current?.revision?.resolve(false);
      requestRef.current = null;
      streamingMsgIdRef.current = null;
      setBaselinePending(false);
      stream.stop();
      aiStream.cancel();
      setStreamingMsgId(null);
      setPendingAiRequest(null);
      setSessionId(sid);
      setMessages([]);
    },
    [stream, aiStream],
  );

  const handleRegenerate = useCallback(
    (assistantMsg: UIChatMessage) => {
      // Find the user message immediately preceding this assistant one;
      // resubmit it so the backend produces a fresh reply, and drop the
      // old assistant message so the reveal can re-render cleanly.
      const idx = messages.findIndex((m) => m.id === assistantMsg.id);
      if (idx <= 0) return;
      const userMsg = [...messages.slice(0, idx)]
        .reverse()
        .find((m) => m.role === 'user');
      if (!userMsg) return;
      const truncated = messages.slice(0, idx);
      submitMessage(userMsg.content, { prefix: truncated, resolve: () => undefined });
    },
    [
      messages,
      submitMessage,
    ],
  );

  const handleEditAndResend = useCallback(
    (userMsg: UIChatMessage, newText: string) => {
      // Truncate history at this user message and resubmit with the new
      // text — same model as ChatGPT-style "edit and regenerate".
      const idx = messages.findIndex((m) => m.id === userMsg.id);
      if (idx < 0 || (userMsg.session_id !== sessionIdRef.current &&
          !(userMsg.session_id === 'pending' && !sessionIdRef.current))) return false;
      const truncated = messages.slice(0, idx);
      const editedId = nextLocalId();
      const editedMsg: UIChatMessage = {
        ...userMsg,
        id: editedId,
        content: newText,
        created_at: new Date().toISOString(),
      };
      return new Promise<boolean>((resolve) => {
        if (!submitMessage(newText, { prefix: [...truncated, editedMsg], resolve })) resolve(false);
      });
    },
    [
      messages,
      submitMessage,
    ],
  );

  const handleRename = useCallback(
    (sid: string, title: string) => {
      renameMut.mutate({ sessionId: sid, title });
    },
    [renameMut],
  );

  const handleDelete = useCallback(
    (sid: string) => {
      const generation = generationRef.current;
      deleteMut.mutate({ sessionId: sid }, {
        onSuccess: () => {
          if (sid === sessionIdRef.current && generation === generationRef.current) startNewSession();
        },
      });
    },
    [deleteMut, startNewSession],
  );

  /* ─── derived ─────────────────────────────────────────────────────── */

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant' && !m.outcome)?.id ??
      [...messages].reverse().find((m) => m.role === 'assistant')?.id,
    [messages],
  );
  const lastUserId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user')?.id,
    [messages],
  );

  const isAiStreaming = pendingAiRequest !== null && streamingMsgId !== null;
  const isStreaming = stream.isActive || isAiStreaming;
  const isWaiting =
    (baselinePending && !stream.isActive) ||
    (isAiStreaming &&
      messages.find((m) => m.id === streamingMsgId)?.streamedText === '');

  const stopAll = useCallback(() => {
    stream.stop();
    aiStream.cancel();
    const id = streamingMsgIdRef.current;
    if (id) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isStreaming: false,
                content: m.streamedText ?? m.content,
                streamedText: undefined,
                aiActivity: settlePendingActivity(m.aiActivity),
                aiState: 'idle',
                outcome: 'canceled',
              }
            : m,
        ),
      );
      finishAiRequest(false);
    }
  }, [stream, aiStream, finishAiRequest]);

  /* ─── render ──────────────────────────────────────────────────────── */

  return (
    <PageLayout
      title={t('chatbot.title', 'Helix')}
      subtitle={t(
        'chatbot.subtitle',
        'Evidence-grounded intelligence across your fleet and TeslaSync knowledge',
      )}
      metadataActions={<AIChatbotIndicator />}
      secondaryActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <IconButton icon={<Icon icon={HistoryIcon} />} label={t('chatbot.history', 'History')} onClick={() => setShowSessions((s) => !s)} aria-pressed={showSessions} />
        </div>
      }
    >
      <section
        aria-label={t('chatbot.aria.workspace', 'Assistant workspace')}
        className="flex flex-1 flex-col gap-4 min-h-0"
      >
        <AIVoiceMode />

        <div className="relative flex min-h-0 gap-4 h-[calc(100dvh_-_12rem)]">
          {showSessions &&
            (isMobile ? (
              <Drawer
                open
                side="left"
                size="sm"
                title={t('chatbot.history', 'History')}
                onClose={() => setShowSessions(false)}
              >
                  <SessionList
                    sessions={sessions}
                    activeSessionId={sessionId}
                    onSelect={(id) => {
                      loadSession(id);
                      setShowSessions(false);
                    }}
                    onNewChat={() => {
                      startNewSession();
                      setShowSessions(false);
                    }}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    isLoading={sessionsQuery.isLoading}
                    className="h-full w-full"
                  />
              </Drawer>
            ) : (
              <FadeIn>
                <SessionList
                  sessions={sessions}
                  activeSessionId={sessionId}
                  onSelect={loadSession}
                  onNewChat={startNewSession}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  isLoading={sessionsQuery.isLoading}
                  className="h-full"
                />
              </FadeIn>
            ))}

          <GlassPanel className="flex min-w-0 flex-1 flex-col overflow-hidden !p-0">
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={t('chatbot.aria.conversation', 'Conversation')}
              className="flex-1 overflow-y-auto"
            >
              <div className="flex min-h-full flex-col items-center px-3 py-4 sm:px-4">
                <div className="flex w-full max-w-3xl flex-1 flex-col space-y-3">
                  {sessionId && !localTranscriptRef.current && (
                    historyQuery.isPending || historyQuery.isError || historyQuery.fetchStatus === 'paused'
                  ) && (
                    <div role={historyQuery.isError ? 'alert' : 'status'}>
                      <Text as="p" variant="bodySm">
                        {historyQuery.isError
                          ? t('chatbot.historyFailed', 'Conversation history could not be loaded.')
                          : historyQuery.fetchStatus === 'paused'
                            ? t('chatbot.historyPaused', 'Conversation history is waiting for a connection.')
                            : t('chatbot.historyLoading', 'Loading conversation history…')}
                      </Text>
                      {historyQuery.isError && (
                        <Button variant="secondary" size="sm" onClick={() => void historyQuery.refetch()}>
                          {t('common.retry', 'Retry')}
                        </Button>
                      )}
                    </div>
                  )}
                  {deleteMut.variables?.sessionId === sessionId && (deleteMut.isPending || deleteMut.isError) && (
                    <Text as="p" variant="bodySm" role={deleteMut.isError ? 'alert' : 'status'}>
                      {deleteMut.isPending
                        ? t('chatbot.deleting', 'Deleting conversation…')
                        : t('chatbot.deleteFailed', 'Conversation was not deleted. Your messages and draft are retained; try again from History.')}
                    </Text>
                  )}
                  {messages.length === 0 && (!sessionId || historyQuery.isSuccess) ? (
                    <ChatWelcome
                      onPick={(text) => {
                        setInput(text);
                        inputRef.current?.focus();
                      }}
                    />
                  ) : (
                    messages.map((msg, i) => {
                      const prev = messages[i - 1];
                      const next = messages[i + 1];
                      const isFirstInGroup = !prev || prev.role !== msg.role;
                      const isLastInGroup = !next || next.role !== msg.role;
                      return (
                        <ChatMessageItem
                          key={msg.id}
                          message={msg}
                          isLastAssistant={msg.id === lastAssistantId}
                          isLastUser={msg.id === lastUserId}
                          isFirstInGroup={isFirstInGroup}
                          isLastInGroup={isLastInGroup}
                          actionsDisabled={isStreaming || baselinePending || deleteMut.isPending}
                          onRegenerate={handleRegenerate}
                          onEditAndResend={handleEditAndResend}
                        />
                      );
                    })
                  )}

                  {isWaiting && (
                    <FadeIn>
                      <div className="flex items-start gap-3">
                        <IconBox color="neutral" size="sm">
                          <HelixMark className={iconSize.md} aria-hidden="true" />
                        </IconBox>
                        <GlassPanel variant="embedded" className="min-w-0 !p-3">
                          <Text as="p" variant="bodySm" className="break-words">
                            {t('chatbot.processing', 'Helix is processing your request…')}
                          </Text>
                        </GlassPanel>
                      </div>
                    </FadeIn>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>

            <div className={`border-t ${neonColorMap.neutral.border} px-3 py-3 sm:px-4`}>
              <div className="flex justify-center">
                <div className="w-full max-w-3xl">
                  <VisuallyHidden as="label" htmlFor="chatbot-input">
                    {t('chatbot.inputLabel', 'Message')}
                  </VisuallyHidden>
                  <div className="flex items-end gap-2 sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <Textarea
                        ref={inputRef}
                        id="chatbot-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t(
                          'chatbot.placeholder',
                          'Ask Helix to investigate, compare, or explain…',
                        )}
                        rows={1}
                        className="max-h-40 min-h-11 resize-none"
                        aria-label={t('chatbot.inputLabel', 'Message')}
                      />
                    </div>
                    {isStreaming ? (
                      <Button
                        onClick={stopAll}
                        variant="secondary"
                        icon={<Icon icon={Square} />}
                        aria-label={t('chatbot.actions.stopStreaming', 'Stop streaming')}
                        title={t('chatbot.actions.stopHint', 'Stop reveal (Esc)')}
                        className="min-h-11 min-w-11 shrink-0 md:min-h-10 md:min-w-0"
                      >
                        <span className="hidden sm:inline">{t('chatbot.actions.stop', 'Stop')}</span>
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSend}
                        disabled={!input.trim() || baselinePending || isAiStreaming ||
                          (deleteMut.isPending && deleteMut.variables?.sessionId === sessionId) ||
                          (!!sessionId && !localTranscriptRef.current && (historyQuery.isPending || historyQuery.isError))}
                        variant="primary"
                        icon={<Icon icon={Send} />}
                        aria-label={t('chatbot.actions.send', 'Send message')}
                        className="min-h-11 min-w-11 shrink-0 md:min-h-10 md:min-w-0"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </GlassPanel>
        </div>
      </section>
    </PageLayout>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────── */

function toUIMessage(m: ChatMessage): UIChatMessage {
  return { ...m };
}

function settlePendingActivity(
  activity: UIChatMessage['aiActivity'],
): UIChatMessage['aiActivity'] {
  return activity?.map((item) =>
    item.status === 'running' ? { ...item, status: 'failed' } : item,
  );
}

let localIdSeq = 0;
function nextLocalId(): number {
  // Negative ids never collide with backend-issued (positive) ids.
  localIdSeq -= 1;
  return -Date.now() + localIdSeq;
}

interface TypewriterStream {
  start: (id: number, fullText: string) => void;
  stop: () => void;
  isActive: boolean;
}

interface TypewriterOptions {
  reduceMotion: boolean;
  onTick: (id: number, partial: string) => void;
  onComplete: (id: number) => void;
}

/**
 * useTypewriterStream — client-side typewriter reveal for assistant
 * replies. Encapsulates the timer/cleanup so the page component stays
 * declarative.
 * When `prefers-reduced-motion: reduce` is set, the reveal is skipped
 * entirely and the full text appears immediately — both `onTick` and
 * `onComplete` still fire so consumers don't have to special-case the
 * reduced-motion path.
 * Reveal rate: ~40 chars per 16ms tick (≈2,500 chars/sec). Tuned to feel
 * snappy without flooding React's re-render queue. The reveal is fully
 * cancellable via `stop()` (also fired by Esc and the on-screen Stop
 * button) — calling stop while a reveal is in flight immediately renders
 * the rest of the text and runs `onComplete`.
 */
function useTypewriterStream(opts: TypewriterOptions): TypewriterStream {
  const { reduceMotion, onTick, onComplete } = opts;
  const stateRef = useRef<{
    id: number | null;
    full: string;
    pos: number;
    raf: number | null;
    timer: number | null;
  }>({ id: null, full: '', pos: 0, raf: null, timer: null });
  const [active, setActive] = useState(false);

  const cleanup = useCallback(() => {
    const s = stateRef.current;
    if (s.raf != null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
    if (s.timer != null) {
      window.clearTimeout(s.timer);
      s.timer = null;
    }
  }, []);

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s.id == null) return;
    cleanup();
    onTick(s.id, s.full);
    onComplete(s.id);
    s.id = null;
    s.pos = 0;
    s.full = '';
    setActive(false);
  }, [cleanup, onTick, onComplete]);

  const start = useCallback(
    (id: number, fullText: string) => {
      cleanup();
      const s = stateRef.current;
      s.id = id;
      s.full = fullText;
      s.pos = 0;

      if (reduceMotion || fullText.length === 0) {
        onTick(id, fullText);
        onComplete(id);
        s.id = null;
        s.full = '';
        setActive(false);
        return;
      }

      setActive(true);
      const tick = () => {
        const cur = stateRef.current;
        if (cur.id == null) return;
        const charsPerTick = 40;
        cur.pos = Math.min(cur.full.length, cur.pos + charsPerTick);
        onTick(cur.id, cur.full.slice(0, cur.pos));
        if (cur.pos >= cur.full.length) {
          const finishedId = cur.id;
          cur.id = null;
          cur.pos = 0;
          cur.full = '';
          setActive(false);
          onComplete(finishedId);
          return;
        }
        cur.timer = window.setTimeout(() => {
          cur.raf = requestAnimationFrame(tick);
        }, 16);
      };
      tick();
    },
    [cleanup, onTick, onComplete, reduceMotion],
  );

  // Stop the timer on unmount — we don't care about the in-flight reveal,
  // but we MUST not leave a setTimeout firing into a torn-down component.
  useEffect(() => () => cleanup(), [cleanup]);

  return { start, stop, isActive: active };
}
