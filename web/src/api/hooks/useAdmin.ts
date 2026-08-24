import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
import type {
  APIKey, APICallLog, APICallLogStats, BackupConfig, BackupRun,
  SystemHealth, AuditLogEntry, SecurityEvent, DBStats, MigrationStatus,
  ConnectionPool, ExportJob, VehicleState, StateTransition,
  WebErrorsSummary, MaintenanceState, MaintenanceUpdateInput,
  RuntimeStatusSnapshot,
} from '@/types/admin';
import type { ExtendedHealthResponse } from '@/api/types';

export const adminKeys = {
  apiKeys: ['api-keys'] as const,
  apiLogs: (page: number) => ['api-logs', page] as const,
  apiLogStats: ['api-log-stats'] as const,
  backupConfigs: ['backup-configs'] as const,
  backupRuns: ['backup-runs'] as const,
  systemHealth: ['system-health'] as const,
  extendedHealth: ['system-status', 'extended-health'] as const,
  runtimeStatus: ['runtime-status'] as const,
  auditLogs: ['audit-logs'] as const,
  securityEvents: (vehicleId: string) => ['security-events', vehicleId] as const,
  dbStats: ['db-stats'] as const,
  migrations: ['migrations'] as const,
  connectionPool: ['connection-pool'] as const,
  exportJobs: ['export-jobs'] as const,
  vehicleState: (vehicleId: string) => ['vehicle-state', vehicleId] as const,
  stateTimeline: (vehicleId: string) => ['state-timeline', vehicleId] as const,
  webErrorsSummary: ['admin', 'web-errors-summary'] as const,
  maintenance: ['admin', 'maintenance'] as const,
};

export function useApiKeys() {
  return useQuery({
    queryKey: adminKeys.apiKeys,
    queryFn: ({ signal }) => request<APIKey[]>('/api-keys', { signal }),
    select: safeArray,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: { name: string; permissions: string }) =>
      request<APIKey & { key: string }>('/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.apiKeys });
      success('toast.admin.apiKey.create.success', 'API key created');
    },
    onError: (e) => error(e, 'toast.admin.apiKey.create.error', 'Failed to create API key'),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.apiKeys });
      success('toast.admin.apiKey.delete.success', 'API key deleted');
    },
    onError: (e) => error(e, 'toast.admin.apiKey.delete.error', 'Failed to delete API key'),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.apiKeys });
      success('toast.admin.apiKey.revoke.success', 'API key revoked');
    },
    onError: (e) => error(e, 'toast.admin.apiKey.revoke.error', 'Failed to revoke API key'),
  });
}

export function useApiLogs(page: number) {
  return useQuery({
    queryKey: adminKeys.apiLogs(page),
    queryFn: ({ signal }) => request<APICallLog[]>(`/api-logs?page=${page}&limit=25`, { signal }),
    select: safeArray,
  });
}

export function useApiLogStats() {
  return useQuery({
    queryKey: adminKeys.apiLogStats,
    queryFn: ({ signal }) => request<APICallLogStats>('/api-logs/stats', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useBackupConfigs() {
  return useQuery({
    queryKey: adminKeys.backupConfigs,
    queryFn: ({ signal }) => request<BackupConfig[]>('/backup/configs', { signal }),
    select: safeArray,
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: adminKeys.backupRuns,
    queryFn: ({ signal }) => request<BackupRun[]>('/backup/runs', { signal }),
    refetchInterval: INTERVALS.FAST,
    select: safeArray,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.systemHealth,
    queryFn: ({ signal }) =>
      request<SystemHealth>('/system/health', {
        signal,
        acceptedStatuses: [503],
      }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useExtendedSystemHealth(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminKeys.extendedHealth,
    queryFn: ({ signal }) =>
      request<ExtendedHealthResponse>('/system/health', {
        signal,
        acceptedStatuses: [503],
      }),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.enabled === false ? false : INTERVALS.STANDARD,
  });
}

/** In-memory component status snapshot. Always returns HTTP 200, including
 * degraded/down states, so global reliability UI can render the failure body. */
export function useRuntimeStatus() {
  return useQuery({
    queryKey: adminKeys.runtimeStatus,
    queryFn: ({ signal }) => request<RuntimeStatusSnapshot>('/status/', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * Persisted maintenance/degraded-mode state.
 *
 * GET /api/v1/admin/maintenance returns the current system_state row
 * plus a `source` marker indicating whether an env override is
 * currently shadowing the DB value. The admin Maintenance Mode panel
 * polls this on the standard interval; the MaintenanceBanner reads
 * /system/health (which carries the resolved view) on a separate
 * cadence so the banner stays close to live without double-polling.
 */
export function useMaintenanceState() {
  return useQuery({
    queryKey: adminKeys.maintenance,
    queryFn: ({ signal }) => request<MaintenanceState>('/admin/maintenance', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * POST /api/v1/admin/maintenance — operator override for the service-mode
 * banner. Invalidates BOTH the admin maintenance query and the system
 * health query so the banner picks up the change within one cycle
 * instead of waiting for the next refetchInterval to fire.
 */
export function useUpdateMaintenance() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (input: MaintenanceUpdateInput) =>
      request<MaintenanceState>('/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: input.mode,
          message: input.message ?? '',
          until: input.until ?? null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.maintenance });
      qc.invalidateQueries({ queryKey: adminKeys.systemHealth });
      success('toast.admin.maintenance.success', 'Maintenance state updated');
    },
    onError: (e) => error(e, 'toast.admin.maintenance.error', 'Failed to update maintenance state'),
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs,
    queryFn: ({ signal }) => request<AuditLogEntry[]>('/system/audit', { signal }),
    select: safeArray,
  });
}

/**
 * Last-hour rolling summary of frontend error reports.
 *
 * Reads from the same WebErrorHandler instance that ingests reports via
 * `POST /api/v1/web-errors`, so the count reflects what the SPA has
 * actually shipped. Auto-refreshes on the standard interval so the
 * admin page stays live without a manual refresh.
 */
export function useWebErrorsSummary() {
  return useQuery({
    queryKey: adminKeys.webErrorsSummary,
    queryFn: ({ signal }) => request<WebErrorsSummary>('/admin/web-errors/summary', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSecurityEvents(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.securityEvents(vehicleId),
    queryFn: ({ signal }) =>
      request<SecurityEvent[]>(`/security?vehicle_id=${encodeURIComponent(vehicleId)}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useDBStats() {
  return useQuery({
    queryKey: adminKeys.dbStats,
    queryFn: ({ signal }) => request<DBStats>('/dev-tools/db-stats', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useMigrations() {
  return useQuery({
    queryKey: adminKeys.migrations,
    queryFn: ({ signal }) => request<MigrationStatus>('/dev-tools/migration-status', { signal }),
    refetchInterval: INTERVALS.SLOW,
  });
}

export function useConnectionPool() {
  return useQuery({
    queryKey: adminKeys.connectionPool,
    queryFn: ({ signal }) => request<ConnectionPool>('/dev-tools/runtime-info', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: adminKeys.exportJobs,
    queryFn: ({ signal }) => request<ExportJob[]>('/export/jobs', { signal }),
    select: safeArray,
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: { type: string; format: string; vehicleId?: string }) =>
      request<ExportJob>('/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.exportJobs });
      success('toast.admin.export.create.success', 'Export job created');
    },
    onError: (e) => error(e, 'toast.admin.export.create.error', 'Failed to create export'),
  });
}

export function useVehicleStateMachine(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.vehicleState(vehicleId),
    queryFn: ({ signal }) =>
      request<VehicleState>(`/vehicles/${encodeURIComponent(vehicleId)}/state`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.CRITICAL,
  });
}

/**
 * @deprecated Phase-42 / Prompt 0077 removed the `/vehicle-states/timeline`
 * route alongside the `vehicle_states` table drop. The endpoint now returns
 * 404. This hook is retained because the out-of-scope dashboard widget
 * `features/dashboard/widgets/DashboardStatsWidget.tsx` still imports it;
 * useQuery surfaces the 404 gracefully via `error` per ADR-005 #1. A
 * future replacement should derive state-duration timelines from the
 * canonical `fsm_transitions` table instead. Locked-policy continuation
 * from Phase-43 prompts 0023 + 0024 + 0025 + 0026 + 0027 + 0029 + 0030 +
 * 0031 + 0032.
 */
export function useStateTimeline(vehicleId: string, days = 7) {
  return useQuery({
    queryKey: [...adminKeys.stateTimeline(vehicleId), days],
    queryFn: ({ signal }) =>
      request<{ transitions: StateTransition[] }>(
        `/vehicle-states/timeline?vehicle_id=${encodeURIComponent(vehicleId)}&days=${days}`,
        { signal },
      ),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.FAST,
  });
}
