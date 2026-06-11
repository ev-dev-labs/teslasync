package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Vehicle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import kotlin.time.Instant

/**
 * Off-device verification of the ChargingSessionDetailWidget's pure logic — the charger classifier, the
 * SI energy/duration/peak-power derivations, the SoC-overlay reconstruction, the chart geometry, the
 * vehicle/session resolution, the registry metadata, and the full projection (compact hero + summary
 * stats + charge curve + empty gate). Mirrors the web spec
 * (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx) and the WinUI parity tests.
 */
class ChargingSessionDetailProjectionTest {
    private val utc = ZoneId.of("UTC")

    private fun strings(): ChargingSessionDetailStrings =
        ChargingSessionDetailStrings(
            energy = "Energy Added",
            duration = "Duration",
            peakPower = "Peak Power",
            charger = "Charger",
            powerSeries = "Power (kW)",
            socSeries = "SoC %",
            unitKwh = "kWh added",
            chargerAcHome = "AC / Home",
            chargerSupercharger = "Supercharger",
            chargerDcFast = "DC Fast",
        )

    private fun session(
        startedAt: String = "2024-01-01T10:00:00Z",
        endedAt: String? = "2024-01-01T10:45:00Z",
        chargerType: String? = "Supercharger",
        startSoc: Double? = 20.0,
        endSoc: Double? = 80.0,
    ): ChargingSession =
        ChargingSession(
            id = 1,
            startedAt = Instant.parse(startedAt),
            vehicleId = 7,
            chargerType = chargerType,
            endedAt = endedAt?.let { Instant.parse(it) },
            totalEnergyAddedWh = 32_500.0,
            startSocPct = startSoc,
            endSocPct = endSoc,
        )

    private fun reading(
        ts: String,
        dcW: Double? = null,
        acW: Double? = null,
    ): ChargeTelemetryReading =
        ChargeTelemetryReading(ts = Instant.parse(ts), vehicleId = 7, dcChargingPowerW = dcW, acChargingPowerW = acW)

    private fun telemetry(): List<ChargeTelemetryReading> =
        listOf(
            reading("2024-01-01T10:00:00Z", dcW = 110_000.0),
            reading("2024-01-01T10:15:00Z", dcW = 120_000.0),
            reading("2024-01-01T10:30:00Z", dcW = 70_000.0),
            reading("2024-01-01T10:45:00Z", dcW = 20_000.0),
        )

    private fun project(
        snapshot: ChargingSessionDetailSnapshot,
        size: ChargingSessionDetailSize = ChargingSessionDetailRegistration.defaultSize,
    ): ChargingSessionDetailDisplay = ChargingSessionDetailProjection.project(snapshot, size, strings(), utc)

    // ---- registry metadata (web registry/charging.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("charging-session-detail", ChargingSessionDetailRegistration.ID)
        assertEquals("charging", ChargingSessionDetailRegistration.CATEGORY)
        assertEquals("ChargingSessionDetailWidget", ChargingSessionDetailRegistration.SLUG)
        assertEquals(ChargingSessionDetailSize(cols = 2, rows = 4), ChargingSessionDetailRegistration.defaultSize)
        assertEquals(ChargingSessionDetailSize(cols = 1, rows = 2), ChargingSessionDetailRegistration.minSize)
        assertEquals(ChargingSessionDetailSize(cols = 4, rows = 40), ChargingSessionDetailRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(ChargingSessionDetailRegistration.isWithinBounds(ChargingSessionDetailSize(2, 4)))
        assertFalse(ChargingSessionDetailRegistration.isWithinBounds(ChargingSessionDetailSize(0, 1)))
        assertFalse(ChargingSessionDetailRegistration.isWithinBounds(ChargingSessionDetailSize(5, 50)))
        assertEquals(ChargingSessionDetailSize(1, 2), ChargingSessionDetailRegistration.clamp(ChargingSessionDetailSize(0, 0)))
        assertEquals(ChargingSessionDetailSize(4, 40), ChargingSessionDetailRegistration.clamp(ChargingSessionDetailSize(9, 99)))
    }

    @Test
    fun sizeBranchesMatchWeb() {
        assertTrue(ChargingSessionDetailSize(1, 4).isCompact)
        assertFalse(ChargingSessionDetailSize(2, 4).isCompact)
        assertTrue(ChargingSessionDetailSize(3, 4).isWide)
        assertFalse(ChargingSessionDetailSize(2, 4).isWide)
    }

    // ---- vehicle + session resolution (web vehicleId ?? vehicles[0].id, latestSessionId) -----

    @Test
    fun firstVehicleIdReadsTheFirstEntry() {
        assertNull(ChargingSessionDetailProjection.firstVehicleId(null))
        assertNull(ChargingSessionDetailProjection.firstVehicleId(emptyList()))
        assertEquals(42L, ChargingSessionDetailProjection.firstVehicleId(listOf(vehicle(42), vehicle(7))))
    }

    @Test
    fun latestSessionIdPicksNewestByStartedAt() {
        assertNull(ChargingSessionDetailProjection.latestSessionId(null))
        assertNull(ChargingSessionDetailProjection.latestSessionId(emptyList()))
        val older = ChargingSession(id = 1, startedAt = Instant.parse("2024-01-01T08:00:00Z"), vehicleId = 7)
        val newer = ChargingSession(id = 2, startedAt = Instant.parse("2024-01-01T12:00:00Z"), vehicleId = 7)
        assertEquals(2L, ChargingSessionDetailProjection.latestSessionId(listOf(older, newer)))
        assertEquals(2L, ChargingSessionDetailProjection.latestSessionId(listOf(newer, older)))
    }

    // ---- charger classifier (web classifyCharger) -----------------------------------

    @Test
    fun classifyMatchesWeb() {
        assertEquals(ChargerKind.AcHome, ChargingSessionDetailProjection.classify(null))
        assertEquals(ChargerKind.AcHome, ChargingSessionDetailProjection.classify(""))
        assertEquals(ChargerKind.AcHome, ChargingSessionDetailProjection.classify("<invalid>"))
        assertEquals(ChargerKind.Supercharger, ChargingSessionDetailProjection.classify("Tesla Supercharger"))
        assertEquals(ChargerKind.Supercharger, ChargingSessionDetailProjection.classify("tesla"))
        assertEquals(ChargerKind.DcFast, ChargingSessionDetailProjection.classify("CCS"))
        assertEquals(ChargerKind.DcFast, ChargingSessionDetailProjection.classify("CHAdeMO"))
    }

    // ---- SI power / peak (web power_kw / peakPower reduce) ---------------------------

    @Test
    fun powerKwUsesActiveLegInKilowatts() {
        assertEquals(120.0, ChargingSessionDetailProjection.powerKwOf(reading("2024-01-01T10:00:00Z", dcW = 120_000.0))!!, 1e-9)
        assertEquals(7.4, ChargingSessionDetailProjection.powerKwOf(reading("2024-01-01T10:00:00Z", acW = 7_400.0))!!, 1e-9)
        // The active leg wins (the inactive one is ~0).
        assertEquals(
            150.0,
            ChargingSessionDetailProjection.powerKwOf(reading("2024-01-01T10:00:00Z", dcW = 150_000.0, acW = 0.0))!!,
            1e-9,
        )
        assertNull(ChargingSessionDetailProjection.powerKwOf(reading("2024-01-01T10:00:00Z")))
    }

    @Test
    fun peakPowerKwIsMaxAcrossReadingsAndZeroWhenEmpty() {
        assertEquals(120.0, ChargingSessionDetailProjection.peakPowerKw(telemetry()), 1e-9)
        assertEquals(0.0, ChargingSessionDetailProjection.peakPowerKw(emptyList()), 1e-9)
    }

    // ---- duration (web durationStr; SI ended_at − started_at) ------------------------

    @Test
    fun durationTextMatchesWeb() {
        assertEquals("45m", ChargingSessionDetailProjection.durationText(session(endedAt = "2024-01-01T10:45:00Z")))
        assertEquals("1h", ChargingSessionDetailProjection.durationText(session(endedAt = "2024-01-01T11:00:00Z")))
        assertEquals("1h 30m", ChargingSessionDetailProjection.durationText(session(endedAt = "2024-01-01T11:30:00Z")))
        assertEquals("2h 5m", ChargingSessionDetailProjection.durationText(session(endedAt = "2024-01-01T12:05:00Z")))
        // Live session (no ended_at) → 0m, matching web `duration_min ?? 0`.
        assertEquals("0m", ChargingSessionDetailProjection.durationText(session(endedAt = null)))
        assertNull(ChargingSessionDetailProjection.durationMinutes(session(endedAt = null)))
    }

    // ---- SoC overlay reconstruction (start_soc_pct → end_soc_pct interpolation) ------

    @Test
    fun socInterpolatesAcrossTheTelemetryTimeline() {
        val detail = session()
        assertEquals(20.0, socOf(detail, "2024-01-01T10:00:00Z"), 1e-9)
        assertEquals(40.0, socOf(detail, "2024-01-01T10:15:00Z"), 1e-9)
        assertEquals(80.0, socOf(detail, "2024-01-01T10:45:00Z"), 1e-9)
        // Clamped before/after the window.
        assertEquals(20.0, socOf(detail, "2024-01-01T09:00:00Z"), 1e-9)
        assertEquals(80.0, socOf(detail, "2024-01-01T12:00:00Z"), 1e-9)
    }

    @Test
    fun socIsNullWhenBoundsMissing() {
        val ts = Instant.parse("2024-01-01T10:15:00Z").toEpochMilliseconds()
        assertNull(ChargingSessionDetailProjection.socAt(ts, session(endedAt = null)))
        assertNull(ChargingSessionDetailProjection.socAt(ts, session(startSoc = null)))
        assertNull(ChargingSessionDetailProjection.socAt(ts, session(endSoc = null)))
    }

    private fun socOf(
        detail: ChargingSession,
        ts: String,
    ): Double = ChargingSessionDetailProjection.socAt(Instant.parse(ts).toEpochMilliseconds(), detail)!!

    // ---- number formatter (web fmtNumber/safeNumber) --------------------------------

    @Test
    fun formatNumberMatchesWeb() {
        assertEquals("32.5", ChargingSessionDetailProjection.formatNumber(32.5, 1))
        assertEquals("1,200.0", ChargingSessionDetailProjection.formatNumber(1_200.0, 1))
        assertEquals("0.0", ChargingSessionDetailProjection.formatNumber(Double.NaN, 1))
        assertEquals("120", ChargingSessionDetailProjection.formatNumber(120.0, 0))
    }

    // ---- full projection (web chartData/stats/durationStr/charger useMemo) -----------

    @Test
    fun projectBuildsSummaryStatsAndCompactFields() {
        val display = project(ChargingSessionDetailSnapshot(session(), telemetry()))
        assertTrue(display.hasData)
        assertEquals("32.5", display.compactEnergyText)
        assertEquals("kWh added", display.compactUnitLabel)
        assertEquals(ChargerKind.Supercharger, display.charger)
        assertEquals("Supercharger", display.chargerLabel)

        assertEquals(4, display.stats.size)
        assertEquals(ChargingSessionDetailStat("Energy Added", "32.5", "kWh"), display.stats[0])
        assertEquals(ChargingSessionDetailStat("Duration", "45m"), display.stats[1])
        assertEquals(ChargingSessionDetailStat("Peak Power", "120.0", "kW"), display.stats[2])
        assertEquals(ChargingSessionDetailStat("Charger", "Supercharger"), display.stats[3])
        assertEquals("32.5 kWh added, Supercharger", display.compactContentDescription)
    }

    @Test
    fun projectBuildsChargeCurveWithPowerAndScaledSoc() {
        val chart = project(ChargingSessionDetailSnapshot(session(), telemetry())).chart
        assertTrue(chart.hasPoints)
        assertEquals(4, chart.points.size)
        assertEquals(listOf("10:00", "10:15", "10:30", "10:45"), chart.points.map { it.timeLabel })
        assertEquals(listOf(110.0, 120.0, 70.0, 20.0), chart.points.map { it.powerKw })
        assertEquals(listOf(20.0, 40.0, 60.0, 80.0), chart.points.map { it.socPct })
        // dataMax + 5 headroom (web YAxis domain [0, 'dataMax + 5']).
        assertEquals(125.0, chart.powerAxisMaxKw, 1e-9)
        // SoC scaled onto the shared power-kW axis: soc/100 * axisMax.
        assertEquals(listOf(25.0, 50.0, 75.0, 100.0), chart.points.map { it.socPlotted })
    }

    @Test
    fun socSeriesIsNullWhenSessionHasNoSocBounds() {
        val chart = project(ChargingSessionDetailSnapshot(session(startSoc = null, endSoc = null), telemetry())).chart
        assertTrue(chart.points.all { it.socPct == null && it.socPlotted == null })
        // The power curve still renders.
        assertEquals(listOf(110.0, 120.0, 70.0, 20.0), chart.points.map { it.powerKw })
    }

    @Test
    fun acHomeFallbackWhenChargerTypeAbsent() {
        val display = project(ChargingSessionDetailSnapshot(session(chargerType = null), telemetry()))
        assertEquals(ChargerKind.AcHome, display.charger)
        assertEquals("AC / Home", display.chargerLabel)
    }

    @Test
    fun nullDetailHitsTheEmptyGate() {
        val display = project(ChargingSessionDetailSnapshot(detail = null))
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertFalse(display.chart.hasPoints)
        assertEquals("kWh added", display.compactUnitLabel)
    }

    @Test
    fun detailWithoutTelemetryShowsStatsButNoCurve() {
        val display = project(ChargingSessionDetailSnapshot(session(), telemetry = emptyList()))
        assertTrue(display.hasData)
        assertEquals(4, display.stats.size)
        assertEquals("0.0", display.stats[2].value) // peak power 0 with no telemetry
        assertFalse(display.chart.hasPoints)
    }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2024-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2024-01-01T00:00:00Z"),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.parse("2024-01-01T00:00:00Z"),
            vin = "VIN$id",
        )
}
