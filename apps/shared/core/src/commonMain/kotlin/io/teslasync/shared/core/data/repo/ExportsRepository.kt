package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.exports.CreateAccountExportPayload
import io.teslasync.shared.core.presentation.exports.CreateExportPayload
import io.teslasync.shared.core.presentation.exports.ExportBulkResult
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJob
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Exports control plane — the cross-platform analogue of the web
 * `useExports` hook domain (web/src/api/hooks/useExports.ts). Every native Exports surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The six reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Each is cached under a stable per-feed key
 * (see [exportsAllKey] etc.) mirroring the web TanStack query keys. The seven mutations are
 * non-throwing suspend [Result]s; they call the API directly and DO NOT touch the durable cache
 * — the cache-then-network operator always re-fetches on the S8 store's targeted refresh (the
 * `invalidateQueries` analogue), so the previous rows stay visible during the reload while no
 * stale value is ever served as fresh. Values are SI/raw on the wire; conversion is the render
 * boundary's job (S5).
 */
public interface ExportsRepository {
    /** `GET /export/jobs` typed as the loose `ExportJob[]` (web `useExports`, `safeArray`-guarded). */
    public fun exports(): Flow<Resource<List<ExportJob>>>

    /** `GET /export/jobs` as job summaries (web `useExportJobs`, `safeArray`-guarded). */
    public fun exportJobs(): Flow<Resource<List<ExportJobSummary>>>

    /** `GET /export/jobs/{id}` — one job summary (web `useExportJob`). */
    public fun exportJob(id: String): Flow<Resource<ExportJobSummary>>

    /** `GET /exports/{id}` — one hexagonal export-job projection (web `useExport`). */
    public fun export(id: String): Flow<Resource<ExportJob>>

    /** `GET /exports/columns?type=` — the column-picker catalog (web `useExportColumns`). */
    public fun exportColumns(type: String): Flow<Resource<ExportColumnsResponse>>

    /** `GET /scheduled-exports` — the recurring schedules (web `useScheduledExports`, `safeArray`). */
    public fun scheduledExports(): Flow<Resource<List<ScheduledExport>>>

    /** `POST /export/jobs` with the create payload (web `useCreateExport`). */
    public suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary>

    /** `POST /export/jobs/account` with the account payload (web `useCreateAccountExport`). */
    public suspend fun createAccountExport(payload: CreateAccountExportPayload = CreateAccountExportPayload()): Result<ExportJobSummary>

    /** `POST /export/jobs/bulk` with `{ ids, op: "delete" }` (web `useBulkExportsDelete`). */
    public suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult>

    /** `POST /scheduled-exports` with the input body (web `useCreateScheduledExport`). */
    public suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport>

    /** `PUT /scheduled-exports/{id}` with the input body (web `useUpdateScheduledExport`). */
    public suspend fun updateScheduledExport(
        id: Long,
        input: ScheduledExportInput,
    ): Result<ScheduledExport>

    /** `DELETE /scheduled-exports/{id}` (web `useDeleteScheduledExport`). */
    public suspend fun deleteScheduledExport(id: Long): Result<Unit>

    /** `POST /scheduled-exports/{id}/run` — manual "Run now" (web `useRunScheduledExportNow`). */
    public suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport>
}

/**
 * The `/exports/columns` query map — the port of the web
 * ``/exports/columns?type=${encodeURIComponent(type ?? '')}``. The web hook is `enabled: !!type`,
 * so it only fires with a non-empty type; the `type` param is therefore always sent. Ktor applies
 * the same percent-encoding `encodeURIComponent` does. Locked by golden vectors shared with the
 * C# port.
 */
public fun exportColumnsQuery(type: String): Map<String, String> = mapOf("type" to type)

/**
 * The browser-facing download URL for a finished export job — the port of the web
 * `exportDownloadUrl(jobId)`. Unlike the [ExportsRepository] read/mutation paths (which are
 * versioned by the client and so omit the prefix), this is a raw browser link and therefore
 * carries the explicit `/api/v1` prefix verbatim, exactly as the web helper does. Locked by a
 * golden vector shared with the C# port.
 */
public fun exportDownloadUrl(jobId: String): String = "/api/v1/export/jobs/$jobId/download"

/** Cache/feed key for the legacy exports list — the web `exportKeys.all` (`['exports']`). */
public fun exportsAllKey(): String = EXPORTS_PREFIX

/** Cache/feed key for one hexagonal export — the web `exportKeys.detail(id)` (`['exports', id]`). */
public fun exportDetailKey(id: String): String = "$EXPORTS_PREFIX:$id"

/** Cache/feed key for the job-summary list — the web `exportKeys.jobs` (`['export-jobs']`). */
public fun exportJobsKey(): String = EXPORT_JOBS_PREFIX

/** Cache/feed key for one job summary — the web `exportKeys.job(id)` (`['export-jobs', id]`). */
public fun exportJobKey(id: String): String = "$EXPORT_JOBS_PREFIX:$id"

/**
 * Cache/feed key for the column catalog — the web `exportKeys.columns(type ?? '__none__')`
 * (`['export-columns', type]`). A null type collapses to the `__none__` sentinel exactly as the
 * web query key does.
 */
public fun exportColumnsKey(type: String?): String = "$EXPORT_COLUMNS_PREFIX:${type ?: COLUMNS_NONE}"

/** Cache/feed key for the schedules list — the web `exportKeys.scheduled` (`['scheduled-exports']`). */
public fun scheduledExportsKey(): String = SCHEDULED_PREFIX

/** The web `exportKeys.all` first segment — `['exports']`. */
public const val EXPORTS_PREFIX: String = "exports"

/** The web `exportKeys.jobs` first segment — `['export-jobs']`. */
public const val EXPORT_JOBS_PREFIX: String = "export-jobs"

/** The web `exportKeys.columns` first segment — `['export-columns']`. */
public const val EXPORT_COLUMNS_PREFIX: String = "export-columns"

/** The web `exportKeys.scheduled` first segment — `['scheduled-exports']`. */
public const val SCHEDULED_PREFIX: String = "scheduled-exports"

/** The web `exportKeys.columns(type ?? '__none__')` sentinel for a null/absent type. */
public const val COLUMNS_NONE: String = "__none__"
