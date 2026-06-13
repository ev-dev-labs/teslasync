// Off-device unit tests for the AINLDriveSearch state holder: the AI-feature gate, the prompt -> canStart
// binding, the prompt threading into the search request, the search-stream reduction (deltas -> done,
// unterminated -> done, terminal failure frame, thrown transport failure, offline last-known retention), the
// search/retry actions and their blank-prompt + in-flight guards, and the one-shot PII-safe `view.opened`
// diagnostic. Driven over a fake source; run by the offline :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AINLDriveSearchViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AINLDriveSearchViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(DriveSearchSurface.Hidden, classifyDriveSearch(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLDriveSearchViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── prompt / canStart ─────────────────────────────────────────────────────────
    @Test
    fun setPromptDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AINLDriveSearchViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            assertFalse(vm.state.value.canStart)
            vm.setPrompt("last Friday's coast trip")
            assertEquals("last Friday's coast trip", vm.state.value.prompt)
            assertTrue(vm.state.value.canStart)
            vm.setPrompt("   ")
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun searchThreadsPromptToSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSearchChunk.Done))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("the lowest-efficiency drive last week")
            vm.search()
            advanceUntilIdle()

            assertEquals("the lowest-efficiency drive last week", source.lastPrompt)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun searchAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Found "), delta("it"), AiSearchChunk.Done))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DriveSearchPhase.Done, state.phase)
            assertEquals("Found it", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
            assertEquals(DriveSearchSurface.Ready("Found it", stale = false), classifyDriveSearch(state, FIXED_NOW))
        }

    @Test
    fun searchWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()

            assertEquals(DriveSearchPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSearchChunk.Failed(ErrorKind.Http)))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()

            assertEquals(DriveSearchPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()

            assertEquals(DriveSearchPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownResult() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiSearchChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(DriveSearchPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                DriveSearchSurface.Cached("known", offline = true),
                classifyDriveSearch(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun searchIsNoOpWithBlankPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSearchChunk.Done))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("   ")
            vm.search()
            advanceUntilIdle()
            assertEquals(0, source.searchCalls)
        }

    @Test
    fun searchIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()
            vm.search()
            advanceUntilIdle()

            assertEquals(1, source.searchCalls)
            assertEquals(DriveSearchPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsSearch() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiSearchChunk.Done))))
            val vm = AINLDriveSearchViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()
            val before = source.searchCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.searchCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AINLDriveSearchViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_NL_DRIVE_SEARCH_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun searchEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiSearchChunk.Done))))
            val vm = AINLDriveSearchViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setPrompt("coast trip")
            vm.search()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiNlDriveSearch.search" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("prompt") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiSearchChunk = AiSearchChunk.Delta(text)

    private data class Response(
        val chunks: List<AiSearchChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AINLDriveSearchSource {
        var searchCalls = 0
            private set

        var lastPrompt: String? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun search(prompt: String): Flow<AiSearchChunk> {
            val response = responses[searchCalls.coerceAtMost(responses.lastIndex)]
            searchCalls++
            lastPrompt = prompt
            return flow {
                response.chunks.forEach { emit(it) }
                if (hold) awaitCancellation()
                response.error?.let { throw it }
            }
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

    private companion object {
        const val FIXED_NOW = 5_000L
    }
}
