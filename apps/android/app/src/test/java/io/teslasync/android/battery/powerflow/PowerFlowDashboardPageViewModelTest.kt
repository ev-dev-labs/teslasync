package io.teslasync.android.battery.powerflow

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [PowerFlowDashboardPageViewModel] over a fake [PowerFlowDashboardPageSource] — covering every state the web
 * page's `useQuery` reads produce (loading / content / empty / hard error), the live-snapshot no-data guard (web
 * `!hasLiveData`), the history empty/content split, the refresh mutation + log, and the one-shot `view.opened`
 * diagnostic. Run by the offline `:android:testDebugUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PowerFlowDashboardPageViewModelTest {
    @Test
    fun liveSnapshotProjectsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(live = listOf(success(LIVE_JSON)), history = listOf(success(HISTORY_JSON)))
            val vm = PowerFlowDashboardPageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.live.collect {} }
            advanceUntilIdle()

            val ui = vm.live.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data!!.hasData)
            assertEquals(7L, ui.data!!.id)
        }

    @Test
    fun liveWithoutIdIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(live = listOf(success(NO_DATA_JSON)), history = emptyList())
            val vm = PowerFlowDashboardPageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.live.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.live.value.phase)
        }

    @Test
    fun liveLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    live = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    history = emptyList(),
                )
            val vm = PowerFlowDashboardPageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.live.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.live.value.phase)
        }

    @Test
    fun liveHardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    live = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    history = emptyList(),
                )
            val vm = PowerFlowDashboardPageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.live.collect {} }
            advanceUntilIdle()

            val ui = vm.live.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun historyEmptyIsEmptyPhaseAndSamplesAreContent() =
        runTest(UnconfinedTestDispatcher()) {
            val empty = FakeSource(live = listOf(success(LIVE_JSON)), history = listOf(success("[]")))
            val emptyVm = PowerFlowDashboardPageViewModel(empty, RecordingLogger(), backgroundScope)
            backgroundScope.launch { emptyVm.history.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, emptyVm.history.value.phase)

            val filled = FakeSource(live = listOf(success(LIVE_JSON)), history = listOf(success(HISTORY_JSON)))
            val filledVm = PowerFlowDashboardPageViewModel(filled, RecordingLogger(), backgroundScope)
            backgroundScope.launch { filledVm.history.collect {} }
            advanceUntilIdle()
            val ui = filledVm.history.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(2, ui.data!!.size)
        }

    @Test
    fun refreshInvokesMutationAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(live = listOf(success(LIVE_JSON)), history = listOf(success(HISTORY_JSON)))
            val vm = PowerFlowDashboardPageViewModel(source, logger, backgroundScope)

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.refreshCalls >= 1)
            assertTrue(logger.records.any { it.event == "powerFlow.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm =
                PowerFlowDashboardPageViewModel(
                    FakeSource(live = emptyList(), history = emptyList()),
                    logger,
                    backgroundScope,
                )

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("PowerFlowDashboardPage", opened.first().fields["surface"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val live: List<Resource<JsonElement>>,
        private val history: List<Resource<JsonElement>>,
    ) : PowerFlowDashboardPageSource {
        var refreshCalls = 0
            private set

        override fun liveStatus(siteId: Long): Flow<Resource<JsonElement>> = live.asFlow()

        override fun liveStatusHistory(siteId: Long): Flow<Resource<JsonElement>> = history.asFlow()

        override suspend fun refreshLiveStatus(siteId: Long): Result<JsonElement> {
            refreshCalls++
            return Result.success(Json.parseToJsonElement("""{"id":7}"""))
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        const val LIVE_JSON =
            """{"id":7,"solar_power":3200.0,"percentage_charged":88.9,"grid_status":"Active","timestamp":"2024-03-10T14:30:00Z"}"""
        const val NO_DATA_JSON = """{"message":"no live status"}"""
        const val HISTORY_JSON =
            """[{"timestamp":"2024-03-10T08:00:00Z","solar_power":0.0,"percentage_charged":55.0},
                {"timestamp":"2024-03-10T12:00:00Z","solar_power":100.0,"percentage_charged":60.0}]"""

        private fun success(jsonText: String): Resource<JsonElement> =
            Resource.Success(Json.parseToJsonElement(jsonText), fetchedAt = 100L, stale = false)
    }
}
