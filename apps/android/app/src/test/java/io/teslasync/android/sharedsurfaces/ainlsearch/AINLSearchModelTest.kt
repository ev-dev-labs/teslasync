package io.teslasync.android.sharedsurfaces.ainlsearch

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
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

/**
 * Off-device verification of the AINLSearch surface's pure logic + stream lifecycle — the native analogue of
 * every derivation the web component + useAiStream perform (web/src/components/ai/AINLSearch.tsx,
 * web/src/hooks/useAiStream.ts): the `{ prompt }` request-body serializer ([searchRequestBody]), the action
 * readiness gate ([isSearchReady]), the SSE wire parser ([parseSseFrame], [SseFrameAccumulator]), the stream
 * reducer ([reduceSearch]), the withAiFeature off-mode gate ([isNlSearchEnabled]), the PII-safe `view.opened`
 * diagnostic, and the [NlSearchController] lifecycle (idle → streaming → done / error, cancellation, coalescing,
 * and the offline/blank-query gate) driven over a scripted [NlSearchTransport] with no real network. Run by the
 * `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AINLSearchModelTest {
    // ── Request body (web useMemo `{ prompt }` + JSON.stringify) ───────────────────────

    @Test
    fun searchRequestBodyWrapsThePromptInJson() {
        assertEquals("{\"prompt\":\"drives last weekend\"}", searchRequestBody("drives last weekend"))
    }

    @Test
    fun searchRequestBodyEscapesQuotesNewlinesAndKeepsUnicode() {
        assertEquals("{\"prompt\":\"a\\\"b\"}", searchRequestBody("a\"b"))
        assertEquals("{\"prompt\":\"line1\\nline2\"}", searchRequestBody("line1\nline2"))
        assertEquals("{\"prompt\":\"\u2713\"}", searchRequestBody("\u2713"))
    }

    // ── Readiness gate (web canStart = prompt.trim().length > 0, plus offline) ──────────

    @Test
    fun isSearchReadyRequiresANonBlankQueryAndConnectivity() {
        assertTrue(isSearchReady("drives over 200 km", online = true))
        assertFalse("blank", isSearchReady("", online = true))
        assertFalse("whitespace only", isSearchReady("   ", online = true))
        assertFalse("offline", isSearchReady("drives over 200 km", online = false))
    }

    // ── SSE wire parser (web parseSSEFrame + toTypedEvent) ────────────────────────────

    @Test
    fun parseSseFrameReadsADeltaTextFrame() {
        val event = parseSseFrame(body("delta", buildJsonObject { put("text", "Coast") }))
        assertEquals(AiStreamEvent.Delta("Coast"), event)
    }

    @Test
    fun parseSseFrameToleratesTheNoSpaceFieldForm() {
        val raw = "event:delta\ndata:{\"text\":\"Cabin\"}"
        assertEquals(AiStreamEvent.Delta("Cabin"), parseSseFrame(raw))
    }

    @Test
    fun parseSseFrameDefaultsDoneFinishReasonAndErrorMessage() {
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(body("done", buildJsonObject {})))
        assertEquals(AiStreamEvent.Failure(UNKNOWN_ERROR), parseSseFrame(body("error", buildJsonObject {})))
    }

    @Test
    fun parseSseFrameReadsTypedToolAndConfirmFrames() {
        val toolCall =
            parseSseFrame(
                body(
                    "tool_call",
                    buildJsonObject {
                        put("id", "t1")
                        put("name", "search")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ToolCall("t1", "search"), toolCall)

        val toolResult =
            parseSseFrame(
                body(
                    "tool_result",
                    buildJsonObject {
                        put("id", "t1")
                        put("name", "search")
                        put("ok", true)
                    },
                ),
            )
        assertEquals(AiStreamEvent.ToolResult("t1", "search", ok = true), toolResult)

        val confirm =
            parseSseFrame(
                body(
                    "confirm_request",
                    buildJsonObject {
                        put("continuation_id", "c1")
                        put("tool", "export")
                        put("summary", "Export results?")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ConfirmRequest("c1", "export", "Export results?"), confirm)
    }

    @Test
    fun parseSseFrameDropsMalformedUnknownAndFieldlessFrames() {
        assertNull("no event line", parseSseFrame("data: {\"text\":\"x\"}"))
        assertNull("malformed json", parseSseFrame("event: delta\ndata: {not json"))
        assertNull("unknown event", parseSseFrame(body("mystery", buildJsonObject { put("x", 1) })))
        assertNull("non-object data", parseSseFrame("event: delta\ndata: 7"))
        assertNull("non-string delta text", parseSseFrame(body("delta", buildJsonObject { put("text", 7) })))
        assertNull("comment-only frame", parseSseFrame(": keep-alive heartbeat"))
    }

    // ── Chunk reassembly (web reader-loop buffering) ──────────────────────────────────

    @Test
    fun accumulatorSplitsMultipleFramesInOneChunk() {
        val acc = SseFrameAccumulator()
        val frames =
            acc.feed(frame("delta", buildJsonObject { put("text", "Coast") }) + frame("done", buildJsonObject {}))
        assertEquals(2, frames.size)
        assertEquals(AiStreamEvent.Delta("Coast"), parseSseFrame(frames[0]))
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(frames[1]))
    }

    @Test
    fun accumulatorReassemblesAFrameSplitAcrossChunks() {
        val acc = SseFrameAccumulator()
        assertTrue("partial frame yields nothing yet", acc.feed("event: delta\nda").isEmpty())
        val frames = acc.feed("ta: {\"text\":\"Coast Run\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals(AiStreamEvent.Delta("Coast Run"), parseSseFrame(frames.single()))
    }

    @Test
    fun accumulatorDrainsAFinalFrameWithoutATrailingBlankLine() {
        val acc = SseFrameAccumulator()
        assertTrue(acc.feed("event: done\ndata: {}").isEmpty())
        val tail = acc.drain()
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), tail?.let { parseSseFrame(it) })
        assertNull("drained buffer is now empty", acc.drain())
    }

    // ── Reducer (web handleEvent + delta accumulator) ─────────────────────────────────

    @Test
    fun reduceAccumulatesDeltaTextAndHoldsStreaming() {
        var state = NlSearchUiState.IDLE
        state = reduceSearch(state, AiStreamEvent.Delta("Found "))
        state = reduceSearch(state, AiStreamEvent.Delta("2 drives"))
        assertEquals(SearchPhase.Streaming, state.phase)
        assertEquals("Found 2 drives", state.results)
        assertTrue(state.hasOutput)
    }

    @Test
    fun reduceSettlesDoneAndError() {
        assertEquals(SearchPhase.Done, reduceSearch(streaming("Found"), AiStreamEvent.Done("stop")).phase)
        val failed = reduceSearch(streaming("Found"), AiStreamEvent.Failure("stream_http_500"))
        assertEquals(SearchPhase.Failed, failed.phase)
        assertEquals("stream_http_500", failed.error)
    }

    @Test
    fun reduceLeavesToolAndConfirmFramesInert() {
        val base = streaming("Found")
        assertEquals(base, reduceSearch(base, AiStreamEvent.ToolCall("t1", "search")))
        assertEquals(base, reduceSearch(base, AiStreamEvent.ToolResult("t1", "search", ok = true)))
        assertEquals(base, reduceSearch(base, AiStreamEvent.ConfirmRequest("c1", "export", "Export?")))
    }

    // ── Off-mode gate (web useAiEnabled) ──────────────────────────────────────────────

    @Test
    fun gateRequiresNonOffModeAndPerFeatureOptIn() {
        assertTrue(isNlSearchEnabled(settings(mode = "cloud", optedIn = true)))
        assertTrue(isNlSearchEnabled(settings(mode = "local", optedIn = true)))
    }

    @Test
    fun gateFailsClosedForEveryOtherShape() {
        assertFalse("not loaded", isNlSearchEnabled(null))
        assertFalse("off mode", isNlSearchEnabled(settings(mode = "off", optedIn = true)))
        assertFalse("absent mode", isNlSearchEnabled(settings(mode = null, optedIn = true)))
        assertFalse("not opted in", isNlSearchEnabled(settings(mode = "cloud", optedIn = false)))
        assertFalse("no features map", isNlSearchEnabled(buildJsonObject { put("ai_mode", "cloud") }))
    }

    @Test
    fun gateRequiresAStrictBooleanTrueNotAStringFlag() {
        val stringFlag =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_features", buildJsonObject { put(NL_SEARCH_FEATURE_ID, "true") })
            }
        assertFalse(isNlSearchEnabled(stringFlag))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        NlSearchDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened" to mapOf("surface" to "AINLSearch"), logger.events.single())
    }

    // ── Controller lifecycle (web useAiStream over a scripted transport) ──────────────

    @Test
    fun searchStreamsDeltasThenSettlesDoneAndPostsThePromptBody() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Found ") }),
                        frame("delta", buildJsonObject { put("text", "2 drives") }),
                        frame("done", buildJsonObject {}),
                    ),
                )
            val controller = controller(transport, prompt = "drives over 200 km")
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()

            assertEquals(SearchPhase.Done, controller.state.value.phase)
            assertEquals("Found 2 drives", controller.state.value.results)
            assertEquals(listOf(SEARCH_QUERY_PATH), transport.openedPaths)
            assertEquals(listOf("{\"prompt\":\"drives over 200 km\"}"), transport.openedBodies)
        }

    @Test
    fun aCleanCloseWithoutATerminalFrameSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Found") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()

            assertEquals(SearchPhase.Done, controller.state.value.phase)
            assertEquals("Found", controller.state.value.results)
        }

    @Test
    fun anErrorFrameSettlesFailedWithItsMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("error", buildJsonObject { put("message", "stream_http_404") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()

            assertEquals(SearchPhase.Failed, controller.state.value.phase)
            assertEquals("stream_http_404", controller.state.value.error)
        }

    @Test
    fun aTransportFailureSettlesFailedWithItsMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(emptyList(), failWith = IllegalStateException("boom"))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()

            assertEquals(SearchPhase.Failed, controller.state.value.phase)
            assertEquals("boom", controller.state.value.error)
        }

    @Test
    fun cancelReturnsAnInFlightStreamToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Found") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()
            assertEquals(SearchPhase.Streaming, controller.state.value.phase)
            assertEquals("Found", controller.state.value.results)

            controller.cancel()
            advanceUntilIdle()
            assertEquals(SearchPhase.Idle, controller.state.value.phase)
        }

    @Test
    fun searchIsCoalescedWhileAStreamIsAlreadyInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Found") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.search()
            advanceUntilIdle()
            controller.search()
            advanceUntilIdle()

            assertEquals(1, transport.openedPaths.size)
        }

    @Test
    fun searchIsANoOpWhenItCannotStart() =
        runTest(UnconfinedTestDispatcher()) {
            val offline = ScriptedTransport(emptyList())
            val offlineController = controller(offline, online = false)
            assertFalse(offlineController.canStart)
            offlineController.search()
            advanceUntilIdle()
            assertEquals(SearchPhase.Idle, offlineController.state.value.phase)
            assertTrue(offline.openedPaths.isEmpty())

            val blank = ScriptedTransport(emptyList())
            val blankController = controller(blank, prompt = "   ")
            assertFalse(blankController.canStart)
            blankController.search()
            advanceUntilIdle()
            assertTrue(blank.openedPaths.isEmpty())
        }

    @Test
    fun setPromptUpdatesTheBoundQueryAndReadiness() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = controller(ScriptedTransport(emptyList()), prompt = "")
            assertFalse(controller.canStart)
            controller.setPrompt("drives over 200 km")
            assertEquals("drives over 200 km", controller.prompt.value)
            assertTrue(controller.canStart)
        }

    @Test
    fun recordViewOpenedIsEmittedExactlyOncePerHolder() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val controller = controller(ScriptedTransport(emptyList()), logger = logger)

            controller.recordViewOpened()
            controller.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AINLSearch"), opened.single().second)
        }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

    private fun streaming(text: String) = NlSearchUiState(phase = SearchPhase.Streaming, results = text)

    private fun body(
        event: String,
        data: JsonObject,
    ) = "event: $event\ndata: $data"

    private fun frame(
        event: String,
        data: JsonObject,
    ) = body(event, data) + "\n\n"

    private fun settings(
        mode: String?,
        optedIn: Boolean,
    ): JsonObject =
        buildJsonObject {
            if (mode != null) put("ai_mode", mode)
            put("ai_features", buildJsonObject { put(NL_SEARCH_FEATURE_ID, optedIn) })
        }

    private fun TestScope.controller(
        transport: NlSearchTransport,
        online: Boolean = true,
        prompt: String = "drives over 200 km",
        logger: Logger = RecordingLogger(),
    ): NlSearchController = NlSearchController(transport, online, backgroundScope, logger).also { it.setPrompt(prompt) }

    private class ScriptedTransport(
        private val chunks: List<String>,
        private val failWith: Throwable? = null,
        private val suspendAfter: Boolean = false,
    ) : NlSearchTransport {
        val openedPaths = mutableListOf<String>()
        val openedBodies = mutableListOf<String>()

        override fun open(
            path: String,
            body: String,
        ): Flow<String> =
            flow {
                openedPaths += path
                openedBodies += body
                chunks.forEach { emit(it) }
                failWith?.let { throw it }
                if (suspendAfter) awaitCancellation()
            }
    }

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
}
