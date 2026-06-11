package io.teslasync.android.dashboard.widgets.energyflowanimated

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the EnergyFlowAnimatedWidget's pure logic — the nodes/arrows projection
 * (battery/drive/charger readouts, drive vs regen vs idle labels, active flows, per-node a11y), the
 * compact-hero rows + a11y, the footprint flag, the registry metadata, the kW/number formatters, and the
 * live-state map. Mirrors the web spec
 * (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx).
 */
class EnergyFlowAnimatedProjectionTest {
    private fun strings(): EnergyFlowAnimatedStrings =
        EnergyFlowAnimatedStrings(
            title = "Energy Flow",
            emptyMessage = "No energy data available",
            battery = "Battery",
            drive = "Drive",
            regen = "Regen",
            charger = "Charger",
            idle = "Idle",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = ::renderRelative,
        )

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long = 82,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        power: Double = 0.0,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
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
            power = power,
            ratedRange = 300_000.0,
            sentryMode = false,
            softwareVersion = "2026.4",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    private fun project(
        state: VehicleState,
        size: EnergyFlowAnimatedSize = EnergyFlowAnimatedRegistration.defaultSize,
    ): EnergyFlowAnimatedDisplay = EnergyFlowAnimatedProjection.project(state, size, strings())

    private fun nodeById(
        display: EnergyFlowAnimatedDisplay,
        id: String,
    ): EnergyFlowNode = display.nodes.single { it.id == id }

    private fun arrow(
        display: EnergyFlowAnimatedDisplay,
        from: String,
        to: String,
    ): EnergyFlowArrow = display.arrows.single { it.fromId == from && it.toId == to }

    // ---- nodes: battery is always present ------------------------------------------

    @Test
    fun batteryNodeShowsLevelAndPercent() {
        val battery = nodeById(project(vehicleState(batteryLevel = 82)), EnergyFlowAnimatedProjection.NODE_BATTERY)
        assertEquals("Battery", battery.label)
        assertEquals(82.0, battery.value, 0.0)
        assertEquals("82%", battery.formattedValue)
        assertEquals(EnergyFlowGlyph.Battery, battery.glyph)
        assertEquals(EnergyFlowPosition.Left, battery.position)
        assertEquals("Battery 82%", battery.contentDescription)
    }

    // ---- drive node: consuming / regen / idle --------------------------------------

    @Test
    fun consumingDriveNodeAndArrow() {
        val display = project(vehicleState(power = 11.0))
        val drive = nodeById(display, EnergyFlowAnimatedProjection.NODE_DRIVE)
        assertEquals("Drive", drive.label)
        assertEquals(11.0, drive.value, 0.0)
        assertEquals("11.0 kW", drive.formattedValue)
        assertEquals(EnergyFlowPosition.Right, drive.position)
        assertEquals("Drive 11.0 kW", drive.contentDescription)
        val flow = arrow(display, EnergyFlowAnimatedProjection.NODE_BATTERY, EnergyFlowAnimatedProjection.NODE_DRIVE)
        assertTrue(flow.active)
        assertEquals(11.0, flow.magnitude, 0.0)
        assertEquals(EnergyFlowTint.Drive, flow.tint)
        // The regen + charger flows are inactive when only consuming.
        assertFalse(arrow(display, EnergyFlowAnimatedProjection.NODE_DRIVE, EnergyFlowAnimatedProjection.NODE_BATTERY).active)
        assertFalse(arrow(display, EnergyFlowAnimatedProjection.NODE_CHARGER, EnergyFlowAnimatedProjection.NODE_BATTERY).active)
    }

    @Test
    fun regenDriveNodeUsesAbsoluteValueAndReverseArrow() {
        val display = project(vehicleState(power = -8.0))
        val drive = nodeById(display, EnergyFlowAnimatedProjection.NODE_DRIVE)
        assertEquals("Regen", drive.label)
        assertEquals(8.0, drive.value, 0.0)
        assertEquals("8.0 kW", drive.formattedValue)
        val flow = arrow(display, EnergyFlowAnimatedProjection.NODE_DRIVE, EnergyFlowAnimatedProjection.NODE_BATTERY)
        assertTrue(flow.active)
        assertEquals(8.0, flow.magnitude, 0.0)
        assertEquals(EnergyFlowTint.Regen, flow.tint)
    }

    @Test
    fun idleDriveNodeShowsDashAndNoActiveFlows() {
        val display = project(vehicleState(power = 0.3)) // within +/- 0.5 threshold => idle
        val drive = nodeById(display, EnergyFlowAnimatedProjection.NODE_DRIVE)
        assertEquals("Idle", drive.label)
        assertEquals("\u2014", drive.formattedValue)
        assertTrue(display.arrows.none { it.active })
    }

    // ---- charger node: charging / not -----------------------------------------------

    @Test
    fun chargingChargerNodeRoundsToWholeKwAndActivatesArrow() {
        val display = project(vehicleState(isCharging = true, chargerPower = 7.0))
        val charger = nodeById(display, EnergyFlowAnimatedProjection.NODE_CHARGER)
        assertEquals("Charger", charger.label)
        assertEquals(7.0, charger.value, 0.0)
        // Web charger node formats with 0 decimals (fmtNumber(chargerPower, 0)).
        assertEquals("7 kW", charger.formattedValue)
        assertEquals(EnergyFlowPosition.Top, charger.position)
        val flow = arrow(display, EnergyFlowAnimatedProjection.NODE_CHARGER, EnergyFlowAnimatedProjection.NODE_BATTERY)
        assertTrue(flow.active)
        assertEquals(7.0, flow.magnitude, 0.0)
        assertEquals(EnergyFlowTint.Charger, flow.tint)
    }

    @Test
    fun notChargingChargerNodeShowsDash() {
        val charger = nodeById(project(vehicleState(isCharging = false)), EnergyFlowAnimatedProjection.NODE_CHARGER)
        assertEquals("\u2014", charger.formattedValue)
    }

    // ---- compact hero ---------------------------------------------------------------

    @Test
    fun compactIdleShowsBatteryAndIdleOnly() {
        val display = project(vehicleState(batteryLevel = 64))
        assertEquals("64%", display.batteryPercentText)
        assertTrue(display.compactRows.isEmpty())
        assertTrue(display.compactIsIdle)
        assertEquals("64%, Idle", display.compactContentDescription)
    }

    @Test
    fun compactChargingAndConsumingStacksRows() {
        val display = project(vehicleState(batteryLevel = 90, isCharging = true, chargerPower = 7.0, power = 11.0))
        assertFalse(display.compactIsIdle)
        // Charger row first (web order), then drive; both carry colored kW (1 decimal) readouts.
        assertEquals(2, display.compactRows.size)
        assertEquals(EnergyFlowTint.Charger, display.compactRows[0].tint)
        assertEquals("7.0 kW", display.compactRows[0].valueText)
        assertEquals("Charger 7.0 kW", display.compactRows[0].contentDescription)
        assertEquals(EnergyFlowTint.Drive, display.compactRows[1].tint)
        assertEquals("11.0 kW", display.compactRows[1].valueText)
        assertEquals("90%, Charger 7.0 kW, Drive 11.0 kW", display.compactContentDescription)
    }

    @Test
    fun compactRegenRowUsesAbsoluteValue() {
        val display = project(vehicleState(power = -8.0))
        assertEquals(1, display.compactRows.size)
        assertEquals(EnergyFlowTint.Regen, display.compactRows[0].tint)
        assertEquals("8.0 kW", display.compactRows[0].valueText)
        assertEquals("82%, Regen 8.0 kW", display.compactContentDescription)
    }

    // ---- footprint flag (web size.cols < 2) -----------------------------------------

    @Test
    fun isCompactBelowTwoColumns() {
        assertTrue(EnergyFlowAnimatedSize(cols = 1, rows = 4).isCompact)
        assertFalse(EnergyFlowAnimatedSize(cols = 2, rows = 4).isCompact)
        assertFalse(EnergyFlowAnimatedSize(cols = 3, rows = 4).isCompact)
    }

    // ---- formatters -----------------------------------------------------------------

    @Test
    fun kwFormatsOneDecimalWithUnitAndAbsoluteValue() {
        assertEquals("11.0 kW", EnergyFlowAnimatedProjection.kw(11.0))
        assertEquals("8.0 kW", EnergyFlowAnimatedProjection.kw(-8.0))
        assertEquals("0.0 kW", EnergyFlowAnimatedProjection.kw(0.0))
    }

    @Test
    fun formatNumberGroupsThousandsWithFixedDigits() {
        assertEquals("1,234.6", EnergyFlowAnimatedProjection.formatNumber(1234.56, 1))
        assertEquals("7", EnergyFlowAnimatedProjection.formatNumber(7.0, 0))
    }

    @Test
    fun nonFinitePowerCollapsesToIdle() {
        val display = project(vehicleState(power = Double.NaN, chargerPower = Double.POSITIVE_INFINITY, isCharging = true))
        val drive = nodeById(display, EnergyFlowAnimatedProjection.NODE_DRIVE)
        assertEquals("Idle", drive.label)
        assertEquals(0.0, drive.value, 0.0)
        val charger = nodeById(display, EnergyFlowAnimatedProjection.NODE_CHARGER)
        assertEquals("0 kW", charger.formattedValue)
    }

    // ---- registry metadata (web registry/energy.ts) --------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("energy-flow-animated", EnergyFlowAnimatedRegistration.ID)
        assertEquals("energy", EnergyFlowAnimatedRegistration.CATEGORY)
        assertEquals("EnergyFlowAnimatedWidget", EnergyFlowAnimatedRegistration.SLUG)
        assertEquals(EnergyFlowAnimatedSize(cols = 2, rows = 4), EnergyFlowAnimatedRegistration.defaultSize)
        assertEquals(EnergyFlowAnimatedSize(cols = 2, rows = 4), EnergyFlowAnimatedRegistration.minSize)
        assertEquals(EnergyFlowAnimatedSize(cols = 3, rows = 40), EnergyFlowAnimatedRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(EnergyFlowAnimatedRegistration.isWithinBounds(EnergyFlowAnimatedSize(cols = 2, rows = 4)))
        assertFalse(EnergyFlowAnimatedRegistration.isWithinBounds(EnergyFlowAnimatedSize(cols = 1, rows = 4)))
        assertFalse(EnergyFlowAnimatedRegistration.isWithinBounds(EnergyFlowAnimatedSize(cols = 4, rows = 50)))
        assertEquals(
            EnergyFlowAnimatedSize(cols = 2, rows = 4),
            EnergyFlowAnimatedRegistration.clamp(EnergyFlowAnimatedSize(cols = 1, rows = 1)),
        )
        assertEquals(
            EnergyFlowAnimatedSize(cols = 3, rows = 40),
            EnergyFlowAnimatedRegistration.clamp(EnergyFlowAnimatedSize(cols = 9, rows = 99)),
        )
    }

    // ---- live-state map (vehicle-state -> snapshot) ---------------------------------

    @Test
    fun mapSuccessCarriesStateAndFreshness() {
        val vs = vehicleState()
        val result = mapEnergyFlowState(Resource.Success(VehicleStateEnvelope(vs, live = true), fetchedAt = 100L, stale = false))
        assertTrue(result is Resource.Success)
        assertSame(vs, (result as Resource.Success).data.state)
        assertEquals(100L, result.fetchedAt)
    }

    @Test
    fun mapLoadingPreservesCachedStateAndStale() {
        val vs = vehicleState()
        val result =
            mapEnergyFlowState(Resource.Loading(cached = VehicleStateEnvelope(vs, live = false), fetchedAt = 50L, stale = true))
        assertTrue(result is Resource.Loading)
        val loading = result as Resource.Loading
        assertSame(vs, loading.cached?.state)
        assertTrue(loading.stale)
        assertEquals(50L, loading.fetchedAt)
    }

    @Test
    fun mapErrorKeepsCachedSnapshotAndError() {
        val vs = vehicleState()
        val boom = IllegalStateException("boom")
        val result =
            mapEnergyFlowState(Resource.Error(cached = VehicleStateEnvelope(vs, live = false), fetchedAt = 70L, stale = true, error = boom))
        assertTrue(result is Resource.Error)
        val error = result as Resource.Error
        assertSame(vs, error.cached?.state)
        assertSame(boom, error.error)
    }

    @Test
    fun mapNullEnvelopeStateYieldsNullSnapshotState() {
        val result =
            mapEnergyFlowState(Resource.Success(VehicleStateEnvelope(state = null, live = false), fetchedAt = 100L, stale = false))
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
