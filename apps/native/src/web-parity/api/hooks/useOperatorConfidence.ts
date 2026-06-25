/**
 * @module api/hooks/useOperatorConfidence
 *
 * Native parity TanStack Query bindings for operator-confidence admin
 * surfaces mounted under `/api/v1/admin/*`. The source web hook imports
 * its DTOs from `@/types/admin-operator-confidence`; those wire types are
 * inlined here because the native parity layer does not expose that web alias.
 *
 * The shared native `request()` client auto-prepends `/api/v1`, so hook URLs
 * must not include that prefix.
 */

import {useQuery} from '@tanstack/react-query';

import {request} from '../client';

const INTERVALS = {
  FAST: 10_000,
  STANDARD: 30_000,
  SLOW: 60_000,
  RARE: 60 * 60_000,
} as const;

const STALE_TIMES = {
  QUICK: 10_000,
  MODERATE: 15_000,
  FAST: 30_000,
  STANDARD: 60_000,
  EXTENDED: 10 * 60_000,
} as const;

// ---------- Wire types ------------------------------------------------------

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

/**
 * The admin observability, audit, and GDPR handlers use the platform
 * `httputil.Respond` envelope which wraps payloads as `{data: T}`. The shared
 * request client does not unwrap because older endpoints return payloads
 * directly, so these hooks unwrap per endpoint and remain a no-op for
 * non-enveloped payloads.
 */
async function fetchEnvelope<T>(promise: Promise<unknown>): Promise<T> {
  const body = await promise;
  if (
    body !== null &&
    typeof body === 'object' &&
    'data' in (body as Record<string, unknown>)
  ) {
    return (body as {data: T}).data;
  }
  return body as T;
}

export const operatorConfidenceKeys = {
  schemaDrift: ['admin', 'observability', 'schema-drift'] as const,
  slowQueries: (orderBy: SlowQueryOrderBy, limit: number) =>
    ['admin', 'observability', 'slow-queries', orderBy, limit] as const,
  vehicleCost: (sinceISO: string | null, limit: number) =>
    ['admin', 'observability', 'vehicle-cost', sinceISO, limit] as const,
  diskForecast: ['admin', 'observability', 'disk-forecast'] as const,
  secretRotation: ['admin', 'observability', 'secret-rotation'] as const,
  auditLogList: (params: AuditLogQueryParams) =>
    ['admin', 'audit-log', 'list', params] as const,
  auditCategories: ['admin', 'audit-log', 'categories'] as const,
  auditActions: ['admin', 'audit-log', 'actions'] as const,
  auditVerify: (sinceISO: string | null, limit: number) =>
    ['admin', 'audit-log', 'verify', sinceISO, limit] as const,
  gdprExport: (id: string) => ['admin', 'gdpr', 'exports', id] as const,
};

// ---------- Schema drift ----------------------------------------------------

export function useSchemaDrift() {
  return useQuery({
    queryKey: operatorConfidenceKeys.schemaDrift,
    queryFn: ({signal}) =>
      fetchEnvelope<SchemaDriftResponse>(
        request('/admin/observability/schema-drift', {signal}),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Slow queries ----------------------------------------------------

export function useSlowQueries(
  orderBy: SlowQueryOrderBy = 'mean_time',
  limit = 25,
) {
  return useQuery({
    queryKey: operatorConfidenceKeys.slowQueries(orderBy, limit),
    queryFn: ({signal}) =>
      fetchEnvelope<SlowQueriesResponse>(
        request(
          `/admin/observability/slow-queries?order_by=${orderBy}&limit=${limit}`,
          {signal},
        ),
      ),
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Vehicle cost ----------------------------------------------------

export function useVehicleCost(since: Date | null = null, limit = 100) {
  const sinceISO = since ? since.toISOString() : null;
  const sinceParam = sinceISO ? `&since=${encodeURIComponent(sinceISO)}` : '';
  return useQuery({
    queryKey: operatorConfidenceKeys.vehicleCost(sinceISO, limit),
    queryFn: ({signal}) =>
      fetchEnvelope<VehicleCostResponse>(
        request(
          `/admin/observability/vehicle-cost?limit=${limit}${sinceParam}`,
          {signal},
        ),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Disk forecast ---------------------------------------------------

export function useDiskForecast() {
  return useQuery({
    queryKey: operatorConfidenceKeys.diskForecast,
    queryFn: ({signal}) =>
      fetchEnvelope<DiskForecastResponse>(
        request('/admin/observability/disk-forecast', {signal}),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Secret rotation -------------------------------------------------

export function useSecretRotation() {
  return useQuery({
    queryKey: operatorConfidenceKeys.secretRotation,
    queryFn: ({signal}) =>
      fetchEnvelope<SecretRotationResponse>(
        request('/admin/observability/secret-rotation', {signal}),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Audit log -------------------------------------------------------

export function useAuditLog(params: AuditLogQueryParams, enabled = true) {
  const qs = buildAuditLogQuery(params);
  return useQuery({
    queryKey: operatorConfidenceKeys.auditLogList(params),
    queryFn: ({signal}) =>
      fetchEnvelope<AuditLogListResponse>(
        request(`/admin/audit-log${qs}`, {signal}),
      ),
    enabled,
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useAuditCategories() {
  return useQuery({
    queryKey: operatorConfidenceKeys.auditCategories,
    queryFn: ({signal}) =>
      fetchEnvelope<AuditCategoriesResponse>(
        request('/admin/audit-log/categories', {signal}),
      ),
    staleTime: STALE_TIMES.EXTENDED,
    refetchInterval: INTERVALS.RARE,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: operatorConfidenceKeys.auditActions,
    queryFn: ({signal}) =>
      fetchEnvelope<AuditActionsResponse>(
        request('/admin/audit-log/actions', {signal}),
      ),
    staleTime: STALE_TIMES.EXTENDED,
    refetchInterval: INTERVALS.RARE,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useAuditChainVerify(
  since: Date | null = null,
  limit = 1000,
  enabled = false,
) {
  const sinceISO = since ? since.toISOString() : null;
  const sinceParam = sinceISO ? `&since=${encodeURIComponent(sinceISO)}` : '';
  return useQuery({
    queryKey: operatorConfidenceKeys.auditVerify(sinceISO, limit),
    queryFn: ({signal}) =>
      fetchEnvelope<AuditChainVerifyResponse>(
        request(`/admin/audit-log/verify?limit=${limit}${sinceParam}`, {
          signal,
        }),
      ),
    enabled,
    staleTime: STALE_TIMES.FAST,
    refetchInterval: false,
    retry: 1,
  });
}

// ---------- GDPR export -----------------------------------------------------

export function useGDPRExport(id: string | null) {
  return useQuery({
    queryKey: operatorConfidenceKeys.gdprExport(id ?? '__none__'),
    queryFn: ({signal}) =>
      fetchEnvelope<GDPRExportArtifact>(
        request(`/admin/gdpr/exports/${id}`, {signal}),
      ),
    enabled: Boolean(id),
    staleTime: STALE_TIMES.QUICK,
    refetchInterval: INTERVALS.FAST,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- helpers ---------------------------------------------------------

function buildAuditLogQuery(params: AuditLogQueryParams): string {
  const entries: Array<[string, string]> = [];
  if (params.since) {
    entries.push(['since', params.since]);
  }
  if (params.until) {
    entries.push(['until', params.until]);
  }
  if (params.categories && params.categories.length > 0) {
    entries.push(['categories', params.categories.join(',')]);
  }
  if (params.actors && params.actors.length > 0) {
    entries.push(['actors', params.actors.join(',')]);
  }
  if (params.actions && params.actions.length > 0) {
    entries.push(['actions', params.actions.join(',')]);
  }
  if (params.entity_type) {
    entries.push(['entity_type', params.entity_type]);
  }
  if (params.entity_id !== undefined) {
    entries.push(['entity_id', String(params.entity_id)]);
  }
  if (params.limit !== undefined) {
    entries.push(['limit', String(params.limit)]);
  }
  if (params.offset !== undefined) {
    entries.push(['offset', String(params.offset)]);
  }
  const qs = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
  return qs ? `?${qs}` : '';
}
