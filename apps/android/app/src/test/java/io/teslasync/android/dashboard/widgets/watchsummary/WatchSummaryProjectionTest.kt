package io.teslasync.android.dashboard.widgets.watchsummary

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free Watch Summary surface logic: the summary → display projection
 * (the "data adapter"), the SI→display range/temperature boundary (metric + imperial), the empty/no-data
 * predicate reproduced from the web source, the battery color band + state badge tone + lock state rules,
 * the `last_updated` parse, the complication charge-flag fold, the active footprint flag, and the registry
 * footprint constraints. These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class WatchSummaryProjectionTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(
            UnitPreferences.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("unit_of_temp", "F")
                },
            ),
        )

    // ── empty / no-data ─────────────────────────────────────────────────────────
    @Test
    fun nullViewIsEmpty() {
        val display = WatchSummaryProjection.project(null, metric)
        assertFalse(display.hasData)
        assertEquals(EM_DASH, display.rangeText)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(LockState.Unknown, display.lockState)
        assertNull(display.lastSeenMillis)
    }

    @Test
    fun blankSummaryIsEmpty() {
        // The default/empty payload (no state, no last-updated stamp) is the web `summary == null` case.
        assertTrue(WatchSummaryProjection.isEmpty(WatchSummary()))
        assertFalse(WatchSummaryProjection.project(view(WatchSummary()), metric).hasData)
    }

    @Test
    fun summaryWithStateIsNotEmpty() {
        assertFalse(WatchSummaryProjection.isEmpty(WatchSummary(state = "unknown", lastUpdated = "2026-06-11T18:25:00Z")))
        assertFalse(WatchSummaryProjection.isEmpty(WatchSummary(state = "online")))
        assertFalse(WatchSummaryProjection.isEmpty(WatchSummary(lastUpdated = "2026-06-11T18:25:00Z")))
    }

    // ── content / formatting ────────────────────────────────────────────────────
    @Test
    fun projectsMetricContent() {
        val display = WatchSummaryProjection.project(view(sample(), charging = true), metric)

        assertTrue(display.hasData)
        assertEquals(72.0, display.batteryLevel, 0.0)
        assertEquals(BatteryColorBand.Green, display.colorBand)
        assertEquals("online", display.stateLabel)
        assertEquals(StateTone.Success, display.stateTone)
        assertEquals("312 km", display.rangeText)
        assertEquals(LockState.Locked, display.lockState)
        assertEquals("21\u00B0C", display.cabinTempText)
        assertTrue(display.isCharging)
        assertNotNull(display.lastSeenMillis)
    }

    @Test
    fun convertsRangeAndTemperatureToImperialAtDisplayBoundary() {
        // 312 km → metres → miles; 21°C → 70°F (whole units, web fmtNumber(_, 0)).
        val display = WatchSummaryProjection.project(view(sample()), imperial)
        assertTrue(display.rangeText.endsWith("mi"))
        assertEquals("194 mi", display.rangeText)
        assertEquals("70\u00B0F", display.cabinTempText)
    }

    @Test
    fun blankStateHidesStateLabel() {
        val display = WatchSummaryProjection.project(view(sample().copy(state = "   ")), metric)
        // A non-blank last-updated keeps the surface non-empty, but the blank state hides the badge.
        assertTrue(display.hasData)
        assertNull(display.stateLabel)
    }

    @Test
    fun unlockedSummaryProjectsUnlockedLock() {
        val display = WatchSummaryProjection.project(view(sample().copy(isLocked = false)), metric)
        assertEquals(LockState.Unlocked, display.lockState)
    }

    @Test
    fun missingComplicationDegradesChargingToFalse() {
        val display = WatchSummaryProjection.project(view(sample(), charging = false), metric)
        assertFalse(display.isCharging)
    }

    // ── battery color band (web getBatteryColor) ─────────────────────────────────
    @Test
    fun batteryColorBandThresholds() {
        assertEquals(BatteryColorBand.Green, BatteryColorBand.forLevel(72.0))
        assertEquals(BatteryColorBand.Green, BatteryColorBand.forLevel(50.1))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(50.0))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(20.1))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(20.0))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(0.0))
    }

    // ── state badge tone (web badge variant ternary) ─────────────────────────────
    @Test
    fun stateToneMapping() {
        assertEquals(StateTone.Success, StateTone.forState("online"))
        assertEquals(StateTone.Neutral, StateTone.forState("asleep"))
        assertEquals(StateTone.Warning, StateTone.forState("driving"))
        assertEquals(StateTone.Warning, StateTone.forState("unknown"))
    }

    // ── lock state ───────────────────────────────────────────────────────────────
    @Test
    fun lockStateMapping() {
        assertEquals(LockState.Locked, LockState.forFlag(true))
        assertEquals(LockState.Unlocked, LockState.forFlag(false))
        assertEquals(LockState.Unknown, LockState.forFlag(null))
    }

    // ── last_updated parse (web TimeStamp value) ─────────────────────────────────
    @Test
    fun parsesLastSeenStamp() {
        assertNotNull(WatchSummaryProjection.parseLastSeenMillis("2026-06-11T18:25:00Z"))
        assertNull(WatchSummaryProjection.parseLastSeenMillis(""))
        assertNull(WatchSummaryProjection.parseLastSeenMillis("not-a-timestamp"))
    }

    // ── complication charge flag ─────────────────────────────────────────────────
    @Test
    fun chargingFromComplication() {
        assertFalse(chargingFrom(null))
        assertFalse(chargingFrom(WatchComplication(charging = false)))
        assertTrue(chargingFrom(WatchComplication(charging = true)))
    }

    // ── footprint / registry ─────────────────────────────────────────────────────
    @Test
    fun compactFlagFollowsColumns() {
        assertTrue(WatchSummarySize(1, 2).isCompact)
        assertFalse(WatchSummarySize(2, 2).isCompact)
        assertFalse(WatchSummarySize(2, 40).isCompact)
    }

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("watch-summary", WatchSummaryRegistration.ID)
        assertEquals("vehicle", WatchSummaryRegistration.CATEGORY)
        assertEquals("WatchSummaryWidget", WatchSummaryRegistration.SLUG)
        assertEquals(WatchSummarySize(1, 2), WatchSummaryRegistration.DEFAULT_SIZE)
        assertEquals(WatchSummarySize(1, 2), WatchSummaryRegistration.MIN_SIZE)
        assertEquals(WatchSummarySize(2, 40), WatchSummaryRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(WatchSummaryRegistration.isWithinBounds(WatchSummarySize(1, 2)))
        assertTrue(WatchSummaryRegistration.isWithinBounds(WatchSummarySize(2, 40)))
        assertFalse(WatchSummaryRegistration.isWithinBounds(WatchSummarySize(3, 2)))
        assertFalse(WatchSummaryRegistration.isWithinBounds(WatchSummarySize(1, 1)))
        assertEquals(WatchSummarySize(2, 40), WatchSummaryRegistration.clamp(WatchSummarySize(9, 99)))
        assertEquals(WatchSummarySize(1, 2), WatchSummaryRegistration.clamp(WatchSummarySize(0, 0)))
    }

    // ── helpers ───────────────────────────────────────────────────────────────────
    private fun sample(): WatchSummary =
        WatchSummary(
            vehicleName = "Model 3",
            state = "online",
            batteryLevel = 72.0,
            rangeKm = 312.0,
            isCharging = true,
            chargeRate = 32.0,
            timeToFull = 45.0,
            isLocked = true,
            sentryMode = false,
            insideTempC = 21.0,
            outsideTempC = 14.0,
            isClimateOn = false,
            lastUpdated = "2026-06-11T18:25:00Z",
        )

    private fun view(
        summary: WatchSummary,
        charging: Boolean = false,
    ): WatchView = WatchView(summary, charging)
}
