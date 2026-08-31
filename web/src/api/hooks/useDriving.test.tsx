// Behavioural tests for the driving-domain data hooks (useDriving.ts).
//
// This module is a pure data layer (TanStack Query hooks + key factories +
// a couple of raw fetch helpers) — there is no rendered DOM, so the
// user-interaction / a11y facets called for in the elevation brief do not
// apply here. Instead every export is exercised for the facets that DO
// matter for a hook: exact request URL (no /api/v1 double-prefix, snake_case
// query params), AbortSignal threading, `enabled` gating, safeArray
// coercion, mutation verb + body shape, cache invalidation, and the
// success / error toast contract.
//
// Network is mocked at the `request` boundary (repo convention); the toast
// bridge is mocked via vi.hoisted so we can assert the i18n key + fallback
// each mutation emits.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import type { TripPlanRequest } from '@/types/driving';
import {
  getDrives,
  drivingKeys,
  useDrives,
  useDriveHistory,
  useDrive,
  useDriveScore,
  useDrivingStats,
  useDrivingDynamics,
  useAccelerationDistribution,
  useDrivetrainHealth,
  useSpeedProfile,
  useRegenEfficiency,
  useRouteEfficiency,
  useDrivePositions,
  useDriveTelemetry,
  useDrivingCoach,
  usePlanTrip,
  useGeocodeSearch,
  useBulkDeleteDrives,
  useDriveWhyEnded,
} from './useDriving';

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

/** Reads the [url, options] pair from the Nth mocked request call. */
function callArgs(n = 0): [
  string,
  {
    signal?: unknown;
    method?: string;
    body?: string;
    requiresLiveMode?: boolean;
  },
] {
  return mockedRequest.mock.calls[n] as [
    string,
    {
      signal?: unknown;
      method?: string;
      body?: string;
      requiresLiveMode?: boolean;
    },
  ];
}

/** Lets a disabled hook settle so we can assert it never fired. */
async function tick(ms = 15) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  mockedRequest.mockReset();
  successToast.mockReset();
  errorToast.mockReset();
});

// ---------------------------------------------------------------------------
// drivingKeys — query-key factory
// ---------------------------------------------------------------------------

describe('drivingKeys', () => {
  it('produces stable, namespaced tuples for each domain', () => {
    expect(drivingKeys.drives('5')).toEqual(['drives', '5']);
    expect(drivingKeys.history('5')).toEqual(['drives', '5', 'history', 1000]);
    expect(drivingKeys.score('5')).toEqual(['drive-score', '5']);
    expect(drivingKeys.stats('5')).toEqual(['driving-stats', '5']);
    expect(drivingKeys.dynamics('5')).toEqual(['driving-dynamics', '5']);
    expect(drivingKeys.accelerationDistribution('5')).toEqual(['acceleration-distribution', '5']);
    expect(drivingKeys.drivetrainHealth('5')).toEqual(['drivetrain-health', '5']);
    expect(drivingKeys.speedProfile('5')).toEqual(['speed-profile', '5']);
    expect(drivingKeys.regenEfficiency('5')).toEqual(['regen-efficiency', '5']);
    expect(drivingKeys.routeEfficiency('5')).toEqual(['route-efficiency', '5']);
    expect(drivingKeys.coach('5', 30)).toEqual(['driving-coach', '5', 30]);
    expect(drivingKeys.whyEnded('5', '60s')).toEqual(['drive', '5', 'why-ended', '60s']);
  });

  it('keeps the unwindowed list key stable and prefixes windowed variants under it', () => {
    // An empty window must produce the original two-element key so the 36
    // callers that pass no window keep sharing one cache entry.
    expect(drivingKeys.drives('5', {})).toEqual(['drives', '5']);
    // A window extends that key rather than replacing it, so the `['drives']`
    // prefix invalidation fired after a bulk delete still reaches it.
    const windowed = drivingKeys.drives('5', { start: '2026-01-01', end: '2026-02-01', limit: 1000 });
    expect(windowed).toEqual(['drives', '5', '2026-01-01', '2026-02-01', 1000]);
    expect(windowed.slice(0, 2)).toEqual(['drives', '5']);
  });

  it('namespaces the detail key under `drive` so it never collides with the `drives` list key', () => {
    // Regression guard for the documented cache-collision bug: an equal
    // numeric id must not map list (`Drive[]`) and detail (`DriveDetail`)
    // onto the same cache entry.
    const list = drivingKeys.drives('7');
    const detail = drivingKeys.drive('7');
    expect(list[0]).toBe('drives');
    expect(detail[0]).toBe('drive');
    expect(list).not.toEqual(detail);
  });
});

// ---------------------------------------------------------------------------
// getDrives — raw fetch helper
// ---------------------------------------------------------------------------

describe('getDrives', () => {
  it('builds the default paginated query with snake_case params', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    await getDrives(1);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(callArgs()[0]).toBe('/drives?vehicle_id=1&limit=50&offset=0');
  });

  it('appends start/end and honours explicit limit/offset', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    await getDrives(2, 10, 20, '2025-01-01', '2025-01-31');
    expect(callArgs()[0]).toBe(
      '/drives?vehicle_id=2&limit=10&offset=20&start=2025-01-01&end=2025-01-31',
    );
  });

  it('returns the resolved payload verbatim', async () => {
    const rows = [{ id: 9 }];
    mockedRequest.mockResolvedValueOnce(rows);
    await expect(getDrives(3)).resolves.toBe(rows);
  });
});

// ---------------------------------------------------------------------------
// useDrives — list, safeArray, enabled gating
// ---------------------------------------------------------------------------

describe('useDrives', () => {
  it('fetches the vehicle-scoped list and threads the abort signal', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrives('5'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/drives?vehicle_id=5');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(2);
  });

  it('is disabled (never fires) when vehicleId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrives(undefined), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('coerces a non-array payload to [] via the safeArray select', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrives('5'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  // Regression: without an explicit limit the API applies its own 50-row
  // default page, so a caller filtering/paginating client-side could only
  // ever see the 50 newest drives no matter what range or page size was
  // requested. The list page now scopes the request on the server.
  it('scopes the request server-side when given a window', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useDrives('5', { start: '2026-01-01', end: '2026-08-06', limit: 1000 }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe(
      '/drives?vehicle_id=5&start=2026-01-01&end=2026-08-06&limit=1000',
    );
  });

  it('clamps limit to the backend-accepted 1..1000 range', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrives('5', { limit: 99999 }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives?vehicle_id=5&limit=1000');
  });

  it('still treats a bare number as the legacy refetch interval', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrives('5', 30_000), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives?vehicle_id=5');
  });

  // Two different windows must not share one cache entry, otherwise
  // switching the date range would render the previous range's rows.
  it('keys distinct windows separately', async () => {
    mockedRequest.mockResolvedValue([]);
    const { Wrapper } = makeWrapper();
    const { result: a } = renderHook(
      () => useDrives('5', { start: '2026-01-01', end: '2026-02-01', limit: 1000 }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(a.current.isSuccess).toBe(true));
    const { result: b } = renderHook(
      () => useDrives('5', { start: '2026-03-01', end: '2026-04-01', limit: 1000 }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(b.current.isSuccess).toBe(true));
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});

describe('useDriveHistory', () => {
  it('uses an isolated key and requests the backend maximum history window', async () => {
    mockedRequest.mockResolvedValueOnce([{ id: 1 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDriveHistory('5'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives?vehicle_id=5&limit=1000');
    expect(result.current.data).toHaveLength(1);
  });

  it('bounds a custom limit and stays disabled without a vehicle', async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const first = makeWrapper();
    const { result } = renderHook(() => useDriveHistory('5', 5000), {
      wrapper: first.Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives?vehicle_id=5&limit=1000');

    mockedRequest.mockReset();
    const second = makeWrapper();
    renderHook(() => useDriveHistory(undefined), { wrapper: second.Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDrive — detail + live gating
// ---------------------------------------------------------------------------

describe('useDrive', () => {
  it('fetches a single drive detail by id', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 42, live: false });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrive('42'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives/42');
    expect(result.current.data?.live).toBe(false);
  });

  it('is disabled when id is the empty string', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useDrive(''), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Vehicle-scoped analytics GETs sharing the `X?vehicle_id=` / `X` shape
// ---------------------------------------------------------------------------

describe('vehicle-scoped analytics hooks', () => {
  const cases: Array<[string, (id?: string) => unknown, string]> = [
    ['useDriveScore', useDriveScore, '/drives/score'],
    ['useDrivingStats', useDrivingStats, '/drives/stats'],
    ['useDrivingDynamics', useDrivingDynamics, '/drives/dynamics'],
    ['useAccelerationDistribution', useAccelerationDistribution, '/drives/acceleration-distribution'],
    ['useDrivetrainHealth', useDrivetrainHealth, '/drivetrain/health'],
  ];

  it.each(cases)('%s appends vehicle_id and threads the signal', async (_name, hook, path) => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => hook('5'), { wrapper: Wrapper }) as {
      result: { current: { isSuccess: boolean } };
    };
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe(`${path}?vehicle_id=5`);
    expect(opts).toHaveProperty('signal');
  });

  it.each(cases)('%s is disabled when vehicleId is undefined', async (_name, hook) => {
    const { Wrapper } = makeWrapper();
    renderHook(() => hook(undefined), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Analytics hooks with optional start/end date-range params
// ---------------------------------------------------------------------------

describe('date-range analytics hooks', () => {
  const cases: Array<[string, (id?: string, s?: string, e?: string) => unknown, string]> = [
    ['useSpeedProfile', useSpeedProfile, '/analytics/speed-profile'],
    ['useRegenEfficiency', useRegenEfficiency, '/analytics/regen'],
    ['useRouteEfficiency', useRouteEfficiency, '/analytics/route-efficiency'],
  ];

  it.each(cases)('%s builds a vehicle-only URL when no range is given', async (_name, hook, path) => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => hook('5'), { wrapper: Wrapper }) as {
      result: { current: { isSuccess: boolean } };
    };
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe(`${path}?vehicle_id=5`);
  });

  it.each(cases)('%s appends start and end when provided', async (_name, hook, path) => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => hook('5', '2025-01-01', '2025-02-01'), {
      wrapper: Wrapper,
    }) as { result: { current: { isSuccess: boolean } } };
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe(`${path}?vehicle_id=5&start=2025-01-01&end=2025-02-01`);
  });

  it.each(cases)('%s is disabled when vehicleId is undefined', async (_name, hook) => {
    const { Wrapper } = makeWrapper();
    renderHook(() => hook(undefined), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Drive-scoped list hooks (positions / telemetry) — safeArray + enabled
// ---------------------------------------------------------------------------

describe('drive-scoped list hooks', () => {
  it('useDrivePositions fetches /drives/{id}/positions and threads the signal', async () => {
    mockedRequest.mockResolvedValueOnce([{ latitude: 1, longitude: 2 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrivePositions('42'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/drives/42/positions');
    expect(opts).toHaveProperty('signal');
    expect(result.current.data).toHaveLength(1);
  });

  it('useDriveTelemetry coerces a null payload to [] and is keyed by driveId', async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDriveTelemetry('42'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives/42/telemetry');
    expect(result.current.data).toEqual([]);
  });

  it('both hooks are disabled when driveId is empty', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useDrivePositions(''), { wrapper: Wrapper });
    renderHook(() => useDriveTelemetry(''), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDrivingCoach — days param + default
// ---------------------------------------------------------------------------

describe('useDrivingCoach', () => {
  it('defaults to a 30-day window', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrivingCoach('5'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/analytics/driving-coach?vehicle_id=5&days=30');
  });

  it('honours an explicit days argument', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDrivingCoach('5', 7), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/analytics/driving-coach?vehicle_id=5&days=7');
  });

  it('is disabled when vehicleId is undefined', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useDrivingCoach(undefined), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useGeocodeSearch — encoding + min-length gating
// ---------------------------------------------------------------------------

describe('useGeocodeSearch', () => {
  it('URL-encodes the query and caps results at 5', async () => {
    mockedRequest.mockResolvedValueOnce([{ display_name: 'x', lat: 1, lng: 2 }]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeSearch('San Jose'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/geocode/search?q=San%20Jose&limit=5');
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled for queries shorter than 3 characters', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useGeocodeSearch('ab'), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('is disabled when the caller passes enabled=false even for a long query', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useGeocodeSearch('San Jose', false), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// usePlanTrip — POST body + toast contract
// ---------------------------------------------------------------------------

const tripReq: TripPlanRequest = {
  vehicle_id: 1,
  origin: { lat: 37.3, lng: -121.8, name: 'Home' },
  destination: { lat: 34.0, lng: -118.2, name: 'LA' },
  current_soc: 80,
  charge_limit_soc: 90,
  min_arrival_soc: 10,
};

describe('usePlanTrip', () => {
  it('POSTs the plan request and surfaces the route, then emits the success toast', async () => {
    const plan = { route: { feasible: true } };
    mockedRequest.mockResolvedValueOnce(plan);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePlanTrip(), { wrapper: Wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync(tripReq);
    });

    const [url, opts] = callArgs();
    expect(url).toBe('/trip-planner/plan');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual(tripReq);
    expect(returned).toBe(plan);
    expect(successToast).toHaveBeenCalledWith('toast.trip.plan.success', 'Trip planned');
  });

  it('routes a failure through the i18n error toast', async () => {
    const boom = new Error('no route');
    mockedRequest.mockRejectedValueOnce(boom);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePlanTrip(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(tripReq)).rejects.toThrow('no route');
    });
    expect(errorToast).toHaveBeenCalledWith(boom, 'toast.trip.plan.error', 'Failed to plan trip');
    expect(successToast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useBulkDeleteDrives — DELETE body, invalidation, count toast
// ---------------------------------------------------------------------------

describe('useBulkDeleteDrives', () => {
  it('DELETEs /drives/bulk with the ids body, invalidates caches, and reports the deleted count', async () => {
    mockedRequest.mockResolvedValueOnce({ deleted: 3 });
    const { Wrapper, qc } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useBulkDeleteDrives(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync([1, 2, 3]);
    });

    const [url, opts] = callArgs();
    expect(url).toBe('/drives/bulk');
    expect(opts.method).toBe('DELETE');
    expect(opts.requiresLiveMode).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({ ids: [1, 2, 3] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['drives'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['drive'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['analytics', 'fsd'] });
    expect(successToast).toHaveBeenCalledWith('toast.bulk.delete.success', '{{count}} deleted', {
      count: 3,
    });
  });

  it('falls back to a count of 0 when the server omits `deleted`', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkDeleteDrives(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync([9]);
    });
    expect(successToast).toHaveBeenCalledWith('toast.bulk.delete.success', '{{count}} deleted', {
      count: 0,
    });
  });

  it('emits the error toast when the delete fails', async () => {
    const boom = new Error('forbidden');
    mockedRequest.mockRejectedValueOnce(boom);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkDeleteDrives(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync([1])).rejects.toThrow('forbidden');
    });
    expect(errorToast).toHaveBeenCalledWith(boom, 'toast.bulk.delete.error', 'Failed to delete selection');
  });
});

// ---------------------------------------------------------------------------
// useDriveWhyEnded — window param, id coercion, enabled gating
// ---------------------------------------------------------------------------

describe('useDriveWhyEnded', () => {
  it('defaults to the 60s window and encodes the id', async () => {
    mockedRequest.mockResolvedValueOnce({ drive_id: 42 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDriveWhyEnded('42'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = callArgs();
    expect(url).toBe('/drives/42/why-ended?window=60s');
    expect(opts).toHaveProperty('signal');
  });

  it('accepts a numeric id and a custom window', async () => {
    mockedRequest.mockResolvedValueOnce({ drive_id: 7 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDriveWhyEnded(7, '5m'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(callArgs()[0]).toBe('/drives/7/why-ended?window=5m');
  });

  it('is disabled for the sentinel id 0 and when enabled=false', async () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useDriveWhyEnded(0), { wrapper: Wrapper });
    renderHook(() => useDriveWhyEnded('42', '60s', false), { wrapper: Wrapper });
    await tick();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
