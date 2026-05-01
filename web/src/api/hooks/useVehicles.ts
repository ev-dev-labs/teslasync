import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState } from '../types';
export { deriveVehicleStatus as getVehicleStatus } from '../types';

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
  state: (id: number) => ['vehicle-state', id] as const,
  positions: (id: number) => ['vehicle-positions', id] as const,
};

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

// useVehicleLiveState removed — vehicle_live_state table dropped (phase-14/13).
// The /vehicles/{id}/live-state endpoint no longer exists.
// Use useVehicleState (reads from SignalStore) or useVehicleLive (SSE) instead.

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => request<Vehicle>(`/vehicles/${id}`),
    enabled: !!id,
  });
}

export function useVehicleState(vehicleId: number, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: vehicleKeys.state(vehicleId),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await request<any>(`/vehicles/${vehicleId}/state`)
      if (res.state && typeof res.state === 'object' && 'vehicle_id' in res.state) {
        return { state: res.state as VehicleState, live: res.live ?? false }
      }
      const v = res.vehicle
      const p = res.position
      if (!v && !p) return { state: res.state, live: res.live ?? false }
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
      return { state, live: res.live ?? false }
    },
    enabled: vehicleId > 0,
    refetchInterval: options?.refetchInterval ?? INTERVALS.STANDARD,
  });
}

export function useVehiclePositions(vehicleId: number, limit = 100) {
  return useQuery({
    queryKey: vehicleKeys.positions(vehicleId),
    queryFn: () => request<import('../types').Position[]>(`/vehicles/${vehicleId}/positions?limit=${limit}`),
    enabled: vehicleId > 0,
    select: safeArray,
  });
}

export function useRefreshVehicle() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: string) => request<Vehicle>(`/vehicles/${id}/wake`, { method: 'POST' }),
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      success('toast.vehicles.refresh.success', 'Vehicle refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.refresh.error', 'Failed to refresh vehicle'),
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      success('toast.vehicles.delete.success', 'Vehicle deleted');
    },
    onError: (e) => error(e, 'toast.vehicles.delete.error', 'Failed to delete vehicle'),
  });
}

export function useSyncVehicles() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      success('toast.vehicles.sync.success', 'Vehicles synced ({{count}} updated)', { count: data.synced });
    },
    onError: (e) => error(e, 'toast.vehicles.sync.error', 'Failed to sync vehicles'),
  });
}

export function useWakeVehicle() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request<{ status: string }>(`/vehicles/${id}/wake`, { method: 'POST' }),
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
    queryFn: () => request<import('../types').MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMotorHistory(vehicleId: number, limit = 200) {
  return useQuery({
    queryKey: ['motor-history', vehicleId, limit],
    queryFn: () => request<import('../types').MotorSnapshot[]>(`/motor?vehicle_id=${vehicleId}&limit=${limit}`),
    enabled: vehicleId > 0,
    select: safeArray,
  });
}

export function useClimateLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => request<import('../types').ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useSecurityLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => request<import('../types').SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLatestTirePressure(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => request<import('../types').TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useChargingTelemetryLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => request<import('../types').ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useMediaLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: () => request<import('../types').MediaSnapshot | null>(`/media/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useLocationSnapshotLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['location-latest', vehicleId],
    queryFn: () => request<import('../types').LocationSnapshot | null>(`/location-snapshots/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useVehicleConfigLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () => request<import('../types').VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

export function useUserPreferenceLatest(vehicleId: number, refetchInterval?: number) {
  return useQuery({
    queryKey: ['user-pref-latest', vehicleId],
    queryFn: () => request<import('../types').UserPreferenceSnapshot | null>(`/user-preferences/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval,
  });
}

/** Raw async function for fetching vehicle state — use in batch queries where hooks can't be used */
export async function fetchVehicleState(vehicleId: number): Promise<{ state?: VehicleState; live: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await request<any>(`/vehicles/${vehicleId}/state`)
  if (res.state && typeof res.state === 'object' && 'vehicle_id' in res.state) {
    return { state: res.state as VehicleState, live: res.live ?? false }
  }
  const v = res.vehicle
  const p = res.position
  if (!v && !p) return { state: res.state, live: res.live ?? false }
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
  return { state, live: res.live ?? false }
}

// ---------- Vehicle Info (mobile enabled, options, specs) ----------

interface VehicleInfoEnvelope<T> {
  data: T | null;
  fetched_at: string | null;
}

interface MobileEnabledData {
  enabled: boolean;
}

export function useVehicleMobileEnabled(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-mobile-enabled', vehicleId],
    queryFn: () => request<VehicleInfoEnvelope<MobileEnabledData>>(`/vehicles/${vehicleId}/mobile-enabled`),
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
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/options`),
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
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs`),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useRefreshVehicleSpecs(vehicleId?: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs/refresh`, { method: 'POST' }),
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
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/subscriptions`),
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
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/upgrades`),
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

export function useWarrantyDetails() {
  return useQuery({
    queryKey: ['warranty-details'],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>('/tesla/warranty'),
    staleTime: STALE_TIMES.DAILY,
  });
}

export function useRefreshWarrantyDetails() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>('/tesla/warranty/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warranty-details'] });
      success('toast.vehicles.warranty.refresh.success', 'Warranty details refreshed');
    },
    onError: (e) => error(e, 'toast.vehicles.warranty.refresh.error', 'Failed to refresh warranty details'),
  });
}
