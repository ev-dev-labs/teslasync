/**
 * useApiHealth unit tests.
 *
 * Covers every export of the footer API-health hook:
 *   - `bucket()` classifies a ProbeResult into ok / degraded / offline and
 *     honours the exact DEGRADED_LATENCY_MS boundary.
 *   - `probe()` measures a real /healthz round-trip: it reports ok/offline
 *     from `res.ok`, swallows genuine network errors as `offline`, aborts
 *     after PROBE_TIMEOUT_MS, builds the URL from getApiBase(), and — the
 *     key correctness guarantee — RE-THROWS a caller-initiated cancellation
 *     instead of masquerading it as an outage.
 *   - `useApiHealth()` starts `unknown`, then surfaces ok/offline/degraded
 *     from the polled probe and returns a referentially stable object while
 *     the reading is unchanged.
 *
 * Network is always mocked (vi.stubGlobal('fetch', …)) — no real requests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  bucket,
  probe,
  useApiHealth,
  DEGRADED_LATENCY_MS,
  PROBE_TIMEOUT_MS,
  type ProbeResult,
} from './useApiHealth';

const okResponse = { ok: true } as unknown as Response;
const badResponse = { ok: false } as unknown as Response;

const mkResult = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  ok: true,
  latencyMs: 100,
  checkedAt: '2026-07-04T00:00:00.000Z',
  ...over,
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bucket', () => {
  it('maps a non-ok probe to offline regardless of latency', () => {
    expect(bucket(mkResult({ ok: false, latencyMs: 5 }))).toBe('offline');
    expect(bucket(mkResult({ ok: false, latencyMs: 9_999 }))).toBe('offline');
  });

  it('maps a fast 2xx probe (below the threshold) to ok', () => {
    expect(bucket(mkResult({ ok: true, latencyMs: 0 }))).toBe('ok');
    expect(bucket(mkResult({ ok: true, latencyMs: DEGRADED_LATENCY_MS - 1 }))).toBe('ok');
  });

  it('treats the exact DEGRADED_LATENCY_MS boundary as degraded', () => {
    expect(bucket(mkResult({ ok: true, latencyMs: DEGRADED_LATENCY_MS }))).toBe('degraded');
    expect(bucket(mkResult({ ok: true, latencyMs: 3_000 }))).toBe('degraded');
  });
});

describe('probe', () => {
  it('reports ok for a 2xx response and records a valid ISO timestamp + numeric latency', async () => {
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await probe();

    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });

  it('reports offline (ok:false) for a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => badResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await probe();

    expect(result.ok).toBe(false);
    expect(bucket(result)).toBe('offline');
  });

  it('swallows a genuine network error as offline when the caller did not cancel', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    // A live but non-aborted signal must still resolve to offline, not throw.
    const controller = new AbortController();
    const result = await probe(controller.signal);

    expect(result.ok).toBe(false);
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });

  it('re-throws a caller-initiated cancellation instead of reporting offline', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort();

    await expect(probe(controller.signal)).rejects.toBe(abortErr);
  });

  it('builds the probe URL from getApiBase() with no-store + credentialed GET', async () => {
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);

    await probe();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/healthz'),
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('honours a configured API base when building the probe URL', async () => {
    const prev = window.__TESLASYNC_API_BASE__;
    window.__TESLASYNC_API_BASE__ = 'https://api.example.test';
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await probe();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.test/healthz',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      window.__TESLASYNC_API_BASE__ = prev;
    }
  });

  it('reports offline when the request exceeds PROBE_TIMEOUT_MS with no response', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            );
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const pending = probe();
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useApiHealth', () => {
  it('starts unknown, then reports ok with latency + timestamp on a fast 2xx', async () => {
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(), { wrapper: makeWrapper() });

    // First synchronous read — the query has not resolved yet.
    expect(result.current).toEqual({
      status: 'unknown',
      latencyMs: null,
      lastCheckedAt: null,
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(typeof result.current.latencyMs).toBe('number');
    expect(Number.isNaN(Date.parse(result.current.lastCheckedAt ?? ''))).toBe(false);
  });

  it('reports offline when the probe fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(result.current.lastCheckedAt).not.toBeNull();
  });

  it('reports degraded when a 2xx response is slow', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += DEGRADED_LATENCY_MS + 100));
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useApiHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    expect(result.current.latencyMs).toBeGreaterThanOrEqual(DEGRADED_LATENCY_MS);
  });

  it('returns a referentially stable object while the reading is unchanged', async () => {
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(() => useApiHealth(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe('ok'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
