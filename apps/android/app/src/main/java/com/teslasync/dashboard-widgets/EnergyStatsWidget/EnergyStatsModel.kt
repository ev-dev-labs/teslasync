// Pure, framework-free model + projection for the Energy Stats dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The energy feed arrives as raw SI JSON (`/vehicles/{id}/energy?days=`), so this
// file owns the decode (web optional-chaining → null-safe reads) plus the display-boundary energy +
// distance conversion (Phase-48 SI-canonical rule; web `useUnits`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/EnergyStatsWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energystats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val EM_DASH = "\u2014"

/** 1 mile = 1609.344 m — the web `toEfficiencyDisplay` Wh/m → Wh/mi factor. */
private const val METERS_PER_MILE = 1609.344

/** 1 km = 1000 m — the web `toEfficiencyDisplay` Wh/m → Wh/km factor. */
private const val METERS_PER_KM = 1000.0

/** Watt-hours per kWh — the chart + compact-hero Wh → kWh display factor. */
private const val WH_PER_KWH = 1000.0

/** Energy stat precision (web `formatEnergy(…, { precision: 1 })`). */
private const val ENERGY_PRECISION = 1

/** Efficiency / CO₂ / chart-axis precision (web `fmtNumber(…, 1)`). */
private const val ONE_DECIMAL = 1

/** Cost precision (web `fmtNumber(data.total_cost, 2)`). */
private const val COST_DECIMALS = 2

/** Compact hero precision (web `<AnimatedNumber />` default `decimals = 0`). */
private const val COMPACT_DECIMALS = 0

private const val DATE_LABEL_PATTERN = "MMM d"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` branch reproduces the web `size.cols <= 1` test that swaps the chart + stat-grid standard
 * layout for the single big-number hero; `isWide` mirrors the web `size.cols >= 3` test that widens the
 * stat grid to three columns and adds the Total Cost + Net Energy tiles.
 */
data class EnergyStatsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact total-energy hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): 3-up grid + extra tiles. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`energy-stats`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object EnergyStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "energy-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "EnergyStatsWidget"

    /** The per-vehicle energy window the feed requests (web `useEnergyStats(id, 30)` default). */
    const val WINDOW_DAYS = 30

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = EnergyStatsSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = EnergyStatsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = EnergyStatsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: EnergyStatsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: EnergyStatsSize): EnergyStatsSize =
        EnergyStatsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One day of the energy breakdown reduced to the two fields the web chart reads from each
 * `daily_breakdown` entry: the [date] key and the SI [energyWh] used that day. Other wire fields
 * (`cost`, `distance_m`, `efficiency_wh_per_m`) are not charted by this surface, so — like the web —
 * they are intentionally not decoded.
 */
data class DailyEnergyPoint(
    val date: String,
    val energyWh: Double,
)

/**
 * The decoded `/vehicles/{id}/energy` payload — the native analogue of the web `EnergyStats` shape the
 * component reads (`total_energy_used_wh`, `total_energy_charged_wh`, `total_wh`, `total_cost`,
 * `avg_efficiency_wh_per_m`, `co2_saved_kg`, `daily_breakdown`). All numerics are SI/raw on the wire;
 * conversion to display units happens in [EnergyStatsProjection]. Missing/absent fields collapse to
 * zero / empty, exactly like the web optional-chaining (`?? 0`, `?? []`).
 *
 * [present] mirrors the web `hasData = !!data`: the surface shows content whenever the request resolved
 * a payload (even an all-zero one), and the friendly empty state only when no payload exists (no
 * vehicle resolved, or a null body).
 */
data class EnergyStatsData(
    val present: Boolean,
    val totalEnergyUsedWh: Double,
    val totalEnergyChargedWh: Double,
    val totalWh: Double,
    val totalCost: Double,
    val avgEfficiencyWhPerM: Double,
    val co2SavedKg: Double,
    val daily: List<DailyEnergyPoint>,
) {
    /** Web `hasData = !!data` — drives the empty-state gate. */
    val hasData: Boolean get() = present

    companion object {
        /** The "no payload" snapshot, surfaced for a null body or no resolved vehicle (web `data: undefined`). */
        val EMPTY = EnergyStatsData(false, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/**
 * The localized labels the surface folds into its output — the ten web `t('widget.energyStats.…')`
 * keys. The pure [EnergyStatsProjection] reads these to assemble each visible string + TalkBack content
 * description; the composable builds this from `stringResource`, while tests pass a deterministic
 * instance.
 */
data class EnergyStatsStrings(
    val title: String,
    val totalUsed: String,
    val totalCharged: String,
    val avgEfficiency: String,
    val co2Saved: String,
    val totalCost: String,
    val netBalance: String,
    val noData: String,
    val dailyUsage: String,
    val energyKwh: String,
)

/** Which leading glyph a stat tile shows — mapped to an `ImageVector` at the Compose boundary. */
enum class EnergyStatIcon { Used, Charged, Efficiency, Co2, Cost, Net }

/**
 * One projected, render-ready stat tile — the native analogue of a web `StatGridItem`. Carries the
 * resolved [label], the already-formatted [value], an optional [unit] suffix (null when the unit is
 * baked into [value], as `formatEnergy` does), and the [icon] marker.
 */
data class EnergyStatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: EnergyStatIcon,
)

/**
 * One projected, render-ready daily chart point: the date [key] (`YYYY-MM-DD`, the web `d.date`), the
 * already-localized x-axis [label] (month-short + day-numeric), and the daily energy in [energyKwh]
 * (SI Wh ÷ 1000 — the web chart, tooltip, and series name all read kWh).
 */
data class EnergyChartPoint(
    val key: String,
    val label: String,
    val energyKwh: Double,
)

/**
 * The fully projected, render-ready view of the energy stats for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the
 * standard/wide layout fields; the composable renders one set per [EnergyStatsSize.isCompact].
 */
data class EnergyStatsDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val title: String,
    val compactValueKwh: Double,
    val compactValueText: String,
    val energyUnitLabel: String,
    val compactContentDescription: String,
    val chartPoints: List<EnergyChartPoint>,
    val dailyUsageLabel: String,
    val energyKwhLabel: String,
    val statGridColumns: Int,
    val stats: List<EnergyStatItem>,
    val emptyMessage: String,
) {
    /** True when there is at least one daily point to chart (web `hasChartData = chartData.length > 0`). */
    val hasChartData: Boolean get() = chartPoints.isNotEmpty()
}

/**
 * Decodes the raw `/vehicles/{id}/energy` [json] (SI, snake_case on the wire) into an [EnergyStatsData].
 * A non-object input, an empty object (the view-model's no-vehicle sentinel), missing fields, or
 * JSON-null fields all collapse to the zero/empty [EnergyStatsData.EMPTY] — reproducing the web
 * optional-chaining (`data?.x ?? 0`, `data?.daily_breakdown ?? []`) and the `hasData = !!data` gate.
 */
fun parseEnergyStats(json: JsonElement?): EnergyStatsData {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return EnergyStatsData.EMPTY
    val daily =
        (obj["daily_breakdown"] as? JsonArray)
            ?.mapNotNull { element -> (element as? JsonObject)?.toDailyPoint() }
            ?: emptyList()
    return EnergyStatsData(
        present = true,
        totalEnergyUsedWh = obj.double("total_energy_used_wh"),
        totalEnergyChargedWh = obj.double("total_energy_charged_wh"),
        totalWh = obj.double("total_wh"),
        totalCost = obj.double("total_cost"),
        avgEfficiencyWhPerM = obj.double("avg_efficiency_wh_per_m"),
        co2SavedKg = obj.double("co2_saved_kg"),
        daily = daily,
    )
}

private fun JsonObject.toDailyPoint(): DailyEnergyPoint =
    DailyEnergyPoint(
        date = (this["date"] as? JsonPrimitive)?.contentOrNull ?: EM_DASH,
        energyWh = double("energy_wh"),
    )

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/**
 * Pure projection from a decoded [EnergyStatsData] to the render-ready [EnergyStatsDisplay] — the native
 * port of the inline `useMemo` derivations + JSX formatting in the web source. SI energy is formatted
 * via the shared [formatEnergy] (web `useUnits().formatEnergy`); SI Wh/m efficiency is converted to the
 * user's distance unit here (web `toEfficiencyDisplay`); the daily series is converted to kWh. [locale]
 * drives the grouping/separators (tests pin [Locale.US]).
 */
object EnergyStatsProjection {
    /**
     * Project [data] for [size] using the user's display [prefs] (energy unit + locale + distance unit),
     * the localized [strings], and [locale] for axis/stat number grouping.
     */
    fun project(
        data: EnergyStatsData,
        size: EnergyStatsSize,
        strings: EnergyStatsStrings,
        prefs: UnitPref,
        locale: Locale = Locale.US,
    ): EnergyStatsDisplay {
        val compactKwh = data.totalWh / WH_PER_KWH
        val compactText = ChartFormat.number(compactKwh, COMPACT_DECIMALS, locale)
        val energyUnit = prefs.energy.label
        return EnergyStatsDisplay(
            hasData = data.hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            title = strings.title,
            compactValueKwh = compactKwh,
            compactValueText = compactText,
            energyUnitLabel = energyUnit,
            compactContentDescription = "$compactText $energyUnit",
            chartPoints = chartPoints(data.daily, locale),
            dailyUsageLabel = strings.dailyUsage,
            energyKwhLabel = strings.energyKwh,
            statGridColumns = if (size.isWide) WIDE_GRID_COLUMNS else STANDARD_GRID_COLUMNS,
            stats = if (data.hasData) stats(data, size, strings, prefs, locale) else emptyList(),
            emptyMessage = strings.noData,
        )
    }

    /** Convert an SI Wh/m efficiency to the user's display unit (web `toEfficiencyDisplay`). */
    fun efficiencyDisplay(
        whPerM: Double,
        distanceUnit: DistanceUnitPref,
    ): Double = whPerM * if (distanceUnit == DistanceUnitPref.MI) METERS_PER_MILE else METERS_PER_KM

    /** The efficiency unit token (web `efficiencyUnit`): `Wh/mi` for miles, else `Wh/km`. */
    fun efficiencyUnit(distanceUnit: DistanceUnitPref): String = if (distanceUnit == DistanceUnitPref.MI) UNIT_WH_PER_MI else UNIT_WH_PER_KM

    private fun chartPoints(
        daily: List<DailyEnergyPoint>,
        locale: Locale,
    ): List<EnergyChartPoint> {
        val formatter = DateTimeFormatter.ofPattern(DATE_LABEL_PATTERN, locale)
        return daily.map { point ->
            EnergyChartPoint(
                key = point.date,
                label = labelFor(point.date, formatter),
                energyKwh = point.energyWh / WH_PER_KWH,
            )
        }
    }

    private fun stats(
        data: EnergyStatsData,
        size: EnergyStatsSize,
        strings: EnergyStatsStrings,
        prefs: UnitPref,
        locale: Locale,
    ): List<EnergyStatItem> {
        val effValue = efficiencyDisplay(data.avgEfficiencyWhPerM, prefs.distance)
        val items =
            mutableListOf(
                EnergyStatItem(strings.totalUsed, energy(data.totalEnergyUsedWh, prefs), null, EnergyStatIcon.Used),
                EnergyStatItem(strings.totalCharged, energy(data.totalEnergyChargedWh, prefs), null, EnergyStatIcon.Charged),
                EnergyStatItem(
                    label = strings.avgEfficiency,
                    value = ChartFormat.number(effValue, ONE_DECIMAL, locale),
                    unit = efficiencyUnit(prefs.distance),
                    icon = EnergyStatIcon.Efficiency,
                ),
                EnergyStatItem(
                    label = strings.co2Saved,
                    value = ChartFormat.number(data.co2SavedKg, ONE_DECIMAL, locale),
                    unit = UNIT_KG,
                    icon = EnergyStatIcon.Co2,
                ),
            )
        if (size.isWide) {
            val net = data.totalEnergyChargedWh - data.totalEnergyUsedWh
            items +=
                EnergyStatItem(
                    label = strings.totalCost,
                    value = ChartFormat.number(data.totalCost, COST_DECIMALS, locale),
                    unit = UNIT_CURRENCY,
                    icon = EnergyStatIcon.Cost,
                )
            items += EnergyStatItem(strings.netBalance, energy(net, prefs), null, EnergyStatIcon.Net)
        }
        return items
    }

    private fun energy(
        wh: Double,
        prefs: UnitPref,
    ): String = formatEnergy(wh, prefs, ENERGY_PRECISION)

    private fun labelFor(
        dateKey: String,
        formatter: DateTimeFormatter,
    ): String = runCatching { LocalDate.parse(dateKey).format(formatter) }.getOrNull() ?: dateKey

    /** Wh/mi unit token shown for an imperial user (web `'Wh/mi'`). */
    const val UNIT_WH_PER_MI = "Wh/mi"

    /** Wh/km unit token shown for a metric user (web `'Wh/km'`). */
    const val UNIT_WH_PER_KM = "Wh/km"

    /** CO₂ mass unit (web `unit: 'kg'`). */
    const val UNIT_KG = "kg"

    /** Cost unit (web `unit: '$'`). */
    const val UNIT_CURRENCY = "$"

    private const val STANDARD_GRID_COLUMNS = 2
    private const val WIDE_GRID_COLUMNS = 3
}
