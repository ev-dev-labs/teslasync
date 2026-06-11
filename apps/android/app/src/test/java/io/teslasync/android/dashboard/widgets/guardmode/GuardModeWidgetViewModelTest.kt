package io.teslasync.android.dashboard.widgets.guardmode

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
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
 * Drives [GuardModeWidgetViewModel] over a controllable fake [GuardModeSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic, the
 * refresh event, and the store-refresh wiring — end to end through the real [io.teslasync.android.data.UiState]
 * projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GuardModeWidgetViewModelTest {
    private val armed = snapshot(enabled = true, eventCount = 2)
    private val disarmed = snapshot(enabled = false, eventCount = 0)
    private val emptySnapshot = GuardModeSnapshot(config = null, events = emptyList())

    private class FakeSource(
        var emissions: List<Resource<GuardModeSnapshot>>,
    ) : GuardModeSource {
        var refreshCount = 0

        override fun stream(): Flow<Resource<GuardModeSnapshot>> = flow { emissions.forEach { emit(it) } }

        override fun refresh() {
            refreshCount++
        }
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
    fun contentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(armed, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(armed, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoGuardConfig() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptySnapshot, 100L, false))))
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
            val src = FakeSource(listOf(Resource.Success(armed, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(armed, vm.state.value.data)

            src.emissions = listOf(Resource.Error(armed, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(armed, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSnapshotAndForcesStoreRefresh() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(armed, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(armed, vm.state.value.data)

            src.emissions = listOf(Resource.Success(disarmed, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(disarmed, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
            // refresh() must force a genuine store re-fetch (web refetchConfig() + refetchEvents()).
            assertEquals(1, src.refreshCount)
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
            assertEquals(mapOf("surface" to "GuardModeWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "guardMode.refresh" })
        }

    private fun TestScope.viewModel(
        source: GuardModeSource,
        logger: Logger = NoopLogger,
    ): GuardModeWidgetViewModel = GuardModeWidgetViewModel(source, logger, backgroundScope)

    private fun snapshot(
        enabled: Boolean,
        eventCount: Int,
    ): GuardModeSnapshot =
        GuardModeSnapshot(
            config =
                GuardConfig(
                    vehicleId = 1L,
                    enabled = enabled,
                    homeGeofenceId = null,
                    sensitivity = "medium",
                    autoPanic = false,
                    createdAt = "2026-06-01T00:00:00Z",
                    updatedAt = "2026-06-06T12:00:00Z",
                ),
            events =
                (1..eventCount).map {
                    GuardEvent(
                        id = it.toLong(),
                        vehicleId = 1L,
                        ts = "2026-06-06T12:0$it:00Z",
                        eventType = "sentry_triggered",
                    )
                },
        )
}
