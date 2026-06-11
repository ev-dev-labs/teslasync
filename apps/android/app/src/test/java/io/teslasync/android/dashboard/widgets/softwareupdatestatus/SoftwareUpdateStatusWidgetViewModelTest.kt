package io.teslasync.android.dashboard.widgets.softwareupdatestatus

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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Tests [SoftwareUpdateStatusWidgetViewModel] against the [SoftwareUpdateStatusSource] seam with a fake
 * feed, plus the [softwareUpdateResource] + [mergeSoftwareUpdate] adapters directly — covering every state
 * the web widget renders (loading / content / empty / hard error / offline-cached), the state-primary
 * freshness contract (a config first-load widens the skeleton; a config failure degrades to "up to date"),
 * the active-vehicle resolution, the refresh + retry re-fetch, and the one-shot `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftwareUpdateStatusWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            successState(envelope(state("2024.8.9"))),
                        ),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data?.hasState == true)
            assertEquals("2024.8.9", ui.data?.currentVersion)
            assertEquals("2024.12.1", ui.data?.updateVersion)
        }

    @Test
    fun noDecodableStateIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(successState(envelope(null))),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), state = emptyList(), config = emptyList())
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    state = emptyList(),
                    config = emptyList(),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun configFirstLoadWidensSkeleton() =
        runTest(UnconfinedTestDispatcher()) {
            // web `isLoading = stateLoading || configLoading`: state ready but config still on first load.
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(successState(envelope(state("2024.8.9")))),
                    config = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedStateWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state =
                        listOf(
                            Resource.Error(
                                cached = envelope(state("2024.8.9")),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals("2024.8.9", ui.data?.currentVersion)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun configFailureDegradesToUpToDate() =
        runTest(UnconfinedTestDispatcher()) {
            // web: a failed `useVehicleConfigLatest` ⇒ configData undefined ⇒ no update ⇒ content "up to date".
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(successState(envelope(state("2024.8.9")))),
                    config = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data?.hasState == true)
            assertNull(ui.data?.updateVersion)
            assertFalse(ui.hasError)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    state = listOf(successState(envelope(state("2024.8.9")))),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsFeedsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeSource(
                    vehicles = emptyList(),
                    state = listOf(successState(envelope(state("2024.8.9")))),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
            assertTrue(logger.records.any { it.event == "softwareUpdateStatus.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = emptyList(),
                    state = listOf(successState(envelope(state("2024.8.9")))),
                    config = listOf(successJson(configObject("2024.12.1"))),
                )
            val vm = SoftwareUpdateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.configCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.configCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = SoftwareUpdateStatusWidgetViewModel(FakeSource(emptyList(), emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SoftwareUpdateStatusWidget", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsFeedsDirectly() =
        runTest {
            val result =
                softwareUpdateResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = 2L,
                    stateFor = { flowOf(successState(envelope(state("2024.8.9")))) },
                    configFor = { flowOf(successJson(configObject("2024.12.1"))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.hasState == true)
            assertEquals("2024.12.1", result.cached?.updateVersion)
        }

    @Test
    fun adapterResolvesFirstVehicleForFeeds() =
        runTest {
            val result =
                softwareUpdateResource(
                    vehicles = flowOf(success(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    stateFor = { id -> flowOf(successState(envelope(state(if (id == 7L) "2024.8.9" else "x")))) },
                    configFor = { flowOf(successJson(JsonNull)) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals("2024.8.9", result.cached?.currentVersion)
        }

    @Test
    fun adapterEmitsNoVehicleEmptyWhenFleetEmpty() =
        runTest {
            val result =
                softwareUpdateResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(envelope(state("2024.8.9")))) },
                    configFor = { flowOf(successJson(configObject("2024.12.1"))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached?.hasState ?: true)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                softwareUpdateResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(envelope(state("2024.8.9")))) },
                    configFor = { flowOf(successJson(configObject("2024.12.1"))) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                softwareUpdateResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(envelope(state("2024.8.9")))) },
                    configFor = { flowOf(successJson(configObject("2024.12.1"))) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── merge: state-primary freshness contract ──────────────────────────────────
    @Test
    fun mergeIgnoresConfigErrorWhenStateSucceeds() {
        val merged =
            mergeSoftwareUpdate(
                successState(envelope(state("2024.8.9"))),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        assertTrue(merged is Resource.Success)
        assertNull(merged.cached?.updateVersion)
    }

    @Test
    fun mergeConfigFirstLoadIsLoading() {
        val merged =
            mergeSoftwareUpdate(
                successState(envelope(state("2024.8.9"))),
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(merged is Resource.Loading)
    }

    @Test
    fun mergeStateFirstLoadIsLoading() {
        val merged =
            mergeSoftwareUpdate(
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
                successJson(configObject("2024.12.1")),
            )
        assertTrue(merged is Resource.Loading)
    }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val state: List<Resource<VehicleStateEnvelope>>,
        private val config: List<Resource<JsonElement>>,
    ) : SoftwareUpdateStatusSource {
        var stateCalls = 0
            private set
        var configCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            stateCalls++
            return state.asFlow()
        }

        override fun vehicleConfig(vehicleId: Long): Flow<Resource<JsonElement>> {
            configCalls++
            return config.asFlow()
        }
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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun successState(envelope: VehicleStateEnvelope): Resource<VehicleStateEnvelope> =
        Resource.Success(envelope, fetchedAt = 100L, stale = false)

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun configObject(updateVersion: String): JsonObject =
        buildJsonObject {
            put("software_update_version", updateVersion)
            put("software_update_download_pct", 40.0)
        }

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun state(softwareVersion: String): VehicleState =
        VehicleState(
            batteryLevel = 72,
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
            ratedRange = 350.0,
            sentryMode = false,
            softwareVersion = softwareVersion,
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
}
