package io.teslasync.android.featureviews.securitysection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SecuritySectionViewModel] over a fake [SecuritySectionSource], plus the [securitySectionResource]
 * cache-then-network adapter directly — covering every state the surface renders (loading / content / empty /
 * hard error / offline-cached), the active-vehicle resolution (preferred id vs. first enrolled), the refresh +
 * retry re-fetch, and the one-shot `view.opened` diagnostic. Run by the offline `:android:testReleaseUnitTest`
 * gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecuritySectionViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromSecurityEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    security = listOf(securitySuccess(event())),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data!!.hasEvent)
        }

    @Test
    fun noSecurityEventIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    security = listOf(securitySuccess(JsonNull)),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun securityLoadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    security = listOf(securityLoading()),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    security = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSnapshotWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    security =
                        listOf(
                            Resource.Error(cached = event(), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data!!.hasEvent)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(emptyList())),
                    security = listOf(securitySuccess(event())),
                )
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsSecurityAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), security = listOf(securitySuccess(event())))
            val vm = SecuritySectionViewModel(source, logger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.securityCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.securityCalls > before)
            assertTrue(logger.records.any { it.event == "securitySection.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), security = listOf(securitySuccess(event())))
            val vm = SecuritySectionViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.securityCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.securityCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = SecuritySectionViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SecuritySection", opened.first().fields["surface"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsFeedsDirectly() =
        runTest {
            val result =
                securitySectionResource(
                    vehicles = flowOf(successVehicles(emptyList())),
                    preferredVehicleId = 2L,
                    securityFor = { flowOf(securitySuccess(event())) },
                    stateFor = { flowOf(successState(env())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached!!.hasEvent)
        }

    @Test
    fun adapterResolvesFirstVehicle() =
        runTest {
            val result =
                securitySectionResource(
                    vehicles = flowOf(successVehicles(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    securityFor = { flowOf(securitySuccess(event())) },
                    stateFor = { flowOf(successState(env())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached!!.hasEvent)
        }

    @Test
    fun adapterEmitsEmptySnapshotWhenFleetEmpty() =
        runTest {
            val result =
                securitySectionResource(
                    vehicles = flowOf(successVehicles(emptyList())),
                    preferredVehicleId = null,
                    securityFor = { flowOf(securitySuccess(event())) },
                    stateFor = { flowOf(successState(env())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(SecuritySectionProjection.isEmptySnapshot(result.cached))
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                securitySectionResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    securityFor = { flowOf(securitySuccess(event())) },
                    stateFor = { flowOf(successState(env())) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                securitySectionResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    securityFor = { flowOf(securitySuccess(event())) },
                    stateFor = { flowOf(successState(env())) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val security: List<Resource<JsonElement>>,
        private val state: List<Resource<VehicleStateEnvelope>> = listOf(successState(env())),
    ) : SecuritySectionSource {
        var securityCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> {
            securityCalls++
            return security.asFlow()
        }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = state.asFlow()
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        fun event(): JsonElement =
            buildJsonObject {
                put("door_state", "df_closed")
                put("fd_window", true)
            }

        fun securitySuccess(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

        fun securityLoading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun successVehicles(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

        fun successState(envelope: VehicleStateEnvelope): Resource<VehicleStateEnvelope> =
            Resource.Success(envelope, fetchedAt = 100L, stale = false)

        fun env(): VehicleStateEnvelope = VehicleStateEnvelope(state = vehicleState(), live = false)

        fun vehicleState(): VehicleState =
            VehicleState(
                batteryLevel = 80,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 21.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 15.0,
                power = 0.0,
                ratedRange = 0.0,
                sentryMode = false,
                softwareVersion = "2025.0",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 1L,
            )

        fun vehicle(id: Long): Vehicle =
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
}
