// Pure, framework-free model + derivations for the AnalyticsPage parity surface — the native analogue of
// everything the web page computes before it returns JSX (web/src/features/analytics/pages/AnalyticsPage.tsx
// plus its components/analytics/* sub-tabs: HeroGauges, OverviewTab + OverviewVehicleComparison, DrivingTab +
// DrivingPerformanceCards + DrivingTemperatureStats, ChargingTab + ChargingDetailSection, BatteryTab). No
// Compose, no Android UI, no HTTP lives here: the deep-analytics feed arrives as the shared, already-decoded
// S8 payload (the KMP `AnalyticsStore.fleetAnalytics(days, start, end)` ▸ `GET /analytics/fleet`, a raw
// verbatim-SI `JsonElement`, web `useFleetAnalytics`), so this file owns only the parse into a typed model
// plus the page's framework-free derivations: the tab catalog, the range presets (web RangePicker), the
// efficiency leaderboard sort, the radar-normalisation fold, the empty guards each panel branches on, and the
// one PII-safe `view.opened` diagnostic. Every value stays SI here; unit conversion + number/currency
// formatting is the render boundary's job (S5, AnalyticsPageFormat.kt).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/analytics — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling A7 surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Canonical metadata for this surface. The web page is a top-level route, not a draggable dashboard widget,
 * so there is no web registry row to mirror — this object carries the cross-cutting concerns the surface
 * owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11). It carries no analytics values.
 */
object AnalyticsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("analytics", "/analytics", NavGroup.Analytics)`). */
    const val ROUTE_ID: String = "analytics"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no fleet content. */
    const val SLUG: String = "AnalyticsPage"
}

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * The four in-page tabs in their web declaration order (web `AnalyticsPage` `tabs` memo + `TAB_KEYS`). The
 * [wire] token is the stable key the [io.teslasync.android.components.ui.TabNav] round-trips; the render
 * boundary maps each to its localized label + glyph.
 */
enum class AnalyticsTab(
    val wire: String,
) {
    OVERVIEW("overview"),
    DRIVING("driving"),
    CHARGING("charging"),
    BATTERY("battery"),
    ;

    companion object {
        /** Resolves a tab from a [TabNav] wire token, falling back to [OVERVIEW] for any unknown value. */
        fun fromWire(wire: String): AnalyticsTab = entries.firstOrNull { it.wire == wire } ?: OVERVIEW
    }
}

/**
 * A date-range preset (web `RangePicker` `presetIds = ['7d','30d','90d','1y','all']`). [days] is the
 * trailing-window day count sent as `?days=` (web `useFleetAnalytics({ days })`); [ALL] sends no bound so the
 * backend returns full history. The default mirrors the web `useRangeState({ defaultPresetId: '30d' })`.
 */
enum class AnalyticsRange(
    val wire: String,
    val days: Int?,
) {
    WEEK("7d", 7),
    MONTH("30d", 30),
    QUARTER("90d", 90),
    YEAR("1y", 365),
    ALL("all", null),
    ;

    companion object {
        /** The web `defaultPresetId: '30d'`. */
        val DEFAULT: AnalyticsRange = MONTH

        /** Resolves a range from its wire token, falling back to [DEFAULT] for any unknown value. */
        fun fromWire(wire: String): AnalyticsRange = entries.firstOrNull { it.wire == wire } ?: DEFAULT
    }
}

// ── Typed model (mirrors web/src/api/types.ts `FleetAnalytics`) ─────────────────────────────────────────────

/**
 * The six-field statistical summary the backend computes for a metric (web `StatsSummary`). Every field is
 * nullable so the render boundary applies the web `safe()`/`'—'` fallback honestly rather than fabricating a
 * zero when the backend omitted a stat. SI units depend on the metric (km/h, kW, km, %, …) and are converted
 * only at display time.
 */
data class StatsSummary(
    val min: Double?,
    val max: Double?,
    val avg: Double?,
    val median: Double?,
    val p95: Double?,
    val count: Double?,
) {
    internal companion object {
        fun from(obj: JsonObject?): StatsSummary? {
            if (obj == null) return null
            return StatsSummary(
                min = obj.double("min"),
                max = obj.double("max"),
                avg = obj.double("avg"),
                median = obj.double("median"),
                p95 = obj.double("p95"),
                count = obj.double("count"),
            )
        }
    }
}

/** One vehicle row in the fleet comparison (web `vehicle_comparison[]`). `distance` SI km, `energy` kWh, `efficiency` Wh/km. */
data class VehicleComparison(
    val id: Long,
    val name: String,
    val distance: Double,
    val energy: Double,
    val efficiency: Double,
    val drives: Double,
)

/** `{ hour, drives, distance }` driving hourly-pattern sample (web `drive_analytics.hourly_pattern[]`). */
data class DriveHourly(val hour: Int, val drives: Double, val distance: Double)

/** `{ day, drives, distance, avg_distance }` day-of-week sample (web `drive_analytics.day_of_week[]`). */
data class DayOfWeek(val day: String, val drives: Double, val distance: Double, val avgDistance: Double)

/** `{ range, count }` histogram bucket (speed / trip-distance / drive-duration / start-battery distributions). */
data class RangeCount(val range: String, val count: Double)

/** `{ date, drives, distance, efficiency? }` daily trend sample (web `drive_analytics.daily_trend[]`). */
data class DailyTrend(val date: String, val drives: Double, val distance: Double, val efficiency: Double?)

/** `{ temp, efficiency, distance }` scatter sample (web `drive_analytics.temp_vs_efficiency[]`). °C, Wh/km, km. */
data class TempEfficiency(val temp: Double, val efficiency: Double, val distance: Double)

/** `{ hour, charges, energy }` charging hourly-pattern sample (web `charging_analytics.hourly_pattern[]`). */
data class ChargingHourly(val hour: Int, val charges: Double, val energy: Double)

/** A labelled category count (web `charger_types[] {type,count}` / `charger_brands[] {brand,count}`). */
data class CategoryCount(val label: String, val count: Double)

/** `{ month, energy, cost, sessions, avg_power, gas_cost, savings }` monthly trend sample. */
data class MonthlyTrend(
    val month: String,
    val energy: Double,
    val cost: Double,
    val sessions: Double,
    val avgPower: Double,
    val gasCost: Double,
    val savings: Double,
)

/** `{ date, health_score, capacity_wh, degradation_pct, range_km, cycle_count }` battery trend sample. */
data class BatteryTrendPoint(
    val date: String,
    val healthScore: Double,
    val capacityWh: Double,
    val degradationPct: Double,
    val rangeKm: Double,
    val cycleCount: Double,
)

/** The driving deep-analytics block (web `drive_analytics`). */
data class DriveAnalytics(
    val hourlyPattern: List<DriveHourly>,
    val dayOfWeek: List<DayOfWeek>,
    val speedDistribution: List<RangeCount>,
    val distanceDistribution: List<RangeCount>,
    val durationDistribution: List<RangeCount>,
    val dailyTrend: List<DailyTrend>,
    val tempVsEfficiency: List<TempEfficiency>,
    val speedStats: StatsSummary?,
    val powerStats: StatsSummary?,
    val regenStats: StatsSummary?,
    val distanceStats: StatsSummary?,
    val temperatureInside: StatsSummary?,
    val temperatureOutside: StatsSummary?,
) {
    internal companion object {
        fun from(obj: JsonObject?): DriveAnalytics? {
            if (obj == null) return null
            val temperature = obj.obj("temperature")
            return DriveAnalytics(
                hourlyPattern =
                    obj.arr("hourly_pattern").objects().map {
                        DriveHourly(it.int("hour") ?: 0, it.double("drives") ?: 0.0, it.double("distance") ?: 0.0)
                    },
                dayOfWeek =
                    obj.arr("day_of_week").objects().map {
                        DayOfWeek(
                            it.string("day") ?: EM_DASH,
                            it.double("drives") ?: 0.0,
                            it.double("distance") ?: 0.0,
                            it.double("avg_distance") ?: 0.0,
                        )
                    },
                speedDistribution = obj.arr("speed_distribution").rangeCounts(),
                distanceDistribution = obj.arr("distance_distribution").rangeCounts(),
                durationDistribution = obj.arr("duration_distribution").rangeCounts(),
                dailyTrend =
                    obj.arr("daily_trend").objects().map {
                        DailyTrend(
                            it.string("date") ?: EM_DASH,
                            it.double("drives") ?: 0.0,
                            it.double("distance") ?: 0.0,
                            it.double("efficiency"),
                        )
                    },
                tempVsEfficiency =
                    obj.arr("temp_vs_efficiency").objects().map {
                        TempEfficiency(
                            it.double("temp") ?: 0.0,
                            it.double("efficiency") ?: 0.0,
                            it.double("distance") ?: 0.0,
                        )
                    },
                speedStats = StatsSummary.from(obj.obj("speed_stats")),
                powerStats = StatsSummary.from(obj.obj("power_stats")),
                regenStats = StatsSummary.from(obj.obj("regen_stats")),
                distanceStats = StatsSummary.from(obj.obj("distance_stats")),
                temperatureInside = StatsSummary.from(temperature?.obj("inside")),
                temperatureOutside = StatsSummary.from(temperature?.obj("outside")),
            )
        }
    }
}

/** The charging deep-analytics block (web `charging_analytics`). */
data class ChargingAnalytics(
    val hourlyPattern: List<ChargingHourly>,
    val chargerTypes: List<CategoryCount>,
    val chargerBrands: List<CategoryCount>,
    val monthlyTrend: List<MonthlyTrend>,
    val startBatteryDist: List<RangeCount>,
    val powerStats: StatsSummary?,
    val durationStats: StatsSummary?,
    val costStats: StatsSummary?,
    val efficiencyStats: StatsSummary?,
) {
    internal companion object {
        fun from(obj: JsonObject?): ChargingAnalytics? {
            if (obj == null) return null
            return ChargingAnalytics(
                hourlyPattern =
                    obj.arr("hourly_pattern").objects().map {
                        ChargingHourly(it.int("hour") ?: 0, it.double("charges") ?: 0.0, it.double("energy") ?: 0.0)
                    },
                chargerTypes =
                    obj.arr("charger_types").objects().map {
                        CategoryCount(it.string("type") ?: EM_DASH, it.double("count") ?: 0.0)
                    },
                chargerBrands =
                    obj.arr("charger_brands").objects().map {
                        CategoryCount(it.string("brand") ?: EM_DASH, it.double("count") ?: 0.0)
                    },
                monthlyTrend =
                    obj.arr("monthly_trend").objects().map {
                        MonthlyTrend(
                            it.string("month") ?: EM_DASH,
                            it.double("energy") ?: 0.0,
                            it.double("cost") ?: 0.0,
                            it.double("sessions") ?: 0.0,
                            it.double("avg_power") ?: 0.0,
                            it.double("gas_cost") ?: 0.0,
                            it.double("savings") ?: 0.0,
                        )
                    },
                startBatteryDist = obj.arr("start_battery_dist").rangeCounts(),
                powerStats = StatsSummary.from(obj.obj("power_stats")),
                durationStats = StatsSummary.from(obj.obj("duration_stats")),
                costStats = StatsSummary.from(obj.obj("cost_stats")),
                efficiencyStats = StatsSummary.from(obj.obj("efficiency_stats")),
            )
        }
    }
}

/**
 * The full fleet deep-analytics payload (web `FleetAnalytics`). Totals stay SI (km / kWh / Wh-per-km); the
 * render boundary converts to the user's units. Nested blocks are nullable so a partial backend response
 * still renders the panels it can and shows honest empties for the rest.
 */
data class FleetAnalytics(
    val totalDistanceKm: Double,
    val totalDrives: Double,
    val totalChargingSessions: Double,
    val totalEnergyKwh: Double,
    val totalCost: Double,
    val avgEfficiencyWhKm: Double,
    val vehicleComparison: List<VehicleComparison>,
    val drive: DriveAnalytics?,
    val charging: ChargingAnalytics?,
    val batteryTrend: List<BatteryTrendPoint>,
) {
    internal companion object {
        val EMPTY: FleetAnalytics =
            FleetAnalytics(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, emptyList(), null, null, emptyList())

        /** Parse the raw `/analytics/fleet` SI element into the typed model; a null/non-object yields [EMPTY]. */
        fun from(json: JsonElement?): FleetAnalytics {
            val obj = json as? JsonObject ?: return EMPTY
            return FleetAnalytics(
                totalDistanceKm = obj.double("total_distance_km") ?: 0.0,
                totalDrives = obj.double("total_drives") ?: 0.0,
                totalChargingSessions = obj.double("total_charging_sessions") ?: 0.0,
                totalEnergyKwh = obj.double("total_energy_kwh") ?: 0.0,
                totalCost = obj.double("total_cost") ?: 0.0,
                avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km") ?: 0.0,
                vehicleComparison =
                    obj.arr("vehicle_comparison").objects().map {
                        VehicleComparison(
                            id = it.long("id") ?: 0L,
                            name = it.string("name") ?: EM_DASH,
                            distance = it.double("distance") ?: 0.0,
                            energy = it.double("energy") ?: 0.0,
                            efficiency = it.double("efficiency") ?: 0.0,
                            drives = it.double("drives") ?: 0.0,
                        )
                    },
                drive = DriveAnalytics.from(obj.obj("drive_analytics")),
                charging = ChargingAnalytics.from(obj.obj("charging_analytics")),
                batteryTrend =
                    obj.arr("battery_trend").objects().map {
                        BatteryTrendPoint(
                            date = it.string("date") ?: EM_DASH,
                            healthScore = it.double("health_score") ?: 0.0,
                            capacityWh = it.double("capacity_wh") ?: 0.0,
                            degradationPct = it.double("degradation_pct") ?: 0.0,
                            rangeKm = it.double("range_km") ?: 0.0,
                            cycleCount = it.double("cycle_count") ?: 0.0,
                        )
                    },
            )
        }
    }
}

// ── Framework-free derivations (the web sub-components' inline `useMemo`s) ───────────────────────────────────

/** Web `safe()` (`Number.isFinite(v) ? v : 0`) — collapses null / NaN / ±∞ to zero for arithmetic + plotting. */
fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

/** One efficiency-leaderboard row: a vehicle ranked by efficiency with its bar [percent] of the worst (max). */
data class LeaderboardRow(val id: Long, val name: String, val efficiencyWhKm: Double, val percent: Double)

/**
 * The efficiency leaderboard (web `OverviewVehicleComparison` `leaderboard` memo): vehicles sorted ascending by
 * efficiency (lower Wh/km is better → rank #1), each scaled to a 0–100 bar percent of the highest (worst)
 * efficiency so the bars are comparable.
 */
fun efficiencyLeaderboard(vehicles: List<VehicleComparison>): List<LeaderboardRow> {
    val sorted = vehicles.sortedBy { safe(it.efficiency) }
    val maxEff = sorted.lastOrNull()?.let { safe(it.efficiency) } ?: 1.0
    return sorted.map {
        val pct = if (maxEff > 0.0) safe(it.efficiency) / maxEff * PERCENT_SCALE else 0.0
        LeaderboardRow(it.id, it.name, safe(it.efficiency), pct)
    }
}

/** One charger-brand leaderboard row with its bar [percent] of the busiest brand (web `brandLeaderboard`). */
data class BrandRow(val brand: String, val count: Double, val percent: Double)

/** Charger-brand leaderboard (web `ChargingDetailSection` `brandLeaderboard` memo): bar percent of the max count. */
fun brandLeaderboard(brands: List<CategoryCount>): List<BrandRow> {
    val maxCount = brands.maxOfOrNull { safe(it.count) }?.takeIf { it > 0.0 } ?: 1.0
    return brands.map { BrandRow(it.label, safe(it.count), safe(it.count) / maxCount * PERCENT_SCALE) }
}

/** One cost-by-charger-type row: its share [percent] of all sessions (web `ChargingDetailSection` cost-by-type). */
data class CostByTypeRow(val type: String, val count: Double, val percent: Double)

/** Cost-by-charger-type shares (web inline): each type's `count / totalSessions * 100`. */
fun costByType(types: List<CategoryCount>): List<CostByTypeRow> {
    val total = types.sumOf { safe(it.count) }
    return types.map {
        val pct = if (total > 0.0) safe(it.count) / total * PERCENT_SCALE else 0.0
        CostByTypeRow(it.label, safe(it.count), pct)
    }
}

/** The four normalised radar axes the web `OverviewVehicleComparison` builds (needs ≥2 vehicles). */
enum class RadarAxis(val wire: String) {
    DISTANCE("Distance"),
    ENERGY("Energy"),
    DRIVES("Drives"),
    EFFICIENCY("Efficiency"),
}

/** One vehicle's 0–100 normalised score per [RadarAxis] (web `radarData` rows transposed to per-vehicle). */
data class RadarVehicle(val id: Long, val name: String, val scores: Map<RadarAxis, Double>)

/**
 * The normalised vehicle-comparison series (web `OverviewVehicleComparison` `radarData` memo). Returns empty
 * for <2 vehicles (web `if (vehicles.length < 2) return []`). Distance/Energy/Drives scale to their own max;
 * Efficiency is inverted (`(maxEff - eff) / maxEff`) so a more-efficient vehicle scores higher, matching web.
 */
fun radarVehicles(vehicles: List<VehicleComparison>): List<RadarVehicle> {
    if (vehicles.size < 2) return emptyList()
    val maxDist = vehicles.maxOf { safe(it.distance) }.coerceAtLeast(1.0)
    val maxEnergy = vehicles.maxOf { safe(it.energy) }.coerceAtLeast(1.0)
    val maxDrives = vehicles.maxOf { safe(it.drives) }.coerceAtLeast(1.0)
    val maxEff = vehicles.maxOf { safe(it.efficiency) }.coerceAtLeast(1.0)
    return vehicles.map { v ->
        RadarVehicle(
            id = v.id,
            name = v.name,
            scores =
                mapOf(
                    RadarAxis.DISTANCE to safe(v.distance) / maxDist * PERCENT_SCALE,
                    RadarAxis.ENERGY to safe(v.energy) / maxEnergy * PERCENT_SCALE,
                    RadarAxis.DRIVES to safe(v.drives) / maxDrives * PERCENT_SCALE,
                    RadarAxis.EFFICIENCY to (maxEff - safe(v.efficiency)) / maxEff * PERCENT_SCALE,
                ),
        )
    }
}

private const val PERCENT_SCALE: Double = 100.0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AnalyticsPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, name, or fleet metric.
 */
fun recordAnalyticsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AnalyticsPageRegistration.SLUG))
}

// ── JSON helpers (tolerant readers over the raw AnalyticsStore element) ──────────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.intOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull

private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

private fun JsonObject.arr(key: String): JsonArray {
    val inner = this[key]
    if (inner == null || inner is JsonNull) return JsonArray(emptyList())
    return inner as? JsonArray ?: JsonArray(emptyList())
}

private fun JsonArray.objects(): List<JsonObject> = mapNotNull { it as? JsonObject }

private fun JsonArray.rangeCounts(): List<RangeCount> =
    objects().map { RangeCount(it.string("range") ?: EM_DASH, it.double("count") ?: 0.0) }
