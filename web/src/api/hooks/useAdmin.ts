import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type {
  APIKey, APICallLog, APICallLogStats, BackupConfig, BackupRun,
  SystemHealth, AuditLogEntry, SecurityEvent, DBStats, MigrationStatus,
  ConnectionPool, ExportJob, VehicleState, StateTransition,
} from '@/types/admin';

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
};

export function useApiKeys() {
  return useQuery({
    queryKey: adminKeys.apiKeys,
    queryFn: () => request<APIKey[]>('/api/v1/api-keys'),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; permissions: string }) =>
      request<APIKey & { key: string }>('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.apiKeys }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api/v1/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.apiKeys }),
  });
}

export function useApiLogs(page: number) {
  return useQuery({
    queryKey: adminKeys.apiLogs(page),
    queryFn: () => request<APICallLog[]>(`/api/v1/api-logs?page=${page}&limit=25`),
  });
}

export function useApiLogStats() {
  return useQuery({
    queryKey: adminKeys.apiLogStats,
    queryFn: () => request<APICallLogStats>('/api/v1/api-logs/stats'),
    refetchInterval: 30_000,
  });
}

export function useBackupConfigs() {
  return useQuery({
    queryKey: adminKeys.backupConfigs,
    queryFn: () => request<BackupConfig[]>('/api/v1/backups/configs'),
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: adminKeys.backupRuns,
    queryFn: () => request<BackupRun[]>('/api/v1/backups/runs?limit=50'),
    refetchInterval: 10_000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.systemHealth,
    queryFn: () => request<SystemHealth>('/api/v1/health/extended'),
    refetchInterval: 30_000,
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs,
    queryFn: () => request<AuditLogEntry[]>('/api/v1/audit-logs?limit=20'),
  });
}

export function useSecurityEvents(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.securityEvents(vehicleId),
    queryFn: () => request<SecurityEvent[]>(`/api/v1/vehicles/${vehicleId}/security-events`),
    enabled: !!vehicleId,
  });
}

export function useDBStats() {
  return useQuery({
    queryKey: adminKeys.dbStats,
    queryFn: () => request<DBStats>('/api/v1/health/db-stats'),
    refetchInterval: 30_000,
  });
}

export function useMigrations() {
  return useQuery({
    queryKey: adminKeys.migrations,
    queryFn: () => request<MigrationStatus>('/api/v1/health/migrations'),
    refetchInterval: 60_000,
  });
}

export function useConnectionPool() {
  return useQuery({
    queryKey: adminKeys.connectionPool,
    queryFn: () => request<ConnectionPool>('/api/v1/health/connection-pool'),
    refetchInterval: 30_000,
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: adminKeys.exportJobs,
    queryFn: () => request<ExportJob[]>('/api/v1/exports'),
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; format: string; vehicleId?: string }) =>
      request<ExportJob>('/api/v1/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.exportJobs }),
  });
}

export function useVehicleStateMachine(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.vehicleState(vehicleId),
    queryFn: () => request<VehicleState>(`/api/v1/vehicles/${vehicleId}/state`),
    enabled: !!vehicleId,
    refetchInterval: 3_000,
  });
}

export function useStateTimeline(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.stateTimeline(vehicleId),
    queryFn: () => request<{ transitions: StateTransition[] }>(`/api/v1/vehicles/${vehicleId}/state/timeline`),
    enabled: !!vehicleId,
  });
}
