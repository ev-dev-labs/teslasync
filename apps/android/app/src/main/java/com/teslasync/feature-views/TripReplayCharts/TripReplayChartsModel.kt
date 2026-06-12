// Pure, framework-free model + projection for the TripReplayCharts feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/trips/components/TripReplayCharts.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (TripReplayPage) builds the per-sample
// `TripReplayChartPoint[]` (speed already converted into the user's display unit, power in kW, time in
// minutes since trip start) and passes it down with the playhead `currentIndex` and an `onSeekToIndex`
// callback. This file owns the parts the web render derives from that prop:
//   * the ordered speed/power value columns the two `<Area>`s plot and the per-sample x-axis ("Nm") +
//     hover ("N.N min") labels the web `tickFormatter` / `labelFormatter` produce,
//   * the `data.length > 0` content/empty boundary (web: 0 samples ⇒ the "No telemetry data available"
//     EmptyState),
//   * the playhead clamp (web `data[currentIndex]?.time`), the click→index mapping (web
//     `onClick` → `data[activeTooltipIndex].index`), and the persistent-cursor `nearestIndexByTime`
//     binary search the web exports + the `ChartCursorBridge` forwards through.
// Sample order is preserved exactly as received (the web generator emits ascending time and the chart maps
// in array order), so the native plot, playhead, and seek math read in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TripReplayCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripreplaycharts

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToInt

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TripReplayChartsRegistration {
    /** Stable surface id. */
    const val ID: String = "trip-replay-charts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "TripReplayCharts"
}

/**
 * One sample on the speed+power replay timeline — the native mirror of the web `TripReplayChartPoint`.
 * The parent supplies values already converted into display units (the web `chartData` arrives
 * pre-converted), so this surface only labels and plots them.
 *
 * @property index the index into the parent positions array (web `index`); this is the value forwarded to
 *   `onSeekToIndex`, not the chart-array position, so a down-sampled trace still seeks to the right frame.
 * @property time minutes since trip start (web `time`, the x-axis `dataKey` and cursor-sync value).
 * @property speed speed in the user's display unit (web `dataKey="speed"`).
 * @property power instantaneous power in kW (web `dataKey="power"`); may be negative under regen.
 */
data class TripReplayChartPoint(
    val index: Int,
    val time: Double,
    val speed: Double,
    val power: Double,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `data`. Pure data (no Compose types) so the projection is unit-tested without a UI host: the
 * composable wraps [speedValues]/[powerValues] into `ChartSeries`, feeds [xLabels] to the bottom axis, and
 * reads [cursorLabels] for the playhead marker label.
 *
 * @property xLabels per-sample bottom-axis label (web `tickFormatter` `${fmt(v,0)}m`).
 * @property cursorLabels per-sample playhead label (web tooltip `labelFormatter` `${fmt(v,1)} min`).
 * @property speedValues the speed column (web `<Area dataKey="speed">`).
 * @property powerValues the power column (web `<Area dataKey="power">`).
 * @property isEmpty the web `data.length > 0` boundary inverted — `true` ⇒ the empty surface.
 */
data class TripReplayChartsProjectionResult(
    val xLabels: List<String>,
    val cursorLabels: List<String>,
    val speedValues: List<Double?>,
    val powerValues: List<Double?>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart-data mapping
 * and its click/cursor seek math. Stateless and side-effect-free (the [Locale] is injected) so it is fully
 * covered by the off-device unit gate.
 */
object TripReplayChartsProjection {
    /**
     * Projects the loaded [points] into render-ready chart inputs, preserving the received order. Builds the
     * two value columns and the per-sample axis/cursor labels, and sets
     * [TripReplayChartsProjectionResult.isEmpty] for the web `data.length > 0` boundary (0 samples ⇒ the
     * empty surface).
     */
    fun project(
        points: List<TripReplayChartPoint>,
        locale: Locale = Locale.getDefault(),
    ): TripReplayChartsProjectionResult =
        TripReplayChartsProjectionResult(
            xLabels = points.map { TripReplayChartFormat.axisMinuteLabel(it.time, locale) },
            cursorLabels = points.map { TripReplayChartFormat.cursorMinuteLabel(it.time, locale) },
            speedValues = points.map { it.speed },
            powerValues = points.map { it.power },
            isEmpty = points.isEmpty(),
        )

    /** Whether the trace resolves to "no samples" (web `data.length > 0` is false). */
    fun isEmpty(points: List<TripReplayChartPoint>): Boolean = points.isEmpty()

    /**
     * Clamps the playhead [currentIndex] to a valid chart-array position, or `null` when there is nothing to
     * mark — the native analogue of the web `data[currentIndex]?.time` optional-chaining guard.
     */
    fun clampCursorIndex(
        currentIndex: Int,
        size: Int,
    ): Int? = if (size <= 0) null else currentIndex.coerceIn(0, size - 1)

    /**
     * Maps a horizontal tap/drag [fraction] (0..1 across the plot width) to the nearest chart-array index —
     * the native counterpart of recharts resolving a click x-position to `activeTooltipIndex`. An empty
     * series yields 0.
     */
    fun indexForFraction(
        size: Int,
        fraction: Float,
    ): Int {
        if (size <= 0) return 0
        return (fraction.coerceIn(0f, 1f) * (size - 1)).roundToInt()
    }

    /**
     * The positions-array index a tap at [fraction] should seek to — the web `onClick` →
     * `data[activeTooltipIndex].index`. Returns the sample's [TripReplayChartPoint.index] (not its
     * chart-array position) so a down-sampled trace seeks the right frame; `null` for an empty series.
     */
    fun seekTargetForFraction(
        points: List<TripReplayChartPoint>,
        fraction: Float,
    ): Int? {
        if (points.isEmpty()) return null
        return points[indexForFraction(points.size, fraction)].index
    }

    /**
     * Binary search for the sample whose `time` is closest to [target] — a verbatim port of the web
     * `nearestIndexByTime` (exported there for the same reason: the `ChartCursorBridge` converts the
     * persistent cursor's time value back to a chart-array index). On a tie the lower index wins, matching
     * the web `target - data[lo-1].time < data[lo].time - target` comparison.
     */
    fun nearestIndexByTime(
        points: List<TripReplayChartPoint>,
        target: Double,
    ): Int {
        if (points.isEmpty()) return 0
        var lo = 0
        var hi = points.size - 1
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (points[mid].time < target) lo = mid + 1 else hi = mid
        }
        return if (lo > 0 && target - points[lo - 1].time < points[lo].time - target) lo - 1 else lo
    }
}

/**
 * Locale-aware number formatting that reproduces the web `fmt` helper (web/src/components/charts) the chart
 * axis + tooltip use. Pure (JVM-tested): a non-finite value is coerced to `0` (the web `safeNumber`), and
 * grouping/precision follow `Intl.NumberFormat` with equal min/max fraction digits. The two label helpers
 * carry the web suffixes verbatim — the x-axis `${fmt(v,0)}m` and the tooltip `${fmt(v,1)} min`.
 */
object TripReplayChartFormat {
    /** Default fraction digits for the hover/cursor label (web `fmt(v, 1)`). */
    const val DEFAULT_PRECISION: Int = 1

    private const val MAX_PRECISION: Int = 20
    private const val AXIS_DECIMALS: Int = 0
    private const val CURSOR_DECIMALS: Int = 1
    private const val AXIS_SUFFIX: String = "m"
    private const val CURSOR_SUFFIX: String = " min"

    /** Web `fmt(v, decimals)` — `safeNumber` then locale grouping at [precision] fraction digits. */
    fun number(
        value: Double,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }

    /** The bottom-axis tick label — web `tickFormatter={(v) => `${fmt(v, 0)}m`}`. */
    fun axisMinuteLabel(
        time: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "${number(time, AXIS_DECIMALS, locale)}$AXIS_SUFFIX"

    /** The hover/playhead label — web `labelFormatter={(v) => `${fmt(v, 1)} min`}`. */
    fun cursorMinuteLabel(
        time: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "${number(time, CURSOR_DECIMALS, locale)}$CURSOR_SUFFIX"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TripReplayChartsRegistration.SLUG]
 * (P1/S11). Carries no drive/VIN data, so a diagnostics line can never leak the trip. Kept free of Compose
 * so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordTripReplayChartsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TripReplayChartsRegistration.SLUG))
}
