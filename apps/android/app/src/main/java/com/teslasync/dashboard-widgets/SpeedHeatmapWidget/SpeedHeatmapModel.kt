// Pure, framework-free model + projection for the Speed Heatmap dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx): the 7 (Mon–Sun) × 24 (0h–23h)
// `buildHeatmap` grid of per-cell average speeds, the `maxSpeed` / `totalDrives` reductions, the cool→hot
// `speedToColor` 4-stop gradient (teal→cyan→amber→red), the `isCompact`/`isWide` layout branches, and the
// `{n} drives` / `Peak avg {speed} {unit}` summary. No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer. Each drive arrives as the generated SI DTO [Drive]; this file owns the display-boundary speed
// conversion (Phase-48 SI-canonical rule; web `useUnits` + `convertSpeedFromSI`). Drive start times are
// bucketed into the device-local day-of-week + hour via an injected [java.time.ZoneId] so the projection
// stays deterministic in tests (the web `new Date(start_ts).getDay()/getHours()` reads device-local time).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SpeedHeatmapWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling PositionHeatmapWidget /
// RecentDrivesWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.speedheatmap

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.time.Instant
import java.time.ZoneId
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToInt

/** 7 rows: Mon … Sun (web `ROWS`). */
internal const val ROWS = 7

/** 24 columns: 0h … 23h (web `COLS`). */
internal const val COLS = 24

/** Em dash shown for the compact peak metric when no drive resolved (web `'—'`). */
internal const val EM_DASH = "\u2014"

/** Most-recent drives folded into the grid, matching the web query's `&limit=200`. */
private const val DRIVE_LIMIT = 200

/** Largest column index for the compact footprint (web `isCompact = size.cols <= 1`). */
private const val COMPACT_MAX_COLS = 1

/** Smallest column index for the wide footprint (web `isWide = size.cols >= 3`). */
private const val WIDE_MIN_COLS = 3

// Cool→hot 4-stop gradient (web `COLOR_STOPS`): teal-500 → cyan-500 → amber-500 → red-500.
private val COLOR_STOPS: List<Triple<Int, Int, Int>> =
    listOf(
        Triple(20, 184, 166),
        Triple(6, 182, 212),
        Triple(245, 158, 11),
        Triple(239, 68, 68),
    )

// Legend swatch positions across the ramp (web `[0, 0.25, 0.5, 0.75, 1]`).
private val LEGEND_STOPS: List<Double> = listOf(0.0, 0.25, 0.5, 0.75, 1.0)

// Day labels: single-letter for the standard footprint, full names for the wide footprint (web arrays).
private val DAY_LABELS_SHORT = listOf("M", "T", "W", "T", "F", "S", "S")
private val DAY_LABELS_FULL = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

// Hour ticks: every 6h for the standard footprint, every 3h for the wide footprint (web `hourLabels`).
private val HOUR_LABELS_STANDARD = listOf(0, 6, 12, 18)
private val HOUR_LABELS_WIDE = listOf(0, 3, 6, 9, 12, 15, 18, 21)

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` branches: a single column shows only the centered peak-speed metric, three+
 * columns reveal the full day names + denser hour ticks.
 */
data class SpeedHeatmapSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): centered peak metric, no grid. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three+ columns (web `isWide = size.cols >= 3`): full day names + denser hour ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        /** Registry default footprint (2×4). */
        val Default: SpeedHeatmapSize = SpeedHeatmapSize(cols = 2, rows = 4)

        /** Registry minimum footprint (1×4). */
        val MinSize: SpeedHeatmapSize = SpeedHeatmapSize(cols = 1, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: SpeedHeatmapSize = SpeedHeatmapSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: SpeedHeatmapSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: SpeedHeatmapSize): SpeedHeatmapSize =
            SpeedHeatmapSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`speed-heatmap`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object SpeedHeatmapRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "speed-heatmap"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SpeedHeatmapWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: SpeedHeatmapSize get() = SpeedHeatmapSize.Default

    /** Minimum footprint: 1 column × 4 rows. */
    val minSize: SpeedHeatmapSize get() = SpeedHeatmapSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: SpeedHeatmapSize get() = SpeedHeatmapSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: SpeedHeatmapSize): Boolean = SpeedHeatmapSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SpeedHeatmapSize): SpeedHeatmapSize = SpeedHeatmapSize.clamp(size)
}

/**
 * The cool→hot fill for one cell / legend swatch (web `speedToColor`). [filled] is `false` for a bucket
 * with no drives (web `'rgba(255,255,255,0.03)'` faint empty fill); the composable then paints a faint
 * theme-token wash so light/dark themes both stay legible, instead of a hard-coded white.
 */
data class HeatPaint(
    val filled: Boolean,
    val red: Int,
    val green: Int,
    val blue: Int,
)

/**
 * One render-ready heatmap cell — the native mirror of the web `HeatCell` folded together with its
 * `speedToColor` fill. [avgSpeed] is in the user's display unit; [count] is the number of drives that
 * started in this day/hour bucket; [paint] is the precomputed gradient fill.
 */
data class HeatCellView(
    val day: Int,
    val hour: Int,
    val avgSpeed: Double,
    val count: Int,
    val paint: HeatPaint,
)

/**
 * The localized strings + locale-aware number formatter the projection folds into its output, resolved
 * from the P1/S10 i18n catalog at the Compose boundary (`stringResource`) and passed in so
 * [SpeedHeatmapProjection.project] stays pure and JVM-testable. The keys mirror the web
 * `t('widget.speedHeatmap.*')` calls verbatim; [drivesSummary] / [peakSpeedSummary] apply the
 * `{{count}}` / `{{speed}} {{unit}}` interpolations, and [formatSpeed] bakes the locale grouping into the
 * speed number rendering (web `fmtNumber(..., 0)`).
 */
data class SpeedHeatmapStrings(
    val title: String,
    val peakLabel: String,
    val slow: String,
    val fast: String,
    val empty: String,
    val drivesSummary: (Int) -> String,
    val peakSpeedSummary: (speed: String, unit: String) -> String,
    val formatSpeed: (Double) -> String,
)

/**
 * The fully projected, render-ready view of one drive response for one footprint — the native analogue
 * of everything the web component computes before returning JSX (the `buildHeatmap` grid, the
 * `maxSpeed` / `totalDrives` reductions, the `isCompact`/`isWide` layout branches, the legend swatches,
 * and the `{n} drives` / `Peak avg {speed} {unit}` microcopy). Pure data so the projection is unit-tested
 * without a UI host.
 *
 * @property hasData whether any drive contributed to the grid (web `totalDrives > 0`); `false` surfaces
 *   the "No drive data yet" empty state on the standard/wide footprint.
 * @property cells the 168 render-ready cells in row-major (day-then-hour) order.
 * @property legend the five cool→hot legend swatches (web `[0, .25, .5, .75, 1]` ramp samples).
 * @property heatmapContentDescription the TalkBack name announced for the opaque grid node.
 */
data class SpeedHeatmapDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val showTitle: Boolean,
    val hasData: Boolean,
    val totalDrives: Int,
    val maxSpeed: Double,
    val cells: List<HeatCellView>,
    val dayLabels: List<String>,
    val hourLabels: List<Int>,
    val legend: List<HeatPaint>,
    val title: String,
    val peakValueText: String,
    val peakLabelText: String,
    val drivesSummaryText: String,
    val peakSpeedSummaryText: String,
    val slowText: String,
    val fastText: String,
    val emptyText: String,
    val heatmapContentDescription: String,
)

/** A drive contributes to the grid only when it has a positive speed (web `if (speed == null || speed <= 0) continue`). */
fun hasRenderableSpeed(drive: Drive): Boolean {
    val speed = drive.avgSpeedMps ?: drive.maxSpeedMps ?: return false
    return speed > 0.0
}

/**
 * Pure projection from a decoded list of [Drive] to the render-ready [SpeedHeatmapDisplay] — the native
 * port of the web component's `buildHeatmap` / `maxSpeed` / `totalDrives` derivations and the
 * `speedToColor` ramp. SI metres-per-second are converted to the user's display unit at this boundary
 * (web `convertSpeedFromSI`); start times are bucketed into the device-local day/hour via [zone].
 */
object SpeedHeatmapProjection {
    /** Mutable running accumulator for one day/hour bucket — sum of SI speeds + the contributing count. */
    private class Bucket(
        var totalMps: Double = 0.0,
        var count: Int = 0,
    )

    /**
     * Project [drives] for [size] using the user's display [prefs] (speed unit), the localized [strings],
     * and the device-local [zone] for day/hour bucketing. An empty list — or a list whose drives all lack
     * a positive speed — yields no contributing cells and surfaces the empty state, while the colour ramp
     * and the `{n} drives` / `Peak avg …` summary are reproduced exactly.
     */
    fun project(
        drives: List<Drive>,
        prefs: UnitPref,
        strings: SpeedHeatmapStrings,
        size: SpeedHeatmapSize,
        zone: ZoneId,
    ): SpeedHeatmapDisplay {
        val grid = accumulate(drives, zone)
        val avg = averageSpeeds(grid, prefs.speed)
        val maxSpeed = avg.maxOf { row -> row.maxOrNull() ?: 0.0 }
        val totalDrives = grid.sumOf { row -> row.sumOf { it.count } }
        val cells = buildCells(grid, avg, maxSpeed)
        val hasData = totalDrives > 0
        val unit = prefs.speed.label
        val peakText = strings.formatSpeed(maxSpeed)
        val drivesSummary = strings.drivesSummary(totalDrives)
        val peakSummary = strings.peakSpeedSummary(peakText, unit)
        return SpeedHeatmapDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            showTitle = !size.isCompact,
            hasData = hasData,
            totalDrives = totalDrives,
            maxSpeed = maxSpeed,
            cells = cells,
            dayLabels = if (size.isWide) DAY_LABELS_FULL else DAY_LABELS_SHORT,
            hourLabels = if (size.isWide) HOUR_LABELS_WIDE else HOUR_LABELS_STANDARD,
            legend = buildLegend(maxSpeed),
            title = strings.title,
            peakValueText = if (maxSpeed > 0.0) peakText else EM_DASH,
            peakLabelText = "${strings.peakLabel} $unit",
            drivesSummaryText = drivesSummary,
            peakSpeedSummaryText = peakSummary,
            slowText = strings.slow,
            fastText = strings.fast,
            emptyText = strings.empty,
            heatmapContentDescription = if (hasData) "${strings.title}, $drivesSummary, $peakSummary" else strings.empty,
        )
    }

    /**
     * Bucket the most-recent [DRIVE_LIMIT] drives into the 7×24 grid by device-local day-of-week +
     * hour-of-day, summing SI speed (web `buildHeatmap`). A drive with no positive speed is skipped
     * ([hasRenderableSpeed]); `java.time` `DayOfWeek` (Mon=1 … Sun=7) maps to the web's Mon=0 … Sun=6.
     */
    private fun accumulate(
        drives: List<Drive>,
        zone: ZoneId,
    ): Array<Array<Bucket>> {
        val grid = Array(ROWS) { Array(COLS) { Bucket() } }
        drives
            .sortedByDescending { it.startTs }
            .take(DRIVE_LIMIT)
            .forEach { drive ->
                val speed = drive.avgSpeedMps ?: drive.maxSpeedMps ?: return@forEach
                if (speed <= 0.0) return@forEach
                val local = Instant.ofEpochMilli(drive.startTs.toEpochMilliseconds()).atZone(zone)
                val day = local.dayOfWeek.value - 1
                val hour = local.hour
                grid[day][hour].totalMps += speed
                grid[day][hour].count += 1
            }
        return grid
    }

    /** The per-cell average speed in the user's display unit (web `convertSpeedFromSI(total / count, …)`). */
    private fun averageSpeeds(
        grid: Array<Array<Bucket>>,
        unit: SpeedUnitPref,
    ): Array<DoubleArray> =
        Array(ROWS) { day ->
            DoubleArray(COLS) { hour ->
                val bucket = grid[day][hour]
                if (bucket.count > 0) convertSpeedFromSI(bucket.totalMps / bucket.count, unit) else 0.0
            }
        }

    /** Fold the accumulated grid + per-cell averages into render-ready [HeatCellView]s (row-major). */
    private fun buildCells(
        grid: Array<Array<Bucket>>,
        avg: Array<DoubleArray>,
        maxSpeed: Double,
    ): List<HeatCellView> =
        buildList(ROWS * COLS) {
            for (day in 0 until ROWS) {
                for (hour in 0 until COLS) {
                    val speed = avg[day][hour]
                    add(
                        HeatCellView(
                            day = day,
                            hour = hour,
                            avgSpeed = speed,
                            count = grid[day][hour].count,
                            paint = speedToColor(speed, maxSpeed),
                        ),
                    )
                }
            }
        }

    /** The five legend swatches sampled across the ramp (web `[0, .25, .5, .75, 1].map(speedToColor)`). */
    private fun buildLegend(maxSpeed: Double): List<HeatPaint> {
        val base = if (maxSpeed > 0.0) maxSpeed else 1.0
        return LEGEND_STOPS.map { stop -> speedToColor(stop * base, base) }
    }

    /**
     * Map a speed (in display units) onto the cool→hot 4-stop ramp — the verbatim native port of the web
     * `speedToColor`: a non-positive speed (or max) is the faint empty fill; otherwise the normalised
     * `t = min(speed / max, 1)` is interpolated across the three gradient segments.
     */
    fun speedToColor(
        speed: Double,
        maxSpeed: Double,
    ): HeatPaint {
        if (speed <= 0.0 || maxSpeed <= 0.0) return HeatPaint(filled = false, red = 0, green = 0, blue = 0)
        val t = min(speed / maxSpeed, 1.0)
        val segCount = COLOR_STOPS.size - 1
        val seg = min(floor(t * segCount).toInt(), segCount - 1)
        val localT = t * segCount - seg
        val (red, green, blue) = lerp(COLOR_STOPS[seg], COLOR_STOPS[seg + 1], localT)
        return HeatPaint(filled = true, red = red, green = green, blue = blue)
    }

    /** Linear RGB interpolation between two ramp stops, rounded per channel (web `lerpColor` + `Math.round`). */
    private fun lerp(
        a: Triple<Int, Int, Int>,
        b: Triple<Int, Int, Int>,
        t: Double,
    ): Triple<Int, Int, Int> =
        Triple(
            (a.first + (b.first - a.first) * t).roundToInt(),
            (a.second + (b.second - a.second) * t).roundToInt(),
            (a.third + (b.third - a.third) * t).roundToInt(),
        )
}
