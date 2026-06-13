// Off-device unit tests for [AIInboxAutoCategorizationViewModel] over controllable fake
// [AiInboxCategorizeStreamSource]s (the :android:testReleaseUnitTest gate). They cover the streaming lifecycle
// the web `useAiStream` composition drives (idle → streaming → done, the captured `tool_result` proposal, the
// accumulated delta text, the terminal error + structured limit, the `confirm_request` pause), the
// cancel/reset-on-scope-change behaviour (web's cleanup effect), the connectivity offline surface, the
// per-feature AI-Off gate (web `withAiFeature`), the double-submit no-op, the offline-suggest no-op, the rule-id
// union the Apply affordance hands to the parent, and the PII-safe `view.opened` diagnostic. Mirrors the web
// component (web/src/components/ai/AIInboxAutoCategorization.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiinboxautocategorization

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AIInboxAutoCategorizationViewModelTest {
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
    ) : AiInboxCategorizeStreamSource {
        var calls = 0
        var lastScope: InboxScope? = null

        override fun categorize(scope: InboxScope): Flow<AiStreamEvent> {
            calls++
            lastScope = scope
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiInboxCategorizeStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun categorize(scope: InboxScope): Flow<AiStreamEvent> {
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
                        AiStreamEvent.Delta("Reviewed 30 alerts…"),
                        toolResult(),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src, initialScope = InboxScope(vehicleId = 1L, windowDays = 14))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(InboxScope(vehicleId = 1L, windowDays = 14), src.lastScope)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiCategorizeRenderState.Content, snapshot.renderState)
            assertEquals(2, snapshot.proposal?.size)
            // The Apply affordance hands the de-duplicated, sorted union of every bucket's rule ids to the parent.
            assertEquals(listOf(3L, 9L, 12L), snapshot.allRuleIds)
            assertTrue(snapshot.applyEnabled)
            assertEquals("Reviewed 30 alerts…", snapshot.streamedText)
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
            assertEquals(AiCategorizeRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "draft_alert_categories", "Apply?")))
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
    fun setScopeCancelsAndResetsCapturedProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(), AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialScope = InboxScope(vehicleId = 1L))
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()
            assertEquals(
                2,
                vm.snapshot.value.proposal
                    ?.size,
            )

            vm.setScope(InboxScope(vehicleId = 2L, severities = listOf("warn")))
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
            assertEquals(AiCategorizeRenderState.Offline, snapshot.renderState)
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
            AIInboxAutoCategorizationViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                initialScope = InboxScope(),
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
            assertEquals(mapOf("surface" to "AIInboxAutoCategorization"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(
            id = "1",
            name = DRAFT_TOOL_NAME,
            ok = true,
            data =
                buildJsonObject {
                    put("status", "ok")
                    put(
                        "categories",
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("category", "Battery")
                                    put("count", 7)
                                    put("rule_ids", ruleArray(9, 3))
                                },
                            )
                            add(
                                buildJsonObject {
                                    put("category", "Charging")
                                    put("count", 4)
                                    put("rule_ids", ruleArray(12, 3))
                                },
                            )
                        },
                    )
                },
            error = null,
        )

    private fun ruleArray(vararg ids: Int): JsonArray = buildJsonArray { ids.forEach { add(it) } }

    private fun TestScope.viewModel(
        source: AiInboxCategorizeStreamSource,
        logger: Logger = RecordingLogger(),
        initialScope: InboxScope = InboxScope(vehicleId = 7L),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AIInboxAutoCategorizationViewModel =
        AIInboxAutoCategorizationViewModel(source, logger, initialScope, connectivity, featureEnabled, backgroundScope)
}
