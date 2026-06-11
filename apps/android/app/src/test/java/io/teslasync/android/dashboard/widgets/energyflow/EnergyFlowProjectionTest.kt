package io.teslasync.android.dashboard.widgets.energyflow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the EnergyFlowWidget's pure logic — the nodes/arrows projection
 * (Battery/Motor/Charger nodes, the Consuming/Regenerating/Standby motor label, the directional
 * Consuming/Regen/Charging arrows with their hues + active flags), the power/number formatters, the
 * stroke-scale + max-arrow math, the registry metadata, the vehicle resolution, and the
 * cache-then-network resource combiner. Mirrors the web spec
 * (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx + shared/WidgetFlowDiagram.tsx).
 */
class EnergyFlowProjectionTest {
    private val emDash = "\u2014"

    @Suppress("LongParameterList")
    private fun vehicleState(
        power: Double = 0.0,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        batteryLevel: Long = 72,
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

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochMilliseconds(0L),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochMilliseconds(0L),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochMilliseconds(0L),
            vin = "VIN$id",
        )

    private fun node(
        display: EnergyFlowDisplay,
        which: EnergyFlowNode,
    ): EnergyFlowNodeModel? = display.nodes.firstOrNull { it.node == which }

    private fun arrow(
        display: EnergyFlowDisplay,
        from: EnergyFlowNode,
        to: EnergyFlowNode,
    ): EnergyFlowArrowModel? = display.arrows.firstOrNull { it.from == from && it.to == to }

    // ---- consuming (power > 0) ------------------------------------------------------

    @Test
    fun consumingProjectsBatteryAndMotorWithActiveConsumingArrow() {
        val display = EnergyFlowProjection.project(vehicleState(power = 24.6, batteryLevel = 72))
        assertTrue(display.hasState)

        val battery = node(display, EnergyFlowNode.Battery)!!
        assertEquals(EnergyFlowAnchor.Left, battery.anchor)
        assertEquals(EnergyFlowLabel.Battery, battery.label)
        assertEquals(72.0, battery.value, 0.0)
        assertEquals("72%", battery.formattedValue)

        val motor = node(display, EnergyFlowNode.Motor)!!
        assertEquals(EnergyFlowAnchor.Right, motor.anchor)
        assertEquals(EnergyFlowLabel.Consuming, motor.label)
        assertEquals(24.6, motor.value, 1e-9)
        assertEquals("24.6 kW", motor.formattedValue)

        // Not charging → no Charger node.
        assertNull(node(display, EnergyFlowNode.Charger))

        val consuming = arrow(display, EnergyFlowNode.Battery, EnergyFlowNode.Motor)!!
        assertTrue(consuming.active)
        assertEquals(24.6, consuming.value, 1e-9)
        assertEquals(EnergyFlowHue.Cyan, consuming.hue)

        val regen = arrow(display, EnergyFlowNode.Motor, EnergyFlowNode.Battery)!!
        assertFalse(regen.active)
        assertEquals(0.0, regen.value, 0.0)
        assertEquals(EnergyFlowHue.Emerald, regen.hue)

        // Not charging → no Charger arrow.
        assertNull(arrow(display, EnergyFlowNode.Charger, EnergyFlowNode.Battery))
    }

    // ---- regenerating (power < 0) ---------------------------------------------------

    @Test
    fun regeneratingProjectsRegenArrowAndLabel() {
        val display = EnergyFlowProjection.project(vehicleState(power = -8.0, batteryLevel = 80))
        val motor = node(display, EnergyFlowNode.Motor)!!
        assertEquals(EnergyFlowLabel.Regenerating, motor.label)
        assertEquals(8.0, motor.value, 0.0)
        assertEquals("8.0 kW", motor.formattedValue)

        val regen = arrow(display, EnergyFlowNode.Motor, EnergyFlowNode.Battery)!!
        assertTrue(regen.active)
        assertEquals(8.0, regen.value, 0.0)

        val consuming = arrow(display, EnergyFlowNode.Battery, EnergyFlowNode.Motor)!!
        assertFalse(consuming.active)
        assertEquals(0.0, consuming.value, 0.0)
    }

    // ---- standby (power == 0) -------------------------------------------------------

    @Test
    fun standbyProjectsEmDashMotorWithNoActiveArrows() {
        val display = EnergyFlowProjection.project(vehicleState(power = 0.0))
        val motor = node(display, EnergyFlowNode.Motor)!!
        assertEquals(EnergyFlowLabel.Standby, motor.label)
        assertEquals(0.0, motor.value, 0.0)
        assertEquals(emDash, motor.formattedValue)

        assertFalse(arrow(display, EnergyFlowNode.Battery, EnergyFlowNode.Motor)!!.active)
        assertFalse(arrow(display, EnergyFlowNode.Motor, EnergyFlowNode.Battery)!!.active)
    }

    // ---- charging -------------------------------------------------------------------

    @Test
    fun chargingAddsChargerNodeAndActiveAmberArrow() {
        val display =
            EnergyFlowProjection.project(
                vehicleState(power = -6.0, isCharging = true, chargerPower = 11.0, batteryLevel = 64),
            )
        val charger = node(display, EnergyFlowNode.Charger)!!
        assertEquals(EnergyFlowAnchor.Top, charger.anchor)
        assertEquals(EnergyFlowLabel.Charger, charger.label)
        assertEquals(11.0, charger.value, 0.0)
        assertEquals("11.0 kW", charger.formattedValue)

        val chargerArrow = arrow(display, EnergyFlowNode.Charger, EnergyFlowNode.Battery)!!
        assertTrue(chargerArrow.active)
        assertEquals(11.0, chargerArrow.value, 0.0)
        assertEquals(EnergyFlowHue.Amber, chargerArrow.hue)

        // Three nodes (Battery, Motor, Charger) + three arrows when charging.
        assertEquals(3, display.nodes.size)
        assertEquals(3, display.arrows.size)
    }

    // ---- empty ----------------------------------------------------------------------

    @Test
    fun nullStateYieldsEmptyProjection() {
        val display = EnergyFlowProjection.project(null)
        assertFalse(display.hasState)
        assertTrue(display.nodes.isEmpty())
        assertTrue(display.arrows.isEmpty())
        assertTrue(EnergyFlowProjection.isEmptyState(null))
        assertFalse(EnergyFlowProjection.isEmptyState(vehicleState()))
    }

    @Test
    fun nonFinitePowerCollapsesToStandby() {
        val display = EnergyFlowProjection.project(vehicleState(power = Double.NaN))
        val motor = node(display, EnergyFlowNode.Motor)!!
        assertEquals(EnergyFlowLabel.Standby, motor.label)
        assertEquals(0.0, motor.value, 0.0)
    }

    // ---- formatters -----------------------------------------------------------------

    @Test
    fun formatPowerMatchesWeb() {
        assertEquals("24.6 kW", EnergyFlowProjection.formatPower(24.6))
        assertEquals("11.0 kW", EnergyFlowProjection.formatPower(11.0))
        assertEquals("0.0 kW", EnergyFlowProjection.formatPower(0.0))
    }

    @Test
    fun formatNumberGroupsThousandsWithFixedDigits() {
        assertEquals("1,234.6", EnergyFlowProjection.formatNumber(1234.56, 1))
        assertEquals("11.0", EnergyFlowProjection.formatNumber(11.0, 1))
        assertEquals("0.0", EnergyFlowProjection.formatNumber(Double.NaN, 1))
    }

    @Test
    fun motorLabelMatchesWebPriority() {
        assertEquals(EnergyFlowLabel.Consuming, EnergyFlowProjection.motorLabel(isConsuming = true, isRegen = false))
        assertEquals(EnergyFlowLabel.Regenerating, EnergyFlowProjection.motorLabel(isConsuming = false, isRegen = true))
        assertEquals(EnergyFlowLabel.Standby, EnergyFlowProjection.motorLabel(isConsuming = false, isRegen = false))
    }

    // ---- stroke scaling (web strokeForValue / maxArrowValue) ------------------------

    @Test
    fun strokeScaleMatchesWebFormula() {
        assertEquals(EnergyFlowProjection.MAX_STROKE, EnergyFlowProjection.strokeScale(24.6, 24.6), 1e-6f)
        assertEquals(EnergyFlowProjection.MIN_STROKE, EnergyFlowProjection.strokeScale(0.0, 24.6), 1e-6f)
        assertEquals(2.5f, EnergyFlowProjection.strokeScale(12.3, 24.6), 1e-6f)
        // maxValue of 0 degrades to the minimum stroke.
        assertEquals(EnergyFlowProjection.MIN_STROKE, EnergyFlowProjection.strokeScale(5.0, 0.0), 1e-6f)
    }

    @Test
    fun maxArrowValueNeverBelowOne() {
        assertEquals(1.0, EnergyFlowProjection.maxArrowValue(emptyList()), 0.0)
        val arrows =
            EnergyFlowProjection
                .project(vehicleState(power = 24.6))
                .arrows
        assertEquals(24.6, EnergyFlowProjection.maxArrowValue(arrows), 1e-9)
    }

    // ---- registry metadata (web registry/battery.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("energy-flow", EnergyFlowRegistration.ID)
        assertEquals("battery", EnergyFlowRegistration.CATEGORY)
        assertEquals("EnergyFlowWidget", EnergyFlowRegistration.SLUG)
        assertEquals(EnergyFlowSize(cols = 2, rows = 4), EnergyFlowRegistration.DEFAULT_SIZE)
        assertEquals(EnergyFlowSize(cols = 2, rows = 4), EnergyFlowRegistration.MIN_SIZE)
        assertEquals(EnergyFlowSize(cols = 4, rows = 40), EnergyFlowRegistration.MAX_SIZE)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(EnergyFlowRegistration.isWithinBounds(EnergyFlowSize(cols = 2, rows = 4)))
        assertTrue(EnergyFlowRegistration.isWithinBounds(EnergyFlowSize(cols = 4, rows = 40)))
        assertFalse(EnergyFlowRegistration.isWithinBounds(EnergyFlowSize(cols = 1, rows = 4)))
        assertFalse(EnergyFlowRegistration.isWithinBounds(EnergyFlowSize(cols = 5, rows = 40)))
        assertFalse(EnergyFlowRegistration.isWithinBounds(EnergyFlowSize(cols = 2, rows = 41)))
        assertEquals(EnergyFlowSize(cols = 2, rows = 4), EnergyFlowRegistration.clamp(EnergyFlowSize(cols = 1, rows = 1)))
        assertEquals(EnergyFlowSize(cols = 4, rows = 40), EnergyFlowRegistration.clamp(EnergyFlowSize(cols = 9, rows = 99)))
    }

    // ---- vehicle resolution (web id = vehicleId ?? vehicles?.[0]?.id ?? 0) ----------

    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstVehicle() {
        assertEquals(5L, resolveVehicleId(5L, null))
        assertEquals(1L, resolveVehicleId(0L, listOf(vehicle(1), vehicle(2))))
        assertEquals(1L, resolveVehicleId(null, listOf(vehicle(1), vehicle(2))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    @Test
    fun firstVehicleIdReadsHeadOrNull() {
        assertEquals(7L, firstVehicleId(listOf(vehicle(7), vehicle(8))))
        assertNull(firstVehicleId(emptyList()))
        assertNull(firstVehicleId(null))
    }

    // ---- cache-then-network combiner (web id resolution → useVehicleState) ----------

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun energyFlowResourcePrefersExplicitVehicleIgnoringFleetList() =
        runTest {
            val state = VehicleStateEnvelope(state = vehicleState(power = 5.0), live = true)
            val boom = IllegalStateException("boom")
            val emissions =
                energyFlowResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = boom)),
                    preferredVehicleId = 1L,
                    stateFor = { flowOf(Resource.Success(state, fetchedAt = 100L, stale = false)) },
                ).toList()
            assertEquals(1, emissions.size)
            assertTrue(emissions.single() is Resource.Success)
            assertEquals(state, (emissions.single() as Resource.Success).data)
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun energyFlowResourceFallsBackToFirstVehicle() =
        runTest {
            val state = VehicleStateEnvelope(state = vehicleState(power = 9.0), live = true)
            val emissions =
                energyFlowResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(42)), fetchedAt = 90L, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { id -> flowOf(Resource.Success(state.copy(live = id == 42L), fetchedAt = 100L, stale = false)) },
                ).toList()
            val success = emissions.last() as Resource.Success
            assertTrue(success.data.live)
            assertEquals(state.state, success.data.state)
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun energyFlowResourceWithNoVehicleFoldsToEmptyState() =
        runTest {
            val emissions =
                energyFlowResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 90L, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { error("must not query state when no vehicle resolves") },
                ).toList()
            val success = emissions.single() as Resource.Success
            assertNull(success.data.state)
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun energyFlowResourceWithNoVehiclePreservesLoadingAndError() =
        runTest {
            val loading =
                energyFlowResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { error("no state feed without a vehicle") },
                ).toList()
            assertTrue(loading.single() is Resource.Loading)

            val boom = IllegalStateException("offline")
            val error =
                energyFlowResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = 70L, stale = true, error = boom)),
                    preferredVehicleId = null,
                    stateFor = { error("no state feed without a vehicle") },
                ).toList()
            assertTrue(error.single() is Resource.Error)
        }
}
