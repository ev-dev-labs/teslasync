/**
 * Server-derived Fleet Posture summary — wire mapping.
 *
 * The summary is the panel's first paint, so what is pinned here is that the
 * client TRANSPORTS the server's answer rather than re-deriving one:
 *
 *   - snake_case wire keys map onto the render-ready camelCase shape;
 *   - instants become epoch ms (never strings, never NaN, never "now");
 *   - a chunked fleet still has ONE posture (counts add, instants min/max);
 *   - a response with no summary yields `null`, not a fabricated zeroed
 *     object — "we have not asked yet" must never render as "nothing is
 *     verified";
 *   - a transport failure publishes NO summary, because the posture would
 *     otherwise silently describe a page we could not read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const requestMock = vi.fn();
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));
vi.mock('@/hooks/useRefreshInterval', () => ({
  useRefreshInterval: () => false,
  INTERVALS: { STANDARD: 30_000, LIVE: 5_000, SLOW: 60_000 },
}));
vi.mock('@/hooks/useRealtimeEvents', () => ({ useRealtimeEvents: () => undefined }));
vi.mock('@/hooks/useLiveRecovery', () => ({ useLiveRecovery: () => undefined }));

import { fetchFleetStates, useFleetStates } from './useVehicles';
import type { Vehicle } from '@/types/vehicle';

const NOW = '2026-08-27T12:00:00.000Z';
const OLDEST = '2026-08-27T11:30:00.000Z';
const NEWEST = '2026-08-27T11:59:55.000Z';

function makeVehicle(id: number): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: `Car ${id}`,
    state: 'online',
  } as Vehicle;
}

function wireSummary(over: Record<string, unknown> = {}) {
  return {
    counted: 4,
    verified_count: 2,
    attention_count: 2,
    operational: { charging: 1, driving: 0, parked: 1, asleep: 0, online: 0, offline: 0, other: 0 },
    attention: { unverified: 1, stale: 0, unknown: 0, missing: 1, failed: 0 },
    oldest_observed_at: OLDEST,
    newest_observed_at: NEWEST,
    observed_count: 3,
    ...over,
  };
}

function batchBody(items: unknown[], summary: unknown = wireSummary()) {
  return {
    data: {
      now: NOW,
      total: items.length,
      limit: 500,
      offset: 0,
      counts: { resolved: items.length, missing: 0, failed: 0 },
      summary,
      vehicles: items,
    },
  };
}

function resolvedItem(id: number) {
  return {
    vehicle_id: id,
    outcome: 'resolved',
    state: { vehicle_id: id, state: 'parked' },
    live: true,
    data_source: 'live_signal_store',
    observed_at: NEWEST,
    freshness: 'fresh',
    verified_fields: ['state'],
  };
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  requestMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchFleetStates — server summary mapping', () => {
  it('maps every snake_case field onto the render-ready shape', async () => {
    requestMock.mockResolvedValue(batchBody([resolvedItem(1)]));

    const batch = await fetchFleetStates([1]);

    expect(batch.summary).toEqual({
      counted: 4,
      verifiedCount: 2,
      attentionCount: 2,
      operational: { charging: 1, driving: 0, parked: 1, asleep: 0, online: 0, offline: 0, other: 0 },
      attention: { unverified: 1, stale: 0, unknown: 0, missing: 1, failed: 0 },
      oldestObservedAt: Date.parse(OLDEST),
      newestObservedAt: Date.parse(NEWEST),
      observedCount: 3,
    });
  });

  it('turns absent observation instants into null rather than NaN or now', async () => {
    requestMock.mockResolvedValue(batchBody(
      [resolvedItem(1)],
      wireSummary({ oldest_observed_at: null, newest_observed_at: 'not-a-date', observed_count: 0 }),
    ));

    const batch = await fetchFleetStates([1]);

    expect(batch.summary?.oldestObservedAt).toBeNull();
    expect(batch.summary?.newestObservedAt).toBeNull();
    expect(batch.summary?.observedCount).toBe(0);
  });

  it('defaults every missing count to zero without inventing coverage', async () => {
    requestMock.mockResolvedValue(batchBody([resolvedItem(1)], { counted: 1 }));

    const batch = await fetchFleetStates([1]);

    expect(batch.summary).toEqual({
      counted: 1,
      verifiedCount: 0,
      attentionCount: 0,
      operational: { charging: 0, driving: 0, parked: 0, asleep: 0, online: 0, offline: 0, other: 0 },
      attention: { unverified: 0, stale: 0, unknown: 0, missing: 0, failed: 0 },
      oldestObservedAt: null,
      newestObservedAt: null,
      observedCount: 0,
    });
  });

  it('publishes no summary at all when the response carries none', async () => {
    requestMock.mockResolvedValue(batchBody([resolvedItem(1)], null));

    const batch = await fetchFleetStates([1]);

    // Null, NOT a zeroed object: a zeroed summary would render as a fleet
    // where nothing is verified.
    expect(batch.summary).toBeNull();
  });

  it('merges chunk summaries into ONE fleet posture', async () => {
    // 600 vehicles => two chunks of 500 + 100.
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    const earlier = '2026-08-27T10:00:00.000Z';
    const later = '2026-08-27T11:59:59.000Z';
    requestMock
      .mockResolvedValueOnce(batchBody([], wireSummary({
        counted: 500,
        verified_count: 400,
        attention_count: 100,
        operational: { charging: 100, driving: 50, parked: 250, asleep: 0, online: 0, offline: 0, other: 0 },
        attention: { unverified: 40, stale: 30, unknown: 10, missing: 15, failed: 5 },
        oldest_observed_at: OLDEST,
        newest_observed_at: later,
        observed_count: 480,
      })))
      .mockResolvedValueOnce(batchBody([], wireSummary({
        counted: 100,
        verified_count: 60,
        attention_count: 40,
        operational: { charging: 10, driving: 5, parked: 45, asleep: 0, online: 0, offline: 0, other: 0 },
        attention: { unverified: 20, stale: 10, unknown: 5, missing: 3, failed: 2 },
        oldest_observed_at: earlier,
        newest_observed_at: NEWEST,
        observed_count: 90,
      })));

    const batch = await fetchFleetStates(ids);

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(batch.summary?.counted).toBe(600);
    expect(batch.summary?.verifiedCount).toBe(460);
    expect(batch.summary?.attentionCount).toBe(140);
    expect(batch.summary?.operational.charging).toBe(110);
    expect(batch.summary?.attention.unverified).toBe(60);
    expect(batch.summary?.observedCount).toBe(570);
    // The fleet is only as fresh as its stalest member, and only as recent as
    // its newest one — across ALL chunks.
    expect(batch.summary?.oldestObservedAt).toBe(Date.parse(earlier));
    expect(batch.summary?.newestObservedAt).toBe(Date.parse(later));
  });
});

describe('useFleetStates — server summary', () => {
  it('publishes the summary alongside the entries', async () => {
    requestMock.mockResolvedValue(batchBody([resolvedItem(1)]));

    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.summary?.verifiedCount).toBe(2);
    expect(result.current.summary?.oldestObservedAt).toBe(Date.parse(OLDEST));
    expect(result.current.data).toHaveLength(1);
  });

  it('publishes NO summary before the first batch resolves', () => {
    requestMock.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper() });

    expect(result.current.summary).toBeNull();
  });

  it('withdraws the summary when the batch fails', async () => {
    requestMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const { result } = renderHook(() => useFleetStates([makeVehicle(1)]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // A posture for a page we could not read would age silently and lie.
    expect(result.current.summary).toBeNull();
  });
});
