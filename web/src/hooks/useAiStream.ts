// SSE streaming hook for AI features.
//
// useAiStream is the canonical SSE consumer for AI features.
// Every AI feature that streams MUST consume this hook — the ESLint
// rule `teslasync/no-raw-fetch-stream-for-ai` rejects any other code
// that opens its own `fetch + ReadableStream` for an `/api/v1/ai/...`
// endpoint.
//
// Why fetch + ReadableStream and not EventSource?
// -----------------------------------------------
// EventSource only supports GET. AI feature requests POST a JSON body
// (conversation history, attachments, tool config). fetch lets us POST
// AND stream the response, at the cost of a small parser. The parser
// here is intentionally simple: SSE frames are blank-line delimited,
// each containing `event: <type>\n` followed by `data: <json>\n`. That
// matches the backend writer (internal/ai/stream/writer.go) bit-for-bit;
// the contract test (tools/aistream-contract) keeps both sides honest.
//
// Why a hook and not a class?
// ---------------------------
// React's data-flow expects state to live in components. Wrapping the
// stream in a hook keeps cancellation tied to the component lifecycle:
// AbortController fires on unmount, the producer goroutine on the
// server observes the closed connection, and the back-end Writer's
// consumer cancels the upstream provider context. Cancellation round-trips end-
// to-end through this hook.
//
// Off-mode contract
// -----------------
// Off-mode: the underlying /api/v1/ai/* route returns 404 (guard.Wrap).
// `start()` propagates that 404 as `state='error'` with a message; the
// component is expected to fall back to its non-AI baseline. The
// hook itself does NOT consult `useAiEnabled` — that's the caller's
// responsibility, mirroring the backend pattern where the handler
// (gated) constructs the Writer.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getApiBase } from '@/lib/resilience';

// AiStreamEvent is the discriminated union of every event the backend
// SSE writer emits. The discriminator is `type`; the payload shape
// matches the typed Go structs in internal/ai/stream/writer.go.
//
// Keep the literal `type:` strings in lockstep with the Go const block
// (`EventDelta`, `EventToolCall`, …). The contract test
// (tools/aistream-contract) walks both files and asserts the literal
// list matches.
export type AiStreamEvent =
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
      // Structured rate-limit / cost-cap fields. Optional —
      // legacy plain-error frames still parse cleanly. The frontend
      // AiLimitBanner reads these to render the right banner level
      // and a retry countdown. See [limit.Decision] for the closed
      // value set the backend writes.
      reason?: string;
      retry_after_s?: number;
      banner_level?: 'warn' | 'critical' | '';
      baseline_available?: boolean;
    };

// AiStreamState is the user-facing lifecycle. `paused-confirm` is set
// by the hook when a `confirm_request` event arrives — the component
// renders a ConfirmDialog and POSTs the user's decision to the
// continuation endpoint, which in turn opens a fresh SSE stream that
// the caller drives by calling `start()` again with the continuation
// payload.
export type AiStreamState = 'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error';

// UseAiStreamArgs is the parameter object passed to the hook. We use
// an object (instead of positional args) so feature pages can
// destructure only what they need and so adding optional knobs (e.g.
// per-call retry policy) is non-breaking.
export interface UseAiStreamArgs {
  /**
   * The /api/v1/ai/... path the stream is opened against. The hook
   * prepends `${getApiBase()}/api/v1` so callers pass a leading
   * slash and the bare route — same convention as `request()` in
   * web/src/api/client.ts.
   */
  url: string;

  /**
   * The JSON body POSTed to the URL. May be null/undefined for GET-
   * style streams. The hook stringifies it once at start() time so
   * mutating the original after start() has no effect on the in-flight
   * call.
   */
  body?: unknown;

  /**
   * Per-event callback. Invoked for EVERY parsed event in arrival
   * order, including terminal `done`/`error` frames. The component can
   * append `tool_call` and `tool_result` rows to a transcript here; the
   * `delta.text` accumulator is exposed separately as `state.text` for
   * convenience.
   */
  onEvent: (ev: AiStreamEvent) => void;
}

// AiLimitInfo is the structured rate-limit / cost-cap info parsed
// from a terminal `error` SSE frame. F9 added structured fields to
// the error frame so the AiLimitBanner can render the right colour
// + a retry countdown without scraping the human-readable message.
//
// Only present when the error frame carried a `reason` field; legacy
// plain-error frames yield `limit === null` and the page should fall
// back to the generic ErrorDisplay.
export interface AiLimitInfo {
  reason: string;
  retryAfterS: number;
  bannerLevel: 'warn' | 'critical' | '';
  baselineAvailable: boolean;
  message: string;
}

export type AiToolActivityStatus = 'running' | 'succeeded' | 'failed';

/**
 * Privacy-safe execution metadata for one Helix tool call. Arguments and
 * result payloads intentionally stay in the event callback rather than shared
 * UI state because they can contain locations, VINs, or other fleet details.
 */
export interface AiToolActivity {
  id: string;
  name: string;
  status: AiToolActivityStatus;
}

export interface AiUsage {
  in: number;
  out: number;
}

// UseAiStreamResult is the return shape. `start` and `cancel` are
// stable functional handles; `state` and `text` re-render the
// component on change.
export interface UseAiStreamResult {
  /** Open the stream. Calling while `state === 'streaming'` is a no-op. */
  start: () => void;
  /** Abort the stream. Sends fetch's AbortController signal which
   *  causes the backend Writer to observe the closed connection. */
  cancel: () => void;
  /** Lifecycle state. Drives UI affordances (spinner / typing dots / banner). */
  state: AiStreamState;
  /** Accumulated `delta.text` payloads in arrival order. */
  text: string;
  /** The error message if `state === 'error'`, else null. */
  error: string | null;
  /**
   * F9: structured rate-limit / cost-cap info if the last terminal
   * error carried one. `null` otherwise. The AiLimitBanner consumes
   * this field directly. Pages should pivot to their non-AI baseline
   * when `limit !== null && limit.baselineAvailable`.
   */
  limit: AiLimitInfo | null;
  /** Ordered, privacy-safe tool execution trail for provenance UI. */
  activity: AiToolActivity[];
  /** Token usage reported by the terminal frame, or null while incomplete. */
  usage: AiUsage | null;
  /** Provider finish reason reported by the terminal frame. */
  finishReason: string | null;
}

// SSE_DELIM is the standard event terminator: a blank line. The
// backend writer emits `\n\n`; some intermediaries normalise to
// `\r\n\r\n`. Split on either.
const SSE_DELIM_RE = /\r?\n\r?\n/;

// LINE_DELIM_RE splits a single event into its lines.
const LINE_DELIM_RE = /\r?\n/;

/**
 * useAiStream opens an SSE stream over fetch + ReadableStream and
 * exposes a small reactive surface for AI feature pages.
 *
 * Lifecycle: idle → streaming → (done | error). On `confirm_request`
 * the state pauses at `paused-confirm`; the caller is expected to
 * cancel and re-`start()` against the continuation endpoint.
 *
 * Cancellation: the AbortController is fired on `cancel()` AND on
 * component unmount. Subsequent `start()` calls construct a fresh
 * controller.
 */
export function useAiStream(args: UseAiStreamArgs): UseAiStreamResult {
  const { url, body, onEvent } = args;
  const [state, setState] = useState<AiStreamState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<AiLimitInfo | null>(null);
  const [activity, setActivity] = useState<AiToolActivity[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);

  // Latest callback ref so closing over `onEvent` does not stale-pin
  // the parser. Same trick used by useEffect-flavoured event
  // subscriptions across the codebase.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // Per-stream resources we need to be able to tear down: the
  // AbortController (drives cancellation) and a flag to coalesce
  // duplicate `start()` calls.
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    runningRef.current = false;
    setActivity(markRunningActivitiesFailed);
    setState((current) => (current === 'streaming' ? 'idle' : current));
  }, []);

  // Cleanup on unmount. Dependency is empty so this fires only on
  // mount/unmount — using `cancel` here would re-fire whenever the
  // ref-stable callback identity changes (it shouldn't, but defensive).
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    setState('streaming');
    setText('');
    setError(null);
    setLimit(null);
    setActivity([]);
    setUsage(null);
    setFinishReason(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const requestBody = body !== undefined ? JSON.stringify(body) : undefined;
    const fullURL = `${getApiBase()}/api/v1${url.startsWith('/') ? url : `/${url}`}`;
    let terminalSeen = false;
    let confirmationPending = false;

    void (async () => {
      try {
        const res = await fetch(fullURL, {
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
          // Off-mode (404), feature toggle off (404), 5xx, etc.
          // The component is expected to fall back to its non-AI
          // baseline (R8).
          const msg = `stream_http_${res.status}`;
          finalizeError(msg);
          return;
        }
        if (!res.body) {
          finalizeError('stream_no_body');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Each event is delimited by a blank line; the buffer may
          // contain multiple events in a single chunk on a fast
          // backend.
          const parts = buffer.split(SSE_DELIM_RE);
          // Last fragment may be incomplete — keep it for the next read.
          buffer = parts.pop() ?? '';
          for (const raw of parts) {
            if (!raw.trim()) continue;
            const ev = parseSSEFrame(raw);
            if (!ev) continue;
            handleEvent(ev);
          }
        }
        // Drain any final fragment that arrived without a trailing
        // blank line (some intermediaries strip the final \n\n).
        if (buffer.trim()) {
          const ev = parseSSEFrame(buffer);
          if (ev) handleEvent(ev);
        }
        if (!terminalSeen && !confirmationPending) {
          finalizeError('stream_incomplete');
        }
      } catch (err) {
        // AbortError is the user-cancel path — don't flag as error.
        if (err instanceof Error && err.name === 'AbortError') {
          setActivity(markRunningActivitiesFailed);
          setState((cur) => (cur === 'streaming' ? 'idle' : cur));
          runningRef.current = false;
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        finalizeError(msg);
      } finally {
        runningRef.current = false;
        abortRef.current = null;
      }
    })();

    function handleEvent(ev: AiStreamEvent) {
      onEventRef.current(ev);
      switch (ev.type) {
        case 'delta':
          setText((prev) => prev + ev.text);
          break;
        case 'confirm_request':
          confirmationPending = true;
          setState('paused-confirm');
          break;
        case 'tool_call':
          setActivity((current) => mergeAiToolActivity(current, {
            id: ev.id,
            name: ev.name,
            status: 'running',
          }));
          break;
        case 'tool_result':
          setActivity((current) => mergeAiToolActivity(current, {
            id: ev.id,
            name: ev.name,
            status: ev.ok ? 'succeeded' : 'failed',
          }));
          break;
        case 'done':
          terminalSeen = true;
          setUsage(ev.usage);
          setFinishReason(ev.finish_reason);
          setActivity(markRunningActivitiesFailed);
          setState('done');
          break;
        case 'error':
          terminalSeen = true;
          // F9: capture the structured limit fields so the
          // AiLimitBanner can render the right banner. Plain-error
          // frames (no `reason`) yield limit === null, which the
          // banner treats as "do not render".
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
      }
    }

    function finalizeError(message: string) {
      setActivity(markRunningActivitiesFailed);
      setError(message);
      setState('error');
    }
  }, [url, body, state]);

  return { start, cancel, state, text, error, limit, activity, usage, finishReason };
}

export function markRunningActivitiesFailed(current: AiToolActivity[]): AiToolActivity[] {
  return current.map((item) => (
    item.status === 'running' ? { ...item, status: 'failed' } : item
  ));
}

export function mergeAiToolActivity(
  current: AiToolActivity[],
  next: AiToolActivity,
): AiToolActivity[] {
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) return [...current, next];
  return current.map((item, itemIndex) => (itemIndex === index ? next : item));
}

/**
 * parseSSEFrame parses a single SSE block (lines without the trailing
 * blank line) into a typed AiStreamEvent. Returns null on a malformed
 * frame so the loop can skip it instead of corrupting the stream.
 *
 * Exported for the unit test — production code consumes the hook.
 */
export function parseSSEFrame(raw: string): AiStreamEvent | null {
  let event = '';
  const dataParts: string[] = [];
  for (const line of raw.split(LINE_DELIM_RE)) {
    if (line.startsWith(':')) continue; // comment per SSE spec
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
  if (!event) return null;
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

// toTypedEvent narrows the (event, data) pair into the AiStreamEvent
// union. Returns null for unknown event types so a future server
// adding a new event cannot crash an older client — the hook simply
// drops what it does not understand.
function toTypedEvent(event: string, data: unknown): AiStreamEvent | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  switch (event) {
    case 'delta':
      if (typeof d.text !== 'string') return null;
      return { type: 'delta', text: d.text };
    case 'tool_call':
      if (typeof d.id !== 'string' || typeof d.name !== 'string') return null;
      return { type: 'tool_call', id: d.id, name: d.name, arguments: d.arguments };
    case 'tool_result':
      if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.ok !== 'boolean') {
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
      const finishReason = typeof d.finish_reason === 'string' ? d.finish_reason : 'stop';
      return {
        type: 'done',
        finish_reason: finishReason,
        usage: {
          in: typeof usage?.in === 'number' ? usage.in : 0,
          out: typeof usage?.out === 'number' ? usage.out : 0,
        },
      };
    }
    case 'error': {
      const message = typeof d.message === 'string' ? d.message : 'unknown';
      const reason = typeof d.reason === 'string' ? d.reason : undefined;
      const retryAfterS = typeof d.retry_after_s === 'number' ? d.retry_after_s : undefined;
      const bannerLevelRaw = typeof d.banner_level === 'string' ? d.banner_level : undefined;
      const bannerLevel: 'warn' | 'critical' | '' | undefined =
        bannerLevelRaw === 'warn' || bannerLevelRaw === 'critical' || bannerLevelRaw === ''
          ? bannerLevelRaw
          : undefined;
      const baselineAvailable =
        typeof d.baseline_available === 'boolean' ? d.baseline_available : undefined;
      return {
        type: 'error',
        message,
        reason,
        retry_after_s: retryAfterS,
        banner_level: bannerLevel,
        baseline_available: baselineAvailable,
      };
    }
    default:
      return null;
  }
}
