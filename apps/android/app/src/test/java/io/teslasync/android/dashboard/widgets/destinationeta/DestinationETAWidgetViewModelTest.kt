package io.teslasync.android.dashboard.widgets.destinationeta

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
 * Drives [DestinationETAWidgetViewModel] over a controllable fake [DestinationETASource], covering the
 * full cache-then-network state matrix the web component renders (loading / content while navigating /
 * content while idle-at-a-place / empty with no snapshot / hard error + retry / stale-offline + retry /
 * refresh re-fetch) and the PII-safe `view.opened` + refresh diagnostics. A present-but-idle snapshot
 * maps to content (the web location badge), NOT to empty — only a `null` snapshot is the empty surface.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DestinationETAWidgetViewModelTest {
    private val navigating =
        LocationSnapshotData(
            destinationName = "Tesla HQ",
            distanceToArrivalMeters = 5_000.0,
            minutesToArrival = 90.0,
            locatedAtHome = false,
            locatedAtWork = false,
            locatedAtFavorite = false,
        )

    private val idleAtHome =
        LocationSnapshotData(
            destinationName = null,
            distanceToArrivalMeters = 0.0,
            minutesToArrival = 0.0,
            locatedAtHome = true,
            locatedAtWork = false,
            locatedAtFavorite = false,
        )

    private class FakeSource(
        var emissions: List<Resource<LocationSnapshotData?>>,
    ) : DestinationETASource {
        override fun stream(): Flow<Resource<LocationSnapshotData?>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenNavigating() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(navigating, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(navigating, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun contentWhenIdleAtAPlace() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(idleAtHome, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // A resolved-but-not-navigating snapshot still shows the location badge — it is content,
            // never the empty surface (web parity: the badge renders without an active route).
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNullSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success<LocationSnapshotData?>(null, 100L, false))))
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
            val src = FakeSource(listOf(Resource.Success(navigating, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(navigating, vm.state.value.data)

            src.emissions = listOf(Resource.Error(navigating, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(navigating, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = navigating.copy(destinationName = "Supercharger", minutesToArrival = 12.0)
            val src = FakeSource(listOf(Resource.Success(navigating, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(navigating, vm.state.value.data)

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
            assertEquals(mapOf("surface" to "DestinationETAWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "destinationETA.refresh" })
        }

    private fun TestScope.viewModel(
        source: DestinationETASource,
        logger: Logger = NoopLogger,
    ): DestinationETAWidgetViewModel = DestinationETAWidgetViewModel(source, logger, backgroundScope)
}
