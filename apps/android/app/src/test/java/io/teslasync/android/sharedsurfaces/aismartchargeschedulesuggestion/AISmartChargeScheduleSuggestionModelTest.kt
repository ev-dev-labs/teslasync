package io.teslasync.android.sharedsurfaces.aismartchargeschedulesuggestion

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
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Off-device verification of the AISmartChargeScheduleSuggestion surface's pure logic + stream lifecycle — the
 * native analogue of every derivation the web component + useAiStream perform
 * (web/src/components/ai/AISmartChargeScheduleSuggestion.tsx, web/src/hooks/useAiStream.ts): the request body
 * builder ([draftRequestBody] + [normalizeDepartBy] + [parseVehicleId]), the action-readiness predicate
 * ([isScheduleReady]), the SSE wire parser ([parseSseFrame], [SseFrameAccumulator]), the stream reducer
 * ([reduceSchedule]), the withAiFeature off-mode gate ([isSmartChargeScheduleEnabled]), the PII-safe
 * `view.opened` diagnostic, and the [SmartChargeScheduleDraftController] lifecycle (idle → streaming → done /
 * error, cancellation, coalescing, and the offline / missing-input gate) driven over a scripted
 * [ScheduleDraftTransport] with no real network. Run by the `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AISmartChargeScheduleSuggestionModelTest {
    // ── Request body (web useMemo body + JSON.stringify) ──────────────────────────────

    @Test
    fun draftRequestBodyUsesEveryInputInTheWebKeyOrder() {
        val inputs =
            SmartChargeInputs(
                vehicleId = "12",
                targetSoc = 90,
                currentSoc = 35,
                departBy = "2026-06-14T07:30",
                ratePlanId = "tou-evening",
                maxAmps = 40,
                batteryCapacityKwh = 82,
                chargerVoltage = 208,
                preferOffPeak = false,
            )
        val expected =
            """{"vehicle_id":12,"target_soc":90,"depart_by":"2026-06-14T07:30:00.000Z",""" +
                """"rate_plan_id":"tou-evening","max_amps":40,"battery_capacity_kwh":82,""" +
                """"charger_voltage":208,"prefer_off_peak":false,"current_soc":35}"""
        assertEquals(expected, draftRequestBody(inputs, NOW, ZoneOffset.UTC))
    }

    @Test
    fun draftRequestBodyAppliesTheWebPerFieldDefaults() {
        val inputs = SmartChargeInputs(vehicleId = "7", ratePlanId = "flat")
        val expected =
            """{"vehicle_id":7,"target_soc":80,"depart_by":"2026-06-13T21:06:55.377Z",""" +
                """"rate_plan_id":"flat","max_amps":32,"battery_capacity_kwh":75,""" +
                """"charger_voltage":240,"prefer_off_peak":true,"current_soc":20}"""
        assertEquals(expected, draftRequestBody(inputs, NOW, ZoneOffset.UTC))
    }

    @Test
    fun parseVehicleIdCoercesLikeNumberOrZero() {
        assertEquals(12L, parseVehicleId("12"))
        assertEquals(9L, parseVehicleId("  9 "))
        assertEquals(0L, parseVehicleId("0"))
        assertEquals(0L, parseVehicleId(""))
        assertEquals(0L, parseVehicleId("abc"))
        assertEquals(0L, parseVehicleId(null))
    }

    // ── depart_by normalization (web new Date(departBy).toISOString()) ─────────────────

    @Test
    fun normalizeDepartByFallsBackToNowForABlankOrNullValue() {
        val nowIso = "2026-06-13T21:06:55.377Z"
        assertEquals(nowIso, normalizeDepartBy(null, NOW, ZoneOffset.UTC))
        assertEquals(nowIso, normalizeDepartBy("", NOW, ZoneOffset.UTC))
        assertEquals(nowIso, normalizeDepartBy("   ", NOW, ZoneOffset.UTC))
    }

    @Test
    fun normalizeDepartByReadsADatetimeLocalInTheSuppliedZone() {
        // 12:00 local in America/New_York (EST, UTC-5 in January) -> 17:00Z.
        assertEquals(
            "2026-01-15T17:00:00.000Z",
            normalizeDepartBy("2026-01-15T12:00", NOW, ZoneId.of("America/New_York")),
        )
        // Same wall time read in UTC stays at 12:00Z.
        assertEquals("2026-01-15T12:00:00.000Z", normalizeDepartBy("2026-01-15T12:00", NOW, ZoneOffset.UTC))
    }

    @Test
    fun normalizeDepartByHonorsAnExplicitOffsetRegardlessOfZone() {
        assertEquals(
            "2026-03-01T10:30:00.000Z",
            normalizeDepartBy("2026-03-01T12:30:00+02:00", NOW, ZoneId.of("America/New_York")),
        )
        assertEquals("2026-03-01T10:30:00.000Z", normalizeDepartBy("2026-03-01T10:30:00Z", NOW, ZoneOffset.UTC))
    }

    @Test
    fun normalizeDepartByFallsBackToNowForAnUnparseableValue() {
        assertEquals("2026-06-13T21:06:55.377Z", normalizeDepartBy("not-a-date", NOW, ZoneOffset.UTC))
    }

    // ── Action readiness (web canStart = !!vehicleId && !!ratePlanId) ──────────────────

    @Test
    fun scheduleIsReadyOnlyWithAVehicleARatePlanAndConnectivity() {
        val full = SmartChargeInputs(vehicleId = "1", ratePlanId = "p")
        assertTrue(isScheduleReady(full, online = true))
        assertFalse("offline", isScheduleReady(full, online = false))
        assertFalse("no vehicle", isScheduleReady(SmartChargeInputs(ratePlanId = "p"), online = true))
        assertFalse("no rate plan", isScheduleReady(SmartChargeInputs(vehicleId = "1"), online = true))
        assertFalse("blank vehicle", isScheduleReady(SmartChargeInputs(vehicleId = " ", ratePlanId = "p"), online = true))
    }

    // ── SSE wire parser (web parseSSEFrame + toTypedEvent) ────────────────────────────

    @Test
    fun parseSseFrameReadsADeltaTextFrame() {
        val event = parseSseFrame(body("delta", buildJsonObject { put("text", "Charge") }))
        assertEquals(AiStreamEvent.Delta("Charge"), event)
    }

    @Test
    fun parseSseFrameToleratesTheNoSpaceFieldForm() {
        val raw = "event:delta\ndata:{\"text\":\"01:00\"}"
        assertEquals(AiStreamEvent.Delta("01:00"), parseSseFrame(raw))
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
                        put("name", "computeSchedule")
                        put("ok", true)
                    },
                ),
            )
        assertEquals(AiStreamEvent.ToolResult("t1", "computeSchedule", ok = true), toolResult)

        val confirm =
            parseSseFrame(
                body(
                    "confirm_request",
                    buildJsonObject {
                        put("continuation_id", "c1")
                        put("tool", "apply")
                        put("summary", "Apply schedule?")
                    },
                ),
            )
        assertEquals(AiStreamEvent.ConfirmRequest("c1", "apply", "Apply schedule?"), confirm)
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
            acc.feed(frame("delta", buildJsonObject { put("text", "01:00") }) + frame("done", buildJsonObject {}))
        assertEquals(2, frames.size)
        assertEquals(AiStreamEvent.Delta("01:00"), parseSseFrame(frames[0]))
        assertEquals(AiStreamEvent.Done(DEFAULT_FINISH_REASON), parseSseFrame(frames[1]))
    }

    @Test
    fun accumulatorReassemblesAFrameSplitAcrossChunks() {
        val acc = SseFrameAccumulator()
        assertTrue("partial frame yields nothing yet", acc.feed("event: delta\nda").isEmpty())
        val frames = acc.feed("ta: {\"text\":\"01:00-05:30\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals(AiStreamEvent.Delta("01:00-05:30"), parseSseFrame(frames.single()))
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
        var state = ScheduleDraftUiState.IDLE
        state = reduceSchedule(state, AiStreamEvent.Delta("Charge 01:00"))
        state = reduceSchedule(state, AiStreamEvent.Delta("–05:30"))
        assertEquals(SchedulePhase.Streaming, state.phase)
        assertEquals("Charge 01:00–05:30", state.schedule)
        assertTrue(state.hasOutput)
    }

    @Test
    fun reduceSettlesDoneAndError() {
        assertEquals(SchedulePhase.Done, reduceSchedule(streaming("01:00"), AiStreamEvent.Done("stop")).phase)
        val failed = reduceSchedule(streaming("01:00"), AiStreamEvent.Failure("stream_http_500"))
        assertEquals(SchedulePhase.Failed, failed.phase)
        assertEquals("stream_http_500", failed.error)
    }

    @Test
    fun reduceLeavesToolAndConfirmFramesInert() {
        val base = streaming("01:00")
        assertEquals(base, reduceSchedule(base, AiStreamEvent.ToolCall("t1", "computeSchedule")))
        assertEquals(base, reduceSchedule(base, AiStreamEvent.ToolResult("t1", "computeSchedule", ok = true)))
        assertEquals(base, reduceSchedule(base, AiStreamEvent.ConfirmRequest("c1", "apply", "Apply?")))
    }

    // ── Off-mode gate (web useAiEnabled) ──────────────────────────────────────────────

    @Test
    fun gateRequiresNonOffModeAndPerFeatureOptIn() {
        assertTrue(isSmartChargeScheduleEnabled(settings(mode = "cloud", optedIn = true)))
        assertTrue(isSmartChargeScheduleEnabled(settings(mode = "local", optedIn = true)))
    }

    @Test
    fun gateFailsClosedForEveryOtherShape() {
        assertFalse("not loaded", isSmartChargeScheduleEnabled(null))
        assertFalse("off mode", isSmartChargeScheduleEnabled(settings(mode = "off", optedIn = true)))
        assertFalse("absent mode", isSmartChargeScheduleEnabled(settings(mode = null, optedIn = true)))
        assertFalse("not opted in", isSmartChargeScheduleEnabled(settings(mode = "cloud", optedIn = false)))
        assertFalse("no features map", isSmartChargeScheduleEnabled(buildJsonObject { put("ai_mode", "cloud") }))
    }

    @Test
    fun gateRequiresAStrictBooleanTrueNotAStringFlag() {
        val stringFlag =
            buildJsonObject {
                put("ai_mode", "cloud")
                put("ai_features", buildJsonObject { put(SMART_CHARGE_SCHEDULE_FEATURE_ID, "true") })
            }
        assertFalse(isSmartChargeScheduleEnabled(stringFlag))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        SmartChargeScheduleDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened" to mapOf("surface" to "AISmartChargeScheduleSuggestion"), logger.events.single())
    }

    // ── Controller lifecycle (web useAiStream over a scripted transport) ──────────────

    @Test
    fun draftStreamsDeltasThenSettlesDoneAndPostsTheChargePlanBody() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(
                    listOf(
                        frame("delta", buildJsonObject { put("text", "Charge 01:00 ") }),
                        frame("delta", buildJsonObject { put("text", "to 05:30") }),
                        frame("done", buildJsonObject {}),
                    ),
                )
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()

            assertEquals(SchedulePhase.Done, controller.state.value.phase)
            assertEquals("Charge 01:00 to 05:30", controller.state.value.schedule)
            assertEquals(listOf(SCHEDULE_DRAFT_PATH), transport.openedPaths)
            val expectedBody =
                """{"vehicle_id":7,"target_soc":80,"depart_by":"2026-06-13T21:06:55.377Z",""" +
                    """"rate_plan_id":"flat","max_amps":32,"battery_capacity_kwh":75,""" +
                    """"charger_voltage":240,"prefer_off_peak":true,"current_soc":20}"""
            assertEquals(listOf(expectedBody), transport.openedBodies)
        }

    @Test
    fun aCleanCloseWithoutATerminalFrameSettlesDone() =
        runTest(UnconfinedTestDispatcher()) {
            val transport = ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "01:00") })))
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()

            assertEquals(SchedulePhase.Done, controller.state.value.phase)
            assertEquals("01:00", controller.state.value.schedule)
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

            assertEquals(SchedulePhase.Failed, controller.state.value.phase)
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

            assertEquals(SchedulePhase.Failed, controller.state.value.phase)
            assertEquals("boom", controller.state.value.error)
        }

    @Test
    fun cancelReturnsAnInFlightStreamToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "01:00") })), suspendAfter = true)
            val controller = controller(transport)
            backgroundScope.launch { controller.state.collect {} }

            controller.draft()
            advanceUntilIdle()
            assertEquals(SchedulePhase.Streaming, controller.state.value.phase)
            assertEquals("01:00", controller.state.value.schedule)

            controller.cancel()
            advanceUntilIdle()
            assertEquals(SchedulePhase.Idle, controller.state.value.phase)
        }

    @Test
    fun draftIsCoalescedWhileAStreamIsAlreadyInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val transport =
                ScriptedTransport(listOf(frame("delta", buildJsonObject { put("text", "01:00") })), suspendAfter = true)
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
            assertEquals(SchedulePhase.Idle, offlineController.state.value.phase)
            assertTrue(offline.openedPaths.isEmpty())

            val noRatePlan = ScriptedTransport(emptyList())
            assertFalse(controller(noRatePlan, inputs = SmartChargeInputs(vehicleId = "7")).canStart)
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
            assertEquals(mapOf("surface" to "AISmartChargeScheduleSuggestion"), opened.single().second)
        }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────

    private fun streaming(text: String) = ScheduleDraftUiState(phase = SchedulePhase.Streaming, schedule = text)

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
            put("ai_features", buildJsonObject { put(SMART_CHARGE_SCHEDULE_FEATURE_ID, optedIn) })
        }

    private fun TestScope.controller(
        transport: ScheduleDraftTransport,
        inputs: SmartChargeInputs = SmartChargeInputs(vehicleId = "7", ratePlanId = "flat"),
        online: Boolean = true,
        logger: Logger = RecordingLogger(),
    ): SmartChargeScheduleDraftController =
        SmartChargeScheduleDraftController(transport, inputs, online, backgroundScope, logger, FIXED_CLOCK)

    private class ScriptedTransport(
        private val chunks: List<String>,
        private val failWith: Throwable? = null,
        private val suspendAfter: Boolean = false,
    ) : ScheduleDraftTransport {
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

    private companion object {
        /** A fixed `new Date()` instant so the now-fallback and controller body are deterministic. */
        val NOW: Instant = Instant.parse("2026-06-13T21:06:55.377Z")

        /** The controller's depart_by clock — fixed at [NOW] in UTC so the posted body never drifts. */
        val FIXED_CLOCK: Clock = Clock.fixed(NOW, ZoneOffset.UTC)
    }
}
