// useLocations hook-suite tests.
//
// Covers EVERY export of useLocations.ts:
//   - locationKeys              — stable, per-vehicle query-key factory + the
//     shared geofences tuple.
//   - useLocations              — GET /locations?vehicle_id=…, AbortSignal
//     threading, URL-encoding of the id, the enabled-gate (no fetch without a
//     vehicleId), the safeArray select guard (non-array → []), and an error path.
//   - useGeofences              — GET /geofences, signal threading, safeArray
//     guard, and an error path.
//   - GeofenceBulkResult        — exercised as the typed mutation payload so the
//     {deleted, failed[]} contract is asserted end-to-end.
//   - useBulkGeofencesDelete    — POST /geofences/bulk with the {ids, op:'delete'}
//     body, geofences-cache invalidation, and success/error toast wiring.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useLocations` as a contiguous substring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Replace the toast bridge with spies so onSuccess/onError assertions are exact
// and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

import { request } from '@/api/client';
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast';
import type { Location, Geofence } from '@/types/location';
import {
  locationKeys,
  useLocations,
  useGeofences,
  useBulkGeofencesDelete,
  type GeofenceBulkResult,
} from './useLocations';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc-1',
    addressName: 'Home',
    latitude: 37.4,
    longitude: -122.1,
    visitCount: 12,
    totalDurationS: 3_600,
    lastVisited: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeGeofence(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 'geo-1',
    name: 'Work',
    latitude: 37.5,
    longitude: -122.2,
    radius: 150,
    alertOnEntry: true,
    alertOnExit: false,
    enabled: true,
    costPerKwh: null,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

afterEach(() => {
  // Drain the coalesced cross-tab broadcast timer scheduled by
  // invalidateAndBroadcast so it can't fire after the env tears down.
  __flushQueryBroadcastForTests();
});

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('locationKeys', () => {
  it('scopes the locations key per vehicle and folds undefined to "all"', () => {
    expect(locationKeys.all('7')).toEqual(['locations', '7']);
    expect(locationKeys.all()).toEqual(['locations', 'all']);
    // Distinct vehicles must not collide in the query cache.
    expect(locationKeys.all('7')).not.toEqual(locationKeys.all('8'));
  });

  it('exposes the stable geofences tuple', () => {
    expect(locationKeys.geofences).toEqual(['geofences']);
    expect(locationKeys.geofences).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// useLocations (query)
// ---------------------------------------------------------------------------

describe('useLocations', () => {
  it('GETs /locations?vehicle_id=…, threads the abort signal, and returns the payload', async () => {
    const payload = [makeLocation({ id: 'a' }), makeLocation({ id: 'b' })];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocations('7'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(payload);
    expect(result.current.data).toHaveLength(2);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/locations?vehicle_id=7');
    // No double-prefix — the request() client adds /api/v1 itself.
    expect(url).not.toContain('/api/v1');
    // TanStack Query hands the queryFn an AbortSignal so route changes cancel
    // the in-flight fetch; the hook must forward it to request().
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('URL-encodes the vehicle id so a value with reserved chars stays a single param', async () => {
    mockedRequest.mockResolvedValueOnce([]);

    const { Wrapper } = makeWrapper();
    renderHook(() => useLocations('a b&c'), { wrapper: Wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/locations?vehicle_id=a%20b%26c');
  });

  it('coerces a non-array response to [] via the safeArray select guard', async () => {
    // Backend returns null when the vehicle has no visited locations yet;
    // consumers iterate the result with .map/.length, so it must never be null.
    mockedRequest.mockResolvedValueOnce(null);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocations('7'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('is disabled (no fetch) when vehicleId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocations(undefined), { wrapper: Wrapper });

    // Give the query a tick — it must not fire while gated off.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when vehicleId is the empty string', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useLocations(''), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces a request rejection as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('locations 500'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocations('7'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useGeofences (query)
// ---------------------------------------------------------------------------

describe('useGeofences', () => {
  it('GETs /geofences, threads the abort signal, and returns the payload', async () => {
    const payload = [makeGeofence({ id: 'g1' }), makeGeofence({ id: 'g2' })];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofences(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(payload);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('coerces a non-array response to [] via the safeArray select guard', async () => {
    // A malformed non-array body (e.g. an error envelope leaking through) must
    // still resolve to an array so consumers can .map/.length it safely.
    mockedRequest.mockResolvedValueOnce({ error: 'unexpected shape' });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofences(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces a request rejection as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('geofences boom'));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofences(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useBulkGeofencesDelete (mutation)
// ---------------------------------------------------------------------------

describe('useBulkGeofencesDelete', () => {
  it('POSTs {ids, op:"delete"} to /geofences/bulk, invalidates the list, and toasts success', async () => {
    const bulkResult: GeofenceBulkResult = {
      deleted: 2,
      failed: [{ id: 9, reason: 'not found' }],
    };
    mockedRequest.mockResolvedValueOnce(bulkResult);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkGeofencesDelete(), { wrapper: Wrapper });

    const resolved = await result.current.mutateAsync([1, 2, 9]);

    // The typed GeofenceBulkResult contract passes through untouched.
    expect(resolved).toEqual(bulkResult);
    expect(resolved.deleted).toBe(2);
    expect(resolved.failed).toEqual([{ id: 9, reason: 'not found' }]);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/bulk');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ ids: [1, 2, 9], op: 'delete' });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(successToast).toHaveBeenCalledWith(
      'toast.geofence.bulkDelete.success',
      'Geofences deleted',
    );
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('toasts the error and rejects (no invalidation) when the POST fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('bulk delete boom'));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkGeofencesDelete(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync([1])).rejects.toThrow('bulk delete boom');

    expect(errorToast).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.geofence.bulkDelete.error',
      'Failed to delete geofences',
    );
    expect(successToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
