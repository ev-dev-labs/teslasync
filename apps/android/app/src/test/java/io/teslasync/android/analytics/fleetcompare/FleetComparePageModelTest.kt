package io.teslasync.android.analytics.fleetcompare

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the FleetComparePage's pure logic — the raw `/drives/stats`, `/analytics/tco`, and
 * `/mileage/monthly` decode, the year-month chart merge, the lifetime comparison-table rows + winner semantics,
 * the per-vehicle status projection, the four key-highlight values, and the settings → display-prefs resolution.
 * Mirrors the web spec (web/src/features/analytics/pages/FleetComparePage.tsx).
 */
class FleetComparePageModelTest {
    private val metricPrefs = FleetCompareDisplayPrefs.fromSettings(null)

    private val labels =
        ComparisonLabels(
            totalDrives = "Total Drives",
            totalDistance = "Total Distance",
            avgEfficiency = "Avg Efficiency",
            avgSpeed = "Avg Speed",
            topSpeed = "Top Speed",
            regenRatio = "Regen Ratio",
            co2Saved = "CO2 Saved",
            chargingCost = "Charging Cost",
            totalEnergy = "Total Energy",
            chargeSessions = "Charge Sessions",
        )

    // ── Decode ────────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun parseDrivingStatsReadsSnakeCaseFields() {
        val json =
            buildJsonObject {
                put("total_drives", 42)
                put("total_distance_km", 1234.5)
                put("avg_efficiency_wh_km", 158.0)
                put("avg_speed_kmh", 60.0)
                put("top_speed_kmh", 120.0)
                put("regen_ratio", 0.25)
                put("co2_saved_kg", 88.0)
            }
        val stats = parseDrivingStats(json)
        assertEquals(42.0, stats.totalDrives, 0.0)
        assertEquals(1234.5, stats.totalDistanceKm, 0.0)
        assertEquals(158.0, stats.avgEfficiencyWhKm, 0.0)
        assertEquals(60.0, stats.avgSpeedKmh, 0.0)
        assertEquals(120.0, stats.topSpeedKmh, 0.0)
        assertEquals(0.25, stats.regenRatio, 0.0)
        assertEquals(88.0, stats.co2SavedKg, 0.0)
    }

    @Test
    fun parseDrivingStatsCollapsesMissingAndNonObjectToZero() {
        assertEquals(DrivingStatsData.EMPTY, parseDrivingStats(null))
        assertEquals(DrivingStatsData.EMPTY, parseDrivingStats(buildJsonArray { }))
        val partial = parseDrivingStats(buildJsonObject { put("total_drives", JsonNull) })
        assertEquals(0.0, partial.totalDrives, 0.0)
    }

    @Test
    fun parseCostSummaryReadsExpectedFields() {
        val json =
            buildJsonObject {
                put("total_charging_cost", 512.0)
                put("total_wh", 5_000_000.0)
                put("total_sessions", 30)
            }
        val cost = parseCostSummary(json)
        assertEquals(512.0, cost.totalChargingCost, 0.0)
        assertEquals(5_000_000.0, cost.totalWh, 0.0)
        assertEquals(30.0, cost.totalSessions, 0.0)
    }

    @Test
    fun parseMonthlyBucketsDecodesArrayWithDriveCount() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("year_month", "2025-01")
                        put("total_km", 120.0)
                        put("drive_count", 10)
                    },
                )
                add(
                    buildJsonObject {
                        put("year_month", "2025-02")
                        put("total_km", 80.0)
                        put("drive_count", 6)
                    },
                )
            }
        val buckets = parseMonthlyBuckets(json)
        assertEquals(2, buckets.size)
        assertEquals("2025-01", buckets[0].yearMonth)
        assertEquals(120.0, buckets[0].totalKm, 0.0)
        assertEquals(10.0, buckets[0].driveCount, 0.0)
    }

    @Test
    fun parseMonthlyBucketsNonArrayCollapsesToEmpty() {
        assertTrue(parseMonthlyBuckets(null).isEmpty())
        assertTrue(parseMonthlyBuckets(buildJsonObject { put("x", 1) }).isEmpty())
    }

    // ── Chart merge ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun mergeMonthlyAlignsAndSortsByMonth() {
        val a = listOf(MonthlyBucket("2025-02", 50.0, 4.0), MonthlyBucket("2025-01", 100.0, 8.0))
        val b = listOf(MonthlyBucket("2025-02", 70.0, 5.0), MonthlyBucket("2025-03", 30.0, 3.0))
        val merged = mergeMonthly(a, b)
        assertEquals(listOf("2025-01", "2025-02", "2025-03"), merged.map { it.month })
        // Jan: only A.
        assertEquals(100.0, merged[0].distA, 0.0)
        assertEquals(0.0, merged[0].distB, 0.0)
        // Feb: both vehicles.
        assertEquals(50.0, merged[1].distA, 0.0)
        assertEquals(70.0, merged[1].distB, 0.0)
        assertEquals(4.0, merged[1].drivesA, 0.0)
        assertEquals(5.0, merged[1].drivesB, 0.0)
        // Mar: only B.
        assertEquals(0.0, merged[2].distA, 0.0)
        assertEquals(30.0, merged[2].distB, 0.0)
    }

    // ── Winner semantics ──────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun computeWinnerHonorsSemantics() {
        assertEquals(WinnerSide.A, computeWinner(10.0, 5.0, WinnerSemantic.Higher))
        assertEquals(WinnerSide.B, computeWinner(10.0, 5.0, WinnerSemantic.Lower))
        assertEquals(WinnerSide.Tie, computeWinner(10.0, 5.0, WinnerSemantic.Neutral))
        assertEquals(WinnerSide.Tie, computeWinner(5.0, 5.0, WinnerSemantic.Higher))
    }

    @Test
    fun comparisonRowsProducesTenRowsWithWinnerSidesAndMetricFormatting() {
        val statsA =
            DrivingStatsData(
                totalDrives = 10.0,
                totalDistanceKm = 1000.0,
                avgEfficiencyWhKm = 150.0,
                avgSpeedKmh = 60.0,
                topSpeedKmh = 110.0,
                regenRatio = 0.30,
                co2SavedKg = 100.0,
            )
        val statsB =
            DrivingStatsData(
                totalDrives = 20.0,
                totalDistanceKm = 800.0,
                avgEfficiencyWhKm = 160.0,
                avgSpeedKmh = 70.0,
                topSpeedKmh = 130.0,
                regenRatio = 0.20,
                co2SavedKg = 90.0,
            )
        val costA = CostSummaryData(totalChargingCost = 500.0, totalWh = 5_000_000.0, totalSessions = 30.0)
        val costB = CostSummaryData(totalChargingCost = 400.0, totalWh = 4_000_000.0, totalSessions = 25.0)

        val rows = comparisonRows(statsA, statsB, costA, costB, metricPrefs, labels, "kg")
        assertEquals(10, rows.size)

        val byMetric = rows.associateBy { it.metric }
        // total drives: higher wins → B.
        assertEquals(WinnerSide.B, byMetric.getValue("Total Drives").winnerSide)
        // total distance: higher wins → A (1000 > 800), shown in km.
        val distance = byMetric.getValue("Total Distance")
        assertEquals(WinnerSide.A, distance.winnerSide)
        assertEquals("1,000.00 km", distance.valueA)
        // avg efficiency: lower wins → A (150 < 160), Wh/km label.
        val efficiency = byMetric.getValue("Avg Efficiency")
        assertEquals(WinnerSide.A, efficiency.winnerSide)
        assertEquals("150.00 Wh/km", efficiency.valueA)
        // avg speed: neutral → tie.
        assertEquals(WinnerSide.Tie, byMetric.getValue("Avg Speed").winnerSide)
        // regen ratio: higher wins → A; shown as a percent with one decimal.
        val regen = byMetric.getValue("Regen Ratio")
        assertEquals(WinnerSide.A, regen.winnerSide)
        assertEquals("30.0%", regen.valueA)
        // charging cost: lower wins → B; currency with zero decimals.
        val cost = byMetric.getValue("Charging Cost")
        assertEquals(WinnerSide.B, cost.winnerSide)
        assertEquals("$500", cost.valueA)
        // co2: higher wins → A; kg suffix.
        assertEquals(WinnerSide.A, byMetric.getValue("CO2 Saved").winnerSide)
        assertEquals("100.00 kg", byMetric.getValue("CO2 Saved").valueA)
    }

    @Test
    fun comparisonRowsConvertsToImperialWhenMiles() {
        val imperial = FleetCompareDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(DistanceUnitPref.MI, imperial.distanceUnit)
        assertEquals("Wh/mi", imperial.efficiencyUnitLabel)
        val stats = DrivingStatsData(0.0, 1.609344, 100.0, 0.0, 0.0, 0.0, 0.0)
        val rows = comparisonRows(stats, DrivingStatsData.EMPTY, CostSummaryData.EMPTY, CostSummaryData.EMPTY, imperial, labels, "kg")
        // 1.609344 km == 1 mile.
        assertEquals("1.00 mi", rows.first { it.metric == "Total Distance" }.valueA)
        // 100 Wh/km == 160.9344 Wh/mi ≈ 160.93 Wh/mi at 2 dp.
        assertEquals("160.93 Wh/mi", rows.first { it.metric == "Avg Efficiency" }.valueA)
    }

    // ── Key highlights ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun highlightValuesPairBothVehicles() {
        val statsA = DrivingStatsData(0.0, 0.0, 150.0, 0.0, 0.0, 0.0, 100.0)
        val statsB = DrivingStatsData(0.0, 0.0, 160.0, 0.0, 0.0, 0.0, 90.0)
        val costA = CostSummaryData(500.0, 0.0, 0.0)
        val costB = CostSummaryData(400.0, 0.0, 0.0)
        assertEquals("80% vs 65%", batteryHighlightValue(stateOf(battery = 80), stateOf(battery = 65)))
        assertEquals("\u2014% vs 65%", batteryHighlightValue(null, stateOf(battery = 65)))
        assertEquals("150.00 vs 160.00", efficiencyHighlightValue(statsA, statsB, metricPrefs))
        assertEquals("$500 vs $400", costHighlightValue(costA, costB, metricPrefs))
        assertEquals("100.00 vs 90.00", co2HighlightValue(statsA, statsB, metricPrefs))
    }

    // ── Battery bar ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun batteryToneAndFractionFollowThresholds() {
        assertEquals(BatteryTone.Good, batteryTone(80))
        assertEquals(BatteryTone.Warning, batteryTone(30))
        assertEquals(BatteryTone.Critical, batteryTone(10))
        assertEquals(0.8f, batteryFillFraction(80), 0.0f)
        assertEquals(1.0f, batteryFillFraction(150), 0.0f)
    }

    // ── Status projection ─────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun vehicleStatusProjectsOnlineCardFromSiState() {
        val model = vehicleStatus(vehicleOf(model = "Model 3", trim = "Long Range"), envelopeOf(stateOf(battery = 80)), metricPrefs)
        assertEquals("Car 7", model.name)
        assertEquals("Model 3 \u00B7 Long Range", model.subtitle)
        assertTrue(model.online)
        assertTrue(model.hasState)
        assertEquals(80L, model.batteryLevel)
        assertEquals("350.0 km", model.rangeText)
        assertEquals("21.5\u00B0C / 12.0\u00B0C", model.tempText)
        assertEquals("online", model.rawStatus)
    }

    @Test
    fun vehicleStatusFallsBackWhenStateAbsent() {
        val model = vehicleStatus(vehicleOf(model = null, trim = null), VehicleStateEnvelope(state = null, live = false), metricPrefs)
        assertFalse(model.hasState)
        assertFalse(model.online)
        assertNull(model.batteryLevel)
        assertNull(model.subtitle)
        assertEquals("\u2014", model.rangeText)
        assertEquals("\u2014", model.tempText)
        assertNull(model.rawStatus)
    }

    // ── Display prefs ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun displayPrefsResolveCurrencyAndPrecisionFromSettings() {
        val prefs =
            FleetCompareDisplayPrefs.fromSettings(
                buildJsonObject {
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 0)
                },
            )
        assertEquals("\u20AC", prefs.symbol)
        assertEquals(0, prefs.precision)
        // Default (no settings) keeps the metric "$" + 2dp contract.
        assertEquals("$", metricPrefs.symbol)
        assertEquals(2, metricPrefs.precision)
    }

    // ── Builders ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun vehicleOf(
        model: String?,
        trim: String?,
        id: Long = 7L,
    ): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN$id",
            model = model,
            trimLevel = trim,
        )

    private fun stateOf(
        battery: Long,
        state: String = "online",
    ): VehicleState =
        VehicleState(
            batteryLevel = battery,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 360_000.0,
            insideTemp = 21.5,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = 12.0,
            power = 0.0,
            ratedRange = 350_000.0,
            sentryMode = true,
            softwareVersion = "2025.x",
            speed = 0.0,
            state = state,
            timeToFullCharge = 0.0,
            vehicleId = 7L,
        )

    private fun envelopeOf(state: VehicleState): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = true)
}
