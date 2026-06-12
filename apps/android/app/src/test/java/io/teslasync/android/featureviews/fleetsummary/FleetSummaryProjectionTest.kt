package io.teslasync.android.featureviews.fleetsummary

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the FleetSummary pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/vehicles/components/FleetSummary.tsx): the per-state `?? 0` guards,
 * the average-battery mean, the SI-metres range sum + `convertDistanceFromSI`, the `is_charging` /
 * present-state counts, and the `Math.round` the component applies before handing each figure to
 * `AnimatedNumber`. Each [FleetSummaryDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot": the resolved (populated) grid and the empty (no-data →
 * zeros) grid.
 */
class FleetSummaryProjectionTest {
    private val metric = FleetSummaryDisplayPrefs(DistanceUnitPref.KM, Locale.US)
    private val imperial = FleetSummaryDisplayPrefs(DistanceUnitPref.MI, Locale.US)

    // Two present states: 80% over 300 km of SI range (charging) and 60% over 200 km (idle).
    private val states =
        listOf(
            state(batteryLevel = 80, ratedRangeMeters = 300_000.0, charging = true),
            state(batteryLevel = 60, ratedRangeMeters = 200_000.0, charging = false),
        )

    // ── aggregate(): populated ─────────────────────────────────────────────────────

    @Test
    fun aggregateReducesEveryFigureLikeTheWebUseQuery() {
        val data = FleetSummaryAggregator.aggregate(vehicleCount = 2, decodedStates = states)

        assertEquals(2, data.vehicleCount)
        // (80 + 60) / 2 = 70 (web `Σ battery_level / states.length`).
        assertEquals(70.0, data.avgBatteryPercent, 1e-9)
        // 300,000 + 200,000 = 500,000 SI metres (web `Σ (rated_range ?? 0)`).
        assertEquals(500_000.0, data.totalRangeMeters, 1e-9)
        assertEquals(1, data.chargingCount)
        assertEquals(2, data.onlineCount)
    }

    @Test
    fun aggregateCountsOnlinePresentStatesIndependentlyOfEnrolledCount() {
        // Three enrolled, but only two have a resolved state (web `onlineCount = states.length`).
        val data = FleetSummaryAggregator.aggregate(vehicleCount = 3, decodedStates = states)
        assertEquals(3, data.vehicleCount)
        assertEquals(2, data.onlineCount)
    }

    // ── aggregate(): empty / no data (web `?? 0`) ──────────────────────────────────

    @Test
    fun aggregateWithNoStatesCollapsesEveryFigureToZero() {
        val data = FleetSummaryAggregator.aggregate(vehicleCount = 0, decodedStates = emptyList())

        // The friendly empty surface: every figure is zero, never NaN (web `states.length > 0 ? … : 0`).
        assertEquals(FleetSummaryData.EMPTY, data)
        assertEquals(0.0, data.avgBatteryPercent, 1e-9)
        assertEquals(0.0, data.totalRangeMeters, 1e-9)
        assertEquals(0, data.chargingCount)
        assertEquals(0, data.onlineCount)
    }

    @Test
    fun aggregateWithVehiclesButNoStatesShowsTheEnrolledCountOverZeros() {
        // Vehicles enrolled but their states have not resolved yet (the web `allStates ?? []` early frame).
        val data = FleetSummaryAggregator.aggregate(vehicleCount = 4, decodedStates = emptyList())
        assertEquals(4, data.vehicleCount)
        assertEquals(0.0, data.avgBatteryPercent, 1e-9)
        assertEquals(0, data.onlineCount)
    }

    // ── project(): populated (metric) ──────────────────────────────────────────────

    @Test
    fun populatedMetricProjectsEveryFigure() {
        val data = FleetSummaryAggregator.aggregate(2, states)
        val display = FleetSummaryProjection.project(data, metric)

        assertEquals(2.0, display.vehicleCount, 1e-9)
        assertEquals(70.0, display.avgBattery, 1e-9)
        // 500,000 SI metres → 500 km (web `convertDistanceFromSI`), Math.round → 500.
        assertEquals(500.0, display.totalRange, 1e-9)
        assertEquals("km", display.rangeUnit)
        assertEquals(1.0, display.chargingCount, 1e-9)
        assertEquals(2, display.onlineCount)
    }

    @Test
    fun populatedMetricRendersTheWebFiguresThroughTheSharedFormatter() {
        // Pin what the user actually sees (the composable formats the count-up targets via ChartFormat).
        val display = FleetSummaryProjection.project(FleetSummaryAggregator.aggregate(2, states), metric)
        assertEquals("2", ChartFormat.number(display.vehicleCount, COUNT_DECIMALS, Locale.US))
        assertEquals("70", ChartFormat.number(display.avgBattery, BATTERY_DECIMALS, Locale.US))
        assertEquals("500", ChartFormat.number(display.totalRange, RANGE_DECIMALS, Locale.US))
        assertEquals("1", ChartFormat.number(display.chargingCount, COUNT_DECIMALS, Locale.US))
    }

    // ── project(): rounding (web `Math.round`) ─────────────────────────────────────

    @Test
    fun averageBatteryIsRoundedHalfUpLikeMathRound() {
        // (73 + 74) / 2 = 73.5 → Math.round → 74 (ties toward +∞, the ECMAScript rule).
        val data =
            FleetSummaryAggregator.aggregate(
                2,
                listOf(
                    state(batteryLevel = 73, ratedRangeMeters = 0.0, charging = false),
                    state(batteryLevel = 74, ratedRangeMeters = 0.0, charging = false),
                ),
            )
        assertEquals(74.0, FleetSummaryProjection.project(data, metric).avgBattery, 1e-9)
    }

    @Test
    fun totalRangeIsConvertedThenRoundedHalfUp() {
        // 1,287,480 m → 1,287.48 km → Math.round → 1,287.
        val data = FleetSummaryAggregator.aggregate(1, listOf(state(50, 1_287_480.0, false)))
        assertEquals(1_287.0, FleetSummaryProjection.project(data, metric).totalRange, 1e-9)
    }

    @Test
    fun roundHalfUpMatchesMathRound() {
        assertEquals(1.0, FleetSummaryProjection.roundHalfUp(0.5), 1e-9)
        assertEquals(2.0, FleetSummaryProjection.roundHalfUp(1.5), 1e-9)
        assertEquals(2.0, FleetSummaryProjection.roundHalfUp(2.4), 1e-9)
        assertEquals(74.0, FleetSummaryProjection.roundHalfUp(73.5), 1e-9)
    }

    // ── project(): imperial conversion (web `useUnits`) ────────────────────────────

    @Test
    fun populatedImperialConvertsAndLabelsTheRange() {
        // 500,000 m / 1609.344 = 310.686 mi → Math.round → 311; the label flips to "mi".
        val display = FleetSummaryProjection.project(FleetSummaryAggregator.aggregate(2, states), imperial)
        assertEquals(311.0, display.totalRange, 1e-9)
        assertEquals("mi", display.rangeUnit)
        // Battery is unitless, so it is identical across unit systems.
        assertEquals(70.0, display.avgBattery, 1e-9)
    }

    // ── FleetSummaryDisplayPrefs.fromUnitPref(): the useUnits boundary ─────────────

    @Test
    fun fromUnitPrefCarriesTheDistanceUnitAndResolvesTheLocale() {
        val base = UnitPreferences.fromSettings(null) // metric defaults, locale "en-US"

        val metricPrefs = FleetSummaryDisplayPrefs.fromUnitPref(base)
        assertEquals(DistanceUnitPref.KM, metricPrefs.distanceUnit)
        assertEquals("en", metricPrefs.locale.language)
        assertEquals("US", metricPrefs.locale.country)

        val imperialPrefs = FleetSummaryDisplayPrefs.fromUnitPref(base.copy(distance = DistanceUnitPref.MI, locale = "de-DE"))
        assertEquals(DistanceUnitPref.MI, imperialPrefs.distanceUnit)
        assertEquals("de", imperialPrefs.locale.language)
    }

    @Test
    fun fromUnitPrefFallsBackToEnUsWhenTheLocaleTagIsBlankOrNull() {
        val base = UnitPreferences.fromSettings(null)
        assertEquals(Locale.US, FleetSummaryDisplayPrefs.fromUnitPref(base.copy(locale = "")).locale)
        assertEquals(Locale.US, FleetSummaryDisplayPrefs.fromUnitPref(base.copy(locale = null)).locale)
    }

    private fun state(
        batteryLevel: Long,
        ratedRangeMeters: Double,
        charging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 0.0,
            isCharging = charging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = ratedRangeMeters,
            sentryMode = false,
            softwareVersion = "",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )
}
