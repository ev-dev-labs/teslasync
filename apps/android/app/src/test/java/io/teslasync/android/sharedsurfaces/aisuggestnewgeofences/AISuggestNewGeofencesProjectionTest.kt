package io.teslasync.android.sharedsurfaces.aisuggestnewgeofences

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the AISuggestNewGeofences surface's pure logic — the native analogue of the web
 * component's data + derivations (web/src/components/ai/AISuggestNewGeofences.tsx plus the slice of
 * web/src/hooks/useAiStream.ts it consumes): the SSE frame parser (`parseSSEFrame`/`toTypedEvent`), the nested
 * tool-result → draft "data adapter" (`handleEvent`, including the wrapper/inner split), the event reducer, the
 * chunk reassembler + real decoder, the registration/test-tag contract, and the PII-safe diagnostics. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class AISuggestNewGeofencesProjectionTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun toolResultFrame(dataJson: String): String =
        "event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"draft_geofence\",\"ok\":true,\"data\":$dataJson}"

    private fun toolResult(
        name: String,
        ok: Boolean,
        dataJson: String,
        error: String? = null,
    ): AiStreamEvent.ToolResult = AiStreamEvent.ToolResult("t1", name, ok, json.parseToJsonElement(dataJson), error)

    private val acceptedData =
        """{"draft":{"location_id":42,"vehicle_id":7,"proposed_name":"Home","radius_m":120,""" +
            """"centroid_lat":37.5,"centroid_lon":-122.25},"status":"ok"}"""

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ─────────────────────────

    @Test
    fun parseFrameDecodesAToolResultFrame() {
        val event = AiGeofenceDraftReducer.parseFrame(toolResultFrame(acceptedData))
        val result = event as AiStreamEvent.ToolResult
        assertEquals("draft_geofence", result.name)
        assertEquals(true, result.ok)
    }

    @Test
    fun parseFrameDecodesDeltaDoneAndErrorEvents() {
        assertEquals(
            AiStreamEvent.Delta("hi"),
            AiGeofenceDraftReducer.parseFrame("event: delta\ndata: {\"text\":\"hi\"}"),
        )
        assertEquals(
            AiStreamEvent.Done("stop"),
            AiGeofenceDraftReducer.parseFrame("event: done\ndata: {\"finish_reason\":\"stop\"}"),
        )
        assertEquals(
            AiStreamEvent.Failure("boom"),
            AiGeofenceDraftReducer.parseFrame("event: error\ndata: {\"message\":\"boom\"}"),
        )
    }

    @Test
    fun parseFrameHandlesNoSpacePrefixesCommentsAndMultiLineData() {
        // `event:x` / `data:x` without the space after the colon (web handles both forms).
        assertEquals(
            AiStreamEvent.Delta("world"),
            AiGeofenceDraftReducer.parseFrame("event:delta\ndata:{\"text\":\"world\"}"),
        )
        // A leading SSE comment line is ignored; the event still resolves.
        assertEquals(
            AiStreamEvent.Done("stop"),
            AiGeofenceDraftReducer.parseFrame(":keep-alive\nevent: done\ndata: {}"),
        )
        // Multiple data: lines are joined with a newline before JSON parsing (web dataParts.join('\n')).
        assertEquals(
            AiStreamEvent.Delta("split"),
            AiGeofenceDraftReducer.parseFrame("event: delta\ndata: {\"text\":\ndata: \"split\"}"),
        )
    }

    @Test
    fun parseFrameReturnsNullForNoEventMalformedJsonAndUnknownType() {
        assertEquals(null, AiGeofenceDraftReducer.parseFrame("data: {\"text\":\"x\"}"))
        assertEquals(null, AiGeofenceDraftReducer.parseFrame("event: delta\ndata: {not json"))
        assertEquals(null, AiGeofenceDraftReducer.parseFrame("event: who_knows\ndata: {\"x\":1}"))
    }

    @Test
    fun toTypedEventEnforcesRequiredFields() {
        assertEquals(null, AiGeofenceDraftReducer.toTypedEvent("delta", json.parseToJsonElement("{}")))
        assertEquals(
            null,
            AiGeofenceDraftReducer.toTypedEvent("tool_result", json.parseToJsonElement("""{"id":"a","name":"b"}""")),
        )
        assertEquals(null, AiGeofenceDraftReducer.toTypedEvent("delta", json.parseToJsonElement("\"not-an-object\"")))
        assertEquals(null, AiGeofenceDraftReducer.toTypedEvent("delta", null))
    }

    // ── Nested tool-result → draft projection (web handleEvent) ──────────────────────

    @Test
    fun draftFromToolResultProjectsAValidAcceptedResult() {
        val draft = AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, acceptedData))
        assertEquals(GeofenceDraft(42L, 7L, "Home", 120.0, 37.5, -122.25, "ok", null), draft)
        assertEquals(true, draft?.isOk)
    }

    @Test
    fun draftFromToolResultKeepsInvalidStatusWithValidationError() {
        val data =
            """{"draft":{"location_id":7,"vehicle_id":3,"proposed_name":"Spot","radius_m":15,""" +
                """"centroid_lat":1.5,"centroid_lon":2.5},"status":"invalid","validation_error":"Radius too small"}"""
        val draft = AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, data))
        assertEquals(GeofenceDraft(7L, 3L, "Spot", 15.0, 1.5, 2.5, "invalid", "Radius too small"), draft)
        assertEquals(false, draft?.isOk)
    }

    @Test
    fun draftFromToolResultRejectsWrongToolNotOkMissingWrapperAndBadTypes() {
        // Wrong tool name.
        assertEquals(null, AiGeofenceDraftReducer.draftFromToolResult(toolResult("other_tool", true, acceptedData)))
        // ok == false.
        assertEquals(
            null,
            AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", false, acceptedData, "denied")),
        )
        // Missing nested `draft` wrapper (web `!inner`).
        val noWrapper = """{"status":"ok"}"""
        assertEquals(null, AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, noWrapper)))
        // location_id is a string (web `typeof inner.location_id !== 'number'`).
        val stringId =
            """{"draft":{"location_id":"42","vehicle_id":7,"proposed_name":"X","radius_m":50,""" +
                """"centroid_lat":1.0,"centroid_lon":2.0},"status":"ok"}"""
        assertEquals(null, AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, stringId)))
        // Missing wrapper status (web `typeof wrapper?.status !== 'string'`).
        val noStatus =
            """{"draft":{"location_id":42,"vehicle_id":7,"proposed_name":"X","radius_m":50,""" +
                """"centroid_lat":1.0,"centroid_lon":2.0}}"""
        assertEquals(null, AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, noStatus)))
        // Missing an inner field (radius_m absent).
        val missingRadius =
            """{"draft":{"location_id":42,"vehicle_id":7,"proposed_name":"X",""" +
                """"centroid_lat":1.0,"centroid_lon":2.0},"status":"ok"}"""
        assertEquals(
            null,
            AiGeofenceDraftReducer.draftFromToolResult(toolResult("draft_geofence", true, missingRadius)),
        )
    }

    // ── Reducer (web per-event state updates + handleEvent) ──────────────────────────

    @Test
    fun reduceAccumulatesDeltaTextAndCapturesAValidDraft() {
        var state = AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Streaming)
        state = AiGeofenceDraftReducer.reduce(state, AiStreamEvent.Delta("Think"))
        state = AiGeofenceDraftReducer.reduce(state, AiStreamEvent.Delta("ing"))
        assertEquals("Thinking", state.text)

        val event =
            AiStreamEvent.ToolResult(
                id = "t1",
                name = "draft_geofence",
                ok = true,
                data = json.parseToJsonElement(acceptedData),
                error = null,
            )
        state = AiGeofenceDraftReducer.reduce(state, event)
        assertEquals("Home", state.draft?.proposedName)
        assertEquals(120.0, state.draft?.radiusM)
        assertEquals(AiGeofenceDraftPhase.Streaming, state.phase)
    }

    @Test
    fun reduceAdvancesLifecycleForConfirmDoneAndError() {
        assertEquals(
            AiGeofenceDraftPhase.PausedConfirm,
            AiGeofenceDraftReducer
                .reduce(AiGeofenceDraftUiState.IDLE, AiStreamEvent.ConfirmRequest("c", "tool", "summary"))
                .phase,
        )
        assertEquals(
            AiGeofenceDraftPhase.Done,
            AiGeofenceDraftReducer.reduce(AiGeofenceDraftUiState.IDLE, AiStreamEvent.Done("stop")).phase,
        )
        val errored = AiGeofenceDraftReducer.reduce(AiGeofenceDraftUiState.IDLE, AiStreamEvent.Failure("stream_http_503"))
        assertEquals(AiGeofenceDraftPhase.Error, errored.phase)
        assertEquals("stream_http_503", errored.errorMessage)
    }

    @Test
    fun reduceLeavesStateUnchangedForToolCallAndInvalidToolResult() {
        val start = AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Streaming, text = "x")
        assertEquals(start, AiGeofenceDraftReducer.reduce(start, AiStreamEvent.ToolCall("c", "draft_geofence", null)))
        val invalid =
            AiStreamEvent.ToolResult("t", "draft_geofence", true, json.parseToJsonElement("""{"status":"ok"}"""), null)
        assertEquals(start, AiGeofenceDraftReducer.reduce(start, invalid))
    }

    // ── UI-state derivations (web canStart / isBusy) ─────────────────────────────────

    @Test
    fun canSuggestMatchesWebCanStartAndStreamingDisable() {
        assertEquals(true, AiGeofenceDraftUiState.IDLE.canSuggest(42))
        // Non-positive id is rejected (web `locationId > 0`).
        assertEquals(false, AiGeofenceDraftUiState.IDLE.canSuggest(0))
        // Streaming disables the action (web AIFeatureCard `!canStart || isStreaming`).
        assertEquals(false, AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Streaming).canSuggest(42))
        // Paused-confirm is not startable (web `stream.state !== 'paused-confirm'`).
        assertEquals(false, AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.PausedConfirm).canSuggest(42))
        assertEquals(true, AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.PausedConfirm).isBusy)
    }

    // ── Reassembler + real decoder (web read loop) ───────────────────────────────────

    @Test
    fun reassemblerSplitsFramesAcrossChunkBoundariesAndFlushesTheTail() {
        val reassembler = SseFrameReassembler()
        // A frame split across two chunks; the delimiter arrives in the second chunk.
        assertEquals(emptyList<String>(), reassembler.feed("event: done\ndata: {}"))
        val closed = reassembler.feed("\n\nevent: delta\ndata: {\"text\":\"x\"}")
        assertEquals(listOf("event: done\ndata: {}"), closed)
        // The second frame has no trailing blank line — it drains on flush.
        assertEquals("event: delta\ndata: {\"text\":\"x\"}", reassembler.flush())
        assertEquals(null, reassembler.flush())
    }

    @Test
    fun sseAiGeofenceDraftSourceDecodesAChunkedStreamIntoTypedEvents() =
        runTest {
            val raw =
                "event: delta\ndata: {\"text\":\"…\"}\n\n" +
                    toolResultFrame(acceptedData) + "\n\n" +
                    "event: done\ndata: {\"finish_reason\":\"stop\"}\n\n"
            // Deliberately chunk the bytes so frame boundaries do not align with chunk boundaries.
            val transport =
                AiGeofenceDraftTransport { flowOf(raw.substring(0, 20), raw.substring(20, 90), raw.substring(90)) }
            val events = SseAiGeofenceDraftSource(transport).draft(42).toList()
            assertEquals(3, events.size)
            assertEquals(AiStreamEvent.Delta("…"), events[0])
            assertEquals(
                "Home",
                AiGeofenceDraftReducer.draftFromToolResult(events[1] as AiStreamEvent.ToolResult)?.proposedName,
            )
            assertEquals(AiStreamEvent.Done("stop"), events[2])
        }

    @Test
    fun sseAiGeofenceDraftSourceDrainsAFinalFrameWithoutTrailingBlankLine() =
        runTest {
            val transport = AiGeofenceDraftTransport { flowOf("event: done\ndata: {\"finish_reason\":\"stop\"}") }
            val events = SseAiGeofenceDraftSource(transport).draft(1).toList()
            assertEquals(listOf(AiStreamEvent.Done("stop")), events)
        }

    // ── Registration + diagnostics (P1/S11 view.opened contract) ─────────────────────

    @Test
    fun registrationExposesStableGateIdSlugAndParityTestTags() {
        assertEquals("suggest-new-geofences", AISuggestNewGeofencesRegistration.FEATURE_ID)
        assertEquals("AISuggestNewGeofences", AISuggestNewGeofencesRegistration.SLUG)
        assertEquals("ai-feature-suggest-new-geofences-root", AISuggestNewGeofencesRegistration.ROOT_TEST_TAG)
        assertEquals("ai-feature-suggest-new-geofences-suggest", AISuggestNewGeofencesRegistration.SUGGEST_TEST_TAG)
        assertEquals("ai-feature-suggest-new-geofences-draft", AISuggestNewGeofencesRegistration.DRAFT_TEST_TAG)
        assertEquals("ai-feature-suggest-new-geofences-apply", AISuggestNewGeofencesRegistration.APPLY_TEST_TAG)
    }

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAISuggestNewGeofencesOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AISuggestNewGeofences"), fields)
    }

    @Test
    fun actionDiagnosticsCarryOnlySlugAndNonPiiStatus() {
        val logger = RecordingLogger()

        recordAISuggestNewGeofencesSuggested(logger)
        recordAISuggestNewGeofencesApplied(logger, "ok")

        assertEquals("aiSuggestGeofence.suggest", logger.records[0].event)
        assertEquals(mapOf("surface" to "AISuggestNewGeofences"), logger.records[0].fields)
        assertEquals("aiSuggestGeofence.applied", logger.records[1].event)
        assertEquals(mapOf("surface" to "AISuggestNewGeofences", "status" to "ok"), logger.records[1].fields)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
