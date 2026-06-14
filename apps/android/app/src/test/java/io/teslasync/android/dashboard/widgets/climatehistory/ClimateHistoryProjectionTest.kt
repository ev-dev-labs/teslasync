package io.teslasync.android.dashboard.widgets.climatehistory

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the ClimateHistoryWidget's pure logic — the history decode (timestamp
 * `created_at ?? timestamp` resolution + filter, SI `inside_temp`/`outside_temp` null-tolerant reads,
 * chronological sort), the localized time labeller, the SI→display temperature projection (Celsius +
 * Fahrenheit, the latest non-null scan, the compact stat selection, the hasData/empty gate), and the
 * registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx).
 */
class ClimateHistoryProjectionTest {
    private val strings =
        ClimateHistoryStrings(
            title = "Climate History",
            cabin = "Cabin",
            outside = "Outside",
            noData = "No climate history",
        )

    private val utc = ZoneId.of("UTC")

    private fun formatter(fahrenheit: Boolean = false): UnitFormatter =
        UnitFormatter(
            UnitPreferences.fromSettings(
                buildJsonObject {
                    if (fahrenheit) put("unit_of_temp", "F")
                    put("locale", "en-US")
                },
            ),
        )

    private fun project(
        snapshot: ClimateHistorySnapshot,
        size: ClimateHistorySize = ClimateHistoryRegistration.defaultSize,
        fahrenheit: Boolean = false,
    ): ClimateHistoryDisplay = ClimateHistoryProjection.project(snapshot, size, strings, formatter(fahrenheit), utc)

    private fun statValue(
        display: ClimateHistoryDisplay,
        label: String,
    ): ClimateHistoryStat = display.stats.single { it.label == label }

    private val threeRows =
        listOf(
            ClimateRow(createdAt = "2024-06-11T08:00:00Z", insideTemp = 21.0, outsideTemp = 14.0),
            ClimateRow(createdAt = "2024-06-11T09:00:00Z", insideTemp = 22.0, outsideTemp = 16.0),
            ClimateRow(createdAt = "2024-06-11T10:00:00Z", insideTemp = 23.0, outsideTemp = 18.0),
        )

    private fun snapshot(rows: List<ClimateRow>): ClimateHistorySnapshot =
        ClimateHistorySnapshot.ofSamples(parseClimateSamples(climateHistoryJson(rows)))

    // ---- parsing --------------------------------------------------------------------

    @Test
    fun parseReadsTimestampAndTemperatures() {
        val samples = parseClimateSamples(climateHistoryJson(threeRows))
        assertEquals(3, samples.size)
        val first = samples.first()
        assertEquals("2024-06-11T08:00:00Z", first.timeIso)
        assertEquals(21.0, first.insideC!!, 0.0)
        assertEquals(14.0, first.outsideC!!, 0.0)
    }

    @Test
    fun parsePrefersCreatedAtThenFallsBackToTimestamp() {
        val rows =
            listOf(
                ClimateRow(createdAt = "2024-06-11T08:00:00Z", timestamp = "ignored", insideTemp = 20.0),
                ClimateRow(timestamp = "2024-06-11T09:00:00Z", insideTemp = 21.0),
            )
        val samples = parseClimateSamples(climateHistoryJson(rows))
        assertEquals("2024-06-11T08:00:00Z", samples[0].timeIso)
        assertEquals("2024-06-11T09:00:00Z", samples[1].timeIso)
    }

    @Test
    fun parseDropsRowsWithoutTimestamp() {
        val rows =
            listOf(
                ClimateRow(insideTemp = 20.0),
                ClimateRow(createdAt = "2024-06-11T09:00:00Z", insideTemp = 21.0),
            )
        val samples = parseClimateSamples(climateHistoryJson(rows))
        assertEquals(1, samples.size)
        assertEquals("2024-06-11T09:00:00Z", samples.first().timeIso)
    }

    @Test
    fun parseSortsChronologically() {
        val rows =
            listOf(
                ClimateRow(createdAt = "2024-06-11T10:00:00Z", insideTemp = 23.0),
                ClimateRow(createdAt = "2024-06-11T08:00:00Z", insideTemp = 21.0),
                ClimateRow(createdAt = "2024-06-11T09:00:00Z", insideTemp = 22.0),
            )
        val samples = parseClimateSamples(climateHistoryJson(rows))
        assertEquals(
            listOf("2024-06-11T08:00:00Z", "2024-06-11T09:00:00Z", "2024-06-11T10:00:00Z"),
            samples.map { it.timeIso },
        )
    }

    @Test
    fun parseMissingTemperaturesAreNull() {
        val samples = parseClimateSamples(climateHistoryJson(listOf(ClimateRow(createdAt = "2024-06-11T08:00:00Z"))))
        assertNull(samples.first().insideC)
        assertNull(samples.first().outsideC)
    }

    @Test
    fun parseNonArrayYieldsEmpty() {
        assertTrue(parseClimateSamples(emptyObjectJson()).isEmpty())
        assertTrue(parseClimateSamples(null).isEmpty())
        assertTrue(parseClimateSamples(emptyClimateHistoryJson()).isEmpty())
    }

    // ---- time labeller --------------------------------------------------------------

    @Test
    fun timeLabelFormatsInZone() {
        assertEquals("Jun 11, 2024, 08:00 AM", climateTimeLabel("2024-06-11T08:00:00Z", Locale.US, utc))
        // The same instant renders in the supplied zone (PDT = UTC-7).
        assertEquals(
            "Jun 11, 2024, 01:00 AM",
            climateTimeLabel("2024-06-11T08:00:00Z", Locale.US, ZoneId.of("America/Los_Angeles")),
        )
    }

    @Test
    fun timeLabelInvalidOrBlankYieldsEmDash() {
        assertEquals(EM_DASH, climateTimeLabel("not-a-date", Locale.US, utc))
        assertEquals(EM_DASH, climateTimeLabel("", Locale.US, utc))
    }

    // ---- projection: stats ----------------------------------------------------------

    @Test
    fun standardSizeShowsCabinAndOutsideLatestCelsius() {
        val display = project(snapshot(threeRows))
        assertTrue(display.hasData)
        assertEquals(2, display.stats.size)

        val cabin = statValue(display, "Cabin")
        assertEquals("23", cabin.value)
        assertEquals("\u00B0C", cabin.unit)

        assertEquals("18", statValue(display, "Outside").value)
        assertEquals("\u00B0C", statValue(display, "Outside").unit)
    }

    @Test
    fun fahrenheitConvertsLatestAndUnit() {
        val display = project(snapshot(threeRows), fahrenheit = true)
        // 23°C → 73.4°F → fmtInt 73 ; 18°C → 64.4°F → 64.
        assertEquals("73", statValue(display, "Cabin").value)
        assertEquals("64", statValue(display, "Outside").value)
        assertEquals("\u00B0F", statValue(display, "Cabin").unit)
        assertEquals("\u00B0F", display.tempUnit)
    }

    @Test
    fun latestUsesLastNonNullReading() {
        val rows =
            listOf(
                ClimateRow(createdAt = "2024-06-11T08:00:00Z", insideTemp = 21.0, outsideTemp = 14.0),
                ClimateRow(createdAt = "2024-06-11T09:00:00Z", outsideTemp = 16.0),
            )
        val display = project(snapshot(rows))
        // Cabin's last row is null, so the latest non-null (21°C) wins (web reverse scan).
        assertEquals("21", statValue(display, "Cabin").value)
        assertEquals("16", statValue(display, "Outside").value)
    }

    @Test
    fun allNullReadingsYieldEmDashStat() {
        val rows = listOf(ClimateRow(createdAt = "2024-06-11T08:00:00Z"))
        val display = project(snapshot(rows))
        // hasData is true (a row resolved) but no temperature was present → em dash value.
        assertTrue(display.hasData)
        assertEquals(EM_DASH, statValue(display, "Cabin").value)
        assertEquals(EM_DASH, statValue(display, "Outside").value)
    }

    @Test
    fun compactSizeStillProjectsStats() {
        val display = project(snapshot(threeRows), size = ClimateHistorySize(cols = 1, rows = 4))
        assertTrue(display.isCompact)
        assertEquals(2, display.stats.size)
    }

    @Test
    fun emptySnapshotHasNoStatsAndNoData() {
        val display = project(ClimateHistorySnapshot.EMPTY)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No climate history", display.noDataMessage)
    }

    // ---- projection: chart series ---------------------------------------------------

    @Test
    fun chartSeriesCarryConvertedValuesAndLabels() {
        val display = project(snapshot(threeRows))
        assertEquals(listOf(21.0, 22.0, 23.0), display.insideValues)
        assertEquals(listOf(14.0, 16.0, 18.0), display.outsideValues)
        assertEquals("Jun 11, 2024, 08:00 AM", display.xLabels.first())
        assertEquals(3, display.xLabels.size)
    }

    @Test
    fun chartSeriesPreserveNullGaps() {
        val rows =
            listOf(
                ClimateRow(createdAt = "2024-06-11T08:00:00Z", insideTemp = 21.0),
                ClimateRow(createdAt = "2024-06-11T09:00:00Z", outsideTemp = 16.0),
            )
        val display = project(snapshot(rows))
        assertEquals(listOf(21.0, null), display.insideValues)
        assertEquals(listOf(null, 16.0), display.outsideValues)
    }

    // ---- footprint flags (web size.cols <= 1 / >= 3) --------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(ClimateHistorySize(cols = 1, rows = 4).isCompact)
        assertFalse(ClimateHistorySize(cols = 2, rows = 4).isCompact)
        assertFalse(ClimateHistorySize(cols = 2, rows = 4).isWide)
        assertTrue(ClimateHistorySize(cols = 3, rows = 4).isWide)
    }

    @Test
    fun hasDataMatchesSampleCount() {
        assertFalse(ClimateHistorySnapshot.EMPTY.hasData)
        assertTrue(snapshot(threeRows).hasData)
    }

    // ---- registry metadata (web registry/climate.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("climate-history", ClimateHistoryRegistration.ID)
        assertEquals("climate", ClimateHistoryRegistration.CATEGORY)
        assertEquals("ClimateHistoryWidget", ClimateHistoryRegistration.SLUG)
        assertEquals(ClimateHistorySize(cols = 2, rows = 4), ClimateHistoryRegistration.defaultSize)
        assertEquals(ClimateHistorySize(cols = 2, rows = 4), ClimateHistoryRegistration.minSize)
        assertEquals(ClimateHistorySize(cols = 4, rows = 40), ClimateHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(ClimateHistoryRegistration.isWithinBounds(ClimateHistorySize(cols = 2, rows = 4)))
        assertFalse(ClimateHistoryRegistration.isWithinBounds(ClimateHistorySize(cols = 1, rows = 4)))
        assertFalse(ClimateHistoryRegistration.isWithinBounds(ClimateHistorySize(cols = 5, rows = 50)))
        assertEquals(
            ClimateHistorySize(cols = 2, rows = 4),
            ClimateHistoryRegistration.clamp(ClimateHistorySize(cols = 1, rows = 1)),
        )
        assertEquals(
            ClimateHistorySize(cols = 4, rows = 40),
            ClimateHistoryRegistration.clamp(ClimateHistorySize(cols = 9, rows = 99)),
        )
    }

    // ---- vehicle resolution (web vid = vehicleId ?? vehicles?.[0]?.id ?? 0) ----------

    @Test
    fun resolveVehicleIdPrefersPreferredThenFirst() {
        assertEquals(42L, resolveVehicleId(42L, null))
        assertNull(resolveVehicleId(0L, emptyList()))
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
    }
}
