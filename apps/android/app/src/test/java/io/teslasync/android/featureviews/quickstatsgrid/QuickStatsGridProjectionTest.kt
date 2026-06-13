package io.teslasync.android.featureviews.quickstatsgrid

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
 * Off-device verification of the QuickStatsGrid pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx and the shared
 * `formatDistance` / `formatSpeed` / `formatTemperature` / `fmtNumber` helpers): the eight cells' values,
 * accents, glyphs, and the Speed cell's driving / parked subtitle. Because the surface is purely
 * presentational, each [QuickStatsGridDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot": the resolved (`state` present) grid and the empty
 * (`state` absent) branch.
 */
class QuickStatsGridProjectionTest {
    private val metricPrefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private val imperialPrefs =
        metricPrefs.copy(
            distance = DistanceUnitPref.MI,
            speed = SpeedUnitPref.MPH,
            temperature = TemperatureUnitPref.FAHRENHEIT,
        )

    // Sample labels stand in for the resolved P1/S10 catalog strings the composable passes in.
    private val strings =
        QuickStatsGridStrings(
            battery = "Battery",
            range = "Range",
            odometer = "Odometer",
            speed = "Speed",
            driving = "Driving",
            parked = "Parked",
            insideTemp = "Inside Temp",
            outsideTemp = "Outside Temp",
            power = "Power",
            state = "State",
            noData = "No data available",
            loadingLabel = "Loading",
        )

    // A driving vehicle: 72 %, 412 km rated range, 18,000 km odometer, ~97 km/h, 21.5 / 9 °C, 85 kW.
    private val sample =
        QuickStatsVehicleState(
            batteryLevel = 72.0,
            ratedRangeMeters = 412_000.0,
            odometerMeters = 18_000_000.0,
            speedMps = 27.0,
            insideTempCelsius = 21.5,
            outsideTempCelsius = 9.0,
            power = 85.0,
        )

    // ── project(): per-state ──────────────────────────────────────────────────────

    @Test
    fun resolvedStateProjectsEveryCellInWebSourceOrder() {
        val display = QuickStatsGridProjection.project(sample, "driving", metricPrefs, strings, false, Locale.US)

        assertFalse(display.loading)
        assertTrue(display.hasData)
        assertEquals(
            listOf(
                QuickStatCard("Battery", "72%", null, QuickStatIcon.Battery, QuickStatColor.Green, "Battery 72%"),
                QuickStatCard("Range", "412 km", null, QuickStatIcon.Navigation, QuickStatColor.Cyan, "Range 412 km"),
                QuickStatCard(
                    label = "Odometer",
                    value = "18,000 km",
                    subtitle = null,
                    icon = QuickStatIcon.Car,
                    color = QuickStatColor.Purple,
                    contentDescription = "Odometer 18,000 km",
                ),
                QuickStatCard(
                    label = "Speed",
                    value = "97 km/h",
                    subtitle = "Driving",
                    icon = QuickStatIcon.Gauge,
                    color = QuickStatColor.Cyan,
                    contentDescription = "Speed 97 km/h Driving",
                ),
                QuickStatCard(
                    label = "Inside Temp",
                    value = "21.5\u00B0C",
                    subtitle = null,
                    icon = QuickStatIcon.Thermometer,
                    color = QuickStatColor.Green,
                    contentDescription = "Inside Temp 21.5\u00B0C",
                ),
                QuickStatCard(
                    label = "Outside Temp",
                    value = "9.0\u00B0C",
                    subtitle = null,
                    icon = QuickStatIcon.Thermometer,
                    color = QuickStatColor.Cyan,
                    contentDescription = "Outside Temp 9.0\u00B0C",
                ),
                QuickStatCard("Power", "85.00 kW", null, QuickStatIcon.Bolt, QuickStatColor.Purple, "Power 85.00 kW"),
                QuickStatCard("State", "driving", null, QuickStatIcon.Activity, QuickStatColor.Cyan, "State driving"),
            ),
            display.cards,
        )
    }

    @Test
    fun absentStateProjectsToTheEmptyBranch() {
        val display = QuickStatsGridProjection.project(null, "driving", metricPrefs, strings, false, Locale.US)

        assertFalse(display.hasData)
        assertTrue(display.cards.isEmpty())
    }

    @Test
    fun loadingFlagThreadsThroughWithTheCardsStillComputed() {
        val display = QuickStatsGridProjection.project(sample, "driving", metricPrefs, strings, true, Locale.US)

        assertTrue(display.loading)
        assertTrue(display.hasData)
        assertEquals(8, display.cards.size)
    }

    @Test
    fun absentFieldsRenderTheEmDashFallbackNeverNaN() {
        val blank = QuickStatsVehicleState(null, null, null, null, null, null, null)

        val cards = QuickStatsGridProjection.project(blank, null, metricPrefs, strings, false, Locale.US).cards

        assertEquals(EM_DASH, cards[0].value) // battery
        assertEquals(EM_DASH, cards[1].value) // range
        assertEquals(EM_DASH, cards[2].value) // odometer
        assertEquals(EM_DASH, cards[3].value) // speed
        assertEquals("Parked", cards[3].subtitle) // speed subtitle defaults to parked
        assertEquals(EM_DASH, cards[4].value) // inside temp
        assertEquals(EM_DASH, cards[5].value) // outside temp
        assertEquals("0.00 kW", cards[6].value) // power coerces a null figure to zero
        assertEquals(EM_DASH, cards[7].value) // state
    }

    // ── per-quantity unit conversion (display boundary) ────────────────────────────

    @Test
    fun imperialPrefsConvertEachReadingAtTheDisplayBoundary() {
        val state = sample.copy(insideTempCelsius = 20.0)

        val cards = QuickStatsGridProjection.project(state, "driving", imperialPrefs, strings, false, Locale.US).cards

        assertEquals("256 mi", cards[1].value) // 412,000 m -> 256 mi
        assertEquals("60 mph", cards[3].value) // 27 m/s -> 60 mph
        assertEquals("68.0\u00B0F", cards[4].value) // 20 °C -> 68 °F
    }

    // ── batteryValue()/batteryColor(): web `${battery_level}%`, `> 50 ? green : cyan` ──

    @Test
    fun batteryValueAppendsPercentAndStringifiesLikeAJsTemplate() {
        assertEquals("72%", QuickStatsGridProjection.batteryValue(72.0))
        assertEquals("80.5%", QuickStatsGridProjection.batteryValue(80.5))
        assertEquals(EM_DASH, QuickStatsGridProjection.batteryValue(null))
    }

    @Test
    fun batteryColorIsGreenAboveFiftyOtherwiseCyan() {
        assertEquals(QuickStatColor.Green, QuickStatsGridProjection.batteryColor(51.0))
        assertEquals(QuickStatColor.Cyan, QuickStatsGridProjection.batteryColor(50.0))
        assertEquals(QuickStatColor.Cyan, QuickStatsGridProjection.batteryColor(20.0))
        assertEquals(QuickStatColor.Cyan, QuickStatsGridProjection.batteryColor(null))
    }

    // ── speedSubtitle(): web `speed > 0 ? Driving : Parked` ────────────────────────

    @Test
    fun speedSubtitleIsDrivingOnlyForAPositiveSpeed() {
        assertEquals("Driving", QuickStatsGridProjection.speedSubtitle(0.1, strings))
        assertEquals("Parked", QuickStatsGridProjection.speedSubtitle(0.0, strings))
        assertEquals("Parked", QuickStatsGridProjection.speedSubtitle(null, strings))
    }

    // ── powerValue(): web `${fmtNumber(state.power)} kW` ───────────────────────────

    @Test
    fun powerValueGroupsTheRawFigureAndAppendsKilowatts() {
        assertEquals("85.00 kW", QuickStatsGridProjection.powerValue(85.0, metricPrefs, Locale.US))
        assertEquals("0.00 kW", QuickStatsGridProjection.powerValue(null, metricPrefs, Locale.US))
        assertEquals("0.00 kW", QuickStatsGridProjection.powerValue(Double.NaN, metricPrefs, Locale.US))
    }

    @Test
    fun powerValueHonorsThePrefsPrecisionAndGroupingLocale() {
        val germanPrefs = metricPrefs.copy(locale = "de-DE", precision = 1)
        assertEquals("2.000,0 kW", QuickStatsGridProjection.powerValue(2000.0, germanPrefs, Locale.GERMANY))
    }

    // ── stateValue()/plainNumber() ─────────────────────────────────────────────────

    @Test
    fun stateValueRendersTheRawStatusVerbatim() {
        assertEquals("driving", QuickStatsGridProjection.stateValue("driving"))
        assertEquals(EM_DASH, QuickStatsGridProjection.stateValue(null))
        assertEquals(EM_DASH, QuickStatsGridProjection.stateValue(" "))
    }

    @Test
    fun plainNumberDropsTheDecimalForWholeValues() {
        assertEquals("72", QuickStatsGridProjection.plainNumber(72.0))
        assertEquals("0", QuickStatsGridProjection.plainNumber(0.0))
        assertEquals("72.5", QuickStatsGridProjection.plainNumber(72.5))
    }

    // ── accessibility ──────────────────────────────────────────────────────────────

    @Test
    fun everyCardCarriesANonBlankLabelFoldingTitleValueAndSubtitle() {
        val cards = QuickStatsGridProjection.project(sample, "driving", metricPrefs, strings, false, Locale.US).cards

        cards.forEach { card ->
            assertTrue("contentDescription must not be blank", card.contentDescription.isNotBlank())
            assertTrue("must include the label", card.contentDescription.contains(card.label))
            assertTrue("must include the value", card.contentDescription.contains(card.value))
        }
        // The Speed cell folds its driving / parked subtitle into the TalkBack label.
        assertEquals("Speed 97 km/h Driving", cards[3].contentDescription)
    }
}
