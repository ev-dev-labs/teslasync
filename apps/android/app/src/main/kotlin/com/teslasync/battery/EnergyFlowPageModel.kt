// Pure, framework-free model + projections for the EnergyFlowPage battery surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/battery/pages/EnergyFlowPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free UiState projection
// and the shared-core Resource/units), so the composable stays a thin render layer and all of this is exercised
// off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the two raw SI JSON envelopes the page reads —
// the historical `/vehicles/{id}/energy?days=N` totals + daily breakdown (the web `EnergyStatsResponse`, primary feed)
// and the real-time `/vehicles/{id}/energy/flow` snapshot (the web `useEnergyFlow` `EnergyFlowData`) — into typed,
// null-safe models (web optional-chaining → null-safe reads); (2) the display-boundary unit derivation from the
// `/settings` document ([EnergyFlowDisplayPrefs], web `useUnits`); and (3) the per-field formatting + derivations the
// panels call (distance SI→display via the shared converter, Wh→kWh energy, Wh/m→Wh/km|Wh/mi efficiency scaling,
// grouped numbers — web `formatDistance`/`formatEnergy`/`fmtNumber`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): the historical totals report distance in SI metres
// (`total_distance_m`), efficiency in SI Wh/metre (`avg_efficiency_wh_per_m`) and energy in SI watt-hours
// (`*_wh`); all are bridged to the user's display units only here at the render boundary via the shared
// [convertDistanceFromSI]/[convertEnergyFromSI] + the efficiency scale — exactly as the web `formatDistance`/
// `formatEnergy`/`whPerKm` math does. The real-time flow snapshot's `dc_charging_power`/`ac_charging_power` (kW),
// `energy_remaining` (kWh) and `soc` (%) are reported pre-scaled by the backend and rendered verbatim, mirroring the
// web page's raw `fmtNumber` reads (it never re-converts them).
//
// Empty-state divergence (Honesty Covenant #9 — documented, not silent): the web guards its body on the truthiness of
// the loaded stats payload (`!stats`) and each chart/section on the truthiness of its own derived rows. The native
// surface routes an absent / no-vehicle payload (no `period_days`) to the friendly empty surface via [EnergyStats.hasData]
// so the page shows its `No Data` empty-state rather than a grid of zeros; a real response (always carrying
// `period_days > 0`) renders the full body, and each chart/table still shows its own empty-state — the same gate the
// sibling StatisticsPage uses, and what makes the four declared data states genuinely reachable.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling StatisticsPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.energyflow

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.formatDistance
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.text.DateFormatSymbols
import java.util.Locale

/** 1 km = 1000 m — the SI bridge the per-unit efficiency scale floors on (web `efficiency_wh_per_m * 1000`). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km — the Wh/m → Wh/mi scale the web applies for an imperial pref (`efficiency_wh_per_m * 1609.344`). */
private const val METERS_PER_MILE = 1609.344

/** Default number fraction digits (web `_globalPrecision` / `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** Efficiency value below which the metrics badge reads "Excellent" (web `distanceUnit === 'km' ? 150 : 240`). */
private const val EXCELLENT_THRESHOLD_KM = 150.0
private const val EXCELLENT_THRESHOLD_MI = 240.0

/** Efficiency value below which the metrics badge reads "Good" (web `distanceUnit === 'km' ? 200 : 320`). */
private const val GOOD_THRESHOLD_KM = 200.0
private const val GOOD_THRESHOLD_MI = 320.0

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `EnergyFlowPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("energyFlow", "/energy-flow", …)`, so the host binds this surface to that destination (and its `/energy-flow`
 * deep link) without the nav module depending on it.
 */
object EnergyFlowPageRegistration {
    /** The navigation destination id (Destinations.kt `page("energyFlow", "/energy-flow", …)`). */
    const val ROUTE_ID: String = "energyFlow"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/energy-flow"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "EnergyFlowPage"
}

/**
 * One decoded `daily_breakdown` row of the `/vehicles/{id}/energy` response (web `DailyBreakdownEntry`). [date] is an
 * ISO `yyyy-MM-dd` string; [energyWh] is SI watt-hours, [distanceM] is SI metres, [efficiencyWhPerM] is SI Wh/metre,
 * [cost] is raw on the wire. Missing / JSON-null fields collapse to zero, exactly like the web optional reads.
 */
data class EnergyDailyEntry(
    val date: String,
    val energyWh: Double,
    val distanceM: Double,
    val efficiencyWhPerM: Double,
    val cost: Double,
)

/**
 * The decoded `/vehicles/{id}/energy?days=N` payload — the native analogue of the web `EnergyStatsResponse` the
 * summary cards, charts + history table read (internal/api/energy_handler.go). [totalDistanceM] is SI metres,
 * [avgEfficiencyWhPerM] is SI Wh/metre, the `*Wh` fields are SI watt-hours; [totalCost] + [co2SavedKg] are raw on the
 * wire. Missing / JSON-null fields collapse to zero, mirroring the web optional reads.
 */
data class EnergyStats(
    val periodDays: Int,
    val totalEnergyUsedWh: Double,
    val totalEnergyChargedWh: Double,
    val totalCost: Double,
    val totalDistanceM: Double,
    val avgEfficiencyWhPerM: Double,
    val co2SavedKg: Double,
    val dailyBreakdown: List<EnergyDailyEntry>,
) {
    /**
     * Whether the response carries a usable window. A real `/energy` response always reports `period_days > 0`, so the
     * full body renders; only the synthetic no-vehicle payload (no period, no totals) routes to the friendly empty
     * surface (web `!stats`) rather than a grid of zeros.
     */
    val hasData: Boolean
        get() =
            periodDays > 0 ||
                totalEnergyUsedWh > 0.0 ||
                totalDistanceM > 0.0 ||
                totalEnergyChargedWh > 0.0 ||
                dailyBreakdown.isNotEmpty()

    /** Average energy used per day in SI watt-hours (web `total_energy_used_wh / period_days`, zero-guarded). */
    val avgEnergyPerDayWh: Double
        get() = if (periodDays > 0) totalEnergyUsedWh / periodDays else 0.0

    /** The daily rows that carry a positive efficiency (web `.filter((d) => d.efficiency_wh_per_m > 0)`). */
    val efficiencyRows: List<EnergyDailyEntry>
        get() = dailyBreakdown.filter { it.efficiencyWhPerM > 0.0 }

    companion object {
        /** The empty snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: EnergyStats = EnergyStats(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/**
 * The decoded `/vehicles/{id}/energy/flow` real-time snapshot — the native analogue of the web `EnergyFlowData` the
 * energy-flow diagram reads (web `useEnergyFlow`). [dcChargingPower] / [acChargingPower] are kW and [energyRemaining]
 * is kWh (reported pre-scaled by the backend, rendered verbatim like the web), [soc] is a 0–100 percentage feeding the
 * radial gauge, and [chargeState] is the live charge label (e.g. `Charging`) or null.
 */
data class EnergyFlow(
    val dcChargingPower: Double,
    val acChargingPower: Double,
    val energyRemaining: Double?,
    val soc: Double,
    val chargeState: String?,
) {
    /** Total instantaneous charge power (web `(dc_charging_power ?? 0) + (ac_charging_power ?? 0)`), in kW. */
    val chargePower: Double get() = dcChargingPower + acChargingPower

    /** Whether the snapshot carries any live signal (else the diagram still renders with its `N/A` fallbacks). */
    val hasLive: Boolean
        get() =
            soc > 0.0 ||
                dcChargingPower != 0.0 ||
                acChargingPower != 0.0 ||
                energyRemaining != null ||
                chargeState != null

    companion object {
        /** The empty snapshot — the diagram draws with greyed-out `N/A` nodes when no live data is available. */
        val EMPTY: EnergyFlow = EnergyFlow(0.0, 0.0, null, 0.0, null)
    }
}

/** The qualitative efficiency tier the metrics badge reports (web `Excellent` / `Good` / `High` / `No Data`). */
enum class EfficiencyTier { NoData, Excellent, Good, High }

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the [unitPref] (distance figures + the derived efficiency unit + the kWh energy default), the grouped-number
 * [locale] and the default [precision] (web `decimal_precision`, floored & non-negative, else 2). SI values are
 * converted to these units ONLY here, at the render boundary (Phase-48 SI-canonical).
 */
data class EnergyFlowDisplayPrefs(
    val unitPref: UnitPref,
    val locale: Locale,
    val precision: Int,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = unitPref.distance.label

    /** The efficiency unit, mirroring the web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    val efficiencyUnit: String get() = if (unitPref.distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** Whether the imperial distance preference is active (drives the efficiency thresholds + scale). */
    private val isImperial: Boolean get() = unitPref.distance == DistanceUnitPref.MI

    /** SI metres → a formatted distance string in the user's unit (web `formatDistance(total_distance_m)`). */
    fun formatDistance(meters: Double?): String = formatDistance(meters, unitPref)

    /** SI watt-hours → a formatted energy string in the user's unit (web `formatEnergy(*_wh)`, defaults to kWh). */
    fun formatEnergy(wattHours: Double?): String = formatEnergy(wattHours, unitPref)

    /** SI metres → the numeric display distance the bar chart plots (web `fromMeters`, shared converter). */
    fun distanceDisplay(meters: Double): Double = convertDistanceFromSI(meters, unitPref.distance)

    /** SI watt-hours → the numeric display energy (kWh) the area chart plots (shared converter). */
    fun energyDisplay(wattHours: Double): Double = convertEnergyFromSI(wattHours, unitPref.energy)

    /** SI Wh/metre → the user's display efficiency (web `* 1000` for Wh/km, `* 1609.344` for Wh/mi). */
    fun efficiencyDisplay(whPerMeter: Double): Double = whPerMeter * if (isImperial) METERS_PER_MILE else METERS_PER_KM

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double?,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)` with no decimals override). */
    fun number(value: Double?): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double?): String = ChartFormat.number(value, 0, locale)

    /**
     * Classifies a display-unit average efficiency into its qualitative tier (web threshold ladder): zero → no data;
     * below the excellent threshold → excellent; below the good threshold → good; otherwise high.
     */
    fun efficiencyTier(displayEfficiency: Double): EfficiencyTier {
        val excellent = if (isImperial) EXCELLENT_THRESHOLD_MI else EXCELLENT_THRESHOLD_KM
        val good = if (isImperial) GOOD_THRESHOLD_MI else GOOD_THRESHOLD_KM
        return when {
            displayEfficiency <= 0.0 -> EfficiencyTier.NoData
            displayEfficiency < excellent -> EfficiencyTier.Excellent
            displayEfficiency < good -> EfficiencyTier.Good
            else -> EfficiencyTier.High
        }
    }

    companion object {
        /** Metric + en-US + 2dp defaults used before settings load (matches the web defaults). */
        val DEFAULT: EnergyFlowDisplayPrefs = fromSettings(null)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): EnergyFlowDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val resolvedLocale =
                unit.locale
                    ?.takeIf { it.isNotBlank() }
                    ?.let(Locale::forLanguageTag)
                    ?: Locale.US
            return EnergyFlowDisplayPrefs(
                unitPref = unit,
                locale = resolvedLocale,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * Decodes the raw `/vehicles/{id}/energy` [json] (SI, snake_case on the wire) into an [EnergyStats]. A non-object
 * input, a missing field, or a JSON-null field all collapse to zero — reproducing the web optional reads.
 */
fun parseEnergyStats(json: JsonElement?): EnergyStats {
    val obj = json as? JsonObject ?: return EnergyStats.EMPTY
    val breakdown = (obj["daily_breakdown"] as? JsonArray).orEmptyRows()
    return EnergyStats(
        periodDays = obj.int("period_days"),
        totalEnergyUsedWh = obj.double("total_energy_used_wh"),
        totalEnergyChargedWh = obj.double("total_energy_charged_wh"),
        totalCost = obj.double("total_cost"),
        totalDistanceM = obj.double("total_distance_m"),
        avgEfficiencyWhPerM = obj.double("avg_efficiency_wh_per_m"),
        co2SavedKg = obj.double("co2_saved_kg"),
        dailyBreakdown = breakdown,
    )
}

/** Decodes the `daily_breakdown` [array] into typed rows, skipping any non-object / dateless element. */
private fun JsonArray?.orEmptyRows(): List<EnergyDailyEntry> {
    if (this == null) return emptyList()
    return mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val date = row.stringField("date") ?: return@mapNotNull null
        EnergyDailyEntry(
            date = date,
            energyWh = row.double("energy_wh"),
            distanceM = row.double("distance_m"),
            efficiencyWhPerM = row.double("efficiency_wh_per_m"),
            cost = row.double("cost"),
        )
    }
}

/** Decodes the raw `/vehicles/{id}/energy/flow` [json] into an [EnergyFlow], null-safe per field. */
fun parseEnergyFlow(json: JsonElement?): EnergyFlow {
    val obj = json as? JsonObject ?: return EnergyFlow.EMPTY
    return EnergyFlow(
        dcChargingPower = obj.double("dc_charging_power"),
        acChargingPower = obj.double("ac_charging_power"),
        energyRemaining = obj.doubleOrNull("energy_remaining"),
        soc = obj.double("soc"),
        chargeState = obj.stringField("charge_state")?.takeIf { it.isNotBlank() },
    )
}

/** The sort keys the daily-energy-history table supports (web `useSortToggle` over the same columns). */
object EnergyHistorySort {
    const val DATE: String = "date"
    const val ENERGY: String = "energy_wh"
    const val DISTANCE: String = "distance_m"
    const val EFFICIENCY: String = "efficiency_wh_per_m"
}

/**
 * Orders the daily [rows] by the active [sortKey] / [ascending] direction — the web `sortFn` over the history table.
 * Date sorts lexicographically (ISO `yyyy-MM-dd` orders chronologically); the numeric columns sort by value. Pure, so
 * the ordering is exercised off-device.
 */
fun sortDailyRows(
    rows: List<EnergyDailyEntry>,
    sortKey: String,
    ascending: Boolean,
): List<EnergyDailyEntry> {
    val ordered =
        when (sortKey) {
            EnergyHistorySort.ENERGY -> rows.sortedBy { it.energyWh }
            EnergyHistorySort.DISTANCE -> rows.sortedBy { it.distanceM }
            EnergyHistorySort.EFFICIENCY -> rows.sortedBy { it.efficiencyWhPerM }
            else -> rows.sortedBy { it.date }
        }
    return if (ascending) ordered else ordered.reversed()
}

/**
 * Formats an ISO `yyyy-MM-dd` [isoDate] as the short `MMM d` label the charts + table show (web `formatDateShort`).
 * A malformed input falls through to the raw string so a row is never blanked. Pure (uses [java.util.Calendar], so it
 * is testable off-device on every API level).
 */
fun formatDayShort(
    isoDate: String,
    locale: Locale = Locale.US,
): String {
    val parts = isoDate.split('-')
    val month = parts.getOrNull(1)?.toIntOrNull()
    val day = parts.getOrNull(2)?.take(2)?.toIntOrNull()
    if (month == null || day == null || month < 1 || month > MONTHS_IN_YEAR || day < 1) return isoDate
    val name = DateFormatSymbols(locale).shortMonths.getOrNull(month - 1)?.takeIf { it.isNotBlank() }
    return if (name != null) "$name $day" else isoDate
}

private const val MONTHS_IN_YEAR = 12

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EnergyFlowPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page calls
 * it from its first composition. Carries no vehicle id, distance, energy or state-of-charge payload.
 */
fun recordEnergyFlowOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to EnergyFlowPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
