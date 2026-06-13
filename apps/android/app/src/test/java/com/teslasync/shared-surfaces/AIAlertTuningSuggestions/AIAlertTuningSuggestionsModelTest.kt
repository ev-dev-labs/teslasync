// Off-device unit tests for the AIAlertTuningSuggestions model + projection (the :android:testReleaseUnitTest
// gate). These cover the framework-free core the composable renders: the `tool_result` → AlertRuleDraftPatch
// extraction (web `handleEvent`), the SSE frame parser (the consume side of web `useAiStream`), the
// every-state render projection (loading / content / empty / error / stale / offline), the i18n key folding +
// fallback parity that backs every accessible label, and the preview-row formatting. The composable is a thin
// render layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aialerttuningsuggestions

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIAlertTuningSuggestionsModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_notifications_alertStudio_aiTuning_title", foldCatalogKey(AiTuningKeys.TITLE))
        assertEquals(
            "translation_notifications_alertStudio_aiTuning_suggestButton",
            foldCatalogKey(AiTuningKeys.SUGGEST_BUTTON),
        )
        assertEquals("translation_helix_askHelix", foldCatalogKey(AiTuningKeys.ASK_HELIX))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiTuningLabels(FallbackResolver)
        assertEquals("Suggest lower-noise tuning", labels.title)
        assertEquals(
            "Review recent firings and propose a typed AlertRule patch. " +
                "Descriptive replay only — review before saving.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Suggest tuning", labels.suggestButton)
        assertEquals("Apply to form", labels.applyButton)
        assertEquals("Proposed patch (review before saving):", labels.previewLabel)
        assertEquals("Ask Helix", labels.askHelix)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                AiTuningKeys.TITLE to "Catálogo title",
                AiTuningKeys.SUGGEST_BUTTON to "Catálogo suggest",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = aiTuningLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo suggest", labels.suggestButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Apply to form", labels.applyButton)
    }

    @Test
    fun suggestButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Suggest tuning", suggestButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = aiTuningLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.suggestButton,
            labels.applyButton,
            labels.previewLabel,
            labels.askHelix,
            labels.thinking,
            labels.empty,
            labels.waiting,
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── tool_result → AlertRuleDraftPatch extraction (web handleEvent) ────────────────────────────────────

    @Test
    fun extractDraftPatch_capturesProposedScalars() {
        val patch = extractDraftPatch(toolResult(proposed = fullProposed()))
        assertEquals(AlertRuleDraftPatch(18.0, 10.0, 30.0, 45, "warn", "repeat", "<"), patch)
    }

    @Test
    fun extractDraftPatch_ignoresWrongToolName() {
        assertNull(extractDraftPatch(toolResult(name = "some_other_tool")))
    }

    @Test
    fun extractDraftPatch_ignoresNotOk() {
        assertNull(extractDraftPatch(toolResult(ok = false)))
    }

    @Test
    fun extractDraftPatch_ignoresNonOkStatus() {
        assertNull(extractDraftPatch(toolResult(status = "error")))
    }

    @Test
    fun extractDraftPatch_ignoresMissingProposed() {
        assertNull(extractDraftPatch(toolResult(proposed = null)))
    }

    @Test
    fun extractDraftPatch_ignoresNonToolResultEvent() {
        assertNull(extractDraftPatch(AiStreamEvent.Delta("hello")))
        assertNull(extractDraftPatch(AiStreamEvent.Done("stop")))
    }

    @Test
    fun parseProposed_skipsStringTypedNumbersAndEmptyStrings() {
        val proposed =
            buildJsonObject {
                put("value_num", "18") // string, not a number → ignored (web `typeof === 'number'`)
                put("severity", "") // empty string → ignored (web `!== ''`)
                put("op", ">=")
            }
        val patch = parseProposed(proposed)
        assertNull(patch.valueNum)
        assertNull(patch.severity)
        assertEquals(">=", patch.op)
    }

    @Test
    fun parseProposed_emptyObjectYieldsEmptyPatch() {
        val patch = parseProposed(JsonObject(emptyMap()))
        assertTrue(patch.isEmpty)
    }

    // ── preview rows (verbatim wire labels, web order) ────────────────────────────────────────────────────

    @Test
    fun previewRows_orderAndVerbatimLabels() {
        val rows = AlertRuleDraftPatch(18.0, 10.0, 30.0, 45, "warn", "repeat", "<").toPreviewRows()
        assertEquals(
            listOf(
                "value_num" to "18",
                "value_min" to "10",
                "value_max" to "30",
                "cooldown_min" to "45",
                "severity" to "warn",
                "trigger_mode" to "repeat",
                "op" to "<",
            ),
            rows,
        )
    }

    @Test
    fun formatPatchNumber_dropsTrailingZeroForIntegers() {
        assertEquals("21", formatPatchNumber(21.0))
        assertEquals("21.5", formatPatchNumber(21.5))
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_emptyWhenIdleNoProposal() {
        val snapshot = projectAiTuning(RULE_ID, StreamRuntime(), online = true)
        assertEquals(AiTuningRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_contentWhenProposalCaptured() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = AlertRuleDraftPatch(op = "<"))
        val snapshot = projectAiTuning(RULE_ID, runtime, online = true)
        assertEquals(AiTuningRenderState.Content, snapshot.renderState)
        assertEquals("<", snapshot.proposal?.op)
    }

    @Test
    fun project_contentWhenStreamedReplayText() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Reviewed 12 firings…")
        assertEquals(AiTuningRenderState.Content, projectAiTuning(RULE_ID, runtime, online = true).renderState)
    }

    @Test
    fun project_loadingWhenStreamingNoProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming)
        val snapshot = projectAiTuning(RULE_ID, runtime, online = true)
        assertEquals(AiTuningRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, proposal = AlertRuleDraftPatch(op = "<"))
        val snapshot = projectAiTuning(RULE_ID, runtime, online = true)
        assertEquals(AiTuningRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val snapshot = projectAiTuning(RULE_ID, StreamRuntime(phase = AiStreamPhase.PausedConfirm), online = true)
        assertEquals(AiTuningRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectAiTuning(RULE_ID, runtime, online = true)
        assertEquals(AiTuningRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(AiTuningRenderState.Offline, projectAiTuning(RULE_ID, byMessage, online = true).renderState)

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(AiTuningRenderState.Offline, projectAiTuning(RULE_ID, byLimit, online = true).renderState)
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = AlertRuleDraftPatch(op = "<"))
        val snapshot = projectAiTuning(RULE_ID, runtime, online = false)
        assertEquals(AiTuningRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals("<", snapshot.proposal?.op)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_canStartFalseWhenNoRuleSelected() {
        assertFalse(projectAiTuning(ruleId = 0L, StreamRuntime(), online = true).canStart)
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_toolResultThenExtractsPatch() {
        val raw =
            "event: tool_result\n" +
                "data: {\"id\":\"1\",\"name\":\"draft_alert_rule_patch\",\"ok\":true," +
                "\"data\":{\"status\":\"ok\",\"proposed\":{\"op\":\"<\",\"value_num\":7}}}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.ToolResult)
        val patch = extractDraftPatch(event!!)
        assertEquals("<", patch?.op)
        assertEquals(7.0, patch?.valueNum)
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

    private fun toolResult(
        name: String = DRAFT_TOOL_NAME,
        ok: Boolean = true,
        status: String? = "ok",
        proposed: JsonObject? = fullProposed(),
    ): AiStreamEvent.ToolResult {
        val data =
            buildJsonObject {
                if (status != null) put("status", status)
                if (proposed != null) put("proposed", proposed)
            }
        return AiStreamEvent.ToolResult(id = "t1", name = name, ok = ok, data = data, error = null)
    }

    private fun fullProposed(): JsonObject =
        buildJsonObject {
            put("value_num", 18.0)
            put("value_min", 10)
            put("value_max", 30)
            put("cooldown_min", 45)
            put("severity", "warn")
            put("trigger_mode", "repeat")
            put("op", "<")
        }

    private companion object {
        const val RULE_ID = 42L
    }
}
