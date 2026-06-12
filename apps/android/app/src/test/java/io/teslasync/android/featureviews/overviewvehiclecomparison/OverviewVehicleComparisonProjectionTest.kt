package io.teslasync.android.featureviews.overviewvehiclecomparison

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Overview vehicle-comparison pure logic — the native analogue of the web
 * component's `useMemo` / inline derivations
 * (web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx): the `vehicle_comparison`
 * decode with its `safe(...)` coercion, the Fleet-Usage donut distance conversion, the efficiency
 * leaderboard sort + Wh/km→Wh/mi conversion + bar fractions, the four-metric radar normalization with its
 * inverted efficiency axis and 2-vehicle guard, the energy/activity bar series order, and the PII-safe
 * `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class OverviewVehicleComparisonProjectionTest {
    private val strings =
        OverviewVehicleComparisonStrings(
            fleetUsage = "Fleet Usage",
            effLeaderboard = "Efficiency Leaderboard",
            vehicleComparison = "Vehicle Comparison",
            energyActivity = "Energy & Activity",
            noVehicles = "No vehicle data",
            noEfficiency = "No efficiency data",
            noComparison = "Need 2+ vehicles for comparison",
            energyLabel = "Energy (kWh)",
            drivesLabel = "Drives",
            metricDistance = "Distance",
            metricEnergy = "Energy",
            metricEfficiency = "Efficiency",
        )

    private val vehicles =
        listOf(
            VehicleComparison(1, "Model 3", distanceKm = 1840.0, energyKwh = 280.0, efficiencyWhKm = 152.0, drives = 96.0),
            VehicleComparison(2, "Model Y", distanceKm = 1220.0, energyKwh = 215.0, efficiencyWhKm = 176.0, drives = 64.0),
            VehicleComparison(3, "Model S", distanceKm = 640.0, energyKwh = 134.0, efficiencyWhKm = 198.0, drives = 28.0),
        )

    private fun project(unit: DistanceUnitPref = DistanceUnitPref.KM) =
        OverviewVehicleComparisonProjection.project(vehicles, unit, strings, Locale.US)

    // ── Decode (web `data?.vehicle_comparison ?? []` + `safe(...)`) ────────────────────────────────

    @Test
    fun parseDecodesEveryRowWithItsFields() {
        val json =
            """
            {"vehicle_comparison":[
              {"id":1,"name":"Model 3","distance":1840.0,"energy":280.0,"efficiency":152.0,"drives":96},
              {"id":2,"name":"Model Y","distance":1220.0,"energy":215.0,"efficiency":176.0,"drives":64}
            ]}
            """.trimIndent()

        val rows = parseVehicleComparison(Json.parseToJsonElement(json))

        assertEquals(2, rows.size)
        assertEquals(VehicleComparison(1, "Model 3", 1840.0, 280.0, 152.0, 96.0), rows[0])
        assertEquals("Model Y", rows[1].name)
    }

    @Test
    fun parseCoercesMissingAndNonFiniteToZeroAndBlankNameToEmDash() {
        val json = """{"vehicle_comparison":[{"id":3,"distance":100.0,"efficiency":"oops"}]}"""

        val row = parseVehicleComparison(Json.parseToJsonElement(json)).single()

        assertEquals(3L, row.id)
        assertEquals(EM_DASH, row.name)
        assertEquals(100.0, row.distanceKm, 0.0)
        assertEquals(0.0, row.energyKwh, 0.0)
        assertEquals(0.0, row.efficiencyWhKm, 0.0)
        assertEquals(0.0, row.drives, 0.0)
    }

    @Test
    fun parseReturnsEmptyForNonObjectOrMissingArray() {
        assertTrue(parseVehicleComparison(null).isEmpty())
        assertTrue(parseVehicleComparison(Json.parseToJsonElement("[]")).isEmpty())
        assertTrue(parseVehicleComparison(Json.parseToJsonElement("{}")).isEmpty())
    }

    // ── Units ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun efficiencyUnitFollowsDistanceUnit() {
        assertEquals("Wh/km", OverviewVehicleComparisonProjection.efficiencyUnit(DistanceUnitPref.KM))
        assertEquals("Wh/mi", OverviewVehicleComparisonProjection.efficiencyUnit(DistanceUnitPref.MI))
    }

    @Test
    fun whPerKmConvertsToWhPerMileForMilesOnly() {
        assertEquals(152.0, OverviewVehicleComparisonProjection.whPerKmToDisplay(152.0, DistanceUnitPref.KM), 0.0)
        assertEquals(152.0 * KM_PER_MILE, OverviewVehicleComparisonProjection.whPerKmToDisplay(152.0, DistanceUnitPref.MI), 1e-6)
    }

    // ── Fleet Usage donut ─────────────────────────────────────────────────────────────────────────

    @Test
    fun fleetUsageConvertsDistanceAndIndexesColorsInOrder() {
        val segments = OverviewVehicleComparisonProjection.fleetUsage(vehicles, DistanceUnitPref.KM, Locale.US)

        assertEquals(3, segments.size)
        // km: convertDistanceFromSI(distanceKm * 1000, KM) == distanceKm.
        assertEquals(1840.0, segments[0].value, 1e-6)
        assertEquals("1,840.0 km", segments[0].displayValue)
        assertEquals(listOf(0, 1, 2), segments.map { it.colorIndex })
        assertEquals(listOf("Model 3", "Model Y", "Model S"), segments.map { it.name })
    }

    @Test
    fun fleetUsageConvertsDistanceToMiles() {
        val segments = OverviewVehicleComparisonProjection.fleetUsage(vehicles, DistanceUnitPref.MI, Locale.US)

        // 1840 km -> 1840000 m / 1609.344 ≈ 1143.32 mi.
        assertEquals(1840_000.0 / 1609.344, segments[0].value, 1e-3)
        assertTrue(segments[0].displayValue.endsWith(" mi"))
    }

    // ── Efficiency leaderboard ──────────────────────────────────────────────────────────────────

    @Test
    fun leaderboardSortsAscendingByEfficiencyWithRanksAndFractions() {
        val rows = OverviewVehicleComparisonProjection.leaderboard(vehicles, DistanceUnitPref.KM, locale = Locale.US)

        assertEquals(listOf(1, 2, 3), rows.map { it.rank })
        // Lowest Wh/km is most efficient -> rank #1.
        assertEquals("Model 3", rows[0].name)
        assertEquals("Model S", rows[2].name)
        assertEquals("152.0 Wh/km", rows[0].efficiencyText)
        // Fraction is each value over the least-efficient (max) value (198).
        assertEquals(152.0 / 198.0, rows[0].fraction, 1e-5)
        assertEquals(1.0, rows[2].fraction, 1e-5)
    }

    @Test
    fun leaderboardAppliesMilesConversionAndUnit() {
        val rows = OverviewVehicleComparisonProjection.leaderboard(vehicles, DistanceUnitPref.MI, locale = Locale.US)

        // 152 Wh/km * 1.609344 ≈ 244.6 Wh/mi.
        assertEquals("244.6 Wh/mi", rows[0].efficiencyText)
    }

    @Test
    fun leaderboardIsEmptyWithoutVehicles() {
        assertTrue(OverviewVehicleComparisonProjection.leaderboard(emptyList(), DistanceUnitPref.KM).isEmpty())
    }

    // ── Radar comparison ──────────────────────────────────────────────────────────────────────────

    @Test
    fun radarNormalizesEachMetricAndInvertsEfficiency() {
        val radar = OverviewVehicleComparisonProjection.radar(vehicles, strings)

        assertTrue(radar.hasData)
        assertEquals(listOf("Distance", "Energy", "Drives", "Efficiency"), radar.axisLabels)
        // Model 3 is the max on distance/energy/drives -> 100 on each; efficiency axis is inverted.
        val model3 = radar.vehicles.first { it.name == "Model 3" }
        assertEquals(100.0, model3.axisValues[0], 1e-6)
        assertEquals(100.0, model3.axisValues[1], 1e-6)
        assertEquals(100.0, model3.axisValues[2], 1e-6)
        assertEquals((198.0 - 152.0) / 198.0 * 100.0, model3.axisValues[3], 1e-6)
        // Least efficient vehicle (max Wh/km) scores 0 on the inverted efficiency axis.
        val modelS = radar.vehicles.first { it.name == "Model S" }
        assertEquals(0.0, modelS.axisValues[3], 1e-6)
    }

    @Test
    fun radarNeedsTwoVehiclesButAlwaysExposesAxisLabels() {
        val radar = OverviewVehicleComparisonProjection.radar(vehicles.take(1), strings)

        assertFalse(radar.hasData)
        assertTrue(radar.vehicles.isEmpty())
        assertEquals(listOf("Distance", "Energy", "Drives", "Efficiency"), radar.axisLabels)
    }

    // ── Top-level projection ──────────────────────────────────────────────────────────────────────

    @Test
    fun projectExposesBarSeriesInOrderAndVehiclePresence() {
        val display = project()

        assertTrue(display.hasVehicles)
        assertEquals(listOf("Model 3", "Model Y", "Model S"), display.barLabels)
        assertEquals(listOf(280.0, 215.0, 134.0), display.energyValues)
        assertEquals(listOf(96.0, 64.0, 28.0), display.drivesValues)
        assertEquals("Wh/km", display.efficiencyUnit)
    }

    @Test
    fun projectFlagsNoVehiclesForEmptyFleet() {
        val display = OverviewVehicleComparisonProjection.project(emptyList(), DistanceUnitPref.KM, strings, Locale.US)

        assertFalse(display.hasVehicles)
        assertTrue(display.fleetUsage.isEmpty())
        assertTrue(display.leaderboard.isEmpty())
        assertFalse(display.radar.hasData)
        assertEquals("No vehicle data", display.fleetUsageDescription)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordOverviewVehicleComparisonOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "OverviewVehicleComparison"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
