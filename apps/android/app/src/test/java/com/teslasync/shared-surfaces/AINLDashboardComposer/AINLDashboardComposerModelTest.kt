// Off-device unit tests for the AINLDashboardComposer model + projection (the :app:testReleaseUnitTest gate).
// These cover the framework-free core the composable renders: the `tool_result` → DashboardLayoutDraft extraction
// (web `parseDashboardLayoutDraft`), the SSE frame parser (the consume side of web `useAiStream`), the every-state
// render projection (loading / content / empty / error / stale / offline), the i18n key folding + fallback parity
// that backs every accessible label, the accessibility-label builders (TalkBack-label presence), and the
// draft-preview projection (title fallback, panel names, panels line). The composable is a thin render layer over
// these, so exercising them here is the surface's behavioral contract — the "per-state snapshot" + "accessibility
// label presence" acceptance tests.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldashboardcomposer

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLDashboardComposerModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_powerDashboards_aiDrafter_title", foldCatalogKey(AiDrafterKeys.TITLE))
        assertEquals("translation_powerDashboards_aiDrafter_button", foldCatalogKey(AiDrafterKeys.DRAFT_BUTTON))
        assertEquals("translation_powerDashboards_aiDrafter_applyButton", foldCatalogKey(AiDrafterKeys.APPLY_BUTTON))
        assertEquals("translation_helix_askHelix", foldCatalogKey(AiDrafterKeys.ASK_HELIX))
        assertEquals("translation_common_retry", foldCatalogKey(AiDrafterKeys.RETRY))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiDrafterLabels(FallbackResolver)
        assertEquals("Helix natural-language dashboard composer", labels.title)
        assertEquals("Draft dashboard", labels.draftButton)
        assertEquals("Helix", labels.badge)
        assertEquals("Dashboard request", labels.promptLabel)
        assertEquals(
            "e.g. give me an overview dashboard with daily drives, current battery, and recent alerts",
            labels.promptHint,
        )
        assertEquals("Apply to editor", labels.applyButton)
        assertEquals("Ask Helix", labels.askHelix)
        assertTrue(labels.description.startsWith("Describe the dashboard you want in plain English"))
    }

    @Test
    fun labels_routeThroughFacadeWhenCatalogPresent() {
        val resolve: StringResolver = { key, fallback -> if (key == AiDrafterKeys.TITLE) "Localized" else fallback }
        assertEquals("Localized", aiDrafterLabels(resolve).title)
    }

    // ── tool_result → draft extraction (web `parseDashboardLayoutDraft`) ──────────────────────────────────

    @Test
    fun parseDraft_acceptsAWellFormedEnvelope() {
        val draft = parseDashboardLayoutDraft(validEnvelope())
        assertNotNull(draft)
        requireNotNull(draft)
        assertEquals("give me an overview", draft.prompt)
        assertEquals("Fleet overview", draft.dashboard.title)
        assertEquals("Because you asked.", draft.rationale)
        val slots = draft.dashboard.slots
        assertEquals(2, slots.size)
        assertEquals("daily_drives", slots.first().panelName)
        assertEquals(DashboardSlotGrid(6, 0, 6, 4), slots[1].gridPos)
        assertEquals(listOf("daily_drives", "recent_alerts"), draft.referencedPanels)
    }

    @Test
    fun parseDraft_rejectsNonOkStatus() {
        val data = buildJsonObject { put("status", "error") }
        assertNull(parseDashboardLayoutDraft(data))
    }

    @Test
    fun parseDraft_rejectsMissingDraftObject() {
        val data = buildJsonObject { put("status", "ok") }
        assertNull(parseDashboardLayoutDraft(data))
    }

    @Test
    fun parseDraft_rejectsMissingPromptOrRationaleOrTitle() {
        val noPrompt =
            buildJsonObject {
                put("status", "ok")
                putJsonObject("draft") {
                    put("rationale", "r")
                    putJsonObject("dashboard") { put("title", "T") }
                }
            }
        assertNull(parseDashboardLayoutDraft(noPrompt))

        val noTitle =
            buildJsonObject {
                put("status", "ok")
                putJsonObject("draft") {
                    put("prompt", "p")
                    put("rationale", "r")
                    putJsonObject("dashboard") {}
                }
            }
        assertNull(parseDashboardLayoutDraft(noTitle))
    }

    @Test
    fun parseDraft_skipsMalformedSlotsAndKeepsValidOnes() {
        val data =
            buildJsonObject {
                put("status", "ok")
                putJsonObject("draft") {
                    put("prompt", "p")
                    put("rationale", "r")
                    putJsonObject("dashboard") {
                        put("title", "T")
                        putJsonArray("slots") {
                            add(buildJsonObject { put("panel_name", "missing_grid") })
                            addJsonObject {
                                put("panel_name", "ok_panel")
                                putJsonObject("grid_pos") {
                                    put("x", 1)
                                    put("y", 2)
                                    put("w", 3)
                                    put("h", 4)
                                }
                            }
                        }
                    }
                }
            }
        val draft = requireNotNull(parseDashboardLayoutDraft(data))
        val slots = draft.dashboard.slots
        assertEquals(1, slots.size)
        assertEquals("ok_panel", slots.first().panelName)
    }

    @Test
    fun parseDraft_emptyTitleAllowed_nonArraySlotsYieldsEmpty() {
        val data =
            buildJsonObject {
                put("status", "ok")
                putJsonObject("draft") {
                    put("prompt", "")
                    put("rationale", "")
                    putJsonObject("dashboard") {
                        put("title", "")
                        put("slots", "not-an-array")
                    }
                }
            }
        val draft = requireNotNull(parseDashboardLayoutDraft(data))
        assertEquals("", draft.dashboard.title)
        assertTrue(draft.dashboard.slots.isEmpty())
        assertTrue(draft.referencedPanels.isEmpty())
    }

    @Test
    fun parseDraft_filtersNonStringReferencedPanels() {
        val data =
            buildJsonObject {
                put("status", "ok")
                putJsonObject("draft") {
                    put("prompt", "p")
                    put("rationale", "r")
                    putJsonObject("dashboard") { put("title", "T") }
                    putJsonArray("referenced_panels") {
                        add("battery")
                        add(7)
                        add("alerts")
                    }
                }
            }
        val draft = requireNotNull(parseDashboardLayoutDraft(data))
        assertEquals(listOf("battery", "alerts"), draft.referencedPanels)
    }

    @Test
    fun extractDraft_capturesOnlyTheDraftTool() {
        val ok = AiStreamEvent.ToolResult("1", DRAFT_TOOL_NAME, ok = true, data = validEnvelope(), error = null)
        assertNotNull(extractDraft(ok))

        val wrongTool = AiStreamEvent.ToolResult("1", "other_tool", ok = true, data = validEnvelope(), error = null)
        assertNull(extractDraft(wrongTool))

        assertNull(extractDraft(AiStreamEvent.Delta("text")))
    }

    // ── SSE frame parser (the consume side of web `useAiStream`) ──────────────────────────────────────────

    @Test
    fun parseSseFrame_decodesEveryEventType() {
        assertEquals(
            AiStreamEvent.Delta("hi"),
            parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"),
        )
        val tool = parseSseFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"draft_dashboard_layout\",\"ok\":true}")
        assertTrue(tool is AiStreamEvent.ToolResult)
        assertEquals(AiStreamEvent.Done("stop"), parseSseFrame("event: done\ndata: {}"))
        val error = parseSseFrame("event: error\ndata: {\"message\":\"boom\"}")
        assertEquals("boom", (error as? AiStreamEvent.StreamError)?.message)
    }

    @Test
    fun parseSseFrame_dropsMalformedAndUnknownFrames() {
        assertNull(parseSseFrame("data: {\"text\":\"no event line\"}"))
        assertNull(parseSseFrame("event: delta\ndata: {not json"))
        assertNull(parseSseFrame("event: mystery\ndata: {}"))
        assertNull(parseSseFrame(": comment-only"))
    }

    // ── render-state projection: every state the prompt mandates ──────────────────────────────────────────

    @Test
    fun project_restingShowsWaitingAndDisablesDraftUntilPrompted() {
        val empty = projectAiNlDashboard("", StreamRuntime(), online = true)
        assertEquals(AiNlDashboardRenderState.Empty, empty.renderState)
        assertFalse(empty.hasResult)
        assertFalse(empty.canStart)

        val prompted = projectAiNlDashboard("an overview", StreamRuntime(), online = true)
        assertEquals(AiNlDashboardRenderState.Empty, prompted.renderState)
        assertTrue(prompted.canStart)
    }

    @Test
    fun project_streamingWithoutDraftIsLoading() {
        val snapshot = projectAiNlDashboard("p", StreamRuntime(phase = AiStreamPhase.Streaming), online = true)
        assertEquals(AiNlDashboardRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_streamingOverPriorDraftIsStale() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, draft = sampleDraft())
        val snapshot = projectAiNlDashboard("p", runtime, online = true)
        assertEquals(AiNlDashboardRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertNotNull(snapshot.draft)
    }

    @Test
    fun project_doneWithDraftIsContentAndAppliable() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, draft = sampleDraft())
        val snapshot = projectAiNlDashboard("p", runtime, online = true)
        assertEquals(AiNlDashboardRenderState.Content, snapshot.renderState)
        assertTrue(snapshot.canApply)
        assertTrue(snapshot.hasResult)
    }

    @Test
    fun project_doneWithoutDraftIsResolvedEmpty() {
        val snapshot = projectAiNlDashboard("p", StreamRuntime(phase = AiStreamPhase.Done), online = true)
        assertEquals(AiNlDashboardRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.hasResult)
        assertFalse(snapshot.canApply)
    }

    @Test
    fun project_doneWithStreamedTextButNoDraftIsContent() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Here is a plan…")
        val snapshot = projectAiNlDashboard("p", runtime, online = true)
        assertEquals(AiNlDashboardRenderState.Content, snapshot.renderState)
        assertNull(snapshot.draft)
    }

    @Test
    fun project_hardErrorIsErrorAndNetworkErrorIsOffline() {
        val httpError = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        assertEquals(AiNlDashboardRenderState.Error, projectAiNlDashboard("p", httpError, online = true).renderState)

        val networkError = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_0")
        assertEquals(AiNlDashboardRenderState.Offline, projectAiNlDashboard("p", networkError, online = true).renderState)
    }

    @Test
    fun project_offlineKeepsLastDraftAndStaysAppliable() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, draft = sampleDraft())
        val snapshot = projectAiNlDashboard("p", runtime, online = false)
        assertEquals(AiNlDashboardRenderState.Offline, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.canApply)
        assertNotNull(snapshot.draft)
    }

    @Test
    fun isNetworkFailure_classifiesTransportMarkers() {
        assertTrue(isNetworkFailure(null, "stream_http_0"))
        assertTrue(isNetworkFailure("network", null))
        assertTrue(isNetworkFailure(null, "Request timed out"))
        assertFalse(isNetworkFailure(null, "boom"))
        assertFalse(isNetworkFailure(null, null))
    }

    // ── accessibility labels (TalkBack-label presence) ────────────────────────────────────────────────────

    @Test
    fun draftButtonContentDescription_mergesAskHelixAndVerb() {
        assertEquals("Ask Helix · Draft dashboard", draftButtonContentDescription(FallbackResolver))
    }

    @Test
    fun applyButtonContentDescription_carriesVerbAndTooltip() {
        val labels = aiDrafterLabels(FallbackResolver)
        val cd = applyButtonContentDescription(labels)
        assertTrue(cd.startsWith("Apply to editor"))
        assertTrue(cd.contains("Copy the proposed dashboard JSON"))
    }

    @Test
    fun headerAccessibilityLabel_mergesTitleBadgeAndDescription() {
        assertEquals(
            "Helix composer (Helix). Describe it.",
            headerAccessibilityLabel("Helix composer", "Helix", "Describe it."),
        )
    }

    // ── draft preview projection ──────────────────────────────────────────────────────────────────────────

    @Test
    fun draftPanelNames_prefersSlotsThenFallsBackToReferenced() {
        assertEquals(
            listOf("daily_drives", "battery_state_of_charge", "recent_alerts"),
            draftPanelNames(sampleDraft()),
        )

        val noSlots =
            DashboardLayoutDraft(
                prompt = "p",
                dashboard = DashboardEnvelope("T", emptyList()),
                rationale = "r",
                referencedPanels = listOf("only_referenced"),
            )
        assertEquals(listOf("only_referenced"), draftPanelNames(noSlots))
    }

    @Test
    fun draftTitle_fallsBackToUntitledWhenBlank() {
        val labels = aiDrafterLabels(FallbackResolver)
        val blank =
            DashboardLayoutDraft("p", DashboardEnvelope("", emptyList()), "r", emptyList())
        assertEquals("Untitled dashboard", draftTitle(blank, labels))
        assertEquals("Fleet overview", draftTitle(sampleDraft(), labels))
    }

    @Test
    fun draftPanelsLine_joinsNamesWithLabelOrNull() {
        val labels = aiDrafterLabels(FallbackResolver)
        assertEquals(
            "Panels: daily_drives · battery_state_of_charge · recent_alerts",
            draftPanelsLine(sampleDraft(), labels),
        )
        val empty = DashboardLayoutDraft("p", DashboardEnvelope("T", emptyList()), "r", emptyList())
        assertNull(draftPanelsLine(empty, labels))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun validEnvelope(): JsonObject =
        buildJsonObject {
            put("status", "ok")
            putJsonObject("draft") {
                put("prompt", "give me an overview")
                put("rationale", "Because you asked.")
                putJsonObject("dashboard") {
                    put("title", "Fleet overview")
                    putJsonArray("slots") {
                        addJsonObject {
                            put("panel_name", "daily_drives")
                            putJsonObject("grid_pos") {
                                put("x", 0)
                                put("y", 0)
                                put("w", 6)
                                put("h", 4)
                            }
                        }
                        addJsonObject {
                            put("panel_name", "battery")
                            putJsonObject("grid_pos") {
                                put("x", 6)
                                put("y", 0)
                                put("w", 6)
                                put("h", 4)
                            }
                        }
                    }
                }
                putJsonArray("referenced_panels") {
                    add("daily_drives")
                    add("recent_alerts")
                }
            }
        }

    private fun sampleDraft(): DashboardLayoutDraft =
        DashboardLayoutDraft(
            prompt = "give me an overview dashboard",
            dashboard =
                DashboardEnvelope(
                    title = "Fleet overview",
                    slots =
                        listOf(
                            DashboardSlot("daily_drives", DashboardSlotGrid(0, 0, 6, 4)),
                            DashboardSlot("battery_state_of_charge", DashboardSlotGrid(6, 0, 6, 4)),
                            DashboardSlot("recent_alerts", DashboardSlotGrid(0, 4, 12, 4)),
                        ),
                ),
            rationale = "Combines daily driving, current battery, and recent alerts.",
            referencedPanels = listOf("daily_drives", "battery_state_of_charge", "recent_alerts"),
        )
}
