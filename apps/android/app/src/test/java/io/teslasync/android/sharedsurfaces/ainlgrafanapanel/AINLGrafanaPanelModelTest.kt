// Off-device unit tests for the pure AINLGrafanaPanel model: the stream reducer, the tool-payload parser/adapter
// (raw decoded JSON -> typed projection, the web `parseGrafanaPanelDraft` port), the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule,
// and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.ainlgrafanapanel

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLGrafanaPanelModelTest {
    private val window = GRAFANA_DRAFT_FRESHNESS_WINDOW_MS

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startDraftingEntersStreamingAndClearsTransients() {
        val next =
            GrafanaDraftState(
                prompt = "kept",
                streamingText = "old",
                draft = sampleDraft(),
                errorKind = ErrorKind.Http,
            ).startDrafting()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.draft)
        assertNull(next.errorKind)
        assertEquals("kept", next.prompt)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun toolResultCapturesDraftFromValidPayload() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.ToolResult(DRAFT_GRAFANA_PANEL_TOOL, validPayload()), nowMs = 1L)
        assertNotNull(next.draft)
        assertEquals("Daily distance", next.draft?.panel?.title)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun toolResultWithOtherNameIsIgnored() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.ToolResult("some_other_tool", validPayload()), nowMs = 1L)
        assertNull(next.draft)
    }

    @Test
    fun toolResultWithUnparseablePayloadIsIgnored() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.ToolResult(DRAFT_GRAFANA_PANEL_TOOL, mapOf("status" to "error")), nowMs = 1L)
        assertNull(next.draft)
    }

    @Test
    fun doneStampsCompletionAndKeepsDraft() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming, draft = sampleDraft(), streamingText = "prose")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals(42L, next.fetchedAt)
        assertNotNull(next.draft)
        assertEquals("prose", next.streamingText)
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsDraft() {
        val next =
            GrafanaDraftState(phase = DraftPhase.Streaming, draft = sampleDraft())
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertNotNull(next.draft)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = GrafanaDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = GrafanaDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── canDraft / canApply parity with web ─────────────────────────────────────────
    @Test
    fun hasPromptTrimsWhitespace() {
        assertTrue(GrafanaDraftState(prompt = "  chart  ").hasPrompt)
        assertFalse(GrafanaDraftState(prompt = "   ").hasPrompt)
        assertFalse(GrafanaDraftState(prompt = "").hasPrompt)
    }

    @Test
    fun canDraftRequiresPromptAndNotStreaming() {
        assertTrue(GrafanaDraftState(prompt = "chart").canDraft)
        assertFalse(GrafanaDraftState(prompt = "").canDraft)
        assertFalse(GrafanaDraftState(prompt = "chart", phase = DraftPhase.Streaming).canDraft)
    }

    @Test
    fun canApplyRequiresDraftAndNotStreaming() {
        assertTrue(GrafanaDraftState(draft = sampleDraft(), phase = DraftPhase.Done).canApply)
        assertFalse(GrafanaDraftState(draft = null, phase = DraftPhase.Done).canApply)
        assertFalse(GrafanaDraftState(draft = sampleDraft(), phase = DraftPhase.Streaming).canApply)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyGrafanaDraft(GrafanaDraftState(gateEnabled = false, prompt = "x"), nowMs = 0L)
        assertEquals(DraftSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanDraft() {
        assertEquals(DraftSurface.Resting(canDraft = true), classifyGrafanaDraft(GrafanaDraftState(prompt = "x"), 0L))
        assertEquals(DraftSurface.Resting(canDraft = false), classifyGrafanaDraft(GrafanaDraftState(prompt = ""), 0L))
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface = classifyGrafanaDraft(GrafanaDraftState(prompt = "x", phase = DraftPhase.Streaming), 0L)
        assertEquals(DraftSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(prompt = "x", phase = DraftPhase.Streaming, streamingText = "partial"),
                0L,
            )
        assertEquals(DraftSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithDraftIsReadyAndFreshWithinWindow() {
        val draft = sampleDraft()
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Done, draft = draft, streamingText = "prose", fetchedAt = 1_000L),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(DraftSurface.Ready(draft, "prose", stale = false), surface)
    }

    @Test
    fun doneWithDraftIsReadyAndStaleBeyondWindow() {
        val draft = sampleDraft()
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Done, draft = draft, fetchedAt = 1_000L),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(DraftSurface.Ready(draft, "", stale = true), surface)
    }

    @Test
    fun doneWithNarrationOnlyIsNarrated() {
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Done, streamingText = "explanation", fetchedAt = 1_000L),
                nowMs = 1_000L,
            )
        assertEquals(DraftSurface.Narrated("explanation", stale = false), surface)
    }

    @Test
    fun doneWithNothingIsEmpty() {
        val surface = classifyGrafanaDraft(GrafanaDraftState(phase = DraftPhase.Done), nowMs = 0L)
        assertEquals(DraftSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithDraftIsOfflineCached() {
        val draft = sampleDraft()
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Failed, draft = draft, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Cached(draft, "", offline = true), surface)
    }

    @Test
    fun failedHttpWithDraftIsNonOfflineCached() {
        val draft = sampleDraft()
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Failed, draft = draft, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Cached(draft, "", offline = false), surface)
    }

    @Test
    fun failedWithNarrationOnlyIsCached() {
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Failed, streamingText = "partial", errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Cached(null, "partial", offline = true), surface)
    }

    @Test
    fun failedNetworkWithoutCaptureIsOfflineFailure() {
        val surface =
            classifyGrafanaDraft(
                GrafanaDraftState(phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DraftSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutCaptureIsHardFailure() {
        val surface =
            classifyGrafanaDraft(GrafanaDraftState(phase = DraftPhase.Failed, errorKind = ErrorKind.Http), nowMs = 0L)
        assertEquals(DraftSurface.Failed(offline = false), surface)
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── parser (data adapter: decoded payload -> typed projection) ───────────────────
    @Test
    fun parsesFullDraft() {
        val draft = parseGrafanaPanelDraft(validPayload())
        assertNotNull(draft)
        requireNotNull(draft)
        assertEquals("Daily distance", draft.panel.title)
        assertEquals("timeseries", draft.panel.type)
        assertEquals("uid-1", draft.panel.datasource.uid)
        assertEquals(listOf("drives", "charging_sessions"), draft.referencedTables)
        assertEquals(1, draft.panel.targets.size)
        val firstTarget = draft.panel.targets.first()
        assertEquals("A", firstTarget.refId)
        assertEquals("SELECT 1", firstTarget.rawSql)
        assertEquals(GrafanaPanelGridPos(0, 0, 12, 8), draft.panel.gridPos)
    }

    @Test
    fun nullDataIsRejected() {
        assertNull(parseGrafanaPanelDraft(null))
    }

    @Test
    fun nonOkStatusIsRejected() {
        assertNull(parseGrafanaPanelDraft(validPayload() + ("status" to "error")))
    }

    @Test
    fun missingDraftObjectIsRejected() {
        assertNull(parseGrafanaPanelDraft(mapOf("status" to "ok")))
    }

    @Test
    fun missingPanelTitleIsRejected() {
        val payload = payloadWithPanel(panelMap().minus("title"))
        assertNull(parseGrafanaPanelDraft(payload))
    }

    @Test
    fun badDatasourceIsRejected() {
        val payload = payloadWithPanel(panelMap() + ("datasource" to mapOf("type" to "x")))
        assertNull(parseGrafanaPanelDraft(payload))
    }

    @Test
    fun badGridPosIsRejected() {
        val payload = payloadWithPanel(panelMap() + ("grid_pos" to mapOf("x" to 0, "y" to 0, "w" to "wide", "h" to 8)))
        assertNull(parseGrafanaPanelDraft(payload))
    }

    @Test
    fun invalidTargetsAndTablesAreFiltered() {
        val panel =
            panelMap() + ("targets" to listOf(mapOf("ref_id" to "A"), mapOf("no_ref" to true), "garbage"))
        val payload =
            mapOf(
                "status" to "ok",
                "draft" to
                    mapOf(
                        "prompt" to "p",
                        "rationale" to "r",
                        "panel" to panel,
                        "referenced_tables" to listOf("drives", 7, null),
                    ),
            )
        val draft = parseGrafanaPanelDraft(payload)
        requireNotNull(draft)
        assertEquals(1, draft.panel.targets.size)
        assertEquals(listOf("drives"), draft.referencedTables)
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Grafana drafter", "Helix", "Describe the panel you want.")
        assertEquals("Grafana drafter (Helix). Describe the panel you want.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels = sampleLabels()
        val draft = sampleDraft()
        assertEquals("Helix is thinking", outputAccessibilityLabel(DraftSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(DraftSurface.Live("p"), labels))
        assertEquals("No panel drafted", outputAccessibilityLabel(DraftSurface.Empty, labels))
        assertEquals(
            "Proposed panel: ${draft.panel.title}",
            outputAccessibilityLabel(DraftSurface.Ready(draft, "n", stale = false), labels),
        )
        assertEquals(
            "Stale. Proposed panel: ${draft.panel.title}",
            outputAccessibilityLabel(DraftSurface.Ready(draft, "n", stale = true), labels),
        )
        assertEquals("prose", outputAccessibilityLabel(DraftSurface.Narrated("prose", stale = false), labels))
        assertEquals("Stale. prose", outputAccessibilityLabel(DraftSurface.Narrated("prose", stale = true), labels))
        assertEquals(
            "Offline. Proposed panel: ${draft.panel.title}",
            outputAccessibilityLabel(DraftSurface.Cached(draft, "n", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. partial",
            outputAccessibilityLabel(DraftSurface.Cached(null, "partial", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(DraftSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = sampleLabels()
        assertNull(outputAccessibilityLabel(DraftSurface.Resting(canDraft = true), labels))
        assertNull(outputAccessibilityLabel(DraftSurface.Hidden, labels))
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────
    private fun sampleLabels(): DraftOutputLabels =
        DraftOutputLabels(
            working = "Helix is thinking",
            empty = "No panel drafted",
            stale = "Stale",
            offline = "Offline",
            error = "Failed to load data",
            ready = "Proposed panel",
        )

    private fun sampleDraft(): GrafanaPanelDraft =
        GrafanaPanelDraft(
            prompt = "p",
            panel =
                GrafanaPanelEnvelope(
                    title = "Daily distance",
                    type = "timeseries",
                    datasource = GrafanaDatasourceRef("grafana-postgresql-datasource", "uid-1"),
                    targets = listOf(GrafanaPanelTarget("A", rawSql = "SELECT 1")),
                    gridPos = GrafanaPanelGridPos(0, 0, 12, 8),
                ),
            rationale = "r",
            referencedTables = listOf("drives", "charging_sessions"),
        )

    private fun validPayload(): Map<String, Any?> =
        mapOf(
            "status" to "ok",
            "draft" to
                mapOf(
                    "prompt" to "p",
                    "rationale" to "r",
                    "panel" to panelMap(),
                    "referenced_tables" to listOf("drives", "charging_sessions"),
                ),
        )

    private fun panelMap(): Map<String, Any?> =
        mapOf(
            "title" to "Daily distance",
            "type" to "timeseries",
            "datasource" to mapOf("type" to "grafana-postgresql-datasource", "uid" to "uid-1"),
            "targets" to listOf(mapOf("ref_id" to "A", "raw_sql" to "SELECT 1")),
            "grid_pos" to mapOf("x" to 0, "y" to 0, "w" to 12, "h" to 8),
        )

    private fun payloadWithPanel(panel: Map<String, Any?>): Map<String, Any?> =
        mapOf(
            "status" to "ok",
            "draft" to
                mapOf(
                    "prompt" to "p",
                    "rationale" to "r",
                    "panel" to panel,
                    "referenced_tables" to emptyList<String>(),
                ),
        )
}
