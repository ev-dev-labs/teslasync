// Off-device verification of the AIWatchFaceNLResponse surface's pure logic + stream lifecycle — the native
// analogue of every derivation the web component + useAiStream perform
// (web/src/components/ai/AIWatchFaceNLResponse.tsx, web/src/hooks/useAiStream.ts): the optional `{ message }`
// request-body serializer ([watchRespondRequestBody]), the input cap ([capMessage]), the action readiness gate
// ([isWatchRespondReady]), the SSE wire parser ([parseWatchFrame], [SseFrameAccumulator]), the stream reducer
// ([reduceWatchRespond]) and lifecycle helpers, the surface classifier ([classifyWatchRespond]) across every
// loading / empty / content / error / stale / offline branch, the freshness rule ([isStale]), the withAiFeature
// off-mode gate ([isWatchRespondEnabled]), the accessibility-label builders, the PII-safe `view.opened`
// diagnostic, and the [WatchRespondController] lifecycle (idle → streaming → done / error, cancellation,
// coalescing, the offline gate, and the transport-failure → offline classification) driven over a scripted
// [WatchRespondTransport] with no real network. Run by the `:android:testReleaseUnitTest` gate.
//
// This test is the surface's required adapter/unit + a11y-label test (the per-state UI test lives in
// androidTest/AIWatchFaceNLResponseUiTest.kt).
package io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
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

@OptIn(ExperimentalCoroutinesApi::class)
class AIWatchFaceNLResponseModelTest {
    private val window = WATCH_FRESHNESS_WINDOW_MS

    // ── Request body (web useMemo `{ message: trimmed || undefined }` + JSON.stringify) ──

    @Test
    fun requestBodyOmitsAnEmptyOrWhitespaceMessageSoTheBodyIsAnEmptyObject() {
        assertEquals("{}", watchRespondRequestBody(""))
        assertEquals("{}", watchRespondRequestBody("   "))
        assertEquals("{}", watchRespondRequestBody("\n\t "))
    }

    @Test
    fun requestBodyWrapsAndTrimsANonBlankMessage() {
        assertEquals("{\"message\":\"how is my battery?\"}", watchRespondRequestBody("how is my battery?"))
        assertEquals("{\"message\":\"how is my battery?\"}", watchRespondRequestBody("  how is my battery?  "))
    }

    @Test
    fun requestBodyEscapesQuotesNewlinesAndKeepsUnicode() {
        assertEquals("{\"message\":\"a\\\"b\"}", watchRespondRequestBody("a\"b"))
        assertEquals("{\"message\":\"line1\\nline2\"}", watchRespondRequestBody("line1\nline2"))
        assertEquals("{\"message\":\"\u2713\"}", watchRespondRequestBody("\u2713"))
    }

    // ── Input cap (web Textarea maxLength) ────────────────────────────────────────────

    @Test
    fun capMessageTruncatesBeyondMaxAndKeepsShorter() {
        assertEquals("hi", capMessage("hi"))
        assertEquals(MAX_MESSAGE_CHARS, capMessage("a".repeat(MAX_MESSAGE_CHARS + 50)).length)
        assertEquals(MAX_MESSAGE_CHARS, capMessage("a".repeat(MAX_MESSAGE_CHARS)).length)
    }

    // ── Readiness gate (web canStart = messageWithinCap && state !== 'paused-confirm', plus offline) ──

    @Test
    fun isReadyAllowsAnEmptyMessageWhenOnlineAndNotPaused() {
        assertTrue(isWatchRespondReady("", WatchRespondPhase.Idle, online = true))
        assertTrue(isWatchRespondReady("how is my battery?", WatchRespondPhase.Idle, online = true))
        assertTrue(isWatchRespondReady("how is my battery?", WatchRespondPhase.Done, online = true))
    }

    @Test
    fun isReadyRejectsOverCapPausedAndOffline() {
        assertFalse("over cap", isWatchRespondReady("a".repeat(MAX_MESSAGE_CHARS + 1), WatchRespondPhase.Idle, online = true))
        assertFalse("paused", isWatchRespondReady("ok", WatchRespondPhase.PausedConfirm, online = true))
        assertFalse("offline", isWatchRespondReady("ok", WatchRespondPhase.Idle, online = false))
    }

    // ── SSE wire parser (web parseSSEFrame + toTypedEvent) ────────────────────────────

    @Test
    fun parseFrameReadsADeltaTextFrame() {
        val event = parseWatchFrame(body("delta", buildJsonObject { put("text", "Battery") }))
        assertEquals(AiStreamEvent.Delta("Battery"), event)
    }

    @Test
    fun parseFrameToleratesTheNoSpaceFieldForm() {
        assertEquals(AiStreamEvent.Delta("Locked"), parseWatchFrame("event:delta\ndata:{\"text\":\"Locked\"}"))
    }

    @Test
    fun parseFrameDefaultsDoneFinishReasonAndErrorMessage() {
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseWatchFrame(body("done", buildJsonObject {})))
        assertEquals(AiStreamEvent.Failure(UNKNOWN_ERROR), parseWatchFrame(body("error", buildJsonObject {})))
    }

    @Test
    fun parseFrameReadsTypedToolAndConfirmFrames() {
        val confirm =
            parseWatchFrame(
                body(
                    "confirm_request",
                    buildJsonObject {
                        put("continuation_id", "c1")
                        put("tool", "lock")
                        put("summary", "Lock the car?")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ConfirmRequest("c1", "lock", "Lock the car?"), confirm)
    }

    @Test
    fun parseFrameDropsMalformedUnknownAndFieldlessFrames() {
        assertNull("no event line", parseWatchFrame("data: {\"text\":\"x\"}"))
        assertNull("malformed json", parseWatchFrame("event: delta\ndata: {not json"))
        assertNull("unknown event", parseWatchFrame(body("mystery", buildJsonObject { put("x", 1) })))
        assertNull("non-object data", parseWatchFrame("event: delta\ndata: 7"))
        assertNull("non-string delta text", parseWatchFrame(body("delta", buildJsonObject { put("text", 7) })))
        assertNull("comment-only frame", parseWatchFrame(": keep-alive heartbeat"))
    }

    // ── Chunk reassembly (web reader-loop buffering) ──────────────────────────────────

    @Test
    fun accumulatorSplitsMultipleFramesInOneChunk() {
        val acc = SseFrameAccumulator()
        val frames =
            acc.feed(frame("delta", buildJsonObject { put("text", "Battery") }) + frame("done", buildJsonObject {}))
        assertEquals(2, frames.size)
        assertEquals(AiStreamEvent.Delta("Battery"), parseWatchFrame(frames[0]))
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseWatchFrame(frames[1]))
    }

    @Test
    fun accumulatorReassemblesAFrameSplitAcrossChunks() {
        val acc = SseFrameAccumulator()
        assertTrue("partial yields nothing yet", acc.feed("event: delta\nda").isEmpty())
        val frames = acc.feed("ta: {\"text\":\"72 percent\"}\n\n")
        assertEquals(AiStreamEvent.Delta("72 percent"), parseWatchFrame(frames.single()))
    }

    @Test
    fun accumulatorDrainsAFinalFrameWithoutATrailingBlankLine() {
        val acc = SseFrameAccumulator()
        assertTrue(acc.feed("event: done\ndata: {}").isEmpty())
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), acc.drain()?.let { parseWatchFrame(it) })
        assertNull("drained buffer is empty", acc.drain())
    }

    // ── Reducer + lifecycle helpers (web handleEvent + delta accumulator) ─────────────

    @Test
    fun startAskingEntersStreamingClearsTransientsAndKeepsCommitted() {
        val next =
            WatchRespondUiState(streamingText = "old", error = "boom", errorKind = ErrorKind.Http, committedText = "kept")
                .startAsking()
        assertEquals(WatchRespondPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.error)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulateAndHoldStreaming() {
        val next =
            WatchRespondUiState(phase = WatchRespondPhase.Streaming)
                .reduceWatchRespond(AiStreamEvent.Delta("72 "), nowMs = 1L)
                .reduceWatchRespond(AiStreamEvent.Delta("percent"), nowMs = 2L)
        assertEquals("72 percent", next.streamingText)
        assertEquals(WatchRespondPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "the answer")
                .reduceWatchRespond(AiStreamEvent.Done("stop"), nowMs = 42L)
        assertEquals(WatchRespondPhase.Done, next.phase)
        assertEquals("the answer", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun errorFrameSettlesFailedNonOfflineAndKeepsCommitted() {
        val next =
            WatchRespondUiState(phase = WatchRespondPhase.Streaming, committedText = "prev")
                .reduceWatchRespond(AiStreamEvent.Failure("stream_http_500"), nowMs = 1L)
        assertEquals(WatchRespondPhase.Failed, next.phase)
        assertEquals("stream_http_500", next.error)
        assertEquals(ErrorKind.Unknown, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun confirmFramePausesTheStreamAndToolFramesAreInert() {
        val streaming = WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "partial")
        assertEquals(
            WatchRespondPhase.PausedConfirm,
            streaming.reduceWatchRespond(AiStreamEvent.ConfirmRequest("c", "t", "s"), nowMs = 1L).phase,
        )
        assertEquals(streaming, streaming.reduceWatchRespond(AiStreamEvent.ToolCall("t1", "lock"), nowMs = 1L))
        assertEquals(streaming, streaming.reduceWatchRespond(AiStreamEvent.ToolResult("t1", "lock", ok = true), nowMs = 1L))
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        assertEquals(
            WatchRespondPhase.Done,
            WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "x").finishIfStreaming(9L).phase,
        )
        assertEquals(
            WatchRespondPhase.Failed,
            WatchRespondUiState(phase = WatchRespondPhase.Failed).finishIfStreaming(9L).phase,
        )
    }

    // ── Classifier: every state ────────────────────────────────────────────────────────

    @Test
    fun idleIsResting() {
        assertEquals(WatchSurface.Resting, classifyWatchRespond(WatchRespondUiState(), nowMs = 0L))
    }

    @Test
    fun streamingWithoutTextIsWorkingWithTextIsLive() {
        assertEquals(
            WatchSurface.Working,
            classifyWatchRespond(WatchRespondUiState(phase = WatchRespondPhase.Streaming), nowMs = 0L),
        )
        assertEquals(
            WatchSurface.Live("partial"),
            classifyWatchRespond(
                WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun pausedConfirmFoldsOntoLiveOrWorking() {
        assertEquals(
            WatchSurface.Live("so far"),
            classifyWatchRespond(
                WatchRespondUiState(phase = WatchRespondPhase.PausedConfirm, streamingText = "so far"),
                nowMs = 0L,
            ),
        )
        assertEquals(
            WatchSurface.Working,
            classifyWatchRespond(WatchRespondUiState(phase = WatchRespondPhase.PausedConfirm), nowMs = 0L),
        )
    }

    @Test
    fun doneWithTextIsReadyFreshWithinWindowStaleBeyondIt() {
        val base =
            WatchRespondUiState(phase = WatchRespondPhase.Done, committedText = "answered", fetchedAt = 1_000L)
        assertEquals(WatchSurface.Ready("answered", stale = false), classifyWatchRespond(base, nowMs = 1_000L + window - 1L))
        assertEquals(WatchSurface.Ready("answered", stale = true), classifyWatchRespond(base, nowMs = 1_000L + window + 1L))
    }

    @Test
    fun doneBlankIsEmpty() {
        assertEquals(
            WatchSurface.Empty,
            classifyWatchRespond(WatchRespondUiState(phase = WatchRespondPhase.Done, committedText = ""), nowMs = 0L),
        )
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        assertEquals(
            WatchSurface.Cached("last known", offline = true),
            classifyWatchRespond(
                WatchRespondUiState(
                    phase = WatchRespondPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        assertEquals(
            WatchSurface.Cached("last known", offline = false),
            classifyWatchRespond(
                WatchRespondUiState(
                    phase = WatchRespondPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedWithoutLastKnownIsAHardFailureCarryingOfflineAndMessage() {
        assertEquals(
            WatchSurface.Failed(offline = true, message = "boom"),
            classifyWatchRespond(
                WatchRespondUiState(phase = WatchRespondPhase.Failed, error = "boom", errorKind = ErrorKind.Network),
                nowMs = 0L,
            ),
        )
        assertEquals(
            WatchSurface.Failed(offline = false, message = "stream_http_503"),
            classifyWatchRespond(
                WatchRespondUiState(phase = WatchRespondPhase.Failed, error = "stream_http_503", errorKind = ErrorKind.Http),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── Off-mode gate (web useAiEnabled) ──────────────────────────────────────────────

    @Test
    fun gateRequiresNonOffModeAndPerFeatureOptIn() {
        assertTrue(isWatchRespondEnabled(settings(mode = "cloud", optedIn = true)))
        assertTrue(isWatchRespondEnabled(settings(mode = "local", optedIn = true)))
    }

    @Test
    fun gateFailsClosedForEveryOtherShape() {
        assertFalse("not loaded", isWatchRespondEnabled(null))
        assertFalse("off mode", isWatchRespondEnabled(settings(mode = "off", optedIn = true)))
        assertFalse("absent mode", isWatchRespondEnabled(settings(mode = null, optedIn = true)))
        assertFalse("not opted in", isWatchRespondEnabled(settings(mode = "cloud", optedIn = false)))
        assertFalse("no features map", isWatchRespondEnabled(buildJsonObject { put("ai_mode", "cloud") }))
    }

    @Test
    fun gateRequiresAStrictBooleanTrueNotAStringFlag() {
        val stringFlag =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_features", buildJsonObject { put(WATCH_FACE_NL_FEATURE_ID, "true") })
            }
        assertFalse(isWatchRespondEnabled(stringFlag))
    }

    // ── Accessibility labels ───────────────────────────────────────────────────────────

    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        assertEquals(
            "Ask Helix about your watch face (Helix). Ask Helix a question.",
            headerAccessibilityLabel("Ask Helix about your watch face", "Helix", "Ask Helix a question."),
        )
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            WatchOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(WatchSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(WatchSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(WatchSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(WatchSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(WatchSurface.Empty, labels))
        assertEquals("Offline. cached", outputAccessibilityLabel(WatchSurface.Cached("cached", offline = true), labels))
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(WatchSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Offline. Failed to load data",
            outputAccessibilityLabel(WatchSurface.Failed(offline = true, message = "x"), labels),
        )
        assertEquals(
            "Failed to load data",
            outputAccessibilityLabel(WatchSurface.Failed(offline = false, message = "x"), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForResting() {
        val labels = WatchOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(WatchSurface.Resting, labels))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        WatchRespondDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened" to mapOf("surface" to "AIWatchFaceNLResponse"), logger.events.single())
    }

    // ── Controller lifecycle (web useAiStream over a scripted transport) ──────────────

    @Test
    fun askStreamsDeltasThenSettlesDoneStampsAndPostsTheMessageBody() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Battery 72%. ") }),
                        frame("delta", buildJsonObject { put("text", "Locked.") }),
                        frame("done", buildJsonObject {}),
                    ),
                )
            val controller = controller(transport, message = "how is my battery?")
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()

            assertEquals(WatchRespondPhase.Done, controller.state.value.phase)
            assertEquals("Battery 72%. Locked.", controller.state.value.committedText)
            assertEquals(FIXED_NOW, controller.state.value.fetchedAt)
            assertEquals(listOf(WATCH_RESPOND_PATH), transport.openedPaths)
            assertEquals(listOf("{\"message\":\"how is my battery?\"}"), transport.openedBodies)
        }

    @Test
    fun askWithAnEmptyMessagePostsAnEmptyObjectBody() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("done", buildJsonObject {})))
            val controller = controller(transport, message = "   ")
            backgroundScope.launch { controller.state.collect {} }

            assertTrue(controller.canStart)
            controller.ask()
            advanceUntilIdle()

            assertEquals(listOf("{}"), transport.openedBodies)
        }

    @Test
    fun aCleanCloseWithoutATerminalFrameSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Battery 72%") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()

            assertEquals(WatchRespondPhase.Done, controller.state.value.phase)
            assertEquals("Battery 72%", controller.state.value.committedText)
        }

    @Test
    fun anErrorFrameSettlesFailedNonOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("error", buildJsonObject { put("message", "stream_http_404") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()

            assertEquals(WatchRespondPhase.Failed, controller.state.value.phase)
            assertEquals("stream_http_404", controller.state.value.error)
            assertEquals(ErrorKind.Unknown, controller.state.value.errorKind)
            assertEquals(
                WatchSurface.Failed(offline = false, message = "stream_http_404"),
                classifyWatchRespond(controller.state.value, FIXED_NOW),
            )
        }

    @Test
    fun aTransportNetworkFailureIsClassifiedOfflineAndKeepsLastKnown() =
        runTest(UnconfinedTestDispatcher()) {
            // A good run that commits a narration, then a thrown network failure on the retry.
            val net =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Battery 72%") }),
                        frame("done", buildJsonObject {}),
                    ),
                    failWithAfterRuns = 1,
                    failWith = ApiError.Network(),
                )
            val controller = controller(net, message = "how is my battery?")
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()
            assertEquals("Battery 72%", controller.state.value.committedText)

            controller.retry()
            advanceUntilIdle()

            assertEquals(WatchRespondPhase.Failed, controller.state.value.phase)
            assertEquals(ErrorKind.Network, controller.state.value.errorKind)
            assertEquals("Battery 72%", controller.state.value.committedText)
            assertEquals(WatchSurface.Cached("Battery 72%", offline = true), classifyWatchRespond(controller.state.value, FIXED_NOW))
        }

    @Test
    fun cancelReturnsAnInFlightStreamToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Battery") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()
            assertEquals(WatchRespondPhase.Streaming, controller.state.value.phase)

            controller.cancel()
            advanceUntilIdle()
            assertEquals(WatchRespondPhase.Idle, controller.state.value.phase)
        }

    @Test
    fun askIsCoalescedWhileAStreamIsAlreadyInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "Battery") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()
            controller.ask()
            advanceUntilIdle()

            assertEquals(1, transport.openedPaths.size)
        }

    @Test
    fun askIsANoOpOfflineOrOverCap() =
        runTest(UnconfinedTestDispatcher()) {
            val offline = ScriptedTransport(emptyList())
            val offlineController = controller(offline, online = false)
            assertFalse(offlineController.canStart)
            offlineController.ask()
            advanceUntilIdle()
            assertTrue(offline.openedPaths.isEmpty())
        }

    @Test
    fun setMessageCapsAtMaxAndDrivesReadiness() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = controller(ScriptedTransport(emptyList()), message = "")
            controller.setMessage("a".repeat(MAX_MESSAGE_CHARS + 100))
            assertEquals(MAX_MESSAGE_CHARS, controller.message.value.length)
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
            assertEquals(mapOf("surface" to "AIWatchFaceNLResponse"), opened.single().second)
        }

    @Test
    fun askEmitsADiagnosticWithoutLeakingTheQuestion() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val transport = ScriptedTransport(listOf(frame("done", buildJsonObject {})))
            val controller = controller(transport, message = "how far have I driven?", logger = logger)
            backgroundScope.launch { controller.state.collect {} }

            controller.ask()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "aiWatchFaceNLResponse.ask" })
            assertNull(logger.events.firstOrNull { (_, fields) -> fields.values.any { it.contains("driven") } })
        }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

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
            put("ai_features", buildJsonObject { put(WATCH_FACE_NL_FEATURE_ID, optedIn) })
        }

    private fun TestScope.controller(
        transport: WatchRespondTransport,
        online: Boolean = true,
        message: String = "how is my battery?",
        logger: Logger = RecordingLogger(),
    ): WatchRespondController =
        WatchRespondController(transport, online, backgroundScope, logger, clock = { FIXED_NOW }).also { it.setMessage(message) }

    private class ScriptedTransport(
        private val chunks: List<String> = emptyList(),
        private val failWith: Throwable? = null,
        private val suspendAfter: Boolean = false,
        private val failWithAfterRuns: Int = 0,
    ) : WatchRespondTransport {
        val openedPaths = mutableListOf<String>()
        val openedBodies = mutableListOf<String>()
        private var runs = 0

        override fun open(
            path: String,
            body: String,
        ): Flow<String> =
            flow {
                openedPaths += path
                openedBodies += body
                val thisRun = runs
                runs++
                chunks.forEach { emit(it) }
                if (failWith != null && thisRun >= failWithAfterRuns) throw failWith
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

    private companion object {
        const val FIXED_NOW = 5_000L
    }
}
