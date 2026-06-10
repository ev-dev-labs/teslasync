package io.teslasync.shared.core.presentation.operatorconfidence

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes of the Operator-Confidence admin surfaces — the cross-platform port of the web
 * `useOperatorConfidence` hook domain (web/src/api/hooks/useOperatorConfidence.ts and
 * web/src/types/admin-operator-confidence.ts), served by the Go handlers
 * `admin_observability_handler.go`, `admin_audit_handler.go` and `gdpr_export_handler.go` under
 * `/api/v1/admin/…`.
 *
 * None of these fields is unit-bearing — they are SHA fingerprints, row/byte counts, per-call
 * millisecond timings, ISO-8601 timestamps and severity/status enums — so every value round-trips
 * verbatim with no SI conversion (the admin control-plane is already SI-agnostic). Keys arrive
 * snake_case and are matched verbatim via @SerialName so the cached payload round-trips unchanged.
 *
 * Severity/status fields that the web models as string unions are carried here as raw [String] (not
 * Kotlin enums) so an unexpected server token round-trips verbatim instead of failing the decode and
 * blanking an operator screen — the same robustness strategy the IngestXRay port uses for echoed
 * server strings. Only the [SlowQueryOrderBy] REQUEST param is an enum, so an invalid order-by is
 * unrepresentable on the native side just as the web `SlowQueryOrderBy` union constrains the caller.
 */

// ---------- Schema drift ---------------------------------------------------

/**
 * A current-vs-seed schema fingerprint (web `SchemaFingerprint`): the [sha256] of the normalised
 * DDL plus the [tableCount]/[columnCount]/[indexCount] roll-ups that produced it.
 */
@Serializable
public data class SchemaFingerprint(
    val sha256: String = "",
    @SerialName("table_count") val tableCount: Long = 0,
    @SerialName("column_count") val columnCount: Long = 0,
    @SerialName("index_count") val indexCount: Long = 0,
)

/**
 * The current-vs-expected schema comparison (web `SchemaDrift`): whether drift exists ([hasDrift]),
 * the two [current]/[expected] fingerprints, the signed table/column/index deltas, and the optional
 * [expectedGeneratedAt] stamp of when the seed fingerprint was generated.
 */
@Serializable
public data class SchemaDrift(
    @SerialName("has_drift") val hasDrift: Boolean = false,
    val current: SchemaFingerprint = SchemaFingerprint(),
    val expected: SchemaFingerprint = SchemaFingerprint(),
    @SerialName("table_count_delta") val tableCountDelta: Long = 0,
    @SerialName("column_count_delta") val columnCountDelta: Long = 0,
    @SerialName("index_count_delta") val indexCountDelta: Long = 0,
    @SerialName("expected_generated_at") val expectedGeneratedAt: String? = null,
)

/** The schema-drift envelope (web `SchemaDriftResponse`): the [drift] body plus the [isDifferent] flag. */
@Serializable
public data class SchemaDriftResponse(
    val drift: SchemaDrift = SchemaDrift(),
    @SerialName("is_different") val isDifferent: Boolean = false,
)

// ---------- Slow queries ---------------------------------------------------

/**
 * The `order_by` choices for the slow-query report — the port of the web `SlowQueryOrderBy` string
 * union. Modelling it as an enum makes an invalid order-by unrepresentable on the native side; the
 * [wire] value is the exact `order_by` query-string token the web hook sends.
 */
public enum class SlowQueryOrderBy(
    public val wire: String,
) {
    MEAN_TIME("mean_time"),
    TOTAL_TIME("total_time"),
    CALLS("calls"),
    MAX_TIME("max_time"),
}

/**
 * One `pg_stat_statements` row (web `SlowQueryRow`): the [queryId], its normalised [fingerprint],
 * the [calls] count, the total/mean/max millisecond timings, the [rowsReturned] total and the
 * optional shared-buffer hit/read counters.
 */
@Serializable
public data class SlowQueryRow(
    @SerialName("query_id") val queryId: Long = 0,
    val fingerprint: String = "",
    val calls: Long = 0,
    @SerialName("total_time_ms") val totalTimeMs: Double = 0.0,
    @SerialName("mean_time_ms") val meanTimeMs: Double = 0.0,
    @SerialName("max_time_ms") val maxTimeMs: Double = 0.0,
    @SerialName("rows_returned") val rowsReturned: Long = 0,
    @SerialName("shared_blks_hit") val sharedBlksHit: Long? = null,
    @SerialName("shared_blks_read") val sharedBlksRead: Long? = null,
)

/**
 * The slow-query report (web `SlowQueriesResponse`): the echoed [orderBy] token and the [slowQueries]
 * rows. [orderBy] is the raw echoed string (not the request enum) so an unexpected server value
 * round-trips verbatim instead of failing the decode.
 */
@Serializable
public data class SlowQueriesResponse(
    @SerialName("order_by") val orderBy: String = "",
    @SerialName("slow_queries") val slowQueries: List<SlowQueryRow> = emptyList(),
)

// ---------- Vehicle cost ---------------------------------------------------

/**
 * One vehicle's ingest-cost row (web `VehicleCostRow`): the [vehicleId], its optional [displayName],
 * the [signalRowCount]/[signalBytesEst] storage footprint, the rolling 24h [ingestRatePerMinute24h]
 * and [dlqFailures24h], and the [lastSeenAt] ISO stamp.
 */
@Serializable
public data class VehicleCostRow(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    @SerialName("display_name") val displayName: String? = null,
    @SerialName("signal_row_count") val signalRowCount: Long = 0,
    @SerialName("signal_bytes_est") val signalBytesEst: Long = 0,
    @SerialName("ingest_rate_per_minute_24h") val ingestRatePerMinute24h: Double = 0.0,
    @SerialName("dlq_failures_24h") val dlqFailures24h: Long = 0,
    @SerialName("last_seen_at") val lastSeenAt: String = "",
)

/** The fleet-wide ingest-cost totals (web `VehicleCostTotals`). */
@Serializable
public data class VehicleCostTotals(
    @SerialName("total_rows") val totalRows: Long = 0,
    @SerialName("total_bytes_est") val totalBytesEst: Long = 0,
    @SerialName("total_rate_per_minute_24h") val totalRatePerMinute24h: Double = 0.0,
    @SerialName("total_failures_24h") val totalFailures24h: Long = 0,
)

/** The vehicle-cost report (web `VehicleCostResponse`): the per-vehicle [vehicles] rows plus [totals]. */
@Serializable
public data class VehicleCostResponse(
    val vehicles: List<VehicleCostRow> = emptyList(),
    val totals: VehicleCostTotals = VehicleCostTotals(),
)

// ---------- Disk forecast --------------------------------------------------

/**
 * One hypertable's disk forecast (web `HypertableSize`): the [hypertableName], its
 * total/uncompressed/compressed byte sizes, the [chunkCount], the [growthBytesPerDay] rate, the
 * optional [estDaysToQuota] estimate and the computed [severity] tier (`ok|warn|critical|unknown`,
 * carried as a raw string).
 */
@Serializable
public data class HypertableSize(
    @SerialName("hypertable_name") val hypertableName: String = "",
    @SerialName("total_bytes") val totalBytes: Long = 0,
    @SerialName("uncompressed_bytes") val uncompressedBytes: Long = 0,
    @SerialName("compressed_bytes") val compressedBytes: Long = 0,
    @SerialName("chunk_count") val chunkCount: Long = 0,
    @SerialName("growth_bytes_per_day") val growthBytesPerDay: Double = 0.0,
    @SerialName("est_days_to_quota") val estDaysToQuota: Double? = null,
    val severity: String = "unknown",
)

/** The disk-forecast report (web `DiskForecastResponse`): the per-hypertable [hypertables] rows. */
@Serializable
public data class DiskForecastResponse(
    val hypertables: List<HypertableSize> = emptyList(),
)

// ---------- Secret rotation ------------------------------------------------

/**
 * One secret's rotation status (web `SecretRotationStatus`): the [kind] and optional [targetId], the
 * [lastRotated] ISO stamp, the [ageDays] since rotation, the optional [expiresAt]/[daysToExpiry],
 * the per-kind [warnDays]/[criticalDays] thresholds, the computed [severity] tier (carried as a raw
 * string) and an optional human [message].
 */
@Serializable
public data class SecretRotationStatus(
    val kind: String = "",
    @SerialName("target_id") val targetId: String? = null,
    @SerialName("last_rotated") val lastRotated: String = "",
    @SerialName("age_days") val ageDays: Double = 0.0,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("days_to_expiry") val daysToExpiry: Double? = null,
    @SerialName("warn_days") val warnDays: Long = 0,
    @SerialName("critical_days") val criticalDays: Long = 0,
    val severity: String = "unknown",
    val message: String? = null,
)

/** The secret-rotation report (web `SecretRotationResponse`): the per-secret [items] rows. */
@Serializable
public data class SecretRotationResponse(
    val items: List<SecretRotationStatus> = emptyList(),
)

// ---------- Audit log ------------------------------------------------------

/**
 * The audit-log filter inputs — the port of the web `AuditLogQueryParams`. Every field is optional;
 * the populated ones are folded into the snake_case query string by [auditLogQuery] (the port of the
 * web `buildAuditLogQuery`), with the multi-value [categories]/[actors]/[actions] comma-joined.
 *
 * This is a plain input value (never decoded off the wire), so it is intentionally NOT
 * `@Serializable`; the [categories]/[actors]/[actions] lists default to empty (the web "absent ⇒
 * omitted" semantics) and are emitted only when non-empty.
 */
public data class AuditLogQueryParams(
    val since: String? = null,
    val until: String? = null,
    val categories: List<String> = emptyList(),
    val actors: List<String> = emptyList(),
    val actions: List<String> = emptyList(),
    val entityType: String? = null,
    val entityId: Long? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

/**
 * One audit-log row (web `AuditLogRow`): the [id], the [ts] ISO stamp, the [actor], an optional
 * [category], the [action], the [entityType]/[entityId] target, an optional [detail], the request
 * [ip]/[userAgent], optional before/after JSON snapshots, the optional [traceId], the hash-chain
 * [prevRowHash]/[rowHash], and the optional [success] flag.
 */
@Serializable
public data class AuditLogRow(
    val id: Long = 0,
    val ts: String = "",
    val actor: String = "",
    val category: String? = null,
    val action: String = "",
    @SerialName("entity_type") val entityType: String = "",
    @SerialName("entity_id") val entityId: Long? = null,
    val detail: String? = null,
    val ip: String? = null,
    @SerialName("user_agent") val userAgent: String? = null,
    val before: String? = null,
    val after: String? = null,
    @SerialName("trace_id") val traceId: String? = null,
    @SerialName("prev_row_hash") val prevRowHash: String? = null,
    @SerialName("row_hash") val rowHash: String? = null,
    val success: Boolean? = null,
)

/** The filtered audit-log page (web `AuditLogListResponse`): the [rows] plus the echoed [limit]. */
@Serializable
public data class AuditLogListResponse(
    val rows: List<AuditLogRow> = emptyList(),
    val limit: Long = 0,
)

/** The distinct audit categories (web `AuditCategoriesResponse`) feeding the filter dropdown. */
@Serializable
public data class AuditCategoriesResponse(
    val categories: List<String> = emptyList(),
)

/** The distinct audit action names (web `AuditActionsResponse`) feeding the second filter dropdown. */
@Serializable
public data class AuditActionsResponse(
    val actions: List<String> = emptyList(),
)

/**
 * The hash-chain verification result (web `AuditChainVerifyResponse`): whether the chain is [intact],
 * the [firstBadId] (0 when intact), the number of [rowsChecked], and the echoed [since]/[limit].
 */
@Serializable
public data class AuditChainVerifyResponse(
    val intact: Boolean = false,
    @SerialName("first_bad_id") val firstBadId: Long = 0,
    @SerialName("rows_checked") val rowsChecked: Long = 0,
    val since: String = "",
    val limit: Long = 0,
)

// ---------- GDPR export ----------------------------------------------------

/**
 * The metadata for a single GDPR export artifact (web `GDPRExportArtifact`): the [id], optional
 * [userId], the [status] (`queued|running|complete|failed|expired`, carried as a raw string), the
 * [format], optional [bytes]/[sha256]/[storage]/[downloadUrl], the [createdAt] stamp, the optional
 * [completedAt]/[expiresAt] stamps and an optional [error].
 */
@Serializable
public data class GDPRExportArtifact(
    val id: String = "",
    @SerialName("user_id") val userId: String? = null,
    val status: String = "",
    val format: String = "",
    val bytes: Long? = null,
    val sha256: String? = null,
    val storage: String? = null,
    @SerialName("download_url") val downloadUrl: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    val error: String? = null,
)
