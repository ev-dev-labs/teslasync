// Pure, framework-free model + projection for the Drive Efficiency Chart dashboard widget — the
// native analogue of everything the web component computes (the `estimateEfficiency` /
// `buildDailyEfficiency` helpers and the `chartData` / `displayData` / `overallAvg` / `bestDay` /
// `trend` / `stats` `useMemo`s) before returning JSX
// (web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx). No Compose, no Android, no
// HTTP: every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DriveEfficiencyChartWidget — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package
// identifier), so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.dashboard.widgets.driveefficiencychart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

private const val EM_DASH = "\u2014"

/**
 * One projected, render-ready daily point — the native analogue of the web `DailyEfficiency` row.
 * Holds the date key (`YYYY-MM-DD`, UTC, the web `start_ts.slice(0, 10)`), the already-formatted x
 * [label], the daily-average [efficiency] and the [rollingAvg] overlay, both already converted to the
 * user's distance unit (Wh/km or Wh/mi) and rounded to one decimal. [rollingAvg] is `null` for the
 * first day (web: the rolling window needs ≥ 2 days), drawing a gap the chart connects across.
 */
data class DriveEfficiencyPoint(
    val date: String,
    val label: String,
    val efficiency: Double,
    val rollingAvg: Double?,
)

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` logic in the web source: compact (stats-only, no chart/title) requires BOTH
 * a single column AND a single row (web `size.cols <= 1 && size.rows <= 1`), and wide is three or more
 * columns (web `size.cols >= 3`, where the web widens the axis ticks).
 */
data class DriveEfficiencySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column AND row (web `isCompact`): show only the stat row, no chart or title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS && rows <= COMPACT_MAX_ROWS

    /** True at three or more columns (web `isWide`): wider axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val COMPACT_MAX_ROWS = 1
        private const val WIDE_MIN_COLS = 3

        /** The registry default footprint (2×4). */
        val Default: DriveEfficiencySize = DriveEfficiencySize(cols = 2, rows = 4)

        /** Minimum footprint (1×2) from the web registry. */
        val MinSize: DriveEfficiencySize = DriveEfficiencySize(cols = 1, rows = 2)

        /** Maximum footprint (4×40) from the web registry. */
        val MaxSize: DriveEfficiencySize = DriveEfficiencySize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: DriveEfficiencySize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: DriveEfficiencySize): DriveEfficiencySize =
            DriveEfficiencySize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class DriveEfficiencyStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized stat + series labels the projection folds into its output, resolved from the P1/S10
 * i18n catalog at the Compose boundary (`stringResource`) and passed in so
 * [DriveEfficiencyProjection.project] stays pure and JVM-testable. Keys mirror the web
 * `t('widget.driveEfficiencyChart.*')` calls verbatim. The title + "No efficiency data yet" empty
 * strings are render-only chrome (the projection never needs them) and are resolved directly in the
 * composable.
 */
data class DriveEfficiencyStrings(
    val avg: String,
    val best: String,
    val trend: String,
    val daily: String,
    val rolling: String,
)

/**
 * The fully projected, render-ready view of one drive list for one footprint — the native analogue of
 * everything the web component computes via `useMemo` (the `chartData` / `displayData` daily series,
 * the `overallAvg` / `bestDay` / `trend` rollups, and the `stats` row) before returning JSX. Pure data
 * so the projection is unit-tested without a Compose host.
 */
data class DriveEfficiencyDisplay(
    val points: List<DriveEfficiencyPoint>,
    val stats: List<DriveEfficiencyStat>,
    val isCompact: Boolean,
    val isWide: Boolean,
    val efficiencyUnit: String,
    val dailyLabel: String,
    val rollingLabel: String,
) {
    /** True when there is at least one daily point to chart (web `displayData.length === 0` empty gate). */
    val hasData: Boolean get() = points.isNotEmpty()
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts. A dashboard grid host binds this surface
 * with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object DriveEfficiencyRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "drive-efficiency-chart"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveEfficiencyChartWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Area chart of Wh/mi over last 30 days with rolling average overlay"

    /** Rolling-average window size in days (web `buildDailyEfficiency(recent, 7, …)`). */
    const val ROLLING_WINDOW: Int = 7

    /** Trailing window the chart covers, in days (web `cutoff.setDate(getDate() - 30)`). */
    const val WINDOW_DAYS: Int = 30

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: DriveEfficiencySize get() = DriveEfficiencySize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: DriveEfficiencySize get() = DriveEfficiencySize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: DriveEfficiencySize get() = DriveEfficiencySize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: DriveEfficiencySize): Boolean = DriveEfficiencySize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DriveEfficiencySize): DriveEfficiencySize = DriveEfficiencySize.clamp(size)
}

/**
 * Pure projection from the SI [Drive] rows to the display model — the native port of the
 * `estimateEfficiency` / `buildDailyEfficiency` helpers and the `chartData` / `displayData` /
 * `overallAvg` / `bestDay` / `trend` / `stats` `useMemo`s in the web source.
 *
 * Efficiency is computed in Wh/km from the SI fields (web computes Wh/km then converts), then
 * converted to the user's distance unit at projection time exactly as the web `displayData` memo does
 * (`× 1.609344` for miles), so the series + stats read Wh/mi for an imperial user and Wh/km otherwise.
 * Dates are grouped by the UTC calendar day (web `start_ts.slice(0, 10)`) and formatted month-short +
 * day-numeric (web `formatDateShort`). Every label is supplied already-localized.
 */
object DriveEfficiencyProjection {
    /** Minimum drive distance (km) that yields an efficiency sample (web `distanceKm < 0.8`). */
    const val MIN_DISTANCE_KM: Double = 0.8

    /** Lower plausibility bound for an accepted Wh/km sample (web `whPerKm < 30`). */
    const val MIN_WH_PER_KM: Double = 30.0

    /** Upper plausibility bound for an accepted Wh/km sample (web `whPerKm > 500`). */
    const val MAX_WH_PER_KM: Double = 500.0

    /** Km per mile — the web `× 1.609344` Wh/km → Wh/mi display factor. */
    const val KM_PER_MILE: Double = 1.609344

    /** Wh/mi unit token shown for an imperial user (web `'Wh/mi'`). */
    const val UNIT_WH_PER_MI: String = "Wh/mi"

    /** Wh/km unit token shown for a metric user (web `'Wh/km'`). */
    const val UNIT_WH_PER_KM: String = "Wh/km"

    private const val LABEL_PATTERN = "MMM d"
    private const val DATE_KEY_LENGTH = 10
    private const val MILLIS_PER_DAY = 86_400_000L
    private const val WH_PER_KWH = 1000.0
    private const val SOC_TO_KWH_PER_PERCENT = 0.75
    private const val ROUND_TO_ONE_DECIMAL = 10.0
    private const val MIN_ROLLING_WINDOW = 2
    private const val MIN_TREND_POINTS = 4
    private const val PERCENT = 100.0
    private const val STAT_DECIMALS = 0
    private const val TREND_DECIMALS = 1
    private const val HALF = 2

    /**
     * Estimate Wh/km for a single [drive] from its SI energy + distance — a verbatim port of the web
     * `estimateEfficiency`. Returns `null` for a drive too short to be meaningful (< [MIN_DISTANCE_KM]
     * km) or whose derived Wh/km is implausible (outside [MIN_WH_PER_KM]..[MAX_WH_PER_KM]). Prefers the
     * measured `energy_used_wh`; otherwise falls back to the battery-percentage delta (web
     * `start_soc_pct - end_soc_pct`, the SI [Drive.startBatteryPct] / [Drive.endBatteryPct]) times a
     * nominal pack size.
     */
    fun estimateEfficiencyWhPerKm(drive: Drive): Double? {
        val distanceKm = convertDistanceFromSI(drive.distanceM, DistanceUnitPref.KM)
        if (distanceKm < MIN_DISTANCE_KM) return null
        return acceptableWhPerKm(rawWhPerKm(drive, distanceKm))
    }

    /**
     * The unbounded Wh/km estimate: the measured `energy_used_wh / distanceKm` when energy is present
     * and positive (web's preferred branch), otherwise the battery-percentage fallback. `null` only
     * when neither source is derivable; range-rejection is applied by [acceptableWhPerKm].
     */
    private fun rawWhPerKm(
        drive: Drive,
        distanceKm: Double,
    ): Double? {
        val energy = drive.energyUsedWh
        if (energy != null && energy > 0.0) return energy / distanceKm
        return socFallbackWhPerKm(drive, distanceKm)
    }

    /**
     * The battery-percentage fallback Wh/km (web `(start_soc_pct - end_soc_pct) * 0.75 * 1000 /
     * distanceKm`), or `null` when either endpoint SoC is missing or the pack did not discharge.
     */
    private fun socFallbackWhPerKm(
        drive: Drive,
        distanceKm: Double,
    ): Double? {
        val startBatt = drive.startBatteryPct
        val endBatt = drive.endBatteryPct
        if (startBatt == null || endBatt == null) return null
        val battUsed = startBatt - endBatt
        return if (battUsed <= 0L) null else battUsed * SOC_TO_KWH_PER_PERCENT * WH_PER_KWH / distanceKm
    }

    /**
     * Group [drives] by UTC date, average each day's accepted Wh/km samples, and overlay a rolling
     * average over [windowSize] days — the native port of the web `buildDailyEfficiency`. The result
     * is ordered oldest-to-newest; values stay in Wh/km (display-unit conversion happens in [project]).
     * The rolling average is `null` until a day has at least [MIN_ROLLING_WINDOW] days of context.
     */
    fun buildDailyEfficiency(
        drives: List<Drive>,
        windowSize: Int,
        zone: ZoneId,
        locale: Locale,
    ): List<DriveEfficiencyPoint> {
        val formatter = DateTimeFormatter.ofPattern(LABEL_PATTERN, locale)
        val byDate = LinkedHashMap<String, MutableList<Double>>()
        for (drive in drives) {
            val eff = estimateEfficiencyWhPerKm(drive) ?: continue
            val dateKey = dateKeyOf(drive, zone)
            byDate.getOrPut(dateKey) { mutableListOf() }.add(eff)
        }

        val dailyAvgs =
            byDate.entries
                .sortedBy { it.key }
                .map { (date, values) -> date to values.average() }

        return dailyAvgs.mapIndexed { index, (date, avg) ->
            val windowStart = (index - windowSize + 1).coerceAtLeast(0)
            val window = dailyAvgs.subList(windowStart, index + 1)
            val rolling = if (window.size >= MIN_ROLLING_WINDOW) window.map { it.second }.average() else null
            DriveEfficiencyPoint(
                date = date,
                label = labelFor(date, formatter),
                efficiency = round1(avg),
                rollingAvg = rolling?.let { round1(it) },
            )
        }
    }

    /**
     * Project [drives] for [size] using [strings] for the stat labels, the [distanceUnit] for the
     * Wh/(km|mi) conversion + unit token, [nowMillis] as the 30-day-window anchor (injectable for
     * deterministic tests), and [zone]/[locale] for date keys + formatting. Filters to the trailing
     * [DriveEfficiencyRegistration.WINDOW_DAYS] days (web `cutoff`), builds the daily series, converts
     * each value to the display unit, and rolls up the Avg / Best day / Trend stats.
     */
    @Suppress("LongParameterList")
    fun project(
        drives: List<Drive>,
        size: DriveEfficiencySize,
        strings: DriveEfficiencyStrings,
        distanceUnit: DistanceUnitPref,
        nowMillis: Long = System.currentTimeMillis(),
        zone: ZoneId = ZoneOffset.UTC,
        locale: Locale = Locale.getDefault(),
    ): DriveEfficiencyDisplay {
        val cutoff = nowMillis - DriveEfficiencyRegistration.WINDOW_DAYS * MILLIS_PER_DAY
        val recent = drives.filter { it.startTs.toEpochMilliseconds() >= cutoff }
        val daily = buildDailyEfficiency(recent, DriveEfficiencyRegistration.ROLLING_WINDOW, zone, locale)

        val isMiles = distanceUnit == DistanceUnitPref.MI
        val factor = if (isMiles) KM_PER_MILE else 1.0
        val display =
            daily.map { point ->
                point.copy(
                    efficiency = round1(point.efficiency * factor),
                    rollingAvg = point.rollingAvg?.let { round1(it * factor) },
                )
            }
        val efficiencyUnit = if (isMiles) UNIT_WH_PER_MI else UNIT_WH_PER_KM

        return DriveEfficiencyDisplay(
            points = display,
            stats = stats(display, strings, efficiencyUnit, locale),
            isCompact = size.isCompact,
            isWide = size.isWide,
            efficiencyUnit = efficiencyUnit,
            dailyLabel = strings.daily,
            rollingLabel = strings.rolling,
        )
    }

    /** The mean daily efficiency (web `overallAvg`), one-decimal rounded, or `null` for no points. */
    fun overallAvg(points: List<DriveEfficiencyPoint>): Double? =
        if (points.isEmpty()) null else round1(points.sumOf { it.efficiency } / points.size)

    /** The most-efficient (lowest Wh/distance) day (web `bestDay`), or `null` for no points. */
    fun bestDay(points: List<DriveEfficiencyPoint>): Double? = points.minOfOrNull { it.efficiency }

    /**
     * The percent change between the first and second half of the series (web `trend`), one-decimal
     * rounded, or `null` when there are fewer than [MIN_TREND_POINTS] points to compare.
     */
    fun trend(points: List<DriveEfficiencyPoint>): Double? {
        if (points.size < MIN_TREND_POINTS) return null
        val mid = points.size / HALF
        val first = points.subList(0, mid)
        val second = points.subList(mid, points.size)
        val avgFirst = first.sumOf { it.efficiency } / first.size
        val avgSecond = second.sumOf { it.efficiency } / second.size
        return if (avgFirst == 0.0) null else round1((avgSecond - avgFirst) / avgFirst * PERCENT)
    }

    private fun stats(
        points: List<DriveEfficiencyPoint>,
        strings: DriveEfficiencyStrings,
        efficiencyUnit: String,
        locale: Locale,
    ): List<DriveEfficiencyStat> {
        val avg = overallAvg(points)
        val best = bestDay(points)
        val trend = trend(points)
        return listOf(
            DriveEfficiencyStat(
                label = strings.avg,
                value = if (avg != null) ChartFormat.number(avg, STAT_DECIMALS, locale) else EM_DASH,
                unit = efficiencyUnit,
            ),
            DriveEfficiencyStat(
                label = strings.best,
                value = if (best != null) ChartFormat.number(best, STAT_DECIMALS, locale) else EM_DASH,
                unit = efficiencyUnit,
            ),
            DriveEfficiencyStat(
                label = strings.trend,
                value = if (trend != null) formatTrend(trend, locale) else EM_DASH,
                unit = null,
            ),
        )
    }

    /** Renders a percent change like the web `${trend > 0 ? '+' : ''}${trend}%`: a `+` only for gains. */
    private fun formatTrend(
        trend: Double,
        locale: Locale,
    ): String {
        val body =
            if (trend == floor(trend)) {
                trend.toLong().toString()
            } else {
                String.format(locale, "%.${TREND_DECIMALS}f", trend)
            }
        val sign = if (trend > 0.0) "+" else ""
        return "$sign$body%"
    }

    private fun acceptableWhPerKm(whPerKm: Double?): Double? =
        if (whPerKm == null || whPerKm < MIN_WH_PER_KM || whPerKm > MAX_WH_PER_KM) null else whPerKm

    private fun dateKeyOf(
        drive: Drive,
        zone: ZoneId,
    ): String =
        Instant
            .ofEpochMilli(drive.startTs.toEpochMilliseconds())
            .atZone(zone)
            .toLocalDate()
            .toString()
            .take(DATE_KEY_LENGTH)

    private fun labelFor(
        dateKey: String,
        formatter: DateTimeFormatter,
    ): String = runCatching { LocalDate.parse(dateKey).format(formatter) }.getOrNull() ?: dateKey

    private fun round1(value: Double): Double = (value * ROUND_TO_ONE_DECIMAL).roundToLong() / ROUND_TO_ONE_DECIMAL
}
