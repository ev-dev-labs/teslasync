package io.teslasync.android.dashboard.widgets.driveefficiencychart

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
 * Drives [DriveEfficiencyChartWidgetViewModel] over a controllable fake [DriveEfficiencyChartSource],
 * covering the full cache-then-network state matrix the web component renders (loading / content /
 * empty / hard error + retry / stale-offline + retry / refresh re-fetch) and the PII-safe
 * `view.opened` + refresh diagnostics.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveEfficiencyChartWidgetViewModelTest {
    private val drives = listOf(drive(id = 1), drive(id = 2))

    private class FakeSource(
        var emissions: List<Resource<List<Drive>>>,
    ) : DriveEfficiencyChartSource {
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
    fun contentWhenDrivesPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(drives, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(drives, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoDrives() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
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
            val src = FakeSource(listOf(Resource.Success(drives, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(drives, vm.state.value.data)

            src.emissions = listOf(Resource.Error(drives, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(drives, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun retryReFetchesUpdatedRows() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = listOf(drive(id = 3))
            val src = FakeSource(listOf(Resource.Success(drives, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(drives, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.retry()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "DriveEfficiencyChartWidget"), opened.single().second)
        }

    @Test
    fun retryEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "driveEfficiencyChart.retry" })
        }

    private fun TestScope.viewModel(
        source: DriveEfficiencyChartSource,
        logger: Logger = NoopLogger,
    ): DriveEfficiencyChartWidgetViewModel = DriveEfficiencyChartWidgetViewModel(source, logger, backgroundScope)

    private fun drive(id: Long): Drive =
        Drive(
            createdAt = Instant.fromEpochMilliseconds(id),
            distanceM = 10_000.0,
            durationS = 600L,
            id = id,
            startTs = Instant.fromEpochMilliseconds(id),
            updatedAt = Instant.fromEpochMilliseconds(id),
            vehicleId = 1L,
            energyUsedWh = 1_500.0,
            startBatteryPct = 80,
            endBatteryPct = 70,
        )
}
