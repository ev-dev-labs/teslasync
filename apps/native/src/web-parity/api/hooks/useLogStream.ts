// Subscribe to the admin SSE log tail at GET /admin/logs/stream and
// surface the rolling event buffer + connection status to native parity
// screens. Native fetch can attach X-Sudo-Token via the shared API client
// machinery, but streaming response body support depends on the runtime, so
// the hook reports an explicit unavailable error when ReadableStream support
// is missing.

import {useCallback, useEffect, useRef, useState} from 'react';

import {apiUrl} from '../client';

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
 * payload isn't valid JSON - the consumer falls back to rendering
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
 * ceiling on the native side.
 */
export const LOG_STREAM_MAX_EVENTS = 1000;

/**
 * Default endpoint relative to the API root. Exported so tests can
 * cross-check the URL the hook is wiring up.
 */
export const LOG_STREAM_PATH = '/admin/logs/stream';

export const LOG_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for admin log SSE streaming.';

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
  /**
   * Total number of events received since this hook was created
   * (NOT just the events still in the rolling buffer).
   */
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
  filter?: {level?: string; grep?: string};
}

interface DropFrame {
  type: 'drop';
  count?: number;
}

interface NativeReadableStreamReader {
  read(): Promise<{
    value?: ArrayBuffer | ArrayBufferView | number[] | string;
    done?: boolean;
  }>;
  cancel?: () => Promise<void> | void;
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
    options?: {stream?: boolean},
  ): string;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;

type AnimationFrameHandle = number;
type FrameScheduler = (callback: () => void) => AnimationFrameHandle;
type FrameCanceller = (handle: AnimationFrameHandle) => void;

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
  const normalised = buffer.replace(/\r\n/g, '\n');
  const parts = normalised.split('\n\n');
  const remainder = parts.pop() ?? '';
  for (const raw of parts) {
    if (!raw) {
      continue;
    }
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
    frames.push({event, data});
  }
  return {frames, remainder};
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
 * the row isn't JSON or has no `level` field - matches what zerolog
 * does on its own.
 */
function detectLevel(parsed: Record<string, unknown> | null): string {
  if (parsed && typeof parsed.level === 'string') {
    return parsed.level;
  }
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
  params.append('level', level);
  if (grep.trim().length > 0) {
    params.append('grep', grep);
  }
  return `${base}?${params.toString()}`;
}

function getReadableStreamBody(res: Response): NativeReadableStreamBody | null {
  const body = (res as ResponseWithNativeStream).body;
  if (body && typeof body.getReader === 'function') {
    return body;
  }
  return null;
}

function getTextDecoder(): TextDecoderLike | null {
  const candidate = (globalThis as typeof globalThis & {TextDecoder?: unknown})
    .TextDecoder;
  return typeof candidate === 'function'
    ? new (candidate as TextDecoderConstructorLike)('utf-8')
    : null;
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView | number[]): Uint8Array {
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
    return decoder ? decoder.decode(undefined, {stream}) : '';
  }
  if (typeof value === 'string') {
    return value;
  }

  const bytes = toUint8Array(value);
  if (decoder) {
    return decoder.decode(bytes, {stream});
  }
  if (bytes.every(byte => byte < 0x80)) {
    return decodeAscii(bytes);
  }
  throw new Error(
    `${LOG_STREAM_UNAVAILABLE_REASON} UTF-8 TextDecoder is unavailable.`,
  );
}

function getFrameScheduler(): FrameScheduler | null {
  const scheduler = (
    globalThis as typeof globalThis & {requestAnimationFrame?: unknown}
  ).requestAnimationFrame;
  if (typeof scheduler !== 'function') {
    return null;
  }

  return callback => {
    return (scheduler as (frame: (timestamp: number) => void) => number)(() => {
      callback();
    });
  };
}

function getFrameCanceller(): FrameCanceller | null {
  const canceller = (
    globalThis as typeof globalThis & {cancelAnimationFrame?: unknown}
  ).cancelAnimationFrame;
  return typeof canceller === 'function'
    ? (canceller as FrameCanceller)
    : null;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') {
    return true;
  }
  if (err && typeof err === 'object') {
    const candidate = err as {name?: unknown; code?: unknown};
    return (
      candidate.name === 'AbortError' ||
      candidate.code === 20 ||
      candidate.code === 'ABORT_ERR'
    );
  }
  return false;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch | null {
  if (fetchImpl) {
    return fetchImpl;
  }
  const candidate = (globalThis as typeof globalThis & {fetch?: unknown}).fetch;
  return typeof candidate === 'function' ? (candidate as typeof fetch) : null;
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

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const pendingRef = useRef<LogStreamEvent[]>([]);
  const rafRef = useRef<AnimationFrameHandle | null>(null);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    const batch = pendingRef.current;
    if (batch.length === 0) {
      return;
    }
    pendingRef.current = [];
    setEvents(prev => {
      const merged = prev.concat(batch);
      if (merged.length <= LOG_STREAM_MAX_EVENTS) {
        return merged;
      }
      return merged.slice(merged.length - LOG_STREAM_MAX_EVENTS);
    });
    setTotalReceived(prev => prev + batch.length);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    const scheduleFrame = getFrameScheduler();
    if (scheduleFrame == null) {
      rafRef.current = -1;
      Promise.resolve().then(() => {
        rafRef.current = null;
        flushPending();
      });
      return;
    }
    rafRef.current = scheduleFrame(() => {
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

    const fetcher = getFetch(fetchImpl);
    if (fetcher == null) {
      setIsConnected(false);
      setError(new Error('React Native fetch is unavailable.'));
      return;
    }

    const controller = new AbortController();
    const url = buildLogStreamUrl(level, grep, endpoint ?? apiUrl(LOG_STREAM_PATH));

    let cancelled = false;
    setError(null);

    void (async () => {
      let reader: NativeReadableStreamReader | null = null;
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
        if (cancelled) {
          return;
        }

        const streamBody = getReadableStreamBody(res);
        if (!res.ok || streamBody == null) {
          const detail = await res.text().catch(() => '');
          if (streamBody == null && res.ok) {
            throw new Error(
              detail
                ? `${LOG_STREAM_UNAVAILABLE_REASON} ${detail}`
                : LOG_STREAM_UNAVAILABLE_REASON,
            );
          }
          throw new Error(
            `log stream rejected: ${res.status} ${res.statusText}${
              detail ? ` - ${detail}` : ''
            }`,
          );
        }

        setIsConnected(true);
        reader = streamBody.getReader();
        const decoder = getTextDecoder();
        let buffer = '';
        for (;;) {
          const {value, done} = await reader.read();
          if (done) {
            break;
          }
          buffer += decodeStreamChunk(value, decoder, true);
          const {frames, remainder} = parseSSEChunk(buffer);
          buffer = remainder;
          if (frames.length === 0) {
            continue;
          }
          let queued = false;
          for (const frame of frames) {
            switch (frame.event) {
              case 'log': {
                if (pausedRef.current) {
                  break;
                }
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
                if (count > 0) {
                  setDrops(prev => prev + count);
                }
                break;
              }
              case 'connected': {
                tryParseJSON<ConnectedFrame>(frame.data);
                break;
              }
              case 'heartbeat':
              default:
                break;
            }
          }
          if (queued) {
            scheduleFlush();
          }
        }
      } catch (err) {
        if (cancelled || isAbortError(err)) {
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        reader?.releaseLock?.();
        if (!cancelled) {
          setIsConnected(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (rafRef.current !== null && rafRef.current >= 0) {
        try {
          getFrameCanceller()?.(rafRef.current);
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
