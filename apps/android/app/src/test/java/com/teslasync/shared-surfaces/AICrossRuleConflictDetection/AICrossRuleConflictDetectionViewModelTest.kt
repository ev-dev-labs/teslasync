// Off-device unit tests for [AICrossRuleConflictDetectionViewModel] over controllable fake
// [AiConflictStreamSource]s (the :app:testReleaseUnitTest gate). They cover the streaming lifecycle the web
// `useAiStream` composition drives (idle → streaming → done, the captured `tool_result` conflict list, accumulated
// delta text, the terminal error + structured limit, the `confirm_request` pause), the cancel/reset-on-rule-set
// change behaviour (web's cleanup effect), the connectivity offline surface, the per-feature AI-Off gate (web
// `withAiFeature`), the double-submit + fewer-than-two-rules no-ops, and the PII-safe `view.opened` diagnostic.
// Mirrors the web component (web/src/components/ai/AICrossRuleConflictDetection.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aicrossruleconflictdetection

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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AICrossRuleConflictDetectionViewModelTest {
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
    ) : AiConflictStreamSource {
        var calls = 0
        var lastRuleIds: List<Long> = emptyList()
        var lastVehicleId: Long? = null

        override fun detectConflicts(
            ruleIds: List<Long>,
            vehicleId: Long?,
        ): Flow<AiStreamEvent> {
            calls++
            lastRuleIds = ruleIds
            lastVehicleId = vehicleId
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiConflictStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun detectConflicts(
            ruleIds: List<Long>,
            vehicleId: Long?,
        ): Flow<AiStreamEvent> {
            calls++
            return channel.receiveAsFlow()
        }
    }

    @Test
    fun detectStreamsThenCompletesAndCapturesConflicts() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                ScriptedSource(
                    listOf(
                        AiStreamEvent.Delta("Reviewed 5 rules…"),
                        toolResult(sampleConflicts()),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(listOf(1L, 2L), src.lastRuleIds)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiConflictsRenderState.Content, snapshot.renderState)
            assertEquals(1, snapshot.conflicts.size)
            assertEquals("overlapping_threshold", snapshot.conflicts.first().kind)
            assertEquals("Reviewed 5 rules…", snapshot.streamedText)
        }

    @Test
    fun detectForwardsVehicleScopeToSource() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialTarget = RulesTarget(listOf(3L, 4L), 99L))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()

            assertEquals(listOf(3L, 4L), src.lastRuleIds)
            assertEquals(99L, src.lastVehicleId)
        }

    @Test
    fun emptyConflictArrayRendersResolvedEmptyState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(buildJsonArray {}), AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiConflictsRenderState.Empty, snapshot.renderState)
            assertTrue(snapshot.hasResult)
            assertTrue(snapshot.conflicts.isEmpty())
        }

    @Test
    fun streamErrorTransitionsToErrorWithStructuredLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.StreamError("capped", "cost_cap", 30, "warn", true)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.Error, snapshot.phase)
            assertEquals(AiConflictsRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesDetect() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "detect_rule_conflicts", "Proceed?")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
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

            vm.detect()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.snapshot.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun doubleDetectWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()
            vm.detect()
            advanceUntilIdle()

            assertEquals(1, src.calls)
        }

    @Test
    fun setRulesCancelsAndResetsCapturedConflicts() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(sampleConflicts()), AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialTarget = RulesTarget(listOf(1L, 2L), null))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()
            assertEquals(1, vm.snapshot.value.conflicts.size)

            vm.setRules(listOf(3L, 4L), 5L)
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertFalse(snapshot.hasResult)
            assertTrue(snapshot.conflicts.isEmpty())
            assertEquals(AiStreamPhase.Idle, snapshot.phase)
        }

    @Test
    fun offlineConnectivityRendersOfflineAndDisablesDetect() =
        runTest(UnconfinedTestDispatcher()) {
            val connectivity = MutableStateFlow(true)
            val vm = viewModel(ScriptedSource(emptyList()), connectivity = connectivity)
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.canStart)

            connectivity.value = false
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiConflictsRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun detectWithFewerThanTwoRulesIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialTarget = RulesTarget(listOf(1L), null))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.detect()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
            assertFalse(vm.snapshot.value.canStart)
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AICrossRuleConflictDetectionViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                initialTarget = RulesTarget(listOf(1L, 2L), null),
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
            assertEquals(mapOf("surface" to "AICrossRuleConflictDetection"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(conflicts: JsonArray): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(
            id = "1",
            name = DETECT_TOOL_NAME,
            ok = true,
            data = buildJsonObject { put("conflicts", conflicts) },
            error = null,
        )

    private fun sampleConflicts(): JsonArray =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("kind", "overlapping_threshold")
                    put("rule_a_id", 7)
                    put("rule_b_id", 9)
                },
            )
        }

    private fun TestScope.viewModel(
        source: AiConflictStreamSource,
        logger: Logger = RecordingLogger(),
        initialTarget: RulesTarget = RulesTarget(listOf(1L, 2L), null),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AICrossRuleConflictDetectionViewModel =
        AICrossRuleConflictDetectionViewModel(source, logger, initialTarget, connectivity, featureEnabled, backgroundScope)
}
