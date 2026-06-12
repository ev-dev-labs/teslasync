package io.teslasync.android.featureviews.backendstatussection

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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [BackendStatusSectionViewModel] over a controllable fake [BackendStatusSectionSource], covering the
 * full cache-then-network state matrix and the web loading gating (`isLoading = extLoading || poolLoading`):
 * loading while either the health or the pool feed is on its first load, content when both resolve, the
 * structural empty surface, a hard error + retry when health fails with no cache, a best-effort pool failure
 * that never gates the shell, stale/offline "last known" + retry, refresh re-fetch, and the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackendStatusSectionViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a change before `refresh()` is observed. */
    private class FakeSource : BackendStatusSectionSource {
        var healthEmissions: List<Resource<JsonElement>> = listOf(loading())
        var poolEmissions: List<Resource<JsonElement>> = listOf(loading())
        var versionEmissions: List<Resource<JsonElement>> = listOf(loading())

        override fun systemHealth(): Flow<Resource<JsonElement>> = flow { healthEmissions.forEach { emit(it) } }

        override fun connectionPool(): Flow<Resource<JsonElement>> = flow { poolEmissions.forEach { emit(it) } }

        override fun versionInfo(): Flow<Resource<JsonElement>> = flow { versionEmissions.forEach { emit(it) } }
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
    fun loadingWhileHealthFirstLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.poolEmissions = listOf(Resource.Success(poolJson(), 50L, false))
            src.versionEmissions = listOf(Resource.Success(versionJson(), 50L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun loadingWhilePoolFirstLoadsEvenWhenHealthReady() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(healthJson(), 100L, false))
            src.poolEmissions = listOf(loading()) // pool still on its first load (web `poolLoading`)
            src.versionEmissions = listOf(Resource.Success(versionJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenAllResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(healthJson(), 100L, false))
            src.poolEmissions = listOf(Resource.Success(poolJson(), 80L, false))
            src.versionEmissions = listOf(Resource.Success(versionJson(), 90L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt) // stamp comes from the health (spine) feed
            assertEquals(
                2,
                state.data
                    ?.health
                    ?.components
                    ?.size,
            )
            assertEquals(25L, state.data?.pool?.maxOpen)
            assertEquals("linux", state.data?.version?.os)
        }

    @Test
    fun emptyWhenNothingResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(buildJsonObject { putJsonObject("components") {} }, 100L, false))
            src.poolEmissions = listOf(Resource.Success(JsonNull, 100L, false))
            src.versionEmissions = listOf(Resource.Success(JsonNull, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenHealthFailsNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            src.poolEmissions = listOf(Resource.Success(poolJson(), 80L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun poolFailureDoesNotGateTheShell() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(healthJson(), 100L, false))
            src.poolEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            src.versionEmissions = listOf(Resource.Success(versionJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertFalse(state.hasError)
            assertNull(state.data?.pool) // pool failed ⇒ section hidden, web `pool` undefined
        }

    @Test
    fun staleOfflineKeepsCachedHealthWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(healthJson(), 100L, false))
            src.poolEmissions = listOf(Resource.Success(poolJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.healthEmissions = listOf(Resource.Error(healthJson(), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(
                2,
                state.data
                    ?.health
                    ?.components
                    ?.size,
            )
        }

    @Test
    fun refreshReFetchesUpdatedHealth() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.healthEmissions = listOf(Resource.Success(healthJson(status = "ok"), 100L, false))
            src.poolEmissions = listOf(Resource.Success(poolJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.healthEmissions = listOf(Resource.Success(healthJson(status = "degraded"), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "BackendStatusSection"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "backendStatus.refresh" })
            assertTrue(logger.events.none { it.second.containsKey("status") })
            assertTrue(logger.events.none { it.second.containsKey("go_version") })
        }

    private fun TestScope.viewModel(
        source: BackendStatusSectionSource,
        logger: Logger = NoopLogger,
    ): BackendStatusSectionViewModel = BackendStatusSectionViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun healthJson(status: String = "degraded"): JsonElement =
            buildJsonObject {
                put("status", status)
                putJsonObject("components") {
                    putJsonObject("database") {
                        put("status", "ok")
                        put("latency_ms", 1.4)
                        put("consecutive_failures", 0)
                    }
                    putJsonObject("tesla_api") {
                        put("status", "degraded")
                        put("latency_ms", 142.0)
                        put("consecutive_failures", 3)
                    }
                }
                putJsonObject("system") {
                    put("go_version", "go1.25")
                    put("uptime_seconds", 271_440)
                    put("goroutines", 84)
                }
            }

        fun poolJson(): JsonElement =
            buildJsonObject {
                put("max_open", 25)
                put("open", 7)
                put("in_use", 2)
                put("idle", 5)
                put("wait_count", 0)
            }

        fun versionJson(): JsonElement =
            buildJsonObject {
                put("go_version", "go1.25")
                put("os", "linux")
                put("arch", "amd64")
            }
    }
}
