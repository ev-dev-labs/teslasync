package io.teslasync.android.dashboardwidgets.systemhealth

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
 * Tests [SystemHealthWidgetViewModel] against the [SystemHealthSource] seam with fake system-health +
 * db-stats + runtime-info feeds — covering the states the web widget renders (loading / content / empty
 * / hard error / offline-cached), the refresh + retry restart of the combined feed, and the one-shot
 * `view.opened` diagnostics event. The framework-free projection is covered by
 * [SystemHealthWidgetModelTest].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemHealthWidgetViewModelTest {
    private class FakeSource(
        private val healthEmissions: List<Resource<JsonElement>>,
        private val dbStatsEmissions: List<Resource<JsonElement>>,
        private val poolEmissions: List<Resource<JsonElement>>,
    ) : SystemHealthSource {
        var healthCalls = 0
            private set

        override fun systemHealth(): Flow<Resource<JsonElement>> {
            healthCalls++
            return healthEmissions.asFlow()
        }

        override fun dbStats(): Flow<Resource<JsonElement>> = dbStatsEmissions.asFlow()

        override fun connectionPool(): Flow<Resource<JsonElement>> = poolEmissions.asFlow()
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

    private fun healthBody(status: String = "healthy"): JsonElement =
        buildJsonObject {
            put("status", status)
            putJsonObject("components") {
                putJsonObject("database") { put("status", "healthy") }
                putJsonObject("mqtt") { put("status", "healthy") }
            }
        }

    private fun dbBody(): JsonElement = buildJsonObject { put("database_size", "1.2 GB") }

    private fun poolBody(): JsonElement =
        buildJsonObject {
            put("in_use", 4)
            put("max_open", 25)
        }

    private fun success(value: JsonElement): Resource<JsonElement> = Resource.Success(value, fetchedAt = 100L, stale = false)

    private fun vm(
        source: SystemHealthSource,
        logger: Logger = RecordingLogger(),
        scope: CoroutineScope,
    ): SystemHealthWidgetViewModel = SystemHealthWidgetViewModel(source, logger, scope)

    @Test
    fun loadsContentWhenHealthResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    healthEmissions =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            success(healthBody("degraded")),
                        ),
                    dbStatsEmissions = listOf(success(dbBody())),
                    poolEmissions = listOf(success(poolBody())),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertNotNull(state.data)
            assertEquals(SystemOverall.Degraded, state.data?.overall)
            assertEquals("4/25", state.data?.let { SystemHealthProjection.formatActiveConns(it.activeConns, it.maxConns) })
        }

    @Test
    fun firstLoadOfHealthIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    healthEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    dbStatsEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    poolEmissions = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun healthResolvingToNonObjectIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    healthEmissions = listOf(success(JsonNull)),
                    dbStatsEmissions = listOf(success(dbBody())),
                    poolEmissions = listOf(success(poolBody())),
                )
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
                    healthEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    dbStatsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    poolEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
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
                    healthEmissions =
                        listOf(Resource.Error(cached = healthBody("healthy"), fetchedAt = 100L, stale = true, error = ApiError.Network())),
                    dbStatsEmissions = listOf(success(dbBody())),
                    poolEmissions = listOf(success(poolBody())),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(SystemOverall.Healthy, state.data?.overall)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshRestartsTheCombinedFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    healthEmissions = listOf(success(healthBody())),
                    dbStatsEmissions = listOf(success(dbBody())),
                    poolEmissions = listOf(success(poolBody())),
                )
            val logger = RecordingLogger()
            val model = vm(source, logger, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRefresh = source.healthCalls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.healthCalls > callsBeforeRefresh)
            assertTrue(logger.records.any { it.event == "systemHealth.refresh" })
        }

    @Test
    fun retryAlsoRestartsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    healthEmissions = listOf(success(healthBody())),
                    dbStatsEmissions = listOf(success(dbBody())),
                    poolEmissions = listOf(success(poolBody())),
                )
            val model = vm(source, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRetry = source.healthCalls

            model.retry()
            advanceUntilIdle()

            assertTrue(source.healthCalls > callsBeforeRetry)
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
            assertEquals("SystemHealthWidget", opened.first().fields["slug"])
        }
}
