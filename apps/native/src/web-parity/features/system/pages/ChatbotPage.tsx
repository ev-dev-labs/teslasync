// Native parity port of web/src/features/system/pages/ChatbotPage.tsx.
//
// The web source is the "Helix" chatbot page. It drives two code paths off
// `useAiEnabled('chatbot-llm')`:
//   • AI off (baseline) — `useSendChatMessage` POSTs the heuristic `/chatbot`
//     route and runs a client-side typewriter reveal on the full reply.
//   • AI on — `useAiStream` opens an SSE stream against `POST /api/v1/ai/chatbot`
//     and accumulates `delta` events directly into the streaming assistant row;
//     the typewriter is skipped.
// Both hooks are called unconditionally (React Hooks rule); the branch lives in
// the submit handlers. It also renders a History sidebar (`SessionList`), an
// empty-state prompt strip (`SuggestedPrompts`), per-message rows
// (`ChatMessageItem` with copy / regenerate / edit-and-resend), an AI-mode
// indicator (`AIChatbotIndicator`) and a voice panel (`AIVoiceMode`).
//
// This is a SELF-CONTAINED port: the sibling `ChatMessageItem`, `SessionList`
// and `SuggestedPrompts` web components have no native ports yet, so — mirroring
// the sibling page ports (ApiLogsPage inlines its StatCard/Badge/Select; the
// admin StatusHeader inlines its Grid) — each is rebuilt here with React Native
// primitives + the existing native tokens/components. Already-ported native
// pieces ARE reused: `AIChatbotIndicator`, `AIVoiceMode`, `HelixMark`, `Avatar`,
// `MarkdownRenderer`, the `useChat` TanStack hooks, the `devtools` chat types,
// the AI feature registry, `apiUrl`, and `useSettings`.
//
// Native-safe adaptations (each documented in the parity sidecar):
//   * `<PageContainer title subtitle actions>` -> an inline header (title +
//     subtitle + actions slot) above a flex body. The conversation area is a
//     `ScrollView` (not the page) so the input bar stays pinned, matching the
//     web `calc(100dvh - 12rem)` fixed-height chat column.
//   * `useAiStream` (fetch + ReadableStream SSE) -> an inlined native-safe SSE
//     reader identical to the sibling AI component ports (AINLSearch): it POSTs
//     to `apiUrl('/ai/chatbot')`, parses `event:`/`data:` frames, exposes the
//     same `{ start, cancel, state, text, error, limit }` surface and the same
//     `AiStreamEvent` union, and finalizes to `done` when the body drains. If RN
//     fetch exposes no readable body it finalizes with an explicit unavailable
//     reason (never a silent success).
//   * `useTypewriterStream` ported verbatim (40 chars / 16ms reveal, reduce-motion
//     fast path, cancellable `stop()`), using the RN-global `requestAnimationFrame`
//     / `setTimeout` (no `window.` prefix).
//   * `useMotionPreference` -> `useNativeMotionPreference` backed by
//     `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged`
//     listener.
//   * `useIsMobile` (matchMedia) -> `useNativeIsMobile` (`useWindowDimensions`,
//     <=640 breakpoint); the initial History-visibility read uses
//     `Dimensions.get('window')` exactly like the web `matchMedia` initializer.
//   * History-visibility `localStorage` persistence -> a module-level in-memory
//     value (`readStoredHistoryVisible`/`persistHistoryVisible`). The state names
//     (`showSessions`/`setShowSessions`) and the mobile-force-close / desktop-
//     restore behaviour are preserved; the cross-reload persistence has no native
//     equivalent and is documented.
//   * `usePageTitle` -> a no-op `useNativePageTitle` (no `document.title`); the
//     title still renders in the header.
//   * The textarea keyboard contract (Enter submit / Shift+Enter newline / ↑
//     recall last user message) is preserved via `onKeyPress` reading
//     `nativeEvent.key` (functional on react-native-web; harmless on native) plus
//     `onSubmitEditing` and the canonical Send button. The global `window`
//     keydown Escape-to-stop listener is DOM-only and dropped; the on-screen Stop
//     button preserves the stop/cancel behaviour.
//   * The History sidebar renders inline beside the chat on wide layouts and as a
//     RN `Modal` overlay on mobile (the web fixed-overlay path). The delete
//     `ConfirmDialog` is an inline `Modal`; the rename "double-click" affordance
//     maps to `onLongPress` (the native analogue).
//   * `CopyButton` -> a copy Pressable whose handler is best-effort
//     (`navigator.clipboard.writeText` when present — i.e. react-native-web — else
//     a no-op); it never claims success without a real write.
//   * The lucide-react glyphs (Send, Square, History, RotateCw, Pencil, Check, X,
//     MessageSquare, Plus, Trash2, Sparkles) map to the nearest repo
//     `SemanticIcon` names. `<FadeIn>` (framer-motion) -> a passthrough wrapper
//     (no behavioural contract). `cn` (clsx) -> StyleSheet arrays.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-i18next, no
// framer-motion, and no web UI components are imported. Every state name, API
// path (`/chatbot`, `/chatbot/history`, `/chatbot/sessions`, `/ai/chatbot`),
// snake_case field (session_id / created_at / message_count / last_message_at),
// and AI/legacy branch is preserved.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSubmitEditingEventData,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { colors, spacing, typography } from '../../../../theme/tokens';
import { Avatar } from '../../../components/data-display/Avatar';
import { HelixMark } from '../../../components/branding/HelixMark';
import { AIChatbotIndicator } from '../../../components/ai/AIChatbotIndicator';
import { AIVoiceMode } from '../../../components/ai/AIVoiceMode';
import { MarkdownRenderer } from '../components/chatbot/MarkdownRenderer';
import {
  useChatSessions,
  useChatHistory,
  useSendChatMessage,
  useRenameChatSession,
  useDeleteChatSession,
} from '../../../api/hooks/useChat';
import type { ChatMessage, ChatSessionInfo } from '../../../api/devtools';
import { AI_FEATURES, type AiFeatureId } from '../../../ai/features';
import { apiUrl } from '../../../api/client';
import { useSettings } from '../../../api/hooks/useSettings';

/* ─── i18n / page-title / motion / breakpoint shims ─────────────────────── */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// Native parity ships no i18n runtime: return the English fallback and reproduce
// i18next `{{var}}` interpolation (the only interpolation the source uses is
// `{{count}}` in the session message-count line).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars): string => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : `{{${name}}}`,
    );
  }, []);
}

// No `document.title` on native; the title is still rendered in the header.
function useNativePageTitle(_title: string): void {
  // intentionally empty
}

interface MotionPreference {
  reduce: boolean;
}

function useNativeMotionPreference(): MotionPreference {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) {
        setReduce(value);
      }
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => setReduce(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return { reduce };
}

const MOBILE_BREAKPOINT = 640;

function useNativeIsMobile(): boolean {
  const { width } = useWindowDimensions();
  return width <= MOBILE_BREAKPOINT;
}

// AI gate, inlined exactly like the sibling native AI component ports.
function useAiEnabled(feature: AiFeatureId): boolean {
  const { data: settings } = useSettings();
  if (!AI_FEATURES[feature]) {
    return false;
  }
  if (!settings) {
    return false;
  }
  if (settings.ai_mode === undefined || settings.ai_mode === 'off') {
    return false;
  }
  const flags = settings.ai_features;
  if (!flags) {
    return false;
  }
  return flags[feature] === true;
}

/* ─── History-visibility persistence (native-safe, in-memory) ───────────── */

// The web persists the History panel's open/closed state across reloads via
// localStorage. Native has no localStorage; this in-memory value keeps the
// toggle working for the running app (the cross-reload memory is dropped).
let historyVisibleMemory = false;

function readStoredHistoryVisible(): boolean {
  return historyVisibleMemory;
}

function persistHistoryVisible(value: boolean): void {
  historyVisibleMemory = value;
}

/* ─── chat message / suggestion types ───────────────────────────────────── */

export interface UIChatMessage extends ChatMessage {
  isStreaming?: boolean;
  /** Partial reveal during the typewriter animation. Falls back to content. */
  streamedText?: string;
}

interface ChatSuggestion {
  i18nKey: string;
  defaultValue: string;
}

function getChatSuggestions(): ChatSuggestion[] {
  return [
    {
      i18nKey: 'chatbot.suggestion.fleetYesterday',
      defaultValue: 'What did my fleet do yesterday?',
    },
    {
      i18nKey: 'chatbot.suggestion.chargingCost30d',
      defaultValue: 'Charging cost last 30 days',
    },
    {
      i18nKey: 'chatbot.suggestion.socDropping',
      defaultValue: 'Why is my SoC dropping faster this week?',
    },
    {
      i18nKey: 'chatbot.suggestion.efficientDrive',
      defaultValue: 'Show me the most efficient drive this month',
    },
  ];
}

/* ─── small helpers ─────────────────────────────────────────────────────── */

function toUIMessage(m: ChatMessage): UIChatMessage {
  return { ...m };
}

let localIdSeq = 0;
function nextLocalId(): number {
  // Negative ids never collide with backend-issued (positive) ids.
  localIdSeq -= 1;
  return -Date.now() + localIdSeq;
}

// newAiSessionId mints a client-side session id when none exists, following the
// server's `s_<unix-ns>` style closely enough that logs/joins stay readable.
function newAiSessionId(): string {
  return `s_${Date.now()}${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`;
}

// Native-safe ports of @/lib/dateFormat formatTime / formatRelative.
function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

// Best-effort copy: works on react-native-web via navigator.clipboard; no-op on
// native (never claims success without a real write).
function copyToClipboard(text: string): void {
  const nav = (
    globalThis as {
      navigator?: { clipboard?: { writeText?: (value: string) => unknown } };
    }
  ).navigator;
  try {
    nav?.clipboard?.writeText?.(text);
  } catch {
    // clipboard unavailable — silently ignore, like the web CopyButton's catch.
  }
}

/* ─── native-safe SSE stream (mirrors the sibling AI component ports) ────── */

type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      data?: unknown;
      error?: string;
    }
  | {
      type: 'confirm_request';
      continuation_id: string;
      tool: string;
      args: unknown;
      summary: string;
    }
  | { type: 'done'; finish_reason: string; usage: { in: number; out: number } }
  | {
      type: 'error';
      message: string;
      reason?: string;
      retry_after_s?: number;
      banner_level?: 'warn' | 'critical' | '';
      baseline_available?: boolean;
    };

type AiStreamState = 'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error';

interface AiLimitInfo {
  reason: string;
  retryAfterS: number;
  bannerLevel: 'warn' | 'critical' | '';
  baselineAvailable: boolean;
  message: string;
}

interface UseAiStreamArgs {
  url: string;
  body?: unknown;
  onEvent: (ev: AiStreamEvent) => void;
}

interface UseAiStreamResult {
  start: () => void;
  cancel: () => void;
  state: AiStreamState;
  text: string;
  error: string | null;
  limit: AiLimitInfo | null;
}

interface NativeReadableStreamReader {
  read(): Promise<{
    value?: ArrayBuffer | ArrayBufferView | number[] | string;
    done?: boolean;
  }>;
  releaseLock?: () => void;
}

interface NativeReadableStreamBody {
  getReader(): NativeReadableStreamReader;
}

interface ResponseWithNativeStream extends Response {
  body?: NativeReadableStreamBody | null;
}

interface TextDecoderLike {
  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: { stream?: boolean },
  ): string;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;

const AI_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for AI SSE streaming.';
const SSE_DELIM_RE = /\r?\n\r?\n/;
const LINE_DELIM_RE = /\r?\n/;

function getFetch(): typeof fetch | null {
  const candidate = (globalThis as typeof globalThis & { fetch?: unknown }).fetch;
  return typeof candidate === 'function' ? (candidate as typeof fetch) : null;
}

function getReadableStreamBody(res: Response): NativeReadableStreamBody | null {
  const body = (res as ResponseWithNativeStream).body;
  if (body && typeof body.getReader === 'function') {
    return body;
  }
  return null;
}

function getTextDecoder(): TextDecoderLike | null {
  const candidate = (globalThis as typeof globalThis & { TextDecoder?: unknown })
    .TextDecoder;
  return typeof candidate === 'function'
    ? new (candidate as TextDecoderConstructorLike)('utf-8')
    : null;
}

function toUint8Array(
  value: ArrayBuffer | ArrayBufferView | number[],
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function decodeAscii(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return result;
}

function decodeStreamChunk(
  value: ArrayBuffer | ArrayBufferView | number[] | string | undefined,
  decoder: TextDecoderLike | null,
  stream: boolean,
): string {
  if (value == null) {
    return decoder ? decoder.decode(undefined, { stream }) : '';
  }
  if (typeof value === 'string') {
    return value;
  }
  const bytes = toUint8Array(value);
  if (decoder) {
    return decoder.decode(bytes, { stream });
  }
  if (bytes.every((byte) => byte < 0x80)) {
    return decodeAscii(bytes);
  }
  throw new Error(
    `${AI_STREAM_UNAVAILABLE_REASON} UTF-8 TextDecoder is unavailable.`,
  );
}

function parseSSEFrame(raw: string): AiStreamEvent | null {
  let event = '';
  const dataParts: string[] = [];
  for (const line of raw.split(LINE_DELIM_RE)) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event: ')) {
      event = line.slice('event: '.length);
    } else if (line.startsWith('data: ')) {
      dataParts.push(line.slice('data: '.length));
    } else if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trimStart();
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice('data:'.length).trimStart());
    }
  }
  if (!event) {
    return null;
  }
  const dataStr = dataParts.join('\n');
  let data: unknown = null;
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      return null;
    }
  }
  return toTypedEvent(event, data);
}

function toTypedEvent(event: string, data: unknown): AiStreamEvent | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const d = data as Record<string, unknown>;
  switch (event) {
    case 'delta':
      return typeof d.text === 'string' ? { type: 'delta', text: d.text } : null;
    case 'tool_call':
      if (typeof d.id !== 'string' || typeof d.name !== 'string') {
        return null;
      }
      return {
        type: 'tool_call',
        id: d.id,
        name: d.name,
        arguments: d.arguments,
      };
    case 'tool_result':
      if (
        typeof d.id !== 'string' ||
        typeof d.name !== 'string' ||
        typeof d.ok !== 'boolean'
      ) {
        return null;
      }
      return {
        type: 'tool_result',
        id: d.id,
        name: d.name,
        ok: d.ok,
        data: d.data,
        error: typeof d.error === 'string' ? d.error : undefined,
      };
    case 'confirm_request':
      if (
        typeof d.continuation_id !== 'string' ||
        typeof d.tool !== 'string' ||
        typeof d.summary !== 'string'
      ) {
        return null;
      }
      return {
        type: 'confirm_request',
        continuation_id: d.continuation_id,
        tool: d.tool,
        args: d.args,
        summary: d.summary,
      };
    case 'done': {
      const usage = d.usage as { in?: number; out?: number } | undefined;
      return {
        type: 'done',
        finish_reason:
          typeof d.finish_reason === 'string' ? d.finish_reason : 'stop',
        usage: {
          in: typeof usage?.in === 'number' ? usage.in : 0,
          out: typeof usage?.out === 'number' ? usage.out : 0,
        },
      };
    }
    case 'error': {
      const bannerLevelRaw =
        typeof d.banner_level === 'string' ? d.banner_level : undefined;
      const bannerLevel =
        bannerLevelRaw === 'warn' ||
        bannerLevelRaw === 'critical' ||
        bannerLevelRaw === ''
          ? bannerLevelRaw
          : undefined;
      return {
        type: 'error',
        message: typeof d.message === 'string' ? d.message : 'unknown',
        reason: typeof d.reason === 'string' ? d.reason : undefined,
        retry_after_s:
          typeof d.retry_after_s === 'number' ? d.retry_after_s : undefined,
        banner_level: bannerLevel,
        baseline_available:
          typeof d.baseline_available === 'boolean'
            ? d.baseline_available
            : undefined,
      };
    }
    default:
      return null;
  }
}

function useAiStream({ url, body, onEvent }: UseAiStreamArgs): UseAiStreamResult {
  const [state, setState] = useState<AiStreamState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<AiLimitInfo | null>(null);
  const onEventRef = useRef(onEvent);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    runningRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setState('streaming');
    setText('');
    setError(null);
    setLimit(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const requestBody = body !== undefined ? JSON.stringify(body) : undefined;

    const finalizeError = (message: string) => {
      setError(message);
      setState('error');
    };

    const handleEvent = (ev: AiStreamEvent) => {
      onEventRef.current(ev);
      switch (ev.type) {
        case 'delta':
          setText((prev) => prev + ev.text);
          break;
        case 'confirm_request':
          setState('paused-confirm');
          break;
        case 'done':
          setState('done');
          break;
        case 'error':
          if (ev.reason) {
            setLimit({
              reason: ev.reason,
              retryAfterS: ev.retry_after_s ?? 0,
              bannerLevel: ev.banner_level ?? '',
              baselineAvailable: ev.baseline_available ?? true,
              message: ev.message,
            });
          }
          finalizeError(ev.message);
          break;
        default:
          break;
      }
    };

    void (async () => {
      let reader: NativeReadableStreamReader | null = null;
      try {
        const fetcher = getFetch();
        if (fetcher == null) {
          finalizeError('React Native fetch is unavailable.');
          return;
        }

        const res = await fetcher(apiUrl(url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: requestBody,
          signal: controller.signal,
          credentials: 'include',
        });

        if (!res.ok) {
          finalizeError(`stream_http_${res.status}`);
          return;
        }

        const streamBody = getReadableStreamBody(res);
        if (streamBody == null) {
          finalizeError(AI_STREAM_UNAVAILABLE_REASON);
          return;
        }

        reader = streamBody.getReader();
        const decoder = getTextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decodeStreamChunk(value, decoder, true);
          const parts = buffer.split(SSE_DELIM_RE);
          buffer = parts.pop() ?? '';
          for (const raw of parts) {
            if (!raw.trim()) {
              continue;
            }
            const ev = parseSSEFrame(raw);
            if (ev) {
              handleEvent(ev);
            }
          }
        }

        buffer += decodeStreamChunk(undefined, decoder, false);
        if (buffer.trim()) {
          const ev = parseSSEFrame(buffer);
          if (ev) {
            handleEvent(ev);
          }
        }
        setState((cur) => (cur === 'streaming' ? 'done' : cur));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setState((cur) => (cur === 'streaming' ? 'idle' : cur));
          return;
        }
        finalizeError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reader?.releaseLock) {
          reader.releaseLock();
        }
        runningRef.current = false;
        abortRef.current = null;
      }
    })();
  }, [body, url]);

  return { start, cancel, state, text, error, limit };
}

/* ─── typewriter reveal (ported verbatim) ───────────────────────────────── */

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

function useTypewriterStream(opts: TypewriterOptions): TypewriterStream {
  const { reduceMotion, onTick, onComplete } = opts;
  const stateRef = useRef<{
    id: number | null;
    full: string;
    pos: number;
    raf: number | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ id: null, full: '', pos: 0, raf: null, timer: null });
  const [active, setActive] = useState(false);

  const cleanup = useCallback(() => {
    const s = stateRef.current;
    if (s.raf != null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
    if (s.timer != null) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  }, []);

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s.id == null) {
      return;
    }
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
        if (cur.id == null) {
          return;
        }
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
        cur.timer = setTimeout(() => {
          cur.raf = requestAnimationFrame(tick);
        }, 16);
      };
      tick();
    },
    [cleanup, onTick, onComplete, reduceMotion],
  );

  useEffect(() => () => cleanup(), [cleanup]);

  return { start, stop, isActive: active };
}

/* ─── thinking dots ─────────────────────────────────────────────────────── */

function TypingDots() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.typingDots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.typingDot} />
      ))}
    </View>
  );
}

/* ─── suggested prompts (inlined SuggestedPrompts) ──────────────────────── */

function SuggestedPromptsView({ onPick }: { onPick: (text: string) => void }) {
  const t = useNativeTranslationFallback();
  const suggestions = getChatSuggestions();
  return (
    <View
      accessibilityLabel={t('chatbot.aria.suggestions', 'Suggested prompts')}
      style={styles.suggestions}>
      {suggestions.map((s) => {
        const text = t(s.i18nKey, s.defaultValue);
        return (
          <Pressable
            key={s.i18nKey}
            accessibilityRole="button"
            onPress={() => onPick(text)}
            style={({ pressed }) => [
              styles.suggestionChip,
              pressed && styles.pressedDim,
            ]}>
            <SemanticIcon decorative name="sparkles" size="sm" />
            <AppText style={styles.suggestionText} variant="caption">
              {text}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── confirm dialog (inlined ConfirmDialog) ────────────────────────────── */

function ConfirmDialogView({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <Pressable
        accessibilityLabel={title}
        onPress={onCancel}
        style={styles.modalBackdrop}>
        <Pressable onPress={() => undefined} style={styles.confirmCard}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.confirmMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.ghostButton,
                pressed && styles.pressedDim,
              ]}>
              <AppText weight="semibold">{cancelLabel}</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && styles.pressedDim,
              ]}>
              <AppText style={styles.dangerButtonText} weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─── session list (inlined SessionList) ────────────────────────────────── */

function sessionDisplayTitle(
  session: ChatSessionInfo,
  t: NativeTFunction,
): string {
  if (session.title && session.title.trim()) {
    return session.title.trim();
  }
  if (session.first_message && session.first_message.trim()) {
    const first = session.first_message.trim();
    return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  }
  return t('chatbot.session.untitled', 'Untitled conversation');
}

interface SessionListViewProps {
  sessions: ChatSessionInfo[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  isLoading?: boolean;
  style?: object;
}

function SessionListView({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  isLoading,
  style,
}: SessionListViewProps) {
  const t = useNativeTranslationFallback();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSessionInfo | null>(
    null,
  );
  const renameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingId]);

  const startRename = (session: ChatSessionInfo) => {
    setRenamingId(session.id);
    setRenameDraft(sessionDisplayTitle(session, t));
  };

  const commitRename = () => {
    if (!renamingId) {
      return;
    }
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRename(renamingId, trimmed);
    }
    setRenamingId(null);
  };

  return (
    <>
      <GlassPanel style={[styles.sessionPanel, style]}>
        <View style={styles.sessionHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={onNewChat}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.sessionNewChat,
              pressed && styles.pressedDim,
            ]}>
            <SemanticIcon decorative name="add" size="sm" />
            <AppText style={styles.primaryButtonText} weight="semibold">
              {t('chatbot.newChat', 'New Chat')}
            </AppText>
          </Pressable>
        </View>

        <AppText style={styles.sessionSectionLabel} tone="secondary">
          {t('chatbot.sessions', 'Sessions')}
        </AppText>

        <ScrollView style={styles.sessionScroll}>
          {isLoading && sessions.length === 0 ? (
            <AppText style={styles.sessionLoading} tone="muted" variant="caption">
              {t('common.loading', 'Loading…')}
            </AppText>
          ) : sessions.length === 0 ? (
            <View style={styles.sessionEmpty}>
              <SemanticIcon decorative name="bot" size="lg" />
              <AppText style={styles.sessionEmptyText} tone="muted">
                {t('chatbot.noSessions', 'No conversations yet')}
              </AppText>
            </View>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRenaming = session.id === renamingId;
              return (
                <View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    isActive && styles.sessionRowActive,
                  ]}>
                  {isRenaming ? (
                    <TextInput
                      ref={renameInputRef}
                      accessibilityLabel={t(
                        'chatbot.aria.renameSession',
                        'Rename conversation',
                      )}
                      onBlur={commitRename}
                      onChangeText={setRenameDraft}
                      onSubmitEditing={commitRename}
                      placeholder={t('chatbot.newChat', 'New Chat')}
                      placeholderTextColor={colors.textMuted}
                      style={styles.sessionRenameInput}
                      value={renameDraft}
                    />
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onLongPress={() => startRename(session)}
                      onPress={() => onSelect(session.id)}
                      style={styles.sessionButton}>
                      <AppText
                        numberOfLines={1}
                        style={[
                          styles.sessionTitle,
                          isActive && styles.sessionTitleActive,
                        ]}
                        weight="semibold">
                        {sessionDisplayTitle(session, t)}
                      </AppText>
                      <AppText
                        numberOfLines={1}
                        style={styles.sessionMeta}
                        tone="muted"
                        variant="caption">
                        {session.last_message_at
                          ? formatRelative(session.last_message_at)
                          : t('chatbot.session.empty', 'Empty')}
                        {' · '}
                        {t('chatbot.session.messageCount', '{{count}} msgs', {
                          count: session.message_count,
                        })}
                      </AppText>
                    </Pressable>
                  )}

                  {!isRenaming && (
                    <Pressable
                      accessibilityLabel={t(
                        'chatbot.aria.deleteSession',
                        'Delete conversation',
                      )}
                      accessibilityRole="button"
                      onPress={() => setPendingDelete(session)}
                      style={({ pressed }) => [
                        styles.sessionDelete,
                        pressed && styles.pressedDim,
                      ]}>
                      <SemanticIcon decorative name="delete" size="sm" />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </GlassPanel>

      <ConfirmDialogView
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmLabel={t('chatbot.delete.confirm', 'Delete')}
        message={t(
          'chatbot.delete.message',
          'This will permanently remove this conversation and all its messages.',
        )}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
        open={!!pendingDelete}
        title={t('chatbot.delete.title', 'Delete conversation?')}
      />
    </>
  );
}

/* ─── chat message row (inlined ChatMessageItem) ────────────────────────── */

interface ChatMessageItemViewProps {
  message: UIChatMessage;
  isLastAssistant: boolean;
  isLastUser: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  actionsDisabled?: boolean;
  onRegenerate?: (message: UIChatMessage) => void;
  onEditAndResend?: (message: UIChatMessage, newText: string) => void;
}

function ChatMessageItemView({
  message,
  isLastAssistant,
  isLastUser,
  isFirstInGroup,
  isLastInGroup,
  actionsDisabled,
  onRegenerate,
  onEditAndResend,
}: ChatMessageItemViewProps) {
  const t = useNativeTranslationFallback();
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(message.content);
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content.trim()) {
      cancelEdit();
      return;
    }
    onEditAndResend?.(message, trimmed);
    setEditing(false);
  };

  const visibleText = message.streamedText ?? message.content;
  const showAvatar = isFirstInGroup;
  const showTimestamp = isLastInGroup && !message.isStreaming;
  const showActions = !message.isStreaming && !actionsDisabled && !editing;
  const editUnchanged = !draft.trim() || draft.trim() === message.content.trim();

  return (
    <View
      style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowBot]}>
      {!isUser && (
        <View style={[styles.avatarSlot, !showAvatar && styles.invisible]}>
          <Avatar kind="bot" shape="rounded" size="md" />
        </View>
      )}

      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleBot,
        ]}>
        {editing ? (
          <View style={styles.editArea}>
            <TextInput
              ref={editRef}
              accessibilityLabel={t('chatbot.aria.editMessage', 'Edit message')}
              multiline
              onChangeText={setDraft}
              style={styles.editInput}
              value={draft}
            />
            <View style={styles.editActions}>
              <Pressable
                accessibilityRole="button"
                onPress={cancelEdit}
                style={({ pressed }) => [
                  styles.ghostButtonSm,
                  pressed && styles.pressedDim,
                ]}>
                <SemanticIcon decorative name="close" size="sm" />
                <AppText variant="caption" weight="semibold">
                  {t('chatbot.actions.cancel', 'Cancel')}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={editUnchanged}
                onPress={submitEdit}
                style={({ pressed }) => [
                  styles.primaryButtonSm,
                  editUnchanged && styles.disabledButton,
                  pressed && !editUnchanged && styles.pressedDim,
                ]}>
                <SemanticIcon decorative name="confirm" size="sm" />
                <AppText
                  style={styles.primaryButtonText}
                  variant="caption"
                  weight="semibold">
                  {t('chatbot.actions.saveAndResend', 'Save & resend')}
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : isUser ? (
          <AppText style={styles.userText}>{visibleText}</AppText>
        ) : (
          <View style={styles.assistantText}>
            <MarkdownRenderer>{visibleText}</MarkdownRenderer>
            {message.isStreaming && <View style={styles.streamingCursor} />}
          </View>
        )}

        {showTimestamp && (
          <AppText style={styles.timestamp} tone="muted" variant="caption">
            {formatTime(message.created_at)}
          </AppText>
        )}

        {showActions && (
          <View style={styles.messageActions}>
            <Pressable
              accessibilityLabel={t('chatbot.aria.copyMessage', 'Copy message')}
              accessibilityRole="button"
              onPress={() => copyToClipboard(message.content)}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.pressedDim,
              ]}>
              <SemanticIcon decorative name="copy" size="sm" />
            </Pressable>
            {!isUser && isLastAssistant && onRegenerate && (
              <Pressable
                accessibilityLabel={t(
                  'chatbot.aria.regenerate',
                  'Regenerate response',
                )}
                accessibilityRole="button"
                onPress={() => onRegenerate(message)}
                style={({ pressed }) => [
                  styles.ghostButtonSm,
                  pressed && styles.pressedDim,
                ]}>
                <SemanticIcon decorative name="refresh" size="sm" />
                <AppText variant="caption" weight="semibold">
                  {t('chatbot.actions.regenerate', 'Regenerate')}
                </AppText>
              </Pressable>
            )}
            {isUser && isLastUser && onEditAndResend && (
              <Pressable
                accessibilityLabel={t('chatbot.aria.edit', 'Edit and resend')}
                accessibilityRole="button"
                onPress={startEdit}
                style={({ pressed }) => [
                  styles.ghostButtonSm,
                  pressed && styles.pressedDim,
                ]}>
                <SemanticIcon decorative name="pencil" size="sm" />
                <AppText variant="caption" weight="semibold">
                  {t('chatbot.actions.edit', 'Edit')}
                </AppText>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {isUser && (
        <View style={[styles.avatarSlot, !showAvatar && styles.invisible]}>
          <Avatar kind="user" shape="rounded" size="md" />
        </View>
      )}
    </View>
  );
}

/* ─── page ───────────────────────────────────────────────────────────────── */

export default function ChatbotPage() {
  const t = useNativeTranslationFallback();
  usePageTitleProxy(t);
  const motion = useNativeMotionPreference();

  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const isMobile = useNativeIsMobile();

  const [showSessions, setShowSessionsState] = useState<boolean>(() => {
    const isMobileView = Dimensions.get('window').width <= MOBILE_BREAKPOINT;
    if (isMobileView) {
      return false;
    }
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
  // Mobile force-close so the sidebar doesn't consume the screen; desktop
  // restores the stored choice.
  useEffect(() => {
    if (isMobile) {
      setShowSessionsState(false);
    } else {
      setShowSessionsState(readStoredHistoryVisible());
    }
  }, [isMobile]);

  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const sessionsQuery = useChatSessions();
  const sessions = sessionsQuery.data ?? [];

  const historyQuery = useChatHistory(sessionId);

  // Hydrate local messages when loaded history changes. Race guards: while the
  // SSE is in flight for the current session the local optimistic messages are
  // authoritative; an empty server read for the same session keeps local.
  useEffect(() => {
    if (!historyQuery.data) {
      return;
    }
    const data = historyQuery.data;
    setMessages((prev) => {
      const firstSessionId = prev[0]?.session_id;
      const optimisticForCurrent =
        typeof firstSessionId === 'string' &&
        firstSessionId === sessionIdRef.current;
      if (optimisticForCurrent && streamingMsgIdRef.current !== null) {
        return prev;
      }
      if (data.length === 0 && optimisticForCurrent) {
        return prev;
      }
      return data.map(toUIMessage);
    });
  }, [historyQuery.data]);

  const renameMut = useRenameChatSession();
  const deleteMut = useDeleteChatSession();

  // Typewriter state for the legacy (AI-off) reveal.
  const stream = useTypewriterStream({
    reduceMotion: motion.reduce,
    onTick: (id, partial) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, streamedText: partial } : m)),
      ),
    onComplete: (id) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, isStreaming: false, streamedText: undefined }
            : m,
        ),
      );
      inputRef.current?.focus();
    },
  });

  const sendMut = useSendChatMessage({
    onSuccess: (data) => {
      if (!sessionId) {
        setSessionId(data.session_id);
      }
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
      void sessionsQuery.refetch();
    },
  });

  /* ─── AI-on path ──────────────────────────────────────────────────────── */

  const aiEnabled = useAiEnabled('chatbot-llm');

  const [pendingAiRequest, setPendingAiRequest] = useState<{
    message: string;
    session_id: string;
  } | null>(null);

  const [streamingMsgId, setStreamingMsgId] = useState<number | null>(null);
  const streamingMsgIdRef = useRef<number | null>(null);
  useEffect(() => {
    streamingMsgIdRef.current = streamingMsgId;
  }, [streamingMsgId]);

  const sessionIdRef = useRef<string>(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const handleAiEvent = useCallback(
    (ev: AiStreamEvent) => {
      const id = streamingMsgIdRef.current;
      if (!id) {
        return;
      }
      if (ev.type === 'delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, streamedText: (m.streamedText ?? '') + ev.text }
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
                }
              : m,
          ),
        );
        setStreamingMsgId(null);
        setPendingAiRequest(null);
        void sessionsQuery.refetch();
      } else if (ev.type === 'error') {
        // Keep what was streamed and append a short failure marker; no silent
        // fall-back to the heuristic baseline (that would hide the AI failure).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  isStreaming: false,
                  content:
                    (m.streamedText && m.streamedText.length > 0
                      ? m.streamedText + '\n\n'
                      : '') + `(AI error: ${ev.message})`,
                  streamedText: undefined,
                }
              : m,
          ),
        );
        setStreamingMsgId(null);
        setPendingAiRequest(null);
      }
    },
    [sessionsQuery],
  );

  const aiStream = useAiStream({
    url: '/ai/chatbot',
    body: pendingAiRequest,
    onEvent: handleAiEvent,
  });

  // Trigger the stream whenever a fresh pendingAiRequest is set.
  useEffect(() => {
    if (pendingAiRequest) {
      aiStream.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiRequest]);

  // When the AI feature toggles off mid-stream, cancel the SSE and finalize.
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
              }
            : m,
        ),
      );
      setStreamingMsgId(null);
      setPendingAiRequest(null);
    }
  }, [aiEnabled, streamingMsgId, aiStream]);

  // Auto-scroll on new messages and during a reveal.
  const deferredCount = useDeferredValue(messages.length);
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: !motion.reduce });
  }, [deferredCount, motion.reduce]);

  // Tick-driven scroll while a stream is active (typewriter or SSE).
  useEffect(() => {
    if (!stream.isActive && aiStream.state !== 'streaming') {
      return;
    }
    const id = setInterval(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    }, 200);
    return () => clearInterval(id);
  }, [stream.isActive, aiStream.state]);

  /* ─── handlers ────────────────────────────────────────────────────────── */

  const submitMessage = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg) {
        return;
      }
      if (aiEnabled) {
        // AI-on path: SSE stream against /api/v1/ai/chatbot.
        if (aiStream.state === 'streaming' || pendingAiRequest) {
          return;
        }
        const sid = sessionId || newAiSessionId();
        if (!sessionId) {
          setSessionId(sid);
        }
        const userId = nextLocalId();
        const assistantId = nextLocalId();
        const created = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: userId,
            session_id: sid,
            role: 'user',
            content: msg,
            created_at: created,
          },
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
        setStreamingMsgId(assistantId);
        setPendingAiRequest({ message: msg, session_id: sid });
        return;
      }
      // AI-off path: legacy heuristic POST /chatbot.
      if (sendMut.isPending) {
        return;
      }
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
    [aiEnabled, aiStream.state, pendingAiRequest, sendMut, sessionId],
  );

  const handleSend = useCallback(() => {
    submitMessage(input);
    setInput('');
  }, [input, submitMessage]);

  // Preserve the textarea keyboard contract on platforms that report keys
  // (react-native-web): Enter submits, Shift+Enter newline, ↑ recalls last user
  // message when the input is empty. Harmless on native keyboards.
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const native = e.nativeEvent as TextInputKeyPressEventData & {
        shiftKey?: boolean;
      };
      const preventable = e as unknown as { preventDefault?: () => void };
      if (native.key === 'Enter' && !native.shiftKey) {
        preventable.preventDefault?.();
        handleSend();
        return;
      }
      if (native.key === 'ArrowUp' && input === '') {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          preventable.preventDefault?.();
          setInput(lastUser.content);
        }
      }
    },
    [handleSend, input, messages],
  );

  const handleSubmitEditing = useCallback(
    (_e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      handleSend();
    },
    [handleSend],
  );

  const startNewSession = useCallback(() => {
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
      stream.stop();
      aiStream.cancel();
      setStreamingMsgId(null);
      setPendingAiRequest(null);
      setSessionId(sid);
    },
    [stream, aiStream],
  );

  const handleRegenerate = useCallback(
    (assistantMsg: UIChatMessage) => {
      const idx = messages.findIndex((m) => m.id === assistantMsg.id);
      if (idx <= 0) {
        return;
      }
      const userMsg = [...messages.slice(0, idx)]
        .reverse()
        .find((m) => m.role === 'user');
      if (!userMsg) {
        return;
      }
      stream.stop();
      aiStream.cancel();
      const truncated = messages.slice(0, idx);
      if (aiEnabled) {
        if (aiStream.state === 'streaming' || pendingAiRequest) {
          return;
        }
        const sid = sessionId || newAiSessionId();
        if (!sessionId) {
          setSessionId(sid);
        }
        const assistantId = nextLocalId();
        setMessages([
          ...truncated,
          {
            id: assistantId,
            session_id: sid,
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
            isStreaming: true,
            streamedText: '',
          },
        ]);
        setStreamingMsgId(assistantId);
        setPendingAiRequest({ message: userMsg.content, session_id: sid });
        return;
      }
      setMessages(truncated);
      sendMut.mutate({
        message: userMsg.content,
        sessionId: sessionId || undefined,
      });
    },
    [aiEnabled, aiStream, messages, pendingAiRequest, sendMut, sessionId, stream],
  );

  const handleEditAndResend = useCallback(
    (userMsg: UIChatMessage, newText: string) => {
      const idx = messages.findIndex((m) => m.id === userMsg.id);
      if (idx < 0) {
        return;
      }
      stream.stop();
      aiStream.cancel();
      const truncated = messages.slice(0, idx);
      const editedId = nextLocalId();
      const editedMsg: UIChatMessage = {
        ...userMsg,
        id: editedId,
        content: newText,
        created_at: new Date().toISOString(),
      };
      if (aiEnabled) {
        if (aiStream.state === 'streaming' || pendingAiRequest) {
          return;
        }
        const sid = sessionId || newAiSessionId();
        if (!sessionId) {
          setSessionId(sid);
        }
        const assistantId = nextLocalId();
        setMessages([
          ...truncated,
          editedMsg,
          {
            id: assistantId,
            session_id: sid,
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
            isStreaming: true,
            streamedText: '',
          },
        ]);
        setStreamingMsgId(assistantId);
        setPendingAiRequest({ message: newText, session_id: sid });
        return;
      }
      setMessages([...truncated, editedMsg]);
      sendMut.mutate({ message: newText, sessionId: sessionId || undefined });
    },
    [aiEnabled, aiStream, messages, pendingAiRequest, sendMut, sessionId, stream],
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

  /* ─── derived ─────────────────────────────────────────────────────────── */

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant')?.id,
    [messages],
  );
  const lastUserId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user')?.id,
    [messages],
  );

  const isAiStreaming = aiStream.state === 'streaming';
  const isStreaming = stream.isActive || isAiStreaming;
  const isWaiting =
    (sendMut.isPending && !stream.isActive) ||
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
              }
            : m,
        ),
      );
      setStreamingMsgId(null);
      setPendingAiRequest(null);
    }
  }, [stream, aiStream]);

  const canSend = !!input.trim() && !sendMut.isPending && !isAiStreaming;

  /* ─── render ──────────────────────────────────────────────────────────── */

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="display" weight="bold">
            {t('chatbot.title', 'Helix')}
          </AppText>
          <AppText tone="muted" variant="caption">
            {t('chatbot.subtitle', 'Ask Helix anything about your Tesla fleet')}
          </AppText>
        </View>
        <View style={styles.headerActions}>
          <AIChatbotIndicator />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: showSessions }}
            onPress={() => setShowSessions((s) => !s)}
            style={({ pressed }) => [
              styles.ghostButton,
              showSessions && styles.ghostButtonActive,
              pressed && styles.pressedDim,
            ]}>
            <SemanticIcon decorative name="history" size="sm" />
            <AppText weight="semibold">{t('chatbot.history', 'History')}</AppText>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <AIVoiceMode />
        <View style={styles.conversationRow}>
          {showSessions && !isMobile && (
            <SessionListView
              activeSessionId={sessionId}
              isLoading={sessionsQuery.isLoading}
              onDelete={handleDelete}
              onNewChat={startNewSession}
              onRename={handleRename}
              onSelect={loadSession}
              sessions={sessions}
              style={styles.sessionPanelDesktop}
            />
          )}

          <GlassPanel style={styles.chatPanel}>
            <ScrollView
              accessibilityLabel={t('chatbot.aria.conversation', 'Conversation')}
              contentContainerStyle={styles.messagesContent}
              ref={scrollRef}
              style={styles.messagesScroll}>
              {messages.length === 0 ? (
                <View style={styles.emptyConversation}>
                  <View style={styles.emptyHaloOuter}>
                    <View style={styles.emptyHaloInner}>
                      <HelixMark color={colors.violet} size={48} />
                    </View>
                  </View>
                  <View style={styles.emptyCopy}>
                    <AppText style={styles.emptyTitle} variant="title" weight="semibold">
                      {t('chatbot.howCanIHelp', 'How can Helix help you?')}
                    </AppText>
                    <AppText style={styles.emptySubtitle} tone="secondary">
                      {t(
                        'chatbot.askAbout',
                        'Ask about your vehicles, drives, charging, and more',
                      )}
                    </AppText>
                  </View>
                  <SuggestedPromptsView
                    onPick={(text) => {
                      setInput(text);
                      inputRef.current?.focus();
                    }}
                  />
                </View>
              ) : (
                messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const next = messages[i + 1];
                  const isFirstInGroup = !prev || prev.role !== msg.role;
                  const isLastInGroup = !next || next.role !== msg.role;
                  return (
                    <ChatMessageItemView
                      actionsDisabled={isStreaming || sendMut.isPending}
                      isFirstInGroup={isFirstInGroup}
                      isLastAssistant={msg.id === lastAssistantId}
                      isLastInGroup={isLastInGroup}
                      isLastUser={msg.id === lastUserId}
                      key={String(msg.id)}
                      message={msg}
                      onEditAndResend={handleEditAndResend}
                      onRegenerate={handleRegenerate}
                    />
                  );
                })
              )}

              {isWaiting && (
                <View style={styles.thinkingRow}>
                  <View style={styles.thinkingAvatar}>
                    <HelixMark color={colors.violet} size={16} />
                  </View>
                  <GlassPanel style={styles.thinkingBubble}>
                    <TypingDots />
                    <AppText tone="secondary" variant="caption">
                      {t('chatbot.thinking', 'Helix is thinking…')}
                    </AppText>
                  </GlassPanel>
                </View>
              )}
            </ScrollView>

            <View style={styles.inputBar}>
              <View style={styles.inputWrap}>
                <TextInput
                  accessibilityLabel={t('chatbot.inputLabel', 'Message')}
                  multiline
                  onChangeText={setInput}
                  onKeyPress={handleKeyPress}
                  onSubmitEditing={handleSubmitEditing}
                  placeholder={t('chatbot.placeholder', 'Ask about your fleet…')}
                  placeholderTextColor={colors.textMuted}
                  ref={inputRef}
                  style={styles.input}
                  value={input}
                />
              </View>
              {isStreaming ? (
                <Pressable
                  accessibilityLabel={t(
                    'chatbot.actions.stopStreaming',
                    'Stop streaming',
                  )}
                  accessibilityRole="button"
                  onPress={stopAll}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressedDim,
                  ]}>
                  <SemanticIcon decorative name="stop" size="sm" />
                  <AppText weight="semibold">
                    {t('chatbot.actions.stop', 'Stop')}
                  </AppText>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel={t('chatbot.actions.send', 'Send message')}
                  accessibilityRole="button"
                  disabled={!canSend}
                  onPress={handleSend}
                  style={({ pressed }) => [
                    styles.sendButton,
                    !canSend && styles.disabledButton,
                    pressed && canSend && styles.pressedDim,
                  ]}>
                  <SemanticIcon decorative name="send" size="md" />
                </Pressable>
              )}
            </View>
          </GlassPanel>
        </View>
      </View>

      {/* Mobile History overlay (the web fixed-overlay path). */}
      <Modal
        animationType="slide"
        onRequestClose={() => setShowSessions(false)}
        transparent
        visible={showSessions && isMobile}>
        <View
          accessibilityLabel={t('chatbot.history', 'History')}
          style={styles.historyModalRoot}>
          <Pressable
            accessibilityLabel={t('chatbot.history', 'History')}
            onPress={() => setShowSessions(false)}
            style={styles.historyModalBackdrop}
          />
          <View style={styles.historyModalSheet}>
            <SessionListView
              activeSessionId={sessionId}
              isLoading={sessionsQuery.isLoading}
              onDelete={handleDelete}
              onNewChat={() => {
                startNewSession();
                setShowSessions(false);
              }}
              onRename={handleRename}
              onSelect={(id) => {
                loadSession(id);
                setShowSessions(false);
              }}
              sessions={sessions}
              style={styles.sessionPanelMobile}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

ChatbotPage.displayName = 'ChatbotPage';

// usePageTitle proxy kept as a hook call so the hook-count/order matches the
// web source's usePageTitle(t('chatbot.title','Helix')).
function usePageTitleProxy(t: NativeTFunction): void {
  useNativePageTitle(t('chatbot.title', 'Helix'));
}

/* ─── styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerCopy: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  body: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  conversationRow: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 0,
  },
  // session list
  sessionPanel: {
    flexDirection: 'column',
    overflow: 'hidden',
    padding: 0,
  },
  sessionPanelDesktop: {
    width: 288,
  },
  sessionPanelMobile: {
    flex: 1,
  },
  sessionHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    padding: spacing.md,
  },
  sessionNewChat: {
    width: '100%',
  },
  sessionSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    textTransform: 'uppercase',
  },
  sessionScroll: {
    flex: 1,
    padding: spacing.sm,
  },
  sessionLoading: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  sessionEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  sessionEmptyText: {
    textAlign: 'center',
  },
  sessionRow: {
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.xs,
    position: 'relative',
  },
  sessionRowActive: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.violetBorder,
  },
  sessionButton: {
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingRight: spacing.xl,
    paddingVertical: spacing.sm,
  },
  sessionTitle: {
    fontSize: typography.caption,
  },
  sessionTitleActive: {
    color: colors.violet,
  },
  sessionMeta: {
    fontSize: 10,
  },
  sessionRenameInput: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sessionDelete: {
    borderRadius: 8,
    padding: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
  },
  // chat panel
  chatPanel: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    padding: 0,
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    gap: spacing.md,
    padding: spacing.md,
  },
  emptyConversation: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  emptyHaloOuter: {
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    borderRadius: 999,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  emptyHaloInner: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
  },
  // messages
  messageRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowBot: {
    justifyContent: 'flex-start',
  },
  avatarSlot: {
    marginTop: spacing.xs,
  },
  invisible: {
    opacity: 0,
  },
  bubble: {
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleUser: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  bubbleBot: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  userText: {
    color: colors.textPrimary,
  },
  assistantText: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  streamingCursor: {
    backgroundColor: colors.violet,
    height: 16,
    marginLeft: 2,
    opacity: 0.8,
    width: 2,
  },
  timestamp: {
    fontSize: 10,
    marginTop: spacing.sm,
  },
  messageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  editArea: {
    gap: spacing.sm,
  },
  editInput: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: 72,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  // thinking
  thinkingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  thinkingAvatar: {
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderColor: colors.violetBorder,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    padding: 6,
  },
  thinkingBubble: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  typingDots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  typingDot: {
    backgroundColor: colors.violet,
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  // input bar
  inputBar: {
    alignItems: 'flex-end',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  inputWrap: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    maxHeight: 160,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
  // suggestions
  suggestions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    maxWidth: 560,
  },
  suggestionChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionText: {
    color: colors.textSecondary,
  },
  // buttons
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  primaryButtonSm: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  primaryButtonText: {
    color: colors.background,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  ghostButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  ghostButtonActive: {
    borderColor: colors.borderAccent,
  },
  ghostButtonSm: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 12,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dangerButtonText: {
    color: colors.background,
  },
  disabledButton: {
    opacity: 0.48,
  },
  pressedDim: {
    opacity: 0.82,
  },
  // confirm dialog / modal
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 16, 0.66)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  confirmMessage: {
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  // history modal
  historyModalRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  historyModalBackdrop: {
    backgroundColor: 'rgba(2, 6, 16, 0.55)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  historyModalSheet: {
    height: '100%',
    maxWidth: 360,
    padding: spacing.md,
    width: '85%',
  },
});
