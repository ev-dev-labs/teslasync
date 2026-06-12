package io.teslasync.android.featureviews.healthprobes

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [HealthProbesSectionViewModel] against the [HealthProbesSectionSource] seam with a fake
 * `/system/health` feed — covering every state the web surface renders (loading / content / empty / hard
 * error) plus the ADR-013 stale-offline state, the refresh + retry restart of the feed, and the one-shot
 * `view.opened` diagnostics event. The framework-free projection is covered by [HealthProbesProjectionTest].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HealthProbesSectionViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<JsonElement>>,
    ) : HealthProbesSectionSource {
        var calls = 0
            private set

        override fun systemHealth(): Flow<Resource<JsonElement>> {
            calls++
            return emissions.asFlow()
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

    private fun healthBody(
        status: String = "healthy",
        dbStatus: String = "ok",
    ): JsonElement =
        buildJsonObject {
            put("status", status)
            putJsonObject("database") {
                put("status", dbStatus)
                put("latency_ms", 2.5)
            }
            putJsonObject("database_pool") { put("total_conns", 12) }
            putJsonObject("system") {
                put("goroutines", 148)
                put("uptime_seconds", 1_000)
            }
        }

    private fun success(value: JsonElement): Resource<JsonElement> = Resource.Success(value, fetchedAt = 100L, stale = false)

    private fun vm(
        source: HealthProbesSectionSource,
        logger: Logger = RecordingLogger(),
        scope: CoroutineScope,
    ): HealthProbesSectionViewModel = HealthProbesSectionViewModel(source, logger, scope)

    @Test
    fun loadsContentWhenHealthResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        success(healthBody(status = "degraded")),
                    ),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertNotNull(state.data)
            assertEquals("degraded", state.data?.livenessStatus)
            assertEquals("ok", state.data?.dbStatus)
            assertEquals(148L, state.data?.goroutines)
        }

    @Test
    fun firstLoadWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun healthResolvingToNonObjectIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(JsonNull)))
            val model = vm(source, scope = backgroundScope)
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
                    listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
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
                    listOf(
                        Resource.Error(cached = healthBody(status = "healthy"), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                    ),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("healthy", state.data?.livenessStatus)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshRestartsTheFeedAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(healthBody())))
            val logger = RecordingLogger()
            val model = vm(source, logger, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRefresh = source.calls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.calls > callsBeforeRefresh)
            assertTrue(logger.records.any { it.event == "healthProbes.refresh" })
        }

    @Test
    fun retryAlsoRestartsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(healthBody())))
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRetry = source.calls

            model.retry()
            advanceUntilIdle()

            assertTrue(source.calls > callsBeforeRetry)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList())
            val model = vm(source, logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("HealthProbesSection", opened.first().fields["slug"])
        }
}
