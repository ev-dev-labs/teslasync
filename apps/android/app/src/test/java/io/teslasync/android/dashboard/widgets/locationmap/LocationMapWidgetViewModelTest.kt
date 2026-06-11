package io.teslasync.android.dashboard.widgets.locationmap

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
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
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [LocationMapWidgetViewModel] over a controllable fake [LocationMapSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content with a real fix / empty
 * with no fix / empty with a 0,0 reading / hard error + retry / stale-offline + retry / refresh
 * re-fetch) and the PII-safe `view.opened` + refresh diagnostics. The web combined `!hasCoords` gate is
 * exercised both ways: a `null` reading AND a present `0,0` reading both map to empty, while a reading
 * with real coordinates maps to content.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationMapWidgetViewModelTest {
    private val located = VehicleLocationData(latitude = 37.5, longitude = -122.25, heading = 270.0, isLive = true)
    private val zeroFix = VehicleLocationData(latitude = 0.0, longitude = 0.0, heading = null, isLive = false)

    private class FakeSource(
        var emissions: List<Resource<VehicleLocationData?>>,
    ) : LocationMapSource {
        override fun stream(): Flow<Resource<VehicleLocationData?>> = flow { emissions.forEach { emit(it) } }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenFixResolved() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(located, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(located, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNullReading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success<VehicleLocationData?>(null, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenZeroCoordinateReading() =
        runTest(UnconfinedTestDispatcher()) {
            // A present-but-0,0 reading is the web `!hasCoords` empty map, NOT content.
            val vm = viewModel(FakeSource(listOf(Resource.Success<VehicleLocationData?>(zeroFix, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedFixWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(located, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(located, vm.state.value.data)

            src.emissions = listOf(Resource.Error(located, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(located, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedFix() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = located.copy(latitude = 40.0, longitude = -74.0, heading = 90.0)
            val src = FakeSource(listOf(Resource.Success(located, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(located, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "LocationMapWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "locationMap.refresh" })
        }

    @Test
    fun recordViewOpenedCarriesNoLocationFields() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()

            val fields = logger.events.single { it.first == "view.opened" }.second
            // PII-safe: only the surface slug, never coordinates / heading / vehicle id.
            assertEquals(mapOf("surface" to "LocationMapWidget"), fields)
        }

    private fun TestScope.viewModel(
        source: LocationMapSource,
        logger: Logger = NoopLogger,
    ): LocationMapWidgetViewModel = LocationMapWidgetViewModel(source, logger, backgroundScope)
}
