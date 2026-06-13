// Off-device unit tests for [AINLDashboardComposerViewModel] over controllable fake [AiNlDashboardStreamSource]s
// (the :app:testReleaseUnitTest gate). They cover the streaming lifecycle the web `useAiStream` composition drives
// (idle → streaming → done, the captured `draft_dashboard_layout` tool_result, accumulated delta text, the
// terminal error + structured limit), the prompt → canStart binding (web `hasPrompt`), the prompt-trimming +
// forwarding to the source (web body `{ prompt }`), the cancel-returns-to-idle behaviour, the connectivity
// offline surface, the per-feature AI-Off gate (web `withAiFeature`), the double-submit + blank-prompt no-ops, the
// apply guard (web `canApply`), the resolved-empty (no draft) state, the one-shot PII-safe `view.opened`
// diagnostic, and the PII guarantee that the prompt is never logged. Mirrors the web component
// (web/src/components/ai/AINLDashboardComposer.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldashboardcomposer

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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AINLDashboardComposerViewModelTest {
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
    ) : AiNlDashboardStreamSource {
        var calls = 0
            private set
        var lastPrompt: String? = null
            private set

        override fun draft(prompt: String): Flow<AiStreamEvent> {
            calls++
            lastPrompt = prompt
            return flow { events.forEach { emit(it) } }
        }
    }

    /** A channel-backed fake whose stream stays open until [channel] is closed — for transient-state assertions. */
    private class ManualSource : AiNlDashboardStreamSource {
        val channel = Channel<AiStreamEvent>(Channel.UNLIMITED)
        var calls = 0
            private set

        override fun draft(prompt: String): Flow<AiStreamEvent> {
            calls++
            return channel.receiveAsFlow()
        }
    }

    @Test
    fun draftStreamsThenCompletesAndCapturesDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                ScriptedSource(
                    listOf(
                        AiStreamEvent.Delta("Drafting…"),
                        draftToolResult(),
                        AiStreamEvent.Done("stop"),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview dashboard")

            vm.draftDashboard()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(1, src.calls)
            assertEquals(AiStreamPhase.Done, snapshot.phase)
            assertEquals(AiNlDashboardRenderState.Content, snapshot.renderState)
            assertNotNull(snapshot.draft)
            assertEquals("Overview", snapshot.draft?.dashboard?.title)
            assertEquals("Drafting…", snapshot.streamedText)
            assertTrue(snapshot.canApply)
        }

    @Test
    fun draftTrimsAndForwardsPromptToSource() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("   give me an overview   ")

            vm.draftDashboard()
            advanceUntilIdle()

            assertEquals("give me an overview", src.lastPrompt)
        }

    @Test
    fun setPromptDrivesCanStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(ScriptedSource(emptyList()))
            backgroundScope.launch { vm.snapshot.collect {} }
            advanceUntilIdle()
            assertFalse(vm.snapshot.value.canStart)

            vm.setPrompt("an overview")
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.canStart)

            vm.setPrompt("   ")
            advanceUntilIdle()
            assertFalse(vm.snapshot.value.canStart)
        }

    @Test
    fun streamErrorTransitionsToErrorWithStructuredLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.StreamError("capped", "cost_cap", 30, "warn", true)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiStreamPhase.Error, snapshot.phase)
            assertEquals(AiNlDashboardRenderState.Error, snapshot.renderState)
            assertEquals("capped", snapshot.errorMessage)
            assertEquals("cost_cap", snapshot.limit?.reason)
            assertEquals(30, snapshot.limit?.retryAfterS)
        }

    @Test
    fun cancelReturnsStreamingToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.snapshot.value.phase)

            vm.cancel()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun doubleDraftWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ManualSource()
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()
            vm.draftDashboard()
            advanceUntilIdle()

            assertEquals(1, src.calls)
        }

    @Test
    fun draftWithBlankPromptIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("   ")

            vm.draftDashboard()
            advanceUntilIdle()

            assertEquals(0, src.calls)
            assertEquals(AiStreamPhase.Idle, vm.snapshot.value.phase)
        }

    @Test
    fun offlineConnectivityRendersOfflineAndDisablesDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val connectivity = MutableStateFlow(true)
            val vm = viewModel(ScriptedSource(emptyList()), connectivity = connectivity)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")
            advanceUntilIdle()
            assertTrue(vm.snapshot.value.canStart)

            connectivity.value = false
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiNlDashboardRenderState.Offline, snapshot.renderState)
            assertFalse(snapshot.canStart)
        }

    @Test
    fun draftIsGatedOutWhileOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src, connectivity = MutableStateFlow(false))
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()

            assertEquals(0, src.calls)
        }

    @Test
    fun doneWithoutDraftIsResolvedEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()

            val snapshot = vm.snapshot.value
            assertEquals(AiNlDashboardRenderState.Empty, snapshot.renderState)
            assertTrue(snapshot.hasResult)
            assertNull(snapshot.draft)
            assertFalse(snapshot.canApply)
        }

    @Test
    fun retryReRunsDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val src = ScriptedSource(listOf(AiStreamEvent.Done("stop")))
            val vm = viewModel(src)
            backgroundScope.launch { vm.snapshot.collect {} }
            vm.setPrompt("overview")

            vm.draftDashboard()
            advanceUntilIdle()
            vm.retry()
            advanceUntilIdle()

            assertEquals(2, src.calls)
        }

    @Test
    fun gatedReflectsFeatureEnabledFlag() {
        val enabled = MutableStateFlow(false)
        val vm =
            AINLDashboardComposerViewModel(
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
            assertEquals(mapOf("surface" to "AINLDashboardComposer"), opened.single().second)
        }

    @Test
    fun draftNeverLogsThePromptText() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = ScriptedSource(listOf(draftToolResult(), AiStreamEvent.Done("stop")))
            val vm = viewModel(src, logger = logger)
            val secret = "garage-code-7788-private"
            vm.setPrompt(secret)

            vm.recordViewOpened()
            vm.draftDashboard()
            advanceUntilIdle()

            val leaked =
                logger.events.any { (event, fields) ->
                    event.contains(secret) || fields.values.any { it.contains(secret) }
                }
            assertFalse(leaked)
            assertTrue(logger.events.any { it.first == "aiNlDashboard.draft" })
        }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun draftToolResult(): AiStreamEvent.ToolResult =
        AiStreamEvent.ToolResult(
            id = "1",
            name = DRAFT_TOOL_NAME,
            ok = true,
            data =
                buildJsonObject {
                    put("status", "ok")
                    putJsonObject("draft") {
                        put("prompt", "echo")
                        put("rationale", "Because you asked.")
                        putJsonObject("dashboard") {
                            put("title", "Overview")
                            putJsonArray("slots") {
                                addJsonObject {
                                    put("panel_name", "daily_drives")
                                    putJsonObject("grid_pos") {
                                        put("x", 0)
                                        put("y", 0)
                                        put("w", 6)
                                        put("h", 4)
                                    }
                                }
                            }
                        }
                        putJsonArray("referenced_panels") { add("daily_drives") }
                    }
                },
            error = null,
        )

    private fun TestScope.viewModel(
        source: AiNlDashboardStreamSource,
        logger: Logger = RecordingLogger(),
        connectivity: StateFlow<Boolean> = MutableStateFlow(true),
        featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    ): AINLDashboardComposerViewModel = AINLDashboardComposerViewModel(source, logger, connectivity, featureEnabled, backgroundScope)
}
