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
import { Bot, Send, Square, History as HistoryIcon } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Textarea } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { VisuallyHidden } from '@/components/a11y';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import {
  useChatSessions,
  useChatHistory,
  useSendChatMessage,
  useRenameChatSession,
  useDeleteChatSession,
} from '@/api/hooks/useChat';
import type { ChatMessage } from '@/api/types';

import {
  ChatMessageItem,
  type UIChatMessage,
} from '../components/chatbot/ChatMessageItem';
import { SessionList } from '../components/chatbot/SessionList';
import { SuggestedPrompts } from '../components/chatbot/SuggestedPrompts';
// Phase-50 / 0011 — U1 Chatbot LLM upgrade. Visible AI surface
// rendered conditionally via withAiFeature('chatbot-llm', …); absent
// in off mode (ADR-015 §I5 + §I6).
import { AIChatbotIndicator } from '@/components/ai/AIChatbotIndicator';

/**
 * Chatbot page (Phase 40 / Prompt 56).
 *
 * Polished AI assistant surface. The backend `sendChatMessage` endpoint is
 * still request/response — this page does NOT add server-streaming. It
 * uses a deliberate client-side typewriter to reveal the assistant reply
 * character-by-character so the UX matches modern chat surfaces; when
 * real SSE/WebSocket streaming lands the swap is just changing where
 * `streamedText` updates come from. See JSDoc on `useTypewriterStream`.
 *
 * Keyboard contract:
 *   Enter         submit
 *   Shift+Enter   newline
 *   Escape        stop streaming reveal (instant complete)
 *   ↑ (empty input) recall last user message into the input
 */
export default function ChatbotPage() {
  const { t } = useTranslation();
  usePageTitle(t('chatbot.title', 'AI Assistant'));
  const motion = useMotionPreference();

  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const isMobile = useIsMobile();
  // History panel: hidden by default on mobile (overlay drawer), open by default on desktop.
  const [showSessions, setShowSessions] = useState(!isMobile);
  // When the viewport breakpoint flips (rotation, resize) snap the panel to
  // the appropriate default so we don't strand a mobile user with a 288px
  // sidebar consuming the whole screen.
  useEffect(() => {
    setShowSessions(!isMobile);
  }, [isMobile]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionsQuery = useChatSessions();
  const sessions = sessionsQuery.data ?? [];

  const historyQuery = useChatHistory(sessionId);

  // Hydrate local messages whenever the loaded history changes (switching
  // sessions or first load). Keeps the typewriter-managed local state as
  // the source of truth for the in-flight session.
  useEffect(() => {
    if (historyQuery.data) {
      setMessages(historyQuery.data.map(toUIMessage));
    }
  }, [historyQuery.data]);

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

  const sendMut = useSendChatMessage({
    onSuccess: (data) => {
      if (!sessionId) setSessionId(data.session_id);
      const assistantId = nextLocalId();
      const created = new Date().toISOString();
      const assistantMsg: UIChatMessage = {
        id: assistantId,
        session_id: data.session_id,
        role: 'assistant',
        content: data.response,
        created_at: created,
        isStreaming: true,
        streamedText: '',
      };
      setMessages((prev) => [...prev, assistantMsg]);
      stream.start(assistantId, data.response);
      sessionsQuery.refetch();
    },
  });

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

  // Light-weight tick-driven scroll while the typewriter is active. We
  // only fire while `stream.isActive` is true so it costs nothing the
  // rest of the time. `behavior: 'auto'` keeps it cheap (no smooth
  // animation queue) — the visual effect is "the text grows downward
  // and the viewport tracks it".
  useEffect(() => {
    if (!stream.isActive) return;
    const id = window.setInterval(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }, 200);
    return () => window.clearInterval(id);
  }, [stream.isActive]);

  /* ─── handlers ─────────────────────────────────────────────────────── */

  const submitMessage = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg || sendMut.isPending) return;
      const userId = nextLocalId();
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          session_id: sessionId || 'pending',
          role: 'user',
          content: msg,
          created_at: new Date().toISOString(),
        },
      ]);
      sendMut.mutate({ message: msg, sessionId: sessionId || undefined });
    },
    [sendMut, sessionId],
  );

  const handleSend = useCallback(() => {
    submitMessage(input);
    setInput('');
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

  // Esc cancels the streaming reveal — listen on the window so it works
  // regardless of focus position.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && stream.isActive) {
        stream.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stream]);

  const startNewSession = useCallback(() => {
    stream.stop();
    setSessionId('');
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }, [stream]);

  const loadSession = useCallback(
    (sid: string) => {
      stream.stop();
      setSessionId(sid);
    },
    [stream],
  );

  const handleRegenerate = useCallback(
    (assistantMsg: UIChatMessage) => {
      // Find the user message immediately preceding this assistant one;
      // resubmit it so the backend produces a fresh reply, and drop the
      // old assistant message so the typewriter can re-render cleanly.
      const idx = messages.findIndex((m) => m.id === assistantMsg.id);
      if (idx <= 0) return;
      const userMsg = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
      if (!userMsg) return;
      stream.stop();
      setMessages((prev) => prev.slice(0, idx));
      sendMut.mutate({ message: userMsg.content, sessionId: sessionId || undefined });
    },
    [messages, sendMut, sessionId, stream],
  );

  const handleEditAndResend = useCallback(
    (userMsg: UIChatMessage, newText: string) => {
      // Truncate history at this user message and resubmit with the new
      // text — same model as ChatGPT-style "edit and regenerate".
      const idx = messages.findIndex((m) => m.id === userMsg.id);
      if (idx < 0) return;
      stream.stop();
      const truncated = messages.slice(0, idx);
      const editedId = nextLocalId();
      setMessages([
        ...truncated,
        {
          ...userMsg,
          id: editedId,
          content: newText,
          created_at: new Date().toISOString(),
        },
      ]);
      sendMut.mutate({ message: newText, sessionId: sessionId || undefined });
    },
    [messages, sendMut, sessionId, stream],
  );

  const handleRename = useCallback(
    (sid: string, title: string) => {
      renameMut.mutate({ sessionId: sid, title });
    },
    [renameMut],
  );

  const handleDelete = useCallback(
    (sid: string) => {
      deleteMut.mutate({ sessionId: sid });
      if (sid === sessionId) {
        startNewSession();
      }
    },
    [deleteMut, sessionId, startNewSession],
  );

  /* ─── derived ─────────────────────────────────────────────────────── */

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant')?.id,
    [messages],
  );
  const lastUserId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user')?.id,
    [messages],
  );

  const isStreaming = stream.isActive;
  const isWaiting = sendMut.isPending && !isStreaming;

  /* ─── render ──────────────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('chatbot.title', 'AI Assistant')}
      subtitle={t('chatbot.subtitle', 'Ask anything about your Tesla fleet')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AIChatbotIndicator />
          <Button
            onClick={() => setShowSessions((s) => !s)}
            variant="ghost"
            size="sm"
            icon={<HistoryIcon className="h-4 w-4" />}
            aria-pressed={showSessions}
          >
            {t('chatbot.history', 'History')}
          </Button>
        </div>
      }
    >
      <div
        className="flex flex-1 gap-4 min-h-0 relative"
        style={{ height: 'calc(100dvh - 12rem)' }}
      >
        {showSessions && (
          isMobile ? (
            <div
              className="fixed inset-0 z-40 flex"
              role="dialog"
              aria-modal="true"
              aria-label={t('chatbot.history', 'History')}
            >
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowSessions(false)}
                aria-hidden="true"
              />
              <div className="relative h-full w-[85vw] max-w-sm">
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
              </div>
            </div>
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
          )
        )}

        <GlassPanel className="flex flex-col flex-1 min-w-0 !p-0 overflow-hidden">
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={t('chatbot.aria.conversation', 'Conversation')}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full space-y-6 py-12">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-purple-500/10 blur-xl scale-150" />
                  <div className="relative rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-6 border border-[var(--border-subtle)]">
                    <Bot className="h-12 w-12 text-purple-300" aria-hidden="true" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-lg font-semibold text-[var(--text-primary)]">
                    {t('chatbot.howCanIHelp', 'How can I help you?')}
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t(
                      'chatbot.askAbout',
                      'Ask about your vehicles, drives, charging, and more',
                    )}
                  </p>
                </div>
                <SuggestedPrompts
                  onPick={(text) => {
                    setInput(text);
                    inputRef.current?.focus();
                  }}
                />
              </div>
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
                    actionsDisabled={isStreaming || sendMut.isPending}
                    onRegenerate={handleRegenerate}
                    onEditAndResend={handleEditAndResend}
                  />
                );
              })
            )}

            {isWaiting && (
              <FadeIn>
                <div className="flex gap-3 items-start">
                  <div className="rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-1.5 border border-purple-500/20">
                    <Bot className="h-4 w-4 text-purple-300" aria-hidden="true" />
                  </div>
                  <GlassPanel className="!p-3 flex items-center gap-2">
                    <TypingDots reduceMotion={motion.reduce} />
                    <span className="text-sm text-[var(--text-secondary)]">
                      {t('chatbot.thinking', 'Thinking…')}
                    </span>
                  </GlassPanel>
                </div>
              </FadeIn>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 sm:p-4 border-t border-[var(--glass-border)]">
            <VisuallyHidden as="label" htmlFor="chatbot-input">
              {t('chatbot.inputLabel', 'Message')}
            </VisuallyHidden>
            <div className="flex items-end gap-2 sm:gap-3">
              <Textarea
                ref={inputRef}
                id="chatbot-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t(
                  'chatbot.placeholder',
                  'Ask about your fleet…',
                )}
                rows={1}
                className="flex-1 min-w-0 resize-none min-h-[40px] max-h-40"
                aria-label={t('chatbot.inputLabel', 'Message')}
              />
              {isStreaming ? (
                <Button
                  onClick={() => stream.stop()}
                  variant="secondary"
                  icon={<Square className="h-4 w-4" />}
                  aria-label={t('chatbot.actions.stopStreaming', 'Stop streaming')}
                  title={t('chatbot.actions.stopHint', 'Stop reveal (Esc)')}
                  className="shrink-0"
                >
                  <span className="hidden sm:inline">{t('chatbot.actions.stop', 'Stop')}</span>
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || sendMut.isPending}
                  variant="primary"
                  icon={<Send className="h-4 w-4" />}
                  aria-label={t('chatbot.actions.send', 'Send message')}
                  className="shrink-0"
                />
              )}
            </div>
          </div>
        </GlassPanel>
      </div>
    </PageContainer>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────── */

function toUIMessage(m: ChatMessage): UIChatMessage {
  return { ...m };
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
 *
 * When `prefers-reduced-motion: reduce` is set, the reveal is skipped
 * entirely and the full text appears immediately — both `onTick` and
 * `onComplete` still fire so consumers don't have to special-case the
 * reduced-motion path.
 *
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

/**
 * Three-dot "thinking" indicator. Honors prefers-reduced-motion by
 * collapsing to a static dot trio when motion is suppressed.
 */
function TypingDots({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-hidden="true"
      role="presentation"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-purple-300',
            !reduceMotion && 'motion-safe:animate-bounce',
          )}
          style={
            !reduceMotion
              ? { animationDelay: `${i * 120}ms`, animationDuration: '900ms' }
              : undefined
          }
        />
      ))}
    </span>
  );
}
