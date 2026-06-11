package io.teslasync.android.dashboardwidgets.batteryradialgauge

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Framework-free unit tests for the BatteryRadialGauge widget — the `getBatteryColor` threshold band,
 * the `isCompact`/`isLarge` size model, the registry constraints, the stat + charge-limit-ring
 * projection and the active-vehicle resolution. These run in the `:app:testReleaseUnitTest` gate and
 * cover the behavior the composables only render.
 */
class BatteryRadialGaugeWidgetModelTest {
    // ── color band (web getBatteryColor: > 50 green, > 20 amber, else red) ───────
    @Test
    fun colorBandMatchesWebThresholds() {
        assertEquals(BatteryColorBand.Green, BatteryColorBand.forLevel(100.0))
        assertEquals(BatteryColorBand.Green, BatteryColorBand.forLevel(50.1))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(50.0))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(20.1))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(20.0))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(0.0))
    }

    // ── size model (web isCompact / isLarge) ─────────────────────────────────────
    @Test
    fun sizeFlagsMatchWeb() {
        assertTrue(BatteryRadialGaugeSize(cols = 1, rows = 1).isCompact)
        assertFalse(BatteryRadialGaugeSize(cols = 1, rows = 2).isCompact)
        assertFalse(BatteryRadialGaugeSize(cols = 1, rows = 2).isLarge)
        assertTrue(BatteryRadialGaugeSize(cols = 2, rows = 2).isLarge)
        assertTrue(BatteryRadialGaugeSize(cols = 3, rows = 40).isLarge)
        assertFalse(BatteryRadialGaugeSize(cols = 2, rows = 1).isLarge)
    }

    // ── registry metadata (canonical battery.ts) ─────────────────────────────────
    @Test
    fun registrationMatchesRegistry() {
        assertEquals("battery-radial-gauge", BatteryRadialGaugeRegistration.ID)
        assertEquals("battery", BatteryRadialGaugeRegistration.CATEGORY)
        assertEquals("BatteryRadialGaugeWidget", BatteryRadialGaugeRegistration.SLUG)
        assertEquals(BatteryRadialGaugeSize(cols = 1, rows = 2), BatteryRadialGaugeRegistration.DEFAULT_SIZE)
        assertEquals(BatteryRadialGaugeSize(cols = 1, rows = 2), BatteryRadialGaugeRegistration.MIN_SIZE)
        assertEquals(BatteryRadialGaugeSize(cols = 3, rows = 40), BatteryRadialGaugeRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(BatteryRadialGaugeRegistration.isWithinBounds(BatteryRadialGaugeSize(cols = 2, rows = 10)))
        assertFalse(BatteryRadialGaugeRegistration.isWithinBounds(BatteryRadialGaugeSize(cols = 4, rows = 10)))
        assertFalse(BatteryRadialGaugeRegistration.isWithinBounds(BatteryRadialGaugeSize(cols = 1, rows = 1)))
        assertEquals(
            BatteryRadialGaugeSize(cols = 3, rows = 40),
            BatteryRadialGaugeRegistration.clamp(BatteryRadialGaugeSize(cols = 9, rows = 99)),
        )
        assertEquals(
            BatteryRadialGaugeSize(cols = 1, rows = 2),
            BatteryRadialGaugeRegistration.clamp(BatteryRadialGaugeSize(cols = 0, rows = 0)),
        )
    }

    // ── projection: no state (web state falsy ⇒ empty + #374151) ─────────────────
    @Test
    fun projectNoStateRendersEmptyBand() {
        val display = BatteryRadialGaugeProjection.project(null, null, BatteryRadialGaugeSize(cols = 2, rows = 2))
        assertFalse(display.hasState)
        assertEquals(BatteryColorBand.Unknown, display.colorBand)
        assertEquals(0.0, display.batteryLevel, 0.0)
        assertFalse(display.isCharging)
        assertFalse(display.showChargeLimitRing)
        assertEquals(1, display.stats.size)
        assertEquals(GaugeStatKind.Level, display.stats[0].kind)
    }

    // ── projection: default footprint (1×2) shows title, no stats, no ring ───────
    @Test
    fun projectStateDefaultFootprint() {
        val display =
            BatteryRadialGaugeProjection.project(state(72, charging = false), null, BatteryRadialGaugeRegistration.DEFAULT_SIZE)
        assertTrue(display.hasState)
        assertEquals(72.0, display.batteryLevel, 0.0)
        assertEquals(BatteryColorBand.Green, display.colorBand)
        assertTrue(display.showTitle)
        assertFalse(display.showStats)
        assertFalse(display.showChargeLimitRing)
        assertEquals(1, display.stats.size)
    }

    // ── projection: large + charging + charge limit ──────────────────────────────
    @Test
    fun projectLargeChargingWithLimit() {
        val display =
            BatteryRadialGaugeProjection.project(state(18, charging = true), 80.0, BatteryRadialGaugeSize(cols = 2, rows = 2))
        assertEquals(BatteryColorBand.Red, display.colorBand)
        assertTrue(display.isCharging)
        assertTrue(display.showStats)
        assertTrue(display.showChargeLimitRing)
        assertEquals(0.8f, display.chargeLimitRingFraction, RING_TOLERANCE)
        assertEquals(2, display.stats.size)
        assertEquals(GaugeStatKind.ChargeLimit, display.stats[1].kind)
        assertEquals(80.0, display.stats[1].value, 0.0)
        assertEquals(BATTERY_PERCENT_UNIT, display.stats[1].unit)
    }

    // ── projection: compact (1×1) hides title/stats/ring even with a limit ───────
    @Test
    fun projectCompactHidesChromeAndRing() {
        val display =
            BatteryRadialGaugeProjection.project(state(60, charging = false), 90.0, BatteryRadialGaugeSize(cols = 1, rows = 1))
        assertTrue(display.isCompact)
        assertFalse(display.showTitle)
        assertFalse(display.showStats)
        assertFalse(display.showChargeLimitRing)
        assertEquals(2, display.stats.size)
    }

    // ── active-vehicle resolution (web id = vehicleId ?? vehicles?.[0]?.id ?? 0) ──
    @Test
    fun resolveVehicleIdPrefersPropThenFirst() {
        assertEquals(5L, resolveVehicleId(5L, listOf(vehicle(9))))
        assertEquals(9L, resolveVehicleId(null, listOf(vehicle(9), vehicle(10))))
        assertEquals(9L, resolveVehicleId(0L, listOf(vehicle(9))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
        assertNull(resolveVehicleId(0L, emptyList()))
    }

    @Test
    fun firstVehicleIdReadsFirstOrNull() {
        assertEquals(7L, firstVehicleId(listOf(vehicle(7), vehicle(8))))
        assertNull(firstVehicleId(emptyList()))
        assertNull(firstVehicleId(null))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private fun state(
        level: Long,
        charging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = level,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = charging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 350.0,
            sentryMode = false,
            softwareVersion = "2024.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
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

    private companion object {
        const val RING_TOLERANCE = 0.0001f
    }
}
