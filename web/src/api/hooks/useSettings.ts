import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type {
  AppSettings,
  GasPriceStatus,
  GasPriceHistory,
  UpdateCheckResult,
  VersionInfo,
} from '@/api/types';

export const settingsKeys = {
  settings: ['settings'] as const,
  authStatus: ['auth-status'] as const,
  vehicles: ['vehicles'] as const,
  gasPriceStatus: ['gas-price-status'] as const,
  gasPriceHistory: ['gas-price-history'] as const,
  carPrefs: (vehicleId: number | null) => ['car-prefs', vehicleId] as const,
  dashboardLayouts: ['dashboard-layouts'] as const,
};

// ─── Settings ────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.settings,
    queryFn: ({ signal }) => request<AppSettings>('/settings', { signal }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: AppSettings) =>
      request<AppSettings>('/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.settings });
      success('toast.settings.save.success', 'Settings saved');
    },
    onError: (e) => error(e, 'toast.settings.save.error', 'Failed to save settings'),
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
    queryFn: ({ signal }) => request<AuthStatus>('/auth/status', { signal }),
  });
}

export function useAuthURL() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<{ auth_url: string }>('/auth/url', { method: 'POST' }),
    onSuccess: () => {
      success('toast.settings.auth.url.success', 'Auth URL generated');
    },
    onError: (e) => error(e, 'toast.settings.auth.url.error', 'Failed to get auth URL'),
  });
}

export function useRefreshAuth() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<void>('/auth/refresh', { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.authStatus });
      success('toast.settings.auth.refresh.success', 'Auth refreshed');
    },
    onError: (e) => error(e, 'toast.settings.auth.refresh.error', 'Failed to refresh auth'),
  });
}

export function useDisconnectAuth() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<void>('/auth/disconnect', { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.authStatus });
      success('toast.settings.auth.disconnect.success', 'Tesla account disconnected');
    },
    onError: (e) => error(e, 'toast.settings.auth.disconnect.error', 'Failed to disconnect'),
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
    queryFn: ({ signal }) => request<Vehicle[]>('/vehicles', { signal }),
    select: safeArray,
  });
}
export function useSyncVehicles() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<{ synced: number }>('/vehicles/sync', { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.vehicles });
      success('toast.settings.vehicles.sync.success', 'Vehicles synced');
    },
    onError: (e) => error(e, 'toast.settings.vehicles.sync.error', 'Failed to sync vehicles'),
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
    queryFn: ({ signal }) => request<UserPreferenceLatest>(`/user-preferences/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId !== null,
  });
}

// ─── Gas Price ───────────────────────────────────────────────────────────────

export function useGasPriceStatus(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.gasPriceStatus,
    queryFn: ({ signal }) => request<GasPriceStatus>('/gas-price/status', { signal }),
    enabled,
    retry: false,
    refetchInterval: enabled ? INTERVALS.STANDARD : false,
  });
}

export function useGasPriceHistory(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.gasPriceHistory,
    queryFn: ({ signal }) => request<GasPriceHistory[]>('/gas-price/history', { signal }),
    enabled,
    retry: false,
    staleTime: STALE_TIMES.STANDARD,
    select: (rows) => safeArray(rows),
  });
}

export function usePollGasPrice() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () => request<{ status: string }>('/gas-price/poll', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus });
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceHistory });
      success('toast.settings.gasPrice.poll.success', 'Gas prices updated');
    },
    onError: (e) => error(e, 'toast.settings.gasPrice.poll.error', 'Failed to poll gas prices'),
  });
}

export function useToggleGasPrice() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      request<{ enabled: boolean }>('/gas-price/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, enabled) => {
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus });
      success(
        enabled ? 'toast.settings.gasPrice.toggle.enabled' : 'toast.settings.gasPrice.toggle.disabled',
        enabled ? 'Gas price tracking enabled' : 'Gas price tracking disabled',
      );
    },
    onError: (e) => error(e, 'toast.settings.gasPrice.toggle.error', 'Failed to toggle gas price tracking'),
  });
}

export function useUpdateGasPriceConfig() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (pollInterval: string) =>
      request<{ poll_interval: string }>('/gas-price/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_interval: pollInterval }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.gasPriceStatus });
      success('toast.settings.gasPrice.config.success', 'Gas price config updated');
    },
    onError: (e) => error(e, 'toast.settings.gasPrice.config.error', 'Failed to update gas price config'),
  });
}

// ─── Dashboard Layouts ───────────────────────────────────────────────────────

export interface DashboardLayoutsPayload {
  dashboards: unknown[];
  active_id: string;
}

export function useDashboardLayouts() {
  return useQuery({
    queryKey: settingsKeys.dashboardLayouts,
    queryFn: ({ signal }) => request<DashboardLayoutsPayload>('/settings/dashboard-layouts', { signal }),
    staleTime: STALE_TIMES.SLOW,
    retry: 1,
  });
}

export function useSaveDashboardLayouts() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: DashboardLayoutsPayload) =>
      request<DashboardLayoutsPayload>('/settings/dashboard-layouts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      success('toast.settings.dashboardLayouts.success', 'Dashboard layout saved');
    },
    onError: (e) => error(e, 'toast.settings.dashboardLayouts.error', 'Failed to save dashboard layout'),
  });
}

// ─── Fleet API / Polling Config ──────────────────────────────────────────────

export function useToggleAPISuspend() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (suspended: boolean) =>
      request<{ api_suspended: boolean }>('/settings/suspend-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended }),
      }),
    onSuccess: (_data, suspended) => {
      invalidateAndBroadcast(qc, { queryKey: settingsKeys.settings });
      success(
        suspended ? 'toast.settings.api.toggle.suspended' : 'toast.settings.api.toggle.resumed',
        suspended ? 'API suspended' : 'API resumed',
      );
    },
    onError: (e) => error(e, 'toast.settings.api.toggle.error', 'Failed to toggle API suspension'),
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
    queryFn: ({ signal }) => request<PollingConfig>('/settings/polling-config', { signal }),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useUpdatePollingConfig() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
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
      success('toast.settings.polling.success', 'Polling config saved');
    },
    onError: (e) => error(e, 'toast.settings.polling.error', 'Failed to save polling config'),
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
    queryFn: ({ signal }) => request<CaptureStats>('/dev-tools/telemetry-capture/stats', { signal }),
    staleTime: STALE_TIMES.FAST,
  });
}

export function useVersionInfo(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ['version'] as const,
    queryFn: ({ signal }) => request<VersionInfo>('/system/version', { signal }),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: options?.refetchInterval,
  });
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ['update-check'] as const,
    queryFn: ({ signal }) =>
      request<UpdateCheckResult>('/system/update-check', { signal }),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
  });
}
