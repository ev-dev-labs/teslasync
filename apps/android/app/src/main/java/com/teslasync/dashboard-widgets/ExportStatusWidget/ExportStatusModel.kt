// Pure, framework-free model + projection for the Export Status dashboard widget — the native
// analogue of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/ExportStatusWidget.tsx). No Compose, no Android, no HTTP:
// every type here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// File-size values are RAW BYTES, counts are integers, timestamps are ISO-8601 strings — none is a
// display-unit-bearing SI quantity (meters/mps/°C/Pa/Wh), so there is no SI conversion at this
// boundary; byte/relative-time formatting is ordinary display formatting (the web `fmtBytes` /
// `TimeStamp` analogue) and stays here so the projection is locale-stable and testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/ExportStatusWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.exportstatus

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.exports.ExportJob
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val ELLIPSIS = "\u2026"
private const val COMMA_SPACE = ", "
private const val SLASH = '/'

// Wire status values matched verbatim (case-insensitive, lower-cased first) against the web
// `normaliseStatusFromExport` / `normaliseStatusFromAdmin` chains; an unrecognised value falls
// through to `queued` exactly as the web's trailing `return 'queued'` does.
private const val STATUS_PROCESSING = "processing"
private const val STATUS_RUNNING = "running"
private const val STATUS_READY = "ready"
private const val STATUS_DONE = "done"
private const val STATUS_COMPLETED = "completed"
private const val STATUS_FAILED = "failed"
private const val STATUS_ERROR = "error"

// Byte-size unit symbols, matched to the web `fmtBytes`. These are international unit symbols (not
// translatable English prose), kept as constants alongside the em dash / ellipsis format glyphs.
private const val UNIT_BYTES = " B"
private const val UNIT_KB = " KB"
private const val UNIT_MB = " MB"
private const val UNIT_GB = " GB"
private const val BYTES_PER_KB = 1024.0
private const val ONE_DECIMAL = "%.1f"

private const val FILENAME_MAX_LEN = 28

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` branches in the web source: a single column renders the compact
 * active-jobs hero, three-or-more columns add the per-row download affordance, and the standard
 * list caps at [STANDARD_MAX_ITEMS] (web `maxItems`).
 */
data class ExportStatusSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact active-jobs hero. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three-or-more columns (web `size.cols >= 3`): render the per-row download link. */
    val isWide: Boolean get() = cols >= 3

    /** The list cap for this footprint (web `maxItems={isCompact ? 5 : 15}`). */
    val maxItems: Int get() = if (isCompact) COMPACT_MAX_ITEMS else STANDARD_MAX_ITEMS

    companion object {
        /** Rows shown in the (unused-for-list) compact footprint, kept for web parity. */
        const val COMPACT_MAX_ITEMS = 5

        /** Rows shown in the standard list footprint (web `maxItems` for the wide path). */
        const val STANDARD_MAX_ITEMS = 15
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`export-status`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object ExportStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "export-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "ExportStatusWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = ExportStatusSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = ExportStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = ExportStatusSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: ExportStatusSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ExportStatusSize): ExportStatusSize =
        ExportStatusSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Normalised job status — the native port of the web `JobStatus` union
 * (`queued`/`processing`/`ready`/`failed`). [order] reproduces the web `STATUS_ORDER` sort weights
 * (processing first, then queued, ready, failed).
 */
enum class JobStatus(
    val order: Int,
) {
    Processing(0),
    Queued(1),
    Ready(2),
    Failed(3),
}

/** Semantic tone for a status badge; mapped to a concrete `BadgeVariant` at the render boundary. */
enum class ExportBadgeTone { Neutral, Info, Success, Danger }

/**
 * Status → badge tone, the native port of the web `STATUS_BADGE` map: queued → neutral,
 * processing → info, ready → success, failed → danger. The label is resolved at render from the
 * localized [ExportStatusStrings] (the projection only carries the [ExportBadgeTone] + [JobStatus]).
 */
fun JobStatus.badgeTone(): ExportBadgeTone =
    when (this) {
        JobStatus.Queued -> ExportBadgeTone.Neutral
        JobStatus.Processing -> ExportBadgeTone.Info
        JobStatus.Ready -> ExportBadgeTone.Success
        JobStatus.Failed -> ExportBadgeTone.Danger
    }

/**
 * Map a Fleet-export FSM state to a [JobStatus] — the native port of the web
 * `normaliseStatusFromExport`. Case-insensitive: `processing`/`running` → processing,
 * `ready`/`done`/`completed` → ready, `failed`/`error` → failed, everything else (incl. null) → queued.
 */
fun normaliseStatusFromExport(fsmState: String?): JobStatus = normaliseStatus(fsmState)

/**
 * Map an admin export-job status to a [JobStatus] — the native port of the web
 * `normaliseStatusFromAdmin`. The web uses the identical chain as the export path, so both share one
 * implementation here.
 */
fun normaliseStatusFromAdmin(status: String?): JobStatus = normaliseStatus(status)

private fun normaliseStatus(raw: String?): JobStatus =
    when (raw?.lowercase(Locale.ROOT)) {
        STATUS_PROCESSING, STATUS_RUNNING -> JobStatus.Processing
        STATUS_READY, STATUS_DONE, STATUS_COMPLETED -> JobStatus.Ready
        STATUS_FAILED, STATUS_ERROR -> JobStatus.Failed
        else -> JobStatus.Queued
    }

/**
 * One normalised export job — the native port of the web `NormalisedJob` plus its resolved
 * [status]. Built from either the `useExports` feed ([fromExport]) or the admin `useExportJobs` feed
 * ([fromAdmin]); [filePath] is only present on the export-feed shape (the admin shape sets it null,
 * exactly as the web `fromAdminHook` returns `filePath: undefined`).
 */
data class ExportStatusJob(
    val id: String,
    val format: String,
    val filePath: String?,
    val fileSizeBytes: Long,
    val createdAt: String?,
    val status: JobStatus,
) {
    companion object {
        /** Project a shared-core [ExportJob] (the `useExports` shape) + its FSM-derived status. */
        fun fromExport(job: ExportJob): ExportStatusJob =
            ExportStatusJob(
                id = job.id,
                format = job.format.orEmpty(),
                filePath = job.filePath,
                fileSizeBytes = job.fileSize ?: 0L,
                createdAt = job.createdAt,
                status = normaliseStatusFromExport(job.fsmState),
            )

        /**
         * Parse one admin export-job JSON object (`/export/jobs`, raw snake_case) into a job. The
         * admin feed has no file path (web `fromAdminHook` filePath = undefined), and the status is
         * the admin `status` column.
         */
        fun fromAdmin(obj: JsonObject): ExportStatusJob =
            ExportStatusJob(
                id = obj.stringValue("id").orEmpty(),
                format = obj.stringValue("format").orEmpty(),
                filePath = null,
                fileSizeBytes = obj.longValue("file_size") ?: 0L,
                createdAt = obj.stringValue("created_at"),
                status = normaliseStatusFromAdmin(obj.stringValue("status")),
            )

        /** Parse the admin `/export/jobs` JSON array into a tolerant list (web `?? []`). */
        fun parseAdminList(element: JsonElement?): List<ExportStatusJob> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.let(::fromAdmin)?.takeIf { it.id.isNotEmpty() } }
                ?: emptyList()

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
    }
}

/**
 * One projected, render-ready job row consumed by the standard list. Pure data (no Compose types):
 * the truncated [fileName], the upper-cased [formatLabel], the byte-formatted [sizeLabel], the
 * resolved [statusLabel]/[statusTone], the relative [time] label, whether a processing progress bar
 * follows ([showProgress]), whether a download affordance is offered ([downloadable]), and a folded
 * TalkBack [contentDescription].
 */
data class ExportJobRow(
    val id: String,
    val fileName: String,
    val formatLabel: String,
    val sizeLabel: String,
    val statusLabel: String,
    val statusTone: ExportBadgeTone,
    val time: String,
    val showProgress: Boolean,
    val downloadable: Boolean,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the export jobs for one footprint — the native analogue
 * of everything the web component computes before returning JSX (the `sortedJobs` memo, the
 * `activeCount`/`hasRunning` memos, the compact `CompactView`, and the `StandardView` rows). Pure
 * data so the projection is unit-tested without a UI host.
 */
data class ExportStatusDisplay(
    val isCompact: Boolean,
    val hasJobs: Boolean,
    val activeCount: Int,
    val activeJobsLabel: String,
    val hasRunning: Boolean,
    val compactBadgeLabel: String,
    val compactBadgeTone: ExportBadgeTone,
    val compactContentDescription: String,
    val rows: List<ExportJobRow>,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [ExportStatusProjection] reads the status labels, [downloadLabel], [activeJobsLabel],
 * [runningBadge]/[idleBadge], [emptyMessage], and [formatRelative]; the composable chrome
 * additionally reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel]. Keeping i18n out
 * of the projection lets it stay a pure, locale-stable function.
 */
data class ExportStatusStrings(
    val title: String,
    val activeJobsLabel: String,
    val runningBadge: String,
    val idleBadge: String,
    val emptyMessage: String,
    val queuedLabel: String,
    val runningLabel: String,
    val doneLabel: String,
    val failedLabel: String,
    val downloadLabel: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
) {
    /** Resolve the localized badge label for a [status] (web `STATUS_BADGE[status].label`). */
    fun statusLabel(status: JobStatus): String =
        when (status) {
            JobStatus.Queued -> queuedLabel
            JobStatus.Processing -> runningLabel
            JobStatus.Ready -> doneLabel
            JobStatus.Failed -> failedLabel
        }
}

/**
 * Pure projection from the two normalised job feeds to the [ExportStatusDisplay] — the native port
 * of the web component's `sortedJobs` merge (dedupe-by-id, admin wins, status-then-recency sort),
 * the `activeCount`/`hasRunning` memos, the compact `CompactView`, and the `StandardView` rows
 * (filename truncation, format upper-casing, byte formatting, processing progress bar, wide-only
 * download). [nowMillis] is injected so the relative-time tiers are unit-tested deterministically.
 */
object ExportStatusProjection {
    /**
     * Merge the export-feed and admin-feed jobs the way the web does: index by id with the export
     * rows first, then overwrite with the admin rows (admin carries the fresher status), and sort by
     * status order then newest-first by created-at. Returns a stable, de-duplicated list.
     */
    fun merge(
        exportJobs: List<ExportStatusJob>,
        adminJobs: List<ExportStatusJob>,
    ): List<ExportStatusJob> {
        val byId = LinkedHashMap<String, ExportStatusJob>()
        for (job in exportJobs) byId[job.id] = job
        for (job in adminJobs) byId[job.id] = job
        return byId.values.sortedWith(
            compareBy<ExportStatusJob> { it.status.order }
                .thenByDescending { sortKey(it.createdAt) },
        )
    }

    /** Project the merged [jobs] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        jobs: List<ExportStatusJob>,
        size: ExportStatusSize,
        strings: ExportStatusStrings,
        nowMillis: Long,
    ): ExportStatusDisplay {
        val activeCount = jobs.count { it.status == JobStatus.Processing || it.status == JobStatus.Queued }
        val hasRunning = jobs.any { it.status == JobStatus.Processing }
        val rows =
            jobs
                .take(size.maxItems)
                .map { job -> job.toRow(size, strings, nowMillis) }
        val badgeLabel = if (hasRunning) strings.runningBadge else strings.idleBadge
        return ExportStatusDisplay(
            isCompact = size.isCompact,
            hasJobs = jobs.isNotEmpty(),
            activeCount = activeCount,
            activeJobsLabel = strings.activeJobsLabel,
            hasRunning = hasRunning,
            compactBadgeLabel = badgeLabel,
            compactBadgeTone = if (hasRunning) ExportBadgeTone.Success else ExportBadgeTone.Neutral,
            compactContentDescription = "${strings.activeJobsLabel}$COMMA_SPACE$activeCount$COMMA_SPACE$badgeLabel",
            rows = rows,
        )
    }

    /**
     * Format a byte count the way the web `fmtBytes` does: ≤0 → em dash, <1 KiB → `N B`, <1 MiB →
     * `N.N KB`, <1 GiB → `N.N MB`, else `N.N GB`. Uses 1024-based steps and one fraction digit.
     */
    fun formatBytes(
        bytes: Long,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (bytes <= 0L) return EM_DASH
        return when {
            bytes < BYTES_PER_KB -> "$bytes$UNIT_BYTES"
            bytes < BYTES_PER_KB * BYTES_PER_KB -> oneDecimal(bytes / BYTES_PER_KB, locale) + UNIT_KB
            bytes < BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB ->
                oneDecimal(bytes / (BYTES_PER_KB * BYTES_PER_KB), locale) + UNIT_MB
            else -> oneDecimal(bytes / (BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB), locale) + UNIT_GB
        }
    }

    /**
     * Truncate a file path to its base name capped at [maxLen] the way the web `truncateFilename`
     * does: null/blank → em dash, take the segment after the last slash, and ellipsize when longer
     * than [maxLen].
     */
    fun truncateFilename(
        path: String?,
        maxLen: Int = FILENAME_MAX_LEN,
    ): String {
        if (path.isNullOrEmpty()) return EM_DASH
        val name = path.substringAfterLast(SLASH)
        return if (name.length <= maxLen) name else name.take(maxLen - 1) + ELLIPSIS
    }

    /**
     * Bucket a row's created-at timestamp into a [FreshnessAge] (web `<TimeStamp>` relative time):
     * an unparseable/absent timestamp yields [FreshnessAge.Unknown] (rendered as the em dash).
     */
    fun relativeTimeBucket(
        createdAt: String?,
        nowMillis: Long,
    ): FreshnessAge {
        val epoch = parseEpochMillis(createdAt) ?: return FreshnessAge.Unknown
        return relativeAge(computeAgeSeconds(epoch, nowMillis))
    }

    private fun ExportStatusJob.toRow(
        size: ExportStatusSize,
        strings: ExportStatusStrings,
        nowMillis: Long,
    ): ExportJobRow {
        val fileName = truncateFilename(filePath)
        val formatLabel = format.uppercase(Locale.ROOT).ifEmpty { EM_DASH }
        val sizeLabel = formatBytes(fileSizeBytes)
        val statusLabel = strings.statusLabel(status)
        val time = strings.formatRelative(relativeTimeBucket(createdAt, nowMillis))
        val downloadable = size.isWide && !filePath.isNullOrEmpty() && status == JobStatus.Ready
        return ExportJobRow(
            id = id,
            fileName = fileName,
            formatLabel = formatLabel,
            sizeLabel = sizeLabel,
            statusLabel = statusLabel,
            statusTone = status.badgeTone(),
            time = time,
            showProgress = status == JobStatus.Processing,
            downloadable = downloadable,
            contentDescription =
                listOf(fileName, formatLabel, sizeLabel, statusLabel, time)
                    .filter { it.isNotBlank() && it != EM_DASH }
                    .joinToString(COMMA_SPACE),
        )
    }

    // Web `new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)`: null/unparseable created-at
    // sorts as the epoch (oldest), so present rows surface above timestamp-less ones.
    private fun sortKey(createdAt: String?): Long = parseEpochMillis(createdAt) ?: 0L
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and
 * parses on demand). Returns `null` for a blank/absent or unparseable value so a partial row never
 * throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

private fun oneDecimal(
    value: Double,
    locale: Locale,
): String = String.format(locale, ONE_DECIMAL, value)
