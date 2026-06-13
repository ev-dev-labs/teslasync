// Off-device unit tests for the AIDriveCoaching state holder: the AI-feature gate, the drive -> canStart
// binding, the coach-stream reduction (deltas -> done, unterminated -> done, terminal failure frame, thrown
// transport failure, offline last-known retention), the generate/retry actions and their in-flight guard, and
// the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.aidrivecoaching

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
class AIDriveCoachingViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIDriveCoachingViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(CoachingSurface.Hidden, classifyCoaching(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIDriveCoachingViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── drive / canStart ────────────────────────────────────────────────────────────
    @Test
    fun setDriveDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIDriveCoachingViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-7")
            assertEquals("drive-7", vm.state.value.driveId)
            assertTrue(vm.state.value.canStart)
            vm.setDrive(null)
            assertFalse(vm.state.value.canStart)
            vm.setDrive("")
            assertFalse(vm.state.value.canStart)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun generateAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Hel"), delta("ix"), AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(CoachingPhase.Done, state.phase)
            assertEquals("Helix", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun generateWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()

            assertEquals(CoachingPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun generateThreadsDriveId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-9")
            vm.generate()
            advanceUntilIdle()

            assertEquals("drive-9", source.lastDriveId)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Failed(ErrorKind.Http)))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()

            assertEquals(CoachingPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()

            assertEquals(CoachingPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownNarrative() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), AiStreamChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(CoachingPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                CoachingSurface.Cached("known", offline = true),
                classifyCoaching(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun generateIsNoOpWithoutDrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.coachCalls)
        }

    @Test
    fun generateIsNoOpWithBlankDrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("")
            vm.generate()
            advanceUntilIdle()
            assertEquals(0, source.coachCalls)
        }

    @Test
    fun generateIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()
            vm.generate()
            advanceUntilIdle()

            assertEquals(1, source.coachCalls)
            assertEquals(CoachingPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsGeneration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()
            val before = source.coachCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.coachCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIDriveCoachingViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_DRIVE_COACHING_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun generateEmitsDiagnosticWithoutLeakingDriveId() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(AiStreamChunk.Done))))
            val vm = AIDriveCoachingViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setDrive("drive-1")
            vm.generate()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiDriveCoaching.generate" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("drive_id") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): AiStreamChunk = AiStreamChunk.Delta(text)

    private data class Response(
        val chunks: List<AiStreamChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIDriveCoachingSource {
        var coachCalls = 0
            private set

        var lastDriveId = ""
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun coach(driveId: String): Flow<AiStreamChunk> {
            val response = responses[coachCalls.coerceAtMost(responses.lastIndex)]
            coachCalls++
            lastDriveId = driveId
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
