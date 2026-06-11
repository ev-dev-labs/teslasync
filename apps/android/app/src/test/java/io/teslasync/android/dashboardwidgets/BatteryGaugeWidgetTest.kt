package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Framework-free unit tests for the BatteryGauge widget — the default-vehicle resolution, the
 * `batteryColor()` threshold bands, the `state` → snapshot projection, the size + registry model, and
 * the ViewModel bound to the [BatteryGaugeSource] seam over a fake. They cover every state the web
 * widget renders (loading / content / empty / hard error / offline-cached) plus the refresh + retry
 * re-fetch and the one-shot `view.opened` diagnostics event — the behavior the composables only render.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryGaugeWidgetTest {
    // ── default-vehicle resolution (web `vehicleId ?? vehicles?.[0]?.id ?? 0`) ──────
    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstThenZero() {
        assertEquals(99L, BatteryGaugeProjection.resolveVehicleId(99L, listOf(vehicle(7), vehicle(9))))
        assertEquals(7L, BatteryGaugeProjection.resolveVehicleId(null, listOf(vehicle(7), vehicle(9))))
        assertEquals(BatteryGaugeProjection.NO_VEHICLE_ID, BatteryGaugeProjection.resolveVehicleId(null, emptyList()))
        assertEquals(BatteryGaugeProjection.NO_VEHICLE_ID, BatteryGaugeProjection.resolveVehicleId(null, null))
    }

    // ── threshold bands (web batteryColor strict comparisons) ───────────────────────
    @Test
    fun statusLevelMatchesWebThresholds() {
        assertEquals(BatteryStatusLevel.Good, BatteryGaugeProjection.statusLevelFor(100))
        assertEquals(BatteryStatusLevel.Good, BatteryGaugeProjection.statusLevelFor(51))
        assertEquals(BatteryStatusLevel.Warning, BatteryGaugeProjection.statusLevelFor(50))
        assertEquals(BatteryStatusLevel.Warning, BatteryGaugeProjection.statusLevelFor(21))
        assertEquals(BatteryStatusLevel.Critical, BatteryGaugeProjection.statusLevelFor(20))
        assertEquals(BatteryStatusLevel.Critical, BatteryGaugeProjection.statusLevelFor(0))
    }

    // ── state → snapshot projection (web `state ? gauge : EmptyState`) ──────────────
    @Test
    fun snapshotOfNullStateIsNull() {
        assertNull(BatteryGaugeProjection.snapshotOf(null))
    }

    @Test
    fun snapshotOfReadsLevelChargingAndBand() {
        val snapshot = BatteryGaugeProjection.snapshotOf(vehicleState(batteryLevel = 73, isCharging = true))
        assertEquals(73, snapshot?.batteryLevel)
        assertEquals(73.0, snapshot?.gaugeValue ?: 0.0, 0.0001)
        assertTrue(snapshot?.isCharging == true)
        assertEquals(BatteryStatusLevel.Good, snapshot?.statusLevel)
    }

    @Test
    fun snapshotClampsDisplayLevelButBandsOnRawValue() {
        val over = BatteryGaugeProjection.snapshotOf(vehicleState(batteryLevel = 130, isCharging = false))
        assertEquals(100, over?.batteryLevel)
        assertEquals(BatteryStatusLevel.Good, over?.statusLevel)

        val under = BatteryGaugeProjection.snapshotOf(vehicleState(batteryLevel = -5, isCharging = false))
        assertEquals(0, under?.batteryLevel)
        assertEquals(BatteryStatusLevel.Critical, under?.statusLevel)
    }

    // ── size + registry model ───────────────────────────────────────────────────────
    @Test
    fun sizeIsCompactOnlyAtOneByOne() {
        assertTrue(BatteryGaugeSize(1, 1).isCompact)
        assertFalse(BatteryGaugeSize(1, 2).isCompact)
        assertFalse(BatteryGaugeSize(2, 40).isCompact)
    }

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("battery-gauge", BatteryGaugeRegistration.ID)
        assertEquals("battery", BatteryGaugeRegistration.CATEGORY)
        assertEquals("BatteryGaugeWidget", BatteryGaugeRegistration.SLUG)
        assertEquals(BatteryGaugeSize(1, 2), BatteryGaugeRegistration.DEFAULT_SIZE)
        assertEquals(BatteryGaugeSize(1, 2), BatteryGaugeRegistration.MIN_SIZE)
        assertEquals(BatteryGaugeSize(2, 40), BatteryGaugeRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClamp() {
        assertTrue(BatteryGaugeRegistration.isWithinBounds(BatteryGaugeSize(1, 2)))
        assertTrue(BatteryGaugeRegistration.isWithinBounds(BatteryGaugeSize(2, 40)))
        assertFalse(BatteryGaugeRegistration.isWithinBounds(BatteryGaugeSize(3, 2)))
        assertFalse(BatteryGaugeRegistration.isWithinBounds(BatteryGaugeSize(1, 1)))
        assertEquals(BatteryGaugeSize(2, 40), BatteryGaugeRegistration.clamp(BatteryGaugeSize(9, 99)))
        assertEquals(BatteryGaugeSize(1, 2), BatteryGaugeRegistration.clamp(BatteryGaugeSize(0, 0)))
    }

    // ── ViewModel: content / empty / hard error / offline / refresh / telemetry ─────
    @Test
    fun loadsContentForTheResolvedVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(7), vehicle(9)))),
                    stateByVehicle = { id -> if (id == 7L) listOf(envelope(72, false)) else listOf(noState()) },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            val state = vm.battery.value
            assertEquals(UiPhase.Content, state.phase)
            val snapshot = BatteryGaugeProjection.snapshotOf(state.data?.state)
            assertEquals(72, snapshot?.batteryLevel)
            assertTrue(source.requestedVehicleIds.contains(7L))
        }

    @Test
    fun explicitVehicleIdWinsOverFirstEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(7)))),
                    stateByVehicle = { id -> if (id == 42L) listOf(envelope(30, true)) else listOf(noState()) },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope, explicitVehicleId = 42L)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.battery.value.phase)
            assertTrue(source.requestedVehicleIds.all { it == 42L })
        }

    @Test
    fun absentStateIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(1)))),
                    stateByVehicle = { listOf(noState()) },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.battery.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(1)))),
                    stateByVehicle = { listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())) },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            val state = vm.battery.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.hasError)
            assertFalse(state.hasData)
        }

    @Test
    fun offlineKeepsCachedReadingWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = VehicleStateEnvelope(state = vehicleState(58, false), live = false)
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(1)))),
                    stateByVehicle = {
                        listOf(Resource.Error(cached = cached, fetchedAt = 100L, stale = true, error = ApiError.Network()))
                    },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            val state = vm.battery.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            val cachedSnapshot = BatteryGaugeProjection.snapshotOf(state.data?.state)
            assertEquals(58, cachedSnapshot?.batteryLevel)
        }

    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(1)))),
                    stateByVehicle = { listOf(envelope(50, false)) },
                )
            val logger = RecordingLogger()
            val vm = BatteryGaugeWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()
            assertEquals(1, source.vehiclesCalls)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2, source.vehiclesCalls)
            assertTrue(logger.records.any { it.first == "batteryGauge.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeBatteryGaugeSource(
                    vehiclesEmissions = listOf(success(listOf(vehicle(1)))),
                    stateByVehicle = { listOf(envelope(50, false)) },
                )
            val vm = BatteryGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.battery.collect {} }
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            assertEquals(2, source.vehiclesCalls)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeBatteryGaugeSource(vehiclesEmissions = emptyList(), stateByVehicle = { emptyList() })
            val vm = BatteryGaugeWidgetViewModel(source, logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BatteryGaugeWidget", opened.first().second["slug"])
        }

    // ── helpers ──────────────────────────────────────────────────────────────────────
    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun envelope(
        batteryLevel: Long,
        isCharging: Boolean,
    ): Resource<VehicleStateEnvelope> =
        Resource.Success(VehicleStateEnvelope(state = vehicleState(batteryLevel, isCharging), live = true), fetchedAt = 100L, stale = false)

    private fun noState(): Resource<VehicleStateEnvelope> =
        Resource.Success(VehicleStateEnvelope(state = null, live = false), fetchedAt = 100L, stale = false)

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = EPOCH,
            displayName = "Car $id",
            enrolledAt = EPOCH,
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = EPOCH,
            vin = "VIN$id",
        )

    private fun vehicleState(
        batteryLevel: Long,
        isCharging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 18.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2024.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )

    /**
     * A controllable fake [BatteryGaugeSource]: [vehicles] replays a configured emission list (and counts
     * its collections so a refresh is observable), and [vehicleState] records the requested ids and replays
     * the per-vehicle emissions the test supplies. Re-collection (refresh/retry) yields a fresh stream, so a
     * manual refresh genuinely re-fetches.
     */
    private class FakeBatteryGaugeSource(
        private val vehiclesEmissions: List<Resource<List<Vehicle>>>,
        private val stateByVehicle: (Long) -> List<Resource<VehicleStateEnvelope>>,
    ) : BatteryGaugeSource {
        var vehiclesCalls = 0
            private set
        val requestedVehicleIds = mutableListOf<Long>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            vehiclesCalls++
            return vehiclesEmissions.asFlow()
        }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            requestedVehicleIds.add(vehicleId)
            return stateByVehicle(vehicleId).asFlow()
        }
    }

    /** A [Logger] that records every event + fields, for telemetry assertions. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(event to fields)
        }
    }

    private companion object {
        val EPOCH: Instant = Instant.fromEpochMilliseconds(0)
    }
}
