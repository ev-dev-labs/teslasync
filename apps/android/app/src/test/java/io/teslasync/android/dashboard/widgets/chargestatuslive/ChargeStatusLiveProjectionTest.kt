package io.teslasync.android.dashboard.widgets.chargestatuslive

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
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
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the ChargeStatusLiveWidget's pure logic — the metrics projection
 * (power/battery/time/energy/rate cells, compact a11y, last-session line), the `formatTime` /
 * energy-kWh / rate / number formatters, the footprint flags, the registry metadata, and the
 * cache-then-network combine mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx) and the WinUI parity tests.
 */
class ChargeStatusLiveProjectionTest {
    // ---- fixtures -------------------------------------------------------------------

    private fun units(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun strings(): ChargeStatusLiveStrings =
        ChargeStatusLiveStrings(
            title = "Charge Status",
            emptyMessage = "No charge data",
            charging = "Charging",
            notCharging = "Not Charging",
            voltage = "Voltage",
            current = "Current",
            timeLeft = "Time Left",
            added = "Added",
            rate = "Rate",
            battery = "Battery",
            lastSession = "Last Session",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long = 82,
        isCharging: Boolean = true,
        chargerPower: Double = 11.0,
        chargeRate: Double = 50_000.0,
        timeToFullCharge: Double = 1.5,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = chargeRate,
            chargerPower = chargerPower,
            idealRange = 300_000.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 10.0,
            power = 0.0,
            ratedRange = 300_000.0,
            sentryMode = false,
            softwareVersion = "2026.4",
            speed = 0.0,
            state = "charging",
            timeToFullCharge = timeToFullCharge,
            vehicleId = 1L,
        )

    private fun session(totalEnergyAddedWh: Double? = 12_345.0): ChargingSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.fromEpochMilliseconds(0L),
            vehicleId = 1L,
            totalEnergyAddedWh = totalEnergyAddedWh,
        )

    private fun project(
        state: VehicleState = vehicleState(),
        session: ChargingSession? = session(),
        size: ChargeStatusLiveSize = ChargeStatusLiveRegistration.defaultSize,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): ChargeStatusLiveDisplay = ChargeStatusLiveProjection.project(state, session, size, units(distance), strings())

    // ---- charging metrics -----------------------------------------------------------

    @Test
    fun chargingProjectsEveryMetricMatchingWeb() {
        val display = project()
        assertTrue(display.isCharging)
        assertTrue(display.hasSession)
        assertEquals(11.0, display.powerValue, 0.0)
        assertEquals("11.0 kW", display.powerText)
        assertEquals(" kW", display.powerSuffix)
        assertEquals("82%", display.batteryPercentText)
        assertEquals("Charging", display.chargingBadgeLabel)
        // Web hard-codes voltage + current to null -> em dash.
        assertEquals("\u2014", display.voltage.value)
        assertEquals("\u2014", display.current.value)
        assertEquals("1h 30m", display.timeLeft.value)
        assertEquals("12.3 kWh", display.added.value)
        assertEquals("50 km/h", display.rate.value)
        assertEquals("82%", display.battery.value)
        assertEquals("+12.3 kWh", display.lastSessionValue)
        assertEquals("Last Session", display.lastSessionLabel)
    }

    @Test
    fun cellsCarryGlyphLabelAndAccessibleName() {
        val display = project()
        assertEquals(ChargeStatusLiveGlyph.Gauge, display.voltage.glyph)
        assertEquals(ChargeStatusLiveGlyph.Zap, display.current.glyph)
        assertEquals(ChargeStatusLiveGlyph.Timer, display.timeLeft.glyph)
        assertEquals(ChargeStatusLiveGlyph.Zap, display.added.glyph)
        assertEquals(ChargeStatusLiveGlyph.Gauge, display.rate.glyph)
        assertEquals(ChargeStatusLiveGlyph.BatteryCharging, display.battery.glyph)
        assertEquals("Time Left 1h 30m", display.timeLeft.contentDescription)
        assertEquals("Added 12.3 kWh", display.added.contentDescription)
        assertEquals("Voltage \u2014", display.voltage.contentDescription)
    }

    @Test
    fun compactContentDescriptionFoldsPowerAndBatteryWhenCharging() {
        val display = project(size = ChargeStatusLiveSize(cols = 1, rows = 1))
        assertTrue(display.isCompact)
        assertEquals("11.0 kW, 82%", display.compactContentDescription)
    }

    // ---- idle ------------------------------------------------------------------------

    @Test
    fun idleProjectsNotChargingWithoutSession() {
        val display = project(state = vehicleState(batteryLevel = 64, isCharging = false), session = null)
        assertFalse(display.isCharging)
        assertFalse(display.hasSession)
        assertEquals("Not Charging", display.notChargingText)
        assertEquals("Not Charging, 64%", display.compactContentDescription)
        // Energy added defaults to 0 when there is no session (web `energyAdded ?? 0`).
        assertEquals("0.0 kWh", display.added.value)
        assertEquals("+0.0 kWh", display.lastSessionValue)
    }

    // ---- footprint flags -------------------------------------------------------------

    @Test
    fun footprintFlagsMatchWeb() {
        assertTrue(ChargeStatusLiveSize(cols = 1, rows = 1).isCompact)
        assertFalse(ChargeStatusLiveSize(cols = 2, rows = 1).isCompact)
        assertFalse(ChargeStatusLiveSize(cols = 1, rows = 2).isCompact)
        assertTrue(ChargeStatusLiveSize(cols = 2, rows = 2).isTall)
        assertFalse(ChargeStatusLiveSize(cols = 2, rows = 1).isTall)
    }

    // ---- formatTime (web formatTime) -------------------------------------------------

    @Test
    fun formatTimeMatchesWeb() {
        assertEquals("\u2014", ChargeStatusLiveProjection.formatTime(0.0))
        assertEquals("\u2014", ChargeStatusLiveProjection.formatTime(-1.0))
        assertEquals("\u2014", ChargeStatusLiveProjection.formatTime(Double.NaN))
        assertEquals("\u2014", ChargeStatusLiveProjection.formatTime(Double.POSITIVE_INFINITY))
        assertEquals("30m", ChargeStatusLiveProjection.formatTime(0.5))
        assertEquals("2h", ChargeStatusLiveProjection.formatTime(2.0))
        assertEquals("1h 30m", ChargeStatusLiveProjection.formatTime(1.5))
        assertEquals("3h 15m", ChargeStatusLiveProjection.formatTime(3.25))
    }

    @Test
    fun formatTimeReproducesWebNoCarryEdge() {
        // Web: h = floor(0.999) = 0, m = round(0.999*60) = round(59.94) = 60 -> "60m" (no carry to 1h).
        assertEquals("60m", ChargeStatusLiveProjection.formatTime(0.999))
    }

    // ---- energy / rate / number formatters -------------------------------------------

    @Test
    fun formatEnergyKwhConvertsFromSiWattHours() {
        assertEquals("0.0 kWh", ChargeStatusLiveProjection.formatEnergyKwh(0.0))
        assertEquals("12.3 kWh", ChargeStatusLiveProjection.formatEnergyKwh(12_345.0))
        assertEquals("1,234.6 kWh", ChargeStatusLiveProjection.formatEnergyKwh(1_234_567.0))
    }

    @Test
    fun formatRateHonoursDistancePreference() {
        assertEquals("50 km/h", ChargeStatusLiveProjection.formatRate(50_000.0, units(DistanceUnitPref.KM)))
        assertEquals("50 mi/h", ChargeStatusLiveProjection.formatRate(80_467.2, units(DistanceUnitPref.MI)))
        assertEquals("0 km/h", ChargeStatusLiveProjection.formatRate(0.0, units(DistanceUnitPref.KM)))
    }

    @Test
    fun rateCellUsesMilesWhenPreferred() {
        val display = project(state = vehicleState(chargeRate = 80_467.2), distance = DistanceUnitPref.MI)
        assertEquals("50 mi/h", display.rate.value)
    }

    @Test
    fun formatNumberGroupsThousandsWithFixedDigits() {
        assertEquals("1,234.6", ChargeStatusLiveProjection.formatNumber(1234.56, 1))
        assertEquals("11.0", ChargeStatusLiveProjection.formatNumber(11.0, 1))
        assertEquals("50", ChargeStatusLiveProjection.formatNumber(49.6, 0))
    }

    @Test
    fun nonFiniteMetricsCollapseToZero() {
        val display = project(state = vehicleState(chargerPower = Double.NaN, chargeRate = Double.POSITIVE_INFINITY))
        assertEquals("0.0 kW", display.powerText)
        assertEquals("0 km/h", display.rate.value)
    }

    // ---- registry metadata (web registry/charging.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("charge-status-live", ChargeStatusLiveRegistration.ID)
        assertEquals("charging", ChargeStatusLiveRegistration.CATEGORY)
        assertEquals("ChargeStatusLiveWidget", ChargeStatusLiveRegistration.SLUG)
        assertEquals(1, ChargeStatusLiveRegistration.SESSION_LIMIT)
        assertEquals(ChargeStatusLiveSize(cols = 2, rows = 2), ChargeStatusLiveRegistration.defaultSize)
        assertEquals(ChargeStatusLiveSize(cols = 1, rows = 2), ChargeStatusLiveRegistration.minSize)
        assertEquals(ChargeStatusLiveSize(cols = 3, rows = 40), ChargeStatusLiveRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(ChargeStatusLiveRegistration.isWithinBounds(ChargeStatusLiveSize(cols = 2, rows = 2)))
        assertFalse(ChargeStatusLiveRegistration.isWithinBounds(ChargeStatusLiveSize(cols = 0, rows = 1)))
        assertFalse(ChargeStatusLiveRegistration.isWithinBounds(ChargeStatusLiveSize(cols = 4, rows = 50)))
        assertEquals(
            ChargeStatusLiveSize(cols = 1, rows = 2),
            ChargeStatusLiveRegistration.clamp(ChargeStatusLiveSize(cols = 0, rows = 0)),
        )
        assertEquals(
            ChargeStatusLiveSize(cols = 3, rows = 40),
            ChargeStatusLiveRegistration.clamp(ChargeStatusLiveSize(cols = 9, rows = 99)),
        )
    }

    // ---- combine mapper (vehicle-state primary + session supplementary) -------------

    @Test
    fun combineSuccessFoldsStateAndNewestSession() {
        val vs = vehicleState()
        val sess = session()
        val result =
            combineChargeStatus(
                Resource.Success(VehicleStateEnvelope(vs, live = true), fetchedAt = 100L, stale = false),
                Resource.Success(listOf(sess), fetchedAt = 90L, stale = false),
            )
        assertTrue(result is Resource.Success)
        val data = (result as Resource.Success).data
        assertSame(vs, data.state)
        assertSame(sess, data.latestSession)
        assertEquals(100L, result.fetchedAt)
    }

    @Test
    fun combinePreservesLoadingCacheAndStaleFromPrimary() {
        val vs = vehicleState()
        val result =
            combineChargeStatus(
                Resource.Loading(cached = VehicleStateEnvelope(vs, live = false), fetchedAt = 50L, stale = true),
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(result is Resource.Loading)
        val loading = result as Resource.Loading
        assertSame(vs, loading.cached?.state)
        assertNull(loading.cached?.latestSession)
        assertTrue(loading.stale)
        assertEquals(50L, loading.fetchedAt)
    }

    @Test
    fun combineErrorKeepsCachedSnapshotAndError() {
        val vs = vehicleState()
        val sess = session()
        val boom = IllegalStateException("boom")
        val result =
            combineChargeStatus(
                Resource.Error(cached = VehicleStateEnvelope(vs, live = false), fetchedAt = 70L, stale = true, error = boom),
                // The session feed's own error is irrelevant; its cached value is still folded in.
                Resource.Error(cached = listOf(sess), fetchedAt = 60L, stale = true, error = boom),
            )
        assertTrue(result is Resource.Error)
        val error = result as Resource.Error
        assertSame(vs, error.cached?.state)
        assertSame(sess, error.cached?.latestSession)
        assertSame(boom, error.error)
    }

    @Test
    fun combineWithEmptySessionsYieldsNullLatestSession() {
        val result =
            combineChargeStatus(
                Resource.Success(VehicleStateEnvelope(vehicleState(), live = true), fetchedAt = 100L, stale = false),
                Resource.Success(emptyList(), fetchedAt = 90L, stale = false),
            )
        assertNull((result as Resource.Success).data.latestSession)
    }

    @Test
    fun combineWithNullStateYieldsEmptySnapshot() {
        val result =
            combineChargeStatus(
                Resource.Success(VehicleStateEnvelope(state = null, live = false), fetchedAt = 100L, stale = false),
                Resource.Success(listOf(session()), fetchedAt = 90L, stale = false),
            )
        assertNull((result as Resource.Success).data.state)
    }

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
