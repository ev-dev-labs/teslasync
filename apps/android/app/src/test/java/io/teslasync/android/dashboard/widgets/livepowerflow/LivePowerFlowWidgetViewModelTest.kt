package io.teslasync.android.dashboard.widgets.livepowerflow

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
 * Drives [LivePowerFlowWidgetViewModel] over a controllable fake [LivePowerFlowSource], covering the full
 * cache-then-network state matrix the web component renders — loading / content (diagram) / empty (no
 * site) / no-live-data content / hard error + retry / stale-offline + retry / refresh re-fetch — plus the
 * PII-safe `view.opened` diagnostic and the refresh event, end to end through the real
 * [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LivePowerFlowWidgetViewModelTest {
    private val siteId = 12345L

    private class FakeSource(
        var sites: List<Resource<JsonElement>>,
        var live: List<Resource<JsonElement>> = emptyList(),
    ) : LivePowerFlowSource {
        override fun energySites(): Flow<Resource<JsonElement>> = flow { sites.forEach { emit(it) } }

        override fun liveStatus(siteId: Long): Flow<Resource<JsonElement>> = flow { live.forEach { emit(it) } }
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
    fun contentWhenSiteAndLiveStatusResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        live = listOf(Resource.Success(liveJson(solar = 2500.0, grid = -1500.0), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertTrue(data.hasData)
            assertEquals(2500.0, data.status!!.solarW, 0.0)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun siteWithoutLiveBodyStaysContentForNoData() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        live = listOf(Resource.Success(emptyObjectJson(), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // Linked site but no decodable live body → content surface whose diagram shows "No live power data".
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertFalse(data.hasData)
        }

    @Test
    fun loadingWhileLiveStatusLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                        live = listOf(Resource.Loading(null, null, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // Web: isLoading = sitesLoading || (siteId && liveLoading) → the whole shell shows a skeleton.
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenSitesFailNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(sites = listOf(Resource.Error(null, null, false, ApiError.Network()))),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedDiagramWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                    live = listOf(Resource.Success(liveJson(solar = 2500.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                2500.0,
                vm.state.value.data!!
                    .status!!
                    .solarW,
                0.0,
            )

            src.live = listOf(Resource.Error(liveJson(solar = 2500.0), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2500.0, state.data!!.status!!.solarW, 0.0)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                    live = listOf(Resource.Success(liveJson(solar = 2500.0), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                2500.0,
                vm.state.value.data!!
                    .status!!
                    .solarW,
                0.0,
            )

            src.live = listOf(Resource.Success(liveJson(solar = 4000.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(
                4000.0,
                vm.state.value.data!!
                    .status!!
                    .solarW,
                0.0,
            )
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(sites = emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "LivePowerFlowWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(sites = emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "livePowerFlow.refresh" })
        }

    private fun TestScope.viewModel(
        source: LivePowerFlowSource,
        logger: Logger = NoopLogger,
    ): LivePowerFlowWidgetViewModel = LivePowerFlowWidgetViewModel(source, logger, backgroundScope)
}
