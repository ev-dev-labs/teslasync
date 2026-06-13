// Off-device unit tests for [AIFeatureCardViewModel] over controllable fake [AiFeatureCardStreamSource]s (the
// :android:testReleaseUnitTest gate). They cover the streaming lifecycle the web `useAiStream` composition drives
// (idle → streaming → done, accumulated delta text, the mid-stream stale surface, the terminal error, the
// `confirm_request` pause, the complete-without-terminal-frame promotion to done), the cancel-to-idle behaviour,
// the connectivity offline surface, the per-feature AI-Off gate (web `withAiFeature`), the double-submit and
// not-ready / offline no-ops, and the PII-safe `view.opened` diagnostic. Mirrors the web scaffold
// (web/src/components/ai/AIFeatureCard.tsx + web/src/hooks/useAiStream.ts).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIFeatureCardViewModelTest {
    @Test
    fun startStreamsThenCompletesAndCapturesText() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                ScriptedSource(
                    listOf(
                        AiStreamEvent.Delta("Reviewed the drive… "),
                        AiStreamEvent.Delta("no anomalies."),
                        AiStreamEvent.Done,
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiOutputSurface.Content, snapshot.surface)
            assertEquals("Reviewed the drive… no anomalies.", snapshot.text)
        }

    @Test
    fun streamingOverDeltaTextRendersStale() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()
            assertEquals(AiOutputSurface.Thinking, vm.snapshot.value.surface)

            src.channel.send(AiStreamEvent.Delta("partial output"))
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiOutputSurface.Stale, snapshot.surface)
            assertTrue(snapshot.stale)
            assertTrue(snapshot.busy)
        }

    @Test
    fun streamErrorTransitionsToErrorSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.StreamError("stream_http_503")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.Error, snapshot.phase)
            assertEquals(AiOutputSurface.Error, snapshot.surface)
            assertEquals("stream_http_503", snapshot.error)
        }

    @Test
    fun confirmRequestPausesAndKeepsActionAvailable() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("Apply this change?")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.PausedConfirm, snapshot.phase)
            // paused-confirm is not "streaming", so the action is available again (web `isStreaming` false).
            assertTrue(snapshot.actionEnabled)
        }

    @Test
    fun completeWithoutTerminalFrameSettlesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Delta("output, no done frame")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Done, vm.snapshot.value.phase)
            assertEquals(AiOutputSurface.Content, vm.snapshot.value.surface)
        }

    @Test
    fun cancelReturnsStreamingToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.snapshot.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun doubleStartWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()
            vm.start()
            advanceUntilIdle()

            assertEquals(1, src.calls)
        }

    @Test
    fun startWhenNotReadyIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done))
            val vm = viewModel(src, canStartFlow = MutableStateFlow(false))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun startWhileOfflineIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done))
            val vm = viewModel(src, connectivity = MutableStateFlow(false))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.start()
            advanceUntilIdle()

            assertEquals(0, src.calls)
        }

    @Test
    fun offlineConnectivityRendersOfflineAndDisablesAction() =
        runTest(UnconfinedTestDispatcher()) {
            val connectivity = MutableStateFlow(true)
            val vm = viewModel(ScriptedSource(emptyList()), connectivity = connectivity)
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.actionEnabled)

            connectivity.value = false
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiOutputSurface.Offline, snapshot.surface)
            assertFalse(snapshot.actionEnabled)
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AIFeatureCardViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                featureEnabled = enabled,
            )
        assertFalse(vm.gated.value)
        enabled.value = true
        assertTrue(vm.gated.value)
    }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(ScriptedSource(emptyList()), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AIFeatureCard"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: AiFeatureCardStreamSource,
        logger: Logger = RecordingLogger(),
        canStartFlow: StateFlow<Boolean> = MutableStateFlow(true),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AIFeatureCardViewModel = AIFeatureCardViewModel(source, logger, canStartFlow, connectivity, featureEnabled, backgroundScope)
}
