// Off-device unit tests for [AIAlertTuningSuggestionsViewModel] over controllable fake [AiTuningStreamSource]s
// (the :android:testReleaseUnitTest gate). They cover the streaming lifecycle the web `useAiStream` composition
// drives (idle → streaming → done, the captured `tool_result` proposal, accumulated delta text, the terminal
// error + structured limit, the `confirm_request` pause), the cancel/reset-on-rule-change behaviour (web's
// cleanup effect), the connectivity offline surface, the per-feature AI-Off gate (web `withAiFeature`), the
// double-submit no-op, and the PII-safe `view.opened` diagnostic. Mirrors the web component
// (web/src/components/ai/AIAlertTuningSuggestions.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aialerttuningsuggestions

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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIAlertTuningSuggestionsViewModelTest {
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
    ) : AiTuningStreamSource {
        var calls = 0
        var lastRuleId = -1L
        var lastVehicleId: Long? = null

        override fun draftTuning(
            ruleId: Long,
            vehicleId: Long?,
        ): Flow<AiStreamEvent> {
            calls++
            lastRuleId = ruleId
            lastVehicleId = vehicleId
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiTuningStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun draftTuning(
            ruleId: Long,
            vehicleId: Long?,
        ): Flow<AiStreamEvent> {
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
                        AiStreamEvent.Delta("Reviewed 12 firings…"),
                        toolResult(buildProposed()),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(42L, src.lastRuleId)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiTuningRenderState.Content, snapshot.renderState)
            assertEquals("<", snapshot.proposal?.op)
            assertEquals("Reviewed 12 firings…", snapshot.streamedText)
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
            assertEquals(AiTuningRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "draft_alert_rule_patch", "Apply?")))
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
    fun setRuleCancelsAndResetsCapturedProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(buildProposed()), AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialTarget = RuleTarget(1L, null))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()
            val afterSuggest = vm.snapshot.value
            assertEquals("<", afterSuggest.proposal?.op)

            vm.setRule(2L, 5L)
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertNull(snapshot.proposal)
            assertEquals(AiStreamPhase.Idle, snapshot.phase)
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
            assertEquals(AiTuningRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun suggestWithNoRuleSelectedIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialTarget = RuleTarget(0L, null))
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
            AIAlertTuningSuggestionsViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                initialTarget = RuleTarget(1L, null),
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
            assertEquals(mapOf("surface" to "AIAlertTuningSuggestions"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(proposed: JsonObject): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(
            id = "1",
            name = DRAFT_TOOL_NAME,
            ok = true,
            data =
                buildJsonObject {
                    put("status", "ok")
                    put("proposed", proposed)
                },
            error = null,
        )

    private fun buildProposed(): JsonObject = buildJsonObject { put("op", "<") }

    private fun TestScope.viewModel(
        source: AiTuningStreamSource,
        logger: Logger = RecordingLogger(),
        initialTarget: RuleTarget = RuleTarget(42L, null),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AIAlertTuningSuggestionsViewModel =
        AIAlertTuningSuggestionsViewModel(source, logger, initialTarget, connectivity, featureEnabled, backgroundScope)
}
