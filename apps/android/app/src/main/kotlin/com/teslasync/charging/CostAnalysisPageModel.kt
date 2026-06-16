// Pure, framework-free model + derivations for the CostAnalysisPage charging surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/charging/pages/CostAnalysisPage.tsx
// + web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts). No Compose, no Android UI, no HTTP:
// every declaration here is plain Kotlin (it references only the shared-core ChargingSession DTO and the sibling
// A3 cost-analysis feature-view input shapes), so the composable stays a thin render layer.
//
// The web page owns one big derivation (`useCostAnalysisData`) that folds the loaded charging sessions into the
// eight prop bundles its panels consume (`coreStats`, `monthlyData`, `costPerKwhTrend`, `chargerTypeData`,
// `hourlyData`, `touInsights`, `gasComparison`/`lifetimeMetrics`). This file ports that fold 1:1 and maps each
// result onto the exact input type the matching A3 feature view declares (CostSummaryStats, MonthlyCostPoint,
// MonthlyBucket, CostPerKwhPoint, ChargerTypeDatum, TimeOfUseData, SavingsBaseStats, LifetimeCoreStats /
// LifetimeMetricsData, EnvironmentalImpactData). The forecast JSON (`/analytics/cost-forecast`) is parsed into the
// CostForecastSectionData (the two time-series) + ForecastData (breakdown / gas-comparison / insights) the
// forecast feature views read.
//
// SI boundary (unit-conversion instructions): the page reads SI from the API (Wh, metres) and converts only at
// this derivation boundary, reproducing the web `convertEnergyFromSI(wh, 'kWh')` (÷1000) and
// `convertDistanceFromSI(value, unit)` (÷1000 for km, ÷1609.344 for miles) helpers verbatim — including the web
// page's `toDistanceDisplay(totalDistanceM / 1609.344)` two-step it threads into cost-per-distance and the gas
// comparison. Energy stays SI on the wire and in the cache; this is the single display-conversion point (P1/S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.costanalysis

import io.teslasync.android.featureviews.chargertypebreakdown.ChargerTypeDatum
import io.teslasync.android.featureviews.costforecastsection.CostForecastHistoricalPoint
import io.teslasync.android.featureviews.costforecastsection.CostForecastProjectedPoint
import io.teslasync.android.featureviews.costforecastsection.CostForecastSectionData
import io.teslasync.android.featureviews.costperkwhchart.CostPerKwhPoint
import io.teslasync.android.featureviews.costsummarycards.CostSummaryStats
import io.teslasync.android.featureviews.environmentalimpact.EnvironmentalImpactData
import io.teslasync.android.featureviews.forecastdetails.ForecastData
import io.teslasync.android.featureviews.lifetimesummary.LifetimeCoreStats
import io.teslasync.android.featureviews.lifetimesummary.LifetimeMetricsData
import io.teslasync.android.featureviews.monthlycostchart.MonthlyCostPoint
import io.teslasync.android.featureviews.monthlycosttable.MonthlyBucket
import io.teslasync.android.featureviews.savingscalculator.SavingsBaseStats
import io.teslasync.android.featureviews.timeofuseanalysis.TimeOfUseData
import io.teslasync.android.featureviews.timeofuseanalysis.TouHourBucket
import io.teslasync.android.featureviews.timeofuseanalysis.TouInsights
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `CostAnalysisPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("costAnalysis", "/cost-analysis", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/cost-analysis` deep link) without the nav module depending on it.
 */
object CostAnalysisPageRegistration {
    /** The navigation destination id (Destinations.kt `page("costAnalysis", "/cost-analysis", …)`). */
    const val ROUTE_ID: String = "costAnalysis"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/cost-analysis"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/cost figure. */
    const val SLUG: String = "CostAnalysisPage"

    /** The web `useChargingSessionsPaginated(vehicleId, { limit: 5000, start, end })` window the page reads. */
    const val SESSIONS_LIMIT: Int = 5000

    /** The web `useCostForecast(vehicleId)` default months horizon (`/analytics/cost-forecast?months=6`). */
    const val FORECAST_MONTHS: Int = 6
}

// ── Domain constants (web cost-analysis/constants.ts) ─────────────────────────────────────────────────────────

/** Web `DEFAULT_GAS_PRICE` — the cold-start gas price the summary cards + monthly buckets compute against. */
const val DEFAULT_GAS_PRICE: Double = 3.5

/** Web `DEFAULT_MPG` — the assumed gas-car efficiency the gas-equivalent cost compares against. */
const val DEFAULT_MPG: Double = 30.0

/** Web `CO2_PER_GAL_KG` — kilograms of CO₂ per US gallon of gasoline burned. */
private const val CO2_PER_GAL_KG: Double = 8.887

/** Web `KG_CO2_PER_TREE_YEAR` — kilograms of CO₂ a tree absorbs in one year. */
private const val KG_CO2_PER_TREE_YEAR: Double = 22.0

/** Web `KWH_PER_GALLON` — energy-equivalent kWh per US gallon of gasoline. */
private const val KWH_PER_GALLON: Double = 33.7

/** Watt-hours per kilowatt-hour — the web `convertEnergyFromSI(wh, 'kWh')` divisor. */
private const val WH_PER_KWH: Double = 1000.0

/** Metres per US statute mile — the web `convertDistanceFromSI(_, 'mi')` + `totalDistanceM / 1609.344` divisor. */
private const val METERS_PER_MILE: Double = 1609.344

/** Metres per kilometre — the web `convertDistanceFromSI(_, 'km')` divisor. */
private const val METERS_PER_KM: Double = 1000.0

/** Milliseconds per minute — the web `(end - start) / 60000` duration divisor. */
private const val MILLIS_PER_MINUTE: Double = 60_000.0

/** Public-DC power threshold in watts — the web `categorizeCharger` `peak_power_w > 22_000` cutoff. */
private const val PUBLIC_DC_WATTS: Double = 22_000.0

/** Off-peak window — the web `h >= 22 || h < 6` (10 PM–6 AM) night-charging bracket. */
private const val OFF_PEAK_START_HOUR: Int = 22
private const val OFF_PEAK_END_HOUR: Int = 6

/** Hours in a day — the time-of-use bucket span the web pre-seeds `for (let h = 0; h < 24; h++)`. */
private const val HOURS_PER_DAY: Int = 24

/** Whole percent — the web `(savings / gasCost) * 100`. */
private const val PERCENT: Double = 100.0

// ── Render-ready aggregate (the union of the web page's `useCostAnalysisData` results) ────────────────────────

/**
 * The render-ready model the stateless content layer needs, computed once from the loaded sessions — the native
 * fold of the web page's `useCostAnalysisData` plus the distance-unit context the page resolves from settings.
 * Keeping it pure and Compose-free lets the whole derivation be asserted off-device. Each field is already the
 * exact input type the matching A3 feature view's web-parity overload declares.
 *
 * @property summaryStats the eight figures CostSummaryCards renders, or `null` with no sessions (web `coreStats`).
 * @property monthlyPoints the `{ month, cost }` series MonthlyCostChart plots (web `monthlyData`).
 * @property monthlyBuckets the full monthly rows MonthlyCostTable lists (web `monthlyData`).
 * @property costPerKwhTrend the per-session `{ date, costPerKwh }` series CostPerKwhChart plots (web `costPerKwhTrend`).
 * @property chargerTypeData the per-connector cost/energy/session aggregates ChargerTypeBreakdown renders.
 * @property chargerTotalCost the denominator ChargerTypeBreakdown bars use (web `coreStats?.totalCost ?? 1`).
 * @property timeOfUse the 24 hourly buckets + insights TimeOfUseAnalysis renders (web `hourlyData` + `touInsights`).
 * @property savingsBaseStats the base figures SavingsCalculator computes its gas-vs-EV comparison from.
 * @property lifetimeCoreStats the lifetime totals LifetimeSummary reads (web `coreStats` subset).
 * @property lifetimeMetrics the lifetime per-session averages LifetimeSummary reads (web `lifetimeMetrics`).
 * @property environmental the CO₂/tree/gallon/savings figures EnvironmentalImpact renders (web `coreStats` subset).
 * @property distanceUnit the user's distance-unit abbreviation (`mi` / `km`) threaded into the summary cards.
 * @property isMiles whether the user prefers miles (selects the Cost-Per label's distance word).
 */
data class CostAnalysisData(
    val summaryStats: CostSummaryStats?,
    val monthlyPoints: List<MonthlyCostPoint>,
    val monthlyBuckets: List<MonthlyBucket>,
    val costPerKwhTrend: List<CostPerKwhPoint>,
    val chargerTypeData: List<ChargerTypeDatum>,
    val chargerTotalCost: Double,
    val timeOfUse: TimeOfUseData,
    val savingsBaseStats: SavingsBaseStats?,
    val lifetimeCoreStats: LifetimeCoreStats?,
    val lifetimeMetrics: LifetimeMetricsData?,
    val environmental: EnvironmentalImpactData?,
    val distanceUnit: String,
    val isMiles: Boolean,
)

/** The internal full `coreStats` bundle (web `CoreStats`) the per-feature-view slices are projected from. */
private data class CoreStats(
    val totalCost: Double,
    val totalEnergy: Double,
    val avgCostPerKwh: Double,
    val totalDuration: Double,
    val totalDistanceM: Double,
    val distanceDisplay: Double,
    val costPerDist: Double,
    val gasCost: Double,
    val savings: Double,
    val savingsPercent: Double,
    val co2SavedKg: Double,
    val treeEquiv: Double,
    val gallonsEquiv: Double,
    val count: Int,
)

/** The "mi" / "km" abbreviation for the user's distance preference (web `unitPrefs.distance`). */
const val DISTANCE_UNIT_MILES: String = "mi"
const val DISTANCE_UNIT_KM: String = "km"

// ── The big derivation (web `useCostAnalysisData`) ────────────────────────────────────────────────────────────

/**
 * Folds the loaded [sessions] into the render-ready [CostAnalysisData] — the native 1:1 port of the web
 * `useCostAnalysisData` `useMemo` chain, computed against the cold-start assumptions ([DEFAULT_GAS_PRICE] /
 * [DEFAULT_MPG]) the web page seeds (the interactive SavingsCalculator owns its own live assumptions). [isMiles]
 * selects the distance divisor + label, [zone] the wall clock the monthly + hourly buckets group by (web
 * `new Date(started_at)` local time), and [locale] the per-session trend date label.
 */
fun deriveCostAnalysisData(
    sessions: List<ChargingSession>,
    isMiles: Boolean,
    zone: ZoneId,
    locale: Locale,
): CostAnalysisData {
    val distanceUnit = if (isMiles) DISTANCE_UNIT_MILES else DISTANCE_UNIT_KM
    val core = computeCoreStats(sessions, isMiles)
    val monthly = computeMonthly(sessions, zone)
    val lifetime = computeLifetimeMetrics(sessions, core)
    return CostAnalysisData(
        summaryStats = core?.toSummaryStats(),
        monthlyPoints = monthly.map { MonthlyCostPoint(month = it.month, cost = it.cost) },
        monthlyBuckets = monthly,
        costPerKwhTrend = computeCostPerKwhTrend(sessions, zone, locale),
        chargerTypeData = computeChargerTypeData(sessions),
        chargerTotalCost = core?.totalCost ?: 1.0,
        timeOfUse = computeTimeOfUse(sessions, zone),
        savingsBaseStats = core?.let { SavingsBaseStats(it.totalEnergy, it.totalCost, it.distanceDisplay, monthly.size) },
        lifetimeCoreStats = core?.let { LifetimeCoreStats(it.totalCost, it.totalEnergy, it.count.toDouble()) }, // parity:allow Int->Double widening; "toDo" substring is not a TODO stub
        lifetimeMetrics = lifetime,
        environmental = core?.let { EnvironmentalImpactData(it.co2SavedKg, it.treeEquiv, it.gallonsEquiv, it.savings) },
        distanceUnit = distanceUnit,
        isMiles = isMiles,
    )
}

/** Projects the internal [CoreStats] onto the CostSummaryCards input subset (web `coreStats`). */
private fun CoreStats.toSummaryStats(): CostSummaryStats =
    CostSummaryStats(
        totalCost = totalCost,
        count = count,
        avgCostPerKwh = avgCostPerKwh,
        costPerDist = costPerDist,
        totalEnergy = totalEnergy,
        gallonsEquiv = gallonsEquiv,
        savings = savings,
        savingsPercent = savingsPercent,
    )

/**
 * The web `coreStats` `useMemo` — `null` for an empty list (web `if (!sessions || sessions.length === 0) return
 * null`). Sums cost + SI energy (converted to kWh), the blended rate, total duration, the odometer-delta distance
 * (converted to the display unit through the web `toDistanceDisplay(totalDistanceM / 1609.344)` two-step), the
 * gas-equivalent cost/savings at [DEFAULT_GAS_PRICE], and the CO₂/tree/gallon environmental figures.
 */
private fun computeCoreStats(
    sessions: List<ChargingSession>,
    isMiles: Boolean,
): CoreStats? {
    if (sessions.isEmpty()) return null
    val totalCost = sessions.sumOf { it.costDecimal ?: 0.0 }
    val totalEnergy = convertEnergyKwh(sessions.sumOf { it.totalEnergyAddedWh ?: 0.0 })
    val avgCostPerKwh = if (totalEnergy > 0.0) totalCost / totalEnergy else 0.0
    val totalDuration = sessions.sumOf { durationMinutes(it).toDouble() } // parity:allow Long->Double widening; "toDo" substring is not a TODO stub

    val totalDistanceM = sessions.sumOf { distanceAddedM(it) ?: 0.0 }
    val distanceDisplay = convertDistance(totalDistanceM / METERS_PER_MILE, isMiles)
    val costPerDist = if (distanceDisplay > 0.0) totalCost / distanceDisplay else 0.0

    val gallonsEquiv = totalEnergy / KWH_PER_GALLON
    val gasCost = gallonsEquiv * DEFAULT_GAS_PRICE
    val savings = gasCost - totalCost
    val savingsPercent = if (gasCost > 0.0) savings / gasCost * PERCENT else 0.0

    val co2SavedKg = gallonsEquiv * CO2_PER_GAL_KG
    val treeEquiv = co2SavedKg / KG_CO2_PER_TREE_YEAR

    return CoreStats(
        totalCost = totalCost,
        totalEnergy = totalEnergy,
        avgCostPerKwh = avgCostPerKwh,
        totalDuration = totalDuration,
        totalDistanceM = totalDistanceM,
        distanceDisplay = distanceDisplay,
        costPerDist = costPerDist,
        gasCost = gasCost,
        savings = savings,
        savingsPercent = savingsPercent,
        co2SavedKg = co2SavedKg,
        treeEquiv = treeEquiv,
        gallonsEquiv = gallonsEquiv,
        count = sessions.size,
    )
}

/**
 * The web `monthlyData` `useMemo` — buckets sessions by `yyyy-MM` (local time), then maps each to its kWh energy,
 * blended rate, gas-equivalent cost (web `gasEquivalentCost` at [DEFAULT_MPG] / [DEFAULT_GAS_PRICE]) and savings,
 * sorted ascending by month key. The MonthlyCostTable consumes the full bucket; MonthlyCostChart reads `{ month,
 * cost }`.
 */
private fun computeMonthly(
    sessions: List<ChargingSession>,
    zone: ZoneId,
): List<MonthlyBucket> {
    if (sessions.isEmpty()) return emptyList()
    val buckets = LinkedHashMap<String, MonthAccumulator>()
    sessions.forEach { session ->
        val date = localDateTime(session.startedAt, zone)
        val key = "%04d-%02d".format(date.year, date.monthValue)
        val acc = buckets.getOrPut(key) { MonthAccumulator() }
        acc.cost += session.costDecimal ?: 0.0
        acc.energyWh += session.totalEnergyAddedWh ?: 0.0
        acc.sessions += 1
    }
    return buckets.entries
        .sortedBy { it.key }
        .map { (month, acc) ->
            val energyKwh = convertEnergyKwh(acc.energyWh)
            val gasEquiv = gasEquivalentCost(energyKwh)
            MonthlyBucket(
                month = month,
                cost = acc.cost,
                energy = energyKwh,
                sessions = acc.sessions.toLong(),
                avgCostPerKwh = if (energyKwh > 0.0) acc.cost / energyKwh else 0.0,
                gasEquiv = gasEquiv,
                savings = gasEquiv - acc.cost,
            )
        }
}

private class MonthAccumulator(
    var cost: Double = 0.0,
    var energyWh: Double = 0.0,
    var sessions: Int = 0,
)

/**
 * The web `costPerKwhTrend` `useMemo` — keeps only priced sessions with positive energy (`cost_decimal != null &&
 * total_energy_added_wh > 0`), sorts ascending by start time, and maps each to `{ date, costPerKwh }` where the
 * rate is the raw `cost / (wh / 1000)`.
 */
private fun computeCostPerKwhTrend(
    sessions: List<ChargingSession>,
    zone: ZoneId,
    locale: Locale,
): List<CostPerKwhPoint> {
    if (sessions.isEmpty()) return emptyList()
    val dateFormat = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone)
    return sessions
        .filter { it.costDecimal != null && (it.totalEnergyAddedWh ?: 0.0) > 0.0 }
        .sortedBy { it.startedAt.toEpochMilliseconds() }
        .map { session ->
            CostPerKwhPoint(
                date = dateFormat.format(Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds())),
                costPerKwh = (session.costDecimal ?: 0.0) / ((session.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH),
            )
        }
}

/**
 * The web `chargerTypeData` `useMemo` — groups sessions by [categorizeCharger], summing cost + kWh energy +
 * session count per category, sorted by cost descending. The connector color is resolved inside the
 * ChargerTypeBreakdown feature view, so this carries only the figures.
 */
private fun computeChargerTypeData(sessions: List<ChargingSession>): List<ChargerTypeDatum> {
    if (sessions.isEmpty()) return emptyList()
    val groups = LinkedHashMap<String, MonthAccumulator>()
    sessions.forEach { session ->
        val acc = groups.getOrPut(categorizeCharger(session)) { MonthAccumulator() }
        acc.cost += session.costDecimal ?: 0.0
        acc.energyWh += session.totalEnergyAddedWh ?: 0.0
        acc.sessions += 1
    }
    return groups.entries
        .map { (name, acc) ->
            ChargerTypeDatum(
                name = name,
                cost = acc.cost,
                energyKwh = convertEnergyKwh(acc.energyWh),
                sessions = acc.sessions.toLong(),
            )
        }
        .sortedByDescending { it.cost }
}

/**
 * The web `hourlyData` + `touInsights` `useMemo`s — pre-seeds all 24 hours, buckets each session by its local
 * start hour, and folds the populated hours into the cheapest / priciest / busiest insight picks plus the
 * off-peak (10 PM–6 AM) share. With no populated hour the insights resolve to `null` (web `withSessions.length
 * === 0`), which the feature view renders as its "No insights available" surface.
 */
private fun computeTimeOfUse(
    sessions: List<ChargingSession>,
    zone: ZoneId,
): TimeOfUseData {
    if (sessions.isEmpty()) return TimeOfUseData(emptyList(), null)
    val buckets = Array(HOURS_PER_DAY) { HourAccumulator() }
    sessions.forEach { session ->
        val hour = localDateTime(session.startedAt, zone).hour
        val acc = buckets[hour]
        acc.sessions += 1
        acc.cost += session.costDecimal ?: 0.0
        acc.energyWh += session.totalEnergyAddedWh ?: 0.0
    }
    val hourly =
        buckets.mapIndexed { hour, acc ->
            TouHourBucket(
                hour = hour,
                label = "%02d:00".format(hour),
                sessions = acc.sessions.toLong(),
                avgCost = if (acc.sessions > 0) acc.cost / acc.sessions else 0.0,
                totalEnergy = convertEnergyKwh(acc.energyWh),
            )
        }

    val withSessions = hourly.filter { it.sessions > 0L }
    val insights =
        if (withSessions.isEmpty()) {
            null
        } else {
            val offPeakCount = sessions.count { localDateTime(it.startedAt, zone).hour.let { h -> h >= OFF_PEAK_START_HOUR || h < OFF_PEAK_END_HOUR } }
            TouInsights(
                cheapest = withSessions.minByOrNull { it.avgCost }!!,
                priciest = withSessions.maxByOrNull { it.avgCost }!!,
                busiest = withSessions.maxByOrNull { it.sessions }!!,
                offPeakPct = if (sessions.isNotEmpty()) offPeakCount.toDouble() / sessions.size * PERCENT else 0.0, // parity:allow Int->Double widening; "toDo" substring is not a TODO stub
            )
        }
    return TimeOfUseData(hourlyData = hourly, insights = insights)
}

private class HourAccumulator(
    var sessions: Int = 0,
    var cost: Double = 0.0,
    var energyWh: Double = 0.0,
)

/**
 * The web `lifetimeMetrics` `useMemo` — `null` for an empty list or absent [core] (web `if (!sessions || ... ||
 * !coreStats) return null`). The five averages LifetimeSummary reads: per-session cost / energy / duration plus
 * the free-session count and their summed energy (in kWh, the feature view's documented contract).
 */
private fun computeLifetimeMetrics(
    sessions: List<ChargingSession>,
    core: CoreStats?,
): LifetimeMetricsData? {
    if (sessions.isEmpty() || core == null) return null
    val count = core.count
    val freeSessions = sessions.filter { it.costDecimal == null || it.costDecimal == 0.0 }
    return LifetimeMetricsData(
        avgSessionCost = if (count > 0) core.totalCost / count else 0.0,
        avgSessionEnergy = if (count > 0) core.totalEnergy / count else 0.0,
        avgDuration = if (count > 0) core.totalDuration / count else 0.0,
        freeCount = freeSessions.size.toDouble(), // parity:allow Int->Double widening; "toDo" substring is not a TODO stub
        freeEnergy = convertEnergyKwh(freeSessions.sumOf { it.totalEnergyAddedWh ?: 0.0 }),
    )
}

// ── Session-level helpers (web cost-analysis/helpers.ts + charging-curve/helpers.ts) ──────────────────────────

/** Web `categorizeCharger` — Supercharger / Public DC / Work-L2 / Home from the charger type, power and place. */
fun categorizeCharger(session: ChargingSession): String {
    val type = (session.chargerType ?: "").lowercase(Locale.US)
    if (type.contains("tesla") || type.contains("supercharger")) return "Supercharger"
    if ((session.peakPowerW ?: 0.0) > PUBLIC_DC_WATTS) return "Public DC"
    val place = (session.startPlace ?: "").lowercase(Locale.US)
    if (place.contains("work") || place.contains("office")) return "Work / L2"
    return "Home"
}

/** Web `gasEquivalentCost(energyKwh, mpg, gasPrice)` — reduces to `(energyKwh / KWH_PER_GALLON) * gasPrice`. */
private fun gasEquivalentCost(energyKwh: Double): Double = energyKwh / KWH_PER_GALLON * DEFAULT_GAS_PRICE

/**
 * Web `distanceAddedM` — the positive odometer delta in SI metres, or `null` when either bound is missing or the
 * delta is non-positive (so a malformed row never skews the distance total).
 */
fun distanceAddedM(session: ChargingSession): Double? {
    val start = session.startOdometerM ?: return null // parity:allow odometer DTO field carries a "tOdo" substring, not a TODO stub
    val end = session.endOdometerM ?: return null
    val delta = end - start
    return if (delta > 0.0) delta else null
}

/**
 * Web `durationMinutes(started_at, ended_at)` — rounded whole minutes, 0 for a still-open session (no `ended_at`)
 * or a non-positive range (web `end <= start`). Computed from the SI [kotlin.time.Instant]s directly.
 */
fun durationMinutes(session: ChargingSession): Long {
    val end = session.endedAt ?: return 0L
    val deltaMs = end.toEpochMilliseconds() - session.startedAt.toEpochMilliseconds()
    if (deltaMs <= 0L) return 0L
    return Math.round(deltaMs / MILLIS_PER_MINUTE)
}

/** Web `convertEnergyFromSI(wh, 'kWh')` — watt-hours to kilowatt-hours. */
private fun convertEnergyKwh(wh: Double): Double = wh / WH_PER_KWH

/** Web `convertDistanceFromSI(value, unit)` — the ÷1000 (km) / ÷1609.344 (mi) display divisor. */
private fun convertDistance(
    value: Double,
    isMiles: Boolean,
): Double = if (isMiles) value / METERS_PER_MILE else value / METERS_PER_KM

private fun localDateTime(
    instant: kotlin.time.Instant,
    zone: ZoneId,
) = Instant.ofEpochMilli(instant.toEpochMilliseconds()).atZone(zone)

// ── Forecast JSON parsing (web `useCostForecast` → CostForecastData) ──────────────────────────────────────────

/** Lenient decoder for the `/analytics/cost-forecast` payload — ignores the keys a sibling chart owns. */
private val forecastJson = Json { ignoreUnknownKeys = true }

/**
 * Parses the raw `/analytics/cost-forecast` payload into the CostForecastSection time-series — the web
 * `forecastData.historical` (`{ month, cost, cost_per_kwh }`) and `forecastData.forecast` (`{ month, cost,
 * cost_low, cost_high }`). A `null` / non-object payload yields the empty section (both reads resolve to their
 * friendly empty states), so a still-loading forecast never blanks a panel.
 */
fun parseForecastSection(json: JsonElement?): CostForecastSectionData {
    val obj = json as? JsonObject ?: return CostForecastSectionData.EMPTY
    val historical =
        (obj["historical"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { row ->
            CostForecastHistoricalPoint(
                month = row.str("month"),
                cost = row.dbl("cost"),
                costPerKwh = row.dbl("cost_per_kwh"),
            )
        }
    val forecast =
        (obj["forecast"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { row ->
            CostForecastProjectedPoint(
                month = row.str("month"),
                cost = row.dbl("cost"),
                costLow = row.dbl("cost_low"),
                costHigh = row.dbl("cost_high"),
            )
        }
    return CostForecastSectionData(historical = historical, forecast = forecast)
}

/**
 * Decodes the raw `/analytics/cost-forecast` payload into the ForecastDetails subset (`breakdown`,
 * `gas_comparison`, `insights`). [ForecastData] is `@Serializable` with defaults + an unknown-key-skipping
 * decoder, so a `null`, partial, or malformed payload resolves to its all-default value (the feature view's empty
 * states) rather than throwing.
 */
fun parseForecastDetails(json: JsonElement?): ForecastData {
    if (json == null) return ForecastData()
    return runCatching { forecastJson.decodeFromJsonElement(ForecastData.serializer(), json) }.getOrDefault(ForecastData())
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

private fun JsonObject.str(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

private fun JsonObject.dbl(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CostAnalysisPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, cost, energy, savings, or session-count figure.
 */
fun recordCostAnalysisPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CostAnalysisPageRegistration.SLUG))
}
