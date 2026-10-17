import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { request } from '../client';
import { __resetQueryBroadcastForTests } from '@/lib/queryBroadcast';
import {
  getGeofenceBulkDeleteOutcome,
  locationKeys,
  useBulkGeofencesDelete,
  useLocations,
  useVisitedLocations,
  type GeofenceBulkResult,
  type VisitedLocation,
  type VisitedLocationsParams,
} from './useLocations';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({ useMutationToast: () => toast }));
// The charging key is unrelated to the location reads/bulk delete under test.
vi.mock('./useCharging', () => ({ chargingKeys: { all: ['charging-sessions'] } }));

const mockedRequest = vi.mocked(request);
const clients: QueryClient[] = [];
const from = '2026-10-01T00:00:00.123456Z';
const to = '2026-10-14T00:00:00+02:00';
const bounded = { vehicleId: 7, page: 3, pageSize: 25, from, to } as const;
const row: VisitedLocation = {
  id: 101,
  vehicle_id: 7,
  address_name: 'Synthetic place',
  visit_count: 0,
  total_duration_s: 86400.125,
  created_at: '2026-10-01T00:00:00Z',
};

function setup() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(qc);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper: Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequest.mockReset();
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((qc) => qc.clear());
  __resetQueryBroadcastForTests();
});

describe('phase6 visited locations capability', () => {
  it('preserves the page key, exact half-open bounds, pagination, signal and raw SI', async () => {
    const payload: VisitedLocation[] = [row, { ...row, id: 102, total_duration_s: -0.25 }];
    mockedRequest.mockResolvedValueOnce(payload);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [path, options] = mockedRequest.mock.calls[0];
    const url = new URL(path, 'https://example.invalid');
    expect(url.pathname).toBe('/locations');
    expect([...url.searchParams.entries()]).toEqual([
      ['vehicle_id', '7'],
      ['limit', '25'],
      ['offset', '50'],
      ['from', from],
      ['to', to],
    ]);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(locationKeys.visited(7, 3, 25, from, to)).toEqual([
      'visited-locations', 7, 3, 25, from, to,
    ]);
    expect(qc.getQueryData(locationKeys.visited(7, 3, 25, from, to))).toEqual(payload);
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.[0].total_duration_s).toBe(86400.125);
    expect(result.current.data?.[1].total_duration_s).toBe(-0.25);
    expect(result.current.data?.[0]).not.toHaveProperty('last_visited');
    expect(result.current.data?.[0]).not.toHaveProperty('address_id');
    expect(result.current.data?.[0]).not.toHaveProperty('totalDurationS');
  });

  it('allows omitted or nullable Go pointer fields without filling them with zero', async () => {
    const nullable: VisitedLocation = { ...row, address_id: null, last_visited: null };
    mockedRequest.mockResolvedValueOnce([row, nullable]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([row, nullable]);
    expectTypeOf<VisitedLocation['address_id']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<VisitedLocation['last_visited']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<{ vehicleId: number; from: string }>().not.toExtend<VisitedLocationsParams>();
    expectTypeOf<{ vehicleId: number; to: string }>().not.toExtend<VisitedLocationsParams>();
  });

  it('uses the existing 50-row first-page defaults and omits both absent bounds', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useVisitedLocations({ vehicleId: 7 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/locations?vehicle_id=7&limit=50&offset=0');
    expect(result.current.data).toEqual([]);
    expect(qc.getQueryData(['visited-locations', 7, 1, 50, undefined, undefined])).toEqual([]);
  });

  it('does not request an all-vehicle page while the selected vehicle is unresolved', () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useVisitedLocations({ ...bounded, vehicleId: null }),
      { wrapper },
    );
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('reuses the existing page cache without mixing vehicle, page, size or either bound', async () => {
    const { qc, wrapper } = setup();
    const key = locationKeys.visited(7, 3, 25, from, to);
    qc.setQueryData(key, [row]);
    // Pending revalidation must not erase the retained matching receipt.
    mockedRequest.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    expect(result.current.data).toEqual([row]);
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    for (const other of [
      locationKeys.visited(8, 3, 25, from, to),
      locationKeys.visited(7, 4, 25, from, to),
      locationKeys.visited(7, 3, 50, from, to),
      locationKeys.visited(7, 3, 25, '2026-09-30T00:00:00Z', to),
      locationKeys.visited(7, 3, 25, from, '2026-10-15T00:00:00Z'),
    ]) {
      expect(other).not.toEqual(key);
      expect(qc.getQueryData(other)).toBeUndefined();
    }
    expect(locationKeys.all('7')).toEqual(['locations', '7']);
    expect(locationKeys.all()).toEqual(['locations', 'all']);
  });

  it('cancels the actual forwarded signal on unmount', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {}));
    const { wrapper } = setup();
    const { unmount } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const signal = mockedRequest.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('keeps pending data unknown and surfaces an initial rejection rather than successful empty', async () => {
    const failure = new Error('synthetic location read failure');
    mockedRequest.mockRejectedValueOnce(failure);
    const { wrapper } = setup();
    const { result } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it('retains a matching raw page after refresh failure without swallowing the error', async () => {
    const failure = new Error('synthetic refresh failure');
    const { qc, wrapper } = setup();
    qc.setQueryData(locationKeys.visited(7, 3, 25, from, to), [row]);
    mockedRequest.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useVisitedLocations(bounded), { wrapper });
    await waitFor(() => expect(result.current.isRefetchError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toEqual([row]);
  });

  it('preserves legacy URL encoding, key, signal and safeArray behavior', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useLocations('a b&c'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/locations?vehicle_id=a%20b%26c');
    expect(mockedRequest.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(qc.getQueryState(locationKeys.all('a b&c'))).toBeDefined();
    expect(result.current.data).toEqual([]);
  });

  it.each([undefined, ''])('preserves the legacy disabled gate for %s', (vehicleId) => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useLocations(vehicleId), { wrapper });
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('phase6 actual geofence bulk outcome', () => {
  it.each([
    { name: 'complete', ids: [1, 2], result: { deleted: 2, failed: [] }, outcome: 'complete' },
    { name: 'deduplicated request', ids: [1, 1, 2], result: { deleted: 2, failed: [] }, outcome: 'complete' },
    { name: 'partial', ids: [1, 2], result: { deleted: 1, failed: [{ id: 2, reason: 'not_found' }] }, outcome: 'partial' },
    { name: 'all failed', ids: [2], result: { deleted: 0, failed: [{ id: 2, reason: 'opaque_future_reason' }] }, outcome: 'failed' },
    { name: 'short count without failed IDs', ids: [1, 2], result: { deleted: 1, failed: [] }, outcome: 'partial' },
    { name: 'zero without failed IDs', ids: [1], result: { deleted: 0, failed: [] }, outcome: 'failed' },
  ])('classifies $name without changing the returned result or failure reasons', async ({ ids, result: payload, outcome }) => {
    const response: GeofenceBulkResult & { requested: number } = { ...payload, requested: 0 };
    mockedRequest.mockResolvedValueOnce(response);
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkGeofencesDelete(), { wrapper });
    let resolved: GeofenceBulkResult | undefined;
    await act(async () => { resolved = await result.current.mutateAsync(ids); });

    expect(resolved).toBe(response);
    expect(getGeofenceBulkDeleteOutcome(response, ids)).toBe(outcome);
    expect(mockedRequest).toHaveBeenCalledWith('/geofences/bulk', {
      method: 'POST',
      requiresLiveMode: true,
      body: JSON.stringify({ ids, op: 'delete' }),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    if (outcome === 'complete') {
      expect(toast.success).toHaveBeenCalledWith('toast.geofence.bulkDelete.success', 'Geofences deleted');
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    } else if (outcome === 'partial') {
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith(
        'toast.geofence.bulkDelete.partial',
        '{{deleted}} geofences deleted; some deletions did not complete',
        { deleted: response.deleted },
      );
      expect(toast.error).not.toHaveBeenCalled();
    } else {
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        undefined, 'toast.geofence.bulkDelete.error', 'Failed to delete geofences',
      );
    }
  });

  it('rejects transport errors and preserves the existing error feedback without invalidation', async () => {
    const failure = new Error('synthetic bulk failure');
    mockedRequest.mockRejectedValueOnce(failure);
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkGeofencesDelete(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync([1])).rejects.toBe(failure);
    });
    expect(toast.error).toHaveBeenCalledWith(
      failure, 'toast.geofence.bulkDelete.error', 'Failed to delete geofences',
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
