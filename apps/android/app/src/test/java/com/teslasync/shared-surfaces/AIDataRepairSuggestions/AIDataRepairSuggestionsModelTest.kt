// Off-device unit tests for the AIDataRepairSuggestions model + projection (the :android:testReleaseUnitTest
// gate). These cover the framework-free core the composable renders: the i18n key folding + fallback parity that
// backs every accessible label, the SSE frame parser (the consume side of web `useAiStream`), and the
// every-state render projection (loading / content / empty / error / stale / offline). The composable is a thin
// render layer over these, so exercising them here is the surface's behavioral contract. Mirrors the web
// component (web/src/components/ai/AIDataRepairSuggestions.tsx).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aidatarepairsuggestions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIDataRepairSuggestionsModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_dataRepair_aiSuggestions_title", foldCatalogKey(AiDataRepairKeys.TITLE))
        assertEquals("translation_dataRepair_aiSuggestions_button", foldCatalogKey(AiDataRepairKeys.DRAFT_BUTTON))
        assertEquals("translation_helix_askHelix", foldCatalogKey(AiDataRepairKeys.ASK_HELIX))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiDataRepairLabels(FallbackResolver)
        assertEquals("Helix repair suggestions", labels.title)
        assertEquals(
            "Propose a typed repair plan (close, discard, or partial-update) for one stale charging session or " +
                "drive from the inventory below. The LLM never writes — review the proposal here and click the " +
                "canonical Save / Close / Discard button on the matching baseline form to apply it.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Draft repair plan", labels.draftButton)
        assertEquals("Ask Helix", labels.askHelix)
        assertEquals("Helix is thinking…", labels.thinking)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                AiDataRepairKeys.TITLE to "Catálogo title",
                AiDataRepairKeys.DRAFT_BUTTON to "Catálogo draft",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = aiDataRepairLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo draft", labels.draftButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Helix", labels.badge)
        assertEquals("Ask Helix", labels.askHelix)
    }

    @Test
    fun draftButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Draft repair plan", draftButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = aiDataRepairLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.draftButton,
            labels.askHelix,
            labels.thinking,
            labels.errorLabel,
            labels.errorUnknown,
            labels.empty,
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_emptyWhenIdleNoText() {
        val snapshot = projectAiDataRepair(StreamRuntime(), online = true)
        assertEquals(AiDataRepairRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_contentWhenPlanStreamedAndDone() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Close stale session #842…")
        val snapshot = projectAiDataRepair(runtime, online = true)
        assertEquals(AiDataRepairRenderState.Content, snapshot.renderState)
        assertEquals("Close stale session #842…", snapshot.text)
    }

    @Test
    fun project_loadingWhenStreamingNoPriorPlan() {
        val snapshot = projectAiDataRepair(StreamRuntime(phase = AiStreamPhase.Streaming), online = true)
        assertEquals(AiDataRepairRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownPlan() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, lastPlan = "Old plan")
        val snapshot = projectAiDataRepair(runtime, online = true)
        assertEquals(AiDataRepairRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
        // The last-known plan is kept visible, never blanked, while the refresh is in flight.
        assertEquals("Old plan", snapshot.text)
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val snapshot = projectAiDataRepair(StreamRuntime(phase = AiStreamPhase.PausedConfirm), online = true)
        assertEquals(AiDataRepairRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectAiDataRepair(runtime, online = true)
        assertEquals(AiDataRepairRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(AiDataRepairRenderState.Offline, projectAiDataRepair(byMessage, online = true).renderState)

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(AiDataRepairRenderState.Offline, projectAiDataRepair(byLimit, online = true).renderState)
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastPlan() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Discard duplicate drive #19")
        val snapshot = projectAiDataRepair(runtime, online = false)
        assertEquals(AiDataRepairRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals("Discard duplicate drive #19", snapshot.text)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_canStartFalseWhileStreaming() {
        assertFalse(projectAiDataRepair(StreamRuntime(phase = AiStreamPhase.Streaming), online = true).canStart)
    }

    @Test
    fun project_canStartFalseWhenOffline() {
        assertFalse(projectAiDataRepair(StreamRuntime(), online = false).canStart)
    }

    // ── connectivity classification ──────────────────────────────────────────────────────────────────────

    @Test
    fun isNetworkFailure_marksConnectivityReasonsAndMessages() {
        assertTrue(isNetworkFailure("timeout", null))
        assertTrue(isNetworkFailure(null, "stream_http_0"))
        assertTrue(isNetworkFailure(null, "Host unreachable"))
        assertFalse(isNetworkFailure(null, "stream_http_503"))
        assertFalse(isNetworkFailure(null, null))
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_done() {
        assertEquals(AiStreamEvent.Done("stop"), parseSseFrame("event: done\ndata: {\"finish_reason\":\"stop\"}"))
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
    fun parseSseFrame_toolFramesParseEvenThoughTheSurfaceIgnoresThem() {
        val call = parseSseFrame("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"draft_repair_plan\"}")
        assertEquals(AiStreamEvent.ToolCall("1", "draft_repair_plan"), call)

        val result = parseSseFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"x\",\"ok\":true,\"data\":{}}")
        assertTrue(result is AiStreamEvent.ToolResult)
        assertTrue((result as AiStreamEvent.ToolResult).ok)
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
}
