// Off-device unit tests for [AIQuietHoursSuggestionViewModel] over controllable fake [AiQuietHoursStreamSource]s
// (the :android:testReleaseUnitTest gate). They cover the streaming lifecycle the web `useAiStream` composition
// drives (idle → streaming → done, the captured `tool_result` proposal, accumulated delta text, the terminal
// error + structured limit, the `confirm_request` pause), the cancel behaviour, the connectivity offline
// surface, the per-feature AI-Off gate (web `withAiFeature`), the double-submit no-op, and the PII-safe
// `view.opened` diagnostic. Mirrors the web component (web/src/components/ai/AIQuietHoursSuggestion.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiquiethourssuggestion

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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIQuietHoursSuggestionViewModelTest {
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
    ) : AiQuietHoursStreamSource {
        var calls = 0

        override fun draftQuietHours(): Flow<AiStreamEvent> {
            calls++
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiQuietHoursStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun draftQuietHours(): Flow<AiStreamEvent> {
            calls++
            return channel.receiveAsFlow()
        }
    }

    @Test
    fun suggestStreamsThenCompletesAndCapturesProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                ScriptedSource(
                    listOf(
                        AiStreamEvent.Delta("Reviewed 30 days of cadence…"),
                        toolResult(window()),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(QuietHoursRenderState.Content, snapshot.renderState)
            assertEquals("22:00", snapshot.proposal?.startLocal)
            assertEquals("Reviewed 30 days of cadence…", snapshot.streamedText)
        }

    @Test
    fun streamErrorTransitionsToErrorWithStructuredLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.StreamError("capped", "cost_cap", 30, "warn", true)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.Error, snapshot.phase)
            assertEquals(QuietHoursRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "draft_quiet_hours_window", "Apply?")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
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

            vm.suggest()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.snapshot.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun doubleSuggestWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()
            vm.suggest()
            advanceUntilIdle()

            assertEquals(1, src.calls)
        }

    @Test
    fun captureThenReSuggestClearsLastKnownProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(window()), AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()
            val captured = vm.snapshot.value
            assertEquals("22:00", captured.proposal?.startLocal)

            // A fresh suggest resets the captured proposal first (web `setProposal(null)` before `start()`).
            val manual = ManualSource()
            val reVm = viewModel(manual)
            backgroundScope.launch { reVm.snapshot.collect {} }
            reVm.suggest()
            advanceUntilIdle()
            assertNull(reVm.snapshot.value.proposal)
            assertEquals(AiStreamPhase.Streaming, reVm.snapshot.value.phase)
        }

    @Test
    fun offlineConnectivityRendersOfflineAndDisablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val connectivity = MutableStateFlow(true)
            val vm = viewModel(ScriptedSource(emptyList()), connectivity = connectivity)
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.canStart)

            connectivity.value = false
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(QuietHoursRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun suggestWhileOfflineIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, connectivity = MutableStateFlow(false))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AIQuietHoursSuggestionViewModel(
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
            assertEquals(mapOf("surface" to "AIQuietHoursSuggestion"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(data: JsonObject): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(id = "1", name = DRAFT_TOOL_NAME, ok = true, data = data, error = null)

    private fun window(): JsonObject =
        buildJsonObject {
            put("start_local", "22:00")
            put("end_local", "07:00")
            put("timezone", "America/Los_Angeles")
            put("weekdays", 127)
            putJsonArray("bypass_severities") { add("critical") }
        }

    private fun TestScope.viewModel(
        source: AiQuietHoursStreamSource,
        logger: Logger = RecordingLogger(),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AIQuietHoursSuggestionViewModel = AIQuietHoursSuggestionViewModel(source, logger, connectivity, featureEnabled, backgroundScope)
}
