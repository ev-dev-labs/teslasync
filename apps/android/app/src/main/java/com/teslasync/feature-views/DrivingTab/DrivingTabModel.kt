// Pure, framework-free model + projections for the Driving analytics tab feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/DrivingTab.tsx). No Compose, no Android, no HTTP:
// every declaration here runs in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is presentational over a `FleetAnalytics["drive_analytics"]` prop its parent loads.
// This file owns the parts the web render derives from that prop: the per-chart series + axis labels
// (web `<XAxis tickFormatter>` / `<Bar dataKey>` / `<Line dataKey>`), the `safe()` finite-or-zero guard
// (web `chartUtils.safe`), the efficiency-trend filter (web `dailyTrend.filter(d => safe(d.efficiency) > 0)`),
// and the temperature-vs-efficiency scatter geometry — the only chart that converts at the display
// boundary (web maps `{ temp: convertTempFromSI, efficiency: ×KM_PER_MILE when miles, distance:
// convertDistanceFromSI(km × 1000) }`). Every other chart plots the backend value verbatim, exactly as the
// web source does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DrivingTab — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtab

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import kotlin.math.sqrt

/** 1 mile = 1.609344 km exactly — the web `KM_PER_MILE` used to rescale Wh/km efficiency to Wh/mi. */
internal const val KM_PER_MILE: Double = 1.609344

/** 1 km = 1000 m exactly — the web scatter multiplies its `km` distance by 1000 before converting from SI. */
private const val METERS_PER_KM: Double = 1000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DrivingTabRegistration {
    /** Stable surface id. */
    const val ID: String = "driving-tab"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DrivingTab"
}

/**
 * One labelled count bucket — the native mirror of the web `{ range: string; count: number }` rows that
 * back the speed / trip-distance / drive-duration distribution bar charts. [count] is a non-negative
 * integer tally, so `Long`.
 */
data class DistributionBucket(
    val range: String,
    val count: Long,
)

/**
 * One hour-of-day tally — the native mirror of the web `hourly_pattern` row
 * (`{ hour: number; drives: number; distance: number }`). [hour] is 0..23, [drives] a count, and
 * [distance] the summed distance the backend already serves in the display domain (plotted verbatim,
 * like the web `<Line dataKey="distance" />`).
 */
data class HourlyDrivePoint(
    val hour: Int,
    val drives: Long,
    val distance: Double,
)

/**
 * One temperature/efficiency observation — the native mirror of the web `temp_vs_efficiency` row
 * (`{ temp: number; efficiency: number; distance: number }`). The backend serves this row in mixed units:
 * [temp] in °C, [efficiency] in Wh/km and [distance] in km (see the web boundary comment). The
 * [DrivingScatter] projection is the single place those are converted for display.
 */
data class TempEfficiencySample(
    val temp: Double,
    val efficiency: Double,
    val distance: Double,
)

/**
 * One day's driving tally — the native mirror of the web `daily_trend` row
 * (`{ date: string; drives: number; distance: number; efficiency?: number }`). [efficiency] is nullable
 * (the web field is optional) and drives both the daily-trend chart and, when positive, the efficiency
 * trend chart.
 */
data class DailyDrivePoint(
    val date: String,
    val drives: Long,
    val distance: Double,
    val efficiency: Double?,
)

/**
 * The render-ready projection of `FleetAnalytics["drive_analytics"]` this surface consumes — the six
 * series the web `DrivingTab` reads (`da?.speed_distribution ?? []`, etc.). The host loads the feed and
 * supplies it through the shared P1/S8 state-holder as a `UiState<DrivingAnalytics>`; this view never
 * fetches. The two web sibling sub-components (`DrivingPerformanceCards`, `DrivingTemperatureStats`) are
 * separate surfaces with their own prompts and are out of scope here.
 */
data class DrivingAnalytics(
    val speedDistribution: List<DistributionBucket> = emptyList(),
    val distanceDistribution: List<DistributionBucket> = emptyList(),
    val hourlyPattern: List<HourlyDrivePoint> = emptyList(),
    val tempVsEfficiency: List<TempEfficiencySample> = emptyList(),
    val dailyTrend: List<DailyDrivePoint> = emptyList(),
    val durationDistribution: List<DistributionBucket> = emptyList(),
) {
    /** True when every series is empty — the whole tab resolves to per-section empty states. */
    val isEmpty: Boolean
        get() =
            listOf(
                speedDistribution,
                distanceDistribution,
                hourlyPattern,
                tempVsEfficiency,
                dailyTrend,
                durationDistribution,
            ).all { it.isEmpty() }

    companion object {
        /** The all-empty value rendered when the feed has resolved with no rows. */
        val EMPTY: DrivingAnalytics = DrivingAnalytics()
    }
}

/**
 * The pure series + axis-label projections the composable renders — the native mirror of the web
 * component's chart data mapping. Stateless and side-effect-free so the off-device unit gate covers them.
 */
object DrivingProjection {
    /** Length of the `YYYY-` date prefix the web `tickFormatter={(v) => v.slice(5)}` strips. */
    private const val DATE_PREFIX_LENGTH = 5

    /** Finite-or-zero guard — the native mirror of the web `safe` helper (`isFinite(v) ? v : 0`). */
    fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

    /** Bar Y values — each bucket's integer count widened to the chart series' Double type (`+ 0.0`). */
    fun counts(buckets: List<DistributionBucket>): List<Double> = buckets.map { it.count + 0.0 }

    /** Bar X categories — the web `<XAxis dataKey="range" />`. */
    fun ranges(buckets: List<DistributionBucket>): List<String> = buckets.map { it.range }

    /** Hour-of-day label — the web `tickFormatter={(h) => "${h}:00"}`. */
    fun hourLabel(hour: Int): String = "$hour:00"

    /** X categories for the hourly chart. */
    fun hourLabels(points: List<HourlyDrivePoint>): List<String> = points.map { hourLabel(it.hour) }

    /** Hourly drives bar values. */
    fun drivesValues(points: List<HourlyDrivePoint>): List<Double> = points.map { it.drives + 0.0 }

    /** Hourly distance line values (plotted verbatim, like the web). */
    fun hourlyDistanceValues(points: List<HourlyDrivePoint>): List<Double> = points.map { safe(it.distance) }

    /** Short month-day date — the web `v.slice(5)` (`2026-04-04` -> `04-04`). */
    fun shortDate(date: String): String = if (date.length > DATE_PREFIX_LENGTH) date.substring(DATE_PREFIX_LENGTH) else date

    /** X categories for the daily / efficiency-trend charts. */
    fun shortDates(points: List<DailyDrivePoint>): List<String> = points.map { shortDate(it.date) }

    /** Daily distance area values. */
    fun dailyDistanceValues(points: List<DailyDrivePoint>): List<Double> = points.map { safe(it.distance) }

    /** Daily drives line values. */
    fun dailyDrivesValues(points: List<DailyDrivePoint>): List<Double> = points.map { it.drives + 0.0 }

    /** Efficiency-trend rows — the web `dailyTrend.filter(d => safe(d.efficiency) > 0)`. */
    fun efficiencyTrend(points: List<DailyDrivePoint>): List<DailyDrivePoint> = points.filter { safe(it.efficiency) > 0.0 }

    /** Efficiency-trend Y values. */
    fun efficiencyValues(points: List<DailyDrivePoint>): List<Double> = points.map { safe(it.efficiency) }

    /**
     * Efficiency display unit symbol — the web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. Derived from the
     * distance unit's own label (a unit symbol, not translatable prose), so no English literal is hardcoded.
     */
    fun efficiencyUnitLabel(distance: DistanceUnitPref): String = "Wh/${distance.label}"
}

/** A projected scatter point in display units — converted temperature [x], efficiency [y] and bubble [size]. */
data class ScatterPoint(
    val x: Double,
    val y: Double,
    val size: Double,
)

/**
 * The fully projected temperature-vs-efficiency scatter — render-ready display-unit [points] plus the
 * per-axis bounds the view normalizes against (the web `<XAxis type="number" />` / `<YAxis type="number" />`
 * auto-domains and the `<ZAxis range>` bubble scale). Pure data so the off-device gate covers the mapping.
 */
data class ScatterProjection(
    val points: List<ScatterPoint>,
    val xMin: Double,
    val xMax: Double,
    val yMin: Double,
    val yMax: Double,
    val sizeMin: Double,
    val sizeMax: Double,
) {
    /** True when there are no observations — the view shows the empty state. */
    val isEmpty: Boolean get() = points.isEmpty()
}

/**
 * The pure temperature-vs-efficiency scatter geometry — the only chart in this surface that converts at the
 * display boundary, reproducing the web `<Scatter data={tempEff.map(...)} />` mapping exactly. Separated
 * from the composable so the conversions and the normalization math are unit-tested off-device.
 */
object DrivingScatter {
    /**
     * Projects the backend [samples] (°C, Wh/km, km) into display-unit points: temperature via
     * [convertTempFromSI], efficiency rescaled to Wh/mi (× [KM_PER_MILE]) when [distance] is miles, and the
     * km bubble distance via [convertDistanceFromSI] of `km × 1000`. Order is preserved; empty input yields a
     * zero-bounds, empty projection.
     */
    fun project(
        samples: List<TempEfficiencySample>,
        distance: DistanceUnitPref,
        temperature: TemperatureUnitPref,
    ): ScatterProjection {
        val points =
            samples.map { sample ->
                val efficiencyWhPerKm = DrivingProjection.safe(sample.efficiency)
                ScatterPoint(
                    x = convertTempFromSI(DrivingProjection.safe(sample.temp), temperature),
                    y = if (distance == DistanceUnitPref.MI) efficiencyWhPerKm * KM_PER_MILE else efficiencyWhPerKm,
                    size = convertDistanceFromSI(DrivingProjection.safe(sample.distance) * METERS_PER_KM, distance),
                )
            }
        if (points.isEmpty()) {
            return ScatterProjection(points, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        }
        return ScatterProjection(
            points = points,
            xMin = points.minOf { it.x },
            xMax = points.maxOf { it.x },
            yMin = points.minOf { it.y },
            yMax = points.maxOf { it.y },
            sizeMin = points.minOf { it.size },
            sizeMax = points.maxOf { it.size },
        )
    }

    /** Maps [value] into the unit interval against [min]..[max]; a degenerate range centers at 0.5. */
    fun normalize(
        value: Double,
        min: Double,
        max: Double,
    ): Double {
        if (max <= min) return 0.5
        return ((value - min) / (max - min)).coerceIn(0.0, 1.0)
    }

    /**
     * The radius scale factor in [0, 1] for a bubble of [size] — `sqrt` of the normalized size so the bubble
     * AREA scales with the value, matching the web `<ZAxis range={[30, 300]} />` area-based bubble sizing.
     */
    fun radiusFraction(
        size: Double,
        min: Double,
        max: Double,
    ): Double = sqrt(normalize(size, min, max))
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DrivingTabRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordDrivingTabOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DrivingTabRegistration.SLUG))
}
