package io.teslasync.android.dashboard.widgets.tripsummary

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.trips.Trip
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
 * Drives [TripSummaryWidgetViewModel] over a controllable fake [TripSummarySource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) end to end through the real
 * [io.teslasync.android.data.UiState] projection, plus the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripSummaryWidgetViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource(
        var emissions: List<Resource<List<Trip>>>,
    ) : TripSummarySource {
        override fun trips(): Flow<Resource<List<Trip>>> = flow { emissions.forEach { emit(it) } }
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
            val vm = viewModel(FakeSource(listOf(loading())))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenTripsLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(listOf(trip(1)), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun emptyWhenNoTrips() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 10L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedContentWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = listOf(trip(1))
            val vm =
                viewModel(
                    FakeSource(
                        listOf(
                            Resource.Success(cached, 100L, false),
                            Resource.Error(cached, 100L, true, ApiError.Timeout()),
                        ),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedTrips() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(listOf(trip(1)), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.emissions = listOf(Resource.Success(listOf(trip(1), trip(2)), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            val refreshed = vm.state.value
            assertEquals(200L, refreshed.fetchedAt)
            assertEquals(2, refreshed.data?.size)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(listOf(loading())), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TripSummaryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(listOf(loading())), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "tripSummary.refresh" })
        }

    private fun TestScope.viewModel(
        source: TripSummarySource,
        logger: Logger = NoopLogger,
    ): TripSummaryWidgetViewModel = TripSummaryWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<List<Trip>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun trip(id: Long): Trip =
            Trip(
                id = id,
                vehicleId = 1L,
                name = "Trip $id",
                startDate = "2026-06-09T08:00:00Z",
                endDate = "2026-06-09T09:00:00Z",
                startedAt = "2026-06-09T08:00:00Z",
                endedAt = "2026-06-09T09:00:00Z",
                totalDistanceM = 10_000.0,
                totalEnergyWh = 0.0,
                totalDurationS = 0L,
                totalCost = 0.0,
                driveCount = 1L,
                chargeCount = 0L,
                createdAt = "2026-06-09T08:00:00Z",
            )
    }
}
