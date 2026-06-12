package io.teslasync.android.feature.views.summaryslide

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SummarySlide's pure logic — the raw-SI-JSON decode (incl. the nested
 * `vehicle` object), the `data ?` truthiness gate, the five headline stats (web order + labels + whole-number
 * formatting), the SI-kilometre → display-unit distance conversion (km → m → user unit, matching the web
 * `convertDistanceFromSI(total_distance_km * 1000, distanceUnit)`), the positive-savings gate, the
 * settings-derived display preference, and the registry slug. Mirrors the web spec
 * (web/src/features/analytics/components/review/SummarySlide.tsx).
 */
class SummarySlideProjectionTest {
    private val strings =
        SummarySlideStrings(
            title = "Year in Review",
            drives = "Drives",
            energyKwh = "kWh",
            charges = "Charges",
            co2KgSaved = "kg CO\u2082 saved",
            screenshot = "\uD83D\uDCF8 Screenshot to share your year!",
            noData = "No driving data for 2024",
            noDataHint = "Start driving and charging to build your annual review!",
        )

    private val year = 2024

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): SummarySlideDisplayPrefs = SummarySlideDisplayPrefs(distance)

    private fun sampleJson(
        distanceKm: Double = 12_500.0,
        savings: Double = 1840.0,
    ) = buildJsonObject {
        put("year", 2024)
        putJsonObject("vehicle") {
            put("display_name", "Bluebird")
            put("model", "Model 3")
        }
        put("total_drives", 412.0)
        put("total_distance_km", distanceKm)
        put("total_energy_kwh", 2980.0)
        put("total_charge_sessions", 96.0)
        put("co2_offset_kg", 1320.0)
        put("gas_savings", savings)
    }

    private fun project(
        json: JsonElement?,
        prefs: SummarySlideDisplayPrefs = prefs(),
    ): SummarySlideDisplay = SummarySlideProjection.project(parseSummarySlide(json), prefs, strings, year, Locale.US)

    @Test
    fun parseNullPayloadIsNull() {
        assertNull(parseSummarySlide(null))
    }

    @Test
    fun parseNonObjectPayloadIsNull() {
        assertNull(parseSummarySlide(JsonNull))
        assertNull(parseSummarySlide(JsonPrimitive(42)))
    }

    @Test
    fun parseEmptyObjectIsNull() {
        // Web `data ?` is falsy for an absent payload; an empty object carries no recap → empty surface.
        assertNull(parseSummarySlide(buildJsonObject {}))
    }

    @Test
    fun parseReadsSnakeCaseSiFieldsIncludingNestedVehicle() {
        val data = parseSummarySlide(sampleJson())!!
        assertEquals(2024, data.year)
        assertEquals("Bluebird", data.vehicleName)
        assertEquals("Model 3", data.vehicleModel)
        assertEquals(412.0, data.totalDrives, 0.0)
        assertEquals(12_500.0, data.totalDistanceKm, 0.0)
        assertEquals(2980.0, data.totalEnergyKwh, 0.0)
        assertEquals(96.0, data.totalChargeSessions, 0.0)
        assertEquals(1320.0, data.co2OffsetKg, 0.0)
        assertEquals(1840.0, data.gasSavings, 0.0)
    }

    @Test
    fun parseTreatsMissingNumericsAndAbsentVehicleAsZeroBlank() {
        val data = parseSummarySlide(buildJsonObject { put("total_drives", 5.0) })!!
        assertEquals(5.0, data.totalDrives, 0.0)
        assertEquals(0, data.year)
        assertEquals("", data.vehicleName)
        assertEquals("", data.vehicleModel)
        assertEquals(0.0, data.totalDistanceKm, 0.0)
        assertEquals(0.0, data.gasSavings, 0.0)
    }

    @Test
    fun populatedAllZeroPayloadStillProjectsContentNotEmpty() {
        // Web `data` is truthy for any populated payload — a vehicle with no drives renders the card.
        val display = project(buildJsonObject { put("total_drives", 0.0) })
        assertTrue(display.hasData)
        assertEquals("0", display.stats[0].formattedValue)
    }

    @Test
    fun statsFormatAllFiveTilesInWebOrder() {
        val stats = project(sampleJson()).stats
        assertEquals(5, stats.size)
        assertStat(stats[0], SummarySlideStatIcon.Drives, "Drives", "412")
        assertStat(stats[1], SummarySlideStatIcon.Distance, "km", "12,500")
        assertStat(stats[2], SummarySlideStatIcon.Energy, "kWh", "2,980")
        assertStat(stats[3], SummarySlideStatIcon.Charges, "Charges", "96")
        assertStat(stats[4], SummarySlideStatIcon.Co2, "kg CO\u2082 saved", "1,320")
    }

    @Test
    fun everyStatRendersAsAWholeNumberWithZeroDecimals() {
        project(sampleJson()).stats.forEach { assertEquals(0, it.decimals) }
    }

    @Test
    fun statContentDescriptionFoldsValueAndLabel() {
        val drives = project(sampleJson()).stats[0]
        assertEquals("412 Drives", drives.contentDescription)
    }

    @Test
    fun distanceBridgesSiKilometresAndConvertsPerUnit() {
        // Web `convertDistanceFromSI(total_distance_km * 1000, distanceUnit)` — the correct SI bridge.
        val km = project(sampleJson(), prefs(DistanceUnitPref.KM)).stats[1]
        assertEquals("12,500", km.formattedValue)
        assertEquals("km", km.label)
        assertEquals(12_500.0, convertDistanceFromSI(12_500_000.0, DistanceUnitPref.KM), 1e-6)

        val mi = project(sampleJson(), prefs(DistanceUnitPref.MI)).stats[1]
        // 12,500 km == 12,500,000 m / 1609.344 == 7767.13 mi.
        assertEquals(7767.13, convertDistanceFromSI(12_500_000.0, DistanceUnitPref.MI), 0.01)
        assertEquals("7,767", mi.formattedValue)
        assertEquals("mi", mi.label)
    }

    @Test
    fun savingsShownAndFormattedWhenPositive() {
        val display = project(sampleJson(savings = 1840.0))
        assertTrue(display.showSavings)
        assertEquals("1,840", display.savingsAmountFormatted)
    }

    @Test
    fun savingsHiddenWhenZeroOrNegative() {
        assertFalse(project(sampleJson(savings = 0.0)).showSavings)
        assertFalse(project(sampleJson(savings = -5.0)).showSavings)
    }

    @Test
    fun headerAndFooterAndScreenshotResolve() {
        val display = project(sampleJson())
        assertEquals("2024", display.year)
        assertEquals("Year in Review", display.title)
        assertEquals("Bluebird", display.vehicleName)
        assertEquals("Model 3", display.vehicleModel)
        assertEquals("TeslaSync \u2022 Year in Review", display.brandFooter)
        assertEquals("\uD83D\uDCF8 Screenshot to share your year!", display.screenshotPrompt)
    }

    @Test
    fun nullDataProjectsEmptySurfaceWithFallbackYear() {
        val display = project(null)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertFalse(display.showSavings)
        assertEquals("2024", display.year)
        assertEquals("No driving data for 2024", display.emptyMessage)
        assertEquals("Start driving and charging to build your annual review!", display.emptyHint)
        // The footer + screenshot prompt are still resolved so the surface is never a blank box.
        assertEquals("TeslaSync \u2022 Year in Review", display.brandFooter)
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(SummarySlideDisplayPrefs.METRIC_DEFAULT, SummarySlideDisplayPrefs.fromSettings(null))

        val imperial = SummarySlideDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(SummarySlideDisplayPrefs(DistanceUnitPref.MI), imperial)

        val metric = SummarySlideDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "km") })
        assertEquals(SummarySlideDisplayPrefs(DistanceUnitPref.KM), metric)
    }

    @Test
    fun registrationExposesSurfaceSlug() {
        assertEquals("SummarySlide", SummarySlideRegistration.SLUG)
    }

    /** Asserts a stat's icon / label / formatted value (the fields parity depends on). */
    private fun assertStat(
        stat: SummarySlideStat,
        icon: SummarySlideStatIcon,
        label: String,
        formattedValue: String,
    ) {
        assertEquals(icon, stat.icon)
        assertEquals(label, stat.label)
        assertEquals(formattedValue, stat.formattedValue)
    }
}
