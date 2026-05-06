// useLogStream — Phase-46 / Prompt 34
//
// Subscribe to the admin SSE log tail at GET /admin/logs/stream and
// surface the rolling event buffer + connection status to the
// LiveLogsPage. The browser EventSource API can't attach
// X-Sudo-Token (or any custom header), so we implement the SSE
// transport on top of fetch + ReadableStream + a hand-rolled parser.
// That also lets us honour an injected AbortSignal for the
// route-change abort discipline established in Phase-46 / Prompt 02.
//
// Updates land via requestAnimationFrame batching: zerolog can
// produce thousands of events per second on a hot system and a naive
// per-line setState would melt the renderer. We accumulate parsed
// events into a ref-backed pending queue and flush once per frame.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../client';

/**
 * Severity threshold for the server-side filter. Matches the levels
 * supported by the backend handler (`debug` includes everything down
 * to debug; `error` only surfaces error/fatal/panic).
 */
export type LogStreamLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Single parsed log row. `payload` is the raw zerolog JSON line so
 * the page can render arbitrary fields without us pre-modelling
 * them; `parsed` is the lazily-decoded object form (or null when the
 * payload isn't valid JSON — the consumer falls back to rendering
 * the raw text).
 *
 * `seq` is a monotonic counter assigned on receive so React keys
 * stay stable across reconciles even when two events share the same
 * timestamp.
 */
export interface LogStreamEvent {
  seq: number;
  receivedAt: number;
  payload: string;
  parsed: Record<string, unknown> | null;
  level: string;
}

/**
 * Maximum number of events kept in the rolling client-side buffer.
 * Older events are evicted FIFO. The backend already drops events
 * when its per-subscriber buffer fills, so this is purely a memory
 * ceiling on the browser side.
 */
export const LOG_STREAM_MAX_EVENTS = 1000;

/**
 * Default endpoint relative to the API root. Exported so tests can
 * cross-check the URL the hook is wiring up.
 */
export const LOG_STREAM_PATH = '/admin/logs/stream';

export interface UseLogStreamOptions {
  level: LogStreamLevel;
  grep: string;
  /** When false, the hook tears down any open stream and stops appending. */
  enabled?: boolean;
  /** When true, the hook stays connected but stops appending events. */
  paused?: boolean;
  /**
   * Override the URL the hook fetches. Tests use this to point at a
   * stub server; production callers must omit it.
   */
  endpoint?: string;
  /**
   * Override fetch implementation. Tests inject a stub that returns
   * a Response with a controlled ReadableStream body.
   */
  fetchImpl?: typeof fetch;
}

export interface UseLogStreamResult {
  events: LogStreamEvent[];
  isConnected: boolean;
  error: Error | null;
  drops: number;
  /** Total number of events received since this hook was created
   *  (NOT just the events still in the rolling buffer). */
  totalReceived: number;
  /** Drop the in-memory buffer and reset the dropped/received counters. */
  clear: () => void;
}

interface ParsedFrame {
  event: string;
  data: string;
}

interface ConnectedFrame {
  type: 'connected';
  filter?: { level?: string; grep?: string };
}

interface DropFrame {
  type: 'drop';
  count?: number;
}

/**
 * Pull-driven SSE parser. Walks the buffer, splits on the SSE record
 * separator (`\n\n`), and emits frames; partial trailing data is
 * preserved in the returned remainder so the caller can prepend it
 * to the next chunk.
 */
export function parseSSEChunk(buffer: string): {
  frames: ParsedFrame[];
  remainder: string;
} {
  const frames: ParsedFrame[] = [];
  // Normalise CRLF to LF so a server that uses \r\n still parses.
  const normalised = buffer.replace(/\r\n/g, '\n');
  const parts = normalised.split('\n\n');
  const remainder = parts.pop() ?? '';
  for (const raw of parts) {
    if (!raw) continue;
    let event = 'message';
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trimStart();
      } else if (line.startsWith('data:')) {
        const piece = line.slice(5).startsWith(' ')
          ? line.slice(6)
          : line.slice(5);
        data = data === '' ? piece : `${data}\n${piece}`;
      }
    }
    frames.push({ event, data });
  }
  return { frames, remainder };
}

/**
 * Small helper around JSON.parse that returns `null` instead of
 * throwing on bad payloads.
 */
function tryParseJSON<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

let __seqCounter = 0;
function nextSeq(): number {
  __seqCounter = (__seqCounter + 1) >>> 0;
  return __seqCounter;
}

/**
 * Determine the level a payload reports. Falls back to "info" when
 * the row isn't JSON or has no `level` field — matches what zerolog
 * does on its own.
 */
function detectLevel(parsed: Record<string, unknown> | null): string {
  if (parsed && typeof parsed.level === 'string') return parsed.level;
  return 'info';
}

/**
 * Build a `LogStreamEvent` from a raw `data:` payload. Exported so
 * the page can re-use the parser when ingesting paste/replay data.
 */
export function buildLogEvent(payload: string): LogStreamEvent {
  const parsed = tryParseJSON<Record<string, unknown>>(payload);
  return {
    seq: nextSeq(),
    receivedAt: Date.now(),
    payload,
    parsed,
    level: detectLevel(parsed),
  };
}

/**
 * Format the SSE URL the hook fetches. Exported so the page can
 * surface the actual URL in a "Connection details" affordance.
 */
export function buildLogStreamUrl(
  level: LogStreamLevel,
  grep: string,
  base: string = LOG_STREAM_PATH,
): string {
  const params = new URLSearchParams();
  params.set('level', level);
  if (grep.trim().length > 0) params.set('grep', grep);
  return `${base}?${params.toString()}`;
}

/**
 * Subscribe to /admin/logs/stream. Re-runs whenever level/grep/
 * enabled/endpoint changes; pause is honoured by skipping the
 * append step without dropping the connection.
 */
export function useLogStream(options: UseLogStreamOptions): UseLogStreamResult {
  const {
    level,
    grep,
    enabled = true,
    paused = false,
    endpoint,
    fetchImpl,
  } = options;

  const [events, setEvents] = useState<LogStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [drops, setDrops] = useState(0);
  const [totalReceived, setTotalReceived] = useState(0);

  // Latest paused flag without re-firing the effect (pause must NOT
  // tear down the stream — the user expects to keep the buffer
  // collecting on the server while they read).
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Pending events queued between rAF flushes. Using a ref keeps the
  // append path allocation-free except for the array itself.
  const pendingRef = useRef<LogStreamEvent[]>([]);
  const rafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    setEvents((prev) => {
      const merged = prev.concat(batch);
      if (merged.length <= LOG_STREAM_MAX_EVENTS) return merged;
      return merged.slice(merged.length - LOG_STREAM_MAX_EVENTS);
    });
    setTotalReceived((prev) => prev + batch.length);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    if (typeof window === 'undefined' || !window.requestAnimationFrame) {
      // Test / SSR fallback — flush synchronously on next microtask
      // so tests don't need to drive rAF.
      rafRef.current = -1;
      Promise.resolve().then(() => {
        rafRef.current = null;
        flushPending();
      });
      return;
    }
    rafRef.current = window.requestAnimationFrame(() => {
      flushPending();
    });
  }, [flushPending]);

  const clear = useCallback(() => {
    pendingRef.current = [];
    setEvents([]);
    setDrops(0);
    setTotalReceived(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    const controller = new AbortController();
    const fetcher = fetchImpl ?? fetch;
    const url = buildLogStreamUrl(level, grep, endpoint ?? apiUrl(LOG_STREAM_PATH));

    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const res = await fetcher(url, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'same-origin',
          headers: {
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
        if (cancelled) return;
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '');
          throw new Error(
            `log stream rejected: ${res.status} ${res.statusText}${
              detail ? ` — ${detail}` : ''
            }`,
          );
        }
        setIsConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, remainder } = parseSSEChunk(buffer);
          buffer = remainder;
          if (frames.length === 0) continue;
          let queued = false;
          for (const frame of frames) {
            switch (frame.event) {
              case 'log': {
                if (pausedRef.current) break;
                pendingRef.current.push(buildLogEvent(frame.data));
                queued = true;
                break;
              }
              case 'drop': {
                const parsed = tryParseJSON<DropFrame>(frame.data);
                const count =
                  parsed && typeof parsed.count === 'number'
                    ? parsed.count
                    : 0;
                if (count > 0) setDrops((prev) => prev + count);
                break;
              }
              case 'connected': {
                // Echo from the server — we already toggled
                // isConnected when the response headers arrived.
                tryParseJSON<ConnectedFrame>(frame.data);
                break;
              }
              case 'heartbeat':
              default:
                break;
            }
          }
          if (queued) scheduleFlush();
        }
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof DOMException &&
          (err.name === 'AbortError' || err.code === 20)
        ) {
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (rafRef.current !== null && rafRef.current >= 0) {
        try {
          window.cancelAnimationFrame(rafRef.current);
        } catch {
          /* noop */
        }
      }
      rafRef.current = null;
      pendingRef.current = [];
    };
  }, [level, grep, enabled, endpoint, fetchImpl, scheduleFlush]);

  return {
    events,
    isConnected,
    error,
    drops,
    totalReceived,
    clear,
  };
}
