// useVehicles hook-family coverage.
//
// This file exercises EVERY runtime export of api/hooks/useVehicles.ts through
// its public surface:
//
//   - vehicleKeys        — the stable cache-key tuples used for invalidation
//                          (list / detail / state-with-and-without-as_of /
//                          positions).
//   - getVehicleStatus   — the deriveVehicleStatus re-export (offline /
//                          charging / driving / online branches).
//   - useVehicles        — GET /vehicles + the safeArray null/non-array guard.
//   - useVehicle         — GET /vehicles/{id} + the enabled:!!id gate + 404.
//   - useVehicleState    — the two-shape decode (pre-assembled state vs.
//     & fetchVehicleState  vehicle+position compose), per-field defaults, the
//                          empty-body null-safety guard (the regression this
//                          harden fixes), the as_of time-machine URL, and the
//                          vehicleId>0 gate.
//   - useVehiclePositions / useMotorHistory — limit query + safeArray.
//   - the *Latest telemetry family — URL shape + vehicleId>0 gate (data-driven).
//   - useFleetStates     — per-vehicle fan-out, one-failure-yields-null, the
//                          length gate, and the non-array input guard.
//   - the vehicle-info GET family + their refresh mutations (data-driven).
//   - the mutation hooks (refresh / delete / sync / wake / warranty) — request
//                          shape, cache write, invalidation, and toast keys on
//                          BOTH the success and error paths.
//
// Network is mocked at the `request` boundary; Toast + cross-tab broadcast are
// mocked so i18n keys + invalidation are observable without a live bus (the
// repo convention — see useAlerts.test.tsx / useExports.test.tsx).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Hoisted so the (also-hoisted) mock factories close over the SAME spies the
// assertions read.
const { requestMock, toastSuccess, toastError, invalidateSpy } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateSpy: vi.fn(),
}));

vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock('@/lib/queryBroadcast', () => ({
  invalidateAndBroadcast: (...args: unknown[]) => invalidateSpy(...args),
}));

import { ApiError } from '@/lib/resilience';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '@/api/types';
import {
  vehicleKeys,
  getVehicleStatus,
  useVehicles,
  useVehicle,
  useVehicleState,
  useVehiclePositions,
  useRefreshVehicle,
  useDeleteVehicle,
  useSyncVehicles,
  useWakeVehicle,
  useMotorLatest,
  useMotorHistory,
  useDriveDynamicsLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
  useChargingTelemetryLatest,
  useMediaLatest,
  useLocationSnapshotLatest,
  useVehicleConfigLatest,
  useUserPreferenceLatest,
  fetchVehicleState,
  useFleetStates,
  useVehicleMobileEnabled,
  useRefreshVehicleMobileEnabled,
  useVehicleOptions,
  useRefreshVehicleOptions,
  useVehicleSpecs,
  useRefreshVehicleSpecs,
  useVehicleSubscriptions,
  useRefreshVehicleSubscriptions,
  useVehicleUpgrades,
  useRefreshVehicleUpgrades,
  useWarrantyDetails,
  useRefreshWarrantyDetails,
} from './useVehicles';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(client: QueryClient, initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

/** Render a hook against a fresh client + router; expose the client for cache/spy reads. */
function renderH<T>(
  hook: () => T,
  opts: { client?: QueryClient; initialEntries?: string[] } = {},
) {
  const client = opts.client ?? makeClient();
  const utils = renderHook(hook, { wrapper: makeWrapper(client, opts.initialEntries) });
  return { ...utils, client };
}

/** First positional arg of the most recent request() call = the fetched path. */
function lastUrl(): string {
  return requestMock.mock.calls.at(-1)?.[0] as string;
}
/** Second positional arg of the most recent request() call = fetch options. */
function lastOpts(): { signal?: unknown; method?: string; body?: unknown } {
  return (requestMock.mock.calls.at(-1)?.[1] ?? {}) as {
    signal?: unknown;
    method?: string;
    body?: unknown;
  };
}
/** A disabled query must never fetch — give React Query a tick to prove it. */
const tick = () => new Promise((r) => setTimeout(r, 10));

function makeVehicle(id: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN${id}`,
    display_name: `Car ${id}`,
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  invalidateSpy.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('vehicleKeys', () => {
  it('exposes a stable list root and namespaces detail under it', () => {
    expect(vehicleKeys.all).toEqual(['vehicles']);
    expect(vehicleKeys.detail('7')).toEqual(['vehicles', '7']);
    expect(vehicleKeys.detail('7')).not.toEqual(vehicleKeys.detail('8'));
  });

  it('drops the as_of segment in live mode but appends it for the time machine', () => {
    // Distinct cache entries per mode so a historical read never clobbers the
    // live snapshot in the cache.
    expect(vehicleKeys.state(3)).toEqual(['vehicle-state', 3]);
    expect(vehicleKeys.state(3, null)).toEqual(['vehicle-state', 3]);
    expect(vehicleKeys.state(3, '2024-11-12T14:30:00Z')).toEqual([
      'vehicle-state',
      3,
      '2024-11-12T14:30:00Z',
    ]);
    expect(vehicleKeys.positions(3)).toEqual(['vehicle-positions', 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getVehicleStatus (deriveVehicleStatus re-export)', () => {
  it('is a live binding to the derivation, not undefined', () => {
    expect(typeof getVehicleStatus).toBe('function');
    expect(getVehicleStatus(undefined)).toBe('offline');
    expect(getVehicleStatus(null)).toBe('offline');
  });

  it('prioritises charging, then driving, then the raw state', () => {
    expect(getVehicleStatus({ is_charging: true, speed: 40 } as VehicleState)).toBe('charging');
    expect(getVehicleStatus({ is_charging: false, speed: 40 } as VehicleState)).toBe('driving');
    expect(
      getVehicleStatus({ is_charging: false, speed: 0, state: 'asleep' } as VehicleState),
    ).toBe('asleep');
    expect(
      getVehicleStatus({ is_charging: false, speed: 0, state: 'weird' } as VehicleState),
    ).toBe('online');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useVehicles', () => {
  it('GETs /vehicles and threads an AbortSignal', async () => {
    const rows = [makeVehicle(1), makeVehicle(2)];
    requestMock.mockResolvedValueOnce(rows);
    const { result } = renderH(() => useVehicles());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles');
    expect(lastOpts()).toHaveProperty('signal');
    expect(result.current.data).toEqual(rows);
  });

  it('normalises a Go nil slice (JSON null) to [] via the safeArray select', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderH(() => useVehicles());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('normalises a non-array body to [] so a downstream .map cannot crash', async () => {
    requestMock.mockResolvedValueOnce({ not: 'an array' });
    const { result } = renderH(() => useVehicles());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('surfaces request failures through the isError channel', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderH(() => useVehicles());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useVehicle', () => {
  it('GETs /vehicles/{id} when the id is truthy', async () => {
    const veh = makeVehicle(5);
    requestMock.mockResolvedValueOnce(veh);
    const { result } = renderH(() => useVehicle('5'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/5');
    expect(result.current.data?.id).toBe(5);
  });

  it('stays idle (enabled:false) for an empty id and never fires', async () => {
    const { result } = renderH(() => useVehicle(''));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a 404 through the ApiError channel', async () => {
    requestMock.mockRejectedValueOnce(new ApiError('missing', 404, 'NOT_FOUND'));
    const { result } = renderH(() => useVehicle('999'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useVehicleState', () => {
  it('passes through an already-assembled state object untouched', async () => {
    requestMock.mockResolvedValueOnce({
      state: { vehicle_id: 3, state: 'online', battery_level: 72 },
      live: true,
    });
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/3/state');
    expect(lastOpts()).toHaveProperty('signal');
    expect(result.current.data?.state?.vehicle_id).toBe(3);
    expect(result.current.data?.state?.battery_level).toBe(72);
    expect(result.current.data?.live).toBe(true);
  });

  it('composes a VehicleState from the vehicle + position pair', async () => {
    requestMock.mockResolvedValueOnce({
      vehicle: { id: 3, state: 'online', is_locked: false, software_version: '2024.44.1' },
      position: { latitude: 12.5, longitude: -7.1, speed: 0, battery_level: 80, ideal_range: 500 },
      is_charging: false,
      live: false,
    });
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const s = result.current.data?.state;
    expect(s?.latitude).toBe(12.5);
    expect(s?.battery_level).toBe(80);
    expect(s?.state).toBe('online');
    expect(s?.software_version).toBe('2024.44.1');
    expect(s?.is_locked).toBe(false);
    // rated_range is absent → it falls back to ideal_range.
    expect(s?.rated_range).toBe(500);
  });

  it('defaults is_locked to true and numeric fields to 0 when the pair is sparse', async () => {
    requestMock.mockResolvedValueOnce({ vehicle: { id: 3 }, position: {} });
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const s = result.current.data?.state;
    // Fail-safe default: an unknown lock state is reported as locked.
    expect(s?.is_locked).toBe(true);
    expect(s?.speed).toBe(0);
    expect(s?.software_version).toBe('');
    expect(s?.state).toBe('offline');
  });

  it('does NOT throw on an empty (JSON null) body — resolves to an empty live-less state', async () => {
    // Regression: the mapping used to read `res.state` off a null body and
    // crash the whole query. A vehicle with no snapshot yet must render blank.
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual({ state: undefined, live: false });
  });

  it('handles the neither-vehicle-nor-position branch by echoing state + live', async () => {
    requestMock.mockResolvedValueOnce({ live: true });
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ state: undefined, live: true });
  });

  it('appends the encoded ?as_of= param when the time-machine URL is set', async () => {
    requestMock.mockResolvedValueOnce({ state: { vehicle_id: 3 }, live: false });
    renderH(() => useVehicleState(3), {
      initialEntries: ['/?as_of=2024-11-12T14%3A30%3A00Z'],
    });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(lastUrl()).toBe('/vehicles/3/state?as_of=2024-11-12T14%3A30%3A00Z');
  });

  it('stays idle for a non-positive vehicleId', async () => {
    const { result } = renderH(() => useVehicleState(0));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('fetchVehicleState (raw batch helper)', () => {
  it('passes through the pre-assembled state shape', async () => {
    requestMock.mockResolvedValueOnce({ state: { vehicle_id: 9, state: 'asleep' }, live: true });
    const out = await fetchVehicleState(9);
    expect(lastUrl()).toBe('/vehicles/9/state');
    expect(out.state?.vehicle_id).toBe(9);
    expect(out.live).toBe(true);
  });

  it('composes vehicle + position and defaults the live flag to false', async () => {
    requestMock.mockResolvedValueOnce({
      vehicle: { id: 9, state: 'driving' },
      position: { latitude: 1, longitude: 2, speed: 30 },
    });
    const out = await fetchVehicleState(9);
    expect(out.state?.state).toBe('driving');
    expect(out.state?.speed).toBe(30);
    expect(out.live).toBe(false);
  });

  it('returns an empty live-less state (never throws) for a null body', async () => {
    requestMock.mockResolvedValueOnce(null);
    await expect(fetchVehicleState(9)).resolves.toEqual({ state: undefined, live: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useVehiclePositions', () => {
  it('GETs the positions route with the default limit and safeArray-guards it', async () => {
    requestMock.mockResolvedValueOnce([{ vehicle_id: 3 }]);
    const { result } = renderH(() => useVehiclePositions(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/3/positions?limit=100');
    expect(result.current.data).toHaveLength(1);
  });

  it('honours a custom limit and coerces a null body to []', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderH(() => useVehiclePositions(3, 25));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/3/positions?limit=25');
    expect(result.current.data).toEqual([]);
  });

  it('stays idle for a non-positive vehicleId', async () => {
    renderH(() => useVehiclePositions(0));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useMotorHistory', () => {
  it('GETs /motor with vehicle_id + default limit and safeArray-guards it', async () => {
    requestMock.mockResolvedValueOnce([{ ts: 't' }]);
    const { result } = renderH(() => useMotorHistory(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/motor?vehicle_id=3&limit=200');
    expect(result.current.data).toHaveLength(1);
  });

  it('honours a custom limit and normalises null to []', async () => {
    requestMock.mockResolvedValueOnce(null);
    const { result } = renderH(() => useMotorHistory(3, 10));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/motor?vehicle_id=3&limit=10');
    expect(result.current.data).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The single-snapshot telemetry family all share the same contract: GET
// {route}?vehicle_id={id}, an AbortSignal, and an enabled:vehicleId>0 gate.
const latestFamily: Array<{
  label: string;
  hook: (vehicleId: number, refetchInterval?: number) => unknown;
  route: string;
}> = [
  { label: 'useMotorLatest', hook: useMotorLatest, route: '/motor/latest' },
  { label: 'useDriveDynamicsLatest', hook: useDriveDynamicsLatest, route: '/drive-dynamics/latest' },
  { label: 'useClimateLatest', hook: useClimateLatest, route: '/climate/latest' },
  { label: 'useSecurityLatest', hook: useSecurityLatest, route: '/security/latest' },
  { label: 'useLatestTirePressure', hook: useLatestTirePressure, route: '/tire-pressure/latest' },
  {
    label: 'useChargingTelemetryLatest',
    hook: useChargingTelemetryLatest,
    route: '/charging-telemetry/latest',
  },
  { label: 'useMediaLatest', hook: useMediaLatest, route: '/media/latest' },
  {
    label: 'useLocationSnapshotLatest',
    hook: useLocationSnapshotLatest,
    route: '/location-snapshots/latest',
  },
  { label: 'useVehicleConfigLatest', hook: useVehicleConfigLatest, route: '/vehicle-config/latest' },
  { label: 'useUserPreferenceLatest', hook: useUserPreferenceLatest, route: '/user-preferences/latest' },
];

describe.each(latestFamily)('$label', ({ hook, route }) => {
  it(`GETs ${route}?vehicle_id={id} with a signal`, async () => {
    requestMock.mockResolvedValueOnce({ ok: true });
    const { result } = renderH(() => hook(7) as ReturnType<typeof useMotorLatest>);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe(`${route}?vehicle_id=7`);
    expect(lastOpts()).toHaveProperty('signal');
  });

  it('stays idle for a non-positive vehicleId', async () => {
    renderH(() => hook(0) as ReturnType<typeof useMotorLatest>);
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useFleetStates', () => {
  it('fans out one request per vehicle and pairs each with its state', async () => {
    requestMock.mockImplementation((url: string) => {
      const id = Number(/\/vehicles\/(\d+)\/state/.exec(url)?.[1] ?? 0);
      return Promise.resolve({ state: { vehicle_id: id, state: 'online' }, live: true });
    });
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.data?.[0]).toEqual({
      vehicle: vehicles[0],
      state: { vehicle_id: 1, state: 'online' },
    });
    expect(result.current.data?.[1].state?.vehicle_id).toBe(2);
  });

  it('isolates a single failing vehicle as a null state instead of rejecting the batch', async () => {
    requestMock.mockImplementation((url: string) => {
      const id = Number(/\/vehicles\/(\d+)\/state/.exec(url)?.[1] ?? 0);
      return id === 2
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ state: { vehicle_id: id }, live: true });
    });
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].state?.vehicle_id).toBe(1);
    expect(result.current.data?.[1].state).toBeNull();
  });

  it('is disabled for an empty fleet and never fetches', async () => {
    renderH(() => useFleetStates([]));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('guards a non-array input (undefined) without crashing', async () => {
    // Hardening: callers pass `data ?? []`, but a stray undefined must not
    // throw at `.map`/`.length`.
    const { result } = renderH(() => useFleetStates(undefined as unknown as Vehicle[]));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle-info GET family: GET /vehicles/{id}/{segment}, enabled:!!id.
const infoFamily: Array<{
  label: string;
  hook: (vehicleId?: string) => unknown;
  segment: string;
}> = [
  { label: 'useVehicleMobileEnabled', hook: useVehicleMobileEnabled, segment: 'mobile-enabled' },
  { label: 'useVehicleOptions', hook: useVehicleOptions, segment: 'options' },
  { label: 'useVehicleSpecs', hook: useVehicleSpecs, segment: 'specs' },
  { label: 'useVehicleSubscriptions', hook: useVehicleSubscriptions, segment: 'subscriptions' },
  { label: 'useVehicleUpgrades', hook: useVehicleUpgrades, segment: 'upgrades' },
];

describe.each(infoFamily)('$label', ({ hook, segment }) => {
  it(`GETs /vehicles/{id}/${segment}`, async () => {
    requestMock.mockResolvedValueOnce({ data: null, fetched_at: null });
    const { result } = renderH(() => hook('5') as ReturnType<typeof useVehicleOptions>);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe(`/vehicles/5/${segment}`);
    expect(lastOpts()).toHaveProperty('signal');
  });

  it('stays idle when the id is undefined', async () => {
    renderH(() => hook(undefined) as ReturnType<typeof useVehicleOptions>);
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle-info refresh mutations: POST /vehicles/{id}/{segment}/refresh, then
// invalidate the matching GET key and emit a success toast.
const refreshFamily: Array<{
  label: string;
  hook: (vehicleId?: string) => { mutateAsync: (v?: void) => Promise<unknown> };
  segment: string;
  invalidateKey: unknown[];
  toastKey: string;
}> = [
  {
    label: 'useRefreshVehicleMobileEnabled',
    hook: useRefreshVehicleMobileEnabled,
    segment: 'mobile-enabled',
    invalidateKey: ['vehicle-mobile-enabled', '5'],
    toastKey: 'toast.vehicles.mobileEnabled.refresh.success',
  },
  {
    label: 'useRefreshVehicleOptions',
    hook: useRefreshVehicleOptions,
    segment: 'options',
    invalidateKey: ['vehicle-options', '5'],
    toastKey: 'toast.vehicles.options.refresh.success',
  },
  {
    label: 'useRefreshVehicleSpecs',
    hook: useRefreshVehicleSpecs,
    segment: 'specs',
    invalidateKey: ['vehicle-specs', '5'],
    toastKey: 'toast.vehicles.specs.refresh.success',
  },
  {
    label: 'useRefreshVehicleSubscriptions',
    hook: useRefreshVehicleSubscriptions,
    segment: 'subscriptions',
    invalidateKey: ['vehicle-subscriptions', '5'],
    toastKey: 'toast.vehicles.subscriptions.refresh.success',
  },
  {
    label: 'useRefreshVehicleUpgrades',
    hook: useRefreshVehicleUpgrades,
    segment: 'upgrades',
    invalidateKey: ['vehicle-upgrades', '5'],
    toastKey: 'toast.vehicles.upgrades.refresh.success',
  },
];

describe.each(refreshFamily)('$label', ({ hook, segment, invalidateKey, toastKey }) => {
  it(`POSTs the refresh route, invalidates its GET key, and toasts success`, async () => {
    requestMock.mockResolvedValueOnce({ data: {}, fetched_at: '2025-01-01T00:00:00Z' });
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => hook('5'), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync();

    expect(lastUrl()).toBe(`/vehicles/5/${segment}/refresh`);
    expect(lastOpts().method).toBe('POST');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: invalidateKey });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(toastKey, expect.any(String)));
  });

  it('routes a failure to the error toast', async () => {
    requestMock.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderH(() => hook('5'));
    await expect(result.current.mutateAsync()).rejects.toThrow('nope');
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useRefreshVehicle', () => {
  it('POSTs the wake route, seeds the detail cache, invalidates the list, and toasts', async () => {
    const veh = makeVehicle(5, { display_name: 'Woke' });
    requestMock.mockResolvedValueOnce(veh);
    const client = makeClient();
    const { result } = renderHook(() => useRefreshVehicle(), { wrapper: makeWrapper(client) });

    const returned = await result.current.mutateAsync('5');

    expect(returned).toEqual(veh);
    expect(lastUrl()).toBe('/vehicles/5/wake');
    expect(lastOpts().method).toBe('POST');
    // onSuccess seeds the per-id cache so the detail view updates without a refetch.
    expect(client.getQueryData(vehicleKeys.detail('5'))).toEqual(veh);
    expect(invalidateSpy).toHaveBeenCalledWith(client, { queryKey: vehicleKeys.all });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.vehicles.refresh.success', expect.any(String)),
    );
  });

  it('emits the refresh error toast on failure', async () => {
    requestMock.mockRejectedValueOnce(new Error('cold'));
    const { result } = renderH(() => useRefreshVehicle());
    await expect(result.current.mutateAsync('5')).rejects.toThrow('cold');
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.vehicles.refresh.error',
        expect.any(String),
      ),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDeleteVehicle', () => {
  it('DELETEs /vehicles/{id}, invalidates the list, and toasts success', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const client = makeClient();
    const { result } = renderHook(() => useDeleteVehicle(), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync(5);

    expect(lastUrl()).toBe('/vehicles/5');
    expect(lastOpts().method).toBe('DELETE');
    expect(invalidateSpy).toHaveBeenCalledWith(client, { queryKey: vehicleKeys.all });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.vehicles.delete.success', expect.any(String)),
    );
  });

  it('routes a failure to the delete error toast', async () => {
    requestMock.mockRejectedValueOnce(new Error('locked'));
    const { result } = renderH(() => useDeleteVehicle());
    await expect(result.current.mutateAsync(5)).rejects.toThrow('locked');
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.vehicles.delete.error',
        expect.any(String),
      ),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useSyncVehicles', () => {
  it('POSTs /vehicles/sync, invalidates the list, and interpolates the synced count', async () => {
    requestMock.mockResolvedValueOnce({ synced: 3, vehicles: [] });
    const client = makeClient();
    const { result } = renderHook(() => useSyncVehicles(), { wrapper: makeWrapper(client) });

    const out = await result.current.mutateAsync();

    expect(out.synced).toBe(3);
    expect(lastUrl()).toBe('/vehicles/sync');
    expect(lastOpts().method).toBe('POST');
    expect(invalidateSpy).toHaveBeenCalledWith(client, { queryKey: vehicleKeys.all });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'toast.vehicles.sync.success',
        expect.any(String),
        { count: 3 },
      ),
    );
  });

  it('routes a failure to the sync error toast', async () => {
    requestMock.mockRejectedValueOnce(new Error('api down'));
    const { result } = renderH(() => useSyncVehicles());
    await expect(result.current.mutateAsync()).rejects.toThrow('api down');
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWakeVehicle', () => {
  it('POSTs /vehicles/{id}/wake and toasts success WITHOUT invalidating the list', async () => {
    requestMock.mockResolvedValueOnce({ status: 'ok' });
    const { result } = renderH(() => useWakeVehicle());
    await result.current.mutateAsync(5);
    expect(lastUrl()).toBe('/vehicles/5/wake');
    expect(lastOpts().method).toBe('POST');
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('toast.vehicles.wake.success', expect.any(String)),
    );
    // Wake is a fire-and-forget command; it must not thrash the fleet cache.
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('routes a failure to the wake error toast', async () => {
    requestMock.mockRejectedValueOnce(new Error('asleep'));
    const { result } = renderH(() => useWakeVehicle());
    await expect(result.current.mutateAsync(5)).rejects.toThrow('asleep');
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.vehicles.wake.error',
        expect.any(String),
      ),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('warranty details', () => {
  it('useWarrantyDetails GETs /tesla/warranty', async () => {
    requestMock.mockResolvedValueOnce({ data: { in_warranty: true }, fetched_at: null });
    const { result } = renderH(() => useWarrantyDetails());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/tesla/warranty');
    expect(lastOpts()).toHaveProperty('signal');
  });

  it('useRefreshWarrantyDetails POSTs the refresh route, invalidates, and toasts', async () => {
    requestMock.mockResolvedValueOnce({ data: {}, fetched_at: '2025-01-01T00:00:00Z' });
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshWarrantyDetails(), {
      wrapper: makeWrapper(client),
    });

    await result.current.mutateAsync();

    expect(lastUrl()).toBe('/tesla/warranty/refresh');
    expect(lastOpts().method).toBe('POST');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['warranty-details'] });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'toast.vehicles.warranty.refresh.success',
        expect.any(String),
      ),
    );
  });
});
