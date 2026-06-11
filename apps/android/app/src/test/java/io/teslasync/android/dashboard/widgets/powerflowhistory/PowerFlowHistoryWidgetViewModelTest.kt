package io.teslasync.android.dashboard.widgets.powerflowhistory

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
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [PowerFlowHistoryWidgetViewModel] over a controllable fake [PowerFlowHistorySource], covering
 * the full cache-then-network state matrix the web component renders — loading / content (chart) / empty
 * (no site) / no-data content / hard error + retry / stale-offline + retry / refresh re-fetch — plus the
 * PII-safe `view.opened` diagnostic and the refresh event, end to end through the real
 * [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PowerFlowHistoryWidgetViewModelTest {
    private val siteId = 12345L
    private val since = "2024-06-10T00:00:00Z"

    private fun history(
        solar: Double,
        grid: Double = 0.0,
    ): JsonElement = historyJson(listOf(HistoryRow(timestamp = "2024-06-11T08:00:00Z", solar = solar, grid = grid)))

    private class FakeSource(
        var sites: List<Resource<JsonElement>>,
        var history: List<Resource<JsonElement>> = emptyList(),
    ) : PowerFlowHistorySource {
        override fun energySites(): Flow<Resource<JsonElement>> = flow { sites.forEach { emit(it) } }

        override fun liveStatusHistory(
            siteId: Long,
            since: String,
        ): Flow<Resource<JsonElement>> = flow { history.forEach { emit(it) } }
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
            val vm = viewModel(FakeSource(sites = listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoSiteLinked() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(sites = listOf(Resource.Success(emptySitesJson(), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertNotNull(state.data)
            assertFalse(state.data!!.hasSites)
        }

    @Test
    fun contentWhenSiteAndHistoryResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        history = listOf(Resource.Success(history(solar = 2500.0, grid = -1500.0), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertTrue(data.hasData)
            assertEquals(2.5, data.samples.first().solarKw, 0.0)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun siteWithEmptyHistoryStaysContentForNoData() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        history = listOf(Resource.Success(emptyHistoryJson(), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // Linked site but no rows → content surface whose chart shows "No power flow data".
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertFalse(data.hasData)
        }

    @Test
    fun loadingWhileHistoryLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        history = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // Web: isLoading = sitesLoading || (siteId && historyLoading) → the whole shell shows a skeleton.
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenSitesFailNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(sites = listOf(Resource.Error(null, null, false, ApiError.Network()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedChartWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                    history = listOf(Resource.Success(history(solar = 2500.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                2.5,
                vm.state.value.data!!
                    .samples
                    .first()
                    .solarKw,
                0.0,
            )

            src.history = listOf(Resource.Error(history(solar = 2500.0), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(
                2.5,
                state.data!!
                    .samples
                    .first()
                    .solarKw,
                0.0,
            )
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedHistory() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                    history = listOf(Resource.Success(history(solar = 2500.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                2.5,
                vm.state.value.data!!
                    .samples
                    .first()
                    .solarKw,
                0.0,
            )

            src.history = listOf(Resource.Success(history(solar = 4000.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(
                4.0,
                vm.state.value.data!!
                    .samples
                    .first()
                    .solarKw,
                0.0,
            )
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(sites = emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "PowerFlowHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(sites = emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "powerFlowHistory.refresh" })
        }

    private fun TestScope.viewModel(
        source: PowerFlowHistorySource,
        logger: Logger = NoopLogger,
    ): PowerFlowHistoryWidgetViewModel = PowerFlowHistoryWidgetViewModel(source, logger, backgroundScope, since)
}
