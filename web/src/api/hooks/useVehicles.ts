import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { queryPolicy } from '../queryPolicy';
import { useRefreshInterval } from '@/hooks/useRefreshPolicy';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useAsOfDate, AS_OF_QUERY_PARAM } from '@/hooks/useAsOfDate';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import type { Vehicle } from '@/types/vehicle';
import type {
  EnterprisePayerVariables,
  TeslaJSONValue,
  VehicleInfoEnvelope,
  VehicleManagementResult,
  VehiclePricingVariables,
  VehicleState,
  VehicleStatus,
} from '../types';
import { deriveVehicleStatus } from '../types';
export { deriveVehicleStatus as getVehicleStatus };

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
  state: (id: number, asOf?: string | null) =>
    asOf ? (['vehicle-state', id, asOf] as const) : (['vehicle-state', id] as const),
  positions: (id: number) => ['vehicle-positions', id] as const,
};

/**
 * Append `?as_of=` to a path when the time-machine
 * URL parameter is set. Returns the path unchanged when the parameter is
 * absent so live-mode callers stay on the existing live read path.
 */
function withAsOf(path: string, asOf: string | null): string {
  if (!asOf) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${AS_OF_QUERY_PARAM}=${encodeURIComponent(asOf)}`
}

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: ({ signal }) => request<Vehicle[]>('/vehicles', { signal }),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

// useVehicleLiveState was removed after vehicle_live_state was dropped.
// The /vehicles/{id}/live-state endpoint no longer exists.
// Use useVehicleState (reads from SignalStore) or useVehicleLive (SSE) instead.

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: ({ signal }) => request<Vehicle>(`/vehicles/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Wire shape of `GET /vehicles/{id}/state`. The backend answers with one of
 * two forms: an already-assembled `state` object (identified by a
 * `vehicle_id` key), OR a `vehicle` + `position` pair the SPA composes into a
 * {@link VehicleState}. Every field is optional so a vehicle whose snapshot
 * has not landed yet decodes without throwing. Snake_case only — the mapping
 * reads the original keys that `camelCaseKeys()` preserves alongside its
 * camelCase aliases.
 */
interface RawStateVehicle {
  id?: number
  state?: string
  is_locked?: boolean
  software_version?: string
}

interface RawStatePosition {
  latitude?: number
  longitude?: number
  speed?: number
  power?: number
  battery_level?: number
  rated_range?: number
  ideal_range?: number
  odometer?: number
  inside_temp?: number
  outside_temp?: number
  is_climate_on?: boolean
}

interface RawStateResponse {
  state?: VehicleState
  live?: boolean
  observed_at?: string | null
  freshness?: VehicleStateFreshness
  verified_fields?: string[] | null
  vehicle?: RawStateVehicle | null
  position?: RawStatePosition | null
  is_charging?: boolean
  charger_power?: number
  charge_rate?: number
  time_to_full_charge?: number
  is_locked?: boolean
  sentry_mode?: boolean
  software_version?: string
}

export type VehicleStateFreshness = 'fresh' | 'stale' | 'unknown'
export type VerifiedVehicleStateField = keyof VehicleState

interface MappedVehicleStateResponse {
  state?: VehicleState
  live: boolean
  observedAt: number | null
  freshness: VehicleStateFreshness
  verifiedFields: readonly VerifiedVehicleStateField[]
}

const VEHICLE_STATE_FIELDS = new Set<VerifiedVehicleStateField>([
  'vehicle_id',
  'state',
  'since',
  'latitude',
  'longitude',
  'heading',
  'speed',
  'power',
  'battery_level',
  'rated_range',
  'ideal_range',
  'odometer',
  'inside_temp',
  'outside_temp',
  'is_climate_on',
  'is_charging',
  'charger_power',
  'charge_rate',
  'time_to_full_charge',
  'is_locked',
  'sentry_mode',
  'software_version',
])

function parseObservedAt(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function stateResponseFreshness(
  raw: VehicleStateFreshness | undefined,
  observedAt: number | null,
  now = Date.now(),
): VehicleStateFreshness {
  if (observedAt == null) return 'unknown'
  if (raw !== 'fresh' && raw !== 'stale') return 'unknown'
  if (raw === 'stale') return 'stale'
  return now - observedAt <= TELEMETRY_STALE_AFTER_MS ? 'fresh' : 'stale'
}

function parseVerifiedFields(raw: string[] | null | undefined): VerifiedVehicleStateField[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(
    (field): field is VerifiedVehicleStateField =>
      typeof field === 'string' && VEHICLE_STATE_FIELDS.has(field as VerifiedVehicleStateField),
  ))]
}

/**
 * Normalises a `GET /vehicles/{id}/state` response into `{ state, live }`.
 * Shared by {@link useVehicleState} and {@link fetchVehicleState} so the
 * two-shape decode and the per-field defaults live in exactly one place.
 *
 * Null-safety: a 204 / JSON-null / non-object body resolves to
 * `{ state: undefined, live: false }` instead of throwing on `res.state`. A
 * vehicle whose snapshot has not arrived yet must render an empty panel, not
 * crash the batch that powers the fleet summary.
 */
function mapVehicleStateResponse(
  res: RawStateResponse | null | undefined,
  vehicleId: number,
): MappedVehicleStateResponse {
  if (res == null || typeof res !== 'object') {
    return {
      state: undefined,
      live: false,
      observedAt: null,
      freshness: 'unknown',
      verifiedFields: [],
    }
  }
  const live = res.live ?? false
  const observedAt = parseObservedAt(res.observed_at)
  const freshness = stateResponseFreshness(res.freshness, observedAt)
  const verifiedFields = parseVerifiedFields(res.verified_fields)
  if (res.state && typeof res.state === 'object' && 'vehicle_id' in res.state) {
    return { state: res.state, live, observedAt, freshness, verifiedFields }
  }
  const v = res.vehicle
  const p = res.position
  if (!v && !p) return { state: res.state, live, observedAt, freshness, verifiedFields }
  const state: VehicleState = {
    vehicle_id: v?.id ?? vehicleId,
    state: v?.state ?? 'offline',
    latitude: p?.latitude ?? 0,
    longitude: p?.longitude ?? 0,
    speed: p?.speed ?? 0,
    power: p?.power ?? 0,
    battery_level: p?.battery_level ?? 0,
    rated_range: p?.rated_range ?? p?.ideal_range ?? 0,
    ideal_range: p?.ideal_range ?? 0,
    odometer: p?.odometer ?? 0,
    inside_temp: p?.inside_temp ?? 0,
    outside_temp: p?.outside_temp ?? 0,
    is_climate_on: p?.is_climate_on ?? false,
    is_charging: res.is_charging ?? false,
    charger_power: res.charger_power ?? 0,
    charge_rate: res.charge_rate ?? 0,
    time_to_full_charge: res.time_to_full_charge ?? 0,
    is_locked: res.is_locked ?? v?.is_locked ?? true,
    sentry_mode: res.sentry_mode ?? false,
    software_version: res.software_version ?? v?.software_version ?? '',
  }
  return { state, live, observedAt, freshness, verifiedFields }
}

export function useVehicleState(
  vehicleId: number,
  options?: { refetchInterval?: number | false },
) {
  const { asOf } = useAsOfDate()
  return useQuery({
    queryKey: vehicleKeys.state(vehicleId, asOf),
    queryFn: async ({ signal }) => {
      const res = await request<RawStateResponse | null>(
        withAsOf(`/vehicles/${vehicleId}/state`, asOf),
        { signal },
      )
      return mapVehicleStateResponse(res, vehicleId)
    },
    enabled: vehicleId > 0,
    // Live-tier caching/retry policy from api/queryPolicy, so this endpoint
    // agrees with every other live read instead of carrying its own numbers.
    ...queryPolicy('live', {
      // Time-machine reads return historical snapshots that never refetch
      // on their own — interval polling would be wasteful and could mask
      // the historical-mode banner. Live mode preserves the existing
      // STANDARD interval so the live state stays fresh.
      //
      // `false` is a meaningful caller value (the connection-aware
      // `useRefreshInterval` returns it while hidden/offline/low-bandwidth),
      // so `??` — not `||` — is what preserves it.
      refetchInterval: asOf ? false : (options?.refetchInterval ?? INTERVALS.STANDARD),
    }),
  });
}

export function useVehiclePositions(vehicleId: number, limit = 100) {
  return useQuery({
    queryKey: vehicleKeys.positions(vehicleId),
    queryFn: ({ signal }) => request<import('../types').Position[]>(`/vehicles/${vehicleId}/positions?limit=${limit}`, { signal }),
    enabled: vehicleId > 0,
    select: safeArray,
  });
}

export function useRefreshVehicle() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: string) => request<Vehicle>(`/vehicles/${id}/wake`, {
      method: 'POST',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      invalidateAndBroadcast(queryClient, { queryKey: vehicleKeys.all });
      success('toast.vehicles.refresh.success', 'Vehicle refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.refresh.error', 'Failed to refresh vehicle'),
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`/vehicles/${id}`, {
      method: 'DELETE',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, { queryKey: vehicleKeys.all });
      success('toast.vehicles.delete.success', 'Vehicle deleted');
    },
    onError: (e) => error(e, 'toast.vehicles.delete.error', 'Failed to delete vehicle'),
  });
}

export function useSyncVehicles() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', {
      method: 'POST',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: (data) => {
      invalidateAndBroadcast(queryClient, { queryKey: vehicleKeys.all });
      success('toast.vehicles.sync.success', 'Vehicles synced ({{count}} updated)', { count: data.synced });
    },
    onError: (e) => error(e, 'toast.vehicles.sync.error', 'Failed to sync vehicles'),
  });
}

export function useWakeVehicle() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<{ status: string }>(`/vehicles/${id}/wake`, {
      method: 'POST',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: () => {
      success('toast.vehicles.wake.success', 'Wake command sent');
    },
    onError: (e) => error(e, 'toast.vehicles.wake.error', 'Failed to wake vehicle'),
  });
}

// Telemetry hooks for vehicle detail page
export function useMotorLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMotorHistory(vehicleId: number, limit = 200, refetchInterval?: number) {
  return useQuery({
    queryKey: ['motor-history', vehicleId, limit],
    queryFn: ({ signal }) => request<import('../types').MotorSnapshot[]>(`/motor?vehicle_id=${vehicleId}&limit=${limit}`, { signal }),
    enabled: vehicleId > 0,
    select: safeArray,
    refetchInterval,
  });
}

/**
 * Live driving-dynamics surface (G-force + pedal usage). Backed by
 * /drive-dynamics/latest, which projects 5 signals
 * (LateralAcceleration, LongitudinalAcceleration, PedalPosition,
 * BrakePedalPos, BrakePedal) from signal.LiveStateReader.LiveState.
 * Replaces the deprecated useSignalObservations hook the
 * GForcePanel + PedalUsage components used to call — the underlying
 * /signals/observations route was removed alongside the
 * signal_observations table after telemetry cleanup, so the panels
 * rendered "No telemetry received yet" forever.
 */
export function useDriveDynamicsLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['drive-dynamics-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').DriveDynamicsSnapshot | null>(`/drive-dynamics/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useClimateLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useSecurityLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLatestTirePressure(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useChargingTelemetryLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMediaLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLocationSnapshotLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['location-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').LocationSnapshot | null>(`/location-snapshots/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useVehicleConfigLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useUserPreferenceLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['user-pref-latest', vehicleId],
    queryFn: ({ signal }) => request<import('../types').UserPreferenceSnapshot | null>(`/user-preferences/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

/** Raw async function for fetching vehicle state — use in batch queries where hooks can't be used */
export async function fetchVehicleState(
  vehicleId: number,
  signal?: AbortSignal,
): Promise<MappedVehicleStateResponse> {
  const res = await request<RawStateResponse | null>(`/vehicles/${vehicleId}/state`, { signal })
  return mapVehicleStateResponse(res, vehicleId)
}

/**
 * Why a fleet entry has (or lacks) a live state.
 *
 * The distinction matters because `state: null` used to mean three
 * operationally different things at once, and every consumer collapsed them
 * into `deriveVehicleStatus(null) === 'offline'`:
 *
 *   - `'resolved'` — the backend returned a snapshot. The only outcome from
 *     which a status may be derived.
 *   - `'missing'`  — the backend answered successfully and explicitly has no
 *     snapshot (204 / null body). The vehicle is not offline; we simply do
 *     not know its state.
 *   - `'failed'`   — the request failed. This is a TRANSPORT fact about us,
 *     not an operational fact about the car. Reporting it as offline told
 *     operators a fleet was dead when the API pod was merely restarting.
 */
export type FleetStateOutcome = 'resolved' | 'missing' | 'failed';

/** One fleet-wide snapshot entry: a vehicle paired with its state + provenance. */
export interface FleetStateEntry {
  vehicle: Vehicle;
  /**
   * The vehicle's live state, or `null` when none is available.
   *
   * NEVER interpret `null` as "offline" — read {@link FleetStateEntry.outcome}
   * first. A real `'offline'` classification requires the backend to have
   * returned a snapshot whose `state` field says so.
   */
  state: VehicleState | null;
  outcome: FleetStateOutcome;
  /**
   * Backend-derived freshness of the newest timestamped live signal.
   * `unknown` means the response carried state but no authoritative signal
   * timestamp (for example a durable fallback); it must never be counted as
   * current merely because the HTTP request just completed.
   */
  freshness: VehicleStateFreshness;
  /**
   * State fields whose last-known values came from timestamped, non-synthetic
   * live signals. Durable fallbacks and legacy warmup restamps stay visible,
   * but are absent here so they cannot back current operational claims.
   */
  verifiedFields: readonly VerifiedVehicleStateField[];
  /**
   * `true` when `state` is not currently confirmed fresh: a retained prior
   * reading, a timestamped stale live response, or state with unknown
   * observation time.
   */
  stale: boolean;
  /**
   * Epoch ms at which the CURRENT `state` was actually obtained from the
   * backend, or `null` when there is no reading.
   *
   * Deliberately distinct from the wrapper query's `dataUpdatedAt`: the batch
   * resolves successfully even when every individual request failed, so
   * `dataUpdatedAt` advances on each poll and a permanently failing fleet
   * rendered as "updated just now" in green. `observedAt` is carried forward
   * UNCHANGED when a reading is retained through a failure, so the displayed
   * age keeps growing for as long as the outage lasts.
   */
  observedAt: number | null;
  /** Epoch ms at which THIS outcome was determined (i.e. this batch ran). */
  receivedAt: number;
  /** Failure reason when `outcome === 'failed'`. */
  error?: Error;
}

/** Aggregate outcome of one fleet-state batch. */
export interface FleetStatesSummary {
  total: number;
  /** Successfully returned snapshots, regardless of signal freshness. */
  resolvedCount: number;
  /** Backend explicitly reported no snapshot. */
  missingCount: number;
  /** Per-vehicle request failures. */
  failedCount: number;
  /** Failed vehicles still rendering a retained prior reading. */
  retainedCount: number;
  /** Successful snapshots whose live-signal freshness is stale or unknown. */
  unverifiedCount: number;
  /** Entries carrying a real reading — fresh or retained. */
  statefulCount: number;
  /** Entries with no reading at all. Never classifiable as a status. */
  unresolvedCount: number;
  /**
   * Oldest `observedAt` among entries that carry a reading — the age a panel
   * must present, because a summary is only as fresh as its stalest member.
   */
  oldestObservedAt: number | null;
  /** Newest `observedAt` among entries that carry a reading. */
  newestObservedAt: number | null;
  /**
   * `empty`       — no vehicles in the batch.
   * `ok`          — every vehicle resolved fresh.
   * `partial`     — some resolved, some missing/failed/retained.
   * `unavailable` — nothing readable AND at least one request failed. A
   *                 transport outage: we do not know anything about the fleet.
   * `absent`      — nothing readable and NOTHING failed. The backend answered
   *                 for every vehicle and authoritatively has no snapshots.
   *                 Operationally very different from `unavailable`, and
   *                 collapsing the two turned "no data yet" into "outage" and
   *                 vice versa.
   */
  status: 'empty' | 'ok' | 'partial' | 'unavailable' | 'absent';
}

/**
 * Roll a batch up into counts a UI can act on honestly.
 *
 * Pure and exported so panels can derive their own state without re-walking
 * the entries, and so the contract is unit-testable without a QueryClient.
 */
export function summariseFleetStates(
  entries: readonly FleetStateEntry[],
): FleetStatesSummary {
  let resolvedCount = 0;
  let missingCount = 0;
  let failedCount = 0;
  let retainedCount = 0;
  let unverifiedCount = 0;
  let oldestObservedAt: number | null = null;
  let newestObservedAt: number | null = null;

  for (const entry of entries) {
    if (entry.outcome === 'resolved') {
      resolvedCount += 1;
      if (
        entry.state != null &&
        (entry.freshness !== 'fresh' || !entry.verifiedFields.includes('state'))
      ) {
        unverifiedCount += 1;
      }
    }

    else if (entry.outcome === 'missing') missingCount += 1;
    else {
      failedCount += 1;
      if (entry.state != null) retainedCount += 1;
    }
    if (entry.state != null && entry.observedAt != null) {
      if (oldestObservedAt == null || entry.observedAt < oldestObservedAt) {
        oldestObservedAt = entry.observedAt;
      }
      if (newestObservedAt == null || entry.observedAt > newestObservedAt) {
        newestObservedAt = entry.observedAt;
      }
    }
  }

  const total = entries.length;
  const statefulCount = resolvedCount + retainedCount;
  const unresolvedCount = total - statefulCount;

  let status: FleetStatesSummary['status'];
  if (total === 0) status = 'empty';
  // Nothing readable: a transport outage and an authoritative "no snapshots"
  // are different facts and must not share a label.
  else if (statefulCount === 0) status = failedCount > 0 ? 'unavailable' : 'absent';
  else if (unresolvedCount > 0 || retainedCount > 0 || unverifiedCount > 0) status = 'partial';
  else status = 'ok';

  return {
    total,
    resolvedCount,
    missingCount,
    failedCount,
    retainedCount,
    unverifiedCount,
    statefulCount,
    unresolvedCount,
    oldestObservedAt,
    newestObservedAt,
    status,
  };
}

export function isFleetStateFieldCurrent(
  entry: FleetStateEntry,
  field: VerifiedVehicleStateField,
  now = Date.now(),
): boolean {
  return entry.outcome === 'resolved' &&
    isVehicleStateFieldCurrent(entry, field, now)
}

/**
 * Derive an operational status only from fields whose live provenance is
 * current. Charging and movement can establish a status even when the generic
 * FSM state has not caught up; a missing, failed, retained, or stale reading
 * remains unknown instead of being mislabeled offline.
 */
export function deriveCurrentVehicleStatus(
  entry: FleetStateEntry | undefined,
): VehicleStatus | null {
  if (entry?.state == null) return null

  if (
    isFleetStateFieldCurrent(entry, 'is_charging') &&
    entry.state.is_charging
  ) {
    return 'charging'
  }
  if (
    isFleetStateFieldCurrent(entry, 'speed') &&
    (entry.state.speed ?? 0) > 0
  ) {
    return 'driving'
  }
  if (!isFleetStateFieldCurrent(entry, 'state')) return null

  return deriveVehicleStatus({
    ...entry.state,
    // Unverified telemetry must not override the verified FSM state.
    is_charging: false,
    speed: 0,
  })
}

type VehicleStateTrustMetadata = Pick<
  MappedVehicleStateResponse,
  'freshness' | 'observedAt' | 'verifiedFields'
>

export function isVehicleStateFieldCurrent(
  response: VehicleStateTrustMetadata | null | undefined,
  field: VerifiedVehicleStateField,
  now = Date.now(),
): boolean {
  // Fleet Telemetry is a sparse change feed, so unchanged fields are not
  // re-emitted. A field is current when its source was a real observation and
  // the vehicle's stream has another real observation inside the freshness
  // window; the field's own change timestamp may legitimately be older.
  return response != null &&
    stateResponseFreshness(response.freshness, response.observedAt, now) === 'fresh' &&
    response.verifiedFields.includes(field)
}

function toFleetError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Vehicle state request failed');
}

/** Root of every fleet-state cache key. Also the prefix used for retention. */
export const FLEET_STATES_QUERY_ROOT = 'fleet-vehicle-states' as const;

/**
 * Collect the newest retained reading per vehicle from EVERY cached
 * fleet-state batch, restricted to the ids we are about to fetch.
 *
 * Retention used to read only the exact `[root, ids]` key, so any change in
 * fleet membership — adding a vehicle, removing one, a sync reordering the set
 * — produced a brand-new key with no previous data and silently dropped the
 * readings for every vehicle that had NOT changed. Adding one car to a fleet
 * of ten erased the other nine the moment a refresh failed.
 *
 * Scope safety:
 *   - only keys under {@link FLEET_STATES_QUERY_ROOT} are considered, so no
 *     unrelated query can donate an entry;
 *   - only the ids in the CURRENT batch are eligible, so a vehicle removed
 *     from the fleet cannot be resurrected from an older key;
 *   - the search runs against the caller's own QueryClient, which is what
 *     scopes it to the current user/auth context — a logout clears that cache,
 *     so no cross-account bleed is possible.
 *
 * "Newest" is decided by `observedAt` (falling back to `receivedAt`), NOT by
 * cache insertion order: a stale key may legitimately hold a newer reading for
 * a vehicle than a more recently written one.
 */
function collectRetainedEntries(
  queryClient: QueryClient,
  eligibleIds: ReadonlySet<number>,
): Map<number, FleetStateEntry> {
  const best = new Map<number, FleetStateEntry>();
  if (eligibleIds.size === 0) return best;

  const cached = queryClient.getQueryCache().findAll({
    queryKey: [FLEET_STATES_QUERY_ROOT],
  });

  for (const query of cached) {
    const entries = safeArray(query.state.data as FleetStateEntry[] | undefined);
    for (const entry of entries) {
      if (entry?.state == null) continue;
      const id = entry.vehicle?.id;
      if (typeof id !== 'number' || !eligibleIds.has(id)) continue;
      const incumbent = best.get(id);
      if (incumbent == null) {
        best.set(id, entry);
        continue;
      }
      const candidateAt = entry.observedAt ?? entry.receivedAt;
      const incumbentAt = incumbent.observedAt ?? incumbent.receivedAt;
      if (candidateAt > incumbentAt) best.set(id, entry);
    }
  }
  return best;
}

/**
 * Batch-fetch the latest live state for every vehicle in the fleet. Powers the
 * Fleet list page's battery-summary panel, status breakdown, and per-card
 * badges from a single query.
 *
 * `fetchVehicleState` is the sanctioned raw helper for batch reads where a
 * per-vehicle hook can't be used (one query fans out to N requests). Each
 * vehicle resolves independently — a single failing vehicle must not reject
 * the whole batch, so one unreachable car never blanks the fleet summary.
 *
 * ## Failures are recorded, not success-shaped
 *
 * Every per-vehicle rejection used to become `{ state: null }`, which made the
 * batch indistinguishable from a successful "no snapshot yet" response and
 * left `isError` permanently `false`. A total API outage therefore rendered as
 * a confident, fully-populated "every vehicle is Offline" fleet view. Each
 * entry now carries its {@link FleetStateOutcome} (and the error), and
 * {@link summariseFleetStates} exposes the aggregate.
 *
 * ## Retained prior readings
 *
 * When a refresh fails for a vehicle we previously resolved, the last real
 * reading is carried forward with `outcome: 'failed'` + `stale: true` and its
 * ORIGINAL `observedAt`, so a transient blip degrades trust instead of erasing
 * data the operator was already looking at. Retention scans every cached
 * fleet-state batch (see {@link collectRetainedEntries}) rather than only the
 * exact current key, because a change in fleet membership mints a new key and
 * would otherwise drop the readings for every unchanged vehicle.
 *
 * ## Refresh policy
 *
 * The fan-out is N requests per tick, which makes it the most expensive poll
 * on the page and the least useful one to run against a dead backend. The
 * cadence therefore goes through {@link useRefreshInterval} at `standard`
 * priority: it pauses while the tab is hidden, while the device is offline and
 * while the API is unreachable, and stretches 4× under Data Saver / 2G.
 * Recovery is unaffected — SSE reconnect and mutation invalidation both
 * refetch explicitly regardless of the interval.
 *
 * The query key is derived from the sorted id set so it stays stable across
 * re-renders and only refetches when the fleet changes.
 */
export function useFleetStates(vehicles: Vehicle[]) {
  const queryClient = useQueryClient();
  // Called unconditionally, before any early return, so hook order is stable
  // for every caller regardless of fleet size.
  const refetchInterval = useRefreshInterval(INTERVALS.STANDARD);
  const list = safeArray(vehicles);
  const ids = list.map((v) => v.id).sort((a, b) => a - b);
  const queryKey = [FLEET_STATES_QUERY_ROOT, ids] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const eligibleIds = new Set(ids);
      const priorById = collectRetainedEntries(queryClient, eligibleIds);
      const receivedAt = Date.now();
      return Promise.all(
        list.map(async (v): Promise<FleetStateEntry> => {
          try {
            const {
              state,
              observedAt,
              freshness,
              verifiedFields,
            } = await fetchVehicleState(v.id, signal);
            if (state == null) {
              // Successful response, no snapshot. Explicitly NOT offline.
              return {
                vehicle: v,
                state: null,
                outcome: 'missing',
                freshness: 'unknown',
                verifiedFields: [],
                stale: false,
                observedAt: null,
                receivedAt,
              };
            }
            return {
              vehicle: v,
              state,
              outcome: 'resolved',
              freshness,
              verifiedFields,
              stale: freshness !== 'fresh',
              observedAt,
              receivedAt,
            };
          } catch (err) {
            const prior = priorById.get(v.id);
            if (prior?.state != null) {
              return {
                vehicle: v,
                state: prior.state,
                outcome: 'failed',
                freshness: 'stale',
                verifiedFields: prior.verifiedFields,
                stale: true,
                // Carried forward UNCHANGED: the reading is as old as it ever
                // was, and a failed refresh must never reset its age.
                observedAt: prior.observedAt,
                receivedAt,
                error: toFleetError(err),
              };
            }
            return {
              vehicle: v,
              state: null,
              outcome: 'failed',
              freshness: 'unknown',
              verifiedFields: [],
              stale: false,
              observedAt: null,
              receivedAt,
              error: toFleetError(err),
            };
          }
        }),
      );
    },
    enabled: list.length > 0,
    // Live-tier cache policy; retry deliberately stays with the QueryClient.
    ...queryPolicy('live', { refetchInterval }),
  });

  const [freshnessClock, setFreshnessClock] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const nextBoundary = (query.data ?? [])
      .filter((entry) =>
        entry.outcome === 'resolved' &&
        entry.freshness === 'fresh' &&
        entry.observedAt != null,
      )
      .reduce<number | null>((earliest, entry) => {
        if (entry.observedAt == null) return earliest;
        const boundary = entry.observedAt + TELEMETRY_STALE_AFTER_MS;
        if (boundary < now) return earliest;
        return earliest == null || boundary < earliest ? boundary : earliest;
      }, null);
    if (nextBoundary == null) return undefined;

    const timer = window.setTimeout(
      () => setFreshnessClock((version) => version + 1),
      Math.max(1, nextBoundary - now + 1),
    );
    return () => window.clearTimeout(timer);
  }, [query.data, freshnessClock]);

  const data = useMemo(
    () => query.data?.map((entry) => {
      if (entry.outcome !== 'resolved' || entry.freshness !== 'fresh') return entry;
      const freshness = stateResponseFreshness(entry.freshness, entry.observedAt);
      return freshness === 'fresh'
        ? entry
        : { ...entry, freshness, stale: true };
    }),
    [query.data, freshnessClock],
  );

  return { ...query, data };
}

// ---------- Vehicle Info (mobile enabled, options, specs) ----------

interface MobileEnabledData {
  enabled: boolean;
}

export function useVehicleMobileEnabled(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-mobile-enabled', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<MobileEnabledData>>(`/vehicles/${vehicleId}/mobile-enabled`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshVehicleMobileEnabled(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<MobileEnabledData>>(`/vehicles/${vehicleId}/mobile-enabled/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-mobile-enabled', vehicleId] });
      success('toast.vehicles.mobileEnabled.refresh.success', 'Mobile access status refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.mobileEnabled.refresh.error', 'Failed to refresh mobile access'),
  });
}

export function useVehicleOptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-options', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/options`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshVehicleOptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/options/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-options', vehicleId] });
      success('toast.vehicles.options.refresh.success', 'Vehicle options refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.options.refresh.error', 'Failed to refresh options'),
  });
}

export function useVehicleSpecs(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-specs', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshVehicleSpecs(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs/refresh`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-specs', vehicleId] });
      success('toast.vehicles.specs.refresh.success', 'Vehicle specs refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.specs.refresh.error', 'Failed to refresh specs'),
  });
}

// ---------- Vehicle Subscriptions ----------

export function useVehicleSubscriptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-subscriptions', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/subscriptions`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.RARE,
  });
}

export function useRefreshVehicleSubscriptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/subscriptions/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-subscriptions', vehicleId] });
      success('toast.vehicles.subscriptions.refresh.success', 'Subscriptions refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.subscriptions.refresh.error', 'Failed to refresh subscriptions'),
  });
}

// ---------- Vehicle Upgrades ----------

export function useVehicleUpgrades(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-upgrades', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/upgrades`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.RARE,
  });
}

export function useRefreshVehicleUpgrades(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/upgrades/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-upgrades', vehicleId] });
      success('toast.vehicles.upgrades.refresh.success', 'Upgrades refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.upgrades.refresh.error', 'Failed to refresh upgrades'),
  });
}

// ---------- Warranty Details ----------

export function useWarrantyDetails(vehicleId?: string) {
  return useQuery({
    queryKey: ['warranty-details', vehicleId],
    queryFn: ({ signal }) => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/warranty`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.DAILY,
  });
}

export function useRefreshWarrantyDetails(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/warranty/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warranty-details', vehicleId] });
      success('toast.vehicles.warranty.refresh.success', 'Warranty details refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.warranty.refresh.error', 'Failed to refresh warranty details'),
  });
}

// ---------- Official Vehicle Management: pricing + enterprise ----------

export function useVehiclePricing() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ payload }: VehiclePricingVariables) =>
      request<VehicleManagementResult>('/tesla/vehicle-pricing', {
        method: 'POST',
        body: JSON.stringify({ payload }),
      }),
    onSuccess: () => {
      success(
        'toast.vehicles.pricing.success',
        'Tesla vehicle pricing query completed',
      );
    },
    onError: (e) =>
      error(
        e,
        'toast.vehicles.pricing.error',
        'Failed to query Tesla vehicle pricing',
      ),
  });
}

export function useEnterpriseRoles(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-enterprise-roles', vehicleId],
    queryFn: ({ signal }) =>
      request<VehicleInfoEnvelope<TeslaJSONValue>>(
        `/vehicles/${vehicleId}/enterprise-roles`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.RARE,
  });
}

export function useRefreshEnterpriseRoles(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<VehicleInfoEnvelope<TeslaJSONValue>>(
        `/vehicles/${vehicleId}/enterprise-roles/refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['vehicle-enterprise-roles', vehicleId],
      });
      success(
        'toast.vehicles.enterpriseRoles.refresh.success',
        'Enterprise roles refreshed',
      );
    },
    onError: (e) =>
      error(
        e,
        'toast.vehicles.enterpriseRoles.refresh.error',
        'Failed to refresh enterprise roles',
      ),
  });
}

export function useSetEnterprisePayer(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ payload, confirmed }: EnterprisePayerVariables) =>
      request<VehicleManagementResult>(
        `/vehicles/${vehicleId}/enterprise-payer`,
        {
          method: 'POST',
          requiresLiveMode: true,
          body: JSON.stringify({ payload, confirmed }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['vehicle-enterprise-roles', vehicleId],
      });
      success(
        'toast.vehicles.enterprisePayer.success',
        'Enterprise payer updated',
      );
    },
    onError: (e) =>
      error(
        e,
        'toast.vehicles.enterprisePayer.error',
        'Failed to update enterprise payer',
      ),
  });
}
