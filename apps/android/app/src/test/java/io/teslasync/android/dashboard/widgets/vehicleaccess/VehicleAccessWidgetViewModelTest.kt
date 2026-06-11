package io.teslasync.android.dashboard.widgets.vehicleaccess

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [VehicleAccessWidgetViewModel] over a controllable fake [VehicleAccessSource], covering the
 * cache-then-network state matrix the web component renders (loading / content / empty / offline-cached /
 * error-without-blanking), the active-vehicle resolution (first enrolled vs. preferred prop id), the
 * refresh + retry re-collection, and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleAccessWidgetViewModelTest {
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(drivers = listOf(success(listOf(driver()))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.drivers?.size)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(success(emptyList()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), drivers = listOf(success(listOf(driver()))))
            val vm = viewModel(source, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun contentWhenOnlyMobileKnown() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(mobile = listOf(success(mobileEnvelope(false))))
            val vm = viewModel(source, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(false, ui.data?.mobileEnabled)
        }

    @Test
    fun offlineKeepsCachedDriversWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    drivers =
                        listOf(
                            Resource.Error(cached = listOf(driver()), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                )
            val vm = viewModel(source, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(1, ui.data?.drivers?.size)
        }

    @Test
    fun hardErrorWithoutCacheIsEmptyNotErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    drivers = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = viewModel(source, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertTrue(ui.hasError)
            assertEquals(ErrorKind.Network, ui.errorKind)
        }

    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(drivers = listOf(success(listOf(driver()))))
            val vm = viewModel(source, logger = logger, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.driverCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.driverCalls > before)
            assertTrue(logger.records.any { it.event == "vehicleAccess.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(drivers = listOf(success(listOf(driver()))))
            val vm = viewModel(source, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.driverCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.driverCalls > before)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VehicleAccessWidget", opened.single().fields["surface"])
        }

    @Test
    fun refreshDiagnosticCarriesNoAccessPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger, vehicleId = 1L)

            vm.refresh()

            assertTrue(logger.records.any { it.event == "vehicleAccess.refresh" })
            assertFalse(logger.records.any { it.fields.containsKey("driver") })
            assertFalse(logger.records.any { it.fields.containsKey("email") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>> = listOf(Resource.Success(listOf(car()), 100L, false)),
        private val drivers: List<Resource<List<VehicleDriver>>> = listOf(Resource.Success(emptyList(), 100L, false)),
        private val invitations: List<Resource<List<VehicleInvitation>>> = listOf(Resource.Success(emptyList(), 100L, false)),
        private val mobile: List<Resource<JsonElement>> = listOf(Resource.Success(unknownEnvelope(), 100L, false)),
    ) : VehicleAccessSource {
        var driverCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun drivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> {
            driverCalls++
            return drivers.asFlow()
        }

        override fun invitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> = invitations.asFlow()

        override fun mobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> = mobile.asFlow()

        private companion object {
            fun car(): Vehicle =
                Vehicle(
                    createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                    displayName = "Car 1",
                    enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                    id = 1,
                    teslaId = 1001,
                    timezone = "UTC",
                    updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                    vin = "VIN1",
                )

            fun unknownEnvelope(): JsonElement = buildJsonObject { put("data", buildJsonObject {}) }
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

    private fun TestScope.viewModel(
        source: VehicleAccessSource,
        logger: Logger = RecordingLogger(),
        vehicleId: Long? = null,
    ): VehicleAccessWidgetViewModel = VehicleAccessWidgetViewModel(source, logger, backgroundScope, vehicleId)

    private fun driver(): VehicleDriver =
        VehicleDriver(
            id = 1,
            vehicleId = 1,
            driverEmail = "ada@example.com",
            driverName = "Ada Lovelace",
            role = "owner",
            fetchedAt = "2024-05-10T09:00:00Z",
        )

    private fun mobileEnvelope(enabled: Boolean): JsonElement =
        buildJsonObject {
            put("data", buildJsonObject { put("enabled", enabled) })
        }

    private fun <T> success(
        value: T,
        at: Long = 100L,
    ): Resource<T> = Resource.Success(value, fetchedAt = at, stale = false)
}
