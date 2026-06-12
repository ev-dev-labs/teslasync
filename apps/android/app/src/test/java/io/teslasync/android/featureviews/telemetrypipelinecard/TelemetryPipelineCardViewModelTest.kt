package io.teslasync.android.featureviews.telemetrypipelinecard

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TelemetryPipelineCardViewModel] over a controllable fake [TelemetryPipelineCardSource], covering
 * the cache-then-network state matrix: loading (no cache), content on success, the MQTT spine's hard error
 * (no cache) and stale/offline (cached MQTT kept visible), the polling feed folded best-effort (a failed
 * polling feed never blanks the surface), the refresh re-fetch, and the PII-safe `view.opened` diagnostic.
 * Also exercises the pure [combinePipelineResources] spine/best-effort contract directly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryPipelineCardViewModelTest {
    private class FakeSource : TelemetryPipelineCardSource {
        var mqtt: List<Resource<TelemetryStatus>> = listOf(loadingMqtt())
        var polling: List<Resource<PollEngineStatus>> = listOf(loadingPolling())

        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = flow { mqtt.forEach { emit(it) } }

        override fun pollingStatus(): Flow<Resource<PollEngineStatus>> = flow { polling.forEach { emit(it) } }
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
    fun loadingWhenNeitherFeedHasCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isLoading)
            assertNull(vm.state.value.data)
        }

    @Test
    fun contentOnSuccessFoldsBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqtt = listOf(Resource.Success(status(connected = true), 100L, false))
            src.polling = listOf(Resource.Success(PollEngineStatus(enabled = true), 90L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isContent)
            assertNotNull(state.data?.mqtt)
            assertNotNull(state.data?.polling)
            assertEquals(100L, state.fetchedAt)
            assertFalse(state.hasError)
        }

    @Test
    fun errorWhenMqttFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqtt = listOf(loadingMqtt(), Resource.Error(null, null, false, ApiError.Network()))
            src.polling = listOf(Resource.Success(PollEngineStatus(), 90L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertNull(vm.state.value.data)
        }

    @Test
    fun staleOfflineKeepsCachedMqtt() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqtt = listOf(Resource.Error(status(connected = false), 100L, true, ApiError.Timeout()))
            src.polling = listOf(loadingPolling())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.data?.mqtt)
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun pollingFailureDoesNotBlankSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqtt = listOf(Resource.Success(status(connected = true), 100L, false))
            src.polling = listOf(Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isContent)
            assertNotNull(state.data?.mqtt)
            assertNull(state.data?.polling)
            assertFalse(state.hasError)
        }

    @Test
    fun refreshReFetchesFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqtt = listOf(Resource.Success(status(connected = true), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.mqtt = listOf(Resource.Success(status(connected = true), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TelemetryPipelineCard"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "telemetryPipeline.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("broker") || it.second.containsKey("vin") })
        }

    // ── combinePipelineResources: MQTT spine + polling best-effort ───────────────────────────────────

    @Test
    fun combineFirstLoadHasNoData() {
        val result = combinePipelineResources(loadingMqtt(), loadingPolling())
        assertTrue(result is Resource.Loading)
        assertNull(result.cached)
    }

    @Test
    fun combineSuccessFoldsBothCachedValues() {
        val result =
            combinePipelineResources(
                Resource.Success(status(connected = true), 100L, false),
                Resource.Success(PollEngineStatus(enabled = false), 90L, false),
            )
        assertTrue(result is Resource.Success)
        assertNotNull(result.cached?.mqtt)
        assertEquals(false, result.cached?.polling?.enabled)
    }

    @Test
    fun combineMqttErrorNoCacheIsHardError() {
        val result =
            combinePipelineResources(
                Resource.Error(null, null, false, ApiError.Network()),
                Resource.Success(PollEngineStatus(), 90L, false),
            )
        assertTrue(result is Resource.Error)
        assertNull(result.cached)
    }

    @Test
    fun combineMqttErrorWithCacheStaysContentAndStale() {
        val result =
            combinePipelineResources(
                Resource.Error(status(connected = false), 100L, true, ApiError.Timeout()),
                Resource.Success(PollEngineStatus(), 90L, false),
            )
        assertTrue(result is Resource.Error)
        assertNotNull(result.cached?.mqtt)
        assertTrue(result.stale)
    }

    @Test
    fun combinePollingLoadingDoesNotChangeMqttSuccessPhase() {
        val result = combinePipelineResources(Resource.Success(status(connected = true), 100L, false), loadingPolling())
        assertTrue(result is Resource.Success)
        assertNotNull(result.cached?.mqtt)
        assertNull(result.cached?.polling)
    }

    private fun TestScope.viewModel(
        source: TelemetryPipelineCardSource,
        logger: Logger = NoopLogger,
    ): TelemetryPipelineCardViewModel = TelemetryPipelineCardViewModel(source, logger, backgroundScope)

    private companion object {
        fun loadingMqtt(): Resource<TelemetryStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingPolling(): Resource<PollEngineStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun status(connected: Boolean): TelemetryStatus =
            TelemetryStatus(
                connected = connected,
                broker = "tcp://mosquitto:1883",
                uptimeSeconds = 1.0,
                vehicles = emptyList(),
                topics = emptyList(),
            )
    }
}
