package io.teslasync.shared.core.presentation.featureflags

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/*
 * The wire shapes of the typed feature-flag registry — the cross-platform port of the web
 * `useFeatureFlags` hook domain's response types (web/src/types/admin-diagnostics.ts), which
 * mirror the Go handlers in `internal/api/apiflagsh` and the `feature_flag_changes` table. Keys
 * arrive snake_case from `GET /api/v1/system/flags*`; they are matched verbatim via @SerialName
 * so the cached payload round-trips unchanged.
 *
 * A flag value is arbitrary JSON (the web `FeatureFlagValue = unknown`, stored as JSONB in
 * Postgres), so every value field is carried as a raw JsonElement rather than a narrowed type —
 * the exact server shape survives the cache round-trip with no lossy coercion. None of these
 * fields is unit-bearing, so there is no SI conversion at this layer; display formatting is the
 * render boundary's job (S5).
 */

/** One stored flag (web `FeatureFlagEntry`): a key and its arbitrary-JSON value. */
@Serializable
public data class FeatureFlagEntry(
    val key: String,
    val value: JsonElement = JsonNull,
)

/** The `GET /system/flags` envelope (web `FeatureFlagsListResponse`). */
@Serializable
public data class FeatureFlagsListResponse(
    val count: Int = 0,
    val flags: List<FeatureFlagEntry> = emptyList(),
)

/**
 * One audit row from the flag-change feed (web `FeatureFlagChange`), as returned by
 * `GET /system/flags/changes` and `GET /system/flags/{key}/changes`. [operation] is the
 * `'set' | 'delete'` enum; [oldValue]/[newValue] are arbitrary JSON (null on a create / a delete
 * respectively).
 */
@Serializable
public data class FeatureFlagChange(
    val id: Long,
    @SerialName("changed_at") val changedAt: String,
    val actor: String,
    @SerialName("actor_ip") val actorIp: String,
    @SerialName("flag_key") val flagKey: String,
    val operation: String,
    @SerialName("old_value") val oldValue: JsonElement = JsonNull,
    @SerialName("new_value") val newValue: JsonElement = JsonNull,
    val reason: String,
    @SerialName("trace_id") val traceId: String,
)

/** The flag-change audit envelope (web `FeatureFlagChangesResponse`). */
@Serializable
public data class FeatureFlagChangesResponse(
    val count: Int = 0,
    @SerialName("flag_key") val flagKey: String = "",
    val limit: Int = 0,
    val rows: List<FeatureFlagChange> = emptyList(),
)

/**
 * The `PUT`/`DELETE /system/flags/{key}` response (web `FeatureFlagWriteResponse`). [newValue]
 * is absent on a delete and [deleted] is absent on a set, mirroring the optional web fields; both
 * default so either shape decodes. [auditId] is the id of the `feature_flag_changes` row the write
 * appended.
 */
@Serializable
public data class FeatureFlagWriteResponse(
    val key: String,
    @SerialName("old_value") val oldValue: JsonElement = JsonNull,
    @SerialName("new_value") val newValue: JsonElement = JsonNull,
    val deleted: Boolean = false,
    @SerialName("audit_id") val auditId: Long = 0,
)
