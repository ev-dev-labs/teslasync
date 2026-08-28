import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { queryPolicy } from '../queryPolicy';
import { useRefreshInterval } from '@/hooks/useRefreshPolicy';
import { useLiveRecovery } from '@/hooks/useLiveRecovery';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { parseSignalChangeEvent } from '@/hooks/useSSE';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useAsOfDate, AS_OF_QUERY_PARAM } from '@/hooks/useAsOfDate';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import {
  advanceSignalSequence,
  patchFleetStateEntry,
  type SignalSequenceCursor,
} from '@/api/fleetStateSSE';
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

export function resolveVehicleStateFreshness(
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
  const freshness = resolveVehicleStateFreshness(res.freshness, observedAt)
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

/**
 * Raw single-vehicle state read.
 *
 * Still exported and still the right tool for a caller that genuinely needs
 * ONE vehicle outside a React hook (imperative prefetch, a drawer opened for a
 * car that is not in the current fleet page). It is deliberately NOT what
 * {@link useFleetStates} uses any more: fanning this out was N requests per
 * poll, which at fleet scale is the single most expensive thing the SPA does.
 */
export async function fetchVehicleState(
  vehicleId: number,
  signal?: AbortSignal,
): Promise<MappedVehicleStateResponse> {
  const res = await request<RawStateResponse | null>(`/vehicles/${vehicleId}/state`, { signal })
  return mapVehicleStateResponse(res, vehicleId)
}

/* ── Fleet batch current state ───────────────────────────────────────────── */

/** Per-item outcome vocabulary of `GET /vehicles/states`. Mirrors the Go enum. */
export type FleetStateWireOutcome = 'resolved' | 'missing' | 'failed'

/** One vehicle's slot in a `GET /vehicles/states` response. */
interface FleetStateWireItem {
  vehicle_id?: number
  outcome?: string
  state?: VehicleState | null
  live?: boolean
  data_source?: string
  observed_at?: string | null
  freshness?: VehicleStateFreshness
  verified_fields?: string[] | null
  /** Stable machine code (`state_unavailable`); never internal error text. */
  error?: string
}

/** Wire shape of `GET /vehicles/states`. */
interface FleetStateWireBatch {
  now?: string
  total?: number
  limit?: number
  offset?: number
  counts?: { resolved?: number; missing?: number; failed?: number }
  summary?: FleetStateWireSummary | null
  vehicles?: FleetStateWireItem[] | null
}

/**
 * Server-derived Fleet Posture roll-up (snake_case, matching the Go struct
 * tags in `internal/app/fleetstatesvc`).
 *
 * It is computed on the server from the SAME items, the SAME request-level
 * `now` and the SAME trust precedence the items carry, so the panel can paint
 * from it on first frame and can never disagree with the list it summarises.
 */
interface FleetStateWireSummary {
  counted?: number
  verified_count?: number
  attention_count?: number
  operational?: {
    charging?: number
    driving?: number
    parked?: number
    asleep?: number
    online?: number
    offline?: number
    other?: number
  } | null
  attention?: {
    unverified?: number
    stale?: number
    unknown?: number
    missing?: number
    failed?: number
  } | null
  oldest_observed_at?: string | null
  newest_observed_at?: string | null
  observed_count?: number
}

/** Trusted operational status totals from the server summary. */
export interface FleetServerOperationalTotals {
  charging: number
  driving: number
  parked: number
  asleep: number
  online: number
  offline: number
  /** A trusted state outside the backend FSM vocabulary. */
  other: number
}

/**
 * Evidence-problem totals from the server summary.
 *
 * Every one of these is a statement about OUR EVIDENCE, never about the
 * vehicle — which is exactly why `offline` lives in the operational totals and
 * is unreachable from any of these.
 */
export interface FleetServerAttentionTotals {
  /** Stream is fresh, but the deciding field is not backed by a real observation. */
  unverified: number
  /** A real observation exists but is outside the freshness window. */
  stale: number
  /** No real observation at all (durable fallback / legacy values only). */
  unknown: number
  /** The read succeeded and there is authoritatively no state. */
  missing: number
  /** Resolution failed for this vehicle. */
  failed: number
}

/**
 * The server summary, mapped for rendering.
 *
 * Instants are converted to epoch ms (never kept as strings) so panels feed
 * them straight to {@link formatObservationAge} without re-parsing, and
 * unparseable/absent instants become `null` rather than `NaN` or "now".
 */
export interface FleetServerSummary {
  /** Items in the page the summary describes. */
  counted: number
  /** Items carrying a trusted operational status ("N of M verified"). */
  verifiedCount: number
  /** counted - verifiedCount. */
  attentionCount: number
  operational: FleetServerOperationalTotals
  attention: FleetServerAttentionTotals
  /** Oldest REAL observation in the page, or null when there is none. */
  oldestObservedAt: number | null
  /** Newest REAL observation in the page, or null when there is none. */
  newestObservedAt: number | null
  /** Items carrying a real observation instant. */
  observedCount: number
}

/**
 * `handler/v1` writes through the platform `httputil.Respond` envelope
 * (`{data: T}`); handlers still living in `internal/api` write the payload
 * bare. The shared `request()` client cannot unwrap for everyone without
 * breaking the latter, so the unwrap happens here — mirroring
 * `useOperatorConfidence.fetchEnvelope`.
 */
function unwrapEnvelope<T>(body: unknown): T | null {
  if (body == null || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  if ('data' in record) return (record.data ?? null) as T | null
  return body as T
}

/**
 * Backend caps both `vehicle_ids` and `limit` at 500
 * (`fleetstatesvc.MaxLimit`). A fleet larger than that is chunked rather than
 * silently truncated — losing the tail would look exactly like "those vehicles
 * have no state", which is the lie this whole contract exists to prevent.
 */
export const FLEET_STATE_BATCH_CHUNK = 500

function chunk<T>(values: readonly T[], size: number): T[][] {
  if (values.length <= size) return [[...values]]
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/**
 * Read the current state of every supplied vehicle in ONE request (or one per
 * 500-vehicle chunk).
 *
 * Rejects on transport failure — a batch that could not be read is NOT an
 * empty fleet, and returning a success-shaped value here is precisely how a
 * dead backend previously rendered as a confident "everything is offline".
 *
 * Returns the items alongside the SERVER-DERIVED summary. The summary is never
 * recomputed here: re-deriving it in the browser is what allowed the panel and
 * the list to disagree in the first place.
 */
export async function fetchFleetStates(
  vehicleIds: readonly number[],
  signal?: AbortSignal,
): Promise<{ items: FleetStateWireItem[]; summary: FleetServerSummary | null }> {
  const groups = chunk(vehicleIds, FLEET_STATE_BATCH_CHUNK)
  const responses = await Promise.all(
    groups.map(async (group) => {
      const params = new URLSearchParams({
        vehicle_ids: group.join(','),
        limit: String(FLEET_STATE_BATCH_CHUNK),
      })
      const body = await request<unknown>(`/vehicles/states?${params.toString()}`, { signal })
      const batch = unwrapEnvelope<FleetStateWireBatch>(body)
      return {
        items: safeArray(batch?.vehicles ?? undefined) as FleetStateWireItem[],
        summary: mapFleetServerSummary(batch?.summary),
      }
    }),
  )
  return {
    items: responses.flatMap((response) => response.items),
    // A chunked fleet still has ONE posture: the chunk summaries are additive
    // counts plus a min/max over observation instants.
    summary: responses.reduce<FleetServerSummary | null>(
      (merged, response) => mergeFleetServerSummaries(merged, response.summary),
      null,
    ),
  }
}

/** Project the wire summary onto the render-ready shape. */
function mapFleetServerSummary(
  wire: FleetStateWireSummary | null | undefined,
): FleetServerSummary | null {
  if (wire == null || typeof wire !== 'object') return null
  const operational = wire.operational ?? {}
  const attention = wire.attention ?? {}
  return {
    counted: wire.counted ?? 0,
    verifiedCount: wire.verified_count ?? 0,
    attentionCount: wire.attention_count ?? 0,
    operational: {
      charging: operational.charging ?? 0,
      driving: operational.driving ?? 0,
      parked: operational.parked ?? 0,
      asleep: operational.asleep ?? 0,
      online: operational.online ?? 0,
      offline: operational.offline ?? 0,
      other: operational.other ?? 0,
    },
    attention: {
      unverified: attention.unverified ?? 0,
      stale: attention.stale ?? 0,
      unknown: attention.unknown ?? 0,
      missing: attention.missing ?? 0,
      failed: attention.failed ?? 0,
    },
    oldestObservedAt: parseObservedAt(wire.oldest_observed_at),
    newestObservedAt: parseObservedAt(wire.newest_observed_at),
    observedCount: wire.observed_count ?? 0,
  }
}

/** Combine two chunk summaries into the posture of the whole fleet. */
function mergeFleetServerSummaries(
  a: FleetServerSummary | null,
  b: FleetServerSummary | null,
): FleetServerSummary | null {
  if (a == null) return b
  if (b == null) return a
  return {
    counted: a.counted + b.counted,
    verifiedCount: a.verifiedCount + b.verifiedCount,
    attentionCount: a.attentionCount + b.attentionCount,
    operational: {
      charging: a.operational.charging + b.operational.charging,
      driving: a.operational.driving + b.operational.driving,
      parked: a.operational.parked + b.operational.parked,
      asleep: a.operational.asleep + b.operational.asleep,
      online: a.operational.online + b.operational.online,
      offline: a.operational.offline + b.operational.offline,
      other: a.operational.other + b.operational.other,
    },
    attention: {
      unverified: a.attention.unverified + b.attention.unverified,
      stale: a.attention.stale + b.attention.stale,
      unknown: a.attention.unknown + b.attention.unknown,
      missing: a.attention.missing + b.attention.missing,
      failed: a.attention.failed + b.attention.failed,
    },
    oldestObservedAt: minInstant(a.oldestObservedAt, b.oldestObservedAt),
    newestObservedAt: maxInstant(a.newestObservedAt, b.newestObservedAt),
    observedCount: a.observedCount + b.observedCount,
  }
}

function minInstant(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}

function maxInstant(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
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
 *
 * THE shared contract. Fleet Posture, the dashboard hero/widgets and the
 * vehicle list preview all route through it (via this function or
 * {@link deriveTrustedVehicleStatus}) so the same car can never be "Charging"
 * in one panel and "Unknown" in another.
 */
export function deriveCurrentVehicleStatus(
  entry: FleetStateEntry | undefined,
  now = Date.now(),
): VehicleStatus | null {
  // A retained / failed / missing entry is not evidence about the car.
  if (entry == null || entry.outcome !== 'resolved') return null
  return deriveTrustedVehicleStatus(entry.state, entry, now)
}

/**
 * The precedence rule itself, decoupled from the fleet-entry envelope so a
 * single-vehicle caller (dashboard hero widget) applies the IDENTICAL logic to
 * a `useVehicleState` response.
 *
 * Precedence: verified charging → verified positive speed → verified FSM
 * state. Anything unverified, expired, or absent yields `null` (Unknown) — it
 * NEVER falls through to `offline`, because `deriveVehicleStatus(null)` used to
 * do exactly that and turned "we don't know" into "the car is dead".
 */
export function deriveTrustedVehicleStatus(
  state: VehicleState | null | undefined,
  trust: VehicleStateTrustMetadata | null | undefined,
  now = Date.now(),
): VehicleStatus | null {
  if (state == null) return null

  if (isVehicleStateFieldCurrent(trust, 'is_charging', now) && state.is_charging) {
    return 'charging'
  }
  if (isVehicleStateFieldCurrent(trust, 'speed', now) && (state.speed ?? 0) > 0) {
    return 'driving'
  }
  if (!isVehicleStateFieldCurrent(trust, 'state', now)) return null

  return deriveVehicleStatus({
    ...state,
    // Unverified telemetry must not override the verified FSM state.
    is_charging: false,
    speed: 0,
  })
}

/**
 * The operational taxonomy a panel must be able to render without collapsing
 * distinct facts into one badge.
 *
 *   `pending`    — no batch has resolved yet. Not a claim about any vehicle.
 *   `live`       — a verified, currently-fresh reading; `status` is usable.
 *   `unverified` — the backend answered with state, but nothing current backs
 *                  an operational claim (stale stream, durable fallback only).
 *   `stale`      — a prior real reading retained through a failed refresh.
 *   `missing`    — the backend answered and authoritatively has no state.
 *   `failed`     — the read failed and nothing was retained.
 *
 * Note `offline` is NOT a condition here: it is a legitimate `status` value
 * reachable only through `live`, i.e. only when the backend actually said so.
 */
export type FleetStateCondition =
  | 'pending'
  | 'live'
  | 'unverified'
  | 'stale'
  | 'missing'
  | 'failed'

export interface FleetStateDescriptor {
  condition: FleetStateCondition
  /** Non-null only for `live`. Never inferred from an untrusted reading. */
  status: VehicleStatus | null
  /** Backend observation instant of the reading, if any. Never a fetch time. */
  observedAt: number | null
  /** True when an operational claim is currently defensible. */
  verified: boolean
  /** True when SOME reading exists, verified or not. */
  hasReading: boolean
}

/** Classify one fleet entry into the taxonomy above. Pure and unit-testable. */
export function describeFleetState(
  entry: FleetStateEntry | undefined,
  now = Date.now(),
): FleetStateDescriptor {
  if (entry == null) {
    return { condition: 'pending', status: null, observedAt: null, verified: false, hasReading: false }
  }
  const hasReading = entry.state != null
  if (entry.outcome === 'missing') {
    return { condition: 'missing', status: null, observedAt: null, verified: false, hasReading: false }
  }
  if (entry.outcome === 'failed') {
    return {
      condition: hasReading ? 'stale' : 'failed',
      status: null,
      // Retained readings keep their ORIGINAL age so the panel can say how
      // old the data it is still showing actually is.
      observedAt: entry.observedAt,
      verified: false,
      hasReading,
    }
  }
  const status = deriveCurrentVehicleStatus(entry, now)
  if (status == null) {
    return {
      condition: hasReading ? 'unverified' : 'missing',
      status: null,
      observedAt: entry.observedAt,
      verified: false,
      hasReading,
    }
  }
  return { condition: 'live', status, observedAt: entry.observedAt, verified: true, hasReading: true }
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
    resolveVehicleStateFreshness(response.freshness, response.observedAt, now) === 'fresh' &&
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
    // The cached value pairs the entries with the server summary; retention
    // only ever reads the entries.
    const result = query.state.data as FleetStateBatchResult | undefined;
    const entries = safeArray(result?.entries);
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
 * Batch-fetch the latest live state for every vehicle in the fleet in ONE
 * request. Powers Fleet Posture, the fleet list's battery-summary panel, the
 * status breakdown, and the per-card badges.
 *
 * ## Why a batch endpoint
 *
 * This hook used to fan out `fetchVehicleState` once per vehicle. A 100-car
 * fleet on the STANDARD poll issued 200 requests a minute from a single open
 * tab, each repeating the same vehicle lookup, live-store round trip and FSM
 * query. `GET /vehicles/states` collapses that into one request while keeping
 * every per-vehicle fact — including the per-vehicle FAILURE facts —
 * individually addressable. {@link fetchVehicleState} stays exported for
 * legitimate single-vehicle callers.
 *
 * ## Failures are recorded, never success-shaped
 *
 * Two different failures, two different treatments:
 *
 *   - PER-ITEM: the backend answered but could not read one car. That arrives
 *     as `outcome: 'failed'` inside a successful batch, exactly as before.
 *   - TRANSPORT: the batch request itself failed. The query REJECTS, so
 *     `isError` is true. It does not resolve to an array of nulls — that is
 *     precisely how a dead backend previously rendered as a confident
 *     "every vehicle is Offline". The rejection carries the retained entries
 *     (see {@link FleetStatesBatchError}) so the UI can keep showing the last
 *     real readings, correctly labelled `failed` + `stale`, WITHOUT the query
 *     pretending it succeeded.
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
 * ## Live transitions and recovery
 *
 * Charging/Driving/Parked transitions must show up promptly without turning
 * the SSE stream into a refetch storm:
 *
 *   - sequenced `signal_change` events patch canonical independent fields
 *     immediately, then coalesce one authoritative reconciliation;
 *   - aggregate `vehicle_update` events remain the rolling-upgrade and
 *     cross-pod fallback, marking the batch stale at most once per
 *     {@link FLEET_STATE_EVENT_THROTTLE_MS};
 *   - {@link useLiveRecovery} re-reads authoritative state after a reconnect,
 *     because Redis Pub/Sub has no replay;
 *   - the ambient poll remains BOUNDED recovery via {@link useRefreshInterval}
 *     at `standard` priority: it pauses while the tab is hidden, while the
 *     device is offline and while the API is unreachable, and stretches 4×
 *     under Data Saver / 2G.
 *
 * ## Cache sharing
 *
 * Every resolved item seeds `vehicleKeys.state(id)` so dashboard widgets
 * reading a selected vehicle through {@link useVehicleState} are served from
 * the batch instead of issuing a duplicate request. Seeding is guarded: it
 * never overwrites an individually-fetched entry that is NEWER than the batch.
 *
 * The query key is derived from the sorted id set so it stays stable across
 * re-renders and only refetches when the fleet changes.
 *
 * ## Server-derived summary
 *
 * The returned `summary` is the backend's own posture roll-up, computed from
 * the same items against the same request-level instant and the same trust
 * precedence. Panels can use it as the authoritative aggregate for that
 * resolved snapshot, and it is `null` — never a fabricated zeroed object —
 * whenever no batch has resolved, so "we have not asked yet" cannot render as
 * "nothing is verified".
 */
export function useFleetStates(vehicles: Vehicle[]) {
  const queryClient = useQueryClient();
  // Called unconditionally, before any early return, so hook order is stable
  // for every caller regardless of fleet size.
  const refetchInterval = useRefreshInterval(INTERVALS.STANDARD);
  const list = safeArray(vehicles);
  const ids = list.map((v) => v.id).sort((a, b) => a - b);
  const queryKey = [FLEET_STATES_QUERY_ROOT, ids] as const;
  const enabled = list.length > 0;

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<FleetStateBatchResult> => {
      const eligibleIds = new Set(ids);
      const priorById = collectRetainedEntries(queryClient, eligibleIds);
      let batch: Awaited<ReturnType<typeof fetchFleetStates>>;
      try {
        batch = await fetchFleetStates(ids, signal);
      } catch (err) {
        // Transport failure. Reject — but hand the caller the retained
        // readings so trust degrades instead of the panel going blank.
        throw new FleetStatesBatchError(
          list.map((v) => retainedFleetEntry(v, priorById.get(v.id), toFleetError(err))),
          toFleetError(err),
        );
      }

      const receivedAt = Date.now();
      const byId = new Map<number, (typeof batch.items)[number]>();
      for (const item of batch.items) {
        if (typeof item?.vehicle_id === 'number') byId.set(item.vehicle_id, item);
      }
      return {
        entries: list.map((v) => toFleetStateEntry(v, byId.get(v.id), priorById.get(v.id), receivedAt)),
        summary: batch.summary,
      };
    },
    enabled,
    // Live-tier cache policy; retry deliberately stays with the QueryClient.
    ...queryPolicy('live', { refetchInterval }),
  });

  /* ── Recovery: re-read authoritative state after an SSE outage ────────── */
  useLiveRecovery({
    queryKeys: FLEET_STATE_RECOVERY_KEYS,
    enabled,
  });

  /* ── Prompt transitions without a request storm ───────────────────────── */
  // Derived purely from the joined key so the memo has an honest dependency
  // and the identity is stable across re-renders of the same fleet.
  const fleetIdsKey = ids.join(',');
  const fleetIds = useMemo(
    () => new Set(fleetIdsKey === '' ? [] : fleetIdsKey.split(',').map(Number)),
    [fleetIdsKey],
  );
  const fleetIdsRef = useRef(fleetIds);
  fleetIdsRef.current = fleetIds;
  const sequenceRef = useRef<SignalSequenceCursor | null>(null);
  const throttleRef = useRef<{
    timer: number | null;
    lastAt: number;
    vehicleIds: Set<number>;
  }>({ timer: null, lastAt: Date.now(), vehicleIds: new Set() });

  const scheduleAuthoritativeRecovery = useCallback((vehicleIds: Iterable<number>) => {
    const state = throttleRef.current;
    for (const vehicleId of vehicleIds) state.vehicleIds.add(vehicleId);
    if (state.timer != null) return; // already scheduled; coalesce
    const wait = Math.max(0, FLEET_STATE_EVENT_THROTTLE_MS - (Date.now() - state.lastAt));
    state.timer = window.setTimeout(() => {
      state.timer = null;
      state.lastAt = Date.now();
      const recoveringVehicleIds = [...state.vehicleIds];
      state.vehicleIds.clear();

      // The fleet batch is the one authoritative recovery read. Live
      // single-vehicle entries are marked stale without starting duplicate
      // HTTP requests; the successful batch response seeds them immediately.
      for (const vehicleId of recoveringVehicleIds) {
        void queryClient.invalidateQueries({
          queryKey: vehicleKeys.state(vehicleId),
          exact: true,
          refetchType: 'none',
        });
      }
      void queryClient.invalidateQueries({ queryKey: [FLEET_STATES_QUERY_ROOT] });
    }, wait);
  }, [queryClient]);

  const onVehicleUpdate = useCallback((payload: unknown) => {
    // Typed envelope only — a malformed frame must never trigger traffic.
    const vehicleId = readVehicleUpdateId(payload);
    if (vehicleId == null || !fleetIdsRef.current.has(vehicleId)) return;
    scheduleAuthoritativeRecovery([vehicleId]);
  }, [scheduleAuthoritativeRecovery]);

  const onSignalChange = useCallback((payload: unknown) => {
    const event = parseSignalChangeEvent(payload);
    if (event == null) return;

    // Advance BEFORE filtering by vehicle. Sequence numbers are global to the
    // stream, so ignoring another vehicle first would manufacture false gaps.
    const sequence = advanceSignalSequence(sequenceRef.current, event);
    sequenceRef.current = sequence.cursor;
    if (!sequence.accept) return;

    let patchedEntry: FleetStateEntry | null = null;
    let requiresRecovery = sequence.recover;
    queryClient.setQueriesData<FleetStateBatchResult>(
      { queryKey: [FLEET_STATES_QUERY_ROOT] },
      (current) => {
        if (current == null) return current;
        let changed = false;
        const entries = current.entries.map((entry) => {
          const patch = patchFleetStateEntry(entry, event);
          if (patch.kind === 'recover') {
            requiresRecovery = true;
            return entry;
          }
          if (patch.kind !== 'patched') return entry;
          changed = true;
          if (
            patchedEntry == null ||
            (patch.entry.observedAt ?? 0) >= (patchedEntry.observedAt ?? 0)
          ) {
            patchedEntry = patch.entry;
          }
          return patch.entry;
        });
        if (!changed) return current;

        // The server summary and item set are one snapshot. Once an item is
        // patched independently, withdraw the summary until the coalesced
        // authoritative read can replace both atomically.
        return { entries, summary: null };
      },
    );

    if (patchedEntry != null) {
      seedVehicleStateCache(queryClient, patchedEntry);
      requiresRecovery = true;
    }
    if (requiresRecovery) {
      const affected = sequence.recover
        ? fleetIdsRef.current
        : [event.vehicle_id];
      scheduleAuthoritativeRecovery(affected);
    }
  }, [queryClient, scheduleAuthoritativeRecovery]);

  useEffect(() => () => {
    const state = throttleRef.current;
    if (state.timer != null) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
    state.vehicleIds.clear();
  }, []);

  useRealtimeEvents({ onVehicleUpdate, onSignalChange, enabled });

  /* ── Automatic freshness ageing ───────────────────────────────────────── */
  const [freshnessClock, setFreshnessClock] = useState(0);
  const batchError = query.error instanceof FleetStatesBatchError ? query.error : null;
  // A rejected batch supersedes the last successful array: its entries ARE
  // those readings, re-labelled with the honest outcome.
  const settled = batchError ? batchError.entries : query.data?.entries;
  // A failed batch has no server posture: the summary describes a page we
  // could not read, so publishing the previous one would age silently.
  const summary = batchError ? null : (query.data?.summary ?? null);

  useEffect(() => {
    const now = Date.now();
    const nextBoundary = (settled ?? [])
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
  }, [settled, freshnessClock]);

  const data = useMemo(
    () => settled?.map((entry) => {
      if (entry.outcome !== 'resolved' || entry.freshness !== 'fresh') return entry;
      const freshness = resolveVehicleStateFreshness(entry.freshness, entry.observedAt);
      return freshness === 'fresh'
        ? entry
        : { ...entry, freshness, stale: true };
    }),
    [settled, freshnessClock],
  );

  /* ── Seed the per-vehicle cache so widgets do not re-fetch ────────────── */
  useEffect(() => {
    if (!query.isSuccess || query.data == null) return;
    for (const entry of query.data.entries) {
      if (entry.outcome !== 'resolved' || entry.state == null) continue;
      seedVehicleStateCache(queryClient, entry);
    }
  }, [queryClient, query.isSuccess, query.data]);

  return { ...query, data, summary };
}

/**
 * The cached value of one fleet-state batch.
 *
 * The entries and the server summary are stored TOGETHER because they describe
 * the same page at the same instant; splitting them into two cache entries
 * would let a panel render a summary from one poll over the items of another.
 */
interface FleetStateBatchResult {
  entries: FleetStateEntry[];
  summary: FleetServerSummary | null;
}

/**
 * Minimum gap between two SSE-triggered fleet refetches.
 *
 * A moving vehicle emits `vehicle_update` several times a second. Invalidating
 * per event would turn one driving car into a continuous batch-refetch loop,
 * which is worse than the per-vehicle fan-out this endpoint replaced. Two
 * seconds keeps a Charging→Driving transition visibly prompt while capping the
 * cost at one request per throttle window no matter how chatty the fleet is.
 */
export const FLEET_STATE_EVENT_THROTTLE_MS = 2_000;

/** Query keys re-read after an SSE reconnect. Prefix-matched by TanStack. */
const FLEET_STATE_RECOVERY_KEYS = [[FLEET_STATES_QUERY_ROOT], ['vehicle-state']] as const;

/**
 * Transport failure of the whole batch, carrying the readings worth keeping.
 *
 * Modelled as an Error (not a resolved value) so `isError` is TRUE: a batch we
 * could not read must never be indistinguishable from a fleet with no data.
 */
export class FleetStatesBatchError extends Error {
  readonly entries: FleetStateEntry[];
  readonly reason: Error;

  constructor(entries: FleetStateEntry[], reason: Error) {
    super(reason.message);
    this.name = 'FleetStatesBatchError';
    this.entries = entries;
    this.reason = reason;
  }
}

/** Extract a numeric `vehicle_id` from a typed `vehicle_update` SSE payload. */
function readVehicleUpdateId(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const raw = (payload as { vehicle_id?: unknown }).vehicle_id;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Build the entry for a vehicle whose refresh failed: carry the prior reading
 * forward when there is one, with its ORIGINAL observation instant.
 */
function retainedFleetEntry(
  vehicle: Vehicle,
  prior: FleetStateEntry | undefined,
  error: Error,
): FleetStateEntry {
  const receivedAt = Date.now();
  if (prior?.state != null) {
    return {
      vehicle,
      state: prior.state,
      outcome: 'failed',
      freshness: 'stale',
      verifiedFields: prior.verifiedFields,
      stale: true,
      // Carried forward UNCHANGED: the reading is as old as it ever was, and
      // a failed refresh must never reset its age.
      observedAt: prior.observedAt,
      receivedAt,
      error,
    };
  }
  return {
    vehicle,
    state: null,
    outcome: 'failed',
    freshness: 'unknown',
    verifiedFields: [],
    stale: false,
    observedAt: null,
    receivedAt,
    error,
  };
}

/** Project one wire item onto the trust-aware fleet entry the UI consumes. */
function toFleetStateEntry(
  vehicle: Vehicle,
  item: FleetStateWireItem | undefined,
  prior: FleetStateEntry | undefined,
  receivedAt: number,
): FleetStateEntry {
  // A vehicle the backend omitted entirely is an ABSENCE, not a failure: the
  // request succeeded and simply carried nothing for this car.
  if (item == null) {
    return {
      vehicle,
      state: null,
      outcome: 'missing',
      freshness: 'unknown',
      verifiedFields: [],
      stale: false,
      observedAt: null,
      receivedAt,
    };
  }

  if (item.outcome === 'failed') {
    return { ...retainedFleetEntry(vehicle, prior, toFleetError(item.error)), receivedAt };
  }

  const state = item.state ?? null;
  if (item.outcome === 'missing' || state == null) {
    return {
      vehicle,
      state: null,
      outcome: 'missing',
      freshness: 'unknown',
      verifiedFields: [],
      stale: false,
      observedAt: null,
      receivedAt,
    };
  }

  const observedAt = parseObservedAt(item.observed_at);
  const freshness = resolveVehicleStateFreshness(item.freshness, observedAt);
  return {
    vehicle,
    state,
    outcome: 'resolved',
    freshness,
    verifiedFields: parseVerifiedFields(item.verified_fields),
    stale: freshness !== 'fresh',
    observedAt,
    receivedAt,
  };
}

/**
 * Publish a batch reading into the single-vehicle cache.
 *
 * Guarded on `observedAt` so a batch can never roll BACK a newer individual
 * read; both shapes are `MappedVehicleStateResponse`, so this is type-safe
 * rather than a structural coincidence.
 */
function seedVehicleStateCache(queryClient: QueryClient, entry: FleetStateEntry): void {
  if (entry.state == null) return;
  const key = vehicleKeys.state(entry.vehicle.id);
  const existing = queryClient.getQueryData<MappedVehicleStateResponse>(key);
  if (
    existing?.observedAt != null &&
    entry.observedAt != null &&
    existing.observedAt > entry.observedAt
  ) {
    return;
  }
  queryClient.setQueryData<MappedVehicleStateResponse>(key, {
    state: entry.state,
    live: entry.freshness === 'fresh',
    observedAt: entry.observedAt,
    freshness: entry.freshness,
    verifiedFields: entry.verifiedFields,
  });
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
