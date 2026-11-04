import type {
  DLQAuditResponse, DLQListResponse, FeatureFlagChangesResponse,
  FeatureFlagsListResponse, IngestXRayResponse,
} from '../src/types/admin-diagnostics';
import type { FeedbackListResponse, BackupStats, WorkersHealth } from '../src/api/types';
import type { APIKey, BackupConfig, MaintenanceState, MigrationStatus } from '../src/types/admin';
import type { PollEngineStatus } from '../src/api/polling';
import { catalogueWire } from './dashboardCatalogueRemainingSources';
import { catalogueSystemSources } from './dashboardCatalogueSystemSources';

const now = '2026-08-26T16:00:00.000Z';
const dlq = {
  count: 1, replay_enabled: false,
  entries: [{
    id: '00000000000000000000000000000001', arrived_at: now,
    dlq_topic: 'synthetic/dlq', parsed_reason: 'Synthetic malformed payload',
    parsed_vehicle_id: 7, parsed_redeliveries: 0, replayable: false,
    raw_payload_size: 12, inner_payload_size: 0,
  }],
} satisfies DLQListResponse;
const audit = { count: 0, limit: 50, dlq_id: '', rows: [] } satisfies DLQAuditResponse;
const flags = { count: 1, flags: [{ key: 'synthetic_display', value: 'false' }] } satisfies FeatureFlagsListResponse;
const changes = { count: 0, flag_key: '', limit: 50, rows: [] } satisfies FeatureFlagChangesResponse;
const xray = {
  vehicle_id: 7, window: '15m', bucket: '1m', now,
  window_start: '2026-08-26T15:45:00.000Z', last_seen_at: now, freshness_seconds: 0,
  total_samples: 10,
  fields: [{ field: 'BatteryLevel', sample_count: 10, last_seen_at: now, value_kind: 1 }],
  buckets: [{ bucket_start: '2026-08-26T15:59:00.000Z', count: 10 }],
} satisfies IngestXRayResponse;
const feedback = {
  items: [{
    id: 1, created_at: now, category: 'feature', status: 'new',
    title: 'Synthetic layout feedback', body: 'Review shared card alignment.', page_route: '/dashboard',
  }],
  total: 1, limit: 50, offset: 0, github_bridge_enabled: false,
} satisfies FeedbackListResponse;
const maintenance = { mode: 'ok', updated_at: now, source: 'default' } satisfies MaintenanceState;
const migrations = {
  currentVersion: '000232', dirty: false, pending: 0,
  migrations: [{ version: '000232', name: 'Synthetic migration record', appliedAt: now }],
} satisfies MigrationStatus;
const backups = {
  database_size: '10 MiB', table_count: 12, row_counts: { signal_log: 100 },
} satisfies BackupStats;
const configs = [{
  id: '1', name: 'Synthetic local backup', enabled: false, backupType: 'full',
  frequencyDays: 1, maxRetention: 7, provider: 'local', providerConfig: {},
  compress: true, encrypt: false, lastRunAt: now, nextRunAt: null,
}] satisfies BackupConfig[];
const workers = {
  workers: [{ name: 'synthetic-worker', host: 'synthetic', status: 'healthy', latency_ms: 1 }],
  total: 1, healthy_count: 1,
} satisfies WorkersHealth;
const polling = { enabled: false, vehicles: {} } satisfies PollEngineStatus;
const keys = [{
  id: '1', name: 'Synthetic read-only client', keyPrefix: 'synthetic',
  permissions: 'read', createdAt: now, lastUsedAt: now, expiresAt: null,
}] satisfies APIKey[];
const system = catalogueSystemSources(now);

export const cardLayoutDiagnosticSources: Record<string, unknown> = {
  '/system/dlq': dlq,
  '/system/dlq/audit': audit,
  '/system/flags': flags,
  '/system/flags/changes': changes,
  '/system/ingest-xray/7': xray,
  '/admin/feedback': feedback,
  '/admin/maintenance': maintenance,
  '/dev-tools/migration-status': catalogueWire(migrations),
  '/system/backup/stats': backups,
  '/backup/configs': catalogueWire(configs),
  '/system/workers': workers,
  '/polling/status': polling,
  '/api-keys': catalogueWire(keys),
  '/system/audit': system['/system/audit'],
};
