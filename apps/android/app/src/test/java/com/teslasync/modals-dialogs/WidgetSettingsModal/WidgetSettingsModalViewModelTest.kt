// Off-device unit coverage for the WidgetSettingsModal view-model — the cache-then-network state matrix the vehicle
// dropdown renders (loading / content / empty / hard error + retry / stale-offline + retry / refresh re-fetch) plus the
// PII-safe `view.opened` + `refresh` diagnostics. Drives [WidgetSettingsModalViewModel] over a controllable fake
// [WidgetSettingsVehiclesSource]; no Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class WidgetSettingsModalViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : WidgetSettingsVehiclesSource {
        var emissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { emissions.forEach { emit(it) } }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingWhileVehiclesListLoadsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.vehicles.value.phase)
        }

    @Test
    fun contentWhenVehiclesResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(listOf(vehicle(5), vehicle(9)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.vehicles.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenVehiclesFailWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedVehiclesWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(listOf(vehicle(5)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.vehicles.value.phase)

            src.emissions = listOf(Resource.Error(listOf(vehicle(5)), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun refreshReFetchesUpdatedVehicles() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(listOf(vehicle(5)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.vehicles.collect {} }
            advanceUntilIdle()
            val seeded = vm.vehicles.value
            assertEquals(1, seeded.data?.size)

            src.emissions = listOf(Resource.Success(listOf(vehicle(5), vehicle(9), vehicle(11)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.vehicles.value
            assertEquals(3, state.data?.size)
            assertEquals(200L, state.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "WidgetSettingsModal"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEventWithNoPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "widgetSettings.refreshVehicles" })
            assertFalse(logger.events.any { it.second.containsKey("vehicle") })
        }

    private fun TestScope.viewModel(
        source: WidgetSettingsVehiclesSource,
        logger: Logger = NoopLogger,
    ): WidgetSettingsModalViewModel = WidgetSettingsModalViewModel(source, logger, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
