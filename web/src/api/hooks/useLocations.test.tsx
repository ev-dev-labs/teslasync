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
import type {
  Geofence as ApiGeofence,
  GeofenceRate,
  GeofenceRateImpactPreview,
  GeofenceRateApplyResult,
  GeofenceChargingSummary,
  GeofenceChargingActivity,
} from '@/api/types';
import {
  locationKeys,
  useLocations,
  useGeofences,
  useGeofencesFull,
  useBulkGeofencesDelete,
  useGeofenceNeedsReview,
  useGeofenceCurrentRates,
  useArchiveGeofence,
  useUnarchiveGeofence,
  useMarkGeofenceReviewed,
  useRenameGeofence,
  useUpdateGeofenceCategory,
  useGeofenceRates,
  useCreateGeofenceRate,
  useDeleteGeofenceRate,
  useGeofenceRatePreview,
  useApplyGeofenceRate,
  useGeofenceChargingSummary,
  useGeofenceChargingActivity,
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
    origin: 'manual',
    needsReview: false,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeApiGeofence(overrides: Partial<ApiGeofence> = {}): ApiGeofence {
  return {
    id: 1,
    name: 'Home',
    polygon_wkt: 'POLYGON((-122.2 37.5, -122.2 37.5, -122.2 37.5, -122.2 37.5))',
    enabled: true,
    alert_on_entry: true,
    alert_on_exit: false,
    origin: 'manual',
    needs_review: false,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    latitude: 37.5,
    longitude: -122.2,
    radius: 20,
    ...overrides,
  };
}

function makeGeofenceRate(overrides: Partial<GeofenceRate> = {}): GeofenceRate {
  return {
    id: 10,
    geofence_id: 1,
    rate_per_wh: 0.0001,
    currency: 'USD',
    effective_from: '2026-01-01T00:00:00Z',
    effective_to: null,
    created_at: '2026-01-01T00:00:00Z',
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
    expect(opts.requiresLiveMode).toBe(true);
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

// ---------------------------------------------------------------------------
// Charging Places — geofence-based charging-place pricing feature
// ---------------------------------------------------------------------------

describe('useGeofencesFull', () => {
  it('GETs /geofences (shares the useGeofences query key) and returns the canonical snake_case shape', async () => {
    const payload = [makeApiGeofence({ id: 1 }), makeApiGeofence({ id: 2, name: 'Office' })];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofencesFull(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.[0].needs_review).toBe(false);

    const [url] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences');
    expect(url).not.toContain('/api/v1');
  });

  it('coerces a non-array response to [] via the safeArray select guard', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofencesFull(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('requests archived rows explicitly when includeArchived is true', async () => {
    mockedRequest.mockResolvedValueOnce([]);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofencesFull(true), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences?include_archived=true');
  });
});

describe('useGeofenceNeedsReview', () => {
  it('GETs /geofences/needs-review and returns the provisional-place queue', async () => {
    const payload = [
      makeApiGeofence({ id: 5, origin: 'charging_discovery', needs_review: true, name: '' }),
    ];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceNeedsReview(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/needs-review');
  });

  it('coerces a non-array response to []', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceNeedsReview(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useGeofenceCurrentRates', () => {
  it('GETs /geofences/rates/current — the bulk current-rate lookup for every geofence', async () => {
    const payload = [makeGeofenceRate({ geofence_id: 1 }), makeGeofenceRate({ geofence_id: 2, id: 11 })];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceCurrentRates(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/rates/current');
  });
});

describe('useRenameGeofence', () => {
  it('PUTs the new name and invalidates place lifecycle queries', async () => {
    mockedRequest.mockResolvedValueOnce(makeApiGeofence({ id: 7, name: 'Office Charger' }));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRenameGeofence(), { wrapper: Wrapper });

    await result.current.mutateAsync({ geofenceId: 7, name: 'Office Charger' });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/7');
    expect(opts.method).toBe('PUT');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'Office Charger' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofencesNeedsReview });
    expect(successToast).toHaveBeenCalledWith(
      'toast.geofence.rename.success',
      'Place renamed',
    );
  });
});

describe('useUpdateGeofenceCategory', () => {
  it('PUTs the category and invalidates place lifecycle queries', async () => {
    mockedRequest.mockResolvedValueOnce(makeApiGeofence({ id: 7, category: 'work' }));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateGeofenceCategory(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ geofenceId: 7, category: 'work' });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/7');
    expect(opts.method).toBe('PUT');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({ category: 'work' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofencesNeedsReview });
    expect(successToast).toHaveBeenCalledWith(
      'toast.geofence.category.success',
      'Category updated',
    );
  });
});

describe('useArchiveGeofence', () => {
  it('POSTs /geofences/{id}/archive, invalidates the lifecycle caches, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(makeApiGeofence({ id: 3, archived_at: '2026-08-01T00:00:00Z' }));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useArchiveGeofence(), { wrapper: Wrapper });

    await result.current.mutateAsync(3);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/3/archive');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofencesNeedsReview });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceRatesCurrent });
    expect(successToast).toHaveBeenCalledWith('toast.geofence.archive.success', 'Place archived');
  });

  it('toasts the error and does not invalidate when the archive POST fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('archive boom'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useArchiveGeofence(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync(3)).rejects.toThrow('archive boom');
    expect(errorToast).toHaveBeenCalledWith(expect.any(Error), 'toast.geofence.archive.error', 'Failed to archive place');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useUnarchiveGeofence', () => {
  it('POSTs /geofences/{id}/unarchive, invalidates the lifecycle caches, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(makeApiGeofence({ id: 3, archived_at: null }));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useUnarchiveGeofence(), { wrapper: Wrapper });

    await result.current.mutateAsync(3);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/3/unarchive');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(successToast).toHaveBeenCalledWith('toast.geofence.unarchive.success', 'Place restored');
  });
});

describe('useMarkGeofenceReviewed', () => {
  it('POSTs /geofences/{id}/reviewed, invalidates the needs-review queue, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(makeApiGeofence({ id: 3, needs_review: false }));

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMarkGeofenceReviewed(), { wrapper: Wrapper });

    await result.current.mutateAsync(3);

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/3/reviewed');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofencesNeedsReview });
    expect(successToast).toHaveBeenCalledWith('toast.geofence.reviewed.success', 'Marked reviewed');
  });
});

describe('useGeofenceRates', () => {
  it('GETs /geofences/{id}/rates and returns every time-versioned row', async () => {
    const payload = [makeGeofenceRate({ id: 1 }), makeGeofenceRate({ id: 2, effective_from: '2025-01-01T00:00:00Z' })];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceRates(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/7/rates');
  });

  it('is disabled (no fetch) when geofenceId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceRates(undefined), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateGeofenceRate', () => {
  it('POSTs the canonical rate_per_wh body to /geofences/{id}/rates and invalidates rates + current + geofences', async () => {
    const created = makeGeofenceRate({ id: 99 });
    mockedRequest.mockResolvedValueOnce(created);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateGeofenceRate(), { wrapper: Wrapper });

    const resolved = await result.current.mutateAsync({
      geofenceId: 7,
      rate_per_wh: 0.00012,
      currency: 'USD',
      effective_from: '2026-08-27T00:00:00.000Z',
    });

    expect(resolved).toEqual(created);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/7/rates');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);
    // The body must carry rate_per_wh (SI canonical), never a *_kwh field,
    // and must NOT include geofenceId (a path param, not a body field).
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      rate_per_wh: 0.00012,
      currency: 'USD',
      effective_from: '2026-08-27T00:00:00.000Z',
    });
    expect(body).not.toHaveProperty('geofenceId');
    expect(Object.keys(body).some((k) => /kwh/i.test(k))).toBe(false);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceRates(7) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceRatesCurrent });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofences });
    expect(successToast).toHaveBeenCalledWith('toast.geofenceRate.create.success', 'Rate saved');
  });

  it('includes effective_to in the body only when provided', async () => {
    mockedRequest.mockResolvedValueOnce(makeGeofenceRate());
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateGeofenceRate(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      geofenceId: 7,
      rate_per_wh: 0.0001,
      currency: 'USD',
      effective_from: '2025-01-01T00:00:00.000Z',
      effective_to: '2026-08-27T00:00:00.000Z',
    });

    const body = JSON.parse(mockedRequest.mock.calls[0][1].body as string);
    expect(body.effective_to).toBe('2026-08-27T00:00:00.000Z');
  });

  it('toasts the error and does not invalidate when the create POST fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('create rate boom'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateGeofenceRate(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({
        geofenceId: 7,
        rate_per_wh: 0.0001,
        currency: 'USD',
        effective_from: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('create rate boom');

    expect(errorToast).toHaveBeenCalledWith(expect.any(Error), 'toast.geofenceRate.create.error', 'Failed to save rate');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useDeleteGeofenceRate', () => {
  it('DELETEs /geofences/{id}/rates/{rateId}, invalidates rates + current, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteGeofenceRate(), { wrapper: Wrapper });

    await result.current.mutateAsync({ geofenceId: 7, rateId: 99 });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/7/rates/99');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceRates(7) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceRatesCurrent });
    expect(successToast).toHaveBeenCalledWith(
      'toast.geofenceRate.delete.success',
      'Scheduled rate cancelled',
    );
  });
});

describe('useGeofenceRatePreview', () => {
  it('GETs the preview endpoint with no query string when from/to are omitted', async () => {
    const preview: GeofenceRateImpactPreview = {
      matched_sessions: 10,
      eligible_sessions: 6,
      protected_sessions: 4,
      total_energy_wh: 50_000,
      estimated_cost_decimal: 5.5,
      currency: 'USD',
    };
    mockedRequest.mockResolvedValueOnce(preview);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceRatePreview(7, 99), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(preview);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/7/rates/99/preview');
  });

  it('appends from/to as query params when narrowing the window', async () => {
    mockedRequest.mockResolvedValueOnce({
      matched_sessions: 1,
      eligible_sessions: 1,
      protected_sessions: 0,
      total_energy_wh: 1000,
      estimated_cost_decimal: 0.1,
      currency: 'USD',
    });

    const { Wrapper } = makeWrapper();
    renderHook(
      () => useGeofenceRatePreview(7, 99, { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const url = mockedRequest.mock.calls[0][0] as string;
    expect(url).toBe('/geofences/7/rates/99/preview?from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z');
  });

  it('is disabled until both geofenceId and rateId are known', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceRatePreview(7, undefined), { wrapper: Wrapper });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useApplyGeofenceRate', () => {
  it('POSTs the apply endpoint and invalidates this place\'s summary/activity AND the global charging-sessions cache', async () => {
    const applyResult: GeofenceRateApplyResult = {
      geofence_id: 7,
      rate_id: 99,
      matched_sessions: 10,
      priced_sessions: 6,
      skipped_sessions: 4,
      total_energy_wh: 55_000,
      total_cost_decimal: 5.5,
      currency: 'USD',
    };
    mockedRequest.mockResolvedValueOnce(applyResult);

    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useApplyGeofenceRate(), { wrapper: Wrapper });

    const resolved = await result.current.mutateAsync({ geofenceId: 7, rateId: 99 });

    expect(resolved).toEqual(applyResult);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/geofences/7/rates/99/apply');
    expect(opts.method).toBe('POST');
    expect(opts.requiresLiveMode).toBe(true);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['geofences', 7, 'rates', 99, 'preview'],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: locationKeys.geofenceChargingSummary(7) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['geofences', 7, 'charging-activity'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charging-sessions'] });
    expect(successToast).toHaveBeenCalledWith('toast.geofenceRate.apply.success', 'Rate applied to matching sessions');
  });

  it('appends from/to as query params when narrowing the applied interval', async () => {
    mockedRequest.mockResolvedValueOnce({
      priced_sessions: 1,
      skipped_sessions: 0,
      total_cost_decimal: 1,
      currency: 'USD',
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useApplyGeofenceRate(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      geofenceId: 7,
      rateId: 99,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });

    const url = mockedRequest.mock.calls[0][0] as string;
    expect(url).toBe('/geofences/7/rates/99/apply?from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z');
  });

  it('toasts the error and does not invalidate when the apply POST fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('apply boom'));
    const { Wrapper, qc } = makeWrapper();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useApplyGeofenceRate(), { wrapper: Wrapper });

    await expect(result.current.mutateAsync({ geofenceId: 7, rateId: 99 })).rejects.toThrow('apply boom');
    expect(errorToast).toHaveBeenCalledWith(expect.any(Error), 'toast.geofenceRate.apply.error', 'Failed to apply rate');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useGeofenceChargingSummary', () => {
  it('GETs /geofences/{id}/charging-summary and returns the per-currency rows', async () => {
    const payload: GeofenceChargingSummary[] = [
      { currency: 'USD', session_count: 5, total_energy_wh: 40_000, total_cost_decimal: 4.4 },
      { currency: 'EUR', session_count: 2, total_energy_wh: 10_000, total_cost_decimal: 1.1 },
    ];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceChargingSummary(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Multiple currencies must stay as separate rows, never summed together.
    expect(result.current.data).toEqual(payload);
    expect(result.current.data).toHaveLength(2);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/7/charging-summary');
  });

  it('is disabled (no fetch) when geofenceId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceChargingSummary(undefined), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGeofenceChargingActivity', () => {
  it('GETs /geofences/{id}/charging-activity with default limit=50 & offset=0', async () => {
    const payload: GeofenceChargingActivity[] = [
      {
        session_id: 1,
        started_at: '2026-08-01T00:00:00Z',
        ended_at: '2026-08-01T01:00:00Z',
        energy_wh: 10_000,
        cost_decimal: 1.2,
        cost_currency: 'USD',
        cost_source: 'geofence_tariff',
        rate_id: 99,
      },
    ];
    mockedRequest.mockResolvedValueOnce(payload);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceChargingActivity(7), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/7/charging-activity?limit=50&offset=0');
  });

  it('threads a custom limit/offset through to the query string', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    renderHook(() => useGeofenceChargingActivity(7, 25, 25), { wrapper: Wrapper });

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toBe('/geofences/7/charging-activity?limit=25&offset=25');
  });

  it('is disabled (no fetch) when geofenceId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeofenceChargingActivity(undefined), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
