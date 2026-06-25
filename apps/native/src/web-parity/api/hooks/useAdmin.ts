import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

export interface APIKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: 'read' | 'read-write' | 'admin';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface APICallLog {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  requestBody: string | null;
  responseBody: string | null;
  error: string | null;
  createdAt: string;
}

export interface APICallLogStats {
  totalCalls: number;
  errorRate: number;
  avgDurationMs: number;
  last24h: number;
  errorCount: number;
  by_method?: Record<string, number>;
  by_service?: Record<string, number>;
}

export interface BackupConfig {
  id: string;
  name: string;
  enabled: boolean;
  backupType: 'full' | 'incremental';
  frequencyDays: number;
  maxRetention: number;
  provider: 'local' | 's3' | 'azure' | 'gcs';
  providerConfig: Record<string, string>;
  compress: boolean;
  encrypt: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface BackupRun {
  id: string;
  configId: string;
  status: 'completed' | 'failed' | 'running' | 'queued';
  backupType: string;
  fileSize: number;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export type ComponentStatus =
  | 'healthy'
  | 'ok'
  | 'degraded'
  | 'warning'
  | 'unhealthy'
  | 'offline'
  | 'down'
  | 'failed'
  | 'unknown'
  | (string & {});

export interface SystemHealthComponent {
  status: ComponentStatus;
  consecutiveFailures: number;
  lastError: string | null;
  details: Record<string, unknown>;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, SystemHealthComponent>;
  databaseSize: string;
  tableCount: number;
  mode?: 'ok' | 'degraded' | 'maintenance';
  maintenance_message?: string;
  maintenance_until?: string;
  maintenance_updated_at?: string;
  source?: 'env' | 'db' | 'default';
}

export interface MaintenanceState {
  mode: 'ok' | 'degraded' | 'maintenance';
  maintenance_message?: string;
  maintenance_until?: string | null;
  updated_at: string;
  updated_by?: string;
  source: 'env' | 'db' | 'default';
  env_override_mode?: string;
}

export interface MaintenanceUpdateInput {
  mode: 'ok' | 'degraded' | 'maintenance';
  message?: string;
  until?: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  details: string;
  createdAt: string;
}

export interface WebErrorsSummaryEntry {
  name: string;
  route: string;
  count: number;
}

export interface WebErrorsSummary {
  window_seconds: number;
  windowSeconds: number;
  total: number;
  top: WebErrorsSummaryEntry[];
  as_of: string;
  asOf: string;
}

export interface SecurityEvent {
  id: string;
  locked: boolean | null;
  sentryMode: string | boolean | null;
  doorState: string | boolean | null;
  fdWindow: string | boolean | null;
  fpWindow: string | boolean | null;
  rdWindow: string | boolean | null;
  rpWindow: string | boolean | null;
  homelinkNearby: boolean | null;
  guestMode: boolean | null;
  homelinkDeviceCount: number | null;
  guestModeMobileAccessState: string | null;
  driverSeatOccupied: boolean | null;
  centerDisplay: string | boolean | null;
  speedLimitMode: string | boolean | null;
  valetModeEnabled: boolean | null;
  serviceMode: boolean | null;
  pairedPhoneKeyCount: number | null;
  lightsHazardsActive: boolean | null;
  lightsHighBeams: boolean | null;
  lightsTurnSignal: string | null;
  driverSeatBelt: string | null;
  passengerSeatBelt: string | null;
  createdAt: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  indexCount: number;
  lastVacuum: string | null;
}

export interface DBStats {
  tables: TableInfo[];
  tableCount: number;
  databaseSize: string;
}

export interface MigrationInfo {
  version: string;
  name: string;
  appliedAt: string;
}

export interface MigrationStatus {
  currentVersion: string;
  dirty: boolean;
  pending: number;
  migrations: MigrationInfo[];
}

export interface ConnectionPool {
  maxOpen: number;
  open: number;
  inUse: number;
  idle: number;
  waitCount: number;
  waitDurationMs: number;
}

export interface ExportJob {
  id: string;
  type: 'drives' | 'charging' | 'analytics' | 'backup';
  format: 'csv' | 'json';
  status: 'queued' | 'processing' | 'ready' | 'failed';
  recordCount: number | null;
  fileSize: number | null;
  createdAt: string;
}

export interface VehicleState {
  state: string;
  since: string;
  vehicleId: string;
}

export interface StateTransition {
  state: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
}

const INTERVALS = {
  CRITICAL: 3_000,
  FAST: 10_000,
  STANDARD: 30_000,
  SLOW: 60_000,
} as const;

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

export const adminKeys = {
  apiKeys: ['api-keys'] as const,
  apiLogs: (page: number) => ['api-logs', page] as const,
  apiLogStats: ['api-log-stats'] as const,
  backupConfigs: ['backup-configs'] as const,
  backupRuns: ['backup-runs'] as const,
  systemHealth: ['system-health'] as const,
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
    queryFn: ({signal}) => request<APIKey[]>('/api-keys', {signal}),
    select: safeArray,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (data: {name: string; permissions: string}) =>
      request<APIKey & {key: string}>('/api-keys', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: adminKeys.apiKeys});
      success('toast.admin.apiKey.create.success', 'API key created');
    },
    onError: e =>
      error(e, 'toast.admin.apiKey.create.error', 'Failed to create API key'),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api-keys/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: adminKeys.apiKeys});
      success('toast.admin.apiKey.delete.success', 'API key deleted');
    },
    onError: e =>
      error(e, 'toast.admin.apiKey.delete.error', 'Failed to delete API key'),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/api-keys/${id}/revoke`, {method: 'POST'}),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: adminKeys.apiKeys});
      success('toast.admin.apiKey.revoke.success', 'API key revoked');
    },
    onError: e =>
      error(e, 'toast.admin.apiKey.revoke.error', 'Failed to revoke API key'),
  });
}

export function useApiLogs(page: number) {
  return useQuery({
    queryKey: adminKeys.apiLogs(page),
    queryFn: ({signal}) =>
      request<APICallLog[]>(`/api-logs?page=${page}&limit=25`, {signal}),
    select: safeArray,
  });
}

export function useApiLogStats() {
  return useQuery({
    queryKey: adminKeys.apiLogStats,
    queryFn: ({signal}) => request<APICallLogStats>('/api-logs/stats', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useBackupConfigs() {
  return useQuery({
    queryKey: adminKeys.backupConfigs,
    queryFn: ({signal}) => request<BackupConfig[]>('/backup/configs', {signal}),
    select: safeArray,
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: adminKeys.backupRuns,
    queryFn: ({signal}) => request<BackupRun[]>('/backup/runs', {signal}),
    refetchInterval: INTERVALS.FAST,
    select: safeArray,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.systemHealth,
    queryFn: ({signal}) => request<SystemHealth>('/system/health', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * Persisted maintenance/degraded-mode state.
 *
 * GET /api/v1/admin/maintenance returns the current system_state row plus a
 * `source` marker indicating whether an env override is shadowing the DB value.
 */
export function useMaintenanceState() {
  return useQuery({
    queryKey: adminKeys.maintenance,
    queryFn: ({signal}) =>
      request<MaintenanceState>('/admin/maintenance', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * POST /api/v1/admin/maintenance — operator override for the service-mode
 * banner. Invalidates admin maintenance and system health query consumers.
 */
export function useUpdateMaintenance() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (input: MaintenanceUpdateInput) =>
      request<MaintenanceState>('/admin/maintenance', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          mode: input.mode,
          message: input.message ?? '',
          until: input.until ?? null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: adminKeys.maintenance});
      qc.invalidateQueries({queryKey: adminKeys.systemHealth});
      success('toast.admin.maintenance.success', 'Maintenance state updated');
    },
    onError: e =>
      error(
        e,
        'toast.admin.maintenance.error',
        'Failed to update maintenance state',
      ),
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs,
    queryFn: ({signal}) => request<AuditLogEntry[]>('/system/audit', {signal}),
    select: safeArray,
  });
}

/**
 * Last-hour rolling summary of frontend error reports shipped by the SPA.
 */
export function useWebErrorsSummary() {
  return useQuery({
    queryKey: adminKeys.webErrorsSummary,
    queryFn: ({signal}) =>
      request<WebErrorsSummary>('/admin/web-errors/summary', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSecurityEvents(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.securityEvents(vehicleId),
    queryFn: ({signal}) =>
      request<SecurityEvent[]>(`/security?vehicle_id=${vehicleId}`, {signal}),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useDBStats() {
  return useQuery({
    queryKey: adminKeys.dbStats,
    queryFn: ({signal}) => request<DBStats>('/dev-tools/db-stats', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useMigrations() {
  return useQuery({
    queryKey: adminKeys.migrations,
    queryFn: ({signal}) =>
      request<MigrationStatus>('/dev-tools/migration-status', {signal}),
    refetchInterval: INTERVALS.SLOW,
  });
}

export function useConnectionPool() {
  return useQuery({
    queryKey: adminKeys.connectionPool,
    queryFn: ({signal}) =>
      request<ConnectionPool>('/dev-tools/runtime-info', {signal}),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: adminKeys.exportJobs,
    queryFn: ({signal}) => request<ExportJob[]>('/export/jobs', {signal}),
    select: safeArray,
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (data: {type: string; format: string; vehicleId?: string}) =>
      request<ExportJob>('/exports', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: adminKeys.exportJobs});
      success('toast.admin.export.create.success', 'Export job created');
    },
    onError: e =>
      error(e, 'toast.admin.export.create.error', 'Failed to create export'),
  });
}

export function useVehicleStateMachine(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.vehicleState(vehicleId),
    queryFn: ({signal}) =>
      request<VehicleState>(`/vehicles/${vehicleId}/state`, {signal}),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.CRITICAL,
  });
}

/**
 * @deprecated Phase-42 / Prompt 0077 removed the `/vehicle-states/timeline`
 * route alongside the `vehicle_states` table drop. The endpoint now returns
 * 404. This hook is retained because dashboard consumers still import it;
 * useQuery surfaces the 404 gracefully via `error` per ADR-005 #1.
 */
export function useStateTimeline(vehicleId: string, days = 7) {
  return useQuery({
    queryKey: [...adminKeys.stateTimeline(vehicleId), days],
    queryFn: ({signal}) =>
      request<{transitions: StateTransition[]}>(
        `/vehicle-states/timeline?vehicle_id=${vehicleId}&days=${days}`,
        {signal},
      ),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.FAST,
  });
}
