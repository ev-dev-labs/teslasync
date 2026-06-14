package io.teslasync.android.dashboard.widgets.wallconnector

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
import java.time.Instant
import java.time.ZoneOffset

/**
 * Drives [WallConnectorWidgetViewModel] over a controllable fake [WallConnectorSource], covering the full
 * cache-then-network state matrix the web component renders — loading / content (chart + month stats) /
 * empty (no site) / no-data content / hard error + retry / stale-offline + retry / refresh re-fetch —
 * plus the PII-safe `view.opened` diagnostic and the refresh event, end to end through the real
 * [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WallConnectorWidgetViewModelTest {
    private val siteId = 12345L

    /** A one-row history whose date is in the pinned current month (June 2024) so it feeds the rollups too. */
    private fun history(energyKwh: Double): JsonElement =
        historyJson(listOf(WcRow(timestamp = "2024-06-11T00:00:00Z", energyWh = energyKwh * WH_PER_KWH)))

    private class FakeSource(
        var sites: List<Resource<JsonElement>>,
        var history: List<Resource<JsonElement>> = emptyList(),
    ) : WallConnectorSource {
        override fun energySites(): Flow<Resource<JsonElement>> = flow { sites.forEach { emit(it) } }

        override fun chargingHistory(
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
                        history = listOf(Resource.Success(history(energyKwh = 2.5), 100L, false)),
                    ),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasSites)
            assertTrue(data.hasData)
            assertEquals(2.5, data.days.first().energyKwh, 0.0)
            // The single June session feeds the current-month rollups.
            assertEquals(1, data.monthSessions)
            assertEquals(2.5, data.monthTotalKwh, 0.0)
            assertEquals(2.5, data.avgKwhPerSession, 0.0)
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
            // Linked site but no sessions → content surface whose body shows "No Wall Connector data".
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
    fun staleOfflineKeepsCachedDataWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    sites = listOf(Resource.Success(sitesJson(siteId), 100L, false)),
                    history = listOf(Resource.Success(history(energyKwh = 2.5), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value.data!!
            assertEquals(2.5, initial.days.first().energyKwh, 0.0)

            src.history = listOf(Resource.Error(history(energyKwh = 2.5), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val cached = state.data!!
            assertEquals(2.5, cached.days.first().energyKwh, 0.0)
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
                    history = listOf(Resource.Success(history(energyKwh = 2.5), 100L, false)),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = vm.state.value.data!!
            assertEquals(2.5, before.days.first().energyKwh, 0.0)

            src.history = listOf(Resource.Success(history(energyKwh = 4.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val after = vm.state.value.data!!
            assertEquals(4.0, after.days.first().energyKwh, 0.0)
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
            assertEquals(mapOf("surface" to "WallConnectorWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(sites = emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "wallConnector.refresh" })
        }

    private fun TestScope.viewModel(
        source: WallConnectorSource,
        logger: Logger = NoopLogger,
    ): WallConnectorWidgetViewModel = WallConnectorWidgetViewModel(source, logger, backgroundScope, NOW_MILLIS, ZoneOffset.UTC)

    private companion object {
        /** Watt-hours per kWh — mirrors the model's display scaling for building fixtures. */
        const val WH_PER_KWH = 1000.0

        /** A fixed "now" whose UTC month (June 2024) is the month the single history row falls in. */
        val NOW_MILLIS = Instant.parse("2024-06-11T12:00:00Z").toEpochMilli()
    }
}
