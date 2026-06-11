// Pure, framework-free model + projection for the Year in Review dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/YearReviewWidget.tsx). No Compose, no Android, no HTTP: every type
// here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The annual recap feed arrives as raw SI JSON (`GET /analytics/year-review`), so this file
// owns the decode (web optional-chaining → null-safe reads), the busiest-month derivation (web `reduce`
// over `monthly_stats`), and the display-boundary distance + speed conversion (Phase-48 SI-canonical
// rule; web `useUnits`).
//
// Distance/speed parity note (intentional, non-silent divergence — see [YearReviewProjection]): the web
// source converts `total_distance_km * KM_TO_MI` (and `fastest_speed_kmh * KM_TO_MI`) through a
// metre/(m·s⁻¹)-expecting converter, which under-reports the figures. The native bridges SI first
// (km → m, km/h → m/s) and then converts to the user's unit via the shared converters — the
// mathematically-correct conversion the web arithmetic approximates, matching the sibling
// `LifetimeStatsWidget`. Projection tests pin both results.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/YearReviewWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.yearreview

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Em dash shown for an unknown busiest month (web `?? '—'`). */
private const val EM_DASH = "\u2014"

/** 1 km = 1000 m — the SI bridge the distance conversion floors on (see the parity note above). */
private const val METERS_PER_KM = 1000.0

/** 3600 s = 1 h — the SI bridge km/h → m/s floors on before the speed conversion. */
private const val SECONDS_PER_HOUR = 3600.0

/** 60 min = 1 h — the driving-time roll-up divisor (web `total_driving_minutes / 60`). */
private const val MINUTES_PER_HOUR = 60.0

/** Hard-coded display units the web reads as literals (`unit: 'kWh'` / `'kg'` / `'h'`), never i18n. */
private const val ENERGY_UNIT = "kWh"
private const val CO2_UNIT = "kg"
private const val HOURS_UNIT = "h"

/** Per-metric fraction digits (web `fmtNumber(value, n)` / `fmtInt`). */
private const val DISTANCE_DECIMALS = 0
private const val COUNT_DECIMALS = 0
private const val ENERGY_DECIMALS = 1
private const val CO2_DECIMALS = 0
private const val LONGEST_DRIVE_DECIMALS = 1
private const val DRIVING_TIME_DECIMALS = 0
private const val SPEED_DECIMALS = 0

/** The single column count at/above which the wide 4-up stat grid is drawn (web `size.cols >= 3`). */
private const val WIDE_COLS = 3

/** Abbreviated month labels indexed 0=Jan … 11=Dec (web `MONTH_NAMES`). */
private val MONTH_NAMES =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test (the single big-number hero) and [isWide]
 * the web `size.cols >= 3` test (the 4-up stat grid that folds in driving time + top speed). The registry
 * pins a minimum of two columns, so [isCompact] is only reachable when a host clamps below the minimum;
 * the branch is preserved for full web parity.
 */
data class YearReviewSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact`): render the compact year-distance hero. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three or more columns (web `isWide`): render the 4-up grid with driving time + top speed. */
    val isWide: Boolean get() = cols >= WIDE_COLS
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`year-review`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object YearReviewRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "year-review"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "YearReviewWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = YearReviewSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize = YearReviewSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = YearReviewSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: YearReviewSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: YearReviewSize): YearReviewSize =
        YearReviewSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The leading glyph a stat tile shows — a pure enum so the projection stays framework-free; the composable
 * maps each case onto a curated [androidx.compose.ui.graphics.vector.ImageVector] (the native analogue of
 * the web lucide icons `Route` / `Car` / `Zap` / `Leaf` / `Star` / `TrendingUp` / `Timer`).
 */
enum class YearReviewStatIcon { Distance, Drives, Energy, Co2, BestMonth, LongestDrive, DrivingTime, TopSpeed }

/**
 * One projected, render-ready stat tile — the native analogue of a web `StatGridItem`. Carries the
 * resolved [label], the already-formatted [value], an optional [unit] suffix, and the leading [icon].
 */
data class YearReviewStatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: YearReviewStatIcon,
)

/** One `monthly_stats` row the busiest-month derivation reads (web `{month, drives}`). */
data class YearReviewMonthStat(
    val month: Int,
    val drives: Double,
)

/**
 * The decoded `/analytics/year-review` payload — the native analogue of the fields the web component reads
 * off `YearReview` (`total_drives`, `total_distance_km`, `total_energy_kwh`, `co2_offset_kg`,
 * `total_driving_minutes`, `fastest_speed_kmh`, `longest_drive.distance_km`, `monthly_stats`). All numerics
 * are SI/raw on the wire; conversion to display units happens in [YearReviewProjection]. Missing/absent
 * fields collapse to zero, exactly like the web optional-chaining (`?? 0`).
 */
data class YearReviewData(
    val totalDrives: Double,
    val totalDistanceKm: Double,
    val totalEnergyKwh: Double,
    val co2OffsetKg: Double,
    val totalDrivingMinutes: Double,
    val fastestSpeedKmh: Double,
    val longestDriveKm: Double,
    val monthlyStats: List<YearReviewMonthStat>,
)

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the
 * `/settings` document: the [distanceUnit] (total + longest-drive distances) and the [speedUnit] (top
 * speed). Year in Review uses fixed per-metric decimals (web `fmtNumber(v, 0|1)`), so unlike the sibling
 * lifetime surface it carries no currency / precision preference.
 */
data class YearReviewDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val speedUnit: SpeedUnitPref,
) {
    companion object {
        /** Metric (km + km/h) defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT = YearReviewDisplayPrefs(DistanceUnitPref.KM, SpeedUnitPref.KMH)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): YearReviewDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return YearReviewDisplayPrefs(distanceUnit = unit.distance, speedUnit = unit.speed)
        }
    }
}

/**
 * Localized labels the surface folds into its output (the eleven web `t('widget.yearReview.…')` keys). The
 * pure [YearReviewProjection] reads these to assemble each visible string; the composable builds this from
 * `stringResource`, while tests pass a deterministic instance.
 */
data class YearReviewStrings(
    val title: String,
    val totalDistance: String,
    val totalDrives: String,
    val energyUsed: String,
    val co2Saved: String,
    val busiestMonth: String,
    val longestDrive: String,
    val drivingTime: String,
    val topSpeed: String,
    val inYear: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the year in review for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries the resolved [title], both the compact-hero fields
 * and the stat-grid fields; the composable renders one set per [YearReviewSize].
 */
data class YearReviewDisplay(
    val hasData: Boolean,
    val title: String,
    val compactValue: Double,
    val compactDecimals: Int,
    val compactUnit: String,
    val compactCaption: String,
    val compactContentDescription: String,
    val coreStats: List<YearReviewStatItem>,
    val wideStats: List<YearReviewStatItem>,
    val emptyMessage: String,
) {
    /** The stats to render for the given footprint: the six core tiles, plus two extras when [wide]. */
    fun statsFor(wide: Boolean): List<YearReviewStatItem> = if (wide) coreStats + wideStats else coreStats
}

/**
 * Decodes the raw `/analytics/year-review` [json] (SI, snake_case on the wire) into a [YearReviewData], or
 * `null` when the payload is absent. A non-object input or an empty object resolves to `null`, reproducing
 * the web `data ?` truthiness gate (a disabled query / null response renders the empty surface, while any
 * populated payload — even one with all-zero totals — renders the grid). A missing field or a JSON-null
 * field collapses to zero, reproducing the web optional-chaining (`data?.x ?? 0`).
 */
fun parseYearReview(json: JsonElement?): YearReviewData? {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
    val longest = obj["longest_drive"] as? JsonObject
    val months =
        (obj["monthly_stats"] as? JsonArray)
            ?.mapNotNull { element ->
                (element as? JsonObject)?.let { YearReviewMonthStat(it.int("month"), it.double("drives")) }
            }.orEmpty()
    return YearReviewData(
        totalDrives = obj.double("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        totalEnergyKwh = obj.double("total_energy_kwh"),
        co2OffsetKg = obj.double("co2_offset_kg"),
        totalDrivingMinutes = obj.double("total_driving_minutes"),
        fastestSpeedKmh = obj.double("fastest_speed_kmh"),
        longestDriveKm = longest?.double("distance_km") ?: 0.0,
        monthlyStats = months,
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0

/**
 * Pure projection from a decoded [YearReviewData] to the render-ready [YearReviewDisplay] — the native
 * port of the inline `useMemo` derivations + JSX formatting in the web source. A `null` [data] (web `data`
 * falsy) projects the friendly empty surface.
 *
 * Distance/speed handling (the one deliberate divergence from a literal reading of the web): figures are SI
 * kilometres / km·h⁻¹ on the wire, so they are bridged to metres / m·s⁻¹ and converted to the user's unit
 * via the shared [convertDistanceFromSI] / [convertSpeedFromSI] — exactly as the SI-canonical sibling
 * `LifetimeStatsWidget` does. The web instead multiplies by `KM_TO_MI` then divides by metres-per-unit,
 * which silently under-reports the figure; the native floors on SI so the result is mathematically
 * correct. The busiest month is the `monthly_stats` row with the most drives (first wins ties, web
 * `reduce`), mapped through [MONTH_NAMES].
 */
object YearReviewProjection {
    /** Project [data] for [year] using the user's [prefs] and the localized [strings]. */
    fun project(
        data: YearReviewData?,
        prefs: YearReviewDisplayPrefs,
        strings: YearReviewStrings,
        year: Int,
        locale: Locale = Locale.US,
    ): YearReviewDisplay {
        val distanceUnit = prefs.distanceUnit
        val title = "${strings.title} $year"
        val inYear = strings.inYear.replace("{year}", year.toString())
        if (data == null) {
            return YearReviewDisplay(
                hasData = false,
                title = title,
                compactValue = 0.0,
                compactDecimals = DISTANCE_DECIMALS,
                compactUnit = distanceUnit.label,
                compactCaption = "${distanceUnit.label} $inYear",
                compactContentDescription = strings.noData,
                coreStats = emptyList(),
                wideStats = emptyList(),
                emptyMessage = strings.noData,
            )
        }
        val displayDistance = convertDistanceFromSI(data.totalDistanceKm * METERS_PER_KM, distanceUnit)
        return YearReviewDisplay(
            hasData = true,
            title = title,
            compactValue = displayDistance,
            compactDecimals = DISTANCE_DECIMALS,
            compactUnit = distanceUnit.label,
            compactCaption = "${distanceUnit.label} $inYear",
            compactContentDescription =
                "${ChartFormat.number(displayDistance, DISTANCE_DECIMALS, locale)} ${distanceUnit.label} $inYear",
            coreStats = coreStats(data, displayDistance, prefs, strings, locale),
            wideStats = wideStats(data, prefs, strings, locale),
            emptyMessage = strings.noData,
        )
    }

    /**
     * The busiest month label — the `monthly_stats` row with the most drives (first wins on ties, web
     * `reduce`), mapped through [MONTH_NAMES]. An empty list or an out-of-range month resolves to the em
     * dash (web `?? '—'`).
     */
    fun busiestMonth(monthlyStats: List<YearReviewMonthStat>): String {
        if (monthlyStats.isEmpty()) return EM_DASH
        val best = monthlyStats.reduce { acc, next -> if (next.drives > acc.drives) next else acc }
        return MONTH_NAMES.getOrNull((best.month - 1) % MONTH_NAMES.size) ?: EM_DASH
    }

    /**
     * Converts SI [meters] to the user's distance [unit] — the shared SI→display converter the whole app
     * floors on. Exposed so the projection test can pin the parity-note conversion directly.
     */
    fun toDisplayDistance(
        meters: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(meters, unit)

    /**
     * Converts SI [metersPerSecond] to the user's speed [unit]. Exposed so the projection test can pin the
     * parity-note conversion directly.
     */
    fun toDisplaySpeed(
        metersPerSecond: Double,
        unit: SpeedUnitPref,
    ): Double = convertSpeedFromSI(metersPerSecond, unit)

    private fun coreStats(
        data: YearReviewData,
        displayDistance: Double,
        prefs: YearReviewDisplayPrefs,
        strings: YearReviewStrings,
        locale: Locale,
    ): List<YearReviewStatItem> {
        val distanceUnit = prefs.distanceUnit
        val displayLongestDrive = convertDistanceFromSI(data.longestDriveKm * METERS_PER_KM, distanceUnit)
        return listOf(
            YearReviewStatItem(
                label = strings.totalDistance,
                value = ChartFormat.number(displayDistance, DISTANCE_DECIMALS, locale),
                unit = distanceUnit.label,
                icon = YearReviewStatIcon.Distance,
            ),
            YearReviewStatItem(
                label = strings.totalDrives,
                value = ChartFormat.number(data.totalDrives, COUNT_DECIMALS, locale),
                unit = null,
                icon = YearReviewStatIcon.Drives,
            ),
            YearReviewStatItem(
                label = strings.energyUsed,
                value = ChartFormat.number(data.totalEnergyKwh, ENERGY_DECIMALS, locale),
                unit = ENERGY_UNIT,
                icon = YearReviewStatIcon.Energy,
            ),
            YearReviewStatItem(
                label = strings.co2Saved,
                value = ChartFormat.number(data.co2OffsetKg, CO2_DECIMALS, locale),
                unit = CO2_UNIT,
                icon = YearReviewStatIcon.Co2,
            ),
            YearReviewStatItem(
                label = strings.busiestMonth,
                value = busiestMonth(data.monthlyStats),
                unit = null,
                icon = YearReviewStatIcon.BestMonth,
            ),
            YearReviewStatItem(
                label = strings.longestDrive,
                value = ChartFormat.number(displayLongestDrive, LONGEST_DRIVE_DECIMALS, locale),
                unit = distanceUnit.label,
                icon = YearReviewStatIcon.LongestDrive,
            ),
        )
    }

    private fun wideStats(
        data: YearReviewData,
        prefs: YearReviewDisplayPrefs,
        strings: YearReviewStrings,
        locale: Locale,
    ): List<YearReviewStatItem> {
        // Web `fmtInt(Math.round(total_driving_minutes / 60))`: formatting the raw hours with zero
        // fraction digits applies the same half-up rounding for this non-negative value, so the rendered
        // whole-hour string matches without a separate rounding step.
        val drivingHours = data.totalDrivingMinutes / MINUTES_PER_HOUR
        val displayFastestSpeed =
            convertSpeedFromSI(data.fastestSpeedKmh * METERS_PER_KM / SECONDS_PER_HOUR, prefs.speedUnit)
        return listOf(
            YearReviewStatItem(
                label = strings.drivingTime,
                value = ChartFormat.number(drivingHours, DRIVING_TIME_DECIMALS, locale),
                unit = HOURS_UNIT,
                icon = YearReviewStatIcon.DrivingTime,
            ),
            YearReviewStatItem(
                label = strings.topSpeed,
                value = ChartFormat.number(displayFastestSpeed, SPEED_DECIMALS, locale),
                unit = prefs.speedUnit.label,
                icon = YearReviewStatIcon.TopSpeed,
            ),
        )
    }
}
