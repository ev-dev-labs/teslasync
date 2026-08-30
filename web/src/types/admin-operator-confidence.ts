/**
 * Operator Confidence wire types.
 *
 * TypeScript shapes for the 7 admin-observability routes mounted under
 * /api/v1/admin/*. Field names mirror the Go JSON tags 1:1 so the
 * `camelCaseKeys` transform makes BOTH snake_case AND camelCase keys
 * available on the runtime object — the types here intentionally use
 * the snake_case form (matching the Go contract and our existing
 * convention in @/types/admin-diagnostics).
 *
 * Endpoint map → file in internal/handler/v1:
 *   GET /admin/observability/schema-drift     → admin_observability_handler.go
 *   GET /admin/observability/slow-queries     → "
 *   GET /admin/observability/vehicle-cost     → "
 *   GET /admin/observability/disk-forecast    → "
 *   GET /admin/observability/secret-rotation  → "
 *   GET /admin/audit-log[/categories|/actions|/verify]
 *                                             → admin_audit_handler.go
 *   GET /admin/gdpr/exports/{id}[/download]   → gdpr_export_handler.go
 *
 * Every route degrades to HTTP 503 + `code: 'SUBSYSTEM_NOT_CONFIGURED'`
 * when its backing repo wasn't wired — pages should branch on
 * `error.status === 503` to render an explanatory empty-state instead
 * of an error banner.
 */

// ---------- Schema drift ---------------------------------------------------

export interface SchemaFingerprint {
  sha256: string;
  table_count: number;
  column_count: number;
  index_count: number;
}

export interface SchemaDrift {
  has_drift: boolean;
  current: SchemaFingerprint;
  expected: SchemaFingerprint;
  table_count_delta: number;
  column_count_delta: number;
  index_count_delta: number;
  expected_generated_at?: string;
}

export interface SchemaDriftResponse {
  drift: SchemaDrift;
  is_different: boolean;
}

// ---------- Slow queries ---------------------------------------------------

export type SlowQueryOrderBy =
  | 'mean_time'
  | 'total_time'
  | 'calls'
  | 'max_time';

export interface SlowQueryRow {
  query_id: number;
  fingerprint: string;
  calls: number;
  total_time_ms: number;
  mean_time_ms: number;
  max_time_ms: number;
  rows_returned: number;
  shared_blks_hit?: number | null;
  shared_blks_read?: number | null;
}

export interface SlowQueriesResponse {
  order_by: SlowQueryOrderBy;
  slow_queries: SlowQueryRow[];
}

// ---------- Vehicle cost ---------------------------------------------------

export interface VehicleCostRow {
  vehicle_id: number;
  display_name?: string | null;
  signal_row_count: number;
  signal_bytes_est: number;
  ingest_rate_per_minute_24h: number;
  dlq_failures_24h: number;
  last_seen_at: string;
}

export interface VehicleCostTotals {
  total_rows: number;
  total_bytes_est: number;
  total_rate_per_minute_24h: number;
  total_failures_24h: number;
}

export interface VehicleCostResponse {
  vehicles: VehicleCostRow[];
  totals: VehicleCostTotals;
}

// ---------- Disk forecast --------------------------------------------------

export type DiskForecastSeverity = 'ok' | 'warn' | 'critical' | 'unknown';

export interface HypertableSize {
  hypertable_name: string;
  total_bytes: number;
  uncompressed_bytes: number;
  compressed_bytes: number;
  chunk_count: number;
  growth_bytes_per_day: number;
  est_days_to_quota?: number | null;
  severity: DiskForecastSeverity;
}

export interface DiskForecastResponse {
  hypertables: HypertableSize[];
}

// ---------- Secret rotation ------------------------------------------------

export type SecretRotationSeverity = 'ok' | 'warn' | 'critical' | 'unknown';

export interface SecretRotationStatus {
  kind: string;
  target_id?: string;
  last_rotated: string;
  age_days: number;
  expires_at?: string | null;
  days_to_expiry?: number | null;
  warn_days: number;
  critical_days: number;
  severity: SecretRotationSeverity;
  message?: string;
}

export interface SecretRotationResponse {
  items: SecretRotationStatus[];
}

// ---------- Data quality ---------------------------------------------------
//
// GET /admin/observability/data-quality → internal/api/dataquality/handler.go,
// backed by internal/dataquality.Scorer. Unlike the routes above this handler
// writes a FLAT body via internal/api/httpx.WriteJSON — there is no `{data:…}`
// envelope to unwrap.
//
// Nullability is load-bearing here and must not be collapsed to 0:
//   • `normalization_coverage_pct` / `coverage_pct` are null when the bounded
//     window held zero samples. "Unknown" is a different fact from "0 %".
//   • `version` is null for the legacy/unknown provenance bucket — rows written
//     before migration 000232. That is NOT the same as an explicit version 0.
//   • `firmware_version` is null when no `Version` signal was observed.

/** Per-field composite quality tier. Mirrors dataquality.severity(). */
export type DataQualitySeverity = 'ok' | 'warn' | 'critical';

/** Whether a coverage percentage was actually measured or is unknown. */
export type NormalizationCoverageState = 'measured' | 'unknown';

/** Whether the firmware context for a segment is attested or unknown. */
export type FirmwareEvidenceState = 'known' | 'unknown';

export interface DataQualityFieldScore {
  field: string;
  sample_count: number;
  last_seen_at: string;
  freshness_seconds: number;
  max_gap_seconds: number;
  /** 0..1 fraction of comparable consecutive samples whose typed value matched. */
  duplicate_ratio: number;
  versioned_sample_count: number;
  unversioned_sample_count: number;
  normalization_coverage_pct: number | null;
  normalization_coverage_state: NormalizationCoverageState;
  /** 0..100, higher = healthier. */
  composite_score: number;
  severity: DataQualitySeverity;
}

/** One bucket of the bounded GROUP BY normalization_version distribution. */
export interface NormalizationVersionCount {
  /** null = legacy/unknown provenance. Never conflate with 0. */
  version: number | null;
  sample_count: number;
  /** null when the window held zero samples. */
  share_pct: number | null;
}

export interface NormalizationSummary {
  required_version: number;
  total_sample_count: number;
  versioned_sample_count: number;
  unversioned_sample_count: number;
  /** null when total_sample_count is 0 — unknown, not 0 %. */
  coverage_pct: number | null;
  coverage_state: NormalizationCoverageState;
  versions: NormalizationVersionCount[];
}

export interface DataQualityFirmwareSegment {
  firmware_version: string | null;
  firmware_evidence_state: FirmwareEvidenceState;
  vehicle_count: number;
  total_sample_count: number;
  versioned_sample_count: number;
  unversioned_sample_count: number;
  normalization_coverage_pct: number | null;
  normalization_coverage_state: NormalizationCoverageState;
  fields: DataQualityFieldScore[];
}

export interface DataQualitySnapshot {
  generated_at: string;
  window_start: string;
  window_end: string;
  window_mins: number;
  required_normalization_version: number;
  normalization: NormalizationSummary;
  /** How firmware was attributed to a segment, e.g. 'latest_version_at_window_end'. */
  firmware_assignment: string;
  firmware_segments: DataQualityFirmwareSegment[];
  fields: DataQualityFieldScore[];
}

// ---------- Audit log ------------------------------------------------------

export interface AuditLogQueryParams {
  since?: string;
  until?: string;
  categories?: string[];
  actors?: string[];
  actions?: string[];
  entity_type?: string;
  entity_id?: number;
  limit?: number;
  offset?: number;
}

export interface AuditLogRow {
  id: number;
  ts: string;
  actor: string;
  category?: string | null;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  detail?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  before?: string | null;
  after?: string | null;
  trace_id?: string | null;
  prev_row_hash?: string | null;
  row_hash?: string | null;
  success?: boolean | null;
}

export interface AuditLogListResponse {
  rows: AuditLogRow[];
  limit: number;
}

export interface AuditCategoriesResponse {
  categories: string[];
}

export interface AuditActionsResponse {
  actions: string[];
}

export interface AuditChainVerifyResponse {
  intact: boolean;
  first_bad_id: number;
  rows_checked: number;
  since: string;
  limit: number;
}

// ---------- GDPR export ----------------------------------------------------

export type GDPRArtifactStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'expired';

export interface GDPRExportArtifact {
  id: string;
  user_id?: string | null;
  status: GDPRArtifactStatus;
  format: string;
  bytes?: number | null;
  sha256?: string | null;
  storage?: string | null;
  download_url?: string | null;
  created_at: string;
  completed_at?: string | null;
  expires_at?: string | null;
  error?: string | null;
}
