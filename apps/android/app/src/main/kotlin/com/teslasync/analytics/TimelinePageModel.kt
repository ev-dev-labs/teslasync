// Pure, framework-free model + projections for the TimelinePage analytics surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/analytics/pages/TimelinePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection + the shared-core Resource), so the composable stays a thin render layer and all of this is
// exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page reads two FSM endpoints: `/vehicle-states/timeline` (the transition events) and
// `/vehicle-states/summary` (the per-state aggregate the four stat cards + the distribution bar render). BOTH are
// `@deprecated`/404 post Phase-42 (Prompt-0077 dropped the `vehicle_states` table — see AnalyticsRepository), and
// the shared `AnalyticsStore.stateSummary` additionally applies `safeArray`, which collapses the summary OBJECT
// (`{by_state, total_seconds}`) to an empty array. So this native port derives the per-state durations + transition
// counts from the ONE shared feed that survives — the `timeline` transitions array (`AnalyticsStore.timeline`,
// already unwrapped to the `transitions` array). Duration in a `to_state` = (next transition's ts, or `now` for the
// newest row) − this ts; summing those per destination state is the same aggregation the summary endpoint performed,
// so the cards/distribution stay value-faithful while depending only on the live feed (Honesty Covenant #9 —
// documented, not silent). Both endpoints 404 at runtime, so the first load hard-errors with no cache and the page
// shows the error surface + retry; the success/empty surfaces are reachable from cached/mock data.
//
// There are no SI unit values on this surface (no distance/speed/energy): the only figures are durations (seconds →
// h/m/s, universal) and integer counts (locale-grouped). So there is nothing to convert at the display boundary —
// the SI-canonical rule (Phase-48) is satisfied vacuously.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling LifetimeStatsPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.analytics.timeline

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/** Milliseconds per second — the SI bridge used to render transition durations from epoch deltas. */
private const val MILLIS_PER_SECOND = 1000.0

/** Seconds per minute / minutes per hour — the h/m/s breakdown the duration formatters floor on (web helpers). */
private const val SECONDS_PER_MINUTE = 60.0
private const val MINUTES_PER_HOUR = 60.0

/** The em dash shown for a missing trigger / unparseable duration (web `'—'`). */
const val EM_DASH: String = "\u2014"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TimelinePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("timeline", "/timeline", …)`, so the host binds this surface to that destination (and its `/timeline` deep
 * link) without the nav module depending on it.
 */
object TimelinePageRegistration {
    /** The navigation destination id (Destinations.kt `page("timeline", "/timeline", …)`). */
    const val ROUTE_ID: String = "timeline"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/timeline"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "TimelinePage"
}

/**
 * The canonical FSM state keys this surface buckets on — the web `STATE_COLORS` / `STATE_BADGE` key order. Used to
 * render the distribution bar + legend deterministically (the web iterates the summary rows, which arrive in this
 * backend order). They are raw data identifiers (never user copy), rendered verbatim + capitalized like the web.
 */
val STATE_ORDER: List<String> =
    listOf("driving", "charging", "idle", "sleeping", "online", "offline", "parked", "asleep")

/** A single FSM transition event (web `TransitionRecord`), point-in-time. */
data class TransitionRecord(
    val ts: String,
    val fromState: String,
    val toState: String,
    val triggerField: String?,
    val triggerValue: String?,
)

/**
 * An indexed transition for the table (web `TransitionRow`): the destination-state dwell [durationSeconds] is
 * (the next transition's ts, or `now` for the newest row) − this ts, so the table renders "time spent in to_state"
 * without an extra feed. `null` when the interval is unparseable / non-positive (web renders the em dash).
 */
data class TransitionRow(
    val index: Int,
    val ts: String,
    val fromState: String,
    val toState: String,
    val triggerField: String?,
    val durationSeconds: Double?,
)

/** Per-destination-state aggregate derived from the transitions (the native analogue of one web `by_state` row). */
data class StateStat(
    val transitionCount: Int,
    val totalSeconds: Double,
)

/** One day's transition counts, bucketed by destination state into the four legend buckets (web `dailyBreakdown`). */
data class DailyBucket(
    val day: String,
    val driving: Int,
    val charging: Int,
    val idle: Int,
    val sleeping: Int,
)

/** One slice of the proportional distribution bar (web summary row): a [state], its dwell [seconds] + [percentage]. */
data class StateSlice(
    val state: String,
    val seconds: Double,
    val percentage: Double,
)

/**
 * The decoded + derived Timeline payload every panel reads — built purely from the transitions feed. Carries the
 * indexed [transitions] (table), the [dailyBreakdown] (the bar chart), and the [stateStats] aggregate (the four stat
 * cards + the distribution bar). An empty transitions list routes the surface to its empty state.
 */
data class TimelineData(
    val transitions: List<TransitionRow>,
    val dailyBreakdown: List<DailyBucket>,
    val stateStats: Map<String, StateStat>,
) {
    /** Whether the surface should render its empty state (web `transitions.length === 0`). */
    val isEmpty: Boolean get() = transitions.isEmpty()

    /** Total transitions across every state (web `summaryRows.reduce((s, r) => s + r.transition_count, 0)`). */
    val totalTransitions: Int get() = stateStats.values.sumOf { it.transitionCount }

    /** Summed dwell seconds across the given [states] (0 when none are present). */
    fun secondsIn(vararg states: String): Double = states.sumOf { stateStats[it]?.totalSeconds ?: 0.0 }

    /** Dwell seconds in `driving` (web `summaryByState.driving?.totalSeconds ?? 0`). */
    val drivingSeconds: Double get() = secondsIn("driving")

    /** Dwell seconds in `charging` (web `summaryByState.charging?.totalSeconds ?? 0`). */
    val chargingSeconds: Double get() = secondsIn("charging")

    /** Dwell seconds in the idle bucket — online + parked + idle (web `idleSec`). */
    val idleSeconds: Double get() = secondsIn("online", "parked", "idle")

    /** Dwell seconds in the sleeping bucket — asleep + sleeping + offline (web `sleepingSec`). */
    val sleepingSeconds: Double get() = secondsIn("asleep", "sleeping", "offline")

    /** The grand total dwell seconds, the distribution-bar denominator (web `total_seconds`). */
    val totalStateSeconds: Double get() = stateStats.values.sumOf { it.totalSeconds }

    /**
     * The proportional distribution slices in [STATE_ORDER], one per present state, each carrying its dwell seconds +
     * percentage of [totalStateSeconds] (web `summaryRows.map(row => row.total_seconds / total * 100)`).
     */
    val distribution: List<StateSlice>
        get() {
            val total = totalStateSeconds
            return STATE_ORDER.mapNotNull { state ->
                stateStats[state]?.let { stat ->
                    StateSlice(
                        state = state,
                        seconds = stat.totalSeconds,
                        percentage = if (total > 0.0) stat.totalSeconds / total * PERCENT else 0.0,
                    )
                }
            }
        }

    companion object {
        private const val PERCENT = 100.0

        /** The empty snapshot, surfaced for a null / non-array payload, a disabled (no-vehicle) feed, or no activity. */
        val EMPTY: TimelineData = TimelineData(transitions = emptyList(), dailyBreakdown = emptyList(), stateStats = emptyMap())
    }
}

/**
 * Decodes the raw `timeline` [json] (the unwrapped `transitions` array, SI/snake_case on the wire) into a
 * [TimelineData], deriving the indexed rows, the daily breakdown, and the per-state aggregate as of [nowMillis] (the
 * newest open interval is measured to `now`, web `Date.now()`). A non-array / object-envelope / null input collapses
 * to [TimelineData.EMPTY], reproducing the web `Array.isArray(...) ? … : []` guard.
 */
fun buildTimelineData(
    json: JsonElement?,
    nowMillis: Long,
): TimelineData {
    val records = decodeTransitions(json)
    if (records.isEmpty()) return TimelineData.EMPTY

    // Sort ASC by ts so each row's duration points at the correct neighbour (web `[...raw].sort(...)`).
    val ordered = records.sortedBy { parseMillis(it.ts) ?: Long.MIN_VALUE }
    val rows =
        ordered.mapIndexed { i, record ->
            val nextTs = ordered.getOrNull(i + 1)?.ts
            TransitionRow(
                index = i,
                ts = record.ts,
                fromState = record.fromState,
                toState = record.toState,
                triggerField = record.triggerField,
                durationSeconds = dwellSeconds(record.ts, nextTs, nowMillis),
            )
        }
    return TimelineData(
        transitions = rows,
        dailyBreakdown = buildDailyBreakdown(rows),
        stateStats = buildStateStats(rows),
    )
}

/** Decodes the transitions array, accepting either the bare array (shared store) or the `{transitions}` envelope. */
fun decodeTransitions(json: JsonElement?): List<TransitionRecord> {
    val array =
        when (json) {
            is JsonArray -> json
            is JsonObject -> json["transitions"] as? JsonArray ?: return emptyList()
            else -> return emptyList()
        }
    return array.mapNotNull { (it as? JsonObject)?.toTransition() }
}

private fun JsonObject.toTransition(): TransitionRecord? {
    val ts = string("ts") ?: return null
    return TransitionRecord(
        ts = ts,
        fromState = string("from_state") ?: "",
        toState = string("to_state") ?: "",
        triggerField = string("trigger_field"),
        triggerValue = string("trigger_value"),
    )
}

/**
 * Bins the rows by the UTC calendar day of their `ts` (web `date.toISOString().slice(0, 10)`), counting each by its
 * destination state folded into the four legend buckets (driving / charging / idle / sleeping). Sorted by day asc.
 */
private fun buildDailyBreakdown(rows: List<TransitionRow>): List<DailyBucket> {
    val buckets = LinkedHashMap<String, IntArray>()
    for (row in rows) {
        val day = utcDay(row.ts) ?: continue
        val counts = buckets.getOrPut(day) { IntArray(BUCKET_COUNT) }
        when (bucketOf(row.toState)) {
            Bucket.DRIVING -> counts[Bucket.DRIVING.ordinal]++
            Bucket.CHARGING -> counts[Bucket.CHARGING.ordinal]++
            Bucket.IDLE -> counts[Bucket.IDLE.ordinal]++
            Bucket.SLEEPING -> counts[Bucket.SLEEPING.ordinal]++
            null -> Unit
        }
    }
    return buckets.entries
        .map { (day, c) -> DailyBucket(day, c[0], c[1], c[2], c[3]) }
        .sortedBy { it.day }
}

/** Aggregates per destination state: transition count + summed dwell seconds (the summary-equivalent, web `by_state`). */
private fun buildStateStats(rows: List<TransitionRow>): Map<String, StateStat> {
    val counts = HashMap<String, Int>()
    val seconds = HashMap<String, Double>()
    for (row in rows) {
        val state = row.toState
        if (state.isEmpty()) continue
        counts[state] = (counts[state] ?: 0) + 1
        seconds[state] = (seconds[state] ?: 0.0) + (row.durationSeconds ?: 0.0)
    }
    return counts.mapValues { (state, count) -> StateStat(transitionCount = count, totalSeconds = seconds[state] ?: 0.0) }
}

private enum class Bucket { DRIVING, CHARGING, IDLE, SLEEPING }

private const val BUCKET_COUNT = 4

/** Folds a raw FSM state into one of the four legend buckets (web `dailyBreakdown` switch), or null to ignore it. */
private fun bucketOf(state: String): Bucket? =
    when (state) {
        "driving" -> Bucket.DRIVING
        "charging" -> Bucket.CHARGING
        "idle", "online", "parked" -> Bucket.IDLE
        "sleeping", "asleep", "offline" -> Bucket.SLEEPING
        else -> null
    }

/** Dwell seconds for a row: (next ts, or [nowMillis] for the newest row) − this ts; null if invalid / non-positive. */
private fun dwellSeconds(
    ts: String,
    nextTs: String?,
    nowMillis: Long,
): Double? {
    val start = parseMillis(ts) ?: return null
    val end = nextTs?.let { parseMillis(it) } ?: nowMillis
    if (end <= start) return null
    return (end - start) / MILLIS_PER_SECOND
}

/** Parses an ISO timestamp to epoch millis, tolerating an offset, a bare instant, or a zoneless local date-time. */
internal fun parseMillis(ts: String): Long? =
    runCatching { OffsetDateTime.parse(ts).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(ts).toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(ts).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .getOrNull()

/** The UTC calendar day (`yyyy-MM-dd`) of [ts], or null when it is unparseable (web `toISOString().slice(0, 10)`). */
internal fun utcDay(ts: String): String? {
    val millis = parseMillis(ts) ?: return null
    return Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
}

/**
 * Formats whole hours + minutes from [seconds] (web `formatHoursFromSeconds`): `Xh Ym`, `Xh` when the minute
 * remainder rounds below a half, or `Ym` under an hour. Locale-grouped via [Locale].
 */
fun formatHoursFromSeconds(
    seconds: Double,
    locale: Locale,
): String {
    val hours = seconds / SECONDS_PER_MINUTE / MINUTES_PER_HOUR
    val wholeHours = floor(hours)
    val minutes = (hours - wholeHours) * MINUTES_PER_HOUR
    if (wholeHours <= 0.0) return formatInt(minutes, locale) + "m"
    return if (minutes >= HALF) "${formatInt(wholeHours, locale)}h ${formatInt(minutes, locale)}m" else "${formatInt(wholeHours, locale)}h"
}

/** Formats a duration from [seconds] (web `formatDurationFromSeconds`): `Xs` under a minute, else the h/m breakdown. */
fun formatDurationFromSeconds(
    seconds: Double,
    locale: Locale,
): String = if (seconds < SECONDS_PER_MINUTE) formatInt(seconds, locale) + "s" else formatHoursFromSeconds(seconds, locale)

/** A localized, grouped integer (web `fmtInt`) — floors toward zero like the web `Math.floor` in its helpers. */
fun formatInt(
    value: Double,
    locale: Locale,
): String = String.format(locale, "%,d", floor(value).toLong())

/** A localized percentage with one fraction digit + the `%` suffix (web `fmtPercent(value, 1)`). */
fun formatPercent(
    value: Double,
    locale: Locale,
): String = String.format(locale, "%,.1f%%", value)

/**
 * A localized medium-style date-time for [raw] (web `formatDateTime`), or [raw] verbatim when it cannot be parsed so
 * the table cell is never blank. Rendered in the device [zoneId].
 */
fun formatDateTime(
    raw: String,
    locale: Locale,
    zoneId: ZoneId,
): String {
    val millis = parseMillis(raw) ?: return raw
    return Instant.ofEpochMilli(millis)
        .atZone(zoneId)
        .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale))
}

private const val HALF = 0.5

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → TimelineData` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/** The disabled-feed sentinel: an empty transitions array surfaced when no vehicle is selected (web `enabled: false`). */
fun emptyTimelineResource(): Resource<JsonElement> = Resource.Success(JsonArray(emptyList()), 0L, false)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TimelinePageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id or transition payload.
 */
fun recordTimelineOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TimelinePageRegistration.SLUG))
}
