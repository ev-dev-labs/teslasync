// Pure, framework-free model + projection for the QueueJobDrawer modal/dialog surface — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/admin/components/QueueJobDrawer.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is a slide-in panel that lists the most recent jobs for a single worker (web
// `useQueueJobs`). This file owns the parity-critical, render-free derivations: the per-status tone
// taxonomy (web `STATUS_TONE` / `statusToneClass`), the `title || id` row label (web
// `job.title || job.id`), the duration-label branch (web `duration_ms ?? finished_at - started_at`
// run through `formatDurationMsLong`), the `titleWithWorker` vs `title` selector (web `displayName`
// truthiness), the tolerant ISO-8601 → epoch-millis parse the absolute "Started {at}" label and the
// duration diff build on, and the PII-safe `view.opened` diagnostic (P1/S11).
//
// Job durations are whole milliseconds and timestamps are ISO-8601 strings — neither is a display-unit
// SI quantity (m/mps/°C/Pa/Wh) — so there is no SI conversion here; the millisecond duration format is
// ordinary, locale-stable (Locale.ROOT) display formatting kept pure so the projection is unit-tested
// off device, and the absolute date-time is formatted at the render boundary (S5) where the device
// locale + zone live.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/modals-dialogs/QueueJobDrawer — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package and the file hosts several co-located declarations, exactly as the
// sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.modalsdialogs.queuejobdrawer

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueJobView
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.roundToLong

/** The universal "no value" glyph the web renders as `—` (the `formatDurationMsLong` fallback). */
internal const val QUEUE_JOB_EM_DASH: String = "\u2014"

/** The middot the web joins the "Started …" and "Took …" clauses with (`… · …`). */
internal const val QUEUE_JOB_META_SEPARATOR: String = " \u00B7 "

private const val MILLIS_PER_SECOND: Long = 1_000L
private const val MILLIS_PER_SECOND_DOUBLE: Double = 1_000.0
private const val SECONDS_PER_MINUTE: Double = 60.0

// Wire status values matched verbatim against the web `STATUS_TONE` record keys (the backend job-status
// enums across the notification / export / automation domains).
private const val STATUS_SENT = "sent"
private const val STATUS_PENDING = "pending"
private const val STATUS_DEFERRED_DND = "deferred_dnd"
private const val STATUS_FAILED = "failed"
private const val STATUS_READY = "ready"
private const val STATUS_QUEUED = "queued"
private const val STATUS_PROCESSING = "processing"
private const val STATUS_SUCCESS = "success"
private const val STATUS_PARTIAL = "partial"
private const val STATUS_RUNNING = "running"
private const val STATUS_CANCELLED = "cancelled"
private const val STATUS_SKIPPED = "skipped"

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no worker identity,
 * job id, title, or error text, so a diagnostics line can never leak what a worker is processing.
 */
const val QUEUE_JOB_DRAWER_SLUG: String = "QueueJobDrawer"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [QUEUE_JOB_DRAWER_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the first-composition effect.
 */
fun recordQueueJobDrawerViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to QUEUE_JOB_DRAWER_SLUG))
}

/**
 * Semantic tone for a job-status label — the native port of the web `STATUS_TONE` colour record. The
 * render boundary maps each tone to a concrete colour (success → emerald, warning → amber, info →
 * cyan, danger → rose, muted → `--text-muted`, neutral → `--text-primary`), mirroring the web's
 * toned-down body-text palette. An unrecognised status folds to [Neutral] (web
 * `STATUS_TONE[status] ?? 'text-[var(--text-primary)]'`).
 */
enum class QueueJobTone { Success, Warning, Info, Danger, Muted, Neutral }

/**
 * One projected, render-ready job row — the native analogue of everything the web `QueueJobRow`
 * derives before render. Pure data (no Compose types): the [title] (web `job.title || job.id`), the
 * raw [statusWire] (resolved to a localized label + tone at the render boundary), the [tone], the
 * [startedAtMillis] (absolute-formatted at render where the device locale/zone live), the pure
 * [durationLabel] (web `durationLabel`, `null` ⇒ no "Took …" clause), and the optional [error]
 * (blank dropped).
 */
data class QueueJobRowModel(
    val id: String,
    val title: String,
    val statusWire: String,
    val tone: QueueJobTone,
    val startedAtMillis: Long?,
    val durationLabel: String?,
    val error: String?,
)

/**
 * Stateless, side-effect-free projection from the drawer's inputs to its render state — a 1:1 port of
 * the web component's per-row derivations and the title selector. Fully covered by the off-device unit
 * gate; the composable only resolves localized strings, formats the absolute timestamp, picks colors,
 * and draws what these return.
 */
object QueueJobDrawerProjection {
    /**
     * Status → tone — the native mirror of the web `STATUS_TONE` map: sent/ready/success → success,
     * pending/deferred_dnd/queued/partial → warning, processing/running → info, failed → danger,
     * cancelled/skipped → muted, and any other value → neutral (web `?? 'text-[var(--text-primary)]'`).
     */
    fun tone(status: String): QueueJobTone =
        when (status) {
            STATUS_SENT, STATUS_READY, STATUS_SUCCESS -> QueueJobTone.Success
            STATUS_PENDING, STATUS_DEFERRED_DND, STATUS_QUEUED, STATUS_PARTIAL -> QueueJobTone.Warning
            STATUS_PROCESSING, STATUS_RUNNING -> QueueJobTone.Info
            STATUS_FAILED -> QueueJobTone.Danger
            STATUS_CANCELLED, STATUS_SKIPPED -> QueueJobTone.Muted
            else -> QueueJobTone.Neutral
        }

    /** Whether the drawer shows the `titleWithWorker` variant — the web `displayName` truthiness. */
    fun titleHasWorker(displayName: String?): Boolean = !displayName.isNullOrBlank()

    /** The row's primary label — the web `job.title || job.id` (blank title falls back to the id). */
    fun rowTitle(job: QueueJobView): String = job.title.ifBlank { job.id }

    /**
     * The "Took {duration}" clause text — a faithful port of the web `durationLabel`:
     *  - a numeric `duration_ms` → `formatDurationMsLong(duration_ms)`;
     *  - else a present `finished_at` → `formatDurationMsLong(finished − started)`, or the em dash when
     *    either timestamp is unparseable (web `new Date(bad).getTime()` ⇒ `NaN` ⇒ the fallback);
     *  - else `null`, which suppresses the whole "Took …" clause (web `durationLabel ? … : ''`).
     *
     * Returning `null` only when there is neither a duration nor a finish time preserves the web's
     * exact branch — a finished job with an unreadable timestamp still renders "Took —".
     */
    fun durationLabel(
        durationMs: Long?,
        startedAt: String,
        finishedAt: String?,
    ): String? =
        when {
            durationMs != null -> formatDurationMsLong(durationMs)
            !finishedAt.isNullOrBlank() -> {
                val started = parseIsoMillis(startedAt)
                val finished = parseIsoMillis(finishedAt)
                if (started != null && finished != null) {
                    formatDurationMsLong(finished - started)
                } else {
                    QUEUE_JOB_EM_DASH
                }
            }
            else -> null
        }

    /** Projects one wire [job] onto its render-ready [QueueJobRowModel]. */
    fun projectRow(job: QueueJobView): QueueJobRowModel =
        QueueJobRowModel(
            id = job.id,
            title = rowTitle(job),
            statusWire = job.status,
            tone = tone(job.status),
            startedAtMillis = parseIsoMillis(job.startedAt),
            durationLabel = durationLabel(job.durationMs, job.startedAt, job.finishedAt),
            error = job.error.takeIf { it.isNotBlank() },
        )

    /** Projects the worker's [jobs] onto render-ready rows, newest-first as the backend returns them. */
    fun projectRows(jobs: List<QueueJobView>): List<QueueJobRowModel> = jobs.map(::projectRow)

    /**
     * Millisecond duration with minute/second output for longer jobs — a faithful port of the web
     * `formatDurationMsLong` (`web/src/lib/dateFormat.ts`): non-positive/invalid input yields the em
     * dash, sub-second yields `"{ms}ms"`, sub-minute yields one-decimal seconds (`"45.0s"`), and beyond
     * a minute yields `"{m}m {s}s"` with the seconds rounded to the nearest whole. Formatted with
     * [Locale.ROOT] because the web helper is not localized (it always emits a `.` decimal and the
     * `ms`/`s`/`m` unit letters verbatim), so an exact-parity render is the correct one.
     */
    fun formatDurationMsLong(ms: Long): String =
        when {
            ms <= 0L -> QUEUE_JOB_EM_DASH
            ms < MILLIS_PER_SECOND -> "${ms}ms"
            else -> {
                val seconds = ms / MILLIS_PER_SECOND_DOUBLE
                if (seconds < SECONDS_PER_MINUTE) {
                    String.format(Locale.ROOT, "%.1fs", seconds)
                } else {
                    val minutes = (seconds / SECONDS_PER_MINUTE).toLong()
                    val remainderSeconds = (seconds % SECONDS_PER_MINUTE).roundToLong()
                    "${minutes}m ${remainderSeconds}s"
                }
            }
        }

    /**
     * Tolerant ISO-8601 → epoch-millisecond parse for the `started_at` / `finished_at` instants the
     * absolute "Started {at}" label and the duration diff build on. Accepts an RFC-3339 instant
     * (`…Z`), an offset date-time, or a zoneless local date-time treated as UTC; a blank or unparseable
     * value yields `null` (the render layer then shows the em-dash fallback). Pure (java.time only) so
     * it is unit-tested deterministically.
     */
    fun parseIsoMillis(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return PARSERS.firstNotNullOfOrNull { it(raw) }
    }

    private val PARSERS: List<(String) -> Long?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw).toEpochMilli() } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant().toEpochMilli() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() } },
        )

    private fun tryParse(block: () -> Long): Long? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}
