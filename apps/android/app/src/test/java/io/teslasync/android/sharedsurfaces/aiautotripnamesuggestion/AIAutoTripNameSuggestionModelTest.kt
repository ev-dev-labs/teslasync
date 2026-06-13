package io.teslasync.android.sharedsurfaces.aiautotripnamesuggestion

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
 * Off-device verification of the AIAutoTripNameSuggestion surface's pure logic + stream lifecycle — the native
 * analogue of every derivation the web component + useAiStream perform
 * (web/src/components/ai/AIAutoTripNameSuggestion.tsx, web/src/hooks/useAiStream.ts): the draft endpoint path
 * builder ([draftPath] + [encodeUriComponent]), the SSE wire parser ([parseSseFrame], [SseFrameAccumulator]),
 * the stream reducer ([reduceDraft]), the withAiFeature off-mode gate ([isAutoTripNamingEnabled]), the PII-safe
 * `view.opened` diagnostic, and the [AutoTripNameDraftController] lifecycle (idle → streaming → done / error,
 * cancellation, coalescing, and the offline/no-trip gate) driven over a scripted [TripNameDraftTransport] with
 * no real network. Run by the `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AIAutoTripNameSuggestionModelTest {
    // ── Endpoint path (web useMemo url + encodeURIComponent) ──────────────────────────

    @Test
    fun draftPathUsesTheTripIdSegment() {
        assertEquals("/ai/trips/42/name/draft", draftPath("42"))
    }

    @Test
    fun draftPathFallsBackToTripZeroForABlankOrNullId() {
        assertEquals(DRAFT_FALLBACK_PATH, draftPath(null))
        assertEquals(DRAFT_FALLBACK_PATH, draftPath(""))
        assertEquals(DRAFT_FALLBACK_PATH, draftPath("   "))
    }

    @Test
    fun draftPathPercentEncodesTheTripIdSegment() {
        assertEquals("/ai/trips/a%2Fb%20c/name/draft", draftPath("a/b c"))
    }

    @Test
    fun encodeUriComponentLeavesUnreservedCharsAndEscapesTheRest() {
        assertEquals("Az0-_.!~*'()", encodeUriComponent("Az0-_.!~*'()"))
        assertEquals("a%2Fb", encodeUriComponent("a/b"))
        assertEquals("%E2%9C%93", encodeUriComponent("\u2713"))
    }

    // ── SSE wire parser (web parseSSEFrame + toTypedEvent) ────────────────────────────

    @Test
    fun parseSseFrameReadsADeltaTextFrame() {
        val event = parseSseFrame(body("delta", buildJsonObject { put("text", "Sunset") }))
        assertEquals(AiStreamEvent.Delta("Sunset"), event)
    }

    @Test
    fun parseSseFrameToleratesTheNoSpaceFieldForm() {
        val raw = "event:delta\ndata:{\"text\":\"Coast\"}"
        assertEquals(AiStreamEvent.Delta("Coast"), parseSseFrame(raw))
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
                        put("name", "geocode")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ToolCall("t1", "geocode"), toolCall)

        val confirm =
            parseSseFrame(
                body(
                    "confirm_request",
                    buildJsonObject {
                        put("continuation_id", "c1")
                        put("tool", "save")
                        put("summary", "Save name?")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ConfirmRequest("c1", "save", "Save name?"), confirm)
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
            acc.feed(frame("delta", buildJsonObject { put("text", "Sun") }) + frame("done", buildJsonObject {}))
        assertEquals(2, frames.size)
        assertEquals(AiStreamEvent.Delta("Sun"), parseSseFrame(frames[0]))
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(frames[1]))
    }

    @Test
    fun accumulatorReassemblesAFrameSplitAcrossChunks() {
        val acc = SseFrameAccumulator()
        assertTrue("partial frame yields nothing yet", acc.feed("event: delta\nda").isEmpty())
        val frames = acc.feed("ta: {\"text\":\"Sunset Coast\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals(AiStreamEvent.Delta("Sunset Coast"), parseSseFrame(frames.single()))
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
        var state = TripNameDraftUiState.IDLE
        state = reduceDraft(state, AiStreamEvent.Delta("Sunset "))
        state = reduceDraft(state, AiStreamEvent.Delta("Coast Run"))
        assertEquals(DraftPhase.Streaming, state.phase)
        assertEquals("Sunset Coast Run", state.suggestion)
        assertTrue(state.hasOutput)
    }

    @Test
    fun reduceSettlesDoneAndError() {
        assertEquals(DraftPhase.Done, reduceDraft(streaming("Sunset"), AiStreamEvent.Done("stop")).phase)
        val failed = reduceDraft(streaming("Sunset"), AiStreamEvent.Failure("stream_http_500"))
        assertEquals(DraftPhase.Failed, failed.phase)
        assertEquals("stream_http_500", failed.error)
    }

    @Test
    fun reduceLeavesToolAndConfirmFramesInert() {
        val base = streaming("Sun")
        assertEquals(base, reduceDraft(base, AiStreamEvent.ToolCall("t1", "geocode")))
        assertEquals(base, reduceDraft(base, AiStreamEvent.ToolResult("t1", "geocode", ok = true)))
        assertEquals(base, reduceDraft(base, AiStreamEvent.ConfirmRequest("c1", "save", "Save?")))
    }

    // ── Off-mode gate (web useAiEnabled) ──────────────────────────────────────────────

    @Test
    fun gateRequiresNonOffModeAndPerFeatureOptIn() {
        assertTrue(isAutoTripNamingEnabled(settings(mode = "cloud", optedIn = true)))
        assertTrue(isAutoTripNamingEnabled(settings(mode = "local", optedIn = true)))
    }

    @Test
    fun gateFailsClosedForEveryOtherShape() {
        assertFalse("not loaded", isAutoTripNamingEnabled(null))
        assertFalse("off mode", isAutoTripNamingEnabled(settings(mode = "off", optedIn = true)))
        assertFalse("absent mode", isAutoTripNamingEnabled(settings(mode = null, optedIn = true)))
        assertFalse("not opted in", isAutoTripNamingEnabled(settings(mode = "cloud", optedIn = false)))
        assertFalse("no features map", isAutoTripNamingEnabled(buildJsonObject { put("ai_mode", "cloud") }))
    }

    @Test
    fun gateRequiresAStrictBooleanTrueNotAStringFlag() {
        val stringFlag =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_features", buildJsonObject { put(AUTO_TRIP_NAMING_FEATURE_ID, "true") })
            }
        assertFalse(isAutoTripNamingEnabled(stringFlag))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        AutoTripNameSuggestionDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened" to mapOf("surface" to "AIAutoTripNameSuggestion"), logger.events.single())
    }

    // ── Controller lifecycle (web useAiStream over a scripted transport) ──────────────

    @Test
    fun suggestStreamsDeltasThenSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Sunset ") }),
                        frame("delta", buildJsonObject { put("text", "Coast") }),
                        frame("done", buildJsonObject {}),
                    ),
                )
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, controller.state.value.phase)
            assertEquals("Sunset Coast", controller.state.value.suggestion)
            assertEquals(listOf("/ai/trips/42/name/draft"), transport.openedPaths)
        }

    @Test
    fun aCleanCloseWithoutATerminalFrameSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Sun") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, controller.state.value.phase)
            assertEquals("Sun", controller.state.value.suggestion)
        }

    @Test
    fun anErrorFrameSettlesFailedWithItsMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("error", buildJsonObject { put("message", "stream_http_404") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, controller.state.value.phase)
            assertEquals("stream_http_404", controller.state.value.error)
        }

    @Test
    fun aTransportFailureSettlesFailedWithItsMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(emptyList(), failWith = IllegalStateException("boom"))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, controller.state.value.phase)
            assertEquals("boom", controller.state.value.error)
        }

    @Test
    fun cancelReturnsAnInFlightStreamToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Sun") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()
            assertEquals(DraftPhase.Streaming, controller.state.value.phase)
            assertEquals("Sun", controller.state.value.suggestion)

            controller.cancel()
            advanceUntilIdle()
            assertEquals(DraftPhase.Idle, controller.state.value.phase)
        }

    @Test
    fun suggestIsCoalescedWhileAStreamIsAlreadyInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Sun") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.suggest()
            advanceUntilIdle()
            controller.suggest()
            advanceUntilIdle()

            assertEquals(1, transport.openedPaths.size)
        }

    @Test
    fun suggestIsANoOpWhenItCannotStart() =
        runTest(UnconfinedTestDispatcher()) {
            val offline = ScriptedTransport(emptyList())
            val offlineController = controller(offline, online = false)
            assertFalse(offlineController.canStart)
            offlineController.suggest()
            advanceUntilIdle()
            assertEquals(DraftPhase.Idle, offlineController.state.value.phase)
            assertTrue(offline.openedPaths.isEmpty())

            val noTrip = ScriptedTransport(emptyList())
            assertFalse(controller(noTrip, tripId = "").canStart)
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
            assertEquals(mapOf("surface" to "AIAutoTripNameSuggestion"), opened.single().second)
        }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

    private fun streaming(text: String) = TripNameDraftUiState(phase = DraftPhase.Streaming, suggestion = text)

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
            put("ai_features", buildJsonObject { put(AUTO_TRIP_NAMING_FEATURE_ID, optedIn) })
        }

    private fun TestScope.controller(
        transport: TripNameDraftTransport,
        tripId: String? = "42",
        online: Boolean = true,
        logger: Logger = RecordingLogger(),
    ): AutoTripNameDraftController = AutoTripNameDraftController(transport, tripId, online, backgroundScope, logger)

    private class ScriptedTransport(
        private val chunks: List<String>,
        private val failWith: Throwable? = null,
        private val suspendAfter: Boolean = false,
    ) : TripNameDraftTransport {
        val openedPaths = mutableListOf<String>()

        override fun open(path: String): Flow<String> =
            flow {
                openedPaths += path
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
