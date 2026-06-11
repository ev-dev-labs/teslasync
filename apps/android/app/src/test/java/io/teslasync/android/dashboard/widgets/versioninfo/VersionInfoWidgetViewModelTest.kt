package io.teslasync.android.dashboard.widgets.versioninfo

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [VersionInfoWidgetViewModel] over a controllable fake [VersionInfoSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the asymmetric composition (the version feed alone gates the
 * shell — web `isLoading`/`error`/`hasData` — while the capture feed is folded in as best-effort stat data
 * that never raises loading/error/empty), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VersionInfoWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a change before `refresh()` is observed. */
    private class FakeSource : VersionInfoSource {
        var versionEmissions: List<Resource<JsonElement>> = listOf(loading())
        var captureEmissions: List<Resource<JsonElement>> = listOf(loading())

        override fun versionInfo(): Flow<Resource<JsonElement>> = flow { versionEmissions.forEach { emit(it) } }

        override fun captureStats(): Flow<Resource<JsonElement>> = flow { captureEmissions.forEach { emit(it) } }
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
    fun loadingWhileVersionLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenVersionResolvesFoldsCaptureFigures() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.versionEmissions = listOf(Resource.Success(versionJson(), 100L, false))
            src.captureEmissions = listOf(Resource.Success(captureJson(signals = 9.5), 80L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt) // freshness stamp comes from the version (primary) feed
            assertEquals("1.4.2", state.data?.version?.chartVersion)
            assertEquals(9.5, state.data?.capture?.signalsPerSec)
        }

    @Test
    fun emptyWhenVersionPayloadIsNotAnObject() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.versionEmissions = listOf(Resource.Success(JsonNull, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertNull(state.data?.version)
        }

    @Test
    fun captureErrorDoesNotGateShell() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.versionEmissions = listOf(Resource.Success(versionJson(), 100L, false))
            src.captureEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // A capture failure must NOT raise the hard error surface (web only `version.error` does that).
            assertEquals(UiPhase.Content, state.phase)
            assertFalse(state.hasError)
            assertEquals(CaptureFields.ZERO, state.data?.capture)
        }

    @Test
    fun hardErrorWithRetryWhenVersionFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.versionEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedVersionWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            val cached = versionJson(chart = "1.4.0")
            src.versionEmissions = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.versionEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals("1.4.0", state.data?.version?.chartVersion)
        }

    @Test
    fun refreshReFetchesUpdatedVersion() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.versionEmissions = listOf(Resource.Success(versionJson(chart = "1.4.0"), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                "1.4.0",
                vm.state.value.data
                    ?.version
                    ?.chartVersion,
            )

            src.versionEmissions = listOf(Resource.Success(versionJson(chart = "1.5.0"), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals("1.5.0", refreshed.data?.version?.chartVersion)
            assertEquals(200L, refreshed.fetchedAt)
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
            assertEquals(mapOf("surface" to "VersionInfoWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutVersionPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "versionInfo.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("chart_version") })
            assertFalse(logger.events.any { it.second.containsKey("git_commit") })
        }

    private fun TestScope.viewModel(
        source: VersionInfoSource,
        logger: Logger = NoopLogger,
    ): VersionInfoWidgetViewModel = VersionInfoWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun versionJson(
            chart: String = "1.4.2",
            git: String = "abcdef1234567",
        ): JsonElement =
            buildJsonObject {
                put("chart_version", chart)
                put("git_commit", git)
                put("go_version", "go1.25")
                put("os", "linux")
                put("arch", "amd64")
            }

        fun captureJson(signals: Double = 12.34): JsonElement =
            buildJsonObject {
                put("signals_per_sec", signals)
                put("messages_today", 1234)
                put("bytes_processed", 1536)
                put("avg_processing_latency_ms", 5.67)
            }
    }
}
