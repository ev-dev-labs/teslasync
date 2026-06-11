package io.teslasync.android.dashboard.widgets.locationfavorites

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.locations.VisitedLocation
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
 * Drives [LocationFavoritesWidgetViewModel] over a controllable fake [LocationFavoritesSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content with rows /
 * content with a badge but no rows / empty with nothing / hard error + retry / stale-offline + retry /
 * refresh re-fetch) and the PII-safe `view.opened` + refresh diagnostics. A badge-only payload (a
 * snapshot with no rows) maps to content, NOT empty — only a payload with neither rows nor a snapshot is
 * the empty surface.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationFavoritesWidgetViewModelTest {
    private fun loc(
        id: Long,
        name: String,
        visits: Long,
    ): VisitedLocation =
        VisitedLocation(
            id = id,
            vehicleId = 1L,
            addressName = name,
            visitCount = visits,
            createdAt = "2026-01-01T00:00:00Z",
        )

    private val withRows = LocationFavoritesData(listOf(loc(1, "Garage", 5)), null)
    private val badgeOnly =
        LocationFavoritesData(
            emptyList(),
            LocationStatusSnapshot(null, locatedAtHome = true, locatedAtWork = false, locatedAtFavorite = false),
        )

    private class FakeSource(
        var emissions: List<Resource<LocationFavoritesData>>,
    ) : LocationFavoritesSource {
        override fun stream(): Flow<Resource<LocationFavoritesData>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenRowsResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(withRows, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withRows, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun contentWhenBadgeOnlyNoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(badgeOnly, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // A snapshot with no rows still shows the location badge — content, not the empty surface.
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNothingResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(LocationFavoritesData.EMPTY, 100L, false))))
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
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(withRows, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withRows, vm.state.value.data)

            src.emissions = listOf(Resource.Error(withRows, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withRows, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedData() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = LocationFavoritesData(listOf(loc(2, "Office", 9)), null)
            val src = FakeSource(listOf(Resource.Success(withRows, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withRows, vm.state.value.data)

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
            assertEquals(mapOf("surface" to "LocationFavoritesWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "locationFavorites.refresh" })
        }

    private fun TestScope.viewModel(
        source: LocationFavoritesSource,
        logger: Logger = NoopLogger,
    ): LocationFavoritesWidgetViewModel = LocationFavoritesWidgetViewModel(source, logger, backgroundScope)
}
