package io.teslasync.android.dashboard.widgets.rangebar

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
import java.util.Locale

/**
 * Off-device verification of the RangeBarWidget's pure logic — the SI→display distance conversion, the web
 * `fmtNumber` number contract (en-US grouping, fixed digits), the rated/ideal bar projection, the signed
 * EPA-variance derivation, the empty-state gate (`state == null` OR both ranges zero), the compact hero,
 * the folded TalkBack descriptions, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RangeBarWidget.tsx).
 */
class RangeBarProjectionTest {
    private val strings =
        RangeBarStrings(
            range = "Range",
            rated = "rated",
            ratedRange = "Rated Range",
            idealRange = "Ideal Range",
            epaComparison = "EPA variance",
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

    // SI inputs chosen to land on round display values: 402336 m = 250 mi = 402.336 km;
    // 418429.44 m = 260 mi; 386242.56 m = 240 mi. The 10-mi gap over 250 mi is exactly 4.0%.
    private fun state(
        ratedMeters: Double = RATED_250_MI,
        idealMeters: Double = IDEAL_260_MI,
    ): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = idealMeters,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = ratedMeters,
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
        size: RangeBarSize = RangeBarRegistration.defaultSize,
    ): RangeBarDisplay = RangeBarProjection.project(state, size, prefs, strings, Locale.US)

    @Test
    fun nullStateProjectsEmpty() {
        val display = project(null)
        assertFalse(display.hasData)
        assertEquals("No range data", display.emptyMessage)
    }

    @Test
    fun bothRangesZeroProjectsEmpty() {
        val display = project(state(ratedMeters = 0.0, idealMeters = 0.0))
        assertFalse(display.hasData)
    }

    @Test
    fun projectsBothBarsInMiles() {
        val display = project(state())
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertEquals(250.0, display.ratedValue, EPSILON)
        assertEquals(260.0, display.idealValue, EPSILON)
        assertEquals(260.0, display.maxValue, EPSILON)
        assertEquals("Rated Range", display.ratedLabel)
        assertEquals("Ideal Range", display.idealLabel)
        assertEquals("250 mi", display.ratedSublabel)
        assertEquals("260 mi", display.idealSublabel)
    }

    @Test
    fun projectsBothBarsInKilometers() {
        val display = project(state(), prefs(DistanceUnitPref.KM))
        assertEquals("402 km", display.ratedSublabel)
        assertEquals("418 km", display.idealSublabel)
    }

    @Test
    fun epaVarianceVisibleAndSignedWhenBothPositive() {
        val display = project(state())
        assertTrue(display.epaVisible)
        assertEquals("+4.0%", display.epaValueText)
        assertEquals(
            "Rated Range 250 mi, Ideal Range 260 mi, EPA variance +4.0%",
            display.standardContentDescription,
        )
    }

    @Test
    fun epaVarianceHiddenWhenIdealMissing() {
        val display = project(state(idealMeters = 0.0))
        assertTrue(display.hasData)
        assertFalse(display.epaVisible)
        assertEquals("", display.epaValueText)
        assertEquals("Rated Range 250 mi, Ideal Range 0 mi", display.standardContentDescription)
    }

    @Test
    fun epaVarianceReproducesWebSignContract() {
        assertEquals("+4.0%", RangeBarProjection.epaVariance(RATED_250_MI, IDEAL_260_MI, Locale.US))
        assertEquals("-4.0%", RangeBarProjection.epaVariance(RATED_250_MI, IDEAL_240_MI, Locale.US))
        // ideal == rated: web `ideal >= rated` is true, so a leading '+' is added to the zero value.
        assertEquals("+0.0%", RangeBarProjection.epaVariance(RATED_250_MI, RATED_250_MI, Locale.US))
    }

    @Test
    fun compactProjectsRatedHero() {
        val display = project(state(), size = RangeBarSize(cols = 1, rows = 1))
        assertTrue(display.isCompact)
        assertEquals(250.0, display.compactRatedValue, EPSILON)
        assertEquals("250", display.compactValueText)
        assertEquals("mi rated", display.compactUnitLabel)
        assertEquals("250 mi rated", display.compactContentDescription)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("range-bar", RangeBarRegistration.ID)
        assertEquals("battery", RangeBarRegistration.CATEGORY)
        assertEquals("RangeBarWidget", RangeBarRegistration.SLUG)
        assertEquals(RangeBarSize(cols = 2, rows = 2), RangeBarRegistration.defaultSize)
        assertEquals(RangeBarSize(cols = 1, rows = 2), RangeBarRegistration.minSize)
        assertEquals(RangeBarSize(cols = 4, rows = 40), RangeBarRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(RangeBarSize(cols = 4, rows = 40), RangeBarRegistration.clamp(RangeBarSize(9, 99)))
        assertEquals(RangeBarSize(cols = 1, rows = 2), RangeBarRegistration.clamp(RangeBarSize(0, 0)))
        assertTrue(RangeBarRegistration.isWithinBounds(RangeBarSize(2, 2)))
        assertFalse(RangeBarRegistration.isWithinBounds(RangeBarSize(5, 2)))
    }

    @Test
    fun isCompactOnlyAtSingleCell() {
        assertTrue(RangeBarSize(cols = 1, rows = 1).isCompact)
        assertFalse(RangeBarSize(cols = 1, rows = 2).isCompact)
        assertFalse(RangeBarSize(cols = 2, rows = 2).isCompact)
    }

    private companion object {
        const val EPSILON = 1e-6
        const val RATED_250_MI = 402_336.0
        const val IDEAL_260_MI = 418_429.44
        const val IDEAL_240_MI = 386_242.56
    }
}
