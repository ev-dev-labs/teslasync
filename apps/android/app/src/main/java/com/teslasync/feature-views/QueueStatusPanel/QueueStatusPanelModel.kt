// Pure, framework-free model + projection for the QueueStatusPanel feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/admin/components/QueueStatusPanel.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component owns `useQueueStatus` but is, by its own docstring, "purely presentational so tests
// can drive it with stub data via the testHookOverride prop". The native surface keeps that contract: it
// binds no data hook of its own. The host supplies the worker rows through the shared P1/S8 state-holder
// layer as a [UiState] (the cache-then-network projection of the `GET /system/queues` feed), so this view
// also renders every lifecycle state that layer can carry — loading, hard error, empty, content, and
// stale/offline ("last known") — without ever fetching. This file owns the parts the web component
// computes from those props: the `(workers, isLoading, error)` → lifecycle [UiState] adapter, the
// heartbeat-severity classification, the queue-depth total + bar maximum, the `oldest_pending` visibility
// gate, the `formatDurationMsLong` duration string, the locale-grouped count formatter, the tolerant
// ISO-8601 → epoch-millis parse the relative-time chips build on, and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/QueueStatusPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.queuestatuspanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueStat
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.roundToLong

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no worker identity,
 * host, version, or count, so a diagnostics line can never leak the fleet's operational posture.
 */
const val QUEUE_STATUS_PANEL_SLUG: String = "QueueStatusPanel"

/** Em dash shown for an unrenderable duration — the web `formatDurationMsLong` invalid-input fallback. */
internal const val EM_DASH: String = "\u2014"

private const val MILLIS_PER_SECOND: Long = 1_000L
private const val MILLIS_PER_SECOND_DOUBLE: Double = 1_000.0
private const val SECONDS_PER_MINUTE: Double = 60.0

/**
 * Heartbeat-freshness severity — the native mirror of the web `QueueHeartbeatSeverity` union
 * (`ok` | `warn` | `critical` | `down`). The wire value arrives as a string on [QueueStat.heartbeatSeverity];
 * [QueueStatusPanelProjection.severityOf] classifies it, and the render layer maps it to a tone color and a
 * localized label. An unknown/forward-compatible value folds to [Down] (the safest "we have not heard from
 * it" band), mirroring the web `SEVERITY_*` records keyed by the same four bands.
 */
enum class QueueSeverity { Ok, Warn, Critical, Down }

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's branch
 * ladder and per-worker derivations. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, picks colors, and draws what these return.
 */
object QueueStatusPanelProjection {
    /**
     * Classifies the wire heartbeat-severity string into a [QueueSeverity] — the native mirror of the web
     * `SEVERITY_COLOR` / `SEVERITY_TONE_CLASS` record keys. An unrecognised value folds to [QueueSeverity.Down]
     * so a forward-compatible band never crashes the row and is shown with the most cautious tone.
     */
    fun severityOf(wire: String): QueueSeverity =
        when (wire) {
            "ok" -> QueueSeverity.Ok
            "warn" -> QueueSeverity.Warn
            "critical" -> QueueSeverity.Critical
            "down" -> QueueSeverity.Down
            else -> QueueSeverity.Down
        }

    /** Queue depth — the web `stat.pending + stat.in_progress` MetricBar value. */
    fun total(stat: QueueStat): Long = stat.pending + stat.inProgress

    /**
     * The MetricBar maximum — the web `total > 0 ? total : 1`. A worker with an empty queue still draws an
     * (empty) bar rather than dividing by zero, so the card never collapses.
     */
    fun metricMax(stat: QueueStat): Long {
        val depth = total(stat)
        return if (depth > 0L) depth else 1L
    }

    /** Whether to show the oldest-pending footnote — the web `oldest_pending_age_seconds > 0` gate. */
    fun showOldestPending(seconds: Long): Boolean = seconds > 0L

    /** Whether the worker has ever reported a heartbeat — the web `stat.last_heartbeat_at` truthiness. */
    fun hasHeartbeat(lastHeartbeatAt: String?): Boolean = !lastHeartbeatAt.isNullOrBlank()

    /** Whether a host was reported — the web `stat.host ? hostVersion : hostUnknown` truthiness. */
    fun hasHost(host: String): Boolean = host.isNotBlank()

    /**
     * Maps the web hook's `(workers, generated_at, isLoading, isFetching, error)` fields onto the shared
     * cache-then-network [UiState] (P1/S8), reproducing the web component's body branch precedence exactly:
     *
     *  - `isLoading` (a first load with no data) → [UiPhase.Loading] (web Spinner + "Loading worker status…");
     *  - else `error` → [UiPhase.Error] (web danger alert; the always-present header Refresh is the retry);
     *  - else no workers → [UiPhase.Empty] (web italic "No workers are currently registered…");
     *  - else → [UiPhase.Content] (web 1/3-column card grid).
     *
     * [isFetching] is carried as [UiState.refreshing] so the header Refresh button shows its in-flight spinner
     * exactly when the web `loading={isFetching && !isLoading}` does. The host's own state holder can instead
     * emit a richer [UiState] carrying stale/offline; the composable renders those too.
     */
    fun projectUiState(
        workers: List<QueueStat>,
        generatedAt: String,
        isLoading: Boolean,
        isFetching: Boolean,
        error: Boolean,
    ): UiState<QueueStatusResponse> {
        val data = QueueStatusResponse(generatedAt = generatedAt, workers = workers)
        val fetchedAt = parseIsoMillis(generatedAt)
        return when {
            isLoading -> UiState(phase = UiPhase.Loading, refreshing = isFetching)
            error ->
                UiState(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Unknown,
                    fetchedAt = fetchedAt,
                    refreshing = isFetching,
                )
            workers.isEmpty() ->
                UiState(phase = UiPhase.Empty, data = data, fetchedAt = fetchedAt, refreshing = isFetching)
            else -> UiState(phase = UiPhase.Content, data = data, fetchedAt = fetchedAt, refreshing = isFetching)
        }
    }

    /**
     * Locale-grouped integer count — the dimensionless-count analogue of the web `fmtNumber(stat.pending)`
     * (counts are whole numbers, so this renders e.g. `1,234` with the locale's grouping separator). Kept
     * pure so the unit gate pins the grouping deterministically.
     */
    fun formatCount(
        value: Long,
        locale: Locale,
    ): String = String.format(locale, "%,d", value)

    /** The oldest-pending duration string — the web `formatDurationMsLong(oldest_pending_age_seconds * 1000)`. */
    fun formatOldestPending(seconds: Long): String = formatDurationMsLong(seconds * MILLIS_PER_SECOND)

    /**
     * Millisecond duration with minute/second output for longer jobs — a faithful port of the web
     * `formatDurationMsLong` (`web/src/lib/dateFormat.ts`): non-positive input yields the em dash, sub-second
     * yields `"{ms}ms"`, sub-minute yields one-decimal seconds (`"45.0s"`), and beyond a minute yields
     * `"{m}m {s}s"` with the seconds rounded to the nearest whole. Formatted with [Locale.ROOT] because the web
     * helper is not localized (it always emits a `.` decimal and the `ms`/`s`/`m` unit letters verbatim), so
     * an exact-parity render is the correct one.
     */
    fun formatDurationMsLong(ms: Long): String =
        when {
            ms <= 0L -> EM_DASH
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
     * Tolerant ISO-8601 → epoch-millisecond parse for the `generated_at` / `last_heartbeat_at` instants the
     * relative-time chips render. Accepts an RFC-3339 instant (`…Z`), an offset date-time, or a zoneless local
     * date-time treated as UTC; a blank or unparseable value yields `null` (the render layer then shows the
     * "never"/em-dash fallback). Pure (java.time only) so it is unit-tested deterministically.
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

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [QUEUE_STATUS_PANEL_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordQueueStatusPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to QUEUE_STATUS_PANEL_SLUG))
}
