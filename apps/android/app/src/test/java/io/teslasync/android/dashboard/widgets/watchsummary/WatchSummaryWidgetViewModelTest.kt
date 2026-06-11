package io.teslasync.android.dashboard.widgets.watchsummary

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [WatchSummaryWidgetViewModel] against the [WatchSummarySource] seam with a fake feed, plus the
 * [watchSummaryResource] summary+complication combine adapter directly — covering every state the web
 * widget renders (loading / content / empty / hard error / offline-cached), the complication charge-flag
 * fold, the refresh + retry re-fetch, and the one-shot `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WatchSummaryWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentWithComplicationCharge() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            success(sample(72.0)),
                        ),
                    complication = listOf(success(WatchComplication(charging = true))),
                )
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(72.0, ui.data?.summary?.batteryLevel ?: 0.0, 0.0)
            assertTrue(ui.data?.charging == true)
        }

    @Test
    fun blankSummaryIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(success(WatchSummary())),
                    complication = listOf(success(WatchComplication())),
                )
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun summaryLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    complication = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    complication = listOf(success(WatchComplication())),
                )
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSummaryWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary =
                        listOf(
                            Resource.Error(
                                cached = sample(50.0),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    complication = listOf(success(WatchComplication(charging = false))),
                )
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(50.0, ui.data?.summary?.batteryLevel ?: 0.0, 0.0)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(summary = emptyList(), complication = emptyList())
            val vm = WatchSummaryWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2L, source.refreshedId)
            assertEquals(1, source.refreshCount)
            assertTrue(logger.records.any { it.event == "watchSummary.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(summary = emptyList(), complication = emptyList())
            val vm = WatchSummaryWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)

            vm.retry()
            advanceUntilIdle()

            assertEquals(4L, source.refreshedId)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = WatchSummaryWidgetViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("WatchSummaryWidget", opened.first().fields["slug"])
        }

    // ── adapter: summary + complication composition ──────────────────────────────
    @Test
    fun adapterFoldsComplicationChargeOntoSummary() =
        runTest {
            val result =
                watchSummaryResource(
                    summary = flowOf(success(sample(33.0))),
                    complication = flowOf(success(WatchComplication(charging = true))),
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(33.0, result.cached?.summary?.batteryLevel ?: 0.0, 0.0)
            assertTrue(result.cached?.charging == true)
        }

    @Test
    fun adapterDegradesMissingComplicationToNotCharging() =
        runTest {
            val result =
                watchSummaryResource(
                    summary = flowOf(success(sample(40.0))),
                    complication = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached?.charging ?: true)
        }

    @Test
    fun adapterStaysLoadingWhileSummaryLoads() =
        runTest {
            val result =
                watchSummaryResource(
                    summary = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    complication = flowOf(success(WatchComplication())),
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesHardSummaryError() =
        runTest {
            val result =
                watchSummaryResource(
                    summary = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    complication = flowOf(success(WatchComplication())),
                ).toList().last()
            assertTrue(result is Resource.Error)
            assertNull(result.cached)
        }

    @Test
    fun adapterKeepsCachedSummaryOnOfflineError() =
        runTest {
            val result =
                watchSummaryResource(
                    summary =
                        flowOf(
                            Resource.Error(cached = sample(60.0), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                    complication = flowOf(success(WatchComplication(charging = true))),
                ).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(60.0, result.cached?.summary?.batteryLevel ?: 0.0, 0.0)
            assertTrue(result.cached?.charging == true)
            assertTrue(result.stale)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val summary: List<Resource<WatchSummary>>,
        private val complication: List<Resource<WatchComplication>>,
    ) : WatchSummarySource {
        var refreshedId: Long? = null
            private set
        var refreshCount = 0
            private set

        override fun summary(vehicleId: Long?): Flow<Resource<WatchSummary>> = summary.asFlow()

        override fun complication(vehicleId: Long?): Flow<Resource<WatchComplication>> = complication.asFlow()

        override fun refresh(vehicleId: Long?) {
            refreshedId = vehicleId
            refreshCount++
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

    private fun success(summary: WatchSummary): Resource<WatchSummary> = Resource.Success(summary, fetchedAt = 100L, stale = false)

    private fun success(complication: WatchComplication): Resource<WatchComplication> =
        Resource.Success(complication, fetchedAt = 100L, stale = false)

    private fun sample(level: Double): WatchSummary =
        WatchSummary(
            vehicleName = "Model 3",
            state = "online",
            batteryLevel = level,
            rangeKm = 312.0,
            isLocked = true,
            insideTempC = 21.0,
            lastUpdated = "2026-06-11T18:25:00Z",
        )
}
