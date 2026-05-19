// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

import type { ChargingSession, Drive } from './core'
// === API Keys ===

export interface APIKey {
  id: number
  name: string
  key_prefix: string
  permissions: string
  last_used_at?: string
  created_at: string
  expires_at?: string
}

// === Audit Logs ===

export interface AuditLog {
  id: number
  action: string
  resource: string
  details: string
  ip: string
  created_at: string
}

// === System / Admin ===

export interface APIUsage {
  total_requests: number
  skipped_polls: number
  estimated_cost: number
  cost_per_request: number
  monthly_credit: number
  estimated_remaining: number
}

export interface CompressionStats {
  total: number
  compressed: number
  savings_percent: number
  total_positions: number
  compressed_positions: number
  estimated_saved_rows: number
  estimated_saved_bytes: number
}

export interface ExtendedHealthResponse {
  status: string
  components: Record<string, { status: string; latency_ms?: number; last_check?: string; consecutive_failures?: number }>
  database: { status: string; latency_ms: number }
  database_pool: { total_conns: number; idle_conns: number; acquired_conns: number }
  system: { goroutines: number; go_version: string; uptime_seconds: number }
}

// === Aggregated diagnostic / self-test (Phase-46 / Prompt 33) ===

export type DiagnosticCheckStatus = 'ok' | 'warn' | 'fail'
export type DiagnosticOverallStatus = 'ok' | 'degraded' | 'down'

export interface DiagnosticCheck {
  id: string
  name: string
  status: DiagnosticCheckStatus
  detail: string
  remediation?: string
  duration_ms: number
}

export interface DiagnosticReport {
  generated_at: string
  overall_status: DiagnosticOverallStatus
  checks: DiagnosticCheck[]
}

export interface BackupStats {
  database_size: string
  table_count: number
  row_counts: Record<string, number>
}

export interface ErrorStatsByCode {
  count: number
  last_seen: string
  last_message: string
}

export interface ErrorStats {
  total_errors: number
  uptime: string
  by_code: Record<string, ErrorStatsByCode>
}

export interface MapConfig {
  provider: 'free' | 'azure' | 'google'
  api_key: string
}

// === API Call Logs ===

export interface APICallLog {
  id: number
  ts: string
  vehicle_id: number | null
  service: string
  http_method: string
  endpoint: string
  status_code: number | null
  duration_ms: number
  error_message: string | null
  rate_limited: boolean
  request_body: string | null
  response_body: string | null
}

export interface APICallLogResponse {
  data: APICallLog[]
  total: number
  limit: number
  offset: number
}

export interface APICallLogStats {
  total_calls: number
  by_method: Record<string, number>
  by_service: Record<string, number>
  error_rate: number
  error_count: number
  avg_duration_ms: number
  last_24h: number
}

// === Version & Update Check ===

export interface VersionInfo {
  app_version: string
  chart_version: string
  go_version: string
  os: string
  arch: string
  uptime_seconds: number
  goroutines: number
  endpoints?: {
    api?: string
    web?: string
    oauth_callback?: string
    tesla_api?: string
  }
}

export interface UpdateCheckResult {
  current: string
  latest: string
  update_available: boolean
  checked_at?: string
  message?: string
}

// === Export Jobs (Async) ===

export interface ExportJobSummary {
  id: string
  type: string
  format: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  file_name: string
  file_size: number
  record_count: number
  error_message: string
  created_at: string
  completed_at: string | null
}

export interface ExportJobSubmitRequest {
  type: 'drives' | 'charging' | 'backup' | 'analytics' | 'import_drives' | 'import_charging'
  format?: 'csv' | 'json'
  vehicle_id?: number
  start?: string
  end?: string
}

export interface ExportJobSubmitResponse {
  id: string
  type: string
  format: string
  status: string
  message: string
}

// === Data Repair ===

export interface StaleSessionsResponse {
  stale_charging: ChargingSession[]
  stale_drives: Drive[]
}

// === Telemetry Capture ===

export interface CaptureStats {
  mongodb_enabled: boolean
  capture_enabled: boolean
  total_documents: number
  distinct_vins: string[]
}

// === Rate-limit status (Phase-46 / Prompt 40) ===

/** Single scope row returned by GET /api/v1/system/rate-limits. */
export type RateLimitSeverity = 'ok' | 'warn' | 'critical'

export interface ScopeBudget {
  /** Stable scope identifier; see backend RateLimitScope* constants. */
  id: string
  /** Human-readable label rendered next to the bar. */
  name: string
  /** Observed usage in the same unit as `limit`. */
  current: number
  /** Per-window cap. */
  limit: number
  /** Sliding-window length in seconds. Zero means a token-bucket snapshot. */
  window_seconds: number
  /** Optional UTC instant at which the bucket fully refills. */
  reset_at?: string | null
  /** Colour band the panel renders. */
  severity: RateLimitSeverity
  /** Operator-facing footnote shown under the row. */
  detail?: string
}

/** Envelope for GET /api/v1/system/rate-limits. */
export interface RateLimitStatusResponse {
  generated_at: string
  scopes: ScopeBudget[]
}

// === Job queue status (Phase-46 / Prompt 41) ===

/** Heartbeat staleness band rendered by the queue status panel. */
export type QueueHeartbeatSeverity = 'ok' | 'warn' | 'critical' | 'down'

/** Canonical worker identifiers exposed by the backend. Mirror of database.WorkerName*. */
export type QueueWorkerName = 'notification' | 'export' | 'automation'

/**
 * Single worker row returned by GET /api/v1/system/queues.
 *
 * Counts come from each worker's domain table (notification_logs,
 * export_jobs, automation_history) aggregated over the last 24
 * hours. Heartbeat fields come from the Redis worker_status key
 * each worker writes via internal/worker/heartbeat.Heartbeater.
 */
export interface QueueStat {
  /** Stable worker identifier — use for routing the drawer. */
  worker: string
  /** Human-readable label (English fallback; SPA may translate). */
  display_name: string
  /** Items waiting to be picked up by the worker. */
  pending: number
  /** Items currently being processed. */
  in_progress: number
  /** Items completed successfully in the last 24 hours. */
  succeeded_24h: number
  /** Items that failed terminally in the last 24 hours. */
  failed_24h: number
  /** Age in seconds of the oldest pending item (0 = none). */
  oldest_pending_age_seconds: number
  /** Color band the panel renders for the heartbeat freshness. */
  heartbeat_severity: QueueHeartbeatSeverity
  /** Operator-facing footnote (e.g. "Last beat 7m ago"). */
  heartbeat_detail: string
  /** ISO timestamp of the worker's most recent heartbeat. */
  last_heartbeat_at?: string | null
  /** ISO timestamp the current worker process started. */
  started_at?: string | null
  /** Hostname the worker is running on. */
  host?: string
  /** Build version reported by the worker. */
  version?: string
}

/** Envelope for GET /api/v1/system/queues. */
export interface QueueStatusResponse {
  generated_at: string
  workers: QueueStat[]
}

/**
 * Single recent-job row rendered inside the per-worker drawer.
 * Mirrors the backend QueueJobView struct.
 */
export interface QueueJobView {
  id: string
  worker: string
  status: string
  title: string
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
  error?: string
}

/** Envelope for GET /api/v1/system/queues/{worker}/jobs. */
export interface QueueJobsResponse {
  worker: string
  jobs: QueueJobView[]
}

/* Phase-46 / Prompt 43 - Per-vehicle settings layer
 * ───────────────────────────────────────────────────
 * The resolver returns one EffectiveSetting per supported key, each
 * tagged with the layer that produced its value. The SPA's
 * VehicleSettingsTab renders a "source" pill from this discriminator.
 *
 * Sources:
 *  - 'override': vehicle_settings row exists for (vehicleID, key)
 *  - 'user'    : install-global SettingsRepo provided the value
 *  - 'vehicle' : vehicles base table (e.g. nickname → display_name)
 *  - 'default' : hard-coded fallback in the Go database package
 *
 * Backend source: internal/database/vehicle_settings_repo.go ::
 * EffectiveSettingSource + internal/api/vehicle_settings_handler.go.
 */
export type EffectiveSettingSource = 'override' | 'user' | 'vehicle' | 'default'

/**
 * One resolved per-vehicle setting row. `value` is rendered by the
 * SPA against the per-key UnitInput / picker / datetime control; the
 * pill renders `source` so the user can tell which layer produced
 * the current effective value.
 *
 * The wire shape is {key, value, source} — the resolver always
 * fills `value` (no nulls) so the SPA can render every row without
 * presence checks.
 */
export interface EffectiveSetting {
  key: string
  value: unknown
  source: EffectiveSettingSource
}

/** Envelope for GET /api/v1/vehicles/{vehicleID}/settings. */
export interface VehicleSettingsResponse {
  settings: EffectiveSetting[]
}

/**
 * Per-key value type for the PUT body. The handler dispatches on
 * the key's kind (text|number|boolean|timestamp) and rejects values
 * that don't match — see decodeValueForKey in
 * internal/api/vehicle_settings_handler.go.
 *
 * The SPA builds these from typed inputs, so the union is
 * intentionally narrow rather than `any`.
 */
export type VehicleSettingValue = string | number | boolean

// ─────────────────────────────────────────────────────────────────────────────
// Phase-46 / Prompt 44 — RBAC matrix admin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RBAC permission catalog entry as emitted by GET /admin/rbac/matrix.
 * IDs are stable, lowercase, dotted strings (e.g. `fleet.read`); the
 * admin matrix UI groups rows by `category` and renders `name` as
 * the user-visible label.
 */
export interface RbacPermission {
  id: string
  name: string
  category: string
}

/**
 * RBAC role identity. `id` is the upstream proxy group name verbatim
 * (or the implicit `user` default when no groups header is
 * configured); `name` is the matrix-column label — currently identical
 * to `id` but split out so a future "display label" pass doesn't
 * break the API contract.
 */
export interface RbacRole {
  id: string
  name: string
}

/**
 * Matrix payload. `matrix[role_id][perm_id]` is true when the role
 * grants the permission. A missing `role_id` row OR a missing
 * `perm_id` cell within a row both mean "no opinion → deny".
 *
 * `effective_for_me` is the merged grant map for the calling subject
 * across `my_roles`; the SPA renders it as a "what I can do right
 * now" pill so the operator can sanity-check their own role
 * assignment before publishing matrix edits.
 *
 * `mode === 'open'` is the synthetic envelope returned by the
 * useRbacMatrix hook when the backend reports AUTH_MODE_OPEN — the
 * SPA renders an inline "configure forward-auth" placeholder instead
 * of a 401/501 toast.
 */
export type RbacMatrixResponse =
  | RbacMatrixSessionResponse
  | RbacMatrixOpenModeResponse

export interface RbacMatrixSessionResponse {
  mode: 'session'
  roles: RbacRole[]
  permissions: RbacPermission[]
  categories: string[]
  matrix: Record<string, Record<string, boolean>>
  effective_for_me: Record<string, boolean>
  my_roles: string[]
  groups_header_name?: string
}

export interface RbacMatrixOpenModeResponse {
  mode: 'open'
}

/**
 * Single cell in a PUT /admin/rbac/matrix batch. The handler caps a
 * single request at `MaxRBACUpsertCells` (1000) cells; the SPA is
 * expected to send only the cells the operator actually toggled, so
 * realistic payloads are tiny.
 */
export interface RbacUpsertCell {
  role_id: string
  permission_id: string
  allowed: boolean
}

export interface RbacUpsertRequest {
  cells: RbacUpsertCell[]
}

// Phase-46 / Prompt 46 — Admin impersonation API contracts.
//
// The state endpoint returns one of three modes: 'open' (501 in open-
// mode installs), 'inactive' (forward-auth, no cookie present), or
// 'active' (forward-auth, valid cookie). Discriminated unions let the
// banner hide / show without mode-string string-comparisons in the
// component.
export type ImpersonationStatus =
  | { mode: 'open' }
  | { mode: 'inactive' }
  | {
      mode: 'active'
      original_admin: string
      target: string
      expires_at: string
    }

// Single row in the candidates list. Subject is the opaque
// proxy-issued identity; the SPA renders it verbatim because the
// future prompt 57 may add a display-name column without changing
// this contract.
export interface ImpersonationCandidate {
  subject: string
}

export type ImpersonationCandidatesResponse =
  | { mode: 'open' }
  | {
      mode: 'session'
      candidates: ImpersonationCandidate[]
    }

export interface ImpersonationStartRequest {
  subject: string
}

/**
 * Phase-46 / Prompt 54 — Vehicle photo upload types.
 *
 * The backend stores three rendered sizes per upload (thumb 256,
 * medium 1024, full 2048 pixels along the longer edge); GET /photo
 * returns metadata only and the SPA builds the actual bytes URL via
 * vehiclePhotoUrl() with uploaded_at as the cache buster.
 */
export type VehiclePhotoSize = 'thumb' | 'medium' | 'full'

export interface VehiclePhotoSizes {
  thumb: VehiclePhotoSize
  medium: VehiclePhotoSize
  full: VehiclePhotoSize
}

export interface VehiclePhotoMeta {
  has_photo: boolean
  uploaded_at?: string
  sizes?: VehiclePhotoSizes
}

// === Auth-mode contract (Phase-46 / Prompt 57) ===

/**
 * Two-state classification returned by GET /api/v1/system/auth-mode.
 *
 *   - `open`         — no upstream identity provider configured
 *                      (FORWARD_AUTH_HEADER unset). The SPA should
 *                      replace every auth-coupled section with the
 *                      <RequiresAuth> placeholder.
 *   - `forward_auth` — a ForwardAuth-shaped reverse proxy is in
 *                      front of TeslaSync (Authentik, Authelia,
 *                      oauth2-proxy, Keycloak, …) and is supplying
 *                      the identity header named in `subject_header`.
 *
 * The string is the source of truth; never derive the mode from
 * `subject_header` being set, because the proxy can momentarily
 * strip the header on a single request even when the deployment
 * is configured for forward-auth.
 */
export type AuthMode = 'open' | 'forward_auth'

/**
 * Per-feature gate the SPA uses to decide whether to mount an
 * auth-coupled section or replace it with the inline <RequiresAuth>
 * placeholder. Every field is `false` in open mode and `true` in
 * forward-auth mode (the per-feature *preconditions* live inside
 * each feature's own handler — this matrix only reports whether
 * the deployment's auth mode allows the feature to exist at all).
 *
 * Keep these keys in lock-step with `internal/api.AuthModeCapabilities`
 * — drift here silently disables the corresponding section.
 */
export interface AuthModeCapabilities {
  step_up_reauth: boolean
  totp_enrollment: boolean
  session_list: boolean
  impersonation: boolean
  rbac: boolean
}

/** Envelope returned by `GET /api/v1/system/auth-mode`. */
export interface AuthModeResponse {
  mode: AuthMode
  /** Header name TeslaSync reads (e.g. "X-Forwarded-User"). Omitted in open mode. */
  subject_header?: string
  /**
   * The current request's resolved subject (the value of
   * `subject_header`). `null` / undefined in open mode AND when
   * the proxy stripped the header for this specific request.
   */
  subject?: string | null
  /**
   * Operator-supplied free text — typically the upstream IdP's
   * brand name. The SPA renders this verbatim in the
   * <RequiresAuth> empty state and the session-timeout banner;
   * it is NEVER used as a routing key.
   */
  provider_hint?: string
  capabilities: AuthModeCapabilities
}

// === Pinned items (Phase 40 / Prompt 48) ===

export type PinnedItemType =
  | 'vehicle'
  | 'widget'
  | 'alert_rule'
  | 'location'
  | 'geofence'
  | 'automation'
  | 'dashboard'
  | 'command'

export interface PinnedItem {
  id: number
  user_id?: number | null
  item_type: PinnedItemType
  item_id: string
  position: number
  pinned_at: string
  context?: string | null
}

// === Saved views (Phase 40 / Prompt 50) ===

export interface SavedView {
  id: number
  user_id?: number | null
  name: string
  route: string
  query: string
  is_default: boolean
  is_pinned: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SavedViewCreateInput {
  name: string
  route: string
  query: string
  is_default?: boolean
  is_pinned?: boolean
  sort_order?: number
}

export interface SavedViewUpdateInput {
  name?: string
  query?: string
  is_default?: boolean
  is_pinned?: boolean
  sort_order?: number
}

// ── Web Push (Phase 40 / Prompt 52) ────────────────────────────────────────

/**
 * One row of `push_subscriptions`. Mirrors `internal/models.PushSubscription`.
 * The `keys` shape is intentionally NOT a nested object because the server
 * stores `p256dh` / `auth` flat alongside `endpoint` (the wire shape is
 * snake_case to match Go JSON tags; `camelCaseKeys()` also exposes
 * camelCase aliases on every response).
 */
export interface PushSubscriptionRow {
  id: number
  user_id: number | null
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_used_at: string | null
}

/**
 * Browser-side PushSubscription.toJSON() shape — POST body for
 * `/push/subscribe`. The server validates `endpoint` is a well-formed
 * https:// URL and that both keys are non-empty.
 */
export interface PushSubscribeBody {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}
