import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS } from '@/lib/constants';
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
    queryFn: () => request<APICallLog[]>(`/api-logs?page=${page}&limit=25`),
    select: safeArray,
  });
}

export function useApiLogStats() {
  return useQuery({
    queryKey: adminKeys.apiLogStats,
    queryFn: () => request<APICallLogStats>('/api-logs/stats'),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useBackupConfigs() {
  return useQuery({
    queryKey: adminKeys.backupConfigs,
    queryFn: () => request<BackupConfig[]>('/backup/configs'),
    select: safeArray,
  });
}

export function useBackupRuns() {
  return useQuery({
    queryKey: adminKeys.backupRuns,
    queryFn: () => request<BackupRun[]>('/backup/runs'),
    refetchInterval: INTERVALS.FAST,
    select: safeArray,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.systemHealth,
    queryFn: () => request<SystemHealth>('/system/health'),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useAuditLogs() {
  return useQuery({
    queryKey: adminKeys.auditLogs,
    queryFn: () => request<AuditLogEntry[]>('/system/audit'),
    select: safeArray,
  });
}

export function useSecurityEvents(vehicleId: string) {
  return useQuery({
    queryKey: adminKeys.securityEvents(vehicleId),
    queryFn: () => request<SecurityEvent[]>(`/security?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useDBStats() {
  return useQuery({
    queryKey: adminKeys.dbStats,
    queryFn: () => request<DBStats>('/dev-tools/db-stats'),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useMigrations() {
  return useQuery({
    queryKey: adminKeys.migrations,
    queryFn: () => request<MigrationStatus>('/dev-tools/migration-status'),
    refetchInterval: INTERVALS.SLOW,
  });
}

export function useConnectionPool() {
  return useQuery({
    queryKey: adminKeys.connectionPool,
    queryFn: () => request<ConnectionPool>('/dev-tools/runtime-info'),
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useExportJobs() {
  return useQuery({
    queryKey: adminKeys.exportJobs,
    queryFn: () => request<ExportJob[]>('/export/jobs'),
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
    queryFn: () => request<VehicleState>(`/vehicles/${vehicleId}/state`),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.CRITICAL,
  });
}

export function useStateTimeline(vehicleId: string, days = 7) {
  return useQuery({
    queryKey: [...adminKeys.stateTimeline(vehicleId), days],
    queryFn: () => request<{ transitions: StateTransition[] }>(`/vehicle-states/timeline?vehicle_id=${vehicleId}&days=${days}`),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.FAST,
  });
}
