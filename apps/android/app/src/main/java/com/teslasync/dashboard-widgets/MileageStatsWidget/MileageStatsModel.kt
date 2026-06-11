// Pure, framework-free model + projection for the Mileage Stats dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/MileageStatsWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The mileage feed arrives as raw SI JSON (`/mileage/stats?vehicle_id=`) carrying
// kilometre rollups, so this file owns the decode (web optional-chaining → null-safe reads) plus the
// display-boundary distance conversion (Phase-48 SI-canonical rule; web `useUnits` + `convertDistanceFromSI`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MileageStatsWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mileagestats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor

/** Em dash shown for the milestone trend when no projection is possible (web `'—'`). */
private const val EM_DASH = "\u2014"

/** 1 km = 1000 m — scales the backend's kilometre rollup to SI metres for `convertDistanceFromSI`. */
private const val METERS_PER_KM = 1000.0

/** Web `nextMilestone` step: round up to the next 10 000-distance-unit milestone above the total. */
private const val MILESTONE_STEP = 10_000.0

/** Days per rolling week — the web `dailyAvgDisplay * 7` weekly projection. */
private const val DAYS_PER_WEEK = 7.0

/** Days per rolling month — the web `last_30d_km / 30` daily average + `dailyAvgDisplay * 30` monthly. */
private const val DAYS_PER_MONTH = 30.0

/** Daily-average precision (web `fmtNumber(dailyAvgDisplay, 1)`). */
private const val DAILY_DECIMALS = 1

/** Weekly / monthly / milestone precision (web `fmtNumber(…, 0)` + `fmtInt`). */
private const val WHOLE_DECIMALS = 0

/** Compact hero precision (web `<AnimatedNumber />` default `decimals = 0`). */
private const val COMPACT_DECIMALS = 0

/** The standard stat-grid column count (web `<WidgetStatGrid stats={stats} cols={2} />`). */
private const val STAT_GRID_COLUMNS = 2

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` branch reproduces the web `isCompact = size.cols <= 1` test that swaps the four-tile stat
 * grid for the single big daily-average hero. Mileage has no wide branch (the web component renders only
 * the compact and standard layouts).
 */
data class MileageStatsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact daily-average hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`mileage-stats`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object MileageStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "mileage-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "MileageStatsWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = MileageStatsSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = MileageStatsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = MileageStatsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: MileageStatsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MileageStatsSize): MileageStatsSize =
        MileageStatsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The decoded `/mileage/stats` payload reduced to the two fields the web component reads
 * (`lifetime_km`, `last_30d_km`). Distances are kilometres on the wire (SI conversion happens in the
 * backend SELECT list); the daily/weekly/monthly/milestone projection happens in [MileageStatsProjection].
 * Missing/absent fields collapse to zero, exactly like the web optional-chaining (`data?.lifetime_km ?? 0`).
 *
 * [present] mirrors the web `data ? … : <EmptyState />` gate: the surface shows content whenever the
 * request resolved a payload (even an all-zero one, e.g. a vehicle with no recorded drives), and the
 * friendly empty state only when no payload exists (no vehicle resolved, or a null body).
 */
data class MileageStatsData(
    val present: Boolean,
    val lifetimeKm: Double,
    val last30dKm: Double,
) {
    /** Web `data ? … : empty` — drives the empty-state gate. */
    val hasData: Boolean get() = present

    companion object {
        /** The "no payload" snapshot, surfaced for a null body or no resolved vehicle (web `data: undefined`). */
        val EMPTY = MileageStatsData(present = false, lifetimeKm = 0.0, last30dKm = 0.0)
    }
}

/**
 * The localized labels the surface folds into its output — the eight web `t('widget.mileageStats.…')`
 * keys. The pure [MileageStatsProjection] reads these to assemble each visible string; the composable
 * builds this from `stringResource`, while tests pass a deterministic instance. [inMonths] is the raw
 * `~%1$s mo` format template (web `'~{{months}} mo'`); the projection fills its single argument.
 */
data class MileageStatsStrings(
    val title: String,
    val dailyAvg: String,
    val weeklyAvg: String,
    val monthlyAvg: String,
    val nextMilestone: String,
    val inMonths: String,
    val day: String,
    val noData: String,
)

/** Which leading glyph a stat tile shows — mapped to an `ImageVector` at the Compose boundary. */
enum class MileageStatIcon { DailyAvg, WeeklyAvg, MonthlyAvg, NextMilestone }

/** Trend-chip direction for a [MileageStatItem] — mapped to a `DeltaArrow` at the Compose boundary. */
enum class MileageTrendDirection { Up, Down, Flat }

/**
 * One projected trend chip — the native analogue of the web `StatGridItem.trend`/`trendValue` pair. The
 * web derives `positive` from `direction === 'up'`; that derivation is applied at the Compose boundary so
 * this stays pure presentation data.
 */
data class MileageStatTrend(
    val direction: MileageTrendDirection,
    val text: String,
)

/**
 * One projected, render-ready stat tile — the native analogue of a web `StatGridItem`. Carries the
 * resolved [label], the already-formatted [value], the [unit] suffix (the user's distance unit), the
 * [icon] marker, and an optional [trend] chip (only the Next Milestone tile carries one).
 */
data class MileageStatItem(
    val label: String,
    val value: String,
    val unit: String,
    val icon: MileageStatIcon,
    val trend: MileageStatTrend? = null,
)

/**
 * The fully projected, render-ready view of the mileage stats for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the standard
 * stat-grid fields; the composable renders one set per [isCompact].
 */
data class MileageStatsDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val title: String,
    val compactDailyAvg: Double,
    val compactValueText: String,
    val distanceUnitLabel: String,
    val compactUnitLabel: String,
    val compactContentDescription: String,
    val statGridColumns: Int,
    val stats: List<MileageStatItem>,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/mileage/stats` [json] (kilometre rollups, snake_case on the wire) into a
 * [MileageStatsData]. A non-object input, an empty object (the view-model's no-vehicle sentinel), missing
 * fields, or JSON-null fields all collapse to the zero/empty [MileageStatsData.EMPTY] — reproducing the
 * web optional-chaining (`data?.lifetime_km ?? 0`) and the `data ? … : empty` gate.
 */
fun parseMileageStats(json: JsonElement?): MileageStatsData {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return MileageStatsData.EMPTY
    return MileageStatsData(
        present = true,
        lifetimeKm = obj.double("lifetime_km"),
        last30dKm = obj.double("last_30d_km"),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [MileageStatsData] to the render-ready [MileageStatsDisplay] — the
 * native port of the inline derivations + JSX formatting in the web source. SI kilometres are scaled to
 * metres and converted to the user's distance unit at this display boundary (web `toDistanceDisplay` =
 * `convertDistanceFromSI(value, unitPrefs.distance)`); numbers are formatted via the shared [ChartFormat]
 * (web `fmtNumber`/`fmtInt`). [locale] drives the grouping/separators (tests pin [Locale.US]).
 */
object MileageStatsProjection {
    /**
     * Project [data] for [size] using the user's display [prefs] (distance unit), the localized
     * [strings], and [locale] for number grouping.
     */
    fun project(
        data: MileageStatsData,
        size: MileageStatsSize,
        strings: MileageStatsStrings,
        prefs: UnitPref,
        locale: Locale = Locale.US,
    ): MileageStatsDisplay {
        val unit = prefs.distance
        val dailyAvg = dailyAvgDisplay(data, unit)
        val compactText = ChartFormat.number(dailyAvg, COMPACT_DECIMALS, locale)
        val unitLabel = unit.label
        val compactUnitLabel = "$unitLabel/${strings.day}"
        return MileageStatsDisplay(
            hasData = data.hasData,
            isCompact = size.isCompact,
            title = strings.title,
            compactDailyAvg = dailyAvg,
            compactValueText = compactText,
            distanceUnitLabel = unitLabel,
            compactUnitLabel = compactUnitLabel,
            compactContentDescription = "$compactText $compactUnitLabel",
            statGridColumns = STAT_GRID_COLUMNS,
            stats = if (data.hasData) stats(data, strings, prefs, locale) else emptyList(),
            emptyMessage = strings.noData,
        )
    }

    /** Total lifetime distance in the user's display unit (web `toDistanceDisplay(lifetime_km * 1000)`). */
    fun totalDisplay(
        data: MileageStatsData,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(data.lifetimeKm * METERS_PER_KM, unit)

    /** Daily average distance in the user's display unit (web `toDistanceDisplay((last_30d_km / 30) * 1000)`). */
    fun dailyAvgDisplay(
        data: MileageStatsData,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI((data.last30dKm / DAYS_PER_MONTH) * METERS_PER_KM, unit)

    /** Round up to the next 10 000-unit milestone above [total] (web `nextMilestone`). */
    fun nextMilestone(total: Double): Double = ceil((total + 1.0) / MILESTONE_STEP) * MILESTONE_STEP

    /**
     * Months to the next milestone at the current daily average (web
     * `Math.max(1, Math.round(remaining / dailyAvgDisplay / 30))`, or `0` when the average is zero).
     * Uses `floor(x + 0.5)` to reproduce JavaScript `Math.round` (round half up) rather than Kotlin's
     * round-half-to-even.
     */
    fun monthsToMilestone(
        remaining: Double,
        dailyAvg: Double,
    ): Int = if (dailyAvg > 0.0) maxOf(1, floor(remaining / dailyAvg / DAYS_PER_MONTH + 0.5).toInt()) else 0

    private fun stats(
        data: MileageStatsData,
        strings: MileageStatsStrings,
        prefs: UnitPref,
        locale: Locale,
    ): List<MileageStatItem> {
        val unit = prefs.distance
        val unitLabel = unit.label
        val dailyAvg = dailyAvgDisplay(data, unit)
        val milestone = nextMilestone(totalDisplay(data, unit))
        val months = monthsToMilestone(milestone - totalDisplay(data, unit), dailyAvg)
        val milestoneTrend =
            MileageStatTrend(
                direction = MileageTrendDirection.Up,
                text = if (months > 0) String.format(locale, strings.inMonths, months) else EM_DASH,
            )
        return listOf(
            MileageStatItem(
                label = strings.dailyAvg,
                value = ChartFormat.number(dailyAvg, DAILY_DECIMALS, locale),
                unit = unitLabel,
                icon = MileageStatIcon.DailyAvg,
            ),
            MileageStatItem(
                label = strings.weeklyAvg,
                value = ChartFormat.number(dailyAvg * DAYS_PER_WEEK, WHOLE_DECIMALS, locale),
                unit = unitLabel,
                icon = MileageStatIcon.WeeklyAvg,
            ),
            MileageStatItem(
                label = strings.monthlyAvg,
                value = ChartFormat.number(dailyAvg * DAYS_PER_MONTH, WHOLE_DECIMALS, locale),
                unit = unitLabel,
                icon = MileageStatIcon.MonthlyAvg,
            ),
            MileageStatItem(
                label = strings.nextMilestone,
                value = ChartFormat.number(milestone, WHOLE_DECIMALS, locale),
                unit = unitLabel,
                icon = MileageStatIcon.NextMilestone,
                trend = milestoneTrend,
            ),
        )
    }
}
