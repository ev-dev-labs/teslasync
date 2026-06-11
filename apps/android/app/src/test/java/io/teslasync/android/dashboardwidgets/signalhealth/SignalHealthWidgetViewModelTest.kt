package io.teslasync.android.dashboardwidgets.signalhealth

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalStats
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
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
 * Tests [SignalHealthWidgetViewModel] against the [SignalHealthSource] seam with fake catalog + live-gap
 * + stats feeds — covering the states the web widget renders (loading / content / empty / hard error /
 * offline-cached), the refresh + retry re-fetch of the per-vehicle feeds, and the one-shot `view.opened`
 * diagnostics event. The framework-free projection is covered by [SignalHealthWidgetModelTest].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalHealthWidgetViewModelTest {
    private class FakeSource(
        private val signalsEmissions: List<Resource<List<String>>>,
        private val gapsEmissions: List<Resource<Map<String, JsonElement>>>,
        private val statsEmissions: List<Resource<SignalStats>>,
        private val vehiclesEmissions: List<Resource<List<Vehicle>>> =
            listOf(Resource.Success(emptyList(), fetchedAt = 0L, stale = false)),
    ) : SignalHealthSource {
        var refreshCalls = 0
            private set
        var lastRefreshId = -1L
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesEmissions.asFlow()

        override fun signals(vehicleId: Long): Flow<Resource<List<String>>> = signalsEmissions.asFlow()

        override fun liveGaps(vehicleId: Long): Flow<Resource<Map<String, JsonElement>>> = gapsEmissions.asFlow()

        override fun stats(vehicleId: Long): Flow<Resource<SignalStats>> = statsEmissions.asFlow()

        override suspend fun refresh(vehicleId: Long) {
            refreshCalls++
            lastRefreshId = vehicleId
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

    private fun stats(): SignalStats = SignalStats(vehicleId = 1, count = 12)

    private fun vm(
        source: SignalHealthSource,
        logger: Logger = RecordingLogger(),
        scope: kotlinx.coroutines.CoroutineScope,
        vehicleId: Long? = 1L,
    ): SignalHealthWidgetViewModel = SignalHealthWidgetViewModel(source, logger, scope, vehicleId)

    @Test
    fun loadsContentWhenStatsResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Success(listOf("a", "b"), fetchedAt = 100L, stale = false)),
                    gapsEmissions = listOf(Resource.Success(emptyMap(), fetchedAt = 100L, stale = false)),
                    statsEmissions =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            Resource.Success(stats(), fetchedAt = 100L, stale = false),
                        ),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertNotNull(state.data)
            assertEquals(2, state.data?.totalSignals)
        }

    @Test
    fun firstLoadOfStatsIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    gapsEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    statsEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun noVehicleResolvesToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = emptyList(),
                    gapsEmissions = emptyList(),
                    statsEmissions = emptyList(),
                    vehiclesEmissions = listOf(Resource.Success(emptyList(), fetchedAt = 100L, stale = false)),
                )
            val model = vm(source, scope = backgroundScope, vehicleId = null)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertFalse(state.data?.hasData ?: true)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    gapsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    statsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, model.state.value.phase)
            assertTrue(model.state.value.hasError)
            assertFalse(model.state.value.hasData)
        }

    @Test
    fun offlineKeepsCachedAnalysisWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Success(listOf("a", "b", "c"), fetchedAt = 100L, stale = false)),
                    gapsEmissions = listOf(Resource.Success(emptyMap(), fetchedAt = 100L, stale = false)),
                    statsEmissions =
                        listOf(Resource.Error(cached = stats(), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(3, state.data?.totalSignals)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesTheResolvedVehiclesFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Success(listOf("a"), fetchedAt = 100L, stale = false)),
                    gapsEmissions = listOf(Resource.Success(emptyMap(), fetchedAt = 100L, stale = false)),
                    statsEmissions = listOf(Resource.Success(stats(), fetchedAt = 100L, stale = false)),
                )
            val logger = RecordingLogger()
            val model = vm(source, logger, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.refresh()
            advanceUntilIdle()

            assertEquals(1, source.refreshCalls)
            assertEquals(1L, source.lastRefreshId)
            assertTrue(logger.records.any { it.event == "signalHealth.refresh" })
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    signalsEmissions = listOf(Resource.Success(listOf("a"), fetchedAt = 100L, stale = false)),
                    gapsEmissions = listOf(Resource.Success(emptyMap(), fetchedAt = 100L, stale = false)),
                    statsEmissions = listOf(Resource.Success(stats(), fetchedAt = 100L, stale = false)),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.retry()
            advanceUntilIdle()

            assertEquals(1, source.refreshCalls)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList(), emptyList(), emptyList())
            val model = vm(source, logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SignalHealthWidget", opened.first().fields["slug"])
        }
}
