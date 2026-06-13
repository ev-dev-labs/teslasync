// Pure, framework-free model + projection for the JobProgressDrawer modal/overlay surface — the
// native analogue of everything the web component derives before returning JSX
// (web/src/components/feedback/JobProgressDrawer.tsx). No Compose, no Android, no HTTP: every type
// here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is a floating, minimizable widget that surfaces in-flight + recently-finished
// export jobs (web `useExportJobs`). This file owns the parity-critical, render-free derivations:
// the queued/processing/ready/failed/expired status taxonomy (web `statusIcon` / `prettyStatus`),
// the active vs recent split (web `isActive` / `bucketFor` + the `maxRecent` slice), the three-state
// open/minimized/dismissed drawer machine with the dismissed -> minimized auto-promotion and the
// auto-hide visibility rule (web `useEffect` + the two early `return null` guards), the byte-size
// label (web `formatBytes({ zeroAsEmpty, gbDecimals: 2 })`), the relative-age bucketing (web
// `formatRelative`), the per-job download URL (web `exportDownloadUrl`), and the PII-safe
// `view.opened` diagnostic (P1/S11).
//
// File-size values are RAW BYTES and timestamps are ISO-8601 strings — neither is a display-unit
// SI quantity (m/mps/°C/Pa/Wh) — so there is no SI conversion here; byte/relative-time formatting is
// ordinary, locale-stable display formatting kept pure so the projection is unit-tested off device.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated
// surface directory (com/teslasync/modals-dialogs/JobProgressDrawer — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package and the file hosts several co-located declarations,
// exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.modalsdialogs.jobprogressdrawer

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.data.repo.exportDownloadUrl
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

/** The universal "no value" glyph the web renders as `—`. */
const val EXPORT_EM_DASH: String = "\u2014"

private const val UNIT_BYTES = " B"
private const val UNIT_KB = " KB"
private const val UNIT_MB = " MB"
private const val UNIT_GB = " GB"
private const val BYTES_PER_KB = 1024.0
private const val ONE_DECIMAL = "%.1f"
private const val TWO_DECIMAL = "%.2f"

// Wire status values matched verbatim against the web union
// (`queued | processing | ready | failed | expired`).
private const val STATUS_QUEUED = "queued"
private const val STATUS_PROCESSING = "processing"
private const val STATUS_READY = "ready"
private const val STATUS_FAILED = "failed"
private const val STATUS_EXPIRED = "expired"

/** The web `maxRecent` default — the cap on recently-finished rows shown beside active jobs. */
const val DEFAULT_MAX_RECENT: Int = 5

/**
 * Diagnostics + registry identifiers for the surface (P1/S11). The web component has no dashboard
 * registry entry (it is a global overlay, not a grid widget), so [ID] is the stable diagnostics slug
 * rather than a grid id.
 */
object JobProgressDrawerRegistration {
    /** Stable surface id. */
    const val ID: String = "job-progress-drawer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "JobProgressDrawer"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [JobProgressDrawerRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls
 * it from the first-composition effect. It carries no job id, file name, or error text, so a
 * diagnostics line can never leak what a user is exporting.
 */
fun recordJobProgressDrawerViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to JobProgressDrawerRegistration.SLUG))
}

/**
 * The persisted drawer surface state — the native mirror of the web `DrawerState`
 * (`open | minimized | dismissed`). The web default (and the analogue of an absent persisted value)
 * is [Minimized].
 */
enum class DrawerPresentation {
    Open,
    Minimized,
    Dismissed,

    ;

    companion object {
        /** The web `readPersistedState` fallback when nothing is stored. */
        val Default: DrawerPresentation = Minimized
    }
}

/** Which list a job belongs to — the web `JobBucket` (`active | recent`). */
enum class JobBucket { Active, Recent }

/** The visible drawer surface once it is shown — a minimized chip or the open panel. */
enum class DrawerMode { Minimized, Open }

/**
 * A normalised export-job status — the native port of the web status union. [wire] is the verbatim
 * backend value; an unrecognised value parses to `null` and is rendered leniently (web `prettyStatus`
 * returns the raw string and `statusIcon` falls through to the clock icon).
 */
enum class JobStatus(
    val wire: String,
) {
    Queued(STATUS_QUEUED),
    Processing(STATUS_PROCESSING),
    Ready(STATUS_READY),
    Failed(STATUS_FAILED),
    Expired(STATUS_EXPIRED),

    ;

    companion object {
        /** Resolve a wire status, or `null` for an unrecognised value (web's lenient default). */
        fun parse(raw: String): JobStatus? {
            val lowered = raw.lowercase(Locale.ROOT)
            return entries.firstOrNull { it.wire == lowered }
        }
    }
}

/** Semantic tone for a status indicator; mapped to a concrete color/icon at the render boundary. */
enum class JobStatusTone { Muted, Info, Success, Danger, Warning }

/**
 * Status -> indicator tone — the native port of the web `statusIcon` colours: queued/unknown muted,
 * processing cyan (info), ready emerald (success), failed rose (danger), expired amber (warning).
 */
fun statusTone(status: JobStatus?): JobStatusTone =
    when (status) {
        JobStatus.Processing -> JobStatusTone.Info
        JobStatus.Ready -> JobStatusTone.Success
        JobStatus.Failed -> JobStatusTone.Danger
        JobStatus.Expired -> JobStatusTone.Warning
        JobStatus.Queued, null -> JobStatusTone.Muted
    }

/** Whether a wire status counts as active (in-flight) — the web `isActive` (`queued || processing`). */
fun isActiveStatus(rawStatus: String): Boolean {
    val lowered = rawStatus.lowercase(Locale.ROOT)
    return lowered == STATUS_QUEUED || lowered == STATUS_PROCESSING
}

/**
 * One projected, render-ready job row — the native analogue of everything the web `JobRow` derives
 * before render. Pure data (no Compose types): the wire/parsed [status] + [tone], the raw [type] and
 * [format] (resolved to localized labels at the render boundary), the [bucket] that selects the
 * active vs completed meta line, the [createdAtAge]/[finishedAtAge] relative buckets, the byte
 * [sizeLabel], the optional [errorMessage], the [downloadUrl] for a ready job, and the
 * [showFailedAffordance] flag for the failed-row maximize glyph.
 */
data class JobRow(
    val id: String,
    val statusWire: String,
    val status: JobStatus?,
    val tone: JobStatusTone,
    val type: String,
    val format: String,
    val bucket: JobBucket,
    val createdAtAge: FreshnessAge,
    val finishedAtAge: FreshnessAge,
    val sizeLabel: String,
    val errorMessage: String?,
    val downloadUrl: String?,
    val showFailedAffordance: Boolean,
) {
    /** True for a ready job that offers a download affordance (web `job.status === 'ready'`). */
    val downloadable: Boolean get() = downloadUrl != null
}

/**
 * The fully projected, render-ready view of the export jobs — the native analogue of everything the
 * web component computes before returning JSX (the `activeJobs`/`recentJobs` memos, the visibility
 * guards, the minimized-vs-open branch, and the loading body). Pure data so the projection is
 * unit-tested without a UI host.
 *
 * @property visible whether the overlay renders at all (web returns `null` when hidden).
 * @property mode the visible surface when [visible] — a minimized chip or the open panel.
 * @property isLoadingBody whether the open body shows the loading line (web `isLoading && empty`).
 * @property activeCount the number of in-flight jobs (drives the chip + the header pill).
 * @property activeRows the in-flight rows (web `activeJobs`).
 * @property recentRows the recently-finished rows, capped at the recent limit (web `recentJobs`).
 */
data class JobProgressProjection(
    val visible: Boolean,
    val mode: DrawerMode,
    val isLoadingBody: Boolean,
    val activeCount: Int,
    val activeRows: List<JobRow>,
    val recentRows: List<JobRow>,
) {
    /** True when the minimized chip should show the active spinner + count (web `activeCount > 0`). */
    val minimizedShowsActive: Boolean get() = activeCount > 0
}

/**
 * Applies the web `useEffect` auto-promotion: a [DrawerPresentation.Dismissed] drawer is promoted to
 * [DrawerPresentation.Minimized] the moment an active job exists, so the user notices new work. Every
 * other state passes through unchanged.
 */
fun effectivePresentation(
    presentation: DrawerPresentation,
    activeCount: Int,
): DrawerPresentation =
    if (presentation == DrawerPresentation.Dismissed && activeCount > 0) {
        DrawerPresentation.Minimized
    } else {
        presentation
    }

/**
 * Whether the overlay renders at all — the native port of the web's two early `return null` guards:
 * a dismissed drawer with no active work stays hidden, and an empty feed that is not loading stays
 * hidden. A hard error (no cached rows) keeps the surface visible so the open body can show the retry
 * affordance rather than silently vanishing — the production-polish the floating widget owes the
 * P3 state matrix, layered on the shared cache-then-network contract the web hook lacks.
 */
fun jobProgressVisible(
    presentation: DrawerPresentation,
    activeCount: Int,
    totalJobs: Int,
    isLoading: Boolean,
    isError: Boolean,
): Boolean =
    when {
        presentation == DrawerPresentation.Dismissed && activeCount == 0 -> false
        totalJobs == 0 && !isLoading && !isError -> false
        else -> true
    }

/**
 * The export-job read state the projection consumes — the raw `useExportJobs` list plus the
 * cache-then-network [isLoading]/[isError] flags. Bundling them keeps [projectJobProgress] a small,
 * stable seam (and the render boundary maps a shared `UiState` onto this).
 */
data class JobFeedState(
    val jobs: List<ExportJobSummary>,
    val isLoading: Boolean,
    val isError: Boolean,
)

/**
 * Projects the export-job [feed] onto the [JobProgressProjection] — the one place the web component's
 * pre-render derivations live. [presentation] is the persisted drawer state, [maxRecent] caps the
 * recent list (web default 5), and [nowMillis] is injected so the relative-age tiers are deterministic
 * in tests.
 */
fun projectJobProgress(
    feed: JobFeedState,
    presentation: DrawerPresentation,
    maxRecent: Int,
    nowMillis: Long,
): JobProgressProjection {
    val jobs = feed.jobs
    val active = jobs.filter { isActiveStatus(it.status) }
    val recent = jobs.filterNot { isActiveStatus(it.status) }.take(maxRecent.coerceAtLeast(0))
    val effective = effectivePresentation(presentation, active.size)
    val visible = jobProgressVisible(effective, active.size, jobs.size, feed.isLoading, feed.isError)
    val mode = if (effective == DrawerPresentation.Open) DrawerMode.Open else DrawerMode.Minimized
    return JobProgressProjection(
        visible = visible,
        mode = mode,
        isLoadingBody = feed.isLoading && jobs.isEmpty(),
        activeCount = active.size,
        activeRows = active.map { it.toRow(JobBucket.Active, nowMillis) },
        recentRows = recent.map { it.toRow(JobBucket.Recent, nowMillis) },
    )
}

private fun ExportJobSummary.toRow(
    bucket: JobBucket,
    nowMillis: Long,
): JobRow {
    val parsed = JobStatus.parse(status)
    val finishedSource = completedAt ?: createdAt
    return JobRow(
        id = id,
        statusWire = status,
        status = parsed,
        tone = statusTone(parsed),
        type = type,
        format = format,
        bucket = bucket,
        createdAtAge = relativeBucket(createdAt, nowMillis),
        finishedAtAge = relativeBucket(finishedSource, nowMillis),
        sizeLabel = formatExportBytes(fileSize),
        errorMessage = errorMessage?.takeIf { it.isNotBlank() },
        downloadUrl = if (parsed == JobStatus.Ready) exportDownloadUrl(id) else null,
        showFailedAffordance = parsed == JobStatus.Failed,
    )
}

/**
 * Bucket a row's ISO timestamp into a [FreshnessAge] (web `formatRelative`): an unparseable/absent
 * timestamp yields [FreshnessAge.Unknown] (rendered as the em dash). Uses the shared day/week-aware
 * tiers (the sibling export surface's idiom) so relative labels resolve through the shared
 * `translation_freshness_*` catalog rather than carrying English microcopy here.
 */
fun relativeBucket(
    iso: String?,
    nowMillis: Long,
): FreshnessAge {
    val epoch = parseEpochMillis(iso) ?: return FreshnessAge.Unknown
    return relativeAge(computeAgeSeconds(epoch, nowMillis))
}

/**
 * Format a byte count the way the web `formatBytes(value, { zeroAsEmpty: true, gbDecimals: 2 })`
 * does: null/zero -> em dash, `< 1 KiB` -> `N B`, `< 1 MiB` -> `N.N KB`, `< 1 GiB` -> `N.N MB`, else
 * `N.NN GB`. Uses 1024-based steps and the root locale so the decimal separator matches the web
 * `toFixed` output regardless of device locale (the symbols are international, not translatable prose).
 */
fun formatExportBytes(bytes: Long?): String {
    if (bytes == null || bytes == 0L) return EXPORT_EM_DASH
    return when {
        bytes < BYTES_PER_KB -> "$bytes$UNIT_BYTES"
        bytes < BYTES_PER_KB * BYTES_PER_KB -> oneDecimal(bytes / BYTES_PER_KB) + UNIT_KB
        bytes < BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB ->
            oneDecimal(bytes / (BYTES_PER_KB * BYTES_PER_KB)) + UNIT_MB
        else -> twoDecimal(bytes / (BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB)) + UNIT_GB
    }
}

/**
 * Tolerant ISO-8601 -> epoch-millis parse for a wire timestamp (the web keeps the raw string and
 * parses on demand). Returns `null` for a blank/absent or unparseable value so a partial row never
 * throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

private fun oneDecimal(value: Double): String = String.format(Locale.ROOT, ONE_DECIMAL, value)

private fun twoDecimal(value: Double): String = String.format(Locale.ROOT, TWO_DECIMAL, value)
