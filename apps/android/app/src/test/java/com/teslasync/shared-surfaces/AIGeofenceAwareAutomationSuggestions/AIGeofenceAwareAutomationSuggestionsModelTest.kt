// Off-device unit tests for the AIGeofenceAwareAutomationSuggestions model + projection (the
// :android:testReleaseUnitTest gate). These cover the framework-free core the composable renders: the
// `tool_result` → AutomationProposal extraction + the defensive `normalizeAutomationInput` narrowing (web
// `handleEvent` + `normalizeAutomationInput`), the SSE frame parser (the consume side of web `useAiStream`), the
// every-state render projection (loading / content / empty / error / stale / offline), and the i18n key folding
// + fallback parity that backs every accessible label. The composable is a thin render layer over these, so
// exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIGeofenceAwareAutomationSuggestionsModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals(
            "translation_automations_builder_aiGeofenceAware_title",
            foldCatalogKey(GeofenceDraftKeys.TITLE),
        )
        assertEquals(
            "translation_automations_builder_aiGeofenceAware_suggestButton",
            foldCatalogKey(GeofenceDraftKeys.SUGGEST_BUTTON),
        )
        assertEquals("translation_helix_askHelix", foldCatalogKey(GeofenceDraftKeys.ASK_HELIX))
        assertEquals("translation_common_retry", foldCatalogKey(GeofenceDraftKeys.RETRY))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = geofenceDraftLabels(FallbackResolver)
        assertEquals("Suggest a geofence-aware automation", labels.title)
        assertEquals(
            "Describe an automation that uses one of your existing geofences. Helix proposes a typed graph " +
                "anchored to a place_id you already have — review and apply to the form below before saving.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Suggest automation", labels.suggestButton)
        assertEquals("Proposed automation", labels.proposalLabel)
        assertEquals("Apply to form", labels.applyButton)
        assertEquals("Proposal rejected by validator", labels.rejectedLabel)
        assertEquals("Triggers", labels.triggersLabel)
        assertEquals("Conditions", labels.conditionsLabel)
        assertEquals("Actions", labels.actionsLabel)
        assertEquals("(unnamed)", labels.unnamed)
        assertEquals("Ask Helix", labels.askHelix)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                GeofenceDraftKeys.TITLE to "Catálogo title",
                GeofenceDraftKeys.SUGGEST_BUTTON to "Catálogo suggest",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = geofenceDraftLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo suggest", labels.suggestButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Apply to form", labels.applyButton)
    }

    @Test
    fun suggestButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Suggest automation", suggestButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = geofenceDraftLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.suggestButton,
            labels.promptHint,
            labels.proposalLabel,
            labels.applyButton,
            labels.rejectedLabel,
            labels.triggersLabel,
            labels.conditionsLabel,
            labels.actionsLabel,
            labels.unnamed,
            labels.askHelix,
            labels.thinking,
            labels.errorLabel,
            labels.empty,
            labels.waiting,
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── normalizeAutomationInput (web normalizeAutomationInput) ───────────────────────────────────────────

    @Test
    fun normalize_capturesValidGraph() {
        val graph = normalizeAutomationInput(draftJson())
        assertEquals("Arrive home protection", graph?.name)
        assertEquals(7L, graph?.vehicleId)
        assertEquals(true, graph?.enabled)
        assertEquals("desc", graph?.description)
        assertEquals(2, graph?.triggerCount)
        assertEquals(1, graph?.conditionCount)
        assertEquals(3, graph?.actionCount)
    }

    @Test
    fun normalize_allowsEmptyNameAndDefaultsDescription() {
        val graph = normalizeAutomationInput(draftJson(name = "", description = null))
        assertEquals("", graph?.name)
        assertEquals("", graph?.description)
    }

    @Test
    fun normalize_rejectsNonObject() {
        assertNull(normalizeAutomationInput(JsonNull))
        assertNull(normalizeAutomationInput(JsonPrimitive("nope")))
        assertNull(normalizeAutomationInput(null))
    }

    @Test
    fun normalize_rejectsMissingOrMistypedRequiredFields() {
        // name not a string
        assertNull(normalizeAutomationInput(draftJson().mutate { put("name", 5) }))
        // vehicle_id a string-typed number (web `typeof === 'number'`)
        assertNull(normalizeAutomationInput(draftJson().mutate { put("vehicle_id", "7") }))
        // enabled missing
        assertNull(normalizeAutomationInput(draftJson().without("enabled")))
        // triggers not an array
        assertNull(normalizeAutomationInput(draftJson().mutate { put("triggers", 1) }))
        // conditions missing
        assertNull(normalizeAutomationInput(draftJson().without("conditions")))
        // actions missing
        assertNull(normalizeAutomationInput(draftJson().without("actions")))
    }

    // ── tool_result → AutomationProposal extraction (web handleEvent) ─────────────────────────────────────

    @Test
    fun extractProposal_capturesOkProposal() {
        val proposal = extractProposal(toolResult())
        assertEquals("ok", proposal?.status)
        assertTrue(proposal?.isOk == true)
        assertEquals("Arrive home protection", proposal?.graph?.name)
        assertNull(proposal?.validationError)
    }

    @Test
    fun extractProposal_capturesNonOkProposalWithValidationError() {
        val proposal = extractProposal(toolResult(status = "invalid", validationError = "place_id not found"))
        assertEquals("invalid", proposal?.status)
        assertFalse(proposal?.isOk == true)
        assertEquals("place_id not found", proposal?.validationError)
    }

    @Test
    fun extractProposal_ignoresWrongToolName() {
        assertNull(extractProposal(toolResult(name = "some_other_tool")))
    }

    @Test
    fun extractProposal_ignoresNotOk() {
        assertNull(extractProposal(toolResult(ok = false)))
    }

    @Test
    fun extractProposal_ignoresMissingOrMalformedDraft() {
        assertNull(extractProposal(toolResult(draft = null)))
        assertNull(extractProposal(toolResult(draft = buildJsonObject { put("name", "no scope") })))
    }

    @Test
    fun extractProposal_ignoresNonStringStatus() {
        assertNull(extractProposal(toolResult(status = null)))
    }

    @Test
    fun extractProposal_ignoresNonToolResultEvent() {
        assertNull(extractProposal(AiStreamEvent.Delta("hello")))
        assertNull(extractProposal(AiStreamEvent.Done("stop")))
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_emptyWhenIdleNoProposal() {
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, StreamRuntime(), online = true)
        assertEquals(GeofenceDraftRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_contentWhenProposalCaptured() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = okProposal())
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Content, snapshot.renderState)
        assertEquals("ok", snapshot.proposal?.status)
    }

    @Test
    fun project_contentWhenStreamedReplayText() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Drafted a graph anchored to Home…")
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Content, snapshot.renderState)
    }

    @Test
    fun project_loadingWhenStreamingNoProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming)
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, proposal = okProposal())
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val runtime = StreamRuntime(phase = AiStreamPhase.PausedConfirm)
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = true)
        assertEquals(GeofenceDraftRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(
            GeofenceDraftRenderState.Offline,
            projectGeofenceDraft(VEHICLE_ID, promptReady = true, byMessage, online = true).renderState,
        )

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(
            GeofenceDraftRenderState.Offline,
            projectGeofenceDraft(VEHICLE_ID, promptReady = true, byLimit, online = true).renderState,
        )
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = okProposal())
        val snapshot = projectGeofenceDraft(VEHICLE_ID, promptReady = true, runtime, online = false)
        assertEquals(GeofenceDraftRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals("ok", snapshot.proposal?.status)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_canStartFalseWhenNoVehicleSelected() {
        assertFalse(projectGeofenceDraft(vehicleId = 0L, promptReady = true, StreamRuntime(), online = true).canStart)
    }

    @Test
    fun project_canStartFalseWhenPromptBlank() {
        assertFalse(projectGeofenceDraft(VEHICLE_ID, promptReady = false, StreamRuntime(), online = true).canStart)
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_toolResultThenExtractsProposal() {
        val raw =
            "event: tool_result\n" +
                "data: {\"id\":\"1\",\"name\":\"draft_automation_graph\",\"ok\":true," +
                "\"data\":{\"status\":\"ok\",\"draft\":{\"name\":\"Home\",\"vehicle_id\":7,\"enabled\":true," +
                "\"triggers\":[{}],\"conditions\":[],\"actions\":[{},{}]}}}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.ToolResult)
        val proposal = extractProposal(event!!)
        assertEquals("Home", proposal?.graph?.name)
        assertEquals(1, proposal?.graph?.triggerCount)
        assertEquals(2, proposal?.graph?.actionCount)
        assertTrue(proposal?.isOk == true)
    }

    @Test
    fun parseSseFrame_errorWithStructuredLimit() {
        val raw =
            "event: error\n" +
                "data: {\"message\":\"capped\",\"reason\":\"cost_cap\",\"retry_after_s\":30,\"banner_level\":\"warn\"}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.StreamError)
        val error = event as AiStreamEvent.StreamError
        assertEquals("capped", error.message)
        assertEquals("cost_cap", error.reason)
        assertEquals(30, error.retryAfterS)
        assertEquals("warn", error.bannerLevel)
    }

    @Test
    fun parseSseFrame_unknownEventReturnsNull() {
        assertNull(parseSseFrame("event: mystery\ndata: {}"))
    }

    @Test
    fun parseSseFrame_malformedJsonReturnsNull() {
        assertNull(parseSseFrame("event: delta\ndata: {bad json"))
    }

    @Test
    fun parseSseFrame_missingEventReturnsNull() {
        assertNull(parseSseFrame("data: {\"text\":\"x\"}"))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun draftJson(
        name: String = "Arrive home protection",
        description: String? = "desc",
    ): JsonObject =
        buildJsonObject {
            put("name", name)
            put("vehicle_id", 7)
            put("enabled", true)
            if (description != null) put("description", description)
            putJsonArray("triggers") { repeat(2) { add(buildJsonObject { put("type", "geofence_enter") }) } }
            putJsonArray("conditions") { add(buildJsonObject { put("type", "time_window") }) }
            putJsonArray("actions") { repeat(3) { add(buildJsonObject { put("type", "command") }) } }
        }

    private fun JsonObject.mutate(block: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): JsonObject =
        buildJsonObject {
            this@mutate.forEach { (key, value) -> put(key, value) }
            block()
        }

    private fun JsonObject.without(key: String): JsonObject = buildJsonObject { this@without.forEach { (k, v) -> if (k != key) put(k, v) } }

    private fun toolResult(
        name: String = DRAFT_TOOL_NAME,
        ok: Boolean = true,
        draft: JsonElement? = draftJson(),
        status: String? = "ok",
        validationError: String? = null,
    ): AiStreamEvent.ToolResult {
        val data =
            buildJsonObject {
                if (draft != null) put("draft", draft)
                if (status != null) put("status", status)
                if (validationError != null) put("validation_error", validationError)
            }
        return AiStreamEvent.ToolResult(id = "t1", name = name, ok = ok, data = data, error = null)
    }

    private fun okProposal(): AutomationProposal =
        AutomationProposal(
            graph =
                AutomationGraphDraft(
                    name = "Arrive home protection",
                    description = "desc",
                    vehicleId = 7L,
                    enabled = true,
                    triggers = emptyList(),
                    conditions = emptyList(),
                    actions = emptyList(),
                ),
            status = "ok",
        )

    private companion object {
        const val VEHICLE_ID = 7L
    }
}
