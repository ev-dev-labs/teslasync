package io.teslasync.android.dashboard.widgets.rangeestimate

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RangeEstimateWidget's pure logic — the SI→display distance conversion, the
 * web `fmtNumber(…, 0)` number contract (en-US grouping, zero fraction digits, half-expand rounding), the
 * ranges / no-data projection branches, the `safeNumber`/`?? 0` non-finite guard, the TalkBack content
 * description, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RangeEstimateWidget.tsx).
 */
class RangeEstimateProjectionTest {
    private val strings =
        RangeEstimateStrings(
            ratedRange = "Rated Range",
            idealRange = "Ideal Range",
            noRange = "No range data",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.MI): UnitPref =
        UnitPref(
            distance = distance,
            speed = if (distance == DistanceUnitPref.MI) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    // SI inputs chosen to land on round display values: ratedRange 402336 m = 250 mi = 402.336 km;
    // idealRange 418429.44 m = 260 mi = 418.42944 km.
    private fun state(
        ratedRange: Double = 402_336.0,
        idealRange: Double = 418_429.44,
    ): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = idealRange,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = ratedRange,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun project(
        state: VehicleState?,
        prefs: UnitPref = prefs(),
    ): RangeEstimateDisplay = RangeEstimateProjection.project(state, prefs, strings)

    @Test
    fun nullStateProjectsNoData() {
        val display = project(null)
        assertTrue(display is RangeEstimateDisplay.NoData)
        assertEquals("No range data", display.contentDescription)
    }

    @Test
    fun rangesProjectInMiles() {
        val display = project(state()) as RangeEstimateDisplay.Ranges
        assertEquals("250 mi", display.ratedRangeText)
        assertEquals("260 mi", display.idealRangeText)
        assertEquals("Rated Range 250 mi, Ideal Range 260 mi", display.contentDescription)
    }

    @Test
    fun rangesHonorKilometersUnit() {
        val display = project(state(), prefs(DistanceUnitPref.KM)) as RangeEstimateDisplay.Ranges
        assertEquals("402 km", display.ratedRangeText)
        assertEquals("418 km", display.idealRangeText)
        assertEquals("Rated Range 402 km, Ideal Range 418 km", display.contentDescription)
    }

    @Test
    fun nonFiniteRangeIsCoercedToZero() {
        // Web parity: `state.rated_range ?? 0` + `fmtNumber`'s `safeNumber` never render NaN/∞.
        val display = project(state(ratedRange = Double.NaN, idealRange = Double.POSITIVE_INFINITY)) as RangeEstimateDisplay.Ranges
        assertEquals("0 mi", display.ratedRangeText)
        assertEquals("0 mi", display.idealRangeText)
    }

    @Test
    fun zeroRangeRendersZero() {
        val display = project(state(ratedRange = 0.0, idealRange = 0.0), prefs(DistanceUnitPref.KM)) as RangeEstimateDisplay.Ranges
        assertEquals("0 km", display.ratedRangeText)
        assertEquals("0 km", display.idealRangeText)
    }

    @Test
    fun formattersReproduceWebEnUsHalfExpandContract() {
        assertEquals("1,234.5", RangeEstimateProjection.formatNumber(1234.5, decimals = 1))
        // Half-expand (round half away from zero), not Java's default banker's rounding.
        assertEquals("1,235", RangeEstimateProjection.formatNumber(1234.5, decimals = 0))
        assertEquals("13", RangeEstimateProjection.formatNumber(12.5, decimals = 0))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("range-estimate", RangeEstimateRegistration.ID)
        assertEquals("battery", RangeEstimateRegistration.CATEGORY)
        assertEquals("RangeEstimateWidget", RangeEstimateRegistration.SLUG)
        assertEquals(RangeEstimateSize(cols = 1, rows = 2), RangeEstimateRegistration.defaultSize)
        assertEquals(RangeEstimateSize(cols = 1, rows = 2), RangeEstimateRegistration.minSize)
        assertEquals(RangeEstimateSize(cols = 2, rows = 40), RangeEstimateRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(RangeEstimateSize(cols = 2, rows = 40), RangeEstimateRegistration.clamp(RangeEstimateSize(9, 99)))
        assertEquals(RangeEstimateSize(cols = 1, rows = 2), RangeEstimateRegistration.clamp(RangeEstimateSize(0, 0)))
        assertTrue(RangeEstimateRegistration.isWithinBounds(RangeEstimateSize(1, 2)))
        assertFalse(RangeEstimateRegistration.isWithinBounds(RangeEstimateSize(3, 2)))
    }
}
