package io.teslasync.android.featureviews.quiethourspanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
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
 * Drives [QuietHoursPanelViewModel] over a controllable fake [QuietHoursPanelSource], covering the full
 * cache-then-network state matrix the windows feed can be in (loading / content / empty / hard error + retry /
 * stale-offline + retry), the create + update + delete mutations' typed [QuietHoursToast]s, the save delegation
 * (id null = create, id set = update), and the PII-safe `view.opened` + refresh diagnostics. Mirrors the web
 * component's hook behaviour (web/src/features/settings/components/QuietHoursPanel.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QuietHoursPanelViewModelTest {
    private fun window(
        id: Long = 1,
        enabled: Boolean = true,
    ): QuietHoursWindow =
        QuietHoursWindow(
            id = id,
            enabled = enabled,
            startLocal = "23:00",
            endLocal = "07:00",
            timezone = "UTC",
            weekdays = ALL_WEEKDAYS,
            bypassSeverities = listOf("critical"),
        )

    private val populated = listOf(window(1))

    private class FakeSource(
        var emissions: List<Resource<List<QuietHoursWindow>>>,
    ) : QuietHoursPanelSource {
        var saveResult: Result<QuietHoursWindow> = Result.success(QuietHoursWindow(id = 1))
        var deleteResult: Result<Unit> = Result.success(Unit)
        val saved = mutableListOf<Pair<QuietHoursWindowInput, Long?>>()
        val deleted = mutableListOf<Long>()

        override fun windows(): Flow<Resource<List<QuietHoursWindow>>> = flow { emissions.forEach { emit(it) } }

        override suspend fun saveWindow(
            input: QuietHoursWindowInput,
            id: Long?,
        ): Result<QuietHoursWindow> {
            saved += input to id
            return saveResult
        }

        override suspend fun deleteWindow(id: Long): Result<Unit> {
            deleted += id
            return deleteResult
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

    private fun TestScope.viewModel(
        source: QuietHoursPanelSource,
        logger: Logger = NoopLogger,
    ): QuietHoursPanelViewModel = QuietHoursPanelViewModel(source, logger, backgroundScope)

    private fun TestScope.collectToasts(vm: QuietHoursPanelViewModel): List<QuietHoursToast> {
        val received = mutableListOf<QuietHoursToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.windows.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.windows.value.phase)
        }

    @Test
    fun contentWhenWindowsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.windows.collect {} }
            advanceUntilIdle()

            val state = vm.windows.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoWindows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.windows.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.windows.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.windows.collect {} }
            advanceUntilIdle()

            val state = vm.windows.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.windows.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.windows.value.data)

            src.emissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.windows.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun saveCreateRaisesCreatedToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)
            val input =
                QuietHoursWindowInput(
                    enabled = true,
                    startLocal = "23:00",
                    endLocal = "07:00",
                    timezone = "UTC",
                    weekdays = ALL_WEEKDAYS,
                    bypassSeverities = listOf("critical"),
                )

            val result = vm.save(input, null)
            advanceUntilIdle()

            assertTrue(result.isSuccess)
            assertEquals(listOf<Pair<QuietHoursWindowInput, Long?>>(input to null), src.saved)
            assertEquals(listOf<QuietHoursToast>(QuietHoursToast.Created), received)
        }

    @Test
    fun saveUpdateRaisesUpdatedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.save(QuietHoursWindowInput(timezone = "UTC"), 5L)
            advanceUntilIdle()

            assertEquals(listOf(5L), src.saved.map { it.second })
            assertEquals(listOf<QuietHoursToast>(QuietHoursToast.Updated), received)
        }

    @Test
    fun saveFailureRaisesSaveFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.saveResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            val result = vm.save(QuietHoursWindowInput(timezone = "UTC"), null)
            advanceUntilIdle()

            assertTrue(result.isFailure)
            assertEquals(listOf<QuietHoursToast>(QuietHoursToast.SaveFailed), received)
        }

    @Test
    fun deleteRaisesDeletedToastAndRecordsCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(window(7))
            advanceUntilIdle()

            assertEquals(listOf(7L), src.deleted)
            assertEquals(listOf<QuietHoursToast>(QuietHoursToast.Deleted), received)
        }

    @Test
    fun deleteFailureRaisesDeleteFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            src.deleteResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.delete(window(7))
            advanceUntilIdle()

            assertEquals(listOf<QuietHoursToast>(QuietHoursToast.DeleteFailed), received)
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
            assertEquals(mapOf("surface" to "QuietHoursPanel"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "quietHours.refresh" })
        }
}
