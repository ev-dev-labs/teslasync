// Pure, framework-free model + projection for the FSM "Transitions Over Time" timeline chart feature view —
// the native analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/system/components/FSMTimelineChart.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays
// a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the FSM debugger page) passes the loaded
// `FSMTransition[]` plus the selected `hours` window down. From those props the web `useMemo` derives a
// stacked-area time series: it chooses a bucket width from the window (≤6h → 10 min, ≤24h → 30 min, else
// 2 h), lays out empty buckets across `[now - hours, now]`, counts each transition into the bucket its `ts`
// falls in keyed by `fsm_name`, and labels every bucket with its local `HH:mm`. This file owns that whole
// derivation; [FSMTimelineChartProjection.project] is a 1:1 port and the composable only resolves localized
// chrome, palette colors, and freshness state on top of its [FSMTimelineChartProjectionResult].
//
// Time handling: `ts` is an RFC-3339 timestamp string exactly as the API serves it (web `tr.ts`). The web
// reads it with `new Date(tr.ts).getTime()`; an unparseable value yields `NaN` there and silently misses
// every bucket, so it is dropped. [parseMillis] reproduces that with a tolerant decode chain (instant →
// offset date-time → zoneless-as-UTC) returning `null` on failure, and the caller drops `null`. `nowMillis`
// and the display `zone` are injected (never read from the wall clock here) so the projection is unit-tested
// deterministically.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FSMTimelineChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmtimelinechart

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/** Window (in hours) at/below which the web uses 10-minute buckets — web `hours <= 6`. */
internal const val BUCKET_THRESHOLD_6H: Int = 6

/** Window (in hours) at/below which the web uses 30-minute buckets — web `hours <= 24`. */
internal const val BUCKET_THRESHOLD_24H: Int = 24

/** Milliseconds in one minute. */
internal const val MILLIS_PER_MINUTE: Long = 60_000L

/** Milliseconds in one hour — the web `60 * 60_000` window scale. */
internal const val MILLIS_PER_HOUR: Long = 60L * MILLIS_PER_MINUTE

/** 10-minute bucket width — the web `10 * 60_000` (windows ≤ 6 h). */
internal const val BUCKET_MS_10_MIN: Long = 10L * MILLIS_PER_MINUTE

/** 30-minute bucket width — the web `30 * 60_000` (windows ≤ 24 h). */
internal const val BUCKET_MS_30_MIN: Long = 30L * MILLIS_PER_MINUTE

/** 2-hour bucket width — the web `2 * 60 * 60_000` (windows > 24 h). */
internal const val BUCKET_MS_2_HOUR: Long = 2L * MILLIS_PER_HOUR

/** The local `HH:mm` bucket label — the web `${hh}:${mm}` zero-padded 24-hour format. */
private val BUCKET_LABEL_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object FSMTimelineChartRegistration {
    /** Stable surface id. */
    const val ID: String = "fsm-timeline-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FSMTimelineChart"
}

/**
 * One FSM transition reduced to the two fields the web `FSMTimelineChart` reads from the web
 * `FSMTransition` — the native mirror of that prop slice. The rest of the web type (id, vehicle_id,
 * from/to state, trigger, details) belongs to the sibling FSM surfaces and is intentionally omitted.
 *
 * @property ts the RFC-3339 transition timestamp (web `tr.ts`); an unparseable/blank value is dropped from
 *   the counts, exactly like the web `new Date(tr.ts).getTime()` → `NaN` miss.
 * @property fsmName the finite-state-machine name this transition belongs to (web `tr.fsm_name`); it always
 *   contributes to the series set even if its timestamp does not fall in any bucket (web `typeSet`).
 */
data class FSMTransitionPoint(
    val ts: String,
    val fsmName: String,
)

/**
 * One plotted FSM series — the native mirror of a single web stacked `<Area dataKey={fsmName} />`. [name]
 * is the FSM name (the series key/label) and [values] is the per-bucket transition count aligned 1:1 with
 * [FSMTimelineChartProjectionResult.xLabels] (0 where that FSM had no transition in the bucket).
 */
data class FSMTimelineSeries(
    val name: String,
    val values: List<Double>,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web `useMemo` result
 * (`{ buckets, fsmTypes }`) read by the `<AreaChart>`. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host: the composable wraps each [series] entry into a `ChartSeries`, feeds
 * [xLabels] to the bottom axis, builds the legend from [fsmTypes], and shows the friendly empty state when
 * [isEmpty] (no transitions at all — the web `transitions.length === 0` guard).
 */
data class FSMTimelineChartProjectionResult(
    val fsmTypes: List<String>,
    val xLabels: List<String>,
    val series: List<FSMTimelineSeries>,
    val isEmpty: Boolean,
) {
    companion object {
        /** The empty projection rendered when there are no transitions (web `buckets = []`). */
        val Empty = FSMTimelineChartProjectionResult(emptyList(), emptyList(), emptyList(), isEmpty = true)
    }
}

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the two
 * `fsm.*` keys the web component resolves through `t(...)`. The web's third `t('fsm.timelineChart.aria', …)`
 * call has no catalog entry on either platform (it is an inline i18next default), so the composable reuses
 * the localized [title] as the chart's accessible description rather than hardcoding an English literal. The
 * lifecycle-chrome strings (error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 *
 * @property title the panel title (web `fsm.timelineChart`).
 * @property noDataMessage the default empty-state message (web `fsm.noTimelineData`), used when the caller
 *   passes no `emptyMessage` override.
 */
data class FSMTimelineChartStrings(
    val title: String,
    val noDataMessage: String,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's `useMemo` and its chart
 * bindings. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object FSMTimelineChartProjection {
    /**
     * The bucket width in milliseconds for a [hours] window — the web
     * `hours <= 6 ? 10min : hours <= 24 ? 30min : 2h`. The same boundary semantics are preserved, including
     * the web quirk that a `0` ("all time") window selects the 10-minute width.
     */
    fun bucketSizeMs(hours: Int): Long =
        when {
            hours <= BUCKET_THRESHOLD_6H -> BUCKET_MS_10_MIN
            hours <= BUCKET_THRESHOLD_24H -> BUCKET_MS_30_MIN
            else -> BUCKET_MS_2_HOUR
        }

    /**
     * The ordered, de-duplicated bucket keys spanning `[startMillis, nowMillis]` — the web
     * `for (ts = start; ts <= now; ts += bucketMs) key = floor(ts / bucketMs) * bucketMs`. Each key is the
     * floor-aligned start of a bucket; the keys are strictly ascending and contiguous by [bucketMs].
     */
    fun bucketKeys(
        startMillis: Long,
        nowMillis: Long,
        bucketMs: Long,
    ): List<Long> {
        val keys = LinkedHashSet<Long>()
        var ts = startMillis
        while (ts <= nowMillis) {
            keys.add(ts.floorDiv(bucketMs) * bucketMs)
            ts += bucketMs
        }
        return keys.toList()
    }

    /**
     * Buckets [transitions] over the [hours] window ending at [nowMillis] into the render-ready series — the
     * verbatim port of the web `useMemo`. No transitions yields [FSMTimelineChartProjectionResult.Empty]
     * (web `buckets = []`). Otherwise the FSM names are collected (sorted, ascending — web
     * `Array.from(typeSet).sort()`) into a stable series set even for transitions whose timestamp misses the
     * window, empty buckets are laid out across the window, and each transition is counted into the bucket
     * its [parseMillis] timestamp floors to (dropped when unparseable or outside the laid-out buckets, like
     * the web `if (bucket)` guard). [zone] formats each bucket's local `HH:mm` label.
     */
    fun project(
        transitions: List<FSMTransitionPoint>,
        hours: Int,
        nowMillis: Long,
        zone: ZoneId,
    ): FSMTimelineChartProjectionResult {
        if (transitions.isEmpty()) return FSMTimelineChartProjectionResult.Empty
        val bucketMs = bucketSizeMs(hours)
        val startMillis = nowMillis - hours.toLong() * MILLIS_PER_HOUR
        val fsmTypes = transitions.map { it.fsmName }.toSortedSet().toList()
        val keys = bucketKeys(startMillis, nowMillis, bucketMs)
        val keyIndex = keys.withIndex().associate { (index, key) -> key to index }
        val typeIndex = fsmTypes.withIndex().associate { (index, type) -> type to index }
        val counts = Array(fsmTypes.size) { IntArray(keys.size) }
        for (transition in transitions) {
            val bucketIndex = parseMillis(transition.ts)?.let { keyIndex[it.floorDiv(bucketMs) * bucketMs] }
            val seriesIndex = typeIndex[transition.fsmName]
            if (bucketIndex != null && seriesIndex != null) {
                counts[seriesIndex][bucketIndex] += 1
            }
        }
        return FSMTimelineChartProjectionResult(
            fsmTypes = fsmTypes,
            xLabels = keys.map { formatBucketLabel(it, zone) },
            // `+ 0.0` widens each Int bucket count to the chart series' Double value type.
            series = fsmTypes.mapIndexed { index, name -> FSMTimelineSeries(name, counts[index].map { it + 0.0 }) },
            isEmpty = false,
        )
    }

    /**
     * Formats a bucket key (epoch millis) as its local `HH:mm` label in [zone] — the native analogue of the
     * web `getHours()`/`getMinutes()` zero-padded rendering. Pure (java.time only) so it is deterministic
     * under test.
     */
    fun formatBucketLabel(
        epochMillis: Long,
        zone: ZoneId,
    ): String = BUCKET_LABEL_FORMATTER.withZone(zone).format(Instant.ofEpochMilli(epochMillis))

    /**
     * Tolerant RFC-3339 → epoch-millisecond decode — the native analogue of the web
     * `new Date(tr.ts).getTime()`. Tries an instant (`…Z`), then an offset date-time, then a zoneless local
     * date-time treated as UTC; the first that parses wins. A blank or fully unparseable value yields `null`
     * (the web `NaN` miss), and the caller drops it from the counts.
     */
    fun parseMillis(raw: String): Long? {
        if (raw.isBlank()) return null
        return TIMESTAMP_PARSERS.firstNotNullOfOrNull { it(raw) }?.toEpochMilli()
    }

    // Decode chain tried in order by [parseMillis]; each entry returns null (not throws) on a mismatch.
    private val TIMESTAMP_PARSERS: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FSMTimelineChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a vehicle id, FSM name, or timestamp — so a diagnostics line can
 * never leak which state machines a vehicle exercised. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordFSMTimelineChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FSMTimelineChartRegistration.SLUG))
}
