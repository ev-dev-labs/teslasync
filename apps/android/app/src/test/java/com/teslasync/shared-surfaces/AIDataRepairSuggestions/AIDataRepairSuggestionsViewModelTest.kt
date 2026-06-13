// Off-device unit tests for [AIDataRepairSuggestionsViewModel] over controllable fake [AiDraftStreamSource]s
// (the :android:testReleaseUnitTest gate). They cover the streaming lifecycle the web `useAiStream` composition
// drives (idle → streaming → done, accumulated delta text, the terminal error + structured limit, the
// `confirm_request` pause), cancellation, the connectivity offline surface, the per-feature AI-Off gate (web
// `withAiFeature`), the double-submit no-op, the last-known-plan retention behind the stale surface, and the
// PII-safe `view.opened` diagnostic. Mirrors the web component
// (web/src/components/ai/AIDataRepairSuggestions.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aidatarepairsuggestions

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
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
class AIDataRepairSuggestionsViewModelTest {
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

    /** Emits a scripted sequence then completes — the common terminal-state fake. */
    private class ScriptedSource(
        private val events: List<AiStreamEvent>,
    ) : AiDraftStreamSource {
        var calls = 0

        override fun draftPlan(): Flow<AiStreamEvent> {
            calls++
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiDraftStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun draftPlan(): Flow<AiStreamEvent> {
            calls++
            return channel.receiveAsFlow()
        }
    }

    /** Returns each supplied flow in turn — lets one view-model script a completing draft then a held refresh. */
    private class QueuedSource(
        private val flows: MutableList<Flow<AiStreamEvent>>,
    ) : AiDraftStreamSource {
        var calls = 0

        override fun draftPlan(): Flow<AiStreamEvent> {
            calls++
            return flows.removeAt(0)
        }
    }

    @Test
    fun draftStreamsThenCompletesWithPlan() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                ScriptedSource(
                    listOf(
                        AiStreamEvent.Delta("Reviewed inventory. "),
                        AiStreamEvent.Delta("Close stale session #842."),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiDataRepairRenderState.Content, snapshot.renderState)
            assertEquals("Reviewed inventory. Close stale session #842.", snapshot.text)
        }

    @Test
    fun streamErrorTransitionsToErrorWithStructuredLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.StreamError("capped", "cost_cap", 30, "warn", true)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.Error, snapshot.phase)
            assertEquals(AiDataRepairRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "draft_repair_plan", "Apply?")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.PausedConfirm, snapshot.phase)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun cancelReturnsStreamingToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.snapshot.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
            src.channel.close()
        }

    @Test
    fun doubleDraftWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()
            vm.draft()
            advanceUntilIdle()

            assertEquals(1, src.calls)
            src.channel.close()
        }

    @Test
    fun offlineConnectivityRendersOfflineAndDisablesDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val connectivity = MutableStateFlow(true)
            val vm = viewModel(ScriptedSource(emptyList()), connectivity = connectivity)
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.canStart)

            connectivity.value = false
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiDataRepairRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun draftWhileOfflineIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, connectivity = MutableStateFlow(false))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun refreshAfterCompletionKeepsLastPlanVisibleAsStale() =
        runTest(UnconfinedTestDispatcher()) {
            val held = Channel<AiStreamEvent>(Channel.UNLIMITED)
            val src =
                QueuedSource(
                    mutableListOf(
                        flow {
                            emit(AiStreamEvent.Delta("Plan A"))
                            emit(AiStreamEvent.Done("stop"))
                        },
                        held.receiveAsFlow(),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.draft()
            advanceUntilIdle()
            assertEquals(AiDataRepairRenderState.Content, vm.snapshot.value.renderState)
            assertEquals("Plan A", vm.snapshot.value.text)

            vm.draft()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(2, src.calls)
            assertEquals(AiDataRepairRenderState.Stale, snapshot.renderState)
            assertTrue(snapshot.isBusy)
            // The last completed plan stays visible while the refresh streams (never blanked).
            assertEquals("Plan A", snapshot.text)
            held.close()
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AIDataRepairSuggestionsViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                connectivity = MutableStateFlow(true),
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
            assertEquals(mapOf("surface" to "AIDataRepairSuggestions"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: AiDraftStreamSource,
        logger: Logger = RecordingLogger(),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AIDataRepairSuggestionsViewModel = AIDataRepairSuggestionsViewModel(source, logger, connectivity, featureEnabled, backgroundScope)
}
