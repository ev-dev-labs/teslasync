import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useToast } from '@/components/feedback/Toast';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
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
  const toast = useToast();
  return useMutation({
    mutationFn: (data: AppSettings) =>
      request<AppSettings>('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.settings });
      toast.success('Settings saved');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save settings');
    },
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
  const toast = useToast();
  return useMutation({
    mutationFn: () => request<{ auth_url: string }>('/auth/url', { method: 'POST' }),
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to get auth URL');
    },
  });
}

export function useRefreshAuth() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request<void>('/auth/refresh', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.authStatus });
      toast.success('Auth refreshed');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to refresh auth');
    },
  });
}

export function useDisconnectAuth() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () => request<void>('/auth/disconnect', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.authStatus });
      toast.success('Tesla account disconnected');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to disconnect');
    },
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
  const toast = useToast();
  return useMutation({
    mutationFn: () => request<{ synced: number }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.vehicles });
      toast.success('Vehicles synced');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to sync vehicles');
    },
  });
}

interface UserPreferenceLatest {
  setting_distance_unit?: string;
  setting_temperature_unit?: string;
  setting_tire_pressure_unit?: string;
  setting_24hr_time?: boolean;
}

export function useCarPreferences(vehicleId: number | null) {
  return useQuery({
    queryKey: settingsKeys.carPrefs(vehicleId),
    queryFn: () => request<UserPreferenceLatest>(`/user-preferences/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

// ─── Gas Price ───────────────────────────────────────────────────────────────

export function useGasPriceStatus(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.gasPriceStatus,
    queryFn: () => request<GasPriceStatus>('/gas-price/status'),
    enabled,
    retry: false,
    refetchInterval: enabled ? INTERVALS.STANDARD : false,
  });
}

export function usePollGasPrice() {
  const toast = useToast();
  return useMutation({
    mutationFn: () => request<{ status: string }>('/gas-price/poll', { method: 'POST' }),
    onSuccess: () => {
      toast.success('Gas prices updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to poll gas prices');
    },
  });
}

export function useToggleGasPrice() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      request<{ enabled: boolean }>('/gas-price/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, enabled) => {
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus });
      toast.success(enabled ? 'Gas price tracking enabled' : 'Gas price tracking disabled');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to toggle gas price tracking');
    },
  });
}

export function useUpdateGasPriceConfig() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (pollInterval: string) =>
      request<{ poll_interval: string }>('/gas-price/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_interval: pollInterval }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus });
      toast.success('Gas price config updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update gas price config');
    },
  });
}

// ─── Fleet API / Polling Config ──────────────────────────────────────────────

export function useToggleAPISuspend() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (suspended: boolean) =>
      request<{ api_suspended: boolean }>('/settings/suspend-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended }),
      }),
    onSuccess: (_data, suspended) => {
      qc.invalidateQueries({ queryKey: settingsKeys.settings });
      toast.success(suspended ? 'API suspended' : 'API resumed');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to toggle API suspension');
    },
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
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useUpdatePollingConfig() {
  const qc = useQueryClient();
  const toast = useToast();
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
      toast.success('Polling config saved');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to save polling config');
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
    staleTime: STALE_TIMES.FAST,
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
    staleTime: STALE_TIMES.STANDARD,
  });
}
