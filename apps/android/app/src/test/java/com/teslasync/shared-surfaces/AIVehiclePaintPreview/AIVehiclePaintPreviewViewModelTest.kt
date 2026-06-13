// Off-device unit tests for the AIVehiclePaintPreview state holder: the AI-feature gate, the vehicle ->
// canStart binding, the optional style-hint normalization + threading (trim / omit-when-blank / clamp to the
// 80-char cap), the draft-stream reduction (deltas -> done, unterminated -> done, terminal failure frame,
// thrown transport failure, offline last-known retention), the draft/retry actions and their in-flight guard,
// and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivehiclepaintpreview

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
class AIVehiclePaintPreviewViewModelTest {
    // ── gate ──────────────────────────────────────────────────────────────────────
    @Test
    fun gateDisabledHidesSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                AIVehiclePaintPreviewViewModel(
                    FakeSource(enabled = flowOf(false)),
                    RecordingLogger(),
                    backgroundScope,
                    clock = { FIXED_NOW },
                )
            advanceUntilIdle()
            assertFalse(vm.state.value.gateEnabled)
            assertEquals(PaintPreviewSurface.Hidden, classifyPaintPreview(vm.state.value, FIXED_NOW))
        }

    @Test
    fun gateEnabledShowsSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIVehiclePaintPreviewViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            advanceUntilIdle()
            assertTrue(vm.state.value.gateEnabled)
        }

    // ── vehicle / canStart ──────────────────────────────────────────────────────────
    @Test
    fun setVehicleDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIVehiclePaintPreviewViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(7L)
            assertEquals(7L, vm.state.value.vehicleId)
            assertTrue(vm.state.value.canStart)
            vm.setVehicle(null)
            assertFalse(vm.state.value.canStart)
        }

    @Test
    fun nonPositiveVehicleIdDisablesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = AIVehiclePaintPreviewViewModel(FakeSource(), RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(0L)
            assertFalse(vm.state.value.canStart)
            vm.setVehicle(-2L)
            assertFalse(vm.state.value.canStart)
        }

    // ── style hint ──────────────────────────────────────────────────────────────────
    @Test
    fun draftThreadsVehicleAndDefaultsToNoStyleHint() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.draft()
            advanceUntilIdle()

            assertEquals(9L, source.lastVehicleId)
            assertNull(source.lastStyleHint)
        }

    @Test
    fun setStyleHintThreadsTrimmedHint() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setStyleHint("  studio  ")
            vm.draft()
            advanceUntilIdle()

            assertEquals("studio", source.lastStyleHint)
        }

    @Test
    fun blankStyleHintIsOmitted() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setStyleHint("   ")
            vm.draft()
            advanceUntilIdle()

            assertNull(source.lastStyleHint)
        }

    @Test
    fun longStyleHintIsClampedToServerCap() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(9L)
            vm.setStyleHint("z".repeat(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS + 25))
            vm.draft()
            advanceUntilIdle()

            assertEquals(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS, source.lastStyleHint?.length)
        }

    // ── stream reduction ─────────────────────────────────────────────────────────────
    @Test
    fun draftAccumulatesDeltasThenCommitsOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(responses = listOf(Response(listOf(delta("Stealth "), delta("Grey"), PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(PaintPreviewPhase.Done, state.phase)
            assertEquals("Stealth Grey", state.committedText)
            assertEquals(FIXED_NOW, state.fetchedAt)
        }

    @Test
    fun draftWithoutTerminalFrameFinishesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("a"), delta("b")))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()

            assertEquals(PaintPreviewPhase.Done, vm.state.value.phase)
            assertEquals("ab", vm.state.value.committedText)
        }

    @Test
    fun terminalFailureFrameMarksFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Failed(ErrorKind.Http)))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()

            assertEquals(PaintPreviewPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Http, vm.state.value.errorKind)
        }

    @Test
    fun thrownTransportFailureIsClassified() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(error = ApiError.Network())))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()

            assertEquals(PaintPreviewPhase.Failed, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun networkFailureKeepsLastKnownDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    responses =
                        listOf(
                            Response(listOf(delta("known"), PaintPreviewChunk.Done)),
                            Response(error = ApiError.Network()),
                        ),
                )
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(PaintPreviewPhase.Failed, state.phase)
            assertEquals("known", state.committedText)
            assertEquals(
                PaintPreviewSurface.Cached("known", offline = true),
                classifyPaintPreview(state, FIXED_NOW),
            )
        }

    // ── action guards ─────────────────────────────────────────────────────────────
    @Test
    fun draftIsNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.draft()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun draftIsNoOpWithNonPositiveVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(0L)
            vm.draft()
            advanceUntilIdle()
            assertEquals(0, source.draftCalls)
        }

    @Test
    fun draftIsNoOpWhileStreaming() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(delta("partial")))), hold = true)
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()
            vm.draft()
            advanceUntilIdle()

            assertEquals(1, source.draftCalls)
            assertEquals(PaintPreviewPhase.Streaming, vm.state.value.phase)
        }

    @Test
    fun retryReRunsDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, RecordingLogger(), backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.draft()
            advanceUntilIdle()
            val before = source.draftCalls
            vm.retry()
            advanceUntilIdle()
            assertTrue(source.draftCalls > before)
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AIVehiclePaintPreviewViewModel(FakeSource(), logger, backgroundScope, clock = { FIXED_NOW })
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(AI_VEHICLE_PAINT_PREVIEW_SLUG, opened.first().fields["slug"])
        }

    @Test
    fun draftEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(responses = listOf(Response(listOf(PaintPreviewChunk.Done))))
            val vm = AIVehiclePaintPreviewViewModel(source, logger, backgroundScope, clock = { FIXED_NOW })
            vm.setVehicle(1L)
            vm.setStyleHint("studio")
            vm.draft()
            advanceUntilIdle()

            assertTrue(logger.records.any { it.event == "aiVehiclePaintPreview.draft" })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("vehicle_id") })
            assertNull(logger.records.firstOrNull { it.fields.containsKey("style_hint") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private fun delta(text: String): PaintPreviewChunk = PaintPreviewChunk.Delta(text)

    private data class Response(
        val chunks: List<PaintPreviewChunk> = emptyList(),
        val error: Throwable? = null,
    )

    private class FakeSource(
        private val enabled: Flow<Boolean> = flowOf(true),
        private val responses: List<Response> = listOf(Response()),
        private val hold: Boolean = false,
    ) : AIVehiclePaintPreviewSource {
        var draftCalls = 0
            private set

        var lastVehicleId = -1L
            private set

        var lastStyleHint: String? = null
            private set

        override fun aiEnabled(): Flow<Boolean> = enabled

        override fun draft(
            vehicleId: Long,
            styleHint: String?,
        ): Flow<PaintPreviewChunk> {
            val response = responses[draftCalls.coerceAtMost(responses.lastIndex)]
            draftCalls++
            lastVehicleId = vehicleId
            lastStyleHint = styleHint
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
