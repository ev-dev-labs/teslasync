// Unit tests for `useAiStream`. Mocks `global.fetch` to return a
// ReadableStream of canned SSE bytes; exercises the parser, the
// state machine, the cancellation path, and the off-mode 404 path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import {
  useAiStream,
  parseSSEFrame,
  type AiStreamEvent,
} from '../useAiStream';

// Helper: build a ReadableStream<Uint8Array> from a list of byte
// chunks. Used to simulate a server pushing SSE frames in arbitrary
// fragments (sometimes a frame splits across chunks; the hook must
// handle the buffer correctly).
function makeReadableStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Mock fetch helper. Returns a Response whose body is a stream of
// the supplied chunks.
function mockFetchOK(chunks: Array<string>): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(makeReadableStream(chunks), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  );
}

function mockFetchStatus(status: number): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status }));
}

beforeEach(() => {
  // Each test installs its own fetch mock; default to a noop so an
  // accidentally-uninstalled fetch surfaces as a clear failure.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSSEFrame', () => {
  it('parses a delta frame', () => {
    const ev = parseSSEFrame('event: delta\ndata: {"text":"hello"}');
    expect(ev).toEqual({ type: 'delta', text: 'hello' });
  });

  it('parses a tool_call frame', () => {
    const ev = parseSSEFrame(
      'event: tool_call\ndata: {"id":"c1","name":"ping","arguments":{"x":1}}',
    );
    expect(ev).toEqual({
      type: 'tool_call',
      id: 'c1',
      name: 'ping',
      arguments: { x: 1 },
    });
  });

  it('parses a tool_result frame with data', () => {
    const ev = parseSSEFrame(
      'event: tool_result\ndata: {"id":"c1","name":"ping","ok":true,"data":{"pong":"ok"}}',
    );
    expect(ev).toMatchObject({
      type: 'tool_result',
      id: 'c1',
      name: 'ping',
      ok: true,
      data: { pong: 'ok' },
    });
  });

  it('parses a tool_result error frame', () => {
    const ev = parseSSEFrame(
      'event: tool_result\ndata: {"id":"c1","name":"ping","ok":false,"error":"boom"}',
    );
    expect(ev).toMatchObject({
      type: 'tool_result',
      id: 'c1',
      ok: false,
      error: 'boom',
    });
  });

  it('parses a confirm_request frame', () => {
    const ev = parseSSEFrame(
      'event: confirm_request\ndata: {"continuation_id":"k1","tool":"create_alert","args":{"n":"x"},"summary":"sum"}',
    );
    expect(ev).toMatchObject({
      type: 'confirm_request',
      continuation_id: 'k1',
      tool: 'create_alert',
      summary: 'sum',
    });
  });

  it('parses a done frame', () => {
    const ev = parseSSEFrame(
      'event: done\ndata: {"finish_reason":"stop","usage":{"in":10,"out":20}}',
    );
    expect(ev).toEqual({
      type: 'done',
      finish_reason: 'stop',
      usage: { in: 10, out: 20 },
    });
  });

  it('parses an error frame', () => {
    const ev = parseSSEFrame('event: error\ndata: {"message":"boom"}');
    expect(ev).toEqual({ type: 'error', message: 'boom' });
  });

  it('returns null for unknown event types', () => {
    expect(parseSSEFrame('event: weird\ndata: {}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSSEFrame('event: delta\ndata: {not json}')).toBeNull();
  });

  it('skips comment lines (leading colon)', () => {
    const ev = parseSSEFrame(': keepalive\nevent: delta\ndata: {"text":"x"}');
    expect(ev).toEqual({ type: 'delta', text: 'x' });
  });
});

describe('useAiStream — happy path', () => {
  it('accumulates delta text and transitions through states', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('delta', { text: 'The ' }),
      sseFrame('delta', { text: 'car ' }),
      sseFrame('delta', { text: 'is ready.' }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 20 } }),
    ]);

    const events: AiStreamEvent[] = [];
    const { result } = renderHook(() =>
      useAiStream({
        url: '/ai/chatbot',
        body: { messages: [] },
        onEvent: (ev) => {
          events.push(ev);
        },
      }),
    );

    expect(result.current.state).toBe('idle');

    act(() => {
      result.current.start();
    });

    // Wait for the stream to run to completion.
    await waitFor(() => expect(result.current.state).toBe('done'));

    expect(result.current.text).toBe('The car is ready.');
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ type: 'delta', text: 'The ' });
    expect(events[3]).toMatchObject({ type: 'done', finish_reason: 'stop' });
    expect(result.current.usage).toEqual({ in: 10, out: 20 });
    expect(result.current.finishReason).toBe('stop');
  });

  it('retains an ordered, privacy-safe tool activity trail', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('tool_call', {
        id: 'call-1',
        name: 'query_vehicle_state',
        arguments: { vehicle_id: 42 },
      }),
      sseFrame('tool_result', {
        id: 'call-1',
        name: 'query_vehicle_state',
        ok: true,
        data: { latitude: 45.5, longitude: -122.6 },
      }),
      sseFrame('tool_call', {
        id: 'call-2',
        name: 'query_alerts_active',
        arguments: {},
      }),
      sseFrame('tool_result', {
        id: 'call-2',
        name: 'query_alerts_active',
        ok: false,
        error: 'unavailable',
      }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 30, out: 12 } }),
    ]);

    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/chatbot', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));

    expect(result.current.activity).toEqual([
      { id: 'call-1', name: 'query_vehicle_state', status: 'succeeded' },
      { id: 'call-2', name: 'query_alerts_active', status: 'failed' },
    ]);
    expect(JSON.stringify(result.current.activity)).not.toContain('vehicle_id');
    expect(JSON.stringify(result.current.activity)).not.toContain('latitude');
  });

  it('resets activity and completion metadata for a new run', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('tool_call', { id: 'call-1', name: 'query_vehicle_state', arguments: {} }),
      sseFrame('tool_result', {
        id: 'call-1',
        name: 'query_vehicle_state',
        ok: true,
        data: {},
      }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } }),
    ]);

    const { result, rerender } = renderHook(
      ({ body }) => useAiStream({ url: '/ai/chatbot', body, onEvent: () => {} }),
      { initialProps: { body: { turn: 1 } } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(result.current.activity).toHaveLength(1);

    globalThis.fetch = mockFetchOK([
      sseFrame('done', { finish_reason: 'stop', usage: { in: 2, out: 1 } }),
    ]);
    rerender({ body: { turn: 2 } });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.usage).toEqual({ in: 2, out: 1 }));

    expect(result.current.activity).toEqual([]);
    expect(result.current.finishReason).toBe('stop');
  });

  it('handles SSE frames split across multiple network chunks', async () => {
    // Concatenate the events then split arbitrarily — the parser
    // must reassemble across the boundaries.
    const full =
      sseFrame('delta', { text: 'a' }) +
      sseFrame('delta', { text: 'b' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 0, out: 0 } });
    const half = Math.floor(full.length / 2);
    globalThis.fetch = mockFetchOK([full.slice(0, half), full.slice(half)]);

    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(result.current.text).toBe('ab');
  });

  it('moves to paused-confirm on confirm_request', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('delta', { text: 'I will ' }),
      sseFrame('confirm_request', {
        continuation_id: 'k_xyz',
        tool: 'create_alert',
        args: { name: 'speed cap' },
        summary: 'Create an alert',
      }),
    ]);

    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/chatbot', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('paused-confirm'));
    expect(result.current.text).toBe('I will ');
  });
});

describe('useAiStream — error paths', () => {
  it('surfaces a 404 (off-mode) as state=error', async () => {
    globalThis.fetch = mockFetchStatus(404);
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/chatbot', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('stream_http_404');
  });

  it('surfaces a server error event as state=error', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('tool_call', { id: 'call-1', name: 'query_vehicle_state', arguments: {} }),
      sseFrame('error', { message: 'stream_stalled' }),
    ]);
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('stream_stalled');
    expect(result.current.activity).toEqual([
      { id: 'call-1', name: 'query_vehicle_state', status: 'failed' },
    ]);
  });

  it('treats EOF without a terminal event as an incomplete stream', async () => {
    globalThis.fetch = mockFetchOK([sseFrame('delta', { text: 'partial' })]);
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toBe('stream_incomplete');
    expect(result.current.text).toBe('partial');
  });

  it('drops malformed events and continues', async () => {
    globalThis.fetch = mockFetchOK([
      'event: delta\ndata: {not json}\n\n',
      sseFrame('delta', { text: 'good' }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 0, out: 0 } }),
    ]);
    const events: AiStreamEvent[] = [];
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: (e) => events.push(e) }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(result.current.text).toBe('good');
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(1);
  });
});

describe('useAiStream — scopeKey (AI-01 entity scope identity)', () => {
  it('does not reset output when scopeKey is unchanged across rerenders', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('delta', { text: 'hello' }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    ]);
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAiStream({ url: '/ai/x', body: {}, onEvent: () => {}, scopeKey }),
      { initialProps: { scopeKey: 'vehicle-1' } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(result.current.text).toBe('hello');

    rerender({ scopeKey: 'vehicle-1' });
    expect(result.current.text).toBe('hello');
    expect(result.current.state).toBe('done');
  });

  it('aborts an in-flight stream and clears output when scopeKey changes mid-stream', async () => {
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_input, init: RequestInit | undefined) => {
      abortSignal = init?.signal ?? undefined;
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    });

    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAiStream({ url: '/ai/x', body: {}, onEvent: () => {}, scopeKey }),
      { initialProps: { scopeKey: 'vehicle-1' } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('streaming'));

    rerender({ scopeKey: 'vehicle-2' });

    expect(abortSignal?.aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(result.current.text).toBe('');
  });

  it('clears completed output (text/activity/usage/finishReason) when scopeKey changes after done', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('tool_call', { id: 'call-1', name: 'query_vehicle_state', arguments: {} }),
      sseFrame('tool_result', { id: 'call-1', name: 'query_vehicle_state', ok: true, data: {} }),
      sseFrame('delta', { text: 'vehicle A narrative' }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 5, out: 9 } }),
    ]);
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAiStream({ url: '/ai/x', body: {}, onEvent: () => {}, scopeKey }),
      { initialProps: { scopeKey: 1 } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(result.current.text).toBe('vehicle A narrative');
    expect(result.current.activity).toHaveLength(1);
    expect(result.current.usage).toEqual({ in: 5, out: 9 });
    expect(result.current.finishReason).toBe('stop');

    rerender({ scopeKey: 2 });

    expect(result.current.text).toBe('');
    expect(result.current.activity).toEqual([]);
    expect(result.current.usage).toBeNull();
    expect(result.current.finishReason).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('idle');
  });

  it('clears a terminal error/limit banner when scopeKey changes', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('error', {
        message: 'rate limited',
        reason: 'rate_limit',
        retry_after_s: 30,
        banner_level: 'warn',
        baseline_available: true,
      }),
    ]);
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAiStream({ url: '/ai/x', body: {}, onEvent: () => {}, scopeKey }),
      { initialProps: { scopeKey: 'vehicle-1' } },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.limit).not.toBeNull();

    rerender({ scopeKey: 'vehicle-2' });

    expect(result.current.limit).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe('idle');
  });

  it('treats undefined scopeKey (no entity scope) as always-unchanged, preserving legacy behaviour', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('delta', { text: 'fleet-wide answer' }),
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    ]);
    const { result, rerender } = renderHook(
      () => useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
      { initialProps: {} },
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('done'));

    rerender({});
    expect(result.current.text).toBe('fleet-wide answer');
    expect(result.current.state).toBe('done');
  });
});

describe('useAiStream — cancellation', () => {
  it('aborts the in-flight fetch on cancel()', async () => {
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_input, init: RequestInit | undefined) => {
      abortSignal = init?.signal ?? undefined;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              sseFrame('tool_call', {
                id: 'call-1',
                name: 'query_vehicle_state',
                arguments: {},
              }),
            ));
          },
        }),
        { status: 200 },
      );
    });

    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('streaming'));
    await waitFor(() => expect(result.current.activity).toEqual([
      { id: 'call-1', name: 'query_vehicle_state', status: 'running' },
    ]));

    act(() => result.current.cancel());
    expect(abortSignal?.aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    await waitFor(() => expect(result.current.activity).toEqual([
      { id: 'call-1', name: 'query_vehicle_state', status: 'failed' },
    ]));
  });

  it('aborts on unmount', async () => {
    let abortSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_input, init: RequestInit | undefined) => {
      abortSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200 },
      );
    });

    const { result, unmount } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('streaming'));

    unmount();
    expect(abortSignal?.aborted).toBe(true);
  });

  it('coalesces duplicate start() calls', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(makeReadableStream([sseFrame('done', { finish_reason: 'stop', usage: { in: 0, out: 0 } })]), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }),
    );
    act(() => {
      result.current.start();
      result.current.start();
      result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe('done'));
    // Exactly one fetch fired despite three start() calls.
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function pendingResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
  }), { status: 200 });
  return { response, controller };
}

function frame(event: string, data: unknown) {
  return new TextEncoder().encode(sseFrame(event, data));
}

describe('useAiStream — generation isolation', () => {
  it('retains new same-scope state and controller after an old genuine AbortError', async () => {
    const old = deferred<Response>();
    const current = pendingResponse();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing request signal');
      signals.push(signal);
      if (signals.length === 1) {
        signal.addEventListener('abort', () => {
          old.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }, { once: true });
        return old.promise;
      }
      return Promise.resolve(current.response);
    });
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, scopeKey: 'same', onEvent: () => {} }));
    act(() => result.current.start());
    await act(async () => {
      result.current.cancel();
      result.current.start();
    });
    const stateAfterOldAbort = result.current.state;
    act(() => result.current.cancel());
    expect({ stateAfterOldAbort, newAbortedByCancel: signals[1].aborted })
      .toEqual({ stateAfterOldAbort: 'streaming', newAbortedByCancel: true });
  });

  it('still coalesces starts after an old AbortError settles', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        init?.signal?.addEventListener('abort', () => {
          old.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }, { once: true });
        return old.promise;
      }
      return Promise.resolve(pendingResponse().response);
    });
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }));
    act(() => result.current.start());
    await act(async () => { result.current.cancel(); result.current.start(); });
    act(() => result.current.start());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a superseded delayed HTTP failure', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn(() => fetchMock.mock.calls.length === 1
      ? old.promise : Promise.resolve(pendingResponse().response));
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() =>
      useAiStream({ url: '/ai/x', body: {}, onEvent: () => {} }));
    act(() => result.current.start());
    await act(async () => { result.current.cancel(); result.current.start(); });
    await act(async () => old.resolve(new Response(null, { status: 503 })));
    expect({ state: result.current.state, error: result.current.error })
      .toEqual({ state: 'streaming', error: null });
  });

  it.each(['done', 'error', 'confirm_request'] as const)(
    'ignores superseded delayed reader %s events and latest callback delivery',
    async (terminal) => {
      const old = pendingResponse();
      const newer = pendingResponse();
      const fetchMock = vi.fn(async () =>
        fetchMock.mock.calls.length === 1 ? old.response : newer.response);
      globalThis.fetch = fetchMock;
      const oldEvents: AiStreamEvent[] = [];
      const latestEvents: AiStreamEvent[] = [];
      const { result, rerender } = renderHook(
        ({ onEvent }) => useAiStream({ url: '/ai/x', body: {}, scopeKey: 'same', onEvent }),
        { initialProps: { onEvent: (event: AiStreamEvent) => { oldEvents.push(event); } } });
      await act(async () => result.current.start());
      act(() => result.current.cancel());
      rerender({ onEvent: (event: AiStreamEvent) => { latestEvents.push(event); } });
      await act(async () => result.current.start());
      const data = terminal === 'done'
        ? { finish_reason: 'obsolete', usage: { in: 91, out: 92 } }
        : terminal === 'error'
          ? { message: 'obsolete', reason: 'rate_limit', retry_after_s: 91 }
          : { continuation_id: 'obsolete', tool: 'ping', args: {}, summary: 'obsolete' };
      await act(async () => {
        old.controller.enqueue(frame('delta', { text: 'obsolete' }));
        old.controller.enqueue(frame(terminal, data));
        old.controller.close();
      });
      expect({
        state: result.current.state, text: result.current.text,
        usage: result.current.usage, error: result.current.error,
        limit: result.current.limit, latestEvents: latestEvents.length,
      }).toEqual({
        state: 'streaming', text: '', usage: null, error: null, limit: null, latestEvents: 0,
      });
      expect(oldEvents).toEqual([]);
      expect(result.current.activity).toEqual([]);
      expect(result.current.finishReason).toBeNull();
    },
  );

  it('retains new scope state after old scope AbortError', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        init?.signal?.addEventListener('abort', () => {
          old.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }, { once: true });
        return old.promise;
      }
      return Promise.resolve(pendingResponse().response);
    });
    globalThis.fetch = fetchMock;
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAiStream({ url: '/ai/x', body: {}, scopeKey, onEvent: () => {} }),
      { initialProps: { scopeKey: 'old' } });
    act(() => result.current.start());
    rerender({ scopeKey: 'new' });
    await act(async () => result.current.start());
    expect(result.current.state).toBe('streaming');
  });

  it('stops state updates and remaining buffered events after callback cancellation', async () => {
    globalThis.fetch = mockFetchOK([
      sseFrame('delta', { text: 'obsolete' })
      + sseFrame('done', { finish_reason: 'obsolete', usage: { in: 1, out: 2 } }),
    ]);
    const events: AiStreamEvent[] = [];
    const { result } = renderHook(() => useAiStream({
      url: '/ai/x',
      onEvent: (event) => {
        events.push(event);
        result.current.cancel();
      },
    }));
    await act(async () => result.current.start());
    expect(events).toEqual([{ type: 'delta', text: 'obsolete' }]);
    expect(result.current.state).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.usage).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it.each(['cancel', 'unmount'] as const)('suppresses late final fragments after %s without restart', async (action) => {
    const stream = pendingResponse();
    globalThis.fetch = vi.fn(async () => stream.response);
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() => useAiStream({ url: '/ai/x', onEvent }));
    await act(async () => result.current.start());
    if (action === 'cancel') act(() => result.current.cancel());
    else unmount();
    await act(async () => {
      stream.controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"obsolete"}'));
      stream.controller.close();
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(result.current.text).toBe('');
    if (action === 'cancel') {
      expect(result.current.state).toBe('idle');
      expect(result.current.error).toBeNull();
    }
  });

  it('ignores old network errors while retaining current failures and manual retry', async () => {
    const old = deferred<Response>();
    const current = deferred<Response>();
    const fetchMock = vi.fn(() => fetchMock.mock.calls.length === 1 ? old.promise : current.promise);
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() => useAiStream({ url: '/ai/x', onEvent: () => {} }));
    act(() => result.current.start());
    await act(async () => { result.current.cancel(); result.current.start(); });
    await act(async () => old.reject(new Error('obsolete')));
    expect(result.current.state).toBe('streaming');
    expect(result.current.error).toBeNull();
    await act(async () => current.reject(new Error('network unavailable')));
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('network unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => result.current.start());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps new activity and latest callback while ignoring old tool events and EOF', async () => {
    const old = pendingResponse();
    const current = pendingResponse();
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? old.response : current.response);
    globalThis.fetch = fetchMock;
    const latest = vi.fn();
    const previous = vi.fn();
    const { result, rerender } = renderHook(
      ({ onEvent }) => useAiStream({ url: '/ai/x', onEvent }),
      { initialProps: { onEvent: previous } },
    );
    await act(async () => result.current.start());
    act(() => result.current.cancel());
    await act(async () => result.current.start());
    rerender({ onEvent: latest });
    await act(async () => {
      current.controller.enqueue(frame('tool_call', { id: 'new', name: 'ping', arguments: {} }));
      old.controller.enqueue(frame('tool_call', { id: 'old', name: 'ping', arguments: {} }));
      old.controller.enqueue(frame('tool_result', { id: 'new', name: 'ping', ok: false }));
      old.controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"obsolete"}'));
      old.controller.close();
    });
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('streaming');
    expect(result.current.error).toBeNull();
    expect(result.current.text).toBe('');
    expect(result.current.activity).toEqual([{ id: 'new', name: 'ping', status: 'running' }]);
    await act(async () => {
      current.controller.enqueue(frame('error', {
        message: 'current limit', reason: 'rate_limit', retry_after_s: 3,
        banner_level: 'warn', baseline_available: false,
      }));
      current.controller.close();
    });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('error');
    expect(result.current.limit).toEqual({
      message: 'current limit', reason: 'rate_limit', retryAfterS: 3,
      bannerLevel: 'warn', baselineAvailable: false,
    });
    expect(result.current.activity).toEqual([{ id: 'new', name: 'ping', status: 'failed' }]);
  });

  it('finalizes a current genuine AbortError without treating it as a network failure', async () => {
    const current = pendingResponse();
    globalThis.fetch = vi.fn(async () => current.response);
    const { result } = renderHook(() => useAiStream({ url: '/ai/x', onEvent: () => {} }));
    await act(async () => result.current.start());
    await act(async () => {
      current.controller.enqueue(frame('tool_call', { id: 'current', name: 'ping', arguments: {} }));
    });
    await act(async () => {
      current.controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.activity).toEqual([{ id: 'current', name: 'ping', status: 'failed' }]);
    globalThis.fetch = mockFetchOK([
      sseFrame('done', { finish_reason: 'stop', usage: { in: 0, out: 0 } }),
    ]);
    await act(async () => result.current.start());
    expect(result.current.state).toBe('done');
  });

  it('does not fail new running activity when an obsolete reader rejects with AbortError', async () => {
    const old = pendingResponse();
    const current = pendingResponse();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (!init?.signal) throw new Error('Missing request signal');
      signals.push(init.signal);
      return fetchMock.mock.calls.length === 1 ? old.response : current.response;
    });
    globalThis.fetch = fetchMock;
    const { result } = renderHook(() => useAiStream({ url: '/ai/x', onEvent: () => {} }));
    await act(async () => result.current.start());
    act(() => result.current.cancel());
    await act(async () => result.current.start());
    await act(async () => {
      current.controller.enqueue(frame('tool_call', { id: 'current', name: 'ping', arguments: {} }));
    });
    await act(async () => {
      old.controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
    expect(result.current.state).toBe('streaming');
    expect(result.current.error).toBeNull();
    expect(result.current.activity).toEqual([{ id: 'current', name: 'ping', status: 'running' }]);
    act(() => result.current.start());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => result.current.cancel());
    expect(signals[1].aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(result.current.activity).toEqual([{ id: 'current', name: 'ping', status: 'failed' }]);
  });
});
