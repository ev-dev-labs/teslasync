package io.teslasync.shared.core.presentation.exports

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The cross-platform port of the web Exports domain types
 * (web/src/types/export.ts + the local interfaces declared inline in
 * web/src/api/hooks/useExports.ts). Every native Exports screen (Android/Apple via KMP,
 * Windows via the C# port) binds to these shapes through the S7
 * io.teslasync.shared.core.data.repo.ExportsRepository and the S8 ExportsStore.
 *
 * Two distinct job shapes exist on the web, and BOTH are reproduced verbatim:
 *  - ExportJobSummary (snake_case): the legacy `/export/jobs` job-summary rows the
 *    create/list/single-job feeds return (web `ExportJobSummary`, mirroring the Go
 *    `models.ExportJobSummary`).
 *  - ExportJob (camelCase): the hexagonal-architecture export-job projection the
 *    `/exports/{id}` detail feed returns (web `web/src/types/export.ts`).
 *
 * The web `useExports()` hook is typed `request<ExportJob[]>('/export/jobs')` even though
 * `/export/jobs` actually serves ExportJobSummary rows — a loose annotation TypeScript never
 * validates at runtime. To preserve that exact behaviour without bricking the strict KMP
 * decoder, every ExportJob field except `id` is nullable/defaulted, so a real ExportJobSummary
 * payload degrades to mostly-empty fields (the KMP analogue of the web's non-validating cast)
 * instead of surfacing a decode error. `id` is always present on both shapes.
 *
 * No field is unit-bearing (file sizes are raw bytes, counts are integers, durations are whole
 * milliseconds), so there is no SI conversion at this layer — display formatting is the render
 * boundary's job (S5). Keys arrive snake_case (summary) or camelCase (job) and are matched
 * verbatim via SerialName so the cached payload round-trips unchanged.
 */

// ── Job read models ───────────────────────────────────────────────────────────

/**
 * One legacy export-job summary row — the port of the web `ExportJobSummary` (the Go
 * `models.ExportJobSummary`). Returned by `GET /export/jobs`, `GET /export/jobs/{id}`, and the
 * create mutations. [status] is a plain string (`queued`/`processing`/`ready`/`failed`/
 * `expired`) kept lenient so an unrecognised server status never breaks decode.
 */
@Serializable
public data class ExportJobSummary(
    val id: String,
    val type: String = "",
    val format: String = "",
    val status: String = "",
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("file_name") val fileName: String? = null,
    @SerialName("file_size") val fileSize: Long? = null,
    @SerialName("record_count") val recordCount: Long? = null,
    @SerialName("error_message") val errorMessage: String? = null,
    @SerialName("duration_ms") val durationMs: Long? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("completed_at") val completedAt: String? = null,
)

/**
 * One hexagonal-architecture export-job projection — the port of the web `ExportJob`
 * (web/src/types/export.ts). Returned by `GET /exports/{id}`. Every field except [id] is
 * nullable/defaulted so the loosely-typed `useExports()` feed (which points at `/export/jobs`)
 * degrades gracefully on a ExportJobSummary-shaped payload rather than failing to decode — the
 * exact runtime behaviour of the web's non-validating `request<ExportJob[]>` cast.
 */
@Serializable
public data class ExportJob(
    val id: String,
    val format: String? = null,
    @SerialName("vehicleId") val vehicleId: String? = null,
    @SerialName("fsmState") val fsmState: String? = null,
    @SerialName("filePath") val filePath: String? = null,
    @SerialName("fileSize") val fileSize: Long? = null,
    @SerialName("failedReason") val failedReason: String? = null,
    @SerialName("createdAt") val createdAt: String? = null,
    @SerialName("completedAt") val completedAt: String? = null,
)

// ── Generic export submit ─────────────────────────────────────────────────────

/**
 * The `POST /export/jobs` body — the port of the web `CreateExportPayload`. [type] is required;
 * [format]/[vehicleId]/[start]/[end]/[columns] are dropped from the wire when null (mirroring
 * `JSON.stringify` dropping `undefined`). [type] is a plain string (`drives`/`charging`/`trips`/
 * `analytics`/`backup`/`account`) so the body stays byte-identical to the web payload.
 */
@Serializable
public data class CreateExportPayload(
    val type: String,
    val format: String? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val start: String? = null,
    val end: String? = null,
    val columns: List<String>? = null,
)

/**
 * The `POST /export/jobs/account` body — the port of the web `CreateAccountExportPayload`. All
 * fields are optional; with every field null the body serializes to `{}` (the web default
 * argument `payload: CreateAccountExportPayload = {}`).
 */
@Serializable
public data class CreateAccountExportPayload(
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val start: String? = null,
    val end: String? = null,
)

// ── Bulk delete result ────────────────────────────────────────────────────────

/** One failed row in a bulk delete — the port of the web `ExportBulkResult.failed[]`. */
@Serializable
public data class ExportBulkFailure(
    val id: String,
    val reason: String,
)

/** The `POST /export/jobs/bulk` response — the port of the web `ExportBulkResult`. */
@Serializable
public data class ExportBulkResult(
    val deleted: Int = 0,
    val failed: List<ExportBulkFailure> = emptyList(),
)

// ── Column-selector catalog ───────────────────────────────────────────────────

/** One column entry — the port of the web `ExportColumnInfo` (GET /exports/columns). */
@Serializable
public data class ExportColumnInfo(
    val name: String,
    val label: String = "",
    @SerialName("always_included") val alwaysIncluded: Boolean = false,
)

/**
 * The `GET /exports/columns` response — the port of the web `ExportColumnsResponse`. [columns]
 * is empty when the type is recognised but column selection is unsupported (account/backup/
 * analytics); the UI hides the picker when [supportsSelection] is false.
 */
@Serializable
public data class ExportColumnsResponse(
    val type: String = "",
    val columns: List<ExportColumnInfo> = emptyList(),
    @SerialName("supports_selection") val supportsSelection: Boolean = false,
)

// ── Recurring scheduled exports ───────────────────────────────────────────────

/**
 * A delivery dispatcher attached to a schedule — the port of the web
 * `ScheduledExportDelivery`. [target] is required for `email`/`webhook`; for `download` it is
 * ignored (the server also drops it on write). Dropped from the wire when null.
 */
@Serializable
public data class ScheduledExportDelivery(
    val kind: String,
    val target: String? = null,
)

/**
 * One `scheduled_exports` row — the port of the web `ScheduledExport`. Times are ISO-8601 UTC
 * strings. Nullable columns are surfaced as `null` (not omitted). [columns] `null` means
 * "all columns". The fields are plain metadata — not unit-bearing — so they round-trip
 * verbatim with no SI conversion.
 */
@Serializable
public data class ScheduledExport(
    val id: Long,
    @SerialName("owner_subject") val ownerSubject: String = "",
    val name: String = "",
    @SerialName("export_type") val exportType: String = "",
    val format: String = "",
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val columns: List<String>? = null,
    @SerialName("schedule_cron") val scheduleCron: String = "",
    val delivery: ScheduledExportDelivery = ScheduledExportDelivery(kind = "download"),
    @SerialName("range_window") val rangeWindow: String = "",
    val enabled: Boolean = false,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("last_status") val lastStatus: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("next_run_at") val nextRunAt: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/**
 * The create/update body — the port of the web `ScheduledExportInput`. `owner_subject` is
 * intentionally absent: the server takes ownership from FORWARD_AUTH_HEADER and rejects any
 * `owner_subject` in the body (DisallowUnknownFields). [vehicleId]/[columns]/[rangeWindow]/
 * [enabled] are dropped from the wire when null (web `JSON.stringify` parity); [name]/
 * [exportType]/[format]/[scheduleCron]/[delivery] always serialize.
 */
@Serializable
public data class ScheduledExportInput(
    val name: String,
    @SerialName("export_type") val exportType: String,
    val format: String,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    val columns: List<String>? = null,
    @SerialName("schedule_cron") val scheduleCron: String,
    val delivery: ScheduledExportDelivery,
    @SerialName("range_window") val rangeWindow: String? = null,
    val enabled: Boolean? = null,
)
