package io.teslasync.android.dashboard.widgets.recentdriveslist

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Drive
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
import kotlin.time.Instant

/**
 * Drives [RecentDrivesListWidgetViewModel] over a controllable fake [RecentDrivesListSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content / empty / hard
 * error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic
 * and the refresh event — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentDrivesListWidgetViewModelTest {
    private val respA = listOf(drive(1))
    private val respB = listOf(drive(2), drive(3))
    private val emptyResp = emptyList<Drive>()

    private class FakeSource(
        var emissions: List<Resource<List<Drive>>>,
    ) : RecentDrivesListSource {
        override fun stream(): Flow<Resource<List<Drive>>> = flow { emissions.forEach { emit(it) } }
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
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(respA, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoDrives() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyResp, 100L, false))))
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
            val src = FakeSource(listOf(Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(respA, vm.state.value.data)

            src.emissions = listOf(Resource.Error(respA, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(respA, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedDrives() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(respA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(respA, vm.state.value.data)

            src.emissions = listOf(Resource.Success(respB, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(respB, vm.state.value.data)
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
            assertEquals(mapOf("surface" to "RecentDrivesListWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "recentDrivesList.refresh" })
        }

    private fun TestScope.viewModel(
        source: RecentDrivesListSource,
        logger: Logger = NoopLogger,
    ): RecentDrivesListWidgetViewModel = RecentDrivesListWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun drive(id: Long): Drive =
            Drive(
                createdAt = Instant.fromEpochMilliseconds(id),
                distanceM = 10_000.0,
                durationS = 600L,
                id = id,
                startTs = Instant.fromEpochMilliseconds(id),
                updatedAt = Instant.fromEpochMilliseconds(id),
                vehicleId = 1L,
                startBatteryPct = 80,
                endBatteryPct = 70,
            )
    }
}
