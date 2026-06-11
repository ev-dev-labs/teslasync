package io.teslasync.android.dashboard.widgets.tirepressurehistory

import io.teslasync.shared.core.units.PressureUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TirePressureHistoryWidget's pure logic — the chart/stat projection
 * (per-corner `latestNonNull`, the FL/FR/RL/RR stat row, the compact vs standard selection, the
 * `refLow`/`refHigh` recommended-range references), the `GET /tire-pressure` parsing (timestamp gating +
 * `ts`/`created_at`/`timestamp` fallback, nullable corner gaps, chronological sort), the display-unit
 * conversion (the verbatim web `toPressureValue` path), the empty gate, and the registry metadata.
 * Mirrors the web spec (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx).
 */
class TirePressureHistoryProjectionTest {
    private val strings =
        TirePressureHistoryStrings(
            title = "Tire Pressure History",
            fl = "FL",
            fr = "FR",
            rl = "RL",
            rr = "RR",
            min = "Min",
            max = "Max",
            noData = "No tire pressure history",
        )

    private fun project(
        snapshot: TirePressureHistorySnapshot,
        size: TirePressureHistorySize = TirePressureHistoryRegistration.defaultSize,
        unit: PressureUnitPref = PressureUnitPref.BAR,
    ): TirePressureHistoryDisplay = TirePressureHistoryProjection.project(snapshot, size, unit, strings, formatTime = { it })

    private fun point(
        time: String,
        fl: Double? = null,
        fr: Double? = null,
        rl: Double? = null,
        rr: Double? = null,
    ): TirePressurePoint = TirePressurePoint(time, fl, fr, rl, rr)

    private fun row(
        ts: String?,
        fl: Double? = null,
        fr: Double? = null,
        rl: Double? = null,
        rr: Double? = null,
    ): TireRow = TireRow(ts = ts, frontLeft = fl, frontRight = fr, rearLeft = rl, rearRight = rr)

    private fun statValue(
        display: TirePressureHistoryDisplay,
        label: String,
    ): TirePressureHistoryStat = display.stats.single { it.label == label }

    // Realistic SI Pascal corner readings (≈ 2.3–2.6 bar) — fed verbatim into the web `toPressureValue` path.
    private val twoRows =
        TirePressureHistorySnapshot.of(
            listOf(
                point("2024-06-11T08:00:00Z", 230000.0, 240000.0, 250000.0, 260000.0),
                point("2024-06-11T09:00:00Z", 240000.0, 250000.0, 260000.0, 270000.0),
            ),
        )

    // ---- stats (web FL/FR/RL/RR latestNonNull → fmtNumber(.,1) + pressureUnit) ----------

    @Test
    fun standardSizeShowsFourCornerStatsInPressureUnit() {
        val display = project(twoRows)
        assertEquals(4, display.stats.size)
        assertEquals(listOf("FL", "FR", "RL", "RR"), display.stats.map { it.label })
        // Latest (second) row, converted bar (web feeds Pa into the kPa-contract converter → ÷100).
        assertEquals("2,400.0", statValue(display, "FL").value)
        assertEquals("2,500.0", statValue(display, "FR").value)
        assertEquals("2,600.0", statValue(display, "RL").value)
        assertEquals("2,700.0", statValue(display, "RR").value)
        display.stats.forEach { assertEquals("bar", it.unit) }
    }

    @Test
    fun compactSizeStillShowsFourCornerStats() {
        // Web compact branch hides only the chart (`chart={null}`); the stat summary stays.
        val display = project(twoRows, TirePressureHistorySize(cols = 1, rows = 4))
        assertTrue(display.isCompact)
        assertEquals(4, display.stats.size)
    }

    @Test
    fun noDataYieldsEmptyStats() {
        val display = project(TirePressureHistorySnapshot.EMPTY)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No tire pressure history", display.noDataMessage)
    }

    @Test
    fun latestStatUsesMostRecentNonNullCorner() {
        // The newest row has a null FL, so the FL stat carries the previous row's value (web latestNonNull).
        val snapshot =
            TirePressureHistorySnapshot.of(
                listOf(
                    point("2024-06-11T08:00:00Z", fl = 240000.0),
                    point("2024-06-11T09:00:00Z"),
                ),
            )
        assertEquals("2,400.0", statValue(project(snapshot), "FL").value)
        // A corner that was never read renders the em-dash (web `formatPressure(null) === '—'`).
        assertEquals("\u2014", statValue(project(snapshot), "FR").value)
    }

    // ---- toPressureValue (verbatim web usePressureFormat path) -------------------------

    @Test
    fun toPressureValueConvertsPerUnitAndGuardsNull() {
        // 100 → bar ÷100; 6894.757 → psi ÷6.894757; kPa identity (the shared SI converter contract).
        assertEquals(1.0, TirePressureHistoryProjection.toPressureValue(100.0, PressureUnitPref.BAR)!!, 1e-9)
        assertEquals(1000.0, TirePressureHistoryProjection.toPressureValue(6894.757, PressureUnitPref.PSI)!!, 1e-6)
        assertEquals(240000.0, TirePressureHistoryProjection.toPressureValue(240000.0, PressureUnitPref.KPA)!!, 0.0)
        assertNull(TirePressureHistoryProjection.toPressureValue(null, PressureUnitPref.BAR))
        assertNull(TirePressureHistoryProjection.toPressureValue(Double.NaN, PressureUnitPref.BAR))
        assertNull(TirePressureHistoryProjection.toPressureValue(Double.POSITIVE_INFINITY, PressureUnitPref.BAR))
    }

    @Test
    fun recommendedRangeUsesWebBarTimes100kPath() {
        // refLow = toPressureValue(2.4 * 100_000) ; refHigh = toPressureValue(2.8 * 100_000) (web source).
        val bar = project(twoRows, unit = PressureUnitPref.BAR)
        assertEquals(2400.0, bar.recommendedLow, 1e-9)
        assertEquals(2800.0, bar.recommendedHigh, 1e-9)
        assertEquals("bar", bar.unit)

        val kpa = project(twoRows, unit = PressureUnitPref.KPA)
        assertEquals(240000.0, kpa.recommendedLow, 0.0)
        assertEquals(280000.0, kpa.recommendedHigh, 0.0)
    }

    @Test
    fun minMaxLabelsAreCarried() {
        val display = project(twoRows)
        assertEquals("Min", display.minLabel)
        assertEquals("Max", display.maxLabel)
    }

    // ---- latestNonNull --------------------------------------------------------------

    @Test
    fun latestNonNullScansFromNewest() {
        val points =
            listOf(
                TirePressureDisplayPoint("08:00", frontLeft = 2.3, frontRight = null, rearLeft = null, rearRight = null),
                TirePressureDisplayPoint("09:00", frontLeft = null, frontRight = null, rearLeft = null, rearRight = null),
            )
        assertEquals(2.3, TirePressureHistoryProjection.latestNonNull(points) { it.frontLeft })
        assertNull(TirePressureHistoryProjection.latestNonNull(points) { it.frontRight })
        assertNull(TirePressureHistoryProjection.latestNonNull(emptyList()) { it.frontLeft })
    }

    // ---- parsing (web buildChartData) -----------------------------------------------

    @Test
    fun parseReadsCornersAndSortsChronologically() {
        val points =
            parseTirePressurePoints(
                tireHistoryJson(
                    listOf(
                        row("2024-06-11T09:00:00Z", 240000.0, 250000.0, 260000.0, 270000.0),
                        row("2024-06-11T08:00:00Z", 230000.0),
                    ),
                ),
            )
        assertEquals(2, points.size)
        // Sorted oldest → newest (web `.sort(a.time.localeCompare(b.time))`).
        assertEquals("2024-06-11T08:00:00Z", points.first().timeIso)
        assertEquals(240000.0, points.last().frontLeftPa)
        assertEquals(270000.0, points.last().rearRightPa)
    }

    @Test
    fun parseDropsRowsWithoutTimestamp() {
        // Web `.filter(d => d.timestamp)` — a row with no timestamp field is excluded.
        val points =
            parseTirePressurePoints(
                tireHistoryJson(
                    listOf(
                        row(null, 240000.0),
                        row("2024-06-11T08:00:00Z", 230000.0),
                    ),
                ),
            )
        assertEquals(1, points.size)
        assertEquals("2024-06-11T08:00:00Z", points.single().timeIso)
    }

    @Test
    fun parseAcceptsCreatedAtAndTimestampFallbacks() {
        // The live handler emits `ts` + `created_at`; the web type names it `timestamp`. All three resolve.
        val createdAtRow = TireRow(ts = "2024-06-11T08:00:00Z", frontLeft = 230000.0, timestampKey = "created_at")
        val createdAt = parseTirePressurePoints(tireHistoryJson(listOf(createdAtRow)))
        assertEquals("2024-06-11T08:00:00Z", createdAt.single().timeIso)
        val timestampRow = TireRow(ts = "2024-06-11T08:00:00Z", frontLeft = 230000.0, timestampKey = "timestamp")
        val timestamp = parseTirePressurePoints(tireHistoryJson(listOf(timestampRow)))
        assertEquals("2024-06-11T08:00:00Z", timestamp.single().timeIso)
    }

    @Test
    fun parseLeavesMissingCornersNull() {
        val decoded =
            parseTirePressurePoints(tireHistoryJson(listOf(row("2024-06-11T08:00:00Z", 230000.0)))).single()
        assertEquals(230000.0, decoded.frontLeftPa)
        assertNull(decoded.frontRightPa)
        assertNull(decoded.rearLeftPa)
        assertNull(decoded.rearRightPa)
    }

    @Test
    fun parseNonArrayYieldsEmpty() {
        assertTrue(parseTirePressurePoints(emptyObjectJson()).isEmpty())
        assertTrue(parseTirePressurePoints(null).isEmpty())
        assertTrue(parseTirePressurePoints(emptyTireHistoryJson()).isEmpty())
    }

    @Test
    fun hasDataMatchesTimestampBearingRows() {
        assertFalse(TirePressureHistorySnapshot.EMPTY.hasData)
        // A timestamp-bearing row with no readings is still "data" (web hasData = chartData.length > 0).
        val sparse = parseTirePressurePoints(tireHistoryJson(listOf(TireRow(ts = "2024-06-11T08:00:00Z"))))
        assertTrue(TirePressureHistorySnapshot.of(sparse).hasData)
    }

    // ---- footprint flags (web size.cols <= 1 / >= 3) --------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(TirePressureHistorySize(cols = 1, rows = 4).isCompact)
        assertFalse(TirePressureHistorySize(cols = 2, rows = 4).isCompact)
        assertFalse(TirePressureHistorySize(cols = 2, rows = 4).isWide)
        assertTrue(TirePressureHistorySize(cols = 3, rows = 4).isWide)
    }

    // ---- registry metadata (web registry/tires.ts) ----------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("tire-pressure-history", TirePressureHistoryRegistration.ID)
        assertEquals("tires", TirePressureHistoryRegistration.CATEGORY)
        assertEquals("TirePressureHistoryWidget", TirePressureHistoryRegistration.SLUG)
        assertEquals(TirePressureHistorySize(cols = 2, rows = 4), TirePressureHistoryRegistration.defaultSize)
        assertEquals(TirePressureHistorySize(cols = 2, rows = 4), TirePressureHistoryRegistration.minSize)
        assertEquals(TirePressureHistorySize(cols = 4, rows = 40), TirePressureHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(TirePressureHistoryRegistration.isWithinBounds(TirePressureHistorySize(cols = 2, rows = 4)))
        assertFalse(TirePressureHistoryRegistration.isWithinBounds(TirePressureHistorySize(cols = 1, rows = 4)))
        assertFalse(TirePressureHistoryRegistration.isWithinBounds(TirePressureHistorySize(cols = 5, rows = 50)))
        assertEquals(
            TirePressureHistorySize(cols = 2, rows = 4),
            TirePressureHistoryRegistration.clamp(TirePressureHistorySize(cols = 1, rows = 1)),
        )
        assertEquals(
            TirePressureHistorySize(cols = 4, rows = 40),
            TirePressureHistoryRegistration.clamp(TirePressureHistorySize(cols = 9, rows = 99)),
        )
    }
}
