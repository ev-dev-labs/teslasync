import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { AppSettings, GasPriceStatus } from '@/api/types';

export const settingsKeys = {
  settings: ['settings'] as const,
  authStatus: ['auth-status'] as const,
  vehicles: ['vehicles'] as const,
  gasPriceStatus: ['gas-price-status'] as const,
  carPrefs: (vehicleId: number | null) => ['car-prefs', vehicleId] as const,
};

// ─── Settings ────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.settings,
    queryFn: () => request<AppSettings>('/settings'),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AppSettings) =>
      request<AppSettings>('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.settings }),
  });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

interface AuthStatus {
  authenticated: boolean;
  expires_at?: string;
}

export function useAuthStatus() {
  return useQuery({
    queryKey: settingsKeys.authStatus,
    queryFn: () => request<AuthStatus>('/auth/status'),
  });
}

export function useAuthURL() {
  return useMutation({
    mutationFn: () => request<{ auth_url: string }>('/auth/url'),
  });
}

export function useRefreshAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>('/auth/refresh', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.authStatus }),
  });
}

export function useDisconnectAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>('/auth/disconnect', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.authStatus }),
  });
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

interface Vehicle {
  id: number;
  name: string;
  vin: string;
}

export function useVehicles() {
  return useQuery({
    queryKey: settingsKeys.vehicles,
    queryFn: () => request<Vehicle[]>('/vehicles'),
    select: safeArray,
  });
}
export function useSyncVehicles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ synced: number }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.vehicles }),
  });
}

interface UserPreferenceLatest {
  setting_distance_unit?: string;
  setting_temperature_unit?: string;
  setting_tire_pressure_unit?: string;
}

export function useCarPreferences(vehicleId: number | null) {
  return useQuery({
    queryKey: settingsKeys.carPrefs(vehicleId),
    queryFn: () => request<UserPreferenceLatest>(`/user-preferences/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

// ─── Gas Price ───────────────────────────────────────────────────────────────

export function useGasPriceStatus() {
  return useQuery({
    queryKey: settingsKeys.gasPriceStatus,
    queryFn: () => request<GasPriceStatus>('/gas-price/status'),
    retry: false,
    refetchInterval: 30_000,
  });
}

export function usePollGasPrice() {
  return useMutation({
    mutationFn: () => request<{ status: string }>('/gas-price/poll', { method: 'POST' }),
  });
}

export function useToggleGasPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      request<{ enabled: boolean }>('/gas-price/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus }),
  });
}

export function useUpdateGasPriceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pollInterval: string) =>
      request<{ poll_interval: string }>('/gas-price/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_interval: pollInterval }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus }),
  });
}

// ─── Fleet API / Polling Config ──────────────────────────────────────────────

export function useToggleAPISuspend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suspended: boolean) =>
      request<{ api_suspended: boolean }>('/settings/suspend-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.settings }),
  });
}

export interface PollingConfig {
  vehicle_discovery: boolean;
  charge_state: boolean;
  climate_state: boolean;
  drive_state: boolean;
  location_data: boolean;
  vehicle_state: boolean;
  vehicle_config: boolean;
  on_demand_vehicle_discovery: boolean;
  on_demand_charge_state: boolean;
  on_demand_climate_state: boolean;
  on_demand_drive_state: boolean;
  on_demand_location_data: boolean;
  on_demand_vehicle_state: boolean;
  on_demand_vehicle_config: boolean;
  nearby_charging_sites: boolean;
  release_notes: boolean;
  recent_alerts: boolean;
  service_data: boolean;
  wake_up: boolean;
  commands: boolean;
  telemetry_capture: boolean;
  telemetry_capture_retention_days: number;
  [key: string]: boolean | number;
}

export function usePollingConfig() {
  return useQuery({
    queryKey: ['polling-config'] as const,
    queryFn: () => request<PollingConfig>('/settings/polling-config'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdatePollingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pc: PollingConfig) =>
      request<PollingConfig>('/settings/polling-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pc),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polling-config'] });
      qc.invalidateQueries({ queryKey: ['capture-stats'] });
    },
  });
}

interface CaptureStats {
  mongodb_enabled: boolean;
  total_documents: number;
  distinct_vins: string[];
}

export function useCaptureStats() {
  return useQuery({
    queryKey: ['capture-stats'] as const,
    queryFn: () => request<CaptureStats>('/dev-tools/telemetry-capture/stats'),
    staleTime: 30_000,
  });
}

interface VersionInfo {
  chart_version: string;
  go_version: string;
  os: string;
  arch: string;
  endpoints: Record<string, string>;
}

export function useVersionInfo() {
  return useQuery({
    queryKey: ['version'] as const,
    queryFn: () => request<VersionInfo>('/system/version'),
    staleTime: 60_000,
  });
}
