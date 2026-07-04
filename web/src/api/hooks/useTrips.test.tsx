// useTrips hook-family coverage.
//
// Exercises EVERY export of api/hooks/useTrips.ts through its public surface:
//   - tripKeys  — the stable, hierarchical cache-key tuples used for
//                 invalidation (list vs per-id detail).
//   - useTrips  — GET /trips: request shaping (snake_case query params, the
//                 zero/negative-window guards, the falsy vehicle_id drop),
//                 AbortSignal threading, the safeArray normalisation that stops
//                 a Go `nil` slice (JSON `null`) or a non-array body from
//                 crashing a downstream `.map`, and the failure path.
//   - useTrip   — GET /trips/{id}: the detail-with-drives pass-through, the
//                 encodeURIComponent hardening that keeps a path-unsafe id from
//                 escaping the route segment, the `enabled:false` gate for an
//                 empty id, and the 404 → ApiError channel.
//
// Network is mocked at the `request` boundary — the repo convention (see
// useExports.test.tsx / useSystem.test.tsx). `safeArray` is left REAL so the
// normalisation is proven end-to-end rather than stubbed.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Keep the real client exports and swap only the HTTP entry point for a spy.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import { tripKeys, useTrips, useTrip } from './useTrips';
import type { Trip, TripDetail } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Convenience: fresh client per render so cache never bleeds across tests. */
function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: wrapperFor(makeClient()) });
}

const sampleTrip: Trip = {
  id: 1,
  vehicle_id: 3,
  name: 'Road trip',
  start_date: '2025-01-01',
  end_date: '2025-01-02',
  started_at: '2025-01-01T08:00:00Z',
  ended_at: '2025-01-02T18:00:00Z',
  total_distance_m: 120000,
  total_energy_wh: 25000,
  total_duration_s: 36000,
  total_cost: 12.5,
  drive_count: 4,
  charge_count: 1,
  created_at: '2025-01-02T18:05:00Z',
};

const sampleDetail: TripDetail = {
  ...sampleTrip,
  energy_used_wh: 25000,
  drives: [
    {
      id: 10,
      started_at: '2025-01-01T08:00:00Z',
      ended_at: '2025-01-01T10:00:00Z',
      distance_m: 60000,
      energy_used_wh: 12000,
      duration_s: 7200,
      start_place: 'Home',
      end_place: 'Lake',
    },
  ],
};

/** First positional arg of the most recent request() call = the fetched path. */
function lastUrl(): string {
  return mockedRequest.mock.calls.at(-1)?.[0] as string;
}
/** Second positional arg of the most recent request() call = fetch options. */
function lastOpts(): { signal?: unknown } {
  return mockedRequest.mock.calls.at(-1)?.[1] as { signal?: unknown };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tripKeys', () => {
  it('exposes a stable, identity-free list tuple', () => {
    expect(tripKeys.all).toEqual(['trips']);
  });

  it('namespaces the detail key under the list root by id', () => {
    expect(tripKeys.detail('42')).toEqual(['trips', '42']);
    // Distinct ids must produce distinct keys so two detail panels don't
    // share a cache entry.
    expect(tripKeys.detail('7')).not.toEqual(tripKeys.detail('8'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTrips', () => {
  it('GETs /trips with no query string when called without params', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    const { result } = render(() => useTrips());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toBe('/trips');
    expect(result.current.data).toEqual([sampleTrip]);
  });

  it('threads an AbortSignal so a route change cancels the in-flight fetch', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    const { result } = render(() => useTrips());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // resilience.ts pattern: TanStack Query's queryFn `{ signal }` is forwarded
    // so an unmount aborts the request instead of decoding into dead state.
    expect(lastOpts()).toHaveProperty('signal');
    expect(lastOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it('serialises params as snake_case query in insertion order', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    render(() =>
      useTrips({ vehicle_id: 3, limit: 20, offset: 40, start: '2025-01-01', end: '2025-12-31' }),
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/trips?vehicle_id=3&limit=20&offset=40&start=2025-01-01&end=2025-12-31');
  });

  it('omits offset on the first page (offset === 0)', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    render(() => useTrips({ limit: 50, offset: 0 }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/trips?limit=50');
    expect(lastUrl()).not.toContain('offset');
  });

  it('drops a non-positive limit rather than sending limit=0 or a negative window', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    render(() => useTrips({ limit: 0 }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/trips');
  });

  it('drops a negative limit AND a negative offset (defensive against bad URL state)', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    render(() => useTrips({ limit: -5, offset: -10 }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/trips');
  });

  it('drops a falsy vehicle_id (0 is never a valid primary key)', async () => {
    mockedRequest.mockResolvedValueOnce([sampleTrip]);
    render(() => useTrips({ vehicle_id: 0, limit: 10 }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/trips?limit=10');
    expect(lastUrl()).not.toContain('vehicle_id');
  });

  it('normalises a Go nil slice (JSON null) to [] via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { result } = render(() => useTrips());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('normalises a non-array object body to [] via safeArray', async () => {
    mockedRequest.mockResolvedValueOnce({ not: 'an array' });
    const { result } = render(() => useTrips());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces request failures through the isError channel', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { result } = render(() => useTrips());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('boom');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useTrip', () => {
  it('GETs /trips/{id} and returns the detail with its per-drive breakdown', async () => {
    mockedRequest.mockResolvedValueOnce(sampleDetail);
    const { result } = render(() => useTrip('1'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/trips/1');
    expect(lastOpts()).toHaveProperty('signal');
    expect(result.current.data?.drives).toHaveLength(1);
    expect(result.current.data?.drives[0].start_place).toBe('Home');
    expect(result.current.data?.energy_used_wh).toBe(25000);
  });

  it('is disabled for an empty id and never fires a request', async () => {
    const { result } = render(() => useTrip(''));

    // Give React Query a tick — a disabled query must stay idle, not fetch.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('encodes a path-unsafe id so it cannot escape the route segment', async () => {
    mockedRequest.mockResolvedValueOnce(sampleDetail);
    render(() => useTrip('a/b 7'));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // Without encoding, `a/b 7` would break out to `/trips/a/b 7` and hit the
    // wrong route; encodeURIComponent keeps it a single opaque segment.
    expect(lastUrl()).toBe('/trips/a%2Fb%207');
  });

  it('surfaces a 404 for a missing trip through the ApiError channel', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('trip not found', 404, 'NOT_FOUND'));
    const { result } = render(() => useTrip('999'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
  });
});
