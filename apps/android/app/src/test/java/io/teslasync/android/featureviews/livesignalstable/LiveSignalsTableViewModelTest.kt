package io.teslasync.android.featureviews.livesignalstable

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [LiveSignalsTableViewModel] over a controllable fake [LiveSignalsTableSource], covering the
 * cache-then-network state matrix the web component renders from its `useVehicleLiveSignals` prop source: the
 * no-vehicle empty branch (web disabled query), the loading / data / hard-error / stale-offline freshness,
 * the HTTP error classification, the refresh re-fetch, and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSignalsTableViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : LiveSignalsTableSource {
        val emissions = mutableMapOf<Long, List<Resource<VehicleLiveSignalsResponse>>>()

        override fun vehicleLiveSignals(vehicleId: Long): Flow<Resource<VehicleLiveSignalsResponse>> =
            flow { (emissions[vehicleId] ?: listOf(loading())).forEach { emit(it) } }
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
    fun emptyWhenNoVehicleSelected() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(), vehicleId = 0)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(LiveSignalsTableState.EMPTY, vm.state.value)
        }

    @Test
    fun loadingFreshnessWhileFetching() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(loading())
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isFetching)
            assertNull(vm.state.value.response)
        }

    @Test
    fun dataWhenFeedResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(Resource.Success(sampleResponse(), 100L, false))
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.response)
            assertEquals(100L, state.updatedAtMillis)
            assertFalse(state.isFetching)
            assertFalse(state.isError)
            assertNull(state.errorKind)
        }

    @Test
    fun hardErrorWithNoCacheClassifiesKind() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isError)
            assertNull(state.response)
            assertEquals(QueryErrorKind.Network, state.errorKind)
        }

    @Test
    fun staleOfflineKeepsCachedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(Resource.Error(sampleResponse(), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.response)
            assertTrue(state.isStale)
            assertTrue(state.isError)
            assertEquals(100L, state.updatedAtMillis)
        }

    @Test
    fun httpServerErrorMapsToServerErrorKind() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(Resource.Error(null, null, false, ApiError.Http(503)))
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(QueryErrorKind.ServerError, vm.state.value.errorKind)
        }

    @Test
    fun refreshReFetchesFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions[5] = listOf(Resource.Success(sampleResponse(), 100L, false))
            val vm = viewModel(src, vehicleId = 5)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.updatedAtMillis)

            src.emissions[5] = listOf(Resource.Success(sampleResponse(), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.updatedAtMillis)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger, vehicleId = 5)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "LiveSignalsTable"), opened.single().second)
        }

    @Test
    fun refreshEmitsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger, vehicleId = 5)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "liveSignalsTable.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("value") })
        }

    private fun TestScope.viewModel(
        source: LiveSignalsTableSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): LiveSignalsTableViewModel = LiveSignalsTableViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loading(): Resource<VehicleLiveSignalsResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun sampleResponse(): VehicleLiveSignalsResponse =
            VehicleLiveSignalsResponse(vehicleId = 5L, signals = mapOf("Gear" to JsonPrimitive("D")))
    }
}
