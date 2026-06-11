// Pure, framework-free model + projection for the Lifetime Stats dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx). No Compose, no Android, no HTTP: every
// type here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The lifetime feed arrives as raw SI JSON (`/analytics/lifetime`), so this file owns
// the decode (web optional-chaining → null-safe reads) plus the display-boundary distance conversion +
// currency formatting (Phase-48 SI-canonical rule; web `useUnits`/`useFormatting`).
//
// Distance parity note (intentional, non-silent divergence — see [LifetimeStatsProjection]): the web
// source converts via the legacy mile floor (`total_distance_km * KM_TO_MI` fed into a metre-expecting
// `convertDistanceFromSI`), which under-reports the figure. The native surfaces floor on SI metres like
// the sibling `AnalyticsSummaryWidget`: `convertDistanceFromSI(total_distance_km * 1000, unit)` — the
// mathematically-correct conversion the web arithmetic approximates. A unit test pins the result.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/LifetimeStatsWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.lifetimestats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

private const val DEFAULT_CURRENCY = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge the distance conversion floors on (see the parity note above). */
private const val METERS_PER_KM = 1000.0

/** Hard-coded display units the web reads as literals (`unit: 'kWh'` / `unit: 'kg'`), never i18n. */
private const val ENERGY_UNIT = "kWh"
private const val CO2_UNIT = "kg"

/** Per-metric fraction digits (web `fmtNumber(value, n)` / `fmtInt`). */
private const val DISTANCE_DECIMALS = 0
private const val COUNT_DECIMALS = 0
private const val ENERGY_DECIMALS = 1
private const val CO2_DECIMALS = 0
private const val AVG_DAILY_DECIMALS = 1

/** The single column count at/above which the wide 4-up stat grid is drawn (web `size.cols >= 3`). */
private const val WIDE_COLS = 3

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test (the single big-number hero) and [isWide]
 * the web `size.cols >= 3` test (the 4-up stat grid that folds in the three extra totals).
 */
data class LifetimeStatsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact`): render the compact lifetime-distance hero. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three or more columns (web `isWide`): render the 4-up grid with the extra totals. */
    val isWide: Boolean get() = cols >= WIDE_COLS
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`lifetime-stats`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object LifetimeStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "lifetime-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "LifetimeStatsWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val defaultSize = LifetimeStatsSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = LifetimeStatsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = LifetimeStatsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: LifetimeStatsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LifetimeStatsSize): LifetimeStatsSize =
        LifetimeStatsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The leading glyph a stat tile shows — a pure enum so the projection stays framework-free; the
 * composable maps each case onto a curated [androidx.compose.ui.graphics.vector.ImageVector] (the
 * native analogue of the web lucide icons `Route` / `Car` / `Zap` / `Leaf` / `DollarSign` /
 * `CalendarDays`).
 */
enum class LifetimeStatIcon { Distance, Drives, Energy, Co2, Cost, OwnershipDays, AvgDailyDistance }

/**
 * One projected, render-ready stat tile — the native analogue of a web `StatGridItem`. Carries the
 * resolved [label], the already-formatted [value], an optional [unit] suffix, and the leading [icon].
 */
data class LifetimeStatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: LifetimeStatIcon,
)

/**
 * The decoded `/analytics/lifetime` payload — the native analogue of the fields the web component reads
 * off `LifetimeStats` (`total_distance_km`, `total_drives`, `total_energy_kwh`, `co2_offset_kg`,
 * `total_charging_cost`, `ownership_days`). All numerics are SI/raw on the wire; conversion to display
 * units happens in [LifetimeStatsProjection]. Missing/absent fields collapse to zero, exactly like the
 * web optional-chaining (`?? 0`).
 */
data class LifetimeStatsData(
    val totalDrives: Double,
    val totalDistanceKm: Double,
    val totalEnergyKwh: Double,
    val co2OffsetKg: Double,
    val totalChargingCost: Double,
    val ownershipDays: Double,
) {
    /**
     * Whether any meaningful lifetime total has accrued. A brand-new account with no drives, distance,
     * energy or ownership days resolves to the friendly empty state (web `noData`) rather than a grid of
     * zeros — mirroring the sibling `AnalyticsSummaryWidget` `hasData` gate.
     */
    val hasData: Boolean
        get() = totalDrives > 0.0 || totalDistanceKm > 0.0 || totalEnergyKwh > 0.0 || ownershipDays > 0.0

    companion object {
        /** The all-zero snapshot, surfaced for a null payload. */
        val EMPTY = LifetimeStatsData(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` +
 * `useFormatting` reads from the `/settings` document: the [distanceUnit] (distance figures + label),
 * the [currencySymbol] (blank → "$"), and the currency [precision] (web `decimal_precision`, floored &
 * non-negative, else 2).
 */
data class LifetimeStatsDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val currencySymbol: String,
    val precision: Int,
) {
    companion object {
        /** Metric + `$` + 2dp defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT = LifetimeStatsDisplayPrefs(DistanceUnitPref.KM, DEFAULT_CURRENCY, DEFAULT_PRECISION)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): LifetimeStatsDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            return LifetimeStatsDisplayPrefs(
                distanceUnit = unit.distance,
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * Localized labels the surface folds into its output (the ten web `t('widget.lifetimeStats.…')` keys).
 * The pure [LifetimeStatsProjection] reads these to assemble each visible string; the composable builds
 * this from `stringResource`, while tests pass a deterministic instance.
 */
data class LifetimeStatsStrings(
    val title: String,
    val totalDistance: String,
    val totalDrives: String,
    val totalEnergy: String,
    val co2Saved: String,
    val totalCost: String,
    val ownershipDays: String,
    val avgDailyDistance: String,
    val lifetime: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the lifetime stats for one footprint — the native analogue
 * of everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the stat-grid
 * fields; the composable renders one set per [LifetimeStatsSize].
 */
data class LifetimeStatsDisplay(
    val hasData: Boolean,
    val compactValue: Double,
    val compactDecimals: Int,
    val compactUnit: String,
    val compactCaption: String,
    val compactContentDescription: String,
    val coreStats: List<LifetimeStatItem>,
    val wideStats: List<LifetimeStatItem>,
    val emptyMessage: String,
) {
    /** The stats to render for the given footprint: the four core tiles, plus three extras when [wide]. */
    fun statsFor(wide: Boolean): List<LifetimeStatItem> = if (wide) coreStats + wideStats else coreStats
}

/**
 * Decodes the raw `/analytics/lifetime` [json] (SI, snake_case on the wire) into a [LifetimeStatsData].
 * A non-object input, a missing field, or a JSON-null field all collapse to zero — reproducing the web
 * optional-chaining (`data?.x ?? 0`).
 */
fun parseLifetimeStats(json: JsonElement?): LifetimeStatsData {
    val obj = json as? JsonObject ?: return LifetimeStatsData.EMPTY
    return LifetimeStatsData(
        totalDrives = obj.double("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        totalEnergyKwh = obj.double("total_energy_kwh"),
        co2OffsetKg = obj.double("co2_offset_kg"),
        totalChargingCost = obj.double("total_charging_cost"),
        ownershipDays = obj.double("ownership_days"),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [LifetimeStatsData] to the render-ready [LifetimeStatsDisplay] — the
 * native port of the inline `useMemo` derivations + JSX formatting in the web source.
 *
 * Distance handling (the one deliberate divergence from a literal reading of the web): the lifetime
 * distance is SI kilometres on the wire, so it is bridged to metres and converted to the user's unit via
 * the shared [convertDistanceFromSI] — exactly as the SI-canonical sibling `AnalyticsSummaryWidget`
 * does. The web instead multiplies by `KM_TO_MI` and then divides by metres-per-unit, which silently
 * under-reports the figure; the native floors on SI so "12,345 km" reads as "12,345 km" (or its correct
 * mile equivalent). The average-daily figure is the same SI distance divided by the ownership days.
 *
 * Currency is formatted via [formatCurrency], reproducing the web `useFormatting`
 * `currencySymbol + fmtNumber` contract. [locale] drives grouping/separators (tests pin [Locale.US]).
 */
object LifetimeStatsProjection {
    /** Project [data] using the user's [prefs] and the localized [strings]. */
    fun project(
        data: LifetimeStatsData,
        prefs: LifetimeStatsDisplayPrefs,
        strings: LifetimeStatsStrings,
        locale: Locale = Locale.US,
    ): LifetimeStatsDisplay {
        val unit = prefs.distanceUnit
        val distanceMeters = data.totalDistanceKm * METERS_PER_KM
        val displayDistance = convertDistanceFromSI(distanceMeters, unit)
        return LifetimeStatsDisplay(
            hasData = data.hasData,
            compactValue = displayDistance,
            compactDecimals = DISTANCE_DECIMALS,
            compactUnit = unit.label,
            compactCaption = "${unit.label} ${strings.lifetime}",
            compactContentDescription =
                "${ChartFormat.number(displayDistance, DISTANCE_DECIMALS, locale)} ${unit.label} ${strings.lifetime}",
            coreStats = coreStats(data, displayDistance, unit, strings, locale),
            wideStats = wideStats(data, distanceMeters, prefs, strings, locale),
            emptyMessage = strings.noData,
        )
    }

    /**
     * Formats a currency [amount] as the web `formatCurrency` does — the user's [symbol] (blank → "$")
     * followed by a [decimals]-digit grouped number — via the shared [ChartFormat.number].
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale = Locale.US,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)}"

    /**
     * Converts SI [meters] to the user's distance [unit] — the shared SI→display converter the whole
     * app floors on. Exposed so the projection test can pin the parity-note conversion directly.
     */
    fun toDisplayDistance(
        meters: Double,
        unit: DistanceUnitPref,
    ): Double = convertDistanceFromSI(meters, unit)

    private fun coreStats(
        data: LifetimeStatsData,
        displayDistance: Double,
        unit: DistanceUnitPref,
        strings: LifetimeStatsStrings,
        locale: Locale,
    ): List<LifetimeStatItem> =
        listOf(
            LifetimeStatItem(
                label = strings.totalDistance,
                value = ChartFormat.number(displayDistance, DISTANCE_DECIMALS, locale),
                unit = unit.label,
                icon = LifetimeStatIcon.Distance,
            ),
            LifetimeStatItem(
                label = strings.totalDrives,
                value = ChartFormat.number(data.totalDrives, COUNT_DECIMALS, locale),
                unit = null,
                icon = LifetimeStatIcon.Drives,
            ),
            LifetimeStatItem(
                label = strings.totalEnergy,
                value = ChartFormat.number(data.totalEnergyKwh, ENERGY_DECIMALS, locale),
                unit = ENERGY_UNIT,
                icon = LifetimeStatIcon.Energy,
            ),
            LifetimeStatItem(
                label = strings.co2Saved,
                value = ChartFormat.number(data.co2OffsetKg, CO2_DECIMALS, locale),
                unit = CO2_UNIT,
                icon = LifetimeStatIcon.Co2,
            ),
        )

    private fun wideStats(
        data: LifetimeStatsData,
        distanceMeters: Double,
        prefs: LifetimeStatsDisplayPrefs,
        strings: LifetimeStatsStrings,
        locale: Locale,
    ): List<LifetimeStatItem> {
        val unit = prefs.distanceUnit
        val avgDailyMeters = if (data.ownershipDays > 0.0) distanceMeters / data.ownershipDays else 0.0
        val avgDailyDisplay = convertDistanceFromSI(avgDailyMeters, unit)
        return listOf(
            LifetimeStatItem(
                label = strings.totalCost,
                value = formatCurrency(data.totalChargingCost, prefs.currencySymbol, prefs.precision, locale),
                unit = null,
                icon = LifetimeStatIcon.Cost,
            ),
            LifetimeStatItem(
                label = strings.ownershipDays,
                value = ChartFormat.number(data.ownershipDays, COUNT_DECIMALS, locale),
                unit = null,
                icon = LifetimeStatIcon.OwnershipDays,
            ),
            LifetimeStatItem(
                label = strings.avgDailyDistance,
                value = ChartFormat.number(avgDailyDisplay, AVG_DAILY_DECIMALS, locale),
                unit = unit.label,
                icon = LifetimeStatIcon.AvgDailyDistance,
            ),
        )
    }
}
