package io.teslasync.android.dashboardwidgets.livesignalsparklines

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Pure, no-device tests for the LiveSignalSparklines projection — the verbatim ports of the web widget's
 * `DEFAULT_SIGNALS`, `configuredSignals` memo, `formatSignalName`, `extractNumericValue`, the per-row
 * `valueNum` / `hasSparkline` / `trend` derivation, plus the registry footprint constraints and the active
 * vehicle resolution. Covers every branch the device tests can't economically exercise.
 */
class LiveSignalSparklinesWidgetModelTest {
    // ── DEFAULT_SIGNALS ───────────────────────────────────────────────────────────
    @Test
    fun defaultSignalsMatchWebList() {
        assertEquals(
            listOf("BatteryLevel", "VehicleSpeed", "OutsideTemp", "InsideTemp", "Odometer", "PackCurrent"),
            DEFAULT_SIGNALS,
        )
    }

    // ── resolveConfiguredSignals ──────────────────────────────────────────────────
    @Test
    fun nullConfigAndNoCatalogFallsBackToDefaults() {
        assertEquals(DEFAULT_SIGNALS, resolveConfiguredSignals(configSignals = null, available = null))
    }

    @Test
    fun emptyCatalogReturnsRawCappedAtSix() {
        val raw = listOf("A", "B", "C", "D", "E", "F", "G")
        assertEquals(listOf("A", "B", "C", "D", "E", "F"), resolveConfiguredSignals(raw, emptyList()))
    }

    @Test
    fun configIntersectedWithCatalogKeepsOrderAndDropsUnavailable() {
        val configured = resolveConfiguredSignals(listOf("A", "X", "B"), listOf("B", "A", "C"))
        assertEquals(listOf("A", "B"), configured)
    }

    @Test
    fun noneMatchingFallsBackToFirstAvailable() {
        val configured = resolveConfiguredSignals(listOf("X", "Y"), listOf("P", "Q", "R"))
        assertEquals(listOf("P", "Q", "R"), configured)
    }

    @Test
    fun emptyConfigWithEmptyCatalogIsEmptyForEmptyState() {
        assertTrue(resolveConfiguredSignals(emptyList(), emptyList()).isEmpty())
    }

    @Test
    fun configuredIsCappedAtSixAfterFiltering() {
        val raw = (1..10).map { "S$it" }
        val avail = (1..10).map { "S$it" }
        assertEquals(6, resolveConfiguredSignals(raw, avail).size)
    }

    // ── formatSignalName ──────────────────────────────────────────────────────────
    @Test
    fun formatSignalNameSpacesPascalCase() {
        assertEquals("Battery Level", formatSignalName("BatteryLevel"))
        assertEquals("Pack Current", formatSignalName("PackCurrent"))
        assertEquals("Outside Temp", formatSignalName("OutsideTemp"))
    }

    @Test
    fun formatSignalNameSplitsAcronymBoundary() {
        assertEquals("SOC Limit", formatSignalName("SOCLimit"))
    }

    // ── extractNumericValue ───────────────────────────────────────────────────────
    @Test
    fun extractNumericValueReadsNumberStringAndRejectsRest() {
        assertEquals(72.5, extractNumericValue(SignalValue.Num(72.5)))
        assertEquals(12.5, extractNumericValue(SignalValue.Text("12.5")))
        assertNull(extractNumericValue(SignalValue.Text("abc")))
        assertNull(extractNumericValue(SignalValue.Bool(true)))
        assertNull(extractNumericValue(SignalValue.Null))
        assertNull(extractNumericValue(null))
        assertNull(extractNumericValue(SignalValue.Num(Double.NaN)))
    }

    // ── historyValueNum ───────────────────────────────────────────────────────────
    @Test
    fun historyValueNumOnlyAcceptsNumericKind() {
        assertEquals(40.0, historyValueNum(SignalValue.Num(40.0)))
        assertNull(historyValueNum(SignalValue.Text("40")))
        assertNull(historyValueNum(SignalValue.Num(Double.POSITIVE_INFINITY)))
    }

    // ── computeTrend ──────────────────────────────────────────────────────────────
    @Test
    fun trendFlatBelowFourPoints() {
        assertEquals(SignalTrend.Flat, computeTrend(listOf(1.0, 2.0, 3.0)))
    }

    @Test
    fun trendUpWhenLateAverageExceedsThreshold() {
        assertEquals(SignalTrend.Up, computeTrend(listOf(10.0, 10.0, 10.0, 10.0, 20.0, 20.0, 20.0, 20.0)))
    }

    @Test
    fun trendDownWhenLateAverageFallsBelowThreshold() {
        assertEquals(SignalTrend.Down, computeTrend(listOf(20.0, 20.0, 20.0, 20.0, 10.0, 10.0, 10.0, 10.0)))
    }

    @Test
    fun trendFlatWithinThresholdBand() {
        assertEquals(SignalTrend.Flat, computeTrend(listOf(100.0, 100.0, 100.0, 100.0)))
    }

    @Test
    fun trendUsesFloorWhenEarlyAverageIsZero() {
        // earlyAvg 0 ⇒ scaled threshold 0, floor 0.1 applies; delta 0.2 > 0.1 ⇒ Up.
        assertEquals(SignalTrend.Up, computeTrend(listOf(0.0, 0.0, 0.0, 0.2)))
        // delta 0.05 < floor 0.1 ⇒ Flat.
        assertEquals(SignalTrend.Flat, computeTrend(listOf(0.0, 0.0, 0.0, 0.05)))
    }

    // ── buildData ─────────────────────────────────────────────────────────────────
    @Test
    fun buildDataProjectsLiveValuePointsAndTrendPerRow() {
        val live =
            liveSignals(
                mapOf(
                    "BatteryLevel" to envelope(SignalValue.Num(72.0)),
                    "VehicleSpeed" to envelope(SignalValue.Text("13.5")),
                ),
            )
        val histories =
            mapOf<String, SignalHistoryResponse?>(
                "BatteryLevel" to history(listOf(70.0, 70.5, 71.0, 72.0)),
                "VehicleSpeed" to history(listOf(13.5)),
                "OutsideTemp" to null,
            )
        val data =
            LiveSignalSparklinesProjection.buildData(
                configured = listOf("BatteryLevel", "VehicleSpeed", "OutsideTemp"),
                live = live,
                histories = histories,
            )

        assertEquals(3, data.rows.size)
        val battery = data.rows[0]
        assertEquals("Battery Level", battery.displayName)
        assertEquals(72.0, battery.currentValue)
        assertEquals(listOf(70.0, 70.5, 71.0, 72.0), battery.points)
        assertTrue(battery.hasSparkline)

        val speed = data.rows[1]
        assertEquals(13.5, speed.currentValue)
        assertFalse(speed.hasSparkline) // single point < 2

        val temp = data.rows[2]
        assertNull(temp.currentValue) // no live entry
        assertTrue(temp.points.isEmpty())
        assertFalse(temp.hasSparkline)
    }

    @Test
    fun buildDataEmptyWhenNoConfiguredSignals() {
        val data = LiveSignalSparklinesProjection.buildData(emptyList(), null, emptyMap())
        assertTrue(data.isEmpty)
        assertFalse(data.hasAnySignalData)
    }

    @Test
    fun hasAnySignalDataTrueWhenAnyRowHasValueOrPoints() {
        val data =
            LiveSignalSparklinesProjection.buildData(
                configured = listOf("BatteryLevel"),
                live = liveSignals(mapOf("BatteryLevel" to envelope(SignalValue.Num(50.0)))),
                histories = emptyMap(),
            )
        assertTrue(data.hasAnySignalData)
    }

    // ── Size ──────────────────────────────────────────────────────────────────────
    @Test
    fun sizeIsWideAtThreeOrMoreColumns() {
        assertFalse(LiveSignalSparklinesSize(2, 4).isWide)
        assertTrue(LiveSignalSparklinesSize(3, 4).isWide)
    }

    @Test
    fun sizeUsesTwoColumnsOnlyWhenWideAndMoreThanThreeRows() {
        assertFalse(LiveSignalSparklinesSize(2, 4).useTwoColumns(6))
        assertFalse(LiveSignalSparklinesSize(3, 4).useTwoColumns(3))
        assertTrue(LiveSignalSparklinesSize(3, 4).useTwoColumns(4))
    }

    // ── Registration ──────────────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistryMetadata() {
        assertEquals("live-signal-sparklines", LiveSignalSparklinesRegistration.ID)
        assertEquals("telemetry", LiveSignalSparklinesRegistration.CATEGORY)
        assertEquals("LiveSignalSparklinesWidget", LiveSignalSparklinesRegistration.SLUG)
        assertEquals(LiveSignalSparklinesSize(2, 4), LiveSignalSparklinesRegistration.DEFAULT_SIZE)
        assertEquals(LiveSignalSparklinesSize(2, 4), LiveSignalSparklinesRegistration.MIN_SIZE)
        assertEquals(LiveSignalSparklinesSize(4, 40), LiveSignalSparklinesRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(LiveSignalSparklinesRegistration.isWithinBounds(LiveSignalSparklinesSize(3, 10)))
        assertFalse(LiveSignalSparklinesRegistration.isWithinBounds(LiveSignalSparklinesSize(1, 1)))
        assertEquals(
            LiveSignalSparklinesSize(2, 4),
            LiveSignalSparklinesRegistration.clamp(LiveSignalSparklinesSize(1, 1)),
        )
        assertEquals(
            LiveSignalSparklinesSize(4, 40),
            LiveSignalSparklinesRegistration.clamp(LiveSignalSparklinesSize(9, 99)),
        )
    }

    // ── vehicle resolution ────────────────────────────────────────────────────────
    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstEnrolled() {
        assertEquals(5L, resolveVehicleId(5L, listOf(vehicle(7))))
        assertEquals(7L, resolveVehicleId(null, listOf(vehicle(7), vehicle(8))))
        assertEquals(7L, resolveVehicleId(0L, listOf(vehicle(7))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    // ── helpers ───────────────────────────────────────────────────────────────────
    private fun envelope(value: SignalValue): SignalEnvelope = SignalEnvelope(kind = SignalKind.Float, value = value, ts = "")

    private fun liveSignals(signals: Map<String, SignalEnvelope>): LiveSignalsResponse =
        LiveSignalsResponse(vehicleId = 1L, count = signals.size, at = "", signals = signals)

    private fun history(values: List<Double>): SignalHistoryResponse =
        SignalHistoryResponse(
            vehicleId = 1L,
            signal = "x",
            expectedKind = "ValueKindFloat",
            from = "",
            to = "",
            count = values.size,
            data = values.map { envelope(SignalValue.Num(it)) },
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
