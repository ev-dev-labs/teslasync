import type {
  AuditLogListResponse, DataQualitySnapshot, DiskForecastResponse,
  SchemaDriftResponse, SecretRotationResponse, SlowQueriesResponse, VehicleCostResponse,
} from '../src/types/admin-operator-confidence';

const now = '2026-08-26T16:00:00.000Z';
const fingerprint = { sha256: 'synthetic-schema-fingerprint', table_count: 12, column_count: 96, index_count: 18 };
const drift = {
  drift: {
    has_drift: false, current: fingerprint, expected: fingerprint,
    table_count_delta: 0, column_count_delta: 0, index_count_delta: 0,
  },
  is_different: false,
} satisfies SchemaDriftResponse;
const disk = {
  hypertables: [{
    hypertable_name: 'signal_log', total_bytes: 10485760, uncompressed_bytes: 8388608,
    compressed_bytes: 2097152, chunk_count: 4, growth_bytes_per_day: 1048576,
    est_days_to_quota: 90, severity: 'ok',
  }],
} satisfies DiskForecastResponse;
const secrets = {
  items: [{
    kind: 'synthetic_connector', target_id: 'synthetic-service',
    last_rotated: '2026-08-25T16:00:00.000Z', age_days: 1,
    warn_days: 60, critical_days: 90, severity: 'ok',
  }],
} satisfies SecretRotationResponse;
const queries = {
  order_by: 'mean_time',
  slow_queries: [{
    query_id: 1, fingerprint: 'SELECT value FROM signal_log WHERE vehicle_id = $1',
    calls: 10, total_time_ms: 100, mean_time_ms: 10, max_time_ms: 15,
    rows_returned: 100, shared_blks_hit: 95, shared_blks_read: 5,
  }],
} satisfies SlowQueriesResponse;
const vehicleCost = {
  vehicles: [{
    vehicle_id: 7, display_name: 'Synthetic vehicle', signal_row_count: 100,
    signal_bytes_est: 102400, ingest_rate_per_minute_24h: 4,
    dlq_failures_24h: 0, last_seen_at: now,
  }],
  totals: { total_rows: 100, total_bytes_est: 102400, total_rate_per_minute_24h: 4, total_failures_24h: 0 },
} satisfies VehicleCostResponse;
const field = {
  field: 'BatteryLevel', sample_count: 100, last_seen_at: now,
  freshness_seconds: 0, max_gap_seconds: 60, duplicate_ratio: 0.1,
  versioned_sample_count: 100, unversioned_sample_count: 0,
  normalization_coverage_pct: 100, normalization_coverage_state: 'measured' as const,
  composite_score: 95, severity: 'ok' as const,
};
const quality = {
  generated_at: now, window_start: '2026-08-26T15:00:00.000Z', window_end: now,
  window_mins: 60, required_normalization_version: 1,
  normalization: {
    required_version: 1, total_sample_count: 100, versioned_sample_count: 100,
    unversioned_sample_count: 0, coverage_pct: 100, coverage_state: 'measured',
    versions: [{ version: 1, sample_count: 100, share_pct: 100 }],
  },
  firmware_assignment: 'latest_version_at_window_end',
  firmware_segments: [{
    firmware_version: '2026.26.3', firmware_evidence_state: 'known', vehicle_count: 1,
    total_sample_count: 100, versioned_sample_count: 100, unversioned_sample_count: 0,
    normalization_coverage_pct: 100, normalization_coverage_state: 'measured', fields: [field],
  }],
  fields: [field],
} satisfies DataQualitySnapshot;
const audit = {
  rows: [{
    id: 1, ts: now, actor: 'synthetic-operator', category: 'settings',
    action: 'settings.updated', entity_type: 'settings', entity_id: 1,
    detail: 'Synthetic local layout evidence', success: true,
  }],
  limit: 50,
} satisfies AuditLogListResponse;

export const cardLayoutObservabilitySources: Record<string, unknown> = {
  '/admin/observability/schema-drift': drift,
  '/admin/observability/disk-forecast': disk,
  '/admin/observability/secret-rotation': secrets,
  '/admin/observability/slow-queries': queries,
  '/admin/observability/vehicle-cost': vehicleCost,
  '/admin/observability/data-quality': quality,
  '/admin/audit-log': audit,
  '/admin/audit-log/categories': { categories: ['settings'] },
  '/admin/audit-log/actions': { actions: ['settings.updated'] },
};
