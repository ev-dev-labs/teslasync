package io.teslasync.android.dashboard.widgets.drivetelemetry

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
 * Drives [DriveTelemetryWidgetViewModel] over a controllable fake [DriveTelemetrySource], covering the
 * full cache-then-network state matrix the web component renders (loading / content with a drive /
 * empty with no recent drive / hard error + retry / stale-offline + retry / refresh re-fetch) and the
 * PII-safe `view.opened` + refresh diagnostics — end to end through the real projection's empty gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveTelemetryWidgetViewModelTest {
    private val withDrive = DriveTelemetrySnapshot(drive(id = 1), emptyList())
    private val noDrive = DriveTelemetrySnapshot(drive = null)

    private class FakeSource(
        var emissions: List<Resource<DriveTelemetrySnapshot>>,
    ) : DriveTelemetrySource {
        override fun stream(): Flow<Resource<DriveTelemetrySnapshot>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenDrivePresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(withDrive, FETCH, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withDrive, state.data)
            assertEquals(FETCH, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoDrive() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(noDrive, FETCH, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // A resolved-but-drive-less snapshot is the web "No recent drives" empty surface.
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
            val src = FakeSource(listOf(Resource.Success(withDrive, FETCH, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withDrive, vm.state.value.data)

            src.emissions = listOf(Resource.Error(withDrive, FETCH, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(withDrive, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun retryReFetchesUpdatedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = DriveTelemetrySnapshot(drive(id = 2), emptyList())
            val src = FakeSource(listOf(Resource.Success(withDrive, FETCH, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(withDrive, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, FETCH_2, false))
            vm.retry()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(FETCH_2, vm.state.value.fetchedAt)
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
            assertEquals(mapOf("surface" to "DriveTelemetryWidget"), opened.single().second)
        }

    @Test
    fun retryEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "driveTelemetry.refresh" })
        }

    private fun TestScope.viewModel(
        source: DriveTelemetrySource,
        logger: Logger = NoopLogger,
    ): DriveTelemetryWidgetViewModel = DriveTelemetryWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        const val FETCH = 100L
        const val FETCH_2 = 200L

        fun drive(id: Long): Drive =
            Drive(
                createdAt = Instant.parse("2024-01-01T09:00:00Z"),
                distanceM = 16_093.44,
                durationS = 1_800,
                id = id,
                startTs = Instant.parse("2024-01-01T09:00:00Z"),
                updatedAt = Instant.parse("2024-01-01T09:00:00Z"),
                vehicleId = 7,
                energyUsedWh = 4_000.0,
                startAddress = "123 Main St",
            )
    }
}
