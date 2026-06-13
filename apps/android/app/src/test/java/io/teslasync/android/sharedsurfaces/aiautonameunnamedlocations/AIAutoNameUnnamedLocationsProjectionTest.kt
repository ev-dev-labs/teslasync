package io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the AIAutoNameUnnamedLocations surface's pure logic — the native analogue of the
 * web component's data + derivations (web/src/components/ai/AIAutoNameUnnamedLocations.tsx plus the slice of
 * web/src/hooks/useAiStream.ts it consumes): the SSE frame parser (`parseSSEFrame`/`toTypedEvent`), the
 * tool-result → draft "data adapter" (`handleEvent`), the event reducer, the chunk reassembler + real decoder,
 * the registration/test-tag contract, and the PII-safe diagnostics. Runs in the :android:testReleaseUnitTest
 * gate.
 */
class AIAutoNameUnnamedLocationsProjectionTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun toolResultFrame(dataJson: String): String =
        "event: tool_result\ndata: {\"id\":\"t1\",\"name\":\"draft_location_name\",\"ok\":true,\"data\":$dataJson}"

    private fun toolResult(
        name: String,
        ok: Boolean,
        dataJson: String,
        error: String? = null,
    ): AiStreamEvent.ToolResult = AiStreamEvent.ToolResult("t1", name, ok, json.parseToJsonElement(dataJson), error)

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ─────────────────────────

    @Test
    fun parseFrameDecodesAToolResultFrame() {
        val event = AiNameDraftReducer.parseFrame(toolResultFrame("""{"location_id":42,"proposed_name":"Home","status":"ok"}"""))
        val result = event as AiStreamEvent.ToolResult
        assertEquals("draft_location_name", result.name)
        assertEquals(true, result.ok)
    }

    @Test
    fun parseFrameDecodesDeltaDoneAndErrorEvents() {
        assertEquals(
            AiStreamEvent.Delta("hi"),
            AiNameDraftReducer.parseFrame("event: delta\ndata: {\"text\":\"hi\"}"),
        )
        assertEquals(
            AiStreamEvent.Done("stop"),
            AiNameDraftReducer.parseFrame("event: done\ndata: {\"finish_reason\":\"stop\"}"),
        )
        assertEquals(
            AiStreamEvent.Failure("boom"),
            AiNameDraftReducer.parseFrame("event: error\ndata: {\"message\":\"boom\"}"),
        )
    }

    @Test
    fun parseFrameHandlesNoSpacePrefixesCommentsAndMultiLineData() {
        // `event:x` / `data:x` without the space after the colon (web handles both forms).
        assertEquals(
            AiStreamEvent.Delta("world"),
            AiNameDraftReducer.parseFrame("event:delta\ndata:{\"text\":\"world\"}"),
        )
        // A leading SSE comment line is ignored; the event still resolves.
        assertEquals(
            AiStreamEvent.Done("stop"),
            AiNameDraftReducer.parseFrame(":keep-alive\nevent: done\ndata: {}"),
        )
        // Multiple data: lines are joined with a newline before JSON parsing (web dataParts.join('\n')).
        assertEquals(
            AiStreamEvent.Delta("split"),
            AiNameDraftReducer.parseFrame("event: delta\ndata: {\"text\":\ndata: \"split\"}"),
        )
    }

    @Test
    fun parseFrameReturnsNullForNoEventMalformedJsonAndUnknownType() {
        assertEquals(null, AiNameDraftReducer.parseFrame("data: {\"text\":\"x\"}"))
        assertEquals(null, AiNameDraftReducer.parseFrame("event: delta\ndata: {not json"))
        assertEquals(null, AiNameDraftReducer.parseFrame("event: who_knows\ndata: {\"x\":1}"))
    }

    @Test
    fun toTypedEventEnforcesRequiredFields() {
        assertEquals(null, AiNameDraftReducer.toTypedEvent("delta", json.parseToJsonElement("{}")))
        assertEquals(null, AiNameDraftReducer.toTypedEvent("tool_result", json.parseToJsonElement("""{"id":"a","name":"b"}""")))
        assertEquals(null, AiNameDraftReducer.toTypedEvent("delta", json.parseToJsonElement("\"not-an-object\"")))
        assertEquals(null, AiNameDraftReducer.toTypedEvent("delta", null))
    }

    // ── Tool-result → draft projection (web handleEvent) ─────────────────────────────

    @Test
    fun draftFromToolResultProjectsAValidAcceptedResult() {
        val data = """{"location_id":42,"proposed_name":"Home","status":"ok","reason":"frequent"}"""
        val draft = AiNameDraftReducer.draftFromToolResult(toolResult("draft_location_name", true, data))
        assertEquals(LocationNameDraft(42L, "Home", "ok", "frequent"), draft)
        assertEquals(true, draft?.isOk)
    }

    @Test
    fun draftFromToolResultKeepsRejectedStatusWithoutReason() {
        val data = """{"location_id":7,"proposed_name":"Spot","status":"rejected"}"""
        val draft = AiNameDraftReducer.draftFromToolResult(toolResult("draft_location_name", true, data))
        assertEquals(LocationNameDraft(7L, "Spot", "rejected", null), draft)
        assertEquals(false, draft?.isOk)
    }

    @Test
    fun draftFromToolResultRejectsWrongToolNotOkAndBadTypes() {
        val valid = """{"location_id":1,"proposed_name":"X","status":"ok"}"""
        // Wrong tool name.
        assertEquals(null, AiNameDraftReducer.draftFromToolResult(toolResult("other_tool", true, valid)))
        // ok == false.
        assertEquals(null, AiNameDraftReducer.draftFromToolResult(toolResult("draft_location_name", false, valid, "denied")))
        // location_id is a string (web `typeof !== 'number'`).
        val stringId = """{"location_id":"42","proposed_name":"X","status":"ok"}"""
        assertEquals(null, AiNameDraftReducer.draftFromToolResult(toolResult("draft_location_name", true, stringId)))
        // proposed_name + status missing.
        val missing = """{"location_id":42,"status":"ok"}"""
        assertEquals(null, AiNameDraftReducer.draftFromToolResult(toolResult("draft_location_name", true, missing)))
    }

    // ── Reducer (web per-event state updates + handleEvent) ──────────────────────────

    @Test
    fun reduceAccumulatesDeltaTextAndCapturesAValidDraft() {
        var state = AiNameDraftUiState(phase = AiNameDraftPhase.Streaming)
        state = AiNameDraftReducer.reduce(state, AiStreamEvent.Delta("Think"))
        state = AiNameDraftReducer.reduce(state, AiStreamEvent.Delta("ing"))
        assertEquals("Thinking", state.text)

        val toolResult =
            AiStreamEvent.ToolResult(
                id = "t1",
                name = "draft_location_name",
                ok = true,
                data = json.parseToJsonElement("""{"location_id":42,"proposed_name":"Home","status":"ok"}"""),
                error = null,
            )
        state = AiNameDraftReducer.reduce(state, toolResult)
        assertEquals("Home", state.draft?.proposedName)
        assertEquals(AiNameDraftPhase.Streaming, state.phase)
    }

    @Test
    fun reduceAdvancesLifecycleForConfirmDoneAndError() {
        assertEquals(
            AiNameDraftPhase.PausedConfirm,
            AiNameDraftReducer.reduce(AiNameDraftUiState.IDLE, AiStreamEvent.ConfirmRequest("c", "tool", "summary")).phase,
        )
        assertEquals(
            AiNameDraftPhase.Done,
            AiNameDraftReducer.reduce(AiNameDraftUiState.IDLE, AiStreamEvent.Done("stop")).phase,
        )
        val errored = AiNameDraftReducer.reduce(AiNameDraftUiState.IDLE, AiStreamEvent.Failure("stream_http_503"))
        assertEquals(AiNameDraftPhase.Error, errored.phase)
        assertEquals("stream_http_503", errored.errorMessage)
    }

    @Test
    fun reduceLeavesStateUnchangedForToolCallAndInvalidToolResult() {
        val start = AiNameDraftUiState(phase = AiNameDraftPhase.Streaming, text = "x")
        assertEquals(start, AiNameDraftReducer.reduce(start, AiStreamEvent.ToolCall("c", "draft_location_name", null)))
        val invalid = AiStreamEvent.ToolResult("t", "draft_location_name", true, json.parseToJsonElement("""{"proposed_name":"X"}"""), null)
        assertEquals(start, AiNameDraftReducer.reduce(start, invalid))
    }

    // ── UI-state derivations (web canStart / isBusy) ─────────────────────────────────

    @Test
    fun canSuggestMatchesWebCanStartAndStreamingDisable() {
        assertEquals(true, AiNameDraftUiState.IDLE.canSuggest(42))
        // Non-positive id is rejected (web `locationId > 0`).
        assertEquals(false, AiNameDraftUiState.IDLE.canSuggest(0))
        // Streaming disables the action (web AIFeatureCard `!canStart || isStreaming`).
        assertEquals(false, AiNameDraftUiState(phase = AiNameDraftPhase.Streaming).canSuggest(42))
        // Paused-confirm is not startable (web `stream.state !== 'paused-confirm'`).
        assertEquals(false, AiNameDraftUiState(phase = AiNameDraftPhase.PausedConfirm).canSuggest(42))
        assertEquals(true, AiNameDraftUiState(phase = AiNameDraftPhase.PausedConfirm).isBusy)
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
    fun sseAiNameDraftSourceDecodesAChunkedStreamIntoTypedEvents() =
        runTest {
            val raw =
                "event: delta\ndata: {\"text\":\"…\"}\n\n" +
                    toolResultFrame("""{"location_id":42,"proposed_name":"Home","status":"ok"}""") + "\n\n" +
                    "event: done\ndata: {\"finish_reason\":\"stop\"}\n\n"
            // Deliberately chunk the bytes so frame boundaries do not align with chunk boundaries.
            val transport = AiNameDraftTransport { flowOf(raw.substring(0, 20), raw.substring(20, 90), raw.substring(90)) }
            val events = SseAiNameDraftSource(transport).draft(42).toList()
            assertEquals(3, events.size)
            assertEquals(AiStreamEvent.Delta("…"), events[0])
            assertEquals("Home", (AiNameDraftReducer.draftFromToolResult(events[1] as AiStreamEvent.ToolResult))?.proposedName)
            assertEquals(AiStreamEvent.Done("stop"), events[2])
        }

    @Test
    fun sseAiNameDraftSourceDrainsAFinalFrameWithoutTrailingBlankLine() =
        runTest {
            val transport = AiNameDraftTransport { flowOf("event: done\ndata: {\"finish_reason\":\"stop\"}") }
            val events = SseAiNameDraftSource(transport).draft(1).toList()
            assertEquals(listOf(AiStreamEvent.Done("stop")), events)
        }

    // ── Registration + diagnostics (P1/S11 view.opened contract) ─────────────────────

    @Test
    fun registrationExposesStableGateIdSlugAndParityTestTags() {
        assertEquals("auto-name-unnamed-locations", AIAutoNameUnnamedLocationsRegistration.FEATURE_ID)
        assertEquals("AIAutoNameUnnamedLocations", AIAutoNameUnnamedLocationsRegistration.SLUG)
        assertEquals("ai-feature-auto-name-unnamed-locations-suggest", AIAutoNameUnnamedLocationsRegistration.SUGGEST_TEST_TAG)
        assertEquals("ai-feature-auto-name-unnamed-locations-draft", AIAutoNameUnnamedLocationsRegistration.DRAFT_TEST_TAG)
        assertEquals("ai-feature-auto-name-unnamed-locations-apply", AIAutoNameUnnamedLocationsRegistration.APPLY_TEST_TAG)
    }

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAIAutoNameUnnamedLocationsOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AIAutoNameUnnamedLocations"), fields)
    }

    @Test
    fun actionDiagnosticsCarryOnlySlugAndNonPiiStatus() {
        val logger = RecordingLogger()

        recordAIAutoNameUnnamedLocationsSuggested(logger)
        recordAIAutoNameUnnamedLocationsApplied(logger, "ok")

        assertEquals("aiAutoName.suggest", logger.records[0].event)
        assertEquals(mapOf("surface" to "AIAutoNameUnnamedLocations"), logger.records[0].fields)
        assertEquals("aiAutoName.applied", logger.records[1].event)
        assertEquals(mapOf("surface" to "AIAutoNameUnnamedLocations", "status" to "ok"), logger.records[1].fields)
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
