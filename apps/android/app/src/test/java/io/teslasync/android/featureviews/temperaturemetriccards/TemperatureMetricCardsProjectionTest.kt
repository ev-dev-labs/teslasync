package io.teslasync.android.featureviews.temperaturemetriccards

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the TemperatureMetricCards pure logic — the native mirror of every derivation
 * the web component performs (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx):
 * the per-sensor `displayTemp` value + `tempNeonColor` accent + `"{pct}% of max" | "No data"` subtitle, the
 * Health Score tile (`"{healthScore}%"` + health-derived accent), and the Peak Power tile
 * (`peakPower > 0 ? "{fmtInt} kW" : "—"`). Because the surface is presentational, each
 * [TemperatureMetricCardsDisplay] is exactly what the thin composable renders, so these assertions double as
 * the per-state adapter "snapshot" and the a11y-label coverage (the folded `contentDescription`).
 */
class TemperatureMetricCardsProjectionTest {
    private val strings =
        TemperatureMetricCardsStrings(
            ofMax = "of max",
            noData = "No data",
            healthScore = "Health Score",
            peakPower = "Peak Power",
            loadingLabel = "Loading",
        )

    private fun prefs(
        temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
        precision: Int? = null,
        locale: String? = null,
    ): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = locale,
            precision = precision,
        )

    private fun sensor(
        value: Double?,
        max: Double = 150.0,
        label: String = "Front Motor",
        icon: TemperatureMetricIcon = TemperatureMetricIcon.Motor,
    ): TempSensor = TempSensor(label = label, value = value, maxTemp = max, icon = icon)

    @Suppress("LongParameterList")
    private fun project(
        sensors: List<TempSensor>,
        overallHealth: DrivetrainHealthStatus = DrivetrainHealthStatus.Good,
        healthScore: Int = 95,
        peakPowerKw: Double = 0.0,
        prefs: UnitPref = prefs(),
        loading: Boolean = false,
        locale: Locale = Locale.US,
    ): TemperatureMetricCardsDisplay =
        TemperatureMetricCardsProjection.project(
            sensors = sensors,
            overallHealth = overallHealth,
            healthScore = healthScore,
            peakPowerKw = peakPowerKw,
            prefs = prefs,
            strings = strings,
            loading = loading,
            locale = locale,
        )

    // ── project(): the resolved grid (sensors + health + peak, in web order) ─────

    @Test
    fun buildsEveryCardInWebOrder() {
        val display =
            project(
                sensors =
                    listOf(
                        sensor(82.0, 150.0, "Front Motor", TemperatureMetricIcon.Motor),
                        sensor(104.0, 150.0, "Rear Motor", TemperatureMetricIcon.Motor),
                        sensor(108.0, 120.0, "Inverter", TemperatureMetricIcon.Inverter),
                        sensor(30.0, 60.0, "Battery", TemperatureMetricIcon.Battery),
                    ),
                overallHealth = DrivetrainHealthStatus.Warning,
                healthScore = 60,
                peakPowerKw = 187.0,
            )

        assertTrue(display.hasData)
        assertEquals(6, display.cards.size)

        val front = display.cards[0]
        assertEquals("Front Motor", front.label)
        assertEquals("82.0\u00B0C", front.value)
        assertEquals("55% of max", front.subtitle)
        assertEquals(TemperatureMetricIcon.Motor, front.icon)
        assertEquals(TemperatureMetricColor.Green, front.color)

        // Rear motor 104/150 = 0.69 → amber; inverter 108/120 = 0.90 → red; battery 30/60 = 0.50 → green.
        assertEquals(TemperatureMetricColor.Amber, display.cards[1].color)
        assertEquals("69% of max", display.cards[1].subtitle)
        assertEquals(TemperatureMetricColor.Red, display.cards[2].color)
        assertEquals("90% of max", display.cards[2].subtitle)
        assertEquals(TemperatureMetricColor.Green, display.cards[3].color)
    }

    @Test
    fun healthCardRendersScoreIconAndStatusAccent() {
        val display = project(sensors = listOf(sensor(50.0)), overallHealth = DrivetrainHealthStatus.Warning, healthScore = 60)
        val health = display.cards[1]
        assertEquals("Health Score", health.label)
        assertEquals("60%", health.value)
        assertNull(health.subtitle)
        assertEquals(TemperatureMetricIcon.Heart, health.icon)
        assertEquals(TemperatureMetricColor.Amber, health.color)
    }

    @Test
    fun healthCardAccentTracksEveryStatus() {
        assertEquals(
            TemperatureMetricColor.Green,
            project(listOf(sensor(50.0)), overallHealth = DrivetrainHealthStatus.Good, healthScore = 95).cards[1].color,
        )
        assertEquals(
            TemperatureMetricColor.Amber,
            project(listOf(sensor(50.0)), overallHealth = DrivetrainHealthStatus.Warning, healthScore = 60).cards[1].color,
        )
        assertEquals(
            TemperatureMetricColor.Red,
            project(listOf(sensor(50.0)), overallHealth = DrivetrainHealthStatus.Critical, healthScore = 25).cards[1].color,
        )
    }

    @Test
    fun peakCardRendersPowerIconPurpleAndKilowatts() {
        val peak = project(sensors = listOf(sensor(50.0)), peakPowerKw = 187.0).cards.last()
        assertEquals("Peak Power", peak.label)
        assertEquals("187 kW", peak.value)
        assertNull(peak.subtitle)
        assertEquals(TemperatureMetricIcon.Power, peak.icon)
        assertEquals(TemperatureMetricColor.Purple, peak.color)
    }

    @Test
    fun peakCardGroupsThousands() {
        assertEquals("1,234 kW", project(sensors = listOf(sensor(50.0)), peakPowerKw = 1234.0).cards.last().value)
    }

    @Test
    fun peakCardDashesWhenNotPositive() {
        assertEquals(EM_DASH, project(sensors = listOf(sensor(50.0)), peakPowerKw = 0.0).cards.last().value)
        assertEquals(EM_DASH, project(sensors = listOf(sensor(50.0)), peakPowerKw = -5.0).cards.last().value)
    }

    // ── project(): the per-sensor null branch (web `value !== null ? … : 'No data'`) ─────

    @Test
    fun absentSensorRendersDashValueAndNoDataSubtitle() {
        val card = project(sensors = listOf(sensor(value = null))).cards[0]
        assertEquals(EM_DASH, card.value)
        assertEquals("No data", card.subtitle)
        // tempNeonColor returns green for a null reading.
        assertEquals(TemperatureMetricColor.Green, card.color)
    }

    // ── tempColor(): web tempNeonColor buckets ───────────────────────────────────

    @Test
    fun tempColorBucketsMatchWebThresholds() {
        assertEquals(TemperatureMetricColor.Green, TemperatureMetricCardsProjection.tempColor(null, 150.0))
        // Exactly 0.65 → amber, exactly 0.85 → red (web `>=`).
        assertEquals(TemperatureMetricColor.Amber, TemperatureMetricCardsProjection.tempColor(97.5, 150.0))
        assertEquals(TemperatureMetricColor.Red, TemperatureMetricCardsProjection.tempColor(127.5, 150.0))
        assertEquals(TemperatureMetricColor.Green, TemperatureMetricCardsProjection.tempColor(96.0, 150.0))
        assertEquals(TemperatureMetricColor.Amber, TemperatureMetricCardsProjection.tempColor(126.0, 150.0))
    }

    // ── value formatting: shared formatTemperature (SI → display, precision 1) ────

    @Test
    fun celsiusFormatsWithOneDecimalAndDegreeSuffix() {
        assertEquals("82.4\u00B0C", project(sensors = listOf(sensor(82.4))).cards[0].value)
    }

    @Test
    fun fahrenheitConvertsFromSiAndSuffixesUnit() {
        // 100°C → 212°F.
        val card = project(sensors = listOf(sensor(100.0)), prefs = prefs(temperature = TemperatureUnitPref.FAHRENHEIT)).cards[0]
        assertEquals("212.0\u00B0F", card.value)
    }

    @Test
    fun precisionOverrideFromSettingsIsHonored() {
        assertEquals("82.40\u00B0C", project(sensors = listOf(sensor(82.4)), prefs = prefs(precision = 2)).cards[0].value)
    }

    // ── empty + loading states ────────────────────────────────────────────────────

    @Test
    fun emptySensorsProduceTheEmptySurface() {
        val display = project(sensors = emptyList())
        assertFalse(display.hasData)
        assertTrue(display.cards.isEmpty())
    }

    @Test
    fun loadingFlagIsThreadedThrough() {
        assertTrue(project(sensors = emptyList(), loading = true).loading)
        assertFalse(project(sensors = emptyList(), loading = false).loading)
    }

    // ── accessibility: folded contentDescription ──────────────────────────────────

    @Test
    fun contentDescriptionFoldsLabelValueAndSubtitle() {
        val card = project(sensors = listOf(sensor(75.0, 150.0, "Front Motor", TemperatureMetricIcon.Motor))).cards[0]
        assertEquals("Front Motor 75.0\u00B0C 50% of max", card.contentDescription)
    }

    @Test
    fun contentDescriptionOmitsAbsentSubtitle() {
        val health = project(sensors = listOf(sensor(50.0)), overallHealth = DrivetrainHealthStatus.Good, healthScore = 95).cards[1]
        assertEquals("Health Score 95%", health.contentDescription)
    }

    // ── resolveDisplayLocale(): web fmtNumber locale default ──────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
