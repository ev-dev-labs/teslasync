import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  buildQueryPath,
  isApiError,
  request,
  setCachedSudoToken,
} from './client';
import type {
  Alert,
  AlertRule,
  ActiveSessionsResponse,
  AppSettings,
  AuditLogEntry,
  AuthModeResponse,
  AuthStatus,
  AuthUrlResponse,
  AvailableSignalsResponse,
  BatteryHealth,
  BatteryDegradationAnalytics,
  ChargeTelemetryReading,
  ChargingSession,
  Drive,
  DriveTelemetryReading,
  EnergyStats,
  FleetAnalytics,
  FleetTelemetryCoverageResponse,
  FleetTelemetryError,
  FleetTelemetryErrorVIN,
  LiveSignalsResponse,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
  QuietHoursWindow,
  RateLimitStatusResponse,
  RegenAnalytics,
  RevokeAllOthersResponse,
  RouteEfficiencyData,
  SleepAnalytics,
  SpeedProfileData,
  SystemHealth,
  SystemStatus,
  TOTPBackupCodesResponse,
  TOTPEnrollment,
  TOTPStatus,
  TCOAnalytics,
  TemperatureImpactData,
  TOTPSudoToken,
  Vehicle,
  VehicleStateResponse,
  VersionInfo,
} from './types';

const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN';

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface VehicleListOptions extends ListOptions {
  vehicle_id?: number | string | null;
}

export interface DateRangeOptions extends VehicleListOptions {
  start?: string;
  end?: string;
}

export interface AnalyticsOptions extends DateRangeOptions {
  days?: number;
}

export interface NotificationFilters extends ListOptions {
  severity?: readonly string[];
  vehicle_id?: readonly number[];
  rule_id?: readonly number[];
  from?: string;
  to?: string;
  read?: boolean;
  archived?: boolean;
  q?: string;
  group_key?: string;
}

export const apiKeys = {
  vehicles: ['vehicles'] as const,
  vehicle: (id: number | string) => ['vehicles', id] as const,
  vehicleState: (id: number | string) => ['vehicles', id, 'state'] as const,
  vehicleEnergy: (id: number | string, days: number) =>
    ['vehicles', id, 'energy', days] as const,
  batteryHealth: (id: number | string) => ['vehicles', id, 'battery'] as const,
  fleetAnalytics: (options: AnalyticsOptions) =>
    ['analytics', 'fleet', options] as const,
  tcoAnalytics: (id: number | string) => ['analytics', 'tco', id] as const,
  sleepAnalytics: (id: number | string, days: number) =>
    ['analytics', 'sleep', id, days] as const,
  regenAnalytics: (id: number | string) => ['analytics', 'regen', id] as const,
  batteryDegradationAnalytics: (id: number | string) =>
    ['analytics', 'battery-degradation', id] as const,
  speedProfile: (id: number | string) =>
    ['analytics', 'speed-profile', id] as const,
  temperatureImpact: (id: number | string) =>
    ['analytics', 'temperature-impact', id] as const,
  routeEfficiency: (id: number | string) =>
    ['analytics', 'route-efficiency', id] as const,
  fleetTelemetryCoverage: ['tesla', 'fleet-telemetry', 'coverage'] as const,
  fleetTelemetryErrorVINs: ['tesla', 'fleet-telemetry', 'error-vins'] as const,
  fleetTelemetryErrors: (vin?: string) =>
    ['tesla', 'fleet-telemetry', 'errors', vin] as const,
  systemAudit: (options: ListOptions) => ['system', 'audit', options] as const,
  availableSignals: (id: number | string) =>
    ['signals', id, 'available'] as const,
  liveSignals: (id: number | string) => ['signals', id, 'live'] as const,
  alerts: ['alerts'] as const,
  alertRules: ['alerts', 'rules'] as const,
  systemStatus: ['system', 'status'] as const,
  systemHealth: ['system', 'health'] as const,
  systemVersion: ['system', 'version'] as const,
  rateLimits: ['system', 'rate-limits'] as const,
  drives: (options: DateRangeOptions) => ['drives', options] as const,
  drive: (id: number | string) => ['drive', id] as const,
  driveTelemetry: (id: number | string) => ['drive', id, 'telemetry'] as const,
  charging: (options: DateRangeOptions) => ['charging', options] as const,
  chargingSession: (id: number | string) => ['charging', id] as const,
  chargeTelemetry: (id: number | string) =>
    ['charging', id, 'telemetry'] as const,
  authMode: ['auth', 'mode'] as const,
  authStatus: ['auth', 'status'] as const,
  sessions: ['auth', 'sessions'] as const,
  totpStatus: ['auth', 'totp'] as const,
  settings: ['settings'] as const,
  notificationChannels: ['notifications', 'channels'] as const,
  notificationLogs: (filters: NotificationFilters) =>
    ['notifications', 'logs', filters] as const,
  notificationStats: ['notifications', 'stats'] as const,
  quietHours: ['notifications', 'quiet-hours'] as const,
};

function isPositiveId(
  id: number | string | null | undefined,
): id is number | string {
  if (typeof id === 'number') {
    return Number.isFinite(id) && id > 0;
  }

  return typeof id === 'string' && id.trim().length > 0;
}

function listPath(path: string, options: DateRangeOptions = {}): string {
  return buildQueryPath(path, {
    vehicle_id: options.vehicle_id ?? undefined,
    limit: options.limit,
    offset: options.offset,
    start: options.start,
    end: options.end,
  });
}

export function buildNotificationLogsPath(
  filters: NotificationFilters = {},
): string {
  return buildQueryPath('/notifications/logs', {
    severity: filters.severity,
    vehicle_id: filters.vehicle_id,
    rule_id: filters.rule_id,
    from: filters.from,
    to: filters.to,
    read: filters.read,
    archived: filters.archived,
    q: filters.q,
    group_key: filters.group_key,
    limit: filters.limit,
    offset: filters.offset,
  });
}

export function buildDriveListPath(options: DateRangeOptions = {}): string {
  return listPath('/drives', options);
}

export function buildChargingListPath(options: DateRangeOptions = {}): string {
  return listPath('/charging', options);
}

export function buildVehicleEnergyPath(
  vehicleId: number | string,
  days = 30,
): string {
  return buildQueryPath(`/vehicles/${vehicleId}/energy`, { days });
}

export function buildFleetAnalyticsPath(
  options: AnalyticsOptions = { days: 30 },
): string {
  return buildQueryPath('/analytics/fleet', {
    days: options.days,
    start: options.start,
    end: options.end,
  });
}

function buildAnalyticsVehiclePath(
  path: string,
  vehicleId: number | string,
): string {
  return buildQueryPath(path, { vehicle_id: vehicleId });
}

export function buildSystemAuditPath(
  options: ListOptions = { limit: 20 },
): string {
  return buildQueryPath('/system/audit', {
    limit: options.limit,
    offset: options.offset,
  });
}

export function buildVehiclePath(vehicleId: number | string): string {
  return `/vehicles/${vehicleId}`;
}

export function buildVehicleStatePath(vehicleId: number | string): string {
  return `/vehicles/${vehicleId}/state`;
}

export function buildDriveDetailPath(driveId: number | string): string {
  return `/drives/${driveId}`;
}

export function buildDriveTelemetryPath(driveId: number | string): string {
  return `/drives/${driveId}/telemetry`;
}

export function buildChargingSessionPath(sessionId: number | string): string {
  return `/charging/${sessionId}`;
}

export function buildChargeTelemetryPath(sessionId: number | string): string {
  return `/charging/${sessionId}/telemetry`;
}

export function useVehicles() {
  return useQuery({
    queryKey: apiKeys.vehicles,
    queryFn: ({ signal }) => request<Vehicle[]>('/vehicles', { signal }),
  });
}

export function useVehicle(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.vehicle(vehicleId)
      : ['vehicles', 'disabled'],
    queryFn: ({ signal }) =>
      request<Vehicle>(buildVehiclePath(vehicleId!), { signal }),
    enabled: isPositiveId(vehicleId),
  });
}

export function useVehicleState(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.vehicleState(vehicleId)
      : ['vehicles', 'state', 'disabled'],
    queryFn: ({ signal }) =>
      request<VehicleStateResponse>(buildVehicleStatePath(vehicleId!), {
        signal,
      }),
    enabled: isPositiveId(vehicleId),
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: apiKeys.alerts,
    queryFn: ({ signal }) =>
      request<Alert[]>(buildQueryPath('/alerts', { limit: 10 }), { signal }),
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: apiKeys.alertRules,
    queryFn: ({ signal }) => request<AlertRule[]>('/alerts/rules', { signal }),
    staleTime: 30_000,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: apiKeys.systemStatus,
    queryFn: ({ signal }) =>
      request<SystemStatus>('/system/status', { signal }),
    staleTime: 15_000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: apiKeys.systemHealth,
    queryFn: ({ signal }) =>
      request<SystemHealth>('/system/health', { signal }),
    staleTime: 15_000,
  });
}

export function useVersionInfo() {
  return useQuery({
    queryKey: apiKeys.systemVersion,
    queryFn: ({ signal }) =>
      request<VersionInfo>('/system/version', { signal }),
    staleTime: 60_000,
  });
}

export function useRateLimitStatus() {
  return useQuery({
    queryKey: apiKeys.rateLimits,
    queryFn: ({ signal }) =>
      request<RateLimitStatusResponse>('/system/rate-limits', { signal }),
    staleTime: 15_000,
  });
}

export function useDrives(options: DateRangeOptions = { limit: 20 }) {
  return useQuery({
    queryKey: apiKeys.drives(options),
    queryFn: ({ signal }) =>
      request<Drive[]>(buildDriveListPath(options), { signal }),
  });
}

export function useDrive(driveId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(driveId)
      ? apiKeys.drive(driveId)
      : ['drive', 'disabled'],
    queryFn: ({ signal }) =>
      request<Drive>(buildDriveDetailPath(driveId!), { signal }),
    enabled: isPositiveId(driveId),
  });
}

export function useDriveTelemetry(driveId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(driveId)
      ? apiKeys.driveTelemetry(driveId)
      : ['drive', 'telemetry', 'disabled'],
    queryFn: ({ signal }) =>
      request<DriveTelemetryReading[]>(buildDriveTelemetryPath(driveId!), {
        signal,
      }),
    enabled: isPositiveId(driveId),
  });
}

export function useChargingSessions(options: DateRangeOptions = { limit: 20 }) {
  return useQuery({
    queryKey: apiKeys.charging(options),
    queryFn: ({ signal }) =>
      request<ChargingSession[]>(buildChargingListPath(options), { signal }),
  });
}

export function useChargingSession(sessionId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(sessionId)
      ? apiKeys.chargingSession(sessionId)
      : ['charging', 'disabled'],
    queryFn: ({ signal }) =>
      request<ChargingSession>(buildChargingSessionPath(sessionId!), {
        signal,
      }),
    enabled: isPositiveId(sessionId),
  });
}

export function useChargeTelemetry(sessionId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(sessionId)
      ? apiKeys.chargeTelemetry(sessionId)
      : ['charging', 'telemetry', 'disabled'],
    queryFn: ({ signal }) =>
      request<ChargeTelemetryReading[]>(buildChargeTelemetryPath(sessionId!), {
        signal,
      }),
    enabled: isPositiveId(sessionId),
  });
}

export function useVehicleEnergy(vehicleId: number | string | null, days = 30) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.vehicleEnergy(vehicleId, days)
      : ['vehicles', 'energy', 'disabled'],
    queryFn: ({ signal }) =>
      request<EnergyStats>(buildVehicleEnergyPath(vehicleId!, days), {
        signal,
      }),
    enabled: isPositiveId(vehicleId),
  });
}

export function useBatteryHealth(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.batteryHealth(vehicleId)
      : ['vehicles', 'battery', 'disabled'],
    queryFn: ({ signal }) =>
      request<BatteryHealth>(`/vehicles/${vehicleId}/battery`, { signal }),
    enabled: isPositiveId(vehicleId),
  });
}

export function useFleetAnalytics(options: AnalyticsOptions = { days: 30 }) {
  return useQuery({
    queryKey: apiKeys.fleetAnalytics(options),
    queryFn: ({ signal }) =>
      request<FleetAnalytics>(buildFleetAnalyticsPath(options), { signal }),
    staleTime: 60_000,
  });
}

export function useTCOAnalytics(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.tcoAnalytics(vehicleId)
      : ['analytics', 'tco', 'disabled'],
    queryFn: ({ signal }) =>
      request<TCOAnalytics>(
        buildAnalyticsVehiclePath('/analytics/tco', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useSleepAnalytics(
  vehicleId: number | string | null,
  days = 30,
) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.sleepAnalytics(vehicleId, days)
      : ['analytics', 'sleep', 'disabled'],
    queryFn: ({ signal }) =>
      request<SleepAnalytics>(
        buildQueryPath('/analytics/sleep', {
          vehicle_id: vehicleId!,
          days,
        }),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useRegenAnalytics(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.regenAnalytics(vehicleId)
      : ['analytics', 'regen', 'disabled'],
    queryFn: ({ signal }) =>
      request<RegenAnalytics>(
        buildAnalyticsVehiclePath('/analytics/regen', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useBatteryDegradationAnalytics(
  vehicleId: number | string | null,
) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.batteryDegradationAnalytics(vehicleId)
      : ['analytics', 'battery-degradation', 'disabled'],
    queryFn: ({ signal }) =>
      request<BatteryDegradationAnalytics>(
        buildAnalyticsVehiclePath('/analytics/battery-degradation', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useSpeedProfile(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.speedProfile(vehicleId)
      : ['analytics', 'speed-profile', 'disabled'],
    queryFn: ({ signal }) =>
      request<SpeedProfileData>(
        buildAnalyticsVehiclePath('/analytics/speed-profile', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useTemperatureImpact(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.temperatureImpact(vehicleId)
      : ['analytics', 'temperature-impact', 'disabled'],
    queryFn: ({ signal }) =>
      request<TemperatureImpactData>(
        buildAnalyticsVehiclePath('/analytics/temperature-impact', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useRouteEfficiency(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.routeEfficiency(vehicleId)
      : ['analytics', 'route-efficiency', 'disabled'],
    queryFn: ({ signal }) =>
      request<RouteEfficiencyData>(
        buildAnalyticsVehiclePath('/analytics/route-efficiency', vehicleId!),
        { signal },
      ),
    enabled: isPositiveId(vehicleId),
  });
}

export function useFleetTelemetryCoverage() {
  return useQuery({
    queryKey: apiKeys.fleetTelemetryCoverage,
    queryFn: async ({ signal }): Promise<FleetTelemetryCoverageResponse> => {
      const payload = await request<FleetTelemetryCoverageResponse>(
        '/tesla/fleet-telemetry/coverage',
        { signal },
      );
      return {
        categories: payload.categories ?? [],
        destination_totals: payload.destination_totals ?? {},
        orphan_fields: payload.orphan_fields ?? [],
      };
    },
    staleTime: 60_000,
  });
}

export function useFleetTelemetryErrorVINs() {
  return useQuery({
    queryKey: apiKeys.fleetTelemetryErrorVINs,
    queryFn: ({ signal }) =>
      request<FleetTelemetryErrorVIN[]>('/tesla/fleet-telemetry/error-vins', {
        signal,
      }),
    staleTime: 60_000,
  });
}

export function useFleetTelemetryErrors(vin?: string) {
  return useQuery({
    queryKey: apiKeys.fleetTelemetryErrors(vin),
    queryFn: ({ signal }) =>
      request<FleetTelemetryError[]>(
        buildQueryPath('/tesla/fleet-telemetry/errors', {
          vin: vin?.trim() ? vin : undefined,
        }),
        { signal },
      ),
    staleTime: 60_000,
  });
}

export function useSystemAudit(options: ListOptions = { limit: 20 }) {
  return useQuery({
    queryKey: apiKeys.systemAudit(options),
    queryFn: ({ signal }) =>
      request<AuditLogEntry[]>(buildSystemAuditPath(options), { signal }),
    staleTime: 30_000,
  });
}

export function useAvailableSignals(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.availableSignals(vehicleId)
      : ['signals', 'available', 'disabled'],
    queryFn: ({ signal }) =>
      request<AvailableSignalsResponse>(`/signals/${vehicleId}/available`, {
        signal,
      }),
    enabled: isPositiveId(vehicleId),
    staleTime: 60_000,
  });
}

export function useLiveSignals(vehicleId: number | string | null) {
  return useQuery({
    queryKey: isPositiveId(vehicleId)
      ? apiKeys.liveSignals(vehicleId)
      : ['signals', 'live', 'disabled'],
    queryFn: ({ signal }) =>
      request<LiveSignalsResponse>(`/signals/${vehicleId}/live`, { signal }),
    enabled: isPositiveId(vehicleId),
    staleTime: 5_000,
  });
}

export function useAuthMode() {
  return useQuery<AuthModeResponse, ApiError>({
    queryKey: apiKeys.authMode,
    queryFn: ({ signal }) =>
      request<AuthModeResponse>('/system/auth-mode', { signal }),
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });
}

export function useAuthStatus() {
  return useQuery<AuthStatus, ApiError>({
    queryKey: apiKeys.authStatus,
    queryFn: ({ signal }) => request<AuthStatus>('/auth/status', { signal }),
    staleTime: 30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: apiKeys.settings,
    queryFn: ({ signal }) => request<AppSettings>('/settings', { signal }),
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation<AppSettings, ApiError, AppSettings>({
    mutationFn: settings =>
      request<AppSettings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.settings }),
  });
}

export function useAuthURL() {
  return useMutation<AuthUrlResponse, ApiError, void>({
    mutationFn: () => request<AuthUrlResponse>('/auth/url', { method: 'POST' }),
  });
}

export function useRefreshAuth() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/auth/refresh', { method: 'POST' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.authStatus }),
  });
}

export function useDisconnectAuth() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/auth/disconnect', { method: 'POST' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.authStatus }),
  });
}

export function useSessions(options?: { enabled?: boolean }) {
  return useQuery<ActiveSessionsResponse, ApiError>({
    queryKey: apiKeys.sessions,
    queryFn: async ({ signal }) => {
      try {
        const payload = await request<{
          mode: 'session';
          sessions?: import('./types').ActiveSession[];
        }>('/auth/sessions', { signal });
        return { mode: 'session', sessions: payload.sessions ?? [] };
      } catch (error) {
        if (isApiError(error) && error.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' };
        }

        throw error;
      }
    },
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: id =>
      request<void>(`/auth/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.sessions }),
  });
}

export function useRevokeAllOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation<RevokeAllOthersResponse, ApiError, void>({
    mutationFn: () =>
      request<RevokeAllOthersResponse>('/auth/sessions/all-others', {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.sessions }),
  });
}

export function useTOTPStatus(options?: { enabled?: boolean }) {
  return useQuery<TOTPStatus, ApiError>({
    queryKey: apiKeys.totpStatus,
    queryFn: async ({ signal }) => {
      try {
        return await request<TOTPStatus>('/auth/totp', { signal });
      } catch (error) {
        if (isApiError(error) && error.code === AUTH_MODE_OPEN_CODE) {
          return { mode: 'open' };
        }

        throw error;
      }
    },
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useTOTPEnroll() {
  const queryClient = useQueryClient();
  return useMutation<TOTPEnrollment, ApiError, void>({
    mutationFn: () =>
      request<TOTPEnrollment>('/auth/totp/enroll', { method: 'POST' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.totpStatus }),
  });
}

export function useTOTPVerify() {
  const queryClient = useQueryClient();
  return useMutation<{ activated: boolean }, ApiError, { code: string }>({
    mutationFn: ({ code }) =>
      request<{ activated: boolean }>('/auth/totp/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.totpStatus }),
  });
}

export function useTOTPStepUp() {
  return useMutation<
    TOTPSudoToken,
    ApiError,
    { code?: string; backup_code?: string }
  >({
    mutationFn: async ({ code, backup_code }) => {
      const body: { code?: string; backup_code?: string } = {};
      if (code) {
        body.code = code;
      }
      if (backup_code) {
        body.backup_code = backup_code;
      }

      const result = await request<TOTPSudoToken>('/auth/totp/sudo', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCachedSudoToken({
        token: result.sudo_token,
        expiresAtMs: new Date(result.expires_at).getTime(),
      });
      return result;
    },
  });
}

export function useTOTPRevoke() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/auth/totp', { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.totpStatus }),
  });
}

export function useTOTPRegenerateBackupCodes() {
  const queryClient = useQueryClient();
  return useMutation<TOTPBackupCodesResponse, ApiError, void>({
    mutationFn: () =>
      request<TOTPBackupCodesResponse>('/auth/totp/backup-codes/regenerate', {
        method: 'POST',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeys.totpStatus }),
  });
}

export function useNotificationChannels() {
  return useQuery({
    queryKey: apiKeys.notificationChannels,
    queryFn: ({ signal }) =>
      request<NotificationChannel[]>('/notifications', { signal }),
  });
}

export function useNotificationLogs(
  filters: NotificationFilters = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: apiKeys.notificationLogs(filters),
    queryFn: ({ signal }) =>
      request<NotificationLog[]>(buildNotificationLogsPath(filters), {
        signal,
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useNotificationStats() {
  return useQuery({
    queryKey: apiKeys.notificationStats,
    queryFn: ({ signal }) =>
      request<NotificationStats>('/notifications/stats', { signal }),
    staleTime: 30_000,
  });
}

export function useQuietHours() {
  return useQuery({
    queryKey: apiKeys.quietHours,
    queryFn: async ({ signal }) => {
      const payload = await request<{ windows?: QuietHoursWindow[] }>(
        '/notifications/quiet-hours',
        { signal },
      );
      return payload.windows ?? [];
    },
    staleTime: 60_000,
  });
}
