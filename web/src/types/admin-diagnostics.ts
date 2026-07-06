/**
 * @module types/admin-diagnostics
 *
 * Frontend mirrors of the Go DTOs returned by the new admin / diagnostic
 * endpoints added under `/api/v1/system/...` and `/api/v1/drives/{id}/why-ended`.
 *
 * Source of truth (read directly from):
 *   - internal/api/dlq_handler.go            (DLQEntrySummary, DLQEntryFull, DLQReplayResponse)
 *   - internal/api/flags_handler.go          (FlagsListResponse, FlagWriteResponse)
 *   - internal/api/ingest_xray_handler.go    (IngestXRayResponse)
 *   - internal/api/drive_diagnostic_handler.go (DriveDiagnosticResponse)
 *   - internal/database/dlq_replay_audit_repo.go (DLQReplayAuditRecord, result enum)
 *   - internal/database/feature_flag_changes_repo.go (FeatureFlagChange, operation enum)
 *   - internal/database/ingest_xray_repo.go  (IngestXRayFieldStat, IngestXRayBucket)
 *   - internal/database/drive_diagnostic_repo.go (DriveDiagnosticTransition, DriveDiagnosticSignal)
 *
 * If you change any of the Go structs above, update this file in lock-step.
 */

/**
 * Runtime membership test shared by every `isX` guard in this module. Each
 * guard delegates here so it reads as a named, intention-revealing predicate
 * at the call site (`isIngestXRayWindow(x)`) while the narrowing logic lives
 * in exactly one place.
 *
 * The `readonly string[]` widening is deliberate: `Array.includes` on an
 * `as const` literal tuple would otherwise reject an arbitrary `string`
 * argument at the type level — but testing arbitrary, untrusted input against
 * the accepted set is the entire point of a guard.
 */
function isLiteralMember<T extends string>(
  members: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

// ============================================================================
// DLQ Inspector
// ============================================================================

/**
 * Stable string codes returned in `DLQReplayResponse.result` and
 * `DLQReplayAuditRecord.result`. Mirrors the constants block at the top
 * of `internal/database/dlq_replay_audit_repo.go` and is the single source
 * of truth for the {@link DLQReplayResult} union below.
 *
 * - `ok`             — replay published successfully
 * - `publish_failed` — MQTT publish errored
 * - `rate_limited`   — replay rejected by per-actor rate limit
 * - `disabled`       — DLQ_REPLAY_ENABLED=false at server boot
 * - `not_found`      — entry id no longer exists (deleted between list and replay)
 * - `unparseable`    — DLQ row was missing source topic / unparseable inner payload
 */
export const DLQ_REPLAY_RESULTS = [
  'ok',
  'publish_failed',
  'rate_limited',
  'disabled',
  'not_found',
  'unparseable',
] as const;

export type DLQReplayResult = (typeof DLQ_REPLAY_RESULTS)[number];

/** Narrows an untrusted wire value to a known {@link DLQReplayResult}. */
export function isDLQReplayResult(value: unknown): value is DLQReplayResult {
  return isLiteralMember(DLQ_REPLAY_RESULTS, value);
}

/**
 * True only for the single success code (`'ok'`); every other member of
 * {@link DLQ_REPLAY_RESULTS} is a rejection or failure. Centralises the
 * "did the replay actually publish?" decision that `DLQInspectorPage` makes
 * inline (`result.result === 'ok'`) so it has one tested definition.
 */
export function isDLQReplaySuccess(result: DLQReplayResult): boolean {
  return result === 'ok';
}

/**
 * Summary row in the DLQ list view. Heavy raw_payload / inner_payload
 * are intentionally omitted by the list endpoint to keep the response
 * cheap; load `DLQEntryFull` via `useDLQEntry(id)` when the drawer opens.
 */
export interface DLQEntrySummary {
  id: number;
  arrived_at: string;
  dlq_topic: string;
  parsed_reason: string;
  parsed_vehicle_id: number | null;
  parsed_vin: string | null;
  parsed_source_topic: string | null;
  parsed_redeliveries: number | null;
  parsed_timestamp: string | null;
  parse_error: string | null;
  replayable: boolean;
  raw_payload_size: number;
  inner_payload_size: number;
}

/**
 * Full DLQ row — `DLQEntrySummary` plus the two payload blobs as
 * base64 strings. Used by the entry drawer to expose copy / download.
 */
export interface DLQEntryFull extends DLQEntrySummary {
  raw_payload_b64: string;
  inner_payload_b64: string;
}

export interface DLQListResponse {
  count: number;
  replay_enabled: boolean;
  entries: DLQEntrySummary[];
}

export interface DLQReplayResponse {
  ok: boolean;
  replayed_id: number;
  dst_topic: string;
  result: DLQReplayResult;
  error?: string;
  audit_id?: number;
}

export interface DLQReplayAuditRecord {
  id: number;
  replayed_at: string;
  actor: string;
  actor_ip: string;
  dlq_id: number;
  src_topic: string;
  dst_topic: string;
  payload: string;
  reason: string;
  result: DLQReplayResult;
  error: string;
  trace_id: string;
}

export interface DLQAuditResponse {
  count: number;
  limit: number;
  dlq_id: number;
  rows: DLQReplayAuditRecord[];
}

// ============================================================================
// Feature Flags
// ============================================================================

/** Operation enum from `internal/database/feature_flag_changes_repo.go`. */
export const FEATURE_FLAG_OPERATIONS = ['set', 'delete'] as const;

export type FeatureFlagOperation = (typeof FEATURE_FLAG_OPERATIONS)[number];

/** Narrows an untrusted wire value to a known {@link FeatureFlagOperation}. */
export function isFeatureFlagOperation(value: unknown): value is FeatureFlagOperation {
  return isLiteralMember(FEATURE_FLAG_OPERATIONS, value);
}

/** Flag value is stored as JSON in Postgres and surfaces here as `unknown`. */
export type FeatureFlagValue = unknown;

export interface FeatureFlagEntry {
  key: string;
  value: FeatureFlagValue;
}

export interface FeatureFlagsListResponse {
  count: number;
  flags: FeatureFlagEntry[];
}

export interface FeatureFlagSetRequest {
  value: FeatureFlagValue;
  reason: string;
}

export interface FeatureFlagWriteResponse {
  key: string;
  old_value: FeatureFlagValue | null;
  new_value?: FeatureFlagValue;
  deleted?: boolean;
  audit_id: number;
}

export interface FeatureFlagChange {
  id: number;
  changed_at: string;
  actor: string;
  actor_ip: string;
  flag_key: string;
  operation: FeatureFlagOperation;
  old_value: FeatureFlagValue | null;
  new_value: FeatureFlagValue | null;
  reason: string;
  trace_id: string;
}

export interface FeatureFlagChangesResponse {
  count: number;
  flag_key: string;
  limit: number;
  rows: FeatureFlagChange[];
}

// ============================================================================
// Ingest X-Ray
// ============================================================================

/** Allowed window literals — server rejects anything else with 400. */
export const INGEST_XRAY_WINDOWS = ['5m', '15m', '1h', '6h', '24h'] as const;

export type IngestXRayWindow = (typeof INGEST_XRAY_WINDOWS)[number];

/** Narrows an untrusted wire/UI value to a known {@link IngestXRayWindow}. */
export function isIngestXRayWindow(value: unknown): value is IngestXRayWindow {
  return isLiteralMember(INGEST_XRAY_WINDOWS, value);
}

/** Allowed bucket literals — server rejects anything else with 400. */
export const INGEST_XRAY_BUCKETS = ['30s', '1m', '5m', '15m', '1h'] as const;

export type IngestXRayBucket = (typeof INGEST_XRAY_BUCKETS)[number];

/** Narrows an untrusted wire/UI value to a known {@link IngestXRayBucket}. */
export function isIngestXRayBucket(value: unknown): value is IngestXRayBucket {
  return isLiteralMember(INGEST_XRAY_BUCKETS, value);
}

/**
 * `value_kind` matches `protomodel.ValueKind` in the Go ingest path.
 * 0 is "unknown", everything else is a typed kind.
 */
export type IngestXRayValueKind = number;

export interface IngestXRayFieldStat {
  field: string;
  sample_count: number;
  last_seen_at: string;
  value_kind: IngestXRayValueKind;
}

export interface IngestXRayBucketPoint {
  bucket_start: string;
  count: number;
}

export interface IngestXRayResponse {
  vehicle_id: number;
  window: IngestXRayWindow;
  bucket: IngestXRayBucket;
  generated_at: string;
  total_samples: number;
  unique_fields: number;
  fields: IngestXRayFieldStat[];
  buckets: IngestXRayBucketPoint[];
}

// ============================================================================
// Drive Diagnostic — "Why did this drive end?"
// ============================================================================

/** Allowed diagnostic windows — server rejects anything else with 400. */
export const DRIVE_DIAGNOSTIC_WINDOWS = ['30s', '60s', '5m', '15m'] as const;

export type DriveDiagnosticWindow = (typeof DRIVE_DIAGNOSTIC_WINDOWS)[number];

/** Narrows an untrusted wire/UI value to a known {@link DriveDiagnosticWindow}. */
export function isDriveDiagnosticWindow(value: unknown): value is DriveDiagnosticWindow {
  return isLiteralMember(DRIVE_DIAGNOSTIC_WINDOWS, value);
}

export interface DriveDiagnosticTransition {
  id: number;
  ts: string;
  fsm_name: string;
  from_state: string;
  to_state: string;
  trigger: string;
  /** Raw JSON object as returned by the FSM repo; shape depends on the FSM. */
  details_json: Record<string, unknown> | null;
}

export interface DriveDiagnosticSignal {
  ts: string;
  field: string;
  /** Pre-rendered string from the server (typed_value via renderTypedValue). */
  value: string;
}

export interface DriveDiagnosticResponse {
  drive_id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts: string | null;
  ended_status: string | null;
  window: DriveDiagnosticWindow;
  fsm_transitions: DriveDiagnosticTransition[];
  signal_window: DriveDiagnosticSignal[];
}
