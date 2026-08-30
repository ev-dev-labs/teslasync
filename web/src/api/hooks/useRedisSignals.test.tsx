// useRedisSignals hook-layer tests.
//
// useRedisSignals.ts is the Redis L2 signal-cache TanStack Query surface
// behind the Redis Signal Viewer admin page: a per-vehicle read
// (optionally polling at the realtime interval), a single-vehicle purge
// mutation, and a bounded whole-keyspace purge mutation. All three wrap
// the typed helpers in @/api/devtools, which target the un-prefixed,
// snake_case /dev-tools/redis-signals routes.
//
// These tests exercise the contract each export exposes — the exact
// request path (NO /api/v1 prefix, snake_case vehicle_id query param),
// the DELETE verbs on the purges, the enabled guard (null AND defensive
// non-positive/non-integer ids stay disabled so a malformed
// ?vehicle_id=NaN request is never issued), the realtime refetch-interval
// branch, and the success/error surfacing — without standing up the whole
// viewer page.
//
// We mock @/api/client's request() (the real network boundary): the real
// devtools wrappers still run, so the asserted URL/method IS the wire
// contract the backend router must satisfy.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useRedisSignals` as a contiguous path substring, which a
// __tests__/ subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { ApiError, request } from '@/api/client';
import { INTERVALS } from '@/lib/constants';
import {
  redisSignalKeys,
  isQueryableVehicleId,
  redisSignalsQueryOptions,
  useRedisSignals,
  usePurgeRedisSignals,
  usePurgeAllRedisSignals,
} from './useRedisSignals';
import type {
  RedisSignalsResponse,
  RedisSignalsPurgeResponse,
  RedisSignalsPurgeAllResponse,
} from '@/api/devtools';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/**
 * Fresh QueryClient + provider per test (retries off, gcTime 0) so error
 * paths resolve on the first rejection and no cache leaks between tests.
 */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper };
}

/** Reads back the [path, options] pair from the Nth request() call. */
function callArgs(n = 0): [
  string,
  { method?: string; requiresLiveMode?: boolean },
] {
  return mockedRequest.mock.calls[n] as [
    string,
    { method?: string; requiresLiveMode?: boolean },
  ];
}

const signalsPayload: RedisSignalsResponse = {
  vehicle_id: 7,
  signal_count: 2,
  signals: {
    Soc: { value: 82, type: 'number' },
    Gear: { value: 'D', type: 'string' },
  },
  meta: {
    live_signal_store_mode: 'hybrid',
    redis_key: 'vehicle:7:signals',
    redis_field_count: 2,
    l1_signal_count: 2,
    l1_last_seen_at: '2025-06-01T00:00:00Z',
    l2_last_seen_at: '2025-06-01T00:00:05Z',
    vehicle_vin: '5YJ3E1EA7KF000007',
  },
};

const purgeOnePayload: RedisSignalsPurgeResponse = {
  vehicle_id: 7,
  purged: true,
};

const purgeAllPayload: RedisSignalsPurgeAllResponse = {
  purged: 3,
  scanned: 3,
  limit: 100,
  has_more: false,
};

beforeEach(() => {
  mockedRequest.mockReset();
});

// ---------------------------------------------------------------------------
// redisSignalKeys — the query-key factory the page invalidates against
// ---------------------------------------------------------------------------

describe('redisSignalKeys', () => {
  it('produces stable tuples for the read, its per-vehicle detail, and the keys list', () => {
    expect(redisSignalKeys.all).toEqual(['redis-signals']);
    expect(redisSignalKeys.detail(7)).toEqual(['redis-signals', 7]);
    expect(redisSignalKeys.detail(null)).toEqual(['redis-signals', null]);
    expect(redisSignalKeys.keys).toEqual(['redis-signal-keys']);
  });

  it('keeps detail() a prefix of all so a broad invalidate sweeps every vehicle', () => {
    // The page purge-all path invalidates ['redis-signals'] and relies on it
    // matching every ['redis-signals', <id>] detail key.
    expect(redisSignalKeys.detail(7).slice(0, 1)).toEqual(redisSignalKeys.all);
  });
});

// ---------------------------------------------------------------------------
// isQueryableVehicleId — the guard that gates the read
// ---------------------------------------------------------------------------

describe('isQueryableVehicleId', () => {
  it('accepts real, positive, whole vehicle ids', () => {
    expect(isQueryableVehicleId(1)).toBe(true);
    expect(isQueryableVehicleId(7)).toBe(true);
    expect(isQueryableVehicleId(999_999)).toBe(true);
  });

  it('rejects null, zero, negative, fractional, and non-finite ids', () => {
    expect(isQueryableVehicleId(null)).toBe(false);
    expect(isQueryableVehicleId(0)).toBe(false);
    expect(isQueryableVehicleId(-3)).toBe(false);
    expect(isQueryableVehicleId(2.5)).toBe(false);
    expect(isQueryableVehicleId(Number.NaN)).toBe(false);
    expect(isQueryableVehicleId(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// redisSignalsQueryOptions — the pure config builder
// ---------------------------------------------------------------------------

describe('redisSignalsQueryOptions', () => {
  it('enables the read only for a queryable id and keys the cache by vehicle', () => {
    expect(redisSignalsQueryOptions(7, false).enabled).toBe(true);
    expect(redisSignalsQueryOptions(null, false).enabled).toBe(false);
    expect(redisSignalsQueryOptions(0, false).enabled).toBe(false);
    expect(redisSignalsQueryOptions(7, false).queryKey).toEqual(['redis-signals', 7]);
  });

  it('polls at the realtime interval only while autoRefresh is on', () => {
    expect(redisSignalsQueryOptions(7, true).refetchInterval).toBe(INTERVALS.REALTIME);
    expect(redisSignalsQueryOptions(7, false).refetchInterval).toBe(false);
  });

  it('wires queryFn to the snake_case, un-prefixed devtools route', async () => {
    mockedRequest.mockResolvedValueOnce(signalsPayload);
    const opts = redisSignalsQueryOptions(7, false);

    await opts.queryFn();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(callArgs()[0]).toBe('/dev-tools/redis-signals?vehicle_id=7');
  });
});

// ---------------------------------------------------------------------------
// useRedisSignals — the read hook
// ---------------------------------------------------------------------------

describe('useRedisSignals', () => {
  it('GETs the vehicle HSET (no /api/v1 prefix) and surfaces signals + meta', async () => {
    mockedRequest.mockResolvedValueOnce(signalsPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedisSignals(7, false), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/dev-tools/redis-signals?vehicle_id=7');
    expect(result.current.data?.signal_count).toBe(2);
    expect(result.current.data?.signals.Soc?.value).toBe(82);
    expect(result.current.data?.meta?.redis_key).toBe('vehicle:7:signals');
  });

  it('stays idle (disabled) when no vehicle is selected', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedisSignals(null, false), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('refuses to fetch a non-positive id — a 0/NaN would produce a malformed ?vehicle_id request', async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useRedisSignals(0, true), { wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces a request failure as isError with the ApiError intact', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('redis unavailable', 503));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedisSignals(7, false), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// usePurgeRedisSignals — single-vehicle purge mutation
// ---------------------------------------------------------------------------

describe('usePurgeRedisSignals', () => {
  it('DELETEs the single-vehicle HSET and resolves with the purge receipt', async () => {
    mockedRequest.mockResolvedValueOnce(purgeOnePayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePurgeRedisSignals(), { wrapper });

    let res: RedisSignalsPurgeResponse | undefined;
    await act(async () => {
      res = await result.current.mutateAsync(7);
    });

    const [url, opts] = callArgs();
    expect(url).toBe('/dev-tools/redis-signals?vehicle_id=7');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(res).toEqual(purgeOnePayload);
  });

  it('rejects (so the page can toast) when the purge request fails', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('boom', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePurgeRedisSignals(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(7)).rejects.toThrow('boom');
    });
    expect(result.current.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// usePurgeAllRedisSignals — bounded whole-keyspace purge mutation
// ---------------------------------------------------------------------------

describe('usePurgeAllRedisSignals', () => {
  it('DELETEs the whole keyspace and returns the bounded sweep summary', async () => {
    mockedRequest.mockResolvedValueOnce(purgeAllPayload);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePurgeAllRedisSignals(), { wrapper });

    let res: RedisSignalsPurgeAllResponse | undefined;
    await act(async () => {
      res = await result.current.mutateAsync();
    });

    const [url, opts] = callArgs();
    expect(url).toBe('/dev-tools/redis-signals/keys');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(res?.purged).toBe(3);
    expect(res?.has_more).toBe(false);
  });

  it('propagates a sweep failure to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('scan failed', 500));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePurgeAllRedisSignals(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeInstanceOf(ApiError);
    });
  });
});
