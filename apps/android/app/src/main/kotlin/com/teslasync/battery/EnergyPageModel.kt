// Pure, framework-free model + projections for the EnergyPage battery surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/battery/pages/EnergyPage.tsx). No Compose, no Android
// UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free UiState projection and the
// shared-core Resource/units), so the composable stays a thin render layer and all of this is exercised off-device by
// the :app:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the raw SI JSON the page reads — the primary
// `/vehicles/{id}/energy` stats and the `/charging-telemetry/latest` live snapshot — into typed, null-safe models
// (web optional-chaining → null-safe reads); (2) the typed paginated `/charging` sessions feed (the generated
// [ChargingSession] SI DTO); (3) every derivation the panels read (period totals, cost-per-distance, cost-per-kWh,
// monthly/yearly projections, the time-of-day buckets, the charger-type breakdown, the daily energy/efficiency
// series); and (4) the display-boundary unit + currency derivation from the `/settings` document ([EnergyDisplayPrefs],
// web `useUnits`/`useFormatting`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): energy is watt-hours, distance is metres, efficiency is
// watt-hours per metre, power is watts on the wire and through the cache; the user's display unit is applied ONLY here
// at the render boundary via [EnergyDisplayPrefs] (the shared `convertDistanceFromSI`/`convertEnergyFromSI`/
// `convertPowerFromSI`). Every web formula is reproduced verbatim, including the two efficiency-gauge scalings, so the
// native gauge behaves exactly like the web one for the same payload.
//
// Empty-state fidelity (Honesty Covenant #9): the web never blanks the page when stats are empty — it renders the full
// body with an honest empty hero (the `hasNoEnergyData` gate) plus each chart/table's own empty-state. This surface
// reproduces that exactly: the page body renders on every non-loading, non-error state, and [hasNoEnergyData] +
// per-section emptiness drive the in-body empty surfaces rather than a page-level blank.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.energy

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.convertPowerFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** Default currency / number fraction digits (web `_globalPrecision` + `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/** 1 km = 1000 m — the SI bridge used wherever a per-km/Wh-per-km scaling is needed (web `1000` literals). */
private const val METERS_PER_KM = 1000.0

/** 1 mile = 1.609344 km — the Wh/m → Wh/mi scale the web `toEfficiencyDisplay` applies for an imperial pref. */
private const val METERS_PER_MILE = 1609.344

/** 1 kWh = 1000 Wh — the bridge cost-per-kWh divides by (web `totalEnergy / 1000`). */
private const val WH_PER_KWH = 1000.0

/** The trailing window the page reads (web `defaultStartDate = today - 30`, `useEnergyStats(id, 30)`). */
const val ENERGY_WINDOW_DAYS = 30

/** Days per month / months per year / days per year for the cost projections (web `* 30` / `* 12` / `* 365`). */
private const val DAYS_PER_MONTH = 30.0
private const val MONTHS_PER_YEAR = 12.0
private const val DAYS_PER_YEAR = 365.0

/** CO₂ kg saved per Wh used, the web fallback when the API omits `co2_saved_kg` (web `totalEnergy * 0.42`). */
private const val CO2_KG_PER_WH = 0.42

/** Gas-equivalent cost factor over SI distance (web `totalDistance * 0.12`). */
private const val GAS_EQUIVALENT_FACTOR = 0.12

/** Efficiency-gauge ceiling argument (web `max={toEfficiencyDisplay(300)}`), fed through the same scaling as the value. */
private const val EFFICIENCY_GAUGE_CEILING = 300.0

/** Hero-gauge head-room multipliers + floors (web `Math.max(value * k, floor)`). */
private const val ENERGY_GAUGE_HEADROOM = 1.3
private const val ENERGY_GAUGE_FLOOR = 100.0
private const val CO2_GAUGE_HEADROOM = 1.5
private const val CO2_GAUGE_FLOOR = 50.0
private const val COST_GAUGE_HEADROOM = 1.5
private const val COST_GAUGE_FLOOR = 50.0

/** Whole percent (web `* 100`). */
private const val PERCENT = 100.0

/** Zero-decimal currency for the gauge total-cost label is implicit; the table $/kWh uses 3 decimals (web precision 3). */
private const val PER_KWH_DECIMALS = 3

/** Most-recent sessions shown in the table (web `sessions.slice(0, 15)`). */
const val RECENT_SESSIONS_LIMIT = 15

/** The four time-of-day buckets, by start hour (web `hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3`). */
const val SLOT_NIGHT = 0
const val SLOT_MORNING = 1
const val SLOT_AFTERNOON = 2
const val SLOT_EVENING = 3
private const val HOUR_MORNING = 6
private const val HOUR_AFTERNOON = 12
private const val HOUR_EVENING = 18

/**
 * The charger-type buckets — the web `classifyChargerType` returns (web/src/features/battery/pages/EnergyPage.tsx):
 * a Tesla connector ⇒ Supercharger, any other non-empty connector ⇒ DC Fast, an absent connector ⇒ Home/AC. The
 * labels are rendered verbatim by the web (not i18n keys), so they stay literals here too, mirroring the established
 * `ChargeSessionChartWidget` charger-type precedent.
 */
const val CHARGER_SUPERCHARGER = "Supercharger"
const val CHARGER_DC_FAST = "DC Fast"
const val CHARGER_HOME_AC = "Home/AC"
private const val TESLA_TOKEN = "tesla"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `EnergyPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("energy", "/energy", …)`, so the host binds this surface to that destination (and its `/energy` deep link)
 * without the nav module depending on it.
 */
object EnergyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("energy", "/energy", …)`). */
    const val ROUTE_ID: String = "energy"

    /** The web route this surface ports (`/energy`). */
    const val WEB_PATH: String = "/energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "EnergyPage"
}

/** One decoded `daily_breakdown` row — the SI series the two daily charts plot (web `dailyEnergy[]`). */
data class EnergyDailyPoint(
    val date: String,
    val energyWh: Double,
    val distanceM: Double,
    val efficiencyWhPerM: Double,
)

/**
 * The decoded `/vehicles/{id}/energy` payload (web `EnergyStats`). [avgEfficiencyWhPerM] is SI Wh/m, [totalDistanceM]
 * is SI metres, energy fields are SI Wh; [co2SavedKg] is kg, [totalCost] is fiat. Missing / JSON-null fields collapse
 * to zero, exactly like the web optional reads.
 */
data class EnergyStats(
    val totalEnergyUsedWh: Double,
    val totalEnergyChargedWh: Double,
    val totalWh: Double,
    val avgEfficiencyWhPerM: Double,
    val totalDistanceM: Double,
    val totalCost: Double,
    val co2SavedKg: Double,
    val dailyBreakdown: List<EnergyDailyPoint>,
) {
    /**
     * Whether the stats payload itself carries any energy/distance signal — the stats half of the web `hasNoEnergyData`
     * gate (`total_wh === 0 && total_energy_used_wh === 0 && total_distance_m === 0`).
     */
    val hasStatsData: Boolean
        get() = totalWh > 0.0 || totalEnergyUsedWh > 0.0 || totalDistanceM > 0.0

    /** Whether anything is renderable at all (used as the primary feed's emptiness gate). */
    val hasData: Boolean
        get() = hasStatsData || totalCost > 0.0 || co2SavedKg > 0.0 || dailyBreakdown.isNotEmpty()

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload (and the no-vehicle scope). */
        val EMPTY: EnergyStats = EnergyStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, emptyList())
    }
}

/** The decoded `/charging-telemetry/latest` snapshot the lifetime panel reads (web `liveCharging`). */
data class EnergyLive(
    val lifetimeEnergyUsedKwh: Double?,
) {
    companion object {
        val EMPTY: EnergyLive = EnergyLive(null)
    }
}

/** One time-of-day bucket the charging-by-time bar chart plots (web `timeOfDayData[]`): a [slot] + count + energy. */
data class EnergyTimeBucket(
    val slot: Int,
    val count: Int,
    val energyWh: Double,
)

/** One charger-type slice the breakdown pie + legend draw (web `chargerBreakdown[]`): label + count + energy + cost. */
data class EnergyChargerSlice(
    val label: String,
    val count: Int,
    val energyWh: Double,
    val cost: Double,
) {
    /** Cost per kWh for this slice, or 0 when no energy accrued (web `energy > 0 ? cost / (energy / 1000) : 0`). */
    val costPerKwh: Double
        get() = if (energyWh > 0.0) cost / (energyWh / WH_PER_KWH) else 0.0
}

/** One formatted recent-session row the table renders (web `sessionColumns`), each value already at the display boundary. */
data class EnergySessionRow(
    val id: Long,
    val date: String,
    val energy: String,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val power: String,
    val chargerLabel: String,
    val isSupercharger: Boolean,
    val isFast: Boolean,
    val cost: String,
    val perKwh: String,
)

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [distanceUnit] + [energyUnit] + [powerUnit] (figures + their derived labels), the
 * [currencySymbol] (blank → "$"), the currency/number [precision] (web `decimal_precision`, floored & non-negative,
 * else 2), and the [locale] used for grouped-number formatting.
 */
data class EnergyDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val energyUnit: EnergyUnitPref,
    val powerUnit: PowerUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = distanceUnit.label

    /** The energy unit's display label (e.g. "kWh" / "Wh"). */
    val energyLabel: String get() = energyUnit.label

    /** The efficiency unit, mirroring the web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`. */
    val efficiencyUnit: String get() = if (distanceUnit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI metres → the user's display distance (web `toDistanceDisplay` ▸ `convertDistanceFromSI`). */
    fun fromMeters(meters: Double): Double = convertDistanceFromSI(meters, distanceUnit)

    /** SI watt-hours → the user's display energy (web `toEnergyDisplay` ▸ `convertEnergyFromSI`). */
    fun fromWh(wh: Double): Double = convertEnergyFromSI(wh, energyUnit)

    /** SI watts → the user's display power (web `convertPowerFromSI`). */
    fun fromWatts(watts: Double): Double = convertPowerFromSI(watts, powerUnit)

    /**
     * SI Wh/m → the user's display efficiency, reproducing the web `toEfficiencyDisplay` verbatim
     * (`distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000`).
     */
    fun toEfficiencyDisplay(whPerM: Double): Double =
        if (distanceUnit == DistanceUnitPref.MI) whPerM * METERS_PER_MILE else whPerM * METERS_PER_KM

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** Currency as the web `formatCurrency` renders it — the [currencySymbol] + a grouped number at [decimals]. */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, decimals.coerceAtLeast(0))

    /** Display energy with its unit suffix (web `formatEnergy`), e.g. "12.3 kWh". */
    fun energyWithUnit(wh: Double): String = "${number(fromWh(wh))} $energyLabel"

    companion object {
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: EnergyDisplayPrefs =
            EnergyDisplayPrefs(
                distanceUnit = DistanceUnitPref.KM,
                energyUnit = EnergyUnitPref.KWH,
                powerUnit = PowerUnitPref.KW,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): EnergyDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringField(KEY_CURRENCY_SYMBOL)?.trim()
            return EnergyDisplayPrefs(
                distanceUnit = unit.distance,
                energyUnit = unit.energy,
                powerUnit = unit.power,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * Every cross-feed figure the panels read, derived once from the decoded [stats] + [sessions] + [live] (web's block of
 * `useMemo`/inline derivations). All values stay SI here; conversion happens only when a panel formats them through
 * [EnergyDisplayPrefs]. [periodDays] is the trailing window (the page's fixed 30-day default).
 */
class EnergyDerived(
    val stats: EnergyStats,
    sessions: List<ChargingSession>,
    val live: EnergyLive,
    private val periodDays: Int = ENERGY_WINDOW_DAYS,
) {
    /** Total energy added across the window's sessions in SI Wh (web `sessions.reduce(+total_energy_added_wh)`). */
    val totalEnergyWh: Double = sessions.sumOf { it.totalEnergyAddedWh ?: 0.0 }

    /** Total cost across the window's sessions (web `sessions.reduce(+cost_decimal)`). */
    val totalCost: Double = sessions.sumOf { it.costDecimal ?: 0.0 }

    /** Average efficiency in SI Wh/m straight from the stats feed (web `stats.avg_efficiency_wh_per_m`). */
    val avgEfficiencyWhPerM: Double = stats.avgEfficiencyWhPerM

    /** Total distance in SI metres straight from the stats feed (web `stats.total_distance_m`). */
    val totalDistanceM: Double = stats.totalDistanceM

    /** CO₂ saved in kg — the stats value, or the web Wh-based fallback (`co2_saved_kg ?? totalEnergy * 0.42`). */
    val co2SavedKg: Double = if (stats.co2SavedKg != 0.0) stats.co2SavedKg else totalEnergyWh * CO2_KG_PER_WH

    /** Session count in the window (web `sessions.length`). */
    val sessionCount: Int = sessions.size

    /** Cost per SI metre (web's `costPerKm` — named per-km but computed over `total_distance_m`). */
    private val costPerMeter: Double = if (totalDistanceM > 0.0) totalCost / totalDistanceM else 0.0

    /** Cost per kWh (web `totalEnergy > 0 ? totalCost / (totalEnergy / 1000) : 0`). */
    val costPerKwh: Double = if (totalEnergyWh > 0.0) totalCost / (totalEnergyWh / WH_PER_KWH) else 0.0

    /** Gas-equivalent cost over the window (web `totalDistance * 0.12`). */
    val gasEquivalent: Double = totalDistanceM * GAS_EQUIVALENT_FACTOR

    /** Projected monthly cost (web `costPerKm * (totalDistance / periodDays) * 30`). */
    val monthlyProjectedCost: Double =
        if (costPerMeter > 0.0) costPerMeter * (totalDistanceM / periodDays) * DAYS_PER_MONTH else 0.0

    /** Projected yearly cost (web `monthlyProjectedCost * 12`). */
    val yearlyProjectedCost: Double = monthlyProjectedCost * MONTHS_PER_YEAR

    /** Projected annual gas-equivalent cost (web `(gasEquivalent / periodDays) * 365`). */
    val annualGasEquivalent: Double = (gasEquivalent / periodDays) * DAYS_PER_YEAR

    /** The trailing-window length shown in the lifetime + cost labels (web `periodDays`). */
    val windowDays: Int = periodDays

    /**
     * Whether NO energy data exists yet — the web `hasNoEnergyData` gate (no sessions AND no stats signal). Drives the
     * honest empty hero instead of four zeroed gauges.
     */
    val hasNoEnergyData: Boolean = sessionCount == 0 && !stats.hasStatsData

    /** Display energy used in the gauge (web `toEnergyDisplay(totalEnergy)`). */
    fun energyGaugeValue(prefs: EnergyDisplayPrefs): Double = prefs.fromWh(totalEnergyWh)

    /** Gauge ceiling for energy (web `Math.max(toEnergyDisplay(totalEnergy) * 1.3, 100)`). */
    fun energyGaugeMax(prefs: EnergyDisplayPrefs): Double =
        maxOf(prefs.fromWh(totalEnergyWh) * ENERGY_GAUGE_HEADROOM, ENERGY_GAUGE_FLOOR)

    /**
     * Display efficiency in the gauge, reproducing the web value expression verbatim
     * (`toEfficiencyDisplay(avgEfficiency || (totalDistance > 0 ? (totalEnergy * 1000) / totalDistance : 0))`).
     */
    fun efficiencyGaugeValue(prefs: EnergyDisplayPrefs): Double {
        val whPerM =
            if (avgEfficiencyWhPerM != 0.0) {
                avgEfficiencyWhPerM
            } else if (totalDistanceM > 0.0) {
                (totalEnergyWh * METERS_PER_KM) / totalDistanceM
            } else {
                0.0
            }
        return prefs.toEfficiencyDisplay(whPerM)
    }

    /** Efficiency gauge ceiling (web `max={toEfficiencyDisplay(300)}`). */
    fun efficiencyGaugeMax(prefs: EnergyDisplayPrefs): Double = prefs.toEfficiencyDisplay(EFFICIENCY_GAUGE_CEILING)

    /** CO₂ gauge ceiling (web `Math.max(co2Saved * 1.5, 50)`). */
    fun co2GaugeMax(): Double = maxOf(co2SavedKg * CO2_GAUGE_HEADROOM, CO2_GAUGE_FLOOR)

    /** Total-cost gauge ceiling (web `Math.max(totalCost * 1.5, 50)`). */
    fun costGaugeMax(): Double = maxOf(totalCost * COST_GAUGE_HEADROOM, COST_GAUGE_FLOOR)

    /** Lifetime energy used (kWh) from the live snapshot, or null when absent (web `liveCharging?.lifetime_energy_used`). */
    val lifetimeEnergyUsedKwh: Double? = live.lifetimeEnergyUsedKwh

    /** The daily SI series both charts share (web `stats.daily_breakdown`). */
    val daily: List<EnergyDailyPoint> = stats.dailyBreakdown
}

/** Savings for a cost-comparison card (web `CostComparisonCard`): EV cost vs gas, the difference, and the percent. */
data class EnergyCostComparison(
    val evCost: Double,
    val gasCost: Double,
) {
    /** Absolute saving (web `gasCost - evCost`). */
    val savings: Double get() = gasCost - evCost

    /** Saving as a percent of the gas cost, 0 when gas cost is non-positive (web `gasCost > 0 ? … : 0`). */
    val savingsPercent: Double get() = if (gasCost > 0.0) (savings / gasCost) * PERCENT else 0.0
}

/**
 * Decodes the raw `/vehicles/{id}/energy` [json] (SI, snake_case on the wire) into an [EnergyStats]. A non-object
 * input, a missing field, or a JSON-null field all collapse to zero / empty — reproducing the web optional reads.
 */
fun parseEnergyStats(json: JsonElement?): EnergyStats {
    val obj = json as? JsonObject ?: return EnergyStats.EMPTY
    val daily =
        (obj["daily_breakdown"] as? JsonArray).orEmpty().mapNotNull { element ->
            val row = element as? JsonObject ?: return@mapNotNull null
            EnergyDailyPoint(
                date = row.stringField("date") ?: return@mapNotNull null,
                energyWh = row.double("energy_wh"),
                distanceM = row.double("distance_m"),
                efficiencyWhPerM = row.double("efficiency_wh_per_m"),
            )
        }
    return EnergyStats(
        totalEnergyUsedWh = obj.double("total_energy_used_wh"),
        totalEnergyChargedWh = obj.double("total_energy_charged_wh"),
        totalWh = obj.double("total_wh"),
        avgEfficiencyWhPerM = obj.double("avg_efficiency_wh_per_m"),
        totalDistanceM = obj.double("total_distance_m"),
        totalCost = obj.double("total_cost"),
        co2SavedKg = obj.double("co2_saved_kg"),
        dailyBreakdown = daily,
    )
}

/**
 * Decodes the live `/charging-telemetry/latest` [json] into an [EnergyLive]. The web reads the optional
 * `lifetime_energy_used` (kWh) carve-out; an absent / non-object / JSON-null payload yields a null lifetime value so
 * the panel shows its em-dash fallback.
 */
fun parseEnergyLive(json: JsonElement?): EnergyLive {
    val obj = json as? JsonObject ?: return EnergyLive.EMPTY
    return EnergyLive(lifetimeEnergyUsedKwh = obj.doubleOrNull("lifetime_energy_used"))
}

/**
 * Buckets the window's [sessions] into the four time-of-day slots by local start hour (web `timeOfDayData`). Every slot
 * is always present (count + energy may be zero) so the bar chart has a stable four-column x-axis.
 */
fun timeOfDayBuckets(
    sessions: List<ChargingSession>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<EnergyTimeBucket> {
    val counts = IntArray(SLOT_EVENING + 1)
    val energy = DoubleArray(SLOT_EVENING + 1)
    sessions.forEach { session ->
        val hour = Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds()).atZone(zone).hour
        val slot =
            when {
                hour < HOUR_MORNING -> SLOT_NIGHT
                hour < HOUR_AFTERNOON -> SLOT_MORNING
                hour < HOUR_EVENING -> SLOT_AFTERNOON
                else -> SLOT_EVENING
            }
        counts[slot] += 1
        energy[slot] += session.totalEnergyAddedWh ?: 0.0
    }
    return (SLOT_NIGHT..SLOT_EVENING).map { slot -> EnergyTimeBucket(slot, counts[slot], energy[slot]) }
}

/** Classifies one session's connector into a charger-type label (web `classifyChargerType`). */
fun chargerLabel(session: ChargingSession): String {
    val type = session.chargerType
    return when {
        type != null && type.lowercase(Locale.ROOT).contains(TESLA_TOKEN) -> CHARGER_SUPERCHARGER
        !type.isNullOrEmpty() -> CHARGER_DC_FAST
        else -> CHARGER_HOME_AC
    }
}

/**
 * Aggregates the window's [sessions] into charger-type slices (web `chargerBreakdown`), each carrying its session
 * count, SI energy total, and cost. Ordered by first appearance so the pie + legend stay stable across recompositions.
 */
fun chargerBreakdown(sessions: List<ChargingSession>): List<EnergyChargerSlice> {
    if (sessions.isEmpty()) return emptyList()
    val order = mutableListOf<String>()
    val counts = mutableMapOf<String, Int>()
    val energy = mutableMapOf<String, Double>()
    val cost = mutableMapOf<String, Double>()
    sessions.forEach { session ->
        val label = chargerLabel(session)
        if (label !in counts) order += label
        counts[label] = (counts[label] ?: 0) + 1
        energy[label] = (energy[label] ?: 0.0) + (session.totalEnergyAddedWh ?: 0.0)
        cost[label] = (cost[label] ?: 0.0) + (session.costDecimal ?: 0.0)
    }
    return order.map { label ->
        EnergyChargerSlice(
            label = label,
            count = counts[label] ?: 0,
            energyWh = energy[label] ?: 0.0,
            cost = cost[label] ?: 0.0,
        )
    }
}

/**
 * Projects the most-recent [sessions] (capped at [RECENT_SESSIONS_LIMIT], web `slice(0, 15)`) into the formatted table
 * rows the surface renders — each figure already converted/formatted at the display boundary via [prefs].
 */
fun recentSessionRows(
    sessions: List<ChargingSession>,
    prefs: EnergyDisplayPrefs,
    zone: ZoneId = ZoneId.systemDefault(),
): List<EnergySessionRow> =
    sessions.take(RECENT_SESSIONS_LIMIT).map { session ->
        val label = chargerLabel(session)
        val isTesla = label == CHARGER_SUPERCHARGER
        val isFast = !session.chargerType.isNullOrEmpty()
        EnergySessionRow(
            id = session.id,
            date = formatSessionDate(session.startedAt.toEpochMilliseconds(), zone, prefs.locale),
            energy = prefs.energyWithUnit(session.totalEnergyAddedWh ?: 0.0),
            startSocPct = session.startSocPct,
            endSocPct = session.endSocPct,
            power = session.peakPowerW?.let { "${prefs.number(prefs.fromWatts(it))} ${prefs.powerUnit.label}" } ?: EM_DASH,
            chargerLabel = if (isTesla) CHARGER_SUPERCHARGER else session.chargerType ?: "AC",
            isSupercharger = isTesla,
            isFast = isFast,
            cost = session.costDecimal?.let { prefs.currency(it) } ?: EM_DASH,
            perKwh =
                if (session.costDecimal != null && (session.totalEnergyAddedWh ?: 0.0) > 0.0) {
                    prefs.currency(session.costDecimal!! / convertEnergyFromSI(session.totalEnergyAddedWh!!, EnergyUnitPref.KWH), PER_KWH_DECIMALS)
                } else {
                    EM_DASH
                },
        )
    }

/** Em dash shown for a missing value (web `'—'`). */
const val EM_DASH: String = "\u2014"

private val SESSION_DATE_PATTERN = "MMM d, yyyy"

private fun formatSessionDate(
    millis: Long,
    zone: ZoneId,
    locale: Locale,
): String =
    DateTimeFormatter
        .ofPattern(SESSION_DATE_PATTERN, locale)
        .format(Instant.ofEpochMilli(millis).atZone(zone))

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonArray?.orEmpty(): JsonArray = this ?: JsonArray(emptyList())

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EnergyPageRegistration.SLUG] (P1/S11). Kept free of
 * Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition. Carries no
 * vehicle id, distance, cost or energy payload.
 */
fun recordEnergyOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EnergyPageRegistration.SLUG))
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
