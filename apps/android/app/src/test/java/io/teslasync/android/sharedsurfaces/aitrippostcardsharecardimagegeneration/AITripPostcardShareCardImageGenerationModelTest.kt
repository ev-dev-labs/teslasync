package io.teslasync.android.sharedsurfaces.aitrippostcardsharecardimagegeneration

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
 * Off-device verification of the AITripPostcardShareCardImageGeneration surface's pure logic + stream lifecycle —
 * the native analogue of every derivation the web component + useAiStream perform
 * (web/src/components/ai/AITripPostcardShareCardImageGeneration.tsx, web/src/hooks/useAiStream.ts): the request
 * body builder ([draftRequestBody] + [resolveTripId] + [normalizeStyleHint]), the action-readiness predicate
 * ([hasTripSelected] / [isTripPostcardReady]), the SSE wire parser ([parseSseFrame], [SseFrameAccumulator]), the
 * stream reducer ([reduceDraft]), the withAiFeature off-mode gate ([isTripPostcardEnabled]), the PII-safe
 * `view.opened` diagnostic, and the [TripPostcardDraftController] lifecycle (idle → streaming → done / error,
 * cancellation, coalescing, and the offline / no-trip gate) driven over a scripted [TripImageDraftTransport] with
 * no real network. Run by the `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AITripPostcardShareCardImageGenerationModelTest {
    // ── Request body (web useMemo body + JSON.stringify) ──────────────────────────────

    @Test
    fun draftRequestBodyCarriesTripIdAndTrimmedStyleHintInTheWebKeyOrder() {
        val inputs = TripPostcardInputs(tripId = 7L, styleHint = "  vintage  ")
        assertEquals("""{"trip_id":7,"style_hint":"vintage"}""", draftRequestBody(inputs))
    }

    @Test
    fun draftRequestBodyOmitsStyleHintWhenAbsentOrBlank() {
        assertEquals("""{"trip_id":7}""", draftRequestBody(TripPostcardInputs(tripId = 7L)))
        assertEquals("""{"trip_id":7}""", draftRequestBody(TripPostcardInputs(tripId = 7L, styleHint = "")))
        assertEquals("""{"trip_id":7}""", draftRequestBody(TripPostcardInputs(tripId = 7L, styleHint = "   ")))
    }

    @Test
    fun draftRequestBodyFallsBackToZeroTripIdWhenAbsent() {
        assertEquals("""{"trip_id":0}""", draftRequestBody(TripPostcardInputs(tripId = null)))
    }

    @Test
    fun resolveTripIdFallsBackToZeroOnlyWhenAbsent() {
        assertEquals(12L, resolveTripId(12L))
        assertEquals(0L, resolveTripId(0L))
        assertEquals(-5L, resolveTripId(-5L))
        assertEquals(0L, resolveTripId(null))
    }

    @Test
    fun normalizeStyleHintTrimsAndTreatsBlankAsAbsent() {
        assertEquals("vintage", normalizeStyleHint("vintage"))
        assertEquals("minimal", normalizeStyleHint("  minimal "))
        assertNull(normalizeStyleHint(""))
        assertNull(normalizeStyleHint("   "))
        assertNull(normalizeStyleHint(null))
    }

    // ── Action readiness (web haveInputs = numericTripId > 0) ──────────────────────────

    @Test
    fun aTripIsSelectedOnlyForAPositiveTripId() {
        assertTrue(hasTripSelected(TripPostcardInputs(tripId = 1L)))
        assertFalse("zero", hasTripSelected(TripPostcardInputs(tripId = 0L)))
        assertFalse("negative", hasTripSelected(TripPostcardInputs(tripId = -1L)))
        assertFalse("absent", hasTripSelected(TripPostcardInputs(tripId = null)))
    }

    @Test
    fun postcardIsReadyOnlyWithATripAndConnectivity() {
        val withTrip = TripPostcardInputs(tripId = 4L)
        assertTrue(isTripPostcardReady(withTrip, online = true))
        assertFalse("offline", isTripPostcardReady(withTrip, online = false))
        assertFalse("no trip", isTripPostcardReady(TripPostcardInputs(tripId = null), online = true))
    }

    // ── SSE wire parser (web parseSSEFrame + toTypedEvent) ────────────────────────────

    @Test
    fun parseSseFrameReadsADeltaTextFrame() {
        val event = parseSseFrame(body("delta", buildJsonObject { put("text", "Prompt") }))
        assertEquals(AiStreamEvent.Delta("Prompt"), event)
    }

    @Test
    fun parseSseFrameToleratesTheNoSpaceFieldForm() {
        val raw = "event:delta\ndata:{\"text\":\"sunrise\"}"
        assertEquals(AiStreamEvent.Delta("sunrise"), parseSseFrame(raw))
    }

    @Test
    fun parseSseFrameDefaultsDoneFinishReasonAndErrorMessage() {
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(body("done", buildJsonObject {})))
        assertEquals(AiStreamEvent.Failure(UNKNOWN_ERROR), parseSseFrame(body("error", buildJsonObject {})))
    }

    @Test
    fun parseSseFrameReadsTypedToolAndConfirmFrames() {
        val toolResult =
            parseSseFrame(
                body(
                    "tool_result",
                    buildJsonObject {
                        put("id", "t1")
                        put("name", "draftPrompt")
                        put("ok", true)
                    },
                ),
            )
        assertEquals(AiStreamEvent.ToolResult("t1", "draftPrompt", ok = true), toolResult)

        val confirm =
            parseSseFrame(
                body(
                    "confirm_request",
                    buildJsonObject {
                        put("continuation_id", "c1")
                        put("tool", "publish")
                        put("summary", "Publish share card?")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ConfirmRequest("c1", "publish", "Publish share card?"), confirm)
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
            acc.feed(frame("delta", buildJsonObject { put("text", "sunrise") }) + frame("done", buildJsonObject {}))
        assertEquals(2, frames.size)
        assertEquals(AiStreamEvent.Delta("sunrise"), parseSseFrame(frames[0]))
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(frames[1]))
    }

    @Test
    fun accumulatorReassemblesAFrameSplitAcrossChunks() {
        val acc = SseFrameAccumulator()
        assertTrue("partial frame yields nothing yet", acc.feed("event: delta\nda").isEmpty())
        val frames = acc.feed("ta: {\"text\":\"coastal road\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals(AiStreamEvent.Delta("coastal road"), parseSseFrame(frames.single()))
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
        var state = TripImageDraftUiState.IDLE
        state = reduceDraft(state, AiStreamEvent.Delta("Prompt: a "))
        state = reduceDraft(state, AiStreamEvent.Delta("sunrise postcard"))
        assertEquals(DraftPhase.Streaming, state.phase)
        assertEquals("Prompt: a sunrise postcard", state.draft)
        assertTrue(state.hasOutput)
    }

    @Test
    fun reduceSettlesDoneAndError() {
        assertEquals(DraftPhase.Done, reduceDraft(streaming("Prompt"), AiStreamEvent.Done("stop")).phase)
        val failed = reduceDraft(streaming("Prompt"), AiStreamEvent.Failure("stream_http_500"))
        assertEquals(DraftPhase.Failed, failed.phase)
        assertEquals("stream_http_500", failed.error)
    }

    @Test
    fun reduceLeavesToolAndConfirmFramesInert() {
        val base = streaming("Prompt")
        assertEquals(base, reduceDraft(base, AiStreamEvent.ToolCall("t1", "draftPrompt")))
        assertEquals(base, reduceDraft(base, AiStreamEvent.ToolResult("t1", "draftPrompt", ok = true)))
        assertEquals(base, reduceDraft(base, AiStreamEvent.ConfirmRequest("c1", "publish", "Publish?")))
    }

    // ── Off-mode gate (web useAiEnabled) ──────────────────────────────────────────────

    @Test
    fun gateRequiresNonOffModeAndPerFeatureOptIn() {
        assertTrue(isTripPostcardEnabled(settings(mode = "cloud", optedIn = true)))
        assertTrue(isTripPostcardEnabled(settings(mode = "local", optedIn = true)))
    }

    @Test
    fun gateFailsClosedForEveryOtherShape() {
        assertFalse("not loaded", isTripPostcardEnabled(null))
        assertFalse("off mode", isTripPostcardEnabled(settings(mode = "off", optedIn = true)))
        assertFalse("absent mode", isTripPostcardEnabled(settings(mode = null, optedIn = true)))
        assertFalse("not opted in", isTripPostcardEnabled(settings(mode = "cloud", optedIn = false)))
        assertFalse("no features map", isTripPostcardEnabled(buildJsonObject { put("ai_mode", "cloud") }))
    }

    @Test
    fun gateRequiresAStrictBooleanTrueNotAStringFlag() {
        val stringFlag =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_features", buildJsonObject { put(TRIP_POSTCARD_FEATURE_ID, "true") })
            }
        assertFalse(isTripPostcardEnabled(stringFlag))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        TripPostcardDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals(
            "view.opened" to mapOf("surface" to "AITripPostcardShareCardImageGeneration"),
            logger.events.single(),
        )
    }

    // ── Controller lifecycle (web useAiStream over a scripted transport) ──────────────

    @Test
    fun draftStreamsDeltasThenSettlesDoneAndPostsTheTripImageBody() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Prompt: a ") }),
                        frame("delta", buildJsonObject { put("text", "sunrise postcard") }),
                        frame("done", buildJsonObject {}),
                    ),
                )
            val controller = controller(transport, inputs = TripPostcardInputs(tripId = 7L, styleHint = "vintage"))
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, controller.state.value.phase)
            assertEquals("Prompt: a sunrise postcard", controller.state.value.draft)
            assertEquals(listOf(TRIP_IMAGE_DRAFT_PATH), transport.openedPaths)
            assertEquals(listOf("""{"trip_id":7,"style_hint":"vintage"}"""), transport.openedBodies)
        }

    @Test
    fun aCleanCloseWithoutATerminalFrameSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Prompt") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Done, controller.state.value.phase)
            assertEquals("Prompt", controller.state.value.draft)
        }

    @Test
    fun anErrorFrameSettlesFailedWithItsMessage() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("error", buildJsonObject { put("message", "stream_http_404") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
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

            controller.draft()
            advanceUntilIdle()

            assertEquals(DraftPhase.Failed, controller.state.value.phase)
            assertEquals("boom", controller.state.value.error)
        }

    @Test
    fun cancelReturnsAnInFlightStreamToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(frame("delta", buildJsonObject { put("text", "Prompt") })),
                    suspendAfter = true,
                )
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()
            assertEquals(DraftPhase.Streaming, controller.state.value.phase)
            assertEquals("Prompt", controller.state.value.draft)

            controller.cancel()
            advanceUntilIdle()
            assertEquals(DraftPhase.Idle, controller.state.value.phase)
        }

    @Test
    fun draftIsCoalescedWhileAStreamIsAlreadyInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(frame("delta", buildJsonObject { put("text", "Prompt") })),
                    suspendAfter = true,
                )
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()
            controller.draft()
            advanceUntilIdle()

            assertEquals(1, transport.openedPaths.size)
        }

    @Test
    fun draftIsANoOpWhenItCannotStart() =
        runTest(UnconfinedTestDispatcher()) {
            val offline = ScriptedTransport(emptyList())
            val offlineController = controller(offline, online = false)
            assertFalse(offlineController.canStart)
            offlineController.draft()
            advanceUntilIdle()
            assertEquals(DraftPhase.Idle, offlineController.state.value.phase)
            assertTrue(offline.openedPaths.isEmpty())

            val noTrip = ScriptedTransport(emptyList())
            assertFalse(controller(noTrip, inputs = TripPostcardInputs(tripId = null)).canStart)
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
            assertEquals(mapOf("surface" to "AITripPostcardShareCardImageGeneration"), opened.single().second)
        }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

    private fun streaming(text: String) = TripImageDraftUiState(phase = DraftPhase.Streaming, draft = text)

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
            put("ai_features", buildJsonObject { put(TRIP_POSTCARD_FEATURE_ID, optedIn) })
        }

    private fun TestScope.controller(
        transport: TripImageDraftTransport,
        inputs: TripPostcardInputs = TripPostcardInputs(tripId = 7L),
        online: Boolean = true,
        logger: Logger = RecordingLogger(),
    ): TripPostcardDraftController = TripPostcardDraftController(transport, inputs, online, backgroundScope, logger)

    private class ScriptedTransport(
        private val chunks: List<String>,
        private val failWith: Throwable? = null,
        private val suspendAfter: Boolean = false,
    ) : TripImageDraftTransport {
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
