/**
 * useLogStream — Phase-46 / Prompt 34 unit tests.
 *
 * Covers the SSE parser plus the React hook lifecycle:
 *   - parseSSEChunk splits multi-event payloads, preserves remainder.
 *   - parseSSEChunk handles CRLF normalisation + multi-line data.
 *   - buildLogEvent decodes valid JSON and falls back to raw on bad
 *     payloads.
 *   - buildLogStreamUrl encodes filters correctly.
 *   - the hook subscribes via fetch, drains the stream, and exposes
 *     drop counts.
 *   - tearing down (enabled = false / unmount) aborts the fetch and
 *     leaves no dangling readers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  buildLogEvent,
  buildLogStreamUrl,
  LOG_STREAM_PATH,
  parseSSEChunk,
  useLogStream,
} from './useLogStream';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSSEChunk', () => {
  it('returns no frames for an empty buffer', () => {
    const { frames, remainder } = parseSSEChunk('');
    expect(frames).toEqual([]);
    expect(remainder).toBe('');
  });

  it('parses a single complete frame', () => {
    const { frames, remainder } = parseSSEChunk(
      'event: log\ndata: {"a":1}\n\n',
    );
    expect(frames).toEqual([{ event: 'log', data: '{"a":1}' }]);
    expect(remainder).toBe('');
  });

  it('preserves trailing partial frames as remainder', () => {
    const { frames, remainder } = parseSSEChunk(
      'event: log\ndata: {"a":1}\n\nevent: log\ndata: par',
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: 'log', data: '{"a":1}' });
    expect(remainder).toBe('event: log\ndata: par');
  });

  it('handles multi-line data fields (each `data:` joined by \\n)', () => {
    const { frames } = parseSSEChunk(
      'event: log\ndata: line one\ndata: line two\n\n',
    );
    expect(frames).toEqual([
      { event: 'log', data: 'line one\nline two' },
    ]);
  });

  it('normalises CRLF line endings before splitting', () => {
    const { frames } = parseSSEChunk(
      'event: log\r\ndata: {"a":1}\r\n\r\n',
    );
    expect(frames).toEqual([{ event: 'log', data: '{"a":1}' }]);
  });

  it('defaults the event name to "message" when only data: is present', () => {
    const { frames } = parseSSEChunk('data: hello\n\n');
    expect(frames).toEqual([{ event: 'message', data: 'hello' }]);
  });
});

describe('buildLogEvent', () => {
  it('decodes valid JSON payloads and reads the level field', () => {
    const ev = buildLogEvent('{"level":"warn","message":"x"}');
    expect(ev.parsed).toEqual({ level: 'warn', message: 'x' });
    expect(ev.level).toBe('warn');
  });

  it('falls back to raw text and "info" level for garbage payloads', () => {
    const ev = buildLogEvent('not json at all');
    expect(ev.parsed).toBeNull();
    expect(ev.level).toBe('info');
    expect(ev.payload).toBe('not json at all');
  });

  it('assigns monotonically increasing sequence numbers', () => {
    const a = buildLogEvent('{"a":1}');
    const b = buildLogEvent('{"a":2}');
    expect(b.seq).not.toBe(a.seq);
  });
});

describe('buildLogStreamUrl', () => {
  it('omits the grep param when grep is blank', () => {
    expect(buildLogStreamUrl('info', '')).toBe(`${LOG_STREAM_PATH}?level=info`);
  });

  it('encodes the grep param', () => {
    expect(buildLogStreamUrl('warn', 'mqtt|signal')).toBe(
      `${LOG_STREAM_PATH}?level=warn&grep=mqtt%7Csignal`,
    );
  });

  it('uses the supplied base URL when provided', () => {
    expect(buildLogStreamUrl('info', '', '/api/v1/admin/logs/stream')).toBe(
      '/api/v1/admin/logs/stream?level=info',
    );
  });
});

describe('useLogStream', () => {
  function controlledFetch() {
    const ref: { ctrl?: ReadableStreamDefaultController<Uint8Array> } = {};
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ref.ctrl = c;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ) as unknown as typeof fetch;
    return {
      fetchImpl,
      push: async (chunk: string) => {
        ref.ctrl?.enqueue(encoder.encode(chunk));
        await Promise.resolve();
      },
      close: () => ref.ctrl?.close(),
    };
  }

  it('subscribes, parses log frames, and exposes them as events', async () => {
    const f = controlledFetch();
    const { result } = renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        endpoint: '/test/admin/logs/stream',
        fetchImpl: f.fetchImpl,
      }),
    );

    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await f.push(
        'event: log\ndata: {"level":"info","message":"alpha"}\n\nevent: log\ndata: {"level":"warn","message":"beta"}\n\n',
      );
      // Two flushes for the two scheduleFlush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.events.length).toBe(2));
    expect(result.current.events[0]?.parsed?.message).toBe('alpha');
    expect(result.current.events[1]?.parsed?.message).toBe('beta');
    expect(result.current.totalReceived).toBe(2);

    await act(async () => {
      f.close();
    });
  });

  it('increments drops when a drop frame arrives', async () => {
    const f = controlledFetch();
    const { result } = renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        endpoint: '/test/admin/logs/stream',
        fetchImpl: f.fetchImpl,
      }),
    );
    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());

    await act(async () => {
      await f.push('event: drop\ndata: {"count":7}\n\n');
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.drops).toBe(7));

    await act(async () => {
      f.close();
    });
  });

  it('honours pause without dropping the connection', async () => {
    const f = controlledFetch();
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) =>
        useLogStream({
          level: 'info',
          grep: '',
          paused,
          endpoint: '/test/admin/logs/stream',
          fetchImpl: f.fetchImpl,
        }),
      { initialProps: { paused: false } },
    );
    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());

    rerender({ paused: true });
    await act(async () => {
      await f.push(
        'event: log\ndata: {"level":"info","message":"silenced"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.events.length).toBe(0);

    // Connection still alive — fetch was called exactly once.
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);

    await act(async () => {
      f.close();
    });
  });

  it('restarts the subscription when filters change', async () => {
    const f = controlledFetch();
    const { rerender } = renderHook(
      ({ level }: { level: 'info' | 'warn' }) =>
        useLogStream({
          level,
          grep: '',
          endpoint: '/test/admin/logs/stream',
          fetchImpl: f.fetchImpl,
        }),
      { initialProps: { level: 'info' } },
    );
    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
    rerender({ level: 'warn' });
    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(2));

    await act(async () => {
      f.close();
    });
  });

  it('clear() empties events and resets counters', async () => {
    const f = controlledFetch();
    const { result } = renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        endpoint: '/test/admin/logs/stream',
        fetchImpl: f.fetchImpl,
      }),
    );
    await waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await f.push(
        'event: log\ndata: {"level":"info","message":"x"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.events.length).toBe(1));

    act(() => result.current.clear());
    expect(result.current.events.length).toBe(0);
    expect(result.current.totalReceived).toBe(0);
    expect(result.current.drops).toBe(0);

    await act(async () => {
      f.close();
    });
  });

  it('surfaces non-OK HTTP responses as an error and stops connecting', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        }),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        endpoint: '/test/admin/logs/stream',
        fetchImpl,
      }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isConnected).toBe(false);
  });

  it('does not subscribe when enabled=false', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        enabled: false,
        endpoint: '/test/admin/logs/stream',
        fetchImpl,
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts the fetch on unmount', async () => {
    let observedSignal: AbortSignal | undefined;
    const f = controlledFetch();
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    ) as unknown as typeof fetch;
    const { unmount } = renderHook(() =>
      useLogStream({
        level: 'info',
        grep: '',
        endpoint: '/test/admin/logs/stream',
        fetchImpl,
      }),
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(observedSignal?.aborted).toBe(false);
    unmount();
    expect(observedSignal?.aborted).toBe(true);
    f.close();
  });
});
