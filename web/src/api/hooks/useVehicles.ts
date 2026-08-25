import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useAsOfDate, AS_OF_QUERY_PARAM } from '@/hooks/useAsOfDate';
import type { Vehicle } from '@/types/vehicle';
import type {
  EnterprisePayerVariables,
  TeslaJSONValue,
  VehicleInfoEnvelope,
  VehicleManagementResult,
  VehiclePricingVariables,
  VehicleState,
} from '../types';
export { deriveVehicleStatus as getVehicleStatus } from '../types';

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
): { state?: VehicleState; live: boolean } {
  if (res == null || typeof res !== 'object') {
    return { state: undefined, live: false }
  }
  const live = res.live ?? false
  if (res.state && typeof res.state === 'object' && 'vehicle_id' in res.state) {
    return { state: res.state, live }
  }
  const v = res.vehicle
  const p = res.position
  if (!v && !p) return { state: res.state, live }
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
  return { state, live }
}

export function useVehicleState(vehicleId: number, options?: { refetchInterval?: number }) {
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
    // Time-machine reads return historical snapshots that never refetch
    // on their own — interval polling would be wasteful and could mask
    // the historical-mode banner. Live mode preserves the existing
    // STANDARD interval so the live state stays fresh.
    refetchInterval: asOf ? false : (options?.refetchInterval ?? INTERVALS.STANDARD),
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
): Promise<{ state?: VehicleState; live: boolean }> {
  const res = await request<RawStateResponse | null>(`/vehicles/${vehicleId}/state`, { signal })
  return mapVehicleStateResponse(res, vehicleId)
}

/** One fleet-wide snapshot entry: a vehicle paired with its latest live state (or null). */
export interface FleetStateEntry {
  vehicle: Vehicle;
  state: VehicleState | null;
}

/**
 * Batch-fetch the latest live state for every vehicle in the fleet. Powers the
 * Fleet list page's battery-summary panel, status breakdown, and per-card
 * badges from a single query.
 *
 * `fetchVehicleState` is the sanctioned raw helper for batch reads where a
 * per-vehicle hook can't be used (one query fans out to N requests). Each
 * vehicle resolves independently — a single failing vehicle yields a null
 * `state` instead of rejecting the whole batch, so one offline car never
 * blanks the fleet summary. The query key is derived from the sorted id set so
 * it stays stable across re-renders and only refetches when the fleet changes.
 */
export function useFleetStates(vehicles: Vehicle[]) {
  const list = safeArray(vehicles);
  const ids = list.map((v) => v.id).sort((a, b) => a - b);
  return useQuery({
    queryKey: ['fleet-vehicle-states', ids],
    queryFn: ({ signal }) =>
      Promise.all(
        list.map(async (v): Promise<FleetStateEntry> => {
          try {
            const { state } = await fetchVehicleState(v.id, signal);
            return { vehicle: v, state: state ?? null };
          } catch {
            return { vehicle: v, state: null };
          }
        }),
      ),
    enabled: list.length > 0,
    refetchInterval: INTERVALS.STANDARD,
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
