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
    queryFn: () => request<APIKey[]>('/api-keys'),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; permissions: string }) =>
      request<APIKey & { key: string }>('/api-keys', {
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
    mutationFn: (id: string) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.apiKeys }),
  });
}

export function useApiLogs(page: number) {
  return useQuery({
    queryKey: adminKeys.apiLogs(page),
    queryFn: () => request<APICallLog[]>(`/api-logs?page=${page}&limit=25`),
  });
}

export function useApiLogStats() {
  return useQuery({
    queryKey: adminKeys.apiLogStats,
    queryFn: () => request<APICallLogStats>('/api-logs/stats'),
    refetchInterval: 30_000,
  });
}

export function useBackupConfigs() {
  return useQuery({
    queryKey: adminKeys.backupConfigs,
    queryFn: () => request<BackupConfig[]>('/system/backup/stats'),
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: adminKeys.backupRuns,
    queryFn: () => request<BackupRun[]>('/system/backup'),
    refetchInterval: 10_000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.systemHealth,
    queryFn: () => request<SystemHealth>('/system/health'),
    refetchInterval: 30_000,
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs,
    queryFn: () => request<AuditLogEntry[]>('/system/audit'),
  });
}

export function useSecurityEvents(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.securityEvents(vehicleId),
    queryFn: () => request<SecurityEvent[]>(`/security?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
  });
}

export function useDBStats() {
  return useQuery({
    queryKey: adminKeys.dbStats,
    queryFn: () => request<DBStats>('/dev-tools/db-stats'),
    refetchInterval: 30_000,
  });
}

export function useMigrations() {
  return useQuery({
    queryKey: adminKeys.migrations,
    queryFn: () => request<MigrationStatus>('/dev-tools/migration-status'),
    refetchInterval: 60_000,
  });
}

export function useConnectionPool() {
  return useQuery({
    queryKey: adminKeys.connectionPool,
    queryFn: () => request<ConnectionPool>('/dev-tools/runtime-info'),
    refetchInterval: 30_000,
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: adminKeys.exportJobs,
    queryFn: () => request<ExportJob[]>('/exports'),
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; format: string; vehicleId?: string }) =>
      request<ExportJob>('/exports', {
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
    queryFn: () => request<VehicleState>(`/vehicles/${vehicleId}/state`),
    enabled: !!vehicleId,
    refetchInterval: 3_000,
  });
}

export function useStateTimeline(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.stateTimeline(vehicleId),
    queryFn: () => request<{ transitions: StateTransition[] }>(`/vehicle-states/timeline?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
  });
}
