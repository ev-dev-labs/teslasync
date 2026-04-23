import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { Vehicle } from '@/types/vehicle';
import type { VehicleState, VehicleStatus, VehicleLiveState } from '../types';

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
  state: (id: number) => ['vehicle-state', id] as const,
  positions: (id: number) => ['vehicle-positions', id] as const,
};

/** Derives a display-friendly vehicle status from the vehicle record and optional live state. */
export function getVehicleStatus(v: Vehicle, state?: VehicleState | null): VehicleStatus {
  if (state?.is_charging) return 'charging'
  if (state?.speed && state.speed > 0) return 'driving'
  if (v.state === 'online') return 'online'
  if (v.state === 'asleep') return 'asleep'
  return 'offline'
}

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
    select: safeArray,
  });
}

export function useVehicleLiveState(vehicleId: number | string | undefined) {
  return useQuery({
    queryKey: ['vehicle-live-state', vehicleId],
    queryFn: () => request<VehicleLiveState>(`/vehicles/${vehicleId}/live-state`),
    enabled: vehicleId !== undefined && vehicleId !== null && vehicleId !== '',
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

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
    refetchInterval: options?.refetchInterval ?? 30_000,
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
  return useMutation({
    mutationFn: (id: string) => request<Vehicle>(`/vehicles/${id}/wake`, { method: 'POST' }),
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}

export function useSyncVehicles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ synced: number; vehicles: Vehicle[] }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}

export function useWakeVehicle() {
  return useMutation({
    mutationFn: (id: number) => request<{ status: string }>(`/vehicles/${id}/wake`, { method: 'POST' }),
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
    staleTime: 5 * 60_000,
  });
}

export function useRefreshVehicleMobileEnabled(vehicleId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<MobileEnabledData>>(`/vehicles/${vehicleId}/mobile-enabled/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-mobile-enabled', vehicleId] });
    },
  });
}

export function useVehicleOptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-options', vehicleId],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/options`),
    enabled: !!vehicleId,
    staleTime: Infinity,
  });
}

export function useRefreshVehicleOptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/options/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-options', vehicleId] });
    },
  });
}

export function useVehicleSpecs(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-specs', vehicleId],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs`),
    enabled: !!vehicleId,
    staleTime: Infinity,
  });
}

export function useRefreshVehicleSpecs(vehicleId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/specs/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-specs', vehicleId] });
    },
  });
}

// ---------- Vehicle Subscriptions ----------

export function useVehicleSubscriptions(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-subscriptions', vehicleId],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/subscriptions`),
    enabled: !!vehicleId,
    staleTime: 60 * 60_000, // 1 hour — rarely changes
  });
}

export function useRefreshVehicleSubscriptions(vehicleId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/subscriptions/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-subscriptions', vehicleId] });
    },
  });
}

// ---------- Vehicle Upgrades ----------

export function useVehicleUpgrades(vehicleId?: string) {
  return useQuery({
    queryKey: ['vehicle-upgrades', vehicleId],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/upgrades`),
    enabled: !!vehicleId,
    staleTime: 60 * 60_000, // 1 hour — rarely changes
  });
}

export function useRefreshVehicleUpgrades(vehicleId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>(`/vehicles/${vehicleId}/upgrades/refresh`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-upgrades', vehicleId] });
    },
  });
}

// ---------- Warranty Details ----------

export function useWarrantyDetails() {
  return useQuery({
    queryKey: ['warranty-details'],
    queryFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>('/tesla/warranty'),
    staleTime: 24 * 60 * 60_000, // 1 day
  });
}

export function useRefreshWarrantyDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<VehicleInfoEnvelope<Record<string, unknown>>>('/tesla/warranty/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warranty-details'] });
    },
  });
}
