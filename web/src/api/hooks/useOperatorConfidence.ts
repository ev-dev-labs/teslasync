/**
 * @module api/hooks/useOperatorConfidence
 *
 * TanStack Query bindings for operator-confidence admin surfaces mounted
 * under `/api/v1/admin/*`. Backed by Go handlers in
 * `internal/handler/v1/admin_observability_handler.go`,
 * `internal/handler/v1/admin_audit_handler.go`, and
 * `internal/handler/v1/gdpr_export_handler.go`.
 *
 * Endpoint summary (router.go ~L3640–3683):
 *   GET    /admin/observability/schema-drift     → SchemaDriftResponse
 *   GET    /admin/observability/slow-queries     → SlowQueriesResponse
 *   GET    /admin/observability/vehicle-cost     → VehicleCostResponse
 *   GET    /admin/observability/disk-forecast    → DiskForecastResponse
 *   GET    /admin/observability/secret-rotation  → SecretRotationResponse
 *   GET    /admin/audit-log                      → AuditLogListResponse
 *   GET    /admin/audit-log/categories           → AuditCategoriesResponse
 *   GET    /admin/audit-log/actions              → AuditActionsResponse
 *   GET    /admin/audit-log/verify               → AuditChainVerifyResponse
 *   GET    /admin/gdpr/exports/{id}              → GDPRExportArtifact
 *
 * Every route is read-only (no mutations). Each route returns HTTP 503
 * with `code: 'SUBSYSTEM_NOT_CONFIGURED'` when its backing repo is nil
 * — callers should branch on `error.status === 503` to render an
 * explanatory empty-state rather than an error banner.
 *
 * The shared `request()` client auto-prepends `/api/v1`, so hook URLs
 * MUST NOT include that prefix (DRY anti-pattern guard #7).
 */

import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';

/**
 * Admin observability + audit + GDPR handlers all use the platform
 * `httputil.Respond` envelope which wraps payloads as `{data: T}`
 * (see internal/platform/httputil/response.go). The shared `request()`
 * client does NOT unwrap — older handlers in internal/api/* call
 * `writeJSON` directly without the envelope, so unwrapping at the
 * client layer would break them.
 *
 * This helper unwraps the envelope per-hook. It's a no-op when the
 * body has no `data` key (defensive — keeps the hook working if a
 * handler is ever migrated off `httputil.Respond`).
 */
async function fetchEnvelope<T>(promise: Promise<unknown>): Promise<T> {
  const body = await promise;
  if (
    body !== null &&
    typeof body === 'object' &&
    'data' in (body as Record<string, unknown>)
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}
import type {
  AuditActionsResponse,
  AuditCategoriesResponse,
  AuditChainVerifyResponse,
  AuditLogListResponse,
  AuditLogQueryParams,
  DiskForecastResponse,
  GDPRExportArtifact,
  SchemaDriftResponse,
  SecretRotationResponse,
  SlowQueriesResponse,
  SlowQueryOrderBy,
  VehicleCostResponse,
} from '@/types/admin-operator-confidence';

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

// ---------- Schema drift ---------------------------------------------------

/**
 * Current vs seed schema fingerprint. Drift surfaces if a migration
 * ran without a corresponding seed regeneration, or if someone ran
 * raw DDL against production. Polled at SLOW (60 s) — drift is a
 * deployment-time event, not a runtime one.
 */
export function useSchemaDrift() {
  return useQuery({
    queryKey: operatorConfidenceKeys.schemaDrift,
    queryFn: ({ signal }) =>
      fetchEnvelope<SchemaDriftResponse>(
        request('/admin/observability/schema-drift', { signal }),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Slow queries ---------------------------------------------------

/**
 * Top-N pg_stat_statements rows ordered by `orderBy`. Backend caps
 * limit at the repo level; we ask for whatever the caller wants up
 * to 100. Polled at STANDARD (30 s) — pg_stat_statements is a live
 * counter view, refreshing this often will not stress PG.
 */
export function useSlowQueries(orderBy: SlowQueryOrderBy = 'mean_time', limit = 25) {
  return useQuery({
    queryKey: operatorConfidenceKeys.slowQueries(orderBy, limit),
    queryFn: ({ signal }) =>
      fetchEnvelope<SlowQueriesResponse>(
        request(
          `/admin/observability/slow-queries?order_by=${orderBy}&limit=${limit}`,
          { signal },
        ),
      ),
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Vehicle cost ---------------------------------------------------

/**
 * Per-vehicle ingest cost report (row count, byte estimate, ingest
 * rate, DLQ failures) for vehicles seen since `since`. Defaults to
 * the last 30 days when `since` is null. Polled at SLOW (60 s) —
 * costs evolve over minutes, not seconds.
 */
export function useVehicleCost(since: Date | null = null, limit = 100) {
  const sinceISO = toISOStringOrNull(since);
  const sinceParam = sinceISO ? `&since=${encodeURIComponent(sinceISO)}` : '';
  return useQuery({
    queryKey: operatorConfidenceKeys.vehicleCost(sinceISO, limit),
    queryFn: ({ signal }) =>
      fetchEnvelope<VehicleCostResponse>(
        request(
          `/admin/observability/vehicle-cost?limit=${limit}${sinceParam}`,
          { signal },
        ),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Disk forecast --------------------------------------------------

/**
 * Per-hypertable disk size, growth rate, and days-to-quota estimate.
 * Polled at SLOW (60 s) — disk usage grows over hours not seconds.
 */
export function useDiskForecast() {
  return useQuery({
    queryKey: operatorConfidenceKeys.diskForecast,
    queryFn: ({ signal }) =>
      fetchEnvelope<DiskForecastResponse>(
        request('/admin/observability/disk-forecast', { signal }),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Secret rotation ------------------------------------------------

/**
 * Per-(kind, target) rotation status: last_rotated, age_days, severity
 * tier from per-kind thresholds. Polled at SLOW (60 s).
 */
export function useSecretRotation() {
  return useQuery({
    queryKey: operatorConfidenceKeys.secretRotation,
    queryFn: ({ signal }) =>
      fetchEnvelope<SecretRotationResponse>(
        request('/admin/observability/secret-rotation', { signal }),
      ),
    staleTime: STALE_TIMES.STANDARD,
    refetchInterval: INTERVALS.SLOW,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- Audit log ------------------------------------------------------

/**
 * Filtered audit log rows. Filters are passed as snake_case query
 * params (DRY anti-pattern guard #8). Polled at STANDARD (30 s).
 *
 * `enabled` lets the page hold off the first fetch until the
 * dropdowns are populated.
 */
export function useAuditLog(params: AuditLogQueryParams, enabled = true) {
  const qs = buildAuditLogQuery(params);
  return useQuery({
    queryKey: operatorConfidenceKeys.auditLogList(params),
    queryFn: ({ signal }) =>
      fetchEnvelope<AuditLogListResponse>(
        request(`/admin/audit-log${qs}`, { signal }),
      ),
    enabled,
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Distinct categories — fed straight into the filter dropdown.
 * Staleness is STATIC because the set is effectively fixed for a
 * given deployment.
 */
export function useAuditCategories() {
  return useQuery({
    queryKey: operatorConfidenceKeys.auditCategories,
    queryFn: ({ signal }) =>
      fetchEnvelope<AuditCategoriesResponse>(
        request('/admin/audit-log/categories', { signal }),
      ),
    staleTime: STALE_TIMES.EXTENDED,
    refetchInterval: INTERVALS.RARE,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/** Distinct action names — feeds the second filter dropdown. */
export function useAuditActions() {
  return useQuery({
    queryKey: operatorConfidenceKeys.auditActions,
    queryFn: ({ signal }) =>
      fetchEnvelope<AuditActionsResponse>(
        request('/admin/audit-log/actions', { signal }),
      ),
    staleTime: STALE_TIMES.EXTENDED,
    refetchInterval: INTERVALS.RARE,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * SHA-256 chain re-derivation. `intact` is true iff every row's
 * row_hash == sha256(prev_row_hash || canonical(row_payload)).
 * Defaults to verifying the last 1 000 rows since 30 d ago. NOT
 * polled — verification is an explicit operator action via the
 * "Re-verify" button on the page (this hook is created with
 * `enabled=false` and the button triggers refetch()).
 */
export function useAuditChainVerify(
  since: Date | null = null,
  limit = 1000,
  enabled = false,
) {
  const sinceISO = toISOStringOrNull(since);
  const sinceParam = sinceISO ? `&since=${encodeURIComponent(sinceISO)}` : '';
  return useQuery({
    queryKey: operatorConfidenceKeys.auditVerify(sinceISO, limit),
    queryFn: ({ signal }) =>
      fetchEnvelope<AuditChainVerifyResponse>(
        request(
          `/admin/audit-log/verify?limit=${limit}${sinceParam}`,
          { signal },
        ),
      ),
    enabled,
    staleTime: STALE_TIMES.FAST,
    refetchInterval: false,
    retry: 1,
  });
}

// ---------- GDPR export ----------------------------------------------------

/**
 * Fetch the metadata for a single GDPR export artifact by ID. The
 * actual file download happens via `/admin/gdpr/exports/{id}/download`
 * which is a browser-redirect stream — the page builds that URL
 * client-side rather than fetching binary data through this hook.
 *
 * Polled at FAST (10 s) while status is queued/running, switched off
 * by the page once complete (via `enabled=false`).
 */
export function useGDPRExport(id: string | null) {
  return useQuery({
    queryKey: operatorConfidenceKeys.gdprExport(id ?? '__none__'),
    queryFn: ({ signal }) =>
      fetchEnvelope<GDPRExportArtifact>(
        request(`/admin/gdpr/exports/${id}`, { signal }),
      ),
    enabled: Boolean(id),
    staleTime: STALE_TIMES.QUICK,
    refetchInterval: INTERVALS.FAST,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

// ---------- helpers --------------------------------------------------------

/**
 * Converts a Date to an ISO-8601 string, returning null for a null input
 * OR an invalid Date. Guards the render path: a caller that builds `since`
 * from user input (e.g. `new Date(userValue)`) can hand us an invalid Date
 * whose `.toISOString()` throws `RangeError: Invalid time value`. Because
 * this runs in the hook body (not the deferred queryFn), an unguarded call
 * would crash the component synchronously. Falling back to null degrades to
 * the "no since filter" default instead.
 */
function toISOStringOrNull(d: Date | null): string | null {
  if (d == null) return null;
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : d.toISOString();
}

function buildAuditLogQuery(params: AuditLogQueryParams): string {
  const u = new URLSearchParams();
  if (params.since) u.set('since', params.since);
  if (params.until) u.set('until', params.until);
  if (params.categories && params.categories.length > 0)
    u.set('categories', params.categories.join(','));
  if (params.actors && params.actors.length > 0)
    u.set('actors', params.actors.join(','));
  if (params.actions && params.actions.length > 0)
    u.set('actions', params.actions.join(','));
  if (params.entity_type) u.set('entity_type', params.entity_type);
  if (params.entity_id !== undefined) u.set('entity_id', String(params.entity_id));
  if (params.limit !== undefined) u.set('limit', String(params.limit));
  if (params.offset !== undefined) u.set('offset', String(params.offset));
  const qs = u.toString();
  return qs ? `?${qs}` : '';
}
