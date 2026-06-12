// Pure, framework-free model + projection for the Overview "vehicle comparison" analytics feature view —
// the native analogue of everything the web component derives via `useMemo` / inline JSX maps before
// returning its four panels (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component receives the loaded `FleetAnalytics` and reads only `data.vehicle_comparison` — a list
// of `{ id, name, distance, energy, efficiency, drives }`. The wire values are the analytics feed's derived
// units (distance in km, energy in kWh, efficiency in Wh/km — see web/src/api/types.ts), so this file owns
// the same four derivations the web does:
//   1. Fleet Usage donut  — each vehicle's distance, converted to the user's unit (proportions are unit
//      invariant, but the converted value drives the accessible per-slice label).
//   2. Efficiency leaderboard — vehicles sorted ascending by Wh/km (lower = better), each as a % of the
//      least-efficient bar, with the Wh/km→Wh/mi display conversion when the user prefers miles.
//   3. Radar comparison — needs ≥2 vehicles; four metrics (distance, energy, drives, efficiency) each
//      normalized 0..100 across the fleet, with efficiency inverted (lower raw value scores higher).
//   4. Energy & activity bars — raw energy (kWh) + drive count per vehicle.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/OverviewVehicleComparison — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.overviewvehiclecomparison

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

/** Em dash shown when a value is missing — the web `'—'` fallback marker. */
internal const val EM_DASH: String = "\u2014"

/** 1 mile = 1.609344 km exactly (web `KM_PER_MILE`). Wh/km × this = Wh/mi. */
internal const val KM_PER_MILE: Double = 1.609344

/** 1 km = 1000 m exactly — the web `safe(v.distance) * 1000` metres widening before SI conversion. */
internal const val METERS_PER_KM: Double = 1000.0

/** Minimum vehicles the radar comparison needs (web `if (vehicles.length < 2) return []`). */
internal const val RADAR_MIN_VEHICLES: Int = 2

/** Leaderboard / efficiency value precision — the web `fmtNumber(value, 1)`. */
internal const val EFFICIENCY_DECIMALS: Int = 1

/** Distance display precision for the donut slice label (shared `PRECISION_DISTANCE`). */
internal const val DONUT_VALUE_DECIMALS: Int = 1

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object OverviewVehicleComparisonRegistration {
    /** Stable surface id. */
    const val ID: String = "overview-vehicle-comparison"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OverviewVehicleComparison"
}

/**
 * One vehicle's analytics tally — the native mirror of a web `vehicle_comparison` entry
 * (`{ id, name, distance, energy, efficiency, drives }`). The numeric fields carry the analytics feed's
 * derived units: [distanceKm] kilometres, [energyKwh] kilowatt-hours, [efficiencyWhKm] watt-hours per
 * kilometre, and [drives] the trip count. Non-finite wire values are coerced to zero on decode, mirroring
 * the web `safe(...)` guard, so the projection never has to defend against `NaN`.
 */
data class VehicleComparison(
    val id: Long,
    val name: String,
    val distanceKm: Double,
    val energyKwh: Double,
    val efficiencyWhKm: Double,
    val drives: Double,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the nine
 * `analytics.overview.*` keys the web component resolves via `t(...)` plus the three shared metric labels the
 * web hardcodes on its radar axes (`Distance` / `Energy` / `Efficiency`; `Drives` reuses the bar key). The
 * lifecycle-chrome strings (loading / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 */
data class OverviewVehicleComparisonStrings(
    val fleetUsage: String,
    val effLeaderboard: String,
    val vehicleComparison: String,
    val energyActivity: String,
    val noVehicles: String,
    val noEfficiency: String,
    val noComparison: String,
    val energyLabel: String,
    val drivesLabel: String,
    val metricDistance: String,
    val metricEnergy: String,
    val metricEfficiency: String,
)

/**
 * One Fleet Usage donut slice: a vehicle [name], its converted-distance [value] (drives the slice sweep),
 * the already-formatted [displayValue] for the accessible label, and a palette [colorIndex].
 */
data class FleetUsageSegment(
    val name: String,
    val value: Double,
    val displayValue: String,
    val colorIndex: Int,
)

/**
 * One efficiency-leaderboard row — the native analogue of a web leaderboard entry. Carries the [rank]
 * (1-based), the vehicle [name], the already-formatted [efficiencyText] (value + unit), and the bar
 * [fraction] (0..1, this vehicle's efficiency ÷ the least-efficient vehicle's).
 */
data class LeaderboardRow(
    val id: Long,
    val rank: Int,
    val name: String,
    val efficiencyText: String,
    val fraction: Double,
)

/**
 * One vehicle's radar polygon — its four [axisValues] (0..100, in [RadarChartData.axisLabels] order:
 * distance, energy, drives, efficiency), the vehicle [name] (legend label), and a palette [colorIndex].
 */
data class RadarVehicle(
    val id: Long,
    val name: String,
    val colorIndex: Int,
    val axisValues: List<Double>,
)

/**
 * The render-ready radar comparison — the four [axisLabels] and one polygon per [vehicles] entry. Empty
 * ([vehicles] empty) when the fleet has fewer than [RADAR_MIN_VEHICLES] vehicles (web returns `[]`), which
 * drives the "need 2+ vehicles" empty state.
 */
data class RadarChartData(
    val axisLabels: List<String>,
    val vehicles: List<RadarVehicle>,
) {
    /** True when there is at least one polygon to draw (web `radarData.length > 0`). */
    val hasData: Boolean get() = vehicles.isNotEmpty()
}

/**
 * The fully projected, render-ready view of the four panels — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. Each panel exposes its own empty gate so the composable can show a friendly empty
 * state per panel exactly like the web ternaries.
 */
data class OverviewVehicleComparisonDisplay(
    val fleetUsage: List<FleetUsageSegment>,
    val fleetUsageDescription: String,
    val leaderboard: List<LeaderboardRow>,
    val radar: RadarChartData,
    val energyValues: List<Double>,
    val drivesValues: List<Double>,
    val barLabels: List<String>,
    val energyLabel: String,
    val drivesLabel: String,
    val efficiencyUnit: String,
    val strings: OverviewVehicleComparisonStrings,
) {
    /** Web `vehicles.length > 0` — gates the donut + bar panels. */
    val hasVehicles: Boolean get() = barLabels.isNotEmpty()
}

/**
 * Decodes the raw `vehicle_comparison` array out of the `/analytics/fleet` [json] (the web
 * `data?.vehicle_comparison ?? []`). A non-array input or missing field yields an empty list; a malformed
 * element is skipped. Numeric fields are read null-safe and coerced finite (web `safe(...)`).
 */
fun parseVehicleComparison(json: JsonElement?): List<VehicleComparison> {
    val array = (json as? JsonObject)?.get("vehicle_comparison") as? JsonArray ?: return emptyList()
    return array.mapNotNull { element -> (element as? JsonObject)?.toVehicleComparison() }
}

private fun JsonObject.toVehicleComparison(): VehicleComparison {
    val name = (this["name"] as? JsonPrimitive)?.contentOrNull
    return VehicleComparison(
        id = (this["id"] as? JsonPrimitive)?.longOrNull ?: 0L,
        name = if (name.isNullOrBlank()) EM_DASH else name,
        distanceKm = safeDouble(this, "distance"),
        energyKwh = safeDouble(this, "energy"),
        efficiencyWhKm = safeDouble(this, "efficiency"),
        drives = safeDouble(this, "drives"),
    )
}

/** Reads [key] as a finite double, coercing `null` / non-finite to zero (web `safe(...)`). */
private fun safeDouble(
    obj: JsonObject,
    key: String,
): Double {
    val value = (obj[key] as? JsonPrimitive)?.doubleOrNull ?: return 0.0
    return if (value.isFinite()) value else 0.0
}

/**
 * The pure projection the composable renders — the native port of the inline `useMemo` derivations + JSX
 * maps in the web source. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 * SI/derived-unit inputs are converted to the user's [distanceUnit] here (the single display boundary);
 * [locale] drives number grouping (tests pin [Locale.US]).
 */
object OverviewVehicleComparisonProjection {
    private const val PERCENT: Double = 100.0
    private const val MAX_FLOOR: Double = 1.0

    /** Project the loaded [vehicles] into the four render-ready panels. */
    fun project(
        vehicles: List<VehicleComparison>,
        distanceUnit: DistanceUnitPref,
        strings: OverviewVehicleComparisonStrings,
        locale: Locale = Locale.US,
    ): OverviewVehicleComparisonDisplay {
        val unitLabel = efficiencyUnit(distanceUnit)
        val fleetUsage = fleetUsage(vehicles, distanceUnit, locale)
        return OverviewVehicleComparisonDisplay(
            fleetUsage = fleetUsage,
            fleetUsageDescription = fleetUsageDescription(fleetUsage, strings),
            leaderboard = leaderboard(vehicles, distanceUnit, unitLabel, locale),
            radar = radar(vehicles, strings),
            energyValues = vehicles.map { it.energyKwh },
            drivesValues = vehicles.map { it.drives },
            barLabels = vehicles.map { it.name },
            energyLabel = strings.energyLabel,
            drivesLabel = strings.drivesLabel,
            efficiencyUnit = unitLabel,
            strings = strings,
        )
    }

    /** Efficiency unit symbol — web `distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`, derived from the unit label. */
    fun efficiencyUnit(distanceUnit: DistanceUnitPref): String = "Wh/${distanceUnit.label}"

    /**
     * Converts a backend Wh/km efficiency to the display unit — web `whPerKmToDisplay`: Wh/km × 1.609344 for
     * miles (so the bar reads Wh/mi), unchanged for kilometres.
     */
    fun whPerKmToDisplay(
        whPerKm: Double,
        distanceUnit: DistanceUnitPref,
    ): Double = if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

    /**
     * Fleet Usage donut slices — web `vehicles.map(v => ({ name, value: convertDistanceFromSI(distance*1000,
     * unit) }))`. The converted value drives both the slice sweep and the accessible per-slice label.
     */
    fun fleetUsage(
        vehicles: List<VehicleComparison>,
        distanceUnit: DistanceUnitPref,
        locale: Locale = Locale.US,
    ): List<FleetUsageSegment> =
        vehicles.mapIndexed { index, vehicle ->
            val value = convertDistanceFromSI(vehicle.distanceKm * METERS_PER_KM, distanceUnit)
            FleetUsageSegment(
                name = vehicle.name,
                value = value,
                displayValue = "${ChartFormat.number(value, DONUT_VALUE_DECIMALS, locale)} ${distanceUnit.label}",
                colorIndex = index,
            )
        }

    /**
     * Efficiency leaderboard — web sort ascending by Wh/km (lower = more efficient = rank #1), each bar a %
     * of the least-efficient (largest Wh/km) vehicle. The displayed value applies the Wh/km→display
     * conversion and one-decimal formatting (web `fmtNumber(whPerKmToDisplay(eff), 1)`).
     */
    fun leaderboard(
        vehicles: List<VehicleComparison>,
        distanceUnit: DistanceUnitPref,
        unitLabel: String = efficiencyUnit(distanceUnit),
        locale: Locale = Locale.US,
    ): List<LeaderboardRow> {
        if (vehicles.isEmpty()) return emptyList()
        val sorted = vehicles.sortedBy { it.efficiencyWhKm }
        val maxEff = sorted.last().efficiencyWhKm
        return sorted.mapIndexed { index, vehicle ->
            val display = whPerKmToDisplay(vehicle.efficiencyWhKm, distanceUnit)
            LeaderboardRow(
                id = vehicle.id,
                rank = index + 1,
                name = vehicle.name,
                efficiencyText = "${ChartFormat.number(display, EFFICIENCY_DECIMALS, locale)} $unitLabel",
                fraction = if (maxEff > 0.0) vehicle.efficiencyWhKm / maxEff else 0.0,
            )
        }
    }

    /**
     * Radar comparison data — web normalizes each of the four metrics across the fleet to 0..100, with
     * efficiency inverted (`(maxEff - eff) / maxEff`) so a more-efficient vehicle scores higher. Returns an
     * empty polygon list when the fleet has fewer than [RADAR_MIN_VEHICLES] vehicles (web `< 2` guard).
     */
    fun radar(
        vehicles: List<VehicleComparison>,
        strings: OverviewVehicleComparisonStrings,
    ): RadarChartData {
        val axisLabels =
            listOf(strings.metricDistance, strings.metricEnergy, strings.drivesLabel, strings.metricEfficiency)
        if (vehicles.size < RADAR_MIN_VEHICLES) return RadarChartData(axisLabels, emptyList())
        val maxDist = vehicles.maxOf { it.distanceKm }.coerceAtLeast(MAX_FLOOR)
        val maxEnergy = vehicles.maxOf { it.energyKwh }.coerceAtLeast(MAX_FLOOR)
        val maxDrives = vehicles.maxOf { it.drives }.coerceAtLeast(MAX_FLOOR)
        val maxEff = vehicles.maxOf { it.efficiencyWhKm }.coerceAtLeast(MAX_FLOOR)
        val polygons =
            vehicles.mapIndexed { index, vehicle ->
                RadarVehicle(
                    id = vehicle.id,
                    name = vehicle.name,
                    colorIndex = index,
                    axisValues =
                        listOf(
                            vehicle.distanceKm / maxDist * PERCENT,
                            vehicle.energyKwh / maxEnergy * PERCENT,
                            vehicle.drives / maxDrives * PERCENT,
                            (maxEff - vehicle.efficiencyWhKm) / maxEff * PERCENT,
                        ),
                )
            }
        return RadarChartData(axisLabels, polygons)
    }

    private fun fleetUsageDescription(
        segments: List<FleetUsageSegment>,
        strings: OverviewVehicleComparisonStrings,
    ): String {
        if (segments.isEmpty()) return strings.noVehicles
        val parts = segments.joinToString(", ") { "${it.name} ${it.displayValue}" }
        return "${strings.fleetUsage}: $parts"
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface
 * [OverviewVehicleComparisonRegistration.SLUG] (P1/S11). Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordOverviewVehicleComparisonOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to OverviewVehicleComparisonRegistration.SLUG))
}
