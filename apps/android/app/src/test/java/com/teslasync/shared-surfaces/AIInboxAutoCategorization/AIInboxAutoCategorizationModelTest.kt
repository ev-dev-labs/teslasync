// Off-device unit tests for the AIInboxAutoCategorization model + projection (the :android:testReleaseUnitTest
// gate). These cover the framework-free core the composable renders: the request-body builder (web's `useMemo`
// optional-field contract), the `tool_result` → CategoryBucket extraction (web `handleEvent`), the SSE frame
// parser (the consume side of web `useAiStream`), the every-state render projection (loading / content / empty /
// error / stale / offline), the rule-id union the Apply affordance hands to the parent (web `allRuleIds`), the
// i18n key folding + fallback parity that backs every accessible label, and the a11y label builders. The
// composable is a thin render layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiinboxautocategorization

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIInboxAutoCategorizationModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_notifications_inbox_aiCategorize_title", foldCatalogKey(AiCategorizeKeys.TITLE))
        assertEquals(
            "translation_notifications_inbox_aiCategorize_suggestButton",
            foldCatalogKey(AiCategorizeKeys.SUGGEST_BUTTON),
        )
        assertEquals("translation_helix_askHelix", foldCatalogKey(AiCategorizeKeys.ASK_HELIX))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiCategorizeLabels(FallbackResolver)
        assertEquals("Suggest inbox categories", labels.title)
        assertEquals(
            "Bucket recent alerts into categories from your inbox history. " +
                "Descriptive replay only — review before applying.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Suggest categories", labels.suggestButton)
        assertEquals("Apply categories as filter", labels.applyButton)
        assertEquals("Proposed categories (review before applying):", labels.previewLabel)
        assertEquals("Ask Helix", labels.askHelix)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                AiCategorizeKeys.TITLE to "Catálogo title",
                AiCategorizeKeys.SUGGEST_BUTTON to "Catálogo suggest",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = aiCategorizeLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo suggest", labels.suggestButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Apply categories as filter", labels.applyButton)
    }

    @Test
    fun suggestButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Suggest categories", suggestButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = aiCategorizeLabels(FallbackResolver)
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
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── accessibility labels (TalkBack) ──────────────────────────────────────────────────────────────────

    @Test
    fun headerAccessibilityLabel_mergesTitleBadgeDescription() {
        assertEquals("Suggest inbox categories (Helix). Review.", headerAccessibilityLabel("Suggest inbox categories", "Helix", "Review."))
    }

    @Test
    fun categoryChipContentDescription_readsCategoryAndCount() {
        assertEquals("Battery, 7", categoryChipContentDescription(CategoryBucket("Battery", 7)))
    }

    // ── request body (web `useMemo` optional-field contract) ──────────────────────────────────────────────

    @Test
    fun inboxCategorizeRequestBody_omitsEverythingForAnEmptyScope() {
        assertTrue(inboxCategorizeRequestBody(InboxScope()).isEmpty())
    }

    @Test
    fun inboxCategorizeRequestBody_includesEveryPresentField() {
        val body =
            inboxCategorizeRequestBody(
                InboxScope(vehicleId = 7L, severities = listOf("warn", "critical"), ruleIds = listOf(2L), windowDays = 14),
            )
        assertEquals(7L, (body["vehicle_id"] as JsonPrimitive).long)
        assertEquals(14, (body["window_days"] as JsonPrimitive).int)
        assertEquals(2, (body["severities"] as JsonArray).size)
        assertEquals(1, (body["rule_ids"] as JsonArray).size)
    }

    @Test
    fun inboxCategorizeRequestBody_dropsEmptyListsAndNullWindowKeepsVehicle() {
        val body = inboxCategorizeRequestBody(InboxScope(vehicleId = 7L, severities = emptyList(), ruleIds = emptyList()))
        assertTrue(body.containsKey("vehicle_id"))
        assertFalse(body.containsKey("severities"))
        assertFalse(body.containsKey("rule_ids"))
        assertFalse(body.containsKey("window_days"))
    }

    // ── tool_result → CategoryBucket extraction (web handleEvent) ─────────────────────────────────────────

    @Test
    fun extractCategories_capturesBuckets() {
        val buckets = extractCategories(toolResult())
        assertEquals(2, buckets?.size)
        assertEquals(CategoryBucket("Battery", 7, listOf(9L, 3L), listOf("Low SOC overnight")), buckets?.get(0))
        assertEquals(CategoryBucket("Charging", 4, listOf(12L, 3L)), buckets?.get(1))
    }

    @Test
    fun extractCategories_ignoresWrongToolName() {
        assertNull(extractCategories(toolResult(name = "some_other_tool")))
    }

    @Test
    fun extractCategories_ignoresNotOk() {
        assertNull(extractCategories(toolResult(ok = false)))
    }

    @Test
    fun extractCategories_ignoresNonOkStatus() {
        assertNull(extractCategories(toolResult(status = "error")))
    }

    @Test
    fun extractCategories_ignoresMissingCategories() {
        assertNull(extractCategories(toolResult(categories = null)))
    }

    @Test
    fun extractCategories_ignoresNonToolResultEvent() {
        assertNull(extractCategories(AiStreamEvent.Delta("hello")))
        assertNull(extractCategories(AiStreamEvent.Done("stop")))
    }

    @Test
    fun extractCategories_returnsNullWhenNoValidBucket() {
        val onlyInvalid = buildJsonArray { add(buildJsonObject { put("count", 2) }) }
        assertNull(extractCategories(toolResult(categories = onlyInvalid)))
    }

    @Test
    fun parseCategories_skipsInvalidElements() {
        val categories =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("category", "Ok")
                        put("count", 1)
                    },
                )
                add(buildJsonObject { put("count", 2) }) // missing category → skip
                add(
                    buildJsonObject {
                        put("category", "")
                        put("count", 2)
                    },
                ) // empty category → skip
                add(
                    buildJsonObject {
                        put("category", "Neg")
                        put("count", -1)
                    },
                ) // negative count → skip
                add(
                    buildJsonObject {
                        put("category", "Str")
                        put("count", "3")
                    },
                ) // string count → skip
                add(JsonPrimitive("not-an-object")) // non-object → skip
            }
        val buckets = parseCategories(categories)
        assertEquals(1, buckets.size)
        assertEquals(CategoryBucket("Ok", 1), buckets.single())
    }

    @Test
    fun parseCategories_capturesRuleIdsAndSampleTitlesDroppingInvalid() {
        val categories =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("category", "C")
                        put("count", 2)
                        put(
                            "rule_ids",
                            buildJsonArray {
                                add(5)
                                add("x") // string → drop
                                add(-1) // non-positive → drop
                                add(0) // non-positive → drop
                                add(8)
                            },
                        )
                        put(
                            "sample_titles",
                            buildJsonArray {
                                add("a")
                                add("") // empty → drop
                                add("b")
                            },
                        )
                    },
                )
            }
        val bucket = parseCategories(categories).single()
        assertEquals(listOf(5L, 8L), bucket.ruleIds)
        assertEquals(listOf("a", "b"), bucket.sampleTitles)
    }

    @Test
    fun allRuleIds_dedupesAndSortsAscending() {
        val buckets =
            listOf(
                CategoryBucket("Battery", 7, listOf(9L, 3L)),
                CategoryBucket("Charging", 4, listOf(12L, 3L)),
                CategoryBucket("Tire", 1),
            )
        assertEquals(listOf(3L, 9L, 12L), allRuleIds(buckets))
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_emptyWhenIdleNoProposal() {
        val snapshot = projectAiCategorize(StreamRuntime(), online = true)
        assertEquals(AiCategorizeRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_canStartTrueWhenOnlineWithoutAnyScope() {
        // Unlike the rule-scoped sibling, the whole inbox is categorizable — there is no vehicle/rule precondition.
        assertTrue(projectAiCategorize(StreamRuntime(), online = true).canStart)
    }

    @Test
    fun project_contentWhenProposalCaptured() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = listOf(CategoryBucket("A", 1, listOf(5L))))
        val snapshot = projectAiCategorize(runtime, online = true)
        assertEquals(AiCategorizeRenderState.Content, snapshot.renderState)
        assertEquals(1, snapshot.proposal?.size)
    }

    @Test
    fun project_contentWhenStreamedReplayText() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Reviewed 30 alerts…")
        assertEquals(AiCategorizeRenderState.Content, projectAiCategorize(runtime, online = true).renderState)
    }

    @Test
    fun project_loadingWhenStreamingNoProposal() {
        val snapshot = projectAiCategorize(StreamRuntime(phase = AiStreamPhase.Streaming), online = true)
        assertEquals(AiCategorizeRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, proposal = listOf(CategoryBucket("A", 1, listOf(5L))))
        val snapshot = projectAiCategorize(runtime, online = true)
        assertEquals(AiCategorizeRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
        assertFalse(snapshot.applyEnabled) // busy disables Apply even with last-known rule ids
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val snapshot = projectAiCategorize(StreamRuntime(phase = AiStreamPhase.PausedConfirm), online = true)
        assertEquals(AiCategorizeRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectAiCategorize(runtime, online = true)
        assertEquals(AiCategorizeRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(AiCategorizeRenderState.Offline, projectAiCategorize(byMessage, online = true).renderState)

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(AiCategorizeRenderState.Offline, projectAiCategorize(byLimit, online = true).renderState)
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = listOf(CategoryBucket("A", 1, listOf(5L))))
        val snapshot = projectAiCategorize(runtime, online = false)
        assertEquals(AiCategorizeRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals(1, snapshot.proposal?.size)
        assertFalse(snapshot.canStart)
        // Applying a captured filter is a local action, so Apply stays enabled offline (web parity).
        assertTrue(snapshot.applyEnabled)
        assertEquals(listOf(5L), snapshot.allRuleIds)
    }

    @Test
    fun project_applyDisabledWhenProposalHasNoRuleIds() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = listOf(CategoryBucket("A", 1)))
        val snapshot = projectAiCategorize(runtime, online = true)
        assertEquals(AiCategorizeRenderState.Content, snapshot.renderState) // chips still render
        assertFalse(snapshot.applyEnabled)
        assertTrue(snapshot.allRuleIds.isEmpty())
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_toolResultThenExtractsBuckets() {
        val raw =
            "event: tool_result\n" +
                "data: {\"id\":\"1\",\"name\":\"draft_alert_categories\",\"ok\":true," +
                "\"data\":{\"status\":\"ok\",\"categories\":[{\"category\":\"Battery\",\"count\":7,\"rule_ids\":[9,3]}]}}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.ToolResult)
        val buckets = extractCategories(event!!)
        assertEquals(1, buckets?.size)
        assertEquals("Battery", buckets?.single()?.category)
        assertEquals(listOf(9L, 3L), buckets?.single()?.ruleIds)
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
        categories: JsonArray? = sampleCategories(),
    ): AiStreamEvent.ToolResult {
        val data =
            buildJsonObject {
                if (status != null) put("status", status)
                if (categories != null) put("categories", categories)
            }
        return AiStreamEvent.ToolResult(id = "t1", name = name, ok = ok, data = data, error = null)
    }

    private fun sampleCategories(): JsonArray =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("category", "Battery")
                    put("count", 7)
                    put(
                        "rule_ids",
                        buildJsonArray {
                            add(9)
                            add(3)
                        },
                    )
                    put(
                        "sample_titles",
                        buildJsonArray {
                            add("Low SOC overnight")
                            add("")
                        },
                    )
                },
            )
            add(
                buildJsonObject {
                    put("category", "Charging")
                    put("count", 4)
                    put(
                        "rule_ids",
                        buildJsonArray {
                            add(12)
                            add(3)
                        },
                    )
                },
            )
        }
}
