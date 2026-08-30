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
import { renderHook, waitFor, act } from '@testing-library/react';
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
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
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
  fetchFleetStates,
  deriveCurrentVehicleStatus,
  deriveTrustedVehicleStatus,
  describeFleetState,
  isFleetStateFieldCurrent,
  useFleetStates,
  summariseFleetStates,
  FLEET_STATES_QUERY_ROOT,
  FLEET_STATE_BATCH_CHUNK,
  type FleetStateEntry,
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
  useVehiclePricing,
  useEnterpriseRoles,
  useRefreshEnterpriseRoles,
  useSetEnterprisePayer,
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
function lastOpts(): {
  signal?: unknown;
  method?: string;
  body?: unknown;
  requiresLiveMode?: boolean;
} {
  return (requestMock.mock.calls.at(-1)?.[1] ?? {}) as {
    signal?: unknown;
    method?: string;
    body?: unknown;
    requiresLiveMode?: boolean;
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

const FRESH_OBSERVED_AT = new Date(Date.now() - 1_000).toISOString();
const VERIFIED_FIELDS = [
  'state',
  'battery_level',
  'rated_range',
  'speed',
  'is_charging',
  'software_version',
] as const;

function freshStateResponse(
  id: number,
  state: Partial<VehicleState> = {},
  live = true,
) {
  return {
    state: { vehicle_id: id, ...state },
    live,
    observed_at: FRESH_OBSERVED_AT,
    freshness: 'fresh' as const,
    verified_fields: VERIFIED_FIELDS,
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
    expect(result.current.data).toEqual({
      state: undefined,
      live: false,
      observedAt: null,
      freshness: 'unknown',
      verifiedFields: [],
    });
  });

  it('handles the neither-vehicle-nor-position branch by echoing state + live', async () => {
    requestMock.mockResolvedValueOnce({ live: true });
    const { result } = renderH(() => useVehicleState(3));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      state: undefined,
      live: true,
      observedAt: null,
      freshness: 'unknown',
      verifiedFields: [],
    });
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
    requestMock.mockResolvedValueOnce(freshStateResponse(9, { state: 'asleep' }));
    const out = await fetchVehicleState(9);
    expect(lastUrl()).toBe('/vehicles/9/state');
    expect(out.state?.vehicle_id).toBe(9);
    expect(out.live).toBe(true);
    expect(out.observedAt).toBe(Date.parse(FRESH_OBSERVED_AT));
    expect(out.freshness).toBe('fresh');
    expect(out.verifiedFields).toEqual(VERIFIED_FIELDS);
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
    await expect(fetchVehicleState(9)).resolves.toEqual({
      state: undefined,
      live: false,
      observedAt: null,
      freshness: 'unknown',
      verifiedFields: [],
    });
  });

  it('does not infer freshness when the backend omits or corrupts observation metadata', async () => {
    requestMock
      .mockResolvedValueOnce({ state: { vehicle_id: 9 }, live: true, freshness: 'fresh' })
      .mockResolvedValueOnce({
        state: { vehicle_id: 9 },
        live: true,
        observed_at: 'not-a-timestamp',
        freshness: 'fresh',
      });

    await expect(fetchVehicleState(9)).resolves.toMatchObject({
      observedAt: null,
      freshness: 'unknown',
    });
    await expect(fetchVehicleState(9)).resolves.toMatchObject({
      observedAt: null,
      freshness: 'unknown',
    });
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
// Batch fleet-state helpers.
//
// `useFleetStates` reads ONE endpoint — GET /vehicles/states — which answers
// through the platform `{data: ...}` envelope. Every helper below builds the
// REAL wire shape (snake_case, per-item outcome + provenance) so the tests
// exercise the actual decode rather than a convenient stand-in.

/** The ids a batch request asked for, parsed out of the query string. */
function requestedIds(url: string): number[] {
  const query = String(url).split('?')[1] ?? '';
  const raw = new URLSearchParams(query).get('vehicle_ids') ?? '';
  return raw === '' ? [] : raw.split(',').map(Number);
}

type WireItem = Record<string, unknown>;

function resolvedItem(
  id: number,
  state: Partial<VehicleState> = {},
  over: WireItem = {},
): WireItem {
  return {
    vehicle_id: id,
    outcome: 'resolved',
    state: { vehicle_id: id, ...state },
    live: true,
    data_source: 'live_signal_store',
    observed_at: FRESH_OBSERVED_AT,
    freshness: 'fresh',
    verified_fields: VERIFIED_FIELDS,
    ...over,
  };
}

function missingItem(id: number): WireItem {
  return {
    vehicle_id: id,
    outcome: 'missing',
    state: null,
    live: false,
    data_source: 'db_fallback',
    freshness: 'unknown',
    verified_fields: [],
  };
}

function failedItem(id: number): WireItem {
  return {
    vehicle_id: id,
    outcome: 'failed',
    state: null,
    live: false,
    data_source: 'db_fallback',
    freshness: 'unknown',
    verified_fields: [],
    error: 'state_unavailable',
  };
}

/** Wrap items in the `{data: ...}` envelope handler/v1 writes. */
function batchBody(items: WireItem[]) {
  return {
    data: {
      now: new Date().toISOString(),
      total: items.length,
      limit: 500,
      offset: 0,
      counts: {
        resolved: items.filter((i) => i.outcome === 'resolved').length,
        missing: items.filter((i) => i.outcome === 'missing').length,
        failed: items.filter((i) => i.outcome === 'failed').length,
      },
      vehicles: items,
    },
  };
}

/** Default mock: every requested vehicle resolves fresh. */
function mockResolvedBatch(state: Partial<VehicleState> = { state: 'online' }) {
  requestMock.mockImplementation((url: string) =>
    Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, state)))));
}

/**
 * A client that actually KEEPS cache entries. The default `makeClient()` uses
 * `gcTime: 0`, which collects an observer-less key the instant it is written —
 * fine for request-shape assertions, fatal for anything asserting on the
 * seeded single-vehicle cache.
 */
function cacheRetainingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 5 * 60_000 },
      mutations: { retry: false },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('fetchFleetStates (raw batch helper)', () => {
  it('asks for exactly the requested ids and returns the wire items', async () => {
    requestMock.mockImplementation((url: string) =>
      Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id)))));

    const batch = await fetchFleetStates([3, 1, 2]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestedIds(lastUrl())).toEqual([3, 1, 2]);
    expect(lastUrl()).toContain(`limit=${FLEET_STATE_BATCH_CHUNK}`);
    expect(batch.items.map((item) => item.vehicle_id)).toEqual([3, 1, 2]);
  });

  it('tolerates a null body without throwing', async () => {
    requestMock.mockResolvedValue(null);
    // No items AND no summary: a body we could not read carries no posture,
    // and fabricating a zeroed summary would render as "nothing is verified".
    await expect(fetchFleetStates([1])).resolves.toEqual({ items: [], summary: null });
  });

  it('propagates a transport failure rather than resolving empty', async () => {
    requestMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchFleetStates([1])).rejects.toThrow('ECONNREFUSED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deriveTrustedVehicleStatus (single-vehicle contract)', () => {
  const now = Date.now();
  const trust = (verified: string[], freshness: 'fresh' | 'stale' | 'unknown' = 'fresh') => ({
    freshness,
    observedAt: now - 1_000,
    verifiedFields: verified as never,
  });

  it('applies the same precedence the fleet entry contract does', () => {
    const state = { vehicle_id: 1, state: 'parked', is_charging: true, speed: 30 } as VehicleState;
    expect(deriveTrustedVehicleStatus(state, trust(['state', 'is_charging', 'speed']), now))
      .toBe('charging');
    expect(deriveTrustedVehicleStatus({ ...state, is_charging: false }, trust(['state', 'speed']), now))
      .toBe('driving');
    expect(deriveTrustedVehicleStatus(
      { ...state, is_charging: false, speed: 0 }, trust(['state']), now,
    )).toBe('parked');
  });

  it('returns null — never offline — for an unverified or expired reading', () => {
    const state = { vehicle_id: 1, state: 'parked', is_charging: true } as VehicleState;
    expect(deriveTrustedVehicleStatus(state, trust([]), now)).toBeNull();
    expect(deriveTrustedVehicleStatus(state, trust(['state', 'is_charging'], 'stale'), now)).toBeNull();
    expect(deriveTrustedVehicleStatus(null, trust(['state']), now)).toBeNull();
    expect(deriveTrustedVehicleStatus(state, null, now)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useFleetStates', () => {
  it('reads the whole fleet in ONE request and pairs each vehicle with its state', async () => {
    mockResolvedBatch({ state: 'online' });
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The regression this endpoint exists to kill: one request per vehicle.
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(lastUrl()).toContain('/vehicles/states');
    expect(requestedIds(lastUrl())).toEqual([1, 2]);
    expect(lastOpts().signal).toBeDefined();

    expect(result.current.data?.[0]).toMatchObject({
      vehicle: vehicles[0],
      state: { vehicle_id: 1, state: 'online' },
      outcome: 'resolved',
      freshness: 'fresh',
      stale: false,
      observedAt: Date.parse(FRESH_OBSERVED_AT),
    });
    expect(result.current.data?.[1].state?.vehicle_id).toBe(2);
    expect(result.current.data?.[1].outcome).toBe('resolved');
  });

  it('reads a 120-vehicle fleet with a single request (fleet-scale regression)', async () => {
    mockResolvedBatch({ state: 'online' });
    const vehicles = Array.from({ length: 120 }, (_, i) => makeVehicle(i + 1));
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.length).toBe(120);
    expect(requestedIds(lastUrl())).toHaveLength(120);
    expect(summariseFleetStates(result.current.data ?? [])).toMatchObject({
      total: 120,
      resolvedCount: 120,
      status: 'ok',
    });
  });

  it('chunks a fleet larger than the backend cap instead of truncating it', async () => {
    mockResolvedBatch({ state: 'online' });
    const vehicles = Array.from({ length: 600 }, (_, i) => makeVehicle(i + 1));
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 600 > FLEET_STATE_BATCH_CHUNK, so exactly two requests — and every car
    // still gets an entry. Dropping the tail would look identical to "those
    // 100 vehicles have no state".
    expect(requestMock).toHaveBeenCalledTimes(2);
    const sizes = requestMock.mock.calls.map((call) => requestedIds(call[0] as string).length);
    expect(sizes).toEqual([FLEET_STATE_BATCH_CHUNK, 100]);
    expect(result.current.data?.length).toBe(600);
    expect(summariseFleetStates(result.current.data ?? []).resolvedCount).toBe(600);
  });

  it('preserves backend observation age and never restamps a successful stale response', async () => {
    const observedAt = '2026-08-26T09:00:00Z';
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1, { state: 'online' }, { observed_at: observedAt, freshness: 'stale' }),
    ]));

    const { result } = renderH(() => useFleetStates([makeVehicle(1)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({
      outcome: 'resolved',
      freshness: 'stale',
      stale: true,
      observedAt: Date.parse(observedAt),
    });
    expect(summariseFleetStates(result.current.data ?? [])).toMatchObject({
      resolvedCount: 1,
      unverifiedCount: 1,
      status: 'partial',
      oldestObservedAt: Date.parse(observedAt),
    });
  });

  it('ages a fresh response at the exact observation boundary without another request', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-26T12:00:00Z');
    vi.setSystemTime(now);
    const observedAt = now - TELEMETRY_STALE_AFTER_MS + 1_000;
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1, { state: 'online' }, {
        observed_at: new Date(observedAt).toISOString(),
        freshness: 'fresh',
        verified_fields: ['state'],
      }),
    ]));

    const mounted = renderH(() => useFleetStates([makeVehicle(1)]));
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mounted.result.current.data?.[0].freshness).toBe('fresh');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_001);
      });
      expect(mounted.result.current.data?.[0]).toMatchObject({
        freshness: 'stale',
        stale: true,
      });
      expect(requestMock).toHaveBeenCalledTimes(1);
    } finally {
      mounted.unmount();
      vi.useRealTimers();
    }
  });

  it('treats successful fallback state without an observation timestamp as unknown', async () => {
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1, { state: 'online' }, {
        live: false,
        data_source: 'db_fallback',
        observed_at: null,
        freshness: 'unknown',
        verified_fields: [],
      }),
    ]));

    const { result } = renderH(() => useFleetStates([makeVehicle(1)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({
      outcome: 'resolved',
      freshness: 'unknown',
      stale: true,
      observedAt: null,
    });
    expect(summariseFleetStates(result.current.data ?? [])).toMatchObject({
      unverifiedCount: 1,
      status: 'partial',
      oldestObservedAt: null,
    });
  });

  it('isolates a single failing vehicle without hiding the rest of the fleet', async () => {
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1),
      failedItem(2),
    ]));
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].state?.vehicle_id).toBe(1);
    expect(result.current.data?.[1].state).toBeNull();
    expect(result.current.data?.[1].outcome).toBe('failed');
  });

  it('seeds the single-vehicle cache so widgets do not issue a duplicate read', async () => {
    mockResolvedBatch({ state: 'online' });
    // Real gcTime: seeding writes into an observer-less key, which a
    // zero-gc client would collect before the assertion could read it.
    const client = cacheRetainingClient();
    const { result } = renderH(() => useFleetStates([makeVehicle(1), makeVehicle(2)]), { client });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await waitFor(() => {
      expect(client.getQueryData(vehicleKeys.state(1))).toMatchObject({
        state: { vehicle_id: 1, state: 'online' },
        freshness: 'fresh',
        observedAt: Date.parse(FRESH_OBSERVED_AT),
      });
    });
    // Seeded under the LIVE key (no as_of segment) so the time-machine view is
    // never contaminated by a live batch.
    expect(client.getQueryData(vehicleKeys.state(2))).toBeDefined();
  });

  it('never rolls a newer individual reading back to an older batch reading', async () => {
    const client = cacheRetainingClient();
    const newer = Date.parse(FRESH_OBSERVED_AT) + 60_000;
    client.setQueryData(vehicleKeys.state(1), {
      state: { vehicle_id: 1, state: 'driving' },
      live: true,
      observedAt: newer,
      freshness: 'fresh',
      verifiedFields: ['state'],
    });
    mockResolvedBatch({ state: 'online' });

    const { result } = renderH(() => useFleetStates([makeVehicle(1)]), { client });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await tick(); });

    expect(client.getQueryData(vehicleKeys.state(1))).toMatchObject({
      observedAt: newer,
      state: { vehicle_id: 1, state: 'driving' },
    });
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
// Fleet-state PROVENANCE. Every case below drives the real hook through the
// real request path — no mocked `isError` — because the defect being guarded
// is precisely that a fleet read can look successful while telling the
// operator nothing true. Two failure shapes now exist and must stay distinct:
// a PER-ITEM failure inside a successful batch, and a TRANSPORT failure of the
// batch itself.
describe('useFleetStates — outcome provenance', () => {
  it('rejects on a transport failure instead of resolving to an empty fleet', async () => {
    requestMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // The whole point: a batch we could not read is NOT a successful answer.
    expect(result.current.isSuccess).toBe(false);
    for (const entry of result.current.data ?? []) {
      expect(entry.outcome).toBe('failed');
      expect(entry.state).toBeNull();
      expect(entry.error).toBeInstanceOf(Error);
    }

    const summary = summariseFleetStates(result.current.data ?? []);
    expect(summary).toMatchObject({
      total: 2,
      resolvedCount: 0,
      missingCount: 0,
      failedCount: 2,
      statefulCount: 0,
      unresolvedCount: 2,
      status: 'unavailable',
      oldestObservedAt: null,
    });
  });

  it('marks a per-item empty snapshot as missing, not failed', async () => {
    requestMock.mockImplementation((url: string) =>
      Promise.resolve(batchBody(requestedIds(url).map((id) => missingItem(id)))));
    const vehicles = [makeVehicle(1), makeVehicle(2)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const entry of result.current.data ?? []) {
      expect(entry.outcome).toBe('missing');
      expect(entry.state).toBeNull();
      expect(entry.error).toBeUndefined();
    }

    const summary = summariseFleetStates(result.current.data ?? []);
    expect(summary).toMatchObject({
      resolvedCount: 0,
      missingCount: 2,
      failedCount: 0,
      // Authoritative absence, NOT an outage. Collapsing the two would tell
      // an operator the API is down when the fleet simply has no snapshots.
      status: 'absent',
    });
  });

  it('distinguishes partial success from partial failure in the same batch', async () => {
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1, { state: 'online' }),
      missingItem(2),
      failedItem(3),
    ]));
    const vehicles = [makeVehicle(1), makeVehicle(2), makeVehicle(3)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.map((e) => e.outcome)).toEqual([
      'resolved', 'missing', 'failed',
    ]);

    const summary = summariseFleetStates(result.current.data ?? []);
    expect(summary).toMatchObject({
      total: 3,
      resolvedCount: 1,
      missingCount: 1,
      failedCount: 1,
      statefulCount: 1,
      unresolvedCount: 2,
      status: 'partial',
    });
  });

  it('treats a vehicle the backend omitted entirely as missing, never as offline', async () => {
    // The backend answered; it just carried nothing for vehicle 2. That is an
    // absence of evidence, not evidence the car is dead.
    requestMock.mockResolvedValue(batchBody([resolvedItem(1, { state: 'online' })]));
    const { result } = renderH(() => useFleetStates([makeVehicle(1), makeVehicle(2)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[1]).toMatchObject({
      outcome: 'missing',
      state: null,
      observedAt: null,
    });
    expect(deriveCurrentVehicleStatus(result.current.data?.[1])).toBeNull();
  });

  it('carries only the stable machine code for a per-item failure', async () => {
    requestMock.mockResolvedValue(batchBody([failedItem(1)]));
    const { result } = renderH(() => useFleetStates([makeVehicle(1)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const entry = result.current.data?.[0];
    expect(entry?.outcome).toBe('failed');
    expect(entry?.error?.message).toBe('state_unavailable');
  });

  it('retains the prior real reading when the batch refresh fails', async () => {
    let failing = false;
    requestMock.mockImplementation((url: string) => {
      if (failing) return Promise.reject(new Error('gateway timeout'));
      return Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, { state: 'online' }))));
    });
    const vehicles = [makeVehicle(1)];
    const { result } = renderH(() => useFleetStates(vehicles));
    await waitFor(() => expect(result.current.data?.[0].outcome).toBe('resolved'));
    const firstObservedAt = result.current.data?.[0].observedAt;
    expect(firstObservedAt).toBeTypeOf('number');

    failing = true;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.data?.[0].outcome).toBe('failed'));

    const entry = result.current.data?.[0];
    // The reading survives the blip, but is explicitly no longer confirmed.
    expect(entry?.state).toEqual({ vehicle_id: 1, state: 'online' });
    expect(entry?.stale).toBe(true);
    expect(entry?.error).toBeInstanceOf(Error);
    // The observation instant is NOT restamped — the reading is as old as it
    // ever was.
    expect(entry?.observedAt).toBe(firstObservedAt);

    const summary = summariseFleetStates(result.current.data ?? []);
    expect(summary).toMatchObject({
      resolvedCount: 0,
      failedCount: 1,
      retainedCount: 1,
      statefulCount: 1,
      unresolvedCount: 0,
      status: 'partial',
      oldestObservedAt: firstObservedAt,
    });
  });

  it('never refreshes the displayed observation age across repeated failed polls', async () => {
    // The defect: the wrapper batch used to resolve successfully on every
    // poll, so `query.dataUpdatedAt` advanced every 30 s and the freshness
    // chip showed a green "just now" over readings that had not moved.
    let failing = false;
    requestMock.mockImplementation((url: string) => {
      if (failing) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, { state: 'online' }))));
    });
    const { result } = renderH(() => useFleetStates([makeVehicle(1)]));
    await waitFor(() => expect(result.current.data?.[0].outcome).toBe('resolved'));
    const observedAt = result.current.data?.[0].observedAt;

    failing = true;
    for (let poll = 0; poll < 4; poll += 1) {
      await act(async () => { await result.current.refetch(); });
      // The observation instant does not move, however many times we retry.
      expect(result.current.data?.[0].observedAt).toBe(observedAt);
      expect(summariseFleetStates(result.current.data ?? []).oldestObservedAt)
        .toBe(observedAt);
    }
  });

  it('stamps observedAt only for readings, never for missing or failed entries', async () => {
    requestMock.mockResolvedValue(batchBody([
      resolvedItem(1),
      missingItem(2),
      failedItem(3),
    ]));
    const { result } = renderH(() =>
      useFleetStates([makeVehicle(1), makeVehicle(2), makeVehicle(3)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [resolved, missing, failed] = result.current.data ?? [];
    expect(resolved?.observedAt).toBeTypeOf('number');
    expect(missing?.observedAt).toBeNull();
    expect(failed?.observedAt).toBeNull();
    // Every entry records WHEN the batch ran, even without a reading.
    for (const entry of result.current.data ?? []) {
      expect(entry.receivedAt).toBeTypeOf('number');
    }
  });

  it('keeps an explicit backend "offline" snapshot as a resolved reading', async () => {
    // The ONLY legitimate route to an offline classification.
    requestMock.mockImplementation((url: string) =>
      Promise.resolve(batchBody(requestedIds(url).map((id) =>
        resolvedItem(id, { state: 'offline' }, { live: false })))));
    const { result } = renderH(() => useFleetStates([makeVehicle(1)]));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const entry = result.current.data?.[0];
    expect(entry?.outcome).toBe('resolved');
    expect(entry?.state?.state).toBe('offline');
    expect(summariseFleetStates(result.current.data ?? [])).toMatchObject({
      resolvedCount: 1,
      status: 'ok',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('describeFleetState (shared operational taxonomy)', () => {
  const base: FleetStateEntry = {
    vehicle: makeVehicle(1),
    state: null,
    outcome: 'missing',
    freshness: 'unknown',
    verifiedFields: [],
    stale: false,
    observedAt: null,
    receivedAt: 1_000,
  };

  it('reports pending before any batch has resolved', () => {
    expect(describeFleetState(undefined)).toMatchObject({
      condition: 'pending',
      status: null,
      hasReading: false,
    });
  });

  it('separates missing, failed, and retained-stale', () => {
    expect(describeFleetState(base).condition).toBe('missing');
    expect(describeFleetState({ ...base, outcome: 'failed' }).condition).toBe('failed');
    expect(describeFleetState({
      ...base,
      outcome: 'failed',
      state: { vehicle_id: 1, state: 'online' } as never,
      observedAt: 4_000,
      stale: true,
    })).toMatchObject({ condition: 'stale', status: null, observedAt: 4_000, hasReading: true });
  });

  it('reports a resolved-but-unverified reading as unverified, never offline', () => {
    const descriptor = describeFleetState({
      ...base,
      outcome: 'resolved',
      state: { vehicle_id: 1, state: 'online' } as never,
      freshness: 'stale',
      observedAt: 7_000,
    });
    expect(descriptor).toMatchObject({ condition: 'unverified', status: null, verified: false });
  });

  it('reports a verified reading as live with a usable status', () => {
    const now = Date.now();
    const descriptor = describeFleetState({
      ...base,
      outcome: 'resolved',
      state: { vehicle_id: 1, state: 'parked', is_charging: true } as never,
      freshness: 'fresh',
      verifiedFields: ['state', 'is_charging'],
      observedAt: now - 1_000,
    }, now);
    // Charging outranks the FSM state, exactly as the hero does.
    expect(descriptor).toMatchObject({ condition: 'live', status: 'charging', verified: true });
  });
});

describe('summariseFleetStates', () => {
  const entry = (over: Partial<FleetStateEntry>): FleetStateEntry => ({
    vehicle: makeVehicle(1),
    state: null,
    outcome: 'missing',
    freshness: 'unknown',
    verifiedFields: [],
    stale: false,
    observedAt: null,
    receivedAt: 1_000,
    ...over,
  });

  it('reports empty for a zero-vehicle batch', () => {
    expect(summariseFleetStates([]).status).toBe('empty');
  });

  it('reports ok only when every vehicle resolved fresh', () => {
    const resolved = entry({
      state: { vehicle_id: 1 } as never,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      observedAt: 5_000,
    });
    expect(summariseFleetStates([resolved, resolved]).status).toBe('ok');
  });

  it('reports successful stale or unknown snapshots as partial, never fully current', () => {
    const stale = entry({
      state: { vehicle_id: 1 } as never,
      outcome: 'resolved',
      freshness: 'stale',
      stale: true,
      observedAt: 5_000,
    });
    const unknown = entry({
      state: { vehicle_id: 2 } as never,
      outcome: 'resolved',
      freshness: 'unknown',
      stale: true,
    });
    expect(summariseFleetStates([stale, unknown])).toMatchObject({
      resolvedCount: 2,
      unverifiedCount: 2,
      status: 'partial',
    });
  });

  it('separates a transport outage from an authoritative absence', () => {
    expect(summariseFleetStates([entry({ outcome: 'failed' })]).status).toBe('unavailable');
    expect(summariseFleetStates([entry({ outcome: 'missing' })]).status).toBe('absent');
    // A mixed batch with nothing readable is still an outage: at least one
    // request failed, so we genuinely do not know.
    expect(
      summariseFleetStates([entry({ outcome: 'missing' }), entry({ outcome: 'failed' })]).status,
    ).toBe('unavailable');
  });

  it('counts a retained reading as stateful but not as resolved', () => {
    const retained = entry({
      state: { vehicle_id: 1 } as never,
      outcome: 'failed',
      freshness: 'stale',
      stale: true,
      observedAt: 5_000,
    });
    expect(summariseFleetStates([retained])).toMatchObject({
      resolvedCount: 0,
      retainedCount: 1,
      statefulCount: 1,
      unresolvedCount: 0,
      status: 'partial',
    });
  });

  it('reports the OLDEST observation as the batch freshness', () => {
    const old = entry({
      state: { vehicle_id: 1 } as never,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      observedAt: 1_000,
    });
    const recent = entry({
      state: { vehicle_id: 2 } as never,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      observedAt: 9_000,
    });
    expect(summariseFleetStates([recent, old])).toMatchObject({
      oldestObservedAt: 1_000,
      newestObservedAt: 9_000,
    });
  });

  it('ignores observation instants from entries with no reading', () => {
    expect(summariseFleetStates([entry({ observedAt: 42 })]).oldestObservedAt).toBeNull();
  });

  it('requires field verification and a not-expired observation for current claims', () => {
    const observedAt = 10_000;
    const current = entry({
      state: { vehicle_id: 1 } as never,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      observedAt,
    });

    expect(isFleetStateFieldCurrent(current, 'state', observedAt + 120_000)).toBe(true);
    expect(isFleetStateFieldCurrent(current, 'state', observedAt + 120_001)).toBe(false);
    expect(isFleetStateFieldCurrent(current, 'battery_level', observedAt + 1)).toBe(false);
  });

  it('lets verified charging and movement establish status before the FSM state catches up', () => {
    const charging = entry({
      state: {
        vehicle_id: 1,
        state: 'unknown',
        is_charging: true,
        speed: 0,
      } as VehicleState,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['is_charging'],
      observedAt: Date.now(),
    });
    const driving = entry({
      state: {
        vehicle_id: 1,
        state: 'unknown',
        is_charging: false,
        speed: 12,
      } as VehicleState,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['speed'],
      observedAt: Date.now(),
    });

    expect(deriveCurrentVehicleStatus(charging)).toBe('charging');
    expect(deriveCurrentVehicleStatus(driving)).toBe('driving');
  });

  it('keeps missing, failed, and stale fleet-state readings explicitly unknown', () => {
    const failed = entry({ outcome: 'failed' });
    const stale = entry({
      state: {
        vehicle_id: 1,
        state: 'charging',
        is_charging: true,
      } as VehicleState,
      outcome: 'resolved',
      freshness: 'stale',
      verifiedFields: ['state', 'is_charging'],
      stale: true,
      observedAt: Date.now() - TELEMETRY_STALE_AFTER_MS - 1,
    });

    expect(deriveCurrentVehicleStatus(undefined)).toBeNull();
    expect(deriveCurrentVehicleStatus(failed)).toBeNull();
    expect(deriveCurrentVehicleStatus(stale)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retention across a CHANGING FLEET ID SET.
//
// The fleet-state cache key is derived from the sorted id set, so any change
// in membership — a sync adding a car, a delete removing one — mints a brand
// new key. Retention originally read only the exact `[root, ids]` key, so the
// moment membership changed it found nothing and silently dropped the readings
// for every vehicle that had NOT changed: adding one car to a fleet of ten
// erased the other nine as soon as a refresh failed.
//
// The batch endpoint does not change any of this. It changes only WHERE the
// failure comes from (one transport failure instead of N), so every case below
// still has to hold.
//
// The contract these tests pin:
//   - unchanged vehicles keep their reading (and its ORIGINAL observedAt)
//     across a membership change;
//   - a removed vehicle is never resurrected from an older key;
//   - only fleet-state keys can donate a reading;
//   - the NEWEST reading wins when several cached keys hold one;
//   - nothing crosses a QueryClient boundary (no cross-account bleed).
describe('useFleetStates — retention survives a fleet membership change', () => {
  /** Real gcTime: retention reads the cache, so zero-gc would erase the point. */
  function retentionClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 5 * 60_000 },
        mutations: { retry: false },
      },
    });
  }

  function renderFleet(client: QueryClient, initial: Vehicle[]) {
    return renderHook(({ vs }: { vs: Vehicle[] }) => useFleetStates(vs), {
      wrapper: makeWrapper(client),
      initialProps: { vs: initial },
    });
  }

  function entriesById(data: FleetStateEntry[] | undefined) {
    return new Map((data ?? []).map((e) => [e.vehicle.id, e]));
  }

  it('keeps the readings of unchanged vehicles when a new vehicle joins the fleet', async () => {
    let failing = false;
    requestMock.mockImplementation((url: string) =>
      failing
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, { state: 'online' })))));

    const client = retentionClient();
    const { result, rerender } = renderFleet(client, [makeVehicle(1), makeVehicle(2)]);
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    const before = entriesById(result.current.data);
    expect(before.get(1)?.outcome).toBe('resolved');

    // A sync adds a third car AND the backend goes down at the same moment:
    // a brand-new cache key with nothing in it, plus a total failure.
    failing = true;
    rerender({ vs: [makeVehicle(1), makeVehicle(2), makeVehicle(3)] });
    await waitFor(() => expect(result.current.data?.length).toBe(3));

    const after = entriesById(result.current.data);
    for (const id of [1, 2]) {
      expect(after.get(id)?.outcome).toBe('failed');
      expect(after.get(id)?.stale).toBe(true);
      expect(after.get(id)?.state).toEqual({ vehicle_id: id, state: 'online' });
      // The age keeps growing — a failed refresh never restamps a reading.
      expect(after.get(id)?.observedAt).toBe(before.get(id)?.observedAt);
    }
    // The newcomer has no history, so it honestly has no reading.
    expect(after.get(3)?.outcome).toBe('failed');
    expect(after.get(3)?.state).toBeNull();
    expect(after.get(3)?.observedAt).toBeNull();

    expect(summariseFleetStates(result.current.data ?? [])).toMatchObject({
      total: 3,
      resolvedCount: 0,
      failedCount: 3,
      retainedCount: 2,
      statefulCount: 2,
      unresolvedCount: 1,
      status: 'partial',
    });
  });

  it('never resurrects a vehicle that was removed from the fleet', async () => {
    let failing = false;
    requestMock.mockImplementation((url: string) =>
      failing
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, { state: 'online' })))));

    const client = retentionClient();
    const { result, rerender } = renderFleet(client, [makeVehicle(1), makeVehicle(2)]);
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    failing = true;
    rerender({ vs: [makeVehicle(1)] });
    await waitFor(() => expect(result.current.data?.length).toBe(1));

    const after = entriesById(result.current.data);
    expect([...after.keys()]).toEqual([1]);
    // The deleted car keeps its reading in the OLD cache entry, but it must
    // never leak into a batch it is no longer part of.
    expect(after.has(2)).toBe(false);
    expect(summariseFleetStates(result.current.data ?? []).total).toBe(1);
  });

  it('keeps retaining across repeated membership churn without restamping the age', async () => {
    let failing = false;
    requestMock.mockImplementation((url: string) =>
      failing
        ? Promise.reject(new Error('gateway timeout'))
        : Promise.resolve(batchBody(requestedIds(url).map((id) => resolvedItem(id, { state: 'online' })))));

    const client = retentionClient();
    const { result, rerender } = renderFleet(client, [makeVehicle(1), makeVehicle(2)]);
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    const observedAt = entriesById(result.current.data).get(1)?.observedAt;
    expect(observedAt).toBeTypeOf('number');

    failing = true;
    // Three successive membership changes, each minting a fresh key.
    for (const vs of [
      [makeVehicle(1), makeVehicle(2), makeVehicle(3)],
      [makeVehicle(1), makeVehicle(3)],
      [makeVehicle(1), makeVehicle(3), makeVehicle(4)],
    ]) {
      rerender({ vs });
      await waitFor(() => expect(result.current.data?.length).toBe(vs.length));
      const entry = entriesById(result.current.data).get(1);
      expect(entry?.stale).toBe(true);
      // Hops key to key without ever pretending to be newer than it is.
      expect(entry?.observedAt).toBe(observedAt);
    }
  });

  it('prefers the NEWEST cached reading when several fleet keys hold one', async () => {
    const client = retentionClient();
    // Two historical batches for overlapping id sets. Cache insertion order is
    // deliberately the reverse of observation order, because "most recently
    // written key" is NOT the same question as "newest reading".
    const stale: FleetStateEntry = {
      vehicle: makeVehicle(1),
      state: { vehicle_id: 1, state: 'asleep' } as never,
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      stale: false,
      observedAt: 1_000,
      receivedAt: 1_000,
    };
    const newer: FleetStateEntry = {
      ...stale,
      state: { vehicle_id: 1, state: 'online' } as never,
      observedAt: 9_000,
      receivedAt: 9_000,
    };
    client.setQueryData([FLEET_STATES_QUERY_ROOT, [1, 2]], { entries: [newer], summary: null });
    client.setQueryData([FLEET_STATES_QUERY_ROOT, [1]], { entries: [stale], summary: null });

    requestMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { result } = renderFleet(client, [makeVehicle(1), makeVehicle(3)]);
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    const entry = entriesById(result.current.data).get(1);
    expect(entry?.state).toEqual({ vehicle_id: 1, state: 'online' });
    expect(entry?.observedAt).toBe(9_000);
  });

  it('accepts no donation from a non-fleet-state cache key', async () => {
    const client = retentionClient();
    // A look-alike payload parked under an unrelated root must be invisible:
    // retention is scoped to the fleet-state root precisely so no other query
    // can inject a reading into the fleet view.
    client.setQueryData(['vehicle-state', 1], [{
      vehicle: makeVehicle(1),
      state: { vehicle_id: 1, state: 'online' },
      outcome: 'resolved',
      freshness: 'fresh',
      verifiedFields: ['state'],
      stale: false,
      observedAt: 9_000,
      receivedAt: 9_000,
    }]);

    requestMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { result } = renderFleet(client, [makeVehicle(1)]);
    await waitFor(() => expect(result.current.data?.length).toBe(1));

    expect(result.current.data?.[0].state).toBeNull();
    expect(result.current.data?.[0].observedAt).toBeNull();
  });

  it('never bleeds a reading across QueryClients (session / account boundary)', async () => {
    mockResolvedBatch({ state: 'online' });

    // Account A resolves a reading for vehicle 1.
    const clientA = retentionClient();
    const a = renderFleet(clientA, [makeVehicle(1)]);
    await waitFor(() => expect(a.result.current.data?.[0].outcome).toBe('resolved'));

    // Account B is a different QueryClient — a logout/login mints a new cache,
    // which is exactly what scopes retention to the current identity.
    requestMock.mockRejectedValue(new Error('401'));
    const clientB = retentionClient();
    const b = renderFleet(clientB, [makeVehicle(1)]);
    await waitFor(() => expect(b.result.current.data?.length).toBe(1));

    expect(b.result.current.data?.[0].outcome).toBe('failed');
    expect(b.result.current.data?.[0].state).toBeNull();
    expect(b.result.current.data?.[0].observedAt).toBeNull();
    expect(summariseFleetStates(b.result.current.data ?? []).status).toBe('unavailable');
  });

  it('does not retain for a vehicle whose prior entry carried no reading', async () => {
    // "Missing" is not a reading. Retaining it would turn an authoritative
    // absence into a phantom stale value.
    let missing = true;
    requestMock.mockImplementation((url: string) =>
      missing
        ? Promise.resolve(batchBody(requestedIds(url).map((id) => missingItem(id))))
        : Promise.reject(new Error('boom')));

    const client = retentionClient();
    const { result, rerender } = renderFleet(client, [makeVehicle(1)]);
    await waitFor(() => expect(result.current.data?.[0].outcome).toBe('missing'));

    missing = false;
    rerender({ vs: [makeVehicle(1), makeVehicle(2)] });
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    for (const entry of result.current.data ?? []) {
      expect(entry.outcome).toBe('failed');
      expect(entry.state).toBeNull();
      expect(entry.stale).toBe(false);
    }
    expect(summariseFleetStates(result.current.data ?? []).status).toBe('unavailable');
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
    if (segment === 'specs') {
      expect(lastOpts().body).toBe(JSON.stringify({ confirmed: true }));
    }
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
  it('useWarrantyDetails GETs the selected vehicle warranty route', async () => {
    requestMock.mockResolvedValueOnce({ data: { in_warranty: true }, fetched_at: null });
    const { result } = renderH(() => useWarrantyDetails('5'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/5/warranty');
    expect(lastOpts()).toHaveProperty('signal');
  });

  it('useWarrantyDetails stays idle without a selected vehicle', async () => {
    const { result } = renderH(() => useWarrantyDetails());
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useRefreshWarrantyDetails POSTs the refresh route, invalidates, and toasts', async () => {
    requestMock.mockResolvedValueOnce({ data: {}, fetched_at: '2025-01-01T00:00:00Z' });
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshWarrantyDetails('5'), {
      wrapper: makeWrapper(client),
    });

    await result.current.mutateAsync();

    expect(lastUrl()).toBe('/vehicles/5/warranty/refresh');
    expect(lastOpts().method).toBe('POST');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['warranty-details', '5'] });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'toast.vehicles.warranty.refresh.success',
        expect.any(String),
      ),
    );
  });
});

describe('official vehicle-management partner hooks', () => {
  it('submits pricing to the fixed route with only the opaque payload wrapper', async () => {
    requestMock.mockResolvedValueOnce({ data: { quote: 17 } });
    const { result } = renderH(() => useVehiclePricing());
    const payload = { opaque: { nested: [1, true] } };

    await result.current.mutateAsync({ payload });

    expect(lastUrl()).toBe('/tesla/vehicle-pricing');
    expect(lastOpts().method).toBe('POST');
    expect(JSON.parse(String(lastOpts().body))).toEqual({ payload });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'toast.vehicles.pricing.success',
        expect.any(String),
      ),
    );
  });

  it('reads cached enterprise roles only when a vehicle is selected', async () => {
    requestMock.mockResolvedValueOnce({
      data: { roles: ['fleet_manager'] },
      fetched_at: '2026-08-08T12:00:00Z',
    });
    const { result } = renderH(() => useEnterpriseRoles('5'));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastUrl()).toBe('/vehicles/5/enterprise-roles');
    expect(lastOpts()).toHaveProperty('signal');

    requestMock.mockClear();
    renderH(() => useEnterpriseRoles(undefined));
    await tick();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refreshes enterprise roles explicitly and invalidates the cached GET', async () => {
    requestMock.mockResolvedValueOnce({
      data: { roles: [] },
      fetched_at: '2026-08-08T12:00:00Z',
    });
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRefreshEnterpriseRoles('5'), {
      wrapper: makeWrapper(client),
    });

    await result.current.mutateAsync();

    expect(lastUrl()).toBe('/vehicles/5/enterprise-roles/refresh');
    expect(lastOpts().method).toBe('POST');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['vehicle-enterprise-roles', '5'],
    });
  });

  it('sends the exact payer object with explicit confirmation and invalidates roles', async () => {
    requestMock.mockResolvedValueOnce({ data: { updated: true } });
    const client = makeClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetEnterprisePayer('5'), {
      wrapper: makeWrapper(client),
    });
    const payload = { opaque: { nested: [1, true] } };

    await result.current.mutateAsync({ payload, confirmed: true });

    expect(lastUrl()).toBe('/vehicles/5/enterprise-payer');
    expect(lastOpts().method).toBe('POST');
    expect(lastOpts().requiresLiveMode).toBe(true);
    expect(JSON.parse(String(lastOpts().body))).toEqual({
      payload,
      confirmed: true,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['vehicle-enterprise-roles', '5'],
    });
  });
});
