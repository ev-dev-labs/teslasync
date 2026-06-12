// Pure, framework-free model + projection for the DataPipelineSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/DataPipelineSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component composes TWO `useQuery` feeds — `getCompressionStats` (/system/compression-stats) and
// `getExportJobs` (/export/jobs) — and renders (a) a header badge pair (savings% "saved", active "active"),
// (b) a compression-statistics block (four MetricCards + a savings RadialGauge) shown only when the
// compression query resolved, and (c) an always-present export-job-queue block (four StatCards + a sortable,
// paginated DataTable, or a friendly empty state). This file owns the parts the web computes inline: the raw
// `CompressionStats` parse off the admin JSON feed, the per-status job counts (`queued`/`processing`/`ready`/
// `failed`), the status → icon/tone classification (web `getStatusIcon` / `statusTextClass`), the byte/
// integer/percent formatters (web `formatBytes` / `fmtInt` / `fmtPercent`), the absolute "Created" timestamp
// (web `formatDateTime`), the `record_count` sort, and the surface emptiness predicate.
//
// File-size values are RAW BYTES, counts are integers, `savings_percent` is an already-computed percentage —
// none is a display-unit-bearing SI quantity (meters/mps/°C/Pa/Wh) — so there is no SI conversion at this
// boundary; byte/number/date formatting is ordinary locale-aware display formatting and stays here so the
// projection is locale-stable and testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DataPipelineSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.datapipelinesection

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val DATA_PIPELINE_SECTION_SLUG: String = "DataPipelineSection"

/** The universal "no value" marker, matching the web `formatDateTime` / `—` fallbacks. */
internal const val EM_DASH: String = "\u2014"

/** Stable column key for the sortable "Records" column — matches the web `Column.key` value. */
const val EXPORT_COLUMN_RECORDS: String = "record_count"

private const val PERCENT_DECIMALS = 2
private const val BYTES_DECIMALS = 1
private const val BYTES_PER_STEP = 1024.0
private val BYTE_UNITS = listOf(" B", " KB", " MB", " GB", " TB")

/** Max characters shown for the monospace File cell before ellipsizing (web `truncate max-w-[200px]`). */
private const val FILE_NAME_MAX_LEN = 24
private const val ELLIPSIS = "\u2026"

// Wire status values matched verbatim (lower-cased first) against the web `getStatusIcon` /
// `statusTextClass` chains and the per-status count filters; an unrecognised value falls through to the
// neutral tone (web `default` branch).
private const val STATUS_QUEUED = "queued"
private const val STATUS_PROCESSING = "processing"
private const val STATUS_READY = "ready"
private const val STATUS_FAILED = "failed"

/**
 * The position-compression savings snapshot — the native port of the web `CompressionStats`
 * (web/src/api/types.ts), as served by `GET /system/compression-stats`. Every field defaults to zero so a
 * sparse/partial payload degrades gracefully rather than failing to project. None is unit-bearing (counts +
 * an already-computed percentage + a raw byte count), so the values round-trip with no SI conversion.
 *
 * @property total total rows considered for compression.
 * @property compressed rows that were compressed.
 * @property savingsPercent the headline savings percentage (web `savings_percent`), 0–100.
 * @property totalPositions total position rows (web `total_positions`).
 * @property compressedPositions compressed position rows (web `compressed_positions`).
 * @property estimatedSavedRows estimated rows saved (web `estimated_saved_rows`).
 * @property estimatedSavedBytes estimated bytes saved (web `estimated_saved_bytes`), raw bytes.
 */
data class CompressionStats(
    val total: Long = 0L,
    val compressed: Long = 0L,
    val savingsPercent: Double = 0.0,
    val totalPositions: Long = 0L,
    val compressedPositions: Long = 0L,
    val estimatedSavedRows: Long = 0L,
    val estimatedSavedBytes: Long = 0L,
)

/** Semantic tone for a job status, mapped to a concrete badge/text color at the render boundary. */
enum class ExportStatusTone { Success, Warning, Danger, Neutral }

/** Which authored glyph a job status renders (web `getStatusIcon`): check / alert-triangle / x-circle. */
enum class ExportStatusGlyph { Check, Alert, Cross }

/**
 * One render-ready export-job row — the native projection of a web `ExportJobSummary` row through the six
 * `exportColumns` render functions. [recordCount] is kept raw so the "Records" column sorts numerically (web
 * `sortable`), while [recordsLabel] / [createdLabel] carry the already-formatted display strings; [statusRaw]
 * is the verbatim wire status the web renders next to the icon (it is NOT localized — the web prints
 * `{row.status}`), and [statusTone] / [statusGlyph] drive the colour + icon (web `statusTextClass` /
 * `getStatusIcon`).
 */
data class ExportJobRowView(
    val id: String,
    val statusRaw: String,
    val statusTone: ExportStatusTone,
    val statusGlyph: ExportStatusGlyph,
    val type: String,
    val format: String,
    val fileName: String,
    val recordCount: Long,
    val recordsLabel: String,
    val createdLabel: String,
)

/**
 * The combined payload of the two feeds the surface renders — the native analogue of the web component
 * holding both `compression` and `exportJobs` in scope at once. [compression] is `null` while the compression
 * query has not resolved (web `compression && …` hides its block); [exportJobs] is always a list (empty ⇒ the
 * export block shows its friendly empty state).
 */
data class DataPipelineData(
    val compression: CompressionStats?,
    val exportJobs: List<ExportJobSummary>,
)

/** Per-status job tallies — the native port of the web `pendingJobs`/`processingJobs`/`completedJobs`/`failedJobs` memos. */
data class ExportJobCounts(
    val pending: Int,
    val processing: Int,
    val completed: Int,
    val failed: Int,
) {
    /** Jobs still in flight (web `pendingJobs + processingJobs`), surfaced as the header "active" badge. */
    val active: Int get() = pending + processing
}

/**
 * Pure projection from the two feed payloads to the surface's render inputs — a 1:1 port of the derivations
 * the web component performs inline. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings + design tokens and draws what these return.
 */
object DataPipelineProjection {
    /**
     * Parses the admin compression JSON feed into a [CompressionStats] — the native analogue of the web
     * `getCompressionStats` typed read. A `null`/JSON-null or non-object element yields `null` (the web
     * "query not resolved ⇒ block hidden" state); any object yields a stats value with missing fields
     * defaulted to zero (the web renders the block even when fields are 0).
     */
    fun parseCompression(element: JsonElement?): CompressionStats? {
        val obj = element as? JsonObject ?: return null
        return CompressionStats(
            total = obj.long("total"),
            compressed = obj.long("compressed"),
            savingsPercent = obj.double("savings_percent"),
            totalPositions = obj.long("total_positions"),
            compressedPositions = obj.long("compressed_positions"),
            estimatedSavedRows = obj.long("estimated_saved_rows"),
            estimatedSavedBytes = obj.long("estimated_saved_bytes"),
        )
    }

    /** Per-status tallies over [jobs] — web `pendingJobs`/`processingJobs`/`completedJobs`/`failedJobs`. */
    fun counts(jobs: List<ExportJobSummary>): ExportJobCounts =
        ExportJobCounts(
            pending = jobs.count { it.status.equals(STATUS_QUEUED, ignoreCase = true) },
            processing = jobs.count { it.status.equals(STATUS_PROCESSING, ignoreCase = true) },
            completed = jobs.count { it.status.equals(STATUS_READY, ignoreCase = true) },
            failed = jobs.count { it.status.equals(STATUS_FAILED, ignoreCase = true) },
        )

    /** The whole-surface emptiness predicate: no compression payload AND no export jobs (web "nothing to show"). */
    fun isEmpty(data: DataPipelineData): Boolean = data.compression == null && data.exportJobs.isEmpty()

    /**
     * Sorts [jobs] for the [sort] state when the active column is the numeric "Records" column (web
     * `sortable`), preserving the incoming order otherwise. Ascending/descending follow [SortState.direction];
     * a null/blank `record_count` sorts as zero so a partial row never throws.
     */
    fun sortJobs(
        jobs: List<ExportJobSummary>,
        sort: SortState,
    ): List<ExportJobSummary> {
        if (sort.key != EXPORT_COLUMN_RECORDS) return jobs
        val byCount = jobs.sortedBy { it.recordCount ?: 0L }
        return if (sort.direction == SortDirection.Asc) byCount else byCount.reversed()
    }

    /**
     * Projects [jobs] into render-ready [ExportJobRowView]s using [locale] for number formatting and
     * [dateTimeFormatter] for the absolute "Created" timestamp (web `formatDateTime`). The file name is the
     * raw `file_name` (em dash when blank); the records label is the locale-grouped integer (web `fmtInt`).
     */
    fun rows(
        jobs: List<ExportJobSummary>,
        locale: Locale,
        dateTimeFormatter: DateTimeFormatter,
    ): List<ExportJobRowView> =
        jobs.map { job ->
            ExportJobRowView(
                id = job.id,
                statusRaw = job.status,
                statusTone = statusTone(job.status),
                statusGlyph = statusGlyph(job.status),
                type = job.type,
                format = job.format,
                fileName = truncateFileName(job.fileName),
                recordCount = job.recordCount ?: 0L,
                recordsLabel = fmtInt(job.recordCount ?: 0L, locale),
                createdLabel = formatDateTime(job.createdAt, dateTimeFormatter),
            )
        }

    /**
     * Status → semantic tone — the native port of the web `statusTextClass`: success (ready/ok/online/
     * connected/sent/completed/healthy), warning (queued/processing/pending/warning/degraded), danger
     * (failed/error/offline/down/unhealthy), neutral otherwise.
     */
    fun statusTone(status: String): ExportStatusTone =
        when (status.trim().lowercase(Locale.ROOT)) {
            "healthy", "ok", "online", "connected", STATUS_READY, "sent", "completed" -> ExportStatusTone.Success
            "degraded", "warning", "pending", STATUS_QUEUED, STATUS_PROCESSING -> ExportStatusTone.Warning
            "unhealthy", "offline", "error", "down", STATUS_FAILED -> ExportStatusTone.Danger
            else -> ExportStatusTone.Neutral
        }

    /**
     * Status → glyph — the native port of the web `getStatusIcon`: a check for the healthy family, an
     * x-circle for the failure family, and the alert triangle for everything else (incl. the default branch).
     */
    fun statusGlyph(status: String): ExportStatusGlyph =
        when (status.trim().lowercase(Locale.ROOT)) {
            "healthy", "ok", "online", "connected", STATUS_READY, "sent", "completed" -> ExportStatusGlyph.Check
            "unhealthy", "offline", "error", "down", STATUS_FAILED -> ExportStatusGlyph.Cross
            else -> ExportStatusGlyph.Alert
        }

    /**
     * Locale-grouped integer — the native mirror of the web `fmtInt` (`fmtNumber(v, 0)`): rounded to a whole
     * number with locale thousands separators (e.g. `12345` → "12,345").
     */
    fun fmtInt(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", value)

    /**
     * Locale-grouped percentage — the native mirror of the web `fmtPercent` (`fmtNumber(v, 2) + '%'`): two
     * fraction digits + a trailing `%` (e.g. `85.432` → "85.43%"). A non-finite value renders as `0`.
     */
    fun fmtPercent(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.${PERCENT_DECIMALS}f%%", safe)
    }

    /**
     * Binary byte size — the faithful port of the web status `formatBytes`: `0`/non-positive → "0 B"; else
     * pick the 1024-based unit step (B/KB/MB/GB/TB) and format the scaled value with one fraction digit +
     * locale grouping (web `fmtNumber(bytes / 1024^i, 1)`).
     */
    fun formatBytes(
        bytes: Long,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (bytes <= 0L) return "0 B"
        var i = 0
        var value = bytes.toDouble() // parity:allow toDouble() conversion — the "toDo" substring is a false positive, not a stub
        while (value >= BYTES_PER_STEP && i < BYTE_UNITS.size - 1) {
            value /= BYTES_PER_STEP
            i++
        }
        return String.format(locale, "%,.${BYTES_DECIMALS}f", value) + BYTE_UNITS[i]
    }

    /**
     * Absolute date-time for the "Created" column — the native analogue of the web `formatDateTime`: a
     * blank/unparseable timestamp renders as the em dash, otherwise the ISO instant is formatted by the
     * (zone-bearing) [formatter]. Tolerant of both offset (`…+00:00`) and zulu (`…Z`) instants.
     */
    fun formatDateTime(
        iso: String?,
        formatter: DateTimeFormatter,
    ): String {
        val instant = parseInstant(iso) ?: return EM_DASH
        return runCatching { formatter.format(instant) }.getOrDefault(EM_DASH)
    }

    private fun parseInstant(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(raw).toInstant() }
            .recoverCatching { Instant.parse(raw) }
            .getOrNull()
    }

    /**
     * Renders the File cell value (web `font-mono truncate`): a blank/absent name → em dash; a name longer
     * than [FILE_NAME_MAX_LEN] is end-ellipsized so the monospace cell stays compact in a narrow column.
     */
    internal fun truncateFileName(name: String?): String {
        val trimmed = name?.takeIf { it.isNotBlank() } ?: return EM_DASH
        return if (trimmed.length <= FILE_NAME_MAX_LEN) trimmed else trimmed.take(FILE_NAME_MAX_LEN - 1) + ELLIPSIS
    }

    private fun JsonObject.long(key: String): Long = (this[key] as? JsonPrimitive)?.longOrNull ?: 0L

    private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0
}
