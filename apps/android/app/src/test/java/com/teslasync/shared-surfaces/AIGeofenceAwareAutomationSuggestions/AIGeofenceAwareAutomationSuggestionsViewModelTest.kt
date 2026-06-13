// Off-device unit tests for [AIGeofenceAwareAutomationSuggestionsViewModel] over controllable fake
// [AiGeofenceStreamSource]s (the :android:testReleaseUnitTest gate). They cover the streaming lifecycle the web
// `useAiStream` composition drives (idle → streaming → done, the captured `tool_result` automation graph,
// accumulated delta text, the terminal error + structured limit, the `confirm_request` pause), the prompt-gating
// the web `canStart` enforces (blank prompt → no-op; setting the prompt enables suggest), the cancel/reset-on-
// vehicle-change behaviour (web's cleanup effect), the connectivity offline surface, the per-feature AI-Off gate
// (web `withAiFeature`), the double-submit no-op, and the PII-safe `view.opened` diagnostic. Mirrors the web
// component (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

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
class AIGeofenceAwareAutomationSuggestionsViewModelTest {
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
    ) : AiGeofenceStreamSource {
        var calls = 0
        var lastVehicleId = -1L
        var lastPrompt: String? = null

        override fun draftAutomation(
            vehicleId: Long,
            prompt: String,
        ): Flow<AiStreamEvent> {
            calls++
            lastVehicleId = vehicleId
            lastPrompt = prompt
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiGeofenceStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0

        override fun draftAutomation(
            vehicleId: Long,
            prompt: String,
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
                        AiStreamEvent.Delta("Drafting a graph anchored to Home…"),
                        toolResult(status = "ok"),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(7L, src.lastVehicleId)
            assertEquals("warm the cabin when I arrive home", src.lastPrompt)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(GeofenceDraftRenderState.Content, snapshot.renderState)
            assertTrue(snapshot.proposal?.isOk == true)
            assertEquals("Home protection", snapshot.proposal?.graph?.name)
            assertEquals("Drafting a graph anchored to Home…", snapshot.streamedText)
        }

    @Test
    fun suggestCapturesNonOkProposalForReviewerRejectedGraph() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(status = "invalid", validationError = "place_id not found")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            val proposal = vm.snapshot.value.proposal
            assertFalse(proposal?.isOk == true)
            assertEquals("place_id not found", proposal?.validationError)
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
            assertEquals(GeofenceDraftRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun confirmRequestPausesAndDisablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.ConfirmRequest("c1", "draft_automation_graph", "Apply?")))
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
    fun setVehicleCancelsAndResetsCapturedProposal() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(toolResult(status = "ok"), AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialVehicleId = 1L)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()
            assertTrue(
                vm.snapshot.value.proposal
                    ?.isOk == true,
            )

            vm.setVehicle(2L)
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
            assertEquals(GeofenceDraftRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun suggestWithNoVehicleSelectedIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, initialVehicleId = 0L)
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun suggestWithBlankPromptIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, prompt = "   ")
            backgroundScope.launch { vm.snapshot.collect {} }

            vm.suggest()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertFalse(vm.snapshot.value.canStart)
        }

    @Test
    fun setPromptEnablesSuggest() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(ScriptedSource(emptyList()), prompt = "")
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertFalse(vm.snapshot.value.canStart)

            vm.setPrompt("turn on cabin overheat protection at Home")
            advanceUntilIdle()

            assertEquals("turn on cabin overheat protection at Home", vm.prompt.value)
            assertTrue(vm.snapshot.value.canStart)
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AIGeofenceAwareAutomationSuggestionsViewModel(
                source = ScriptedSource(emptyList()),
                logger = RecordingLogger(),
                initialVehicleId = 1L,
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
            assertEquals(mapOf("surface" to "AIGeofenceAwareAutomationSuggestions"), opened.single().second)
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(
        status: String,
        validationError: String? = null,
    ): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(
            id = "1",
            name = DRAFT_TOOL_NAME,
            ok = true,
            data =
                buildJsonObject {
                    put("status", status)
                    if (validationError != null) put("validation_error", validationError)
                    put("draft", draftJson())
                },
            error = null,
        )

    private fun draftJson(): JsonObject =
        buildJsonObject {
            put("name", "Home protection")
            put("vehicle_id", 7)
            put("enabled", true)
            put("description", "Cabin overheat protection at Home after sunset")
            putJsonArray("triggers") { add(buildJsonObject { put("type", "geofence_enter") }) }
            putJsonArray("conditions") { add(buildJsonObject { put("type", "time_window") }) }
            putJsonArray("actions") { add(buildJsonObject { put("type", "command") }) }
        }

    private fun TestScope.viewModel(
        source: AiGeofenceStreamSource,
        logger: Logger = RecordingLogger(),
        initialVehicleId: Long = 7L,
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        prompt: String = "warm the cabin when I arrive home",
    ): AIGeofenceAwareAutomationSuggestionsViewModel {
        val vm =
            AIGeofenceAwareAutomationSuggestionsViewModel(
                source,
                logger,
                initialVehicleId,
                connectivity,
                MutableStateFlow(true),
                backgroundScope,
            )
        vm.setPrompt(prompt)
        return vm
    }
}
