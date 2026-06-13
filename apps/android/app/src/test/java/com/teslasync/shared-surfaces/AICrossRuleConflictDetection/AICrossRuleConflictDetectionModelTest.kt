// Off-device unit tests for the AICrossRuleConflictDetection model + projection (the :app:testReleaseUnitTest
// gate). These cover the framework-free core the composable renders: the `tool_result` → RuleConflict[]
// extraction (web `handleEvent`), the SSE frame parser (the consume side of web `useAiStream`), the every-state
// render projection (loading / content / empty / error / stale / offline), the i18n key folding + fallback
// parity that backs every accessible label, and the per-conflict copy (kind label, descriptive pair line, review
// affordance, severity chips). The composable is a thin render layer over these, so exercising them here is the
// surface's behavioral contract — the "per-state snapshot" + "accessibility label presence" acceptance tests.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aicrossruleconflictdetection

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AICrossRuleConflictDetectionModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals(
            "translation_notifications_alertStudio_aiConflicts_title",
            foldCatalogKey(AiConflictsKeys.TITLE),
        )
        assertEquals(
            "translation_notifications_alertStudio_aiConflicts_detectButton",
            foldCatalogKey(AiConflictsKeys.DETECT_BUTTON),
        )
        assertEquals(
            "translation_notifications_alertStudio_aiConflicts_kind_redundant_duplicate",
            foldCatalogKey(AiConflictsKeys.KIND_REDUNDANT),
        )
        assertEquals("translation_helix_askHelix", foldCatalogKey(AiConflictsKeys.ASK_HELIX))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiConflictsLabels(FallbackResolver)
        assertEquals("Detect cross-rule conflicts", labels.title)
        assertEquals(
            "Surface structural overlaps between your alert rule definitions. " +
                "Review only — Helix never edits, merges, or deletes rules.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Detect conflicts", labels.detectButton)
        assertEquals("Review rule", labels.reviewButton)
        assertEquals("No structural conflicts found in the current rule set.", labels.emptyMessage)
        assertEquals("Redundant duplicate", labels.kindRedundant)
        assertEquals("Overlapping threshold", labels.kindOverlapping)
        assertEquals("Ask Helix", labels.askHelix)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                AiConflictsKeys.TITLE to "Catálogo title",
                AiConflictsKeys.DETECT_BUTTON to "Catálogo detect",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = aiConflictsLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo detect", labels.detectButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Review rule", labels.reviewButton)
    }

    @Test
    fun detectButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Detect conflicts", detectButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = aiConflictsLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.detectButton,
            labels.reviewButton,
            labels.askHelix,
            labels.thinking,
            labels.emptyMessage,
            labels.waiting,
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
            labels.rulePrefix,
            labels.kindRedundant,
            labels.kindOverlapping,
            labels.flagSubsumes,
            labels.flagSeverity,
            labels.flagCooldown,
            labels.flagTrigger,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── tool_result → RuleConflict[] extraction (web handleEvent) ─────────────────────────────────────────

    @Test
    fun extractConflicts_capturesTypedRows() {
        val rows = extractConflicts(toolResult(conflicts = sampleConflicts()))
        assertEquals(2, rows?.size)
        val first = rows!!.first()
        assertEquals("redundant_duplicate", first.kind)
        assertEquals(12L, first.ruleAId)
        assertEquals(34L, first.ruleBId)
        assertEquals("Low battery", first.ruleAName)
        assertEquals("soc", first.signalName)
        assertTrue(first.subsumes)
        val second = rows[1]
        assertTrue(second.severityMismatch)
        assertTrue(second.cooldownMismatch)
        assertNull(second.ruleAName)
    }

    @Test
    fun extractConflicts_ignoresWrongToolName() {
        assertNull(extractConflicts(toolResult(name = "some_other_tool")))
    }

    @Test
    fun extractConflicts_ignoresNotOk() {
        assertNull(extractConflicts(toolResult(ok = false)))
    }

    @Test
    fun extractConflicts_missingConflictsKeyReturnsNull() {
        assertNull(extractConflicts(toolResult(conflicts = null)))
    }

    @Test
    fun extractConflicts_nonArrayConflictsReturnsNull() {
        val event =
            AiStreamEvent.ToolResult(
                id = "t1",
                name = DETECT_TOOL_NAME,
                ok = true,
                data = buildJsonObject { put("conflicts", "nope") },
                error = null,
            )
        assertNull(extractConflicts(event))
    }

    @Test
    fun extractConflicts_emptyArrayYieldsEmptyList() {
        val rows = extractConflicts(toolResult(conflicts = buildJsonArray {}))
        assertNotNull(rows)
        assertTrue(rows!!.isEmpty())
    }

    @Test
    fun extractConflicts_ignoresNonToolResultEvent() {
        assertNull(extractConflicts(AiStreamEvent.Delta("hello")))
        assertNull(extractConflicts(AiStreamEvent.Done("stop")))
    }

    @Test
    fun extractConflicts_skipsMalformedRows() {
        val arr =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("kind", "redundant_duplicate")
                        put("rule_a_id", 1)
                        put("rule_b_id", 2)
                    },
                )
                // missing kind → skipped (web `typeof r.kind !== 'string'`)
                add(
                    buildJsonObject {
                        put("rule_a_id", 1)
                        put("rule_b_id", 2)
                    },
                )
                // missing rule_a_id → skipped
                add(
                    buildJsonObject {
                        put("kind", "x")
                        put("rule_b_id", 2)
                    },
                )
                // string-typed id → skipped (web `typeof r.rule_a_id !== 'number'`)
                add(
                    buildJsonObject {
                        put("kind", "x")
                        put("rule_a_id", "1")
                        put("rule_b_id", 2)
                    },
                )
            }
        val rows = extractConflicts(toolResult(conflicts = arr))
        assertEquals(1, rows?.size)
    }

    @Test
    fun parseConflict_flagsAreStrictBooleansOnly() {
        val obj =
            buildJsonObject {
                put("kind", "redundant_duplicate")
                put("rule_a_id", 1)
                put("rule_b_id", 2)
                put("subsumes", "true") // string, not boolean → false (web `=== true`)
                put("severity_mismatch", true)
            }
        val conflict = parseConflict(obj)!!
        assertFalse(conflict.subsumes)
        assertTrue(conflict.severityMismatch)
        assertFalse(conflict.cooldownMismatch)
    }

    @Test
    fun parseConflict_acceptsFloatIds() {
        val obj =
            buildJsonObject {
                put("kind", "x")
                put("rule_a_id", 12.0)
                put("rule_b_id", 34.0)
            }
        val conflict = parseConflict(obj)!!
        assertEquals(12L, conflict.ruleAId)
        assertEquals(34L, conflict.ruleBId)
    }

    // ── per-conflict copy (kind label, pair line, review label, chips) ────────────────────────────────────

    @Test
    fun labelForKind_localizesKnownKindsAndFallsBackToWire() {
        val labels = aiConflictsLabels(FallbackResolver)
        assertEquals("Redundant duplicate", labelForKind("redundant_duplicate", labels))
        assertEquals("Overlapping threshold", labelForKind("overlapping_threshold", labels))
        assertEquals("future_kind", labelForKind("future_kind", labels))
    }

    @Test
    fun conflictPairLine_appendsNamesAndSignalWhenPresent() {
        val full =
            RuleConflict(
                kind = "x",
                ruleAId = 12,
                ruleBId = 34,
                ruleAName = "Low battery",
                ruleBName = "Battery low",
                signalName = "soc",
            )
        assertEquals("Rule 12 (Low battery) ↔ Rule 34 (Battery low) · soc", conflictPairLine(full, "Rule"))

        val bare = RuleConflict(kind = "x", ruleAId = 7, ruleBId = 9)
        assertEquals("Rule 7 ↔ Rule 9", conflictPairLine(bare, "Rule"))
    }

    @Test
    fun reviewRuleLabel_composesButtonLabelAndId() {
        val labels = aiConflictsLabels(FallbackResolver)
        assertEquals("Review rule 42", reviewRuleLabel(labels, 42))
    }

    @Test
    fun conflictChips_orderAndTonesMirrorWeb() {
        val labels = aiConflictsLabels(FallbackResolver)
        val conflict =
            RuleConflict(
                kind = "x",
                ruleAId = 1,
                ruleBId = 2,
                subsumes = true,
                severityMismatch = true,
                cooldownMismatch = true,
                triggerModeMismatch = true,
            )
        val chips = conflictChips(conflict, labels)
        assertEquals(
            listOf("subsumes", "severity mismatch", "cooldown mismatch", "trigger mode mismatch"),
            chips.map { it.text },
        )
        assertEquals(ConflictChipTone.Amber, chips.first().tone)
        assertTrue(chips.drop(1).all { it.tone == ConflictChipTone.Rose })
    }

    @Test
    fun conflictChips_emptyWhenNoFlags() {
        val labels = aiConflictsLabels(FallbackResolver)
        assertTrue(conflictChips(RuleConflict(kind = "x", ruleAId = 1, ruleBId = 2), labels).isEmpty())
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_waitingEmptyWhenIdleNotYetDetected() {
        val snapshot = projectAiConflicts(TWO_RULES, StreamRuntime(), online = true)
        assertEquals(AiConflictsRenderState.Empty, snapshot.renderState)
        assertFalse(snapshot.hasResult)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_emptyWhenDetectedZeroConflicts() {
        val snapshot = projectAiConflicts(TWO_RULES, StreamRuntime(phase = AiStreamPhase.Done, conflicts = emptyList()), true)
        assertEquals(AiConflictsRenderState.Empty, snapshot.renderState)
        assertTrue(snapshot.hasResult)
    }

    @Test
    fun project_contentWhenConflictsCaptured() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, conflicts = listOf(sampleRow()))
        val snapshot = projectAiConflicts(TWO_RULES, runtime, online = true)
        assertEquals(AiConflictsRenderState.Content, snapshot.renderState)
        assertEquals(1, snapshot.conflicts.size)
    }

    @Test
    fun project_contentWhenStreamedReplayTextOnly() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Reviewed 5 rules…")
        assertEquals(AiConflictsRenderState.Content, projectAiConflicts(TWO_RULES, runtime, online = true).renderState)
    }

    @Test
    fun project_loadingWhenStreamingNoConflicts() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming)
        val snapshot = projectAiConflicts(TWO_RULES, runtime, online = true)
        assertEquals(AiConflictsRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownConflicts() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, conflicts = listOf(sampleRow()))
        val snapshot = projectAiConflicts(TWO_RULES, runtime, online = true)
        assertEquals(AiConflictsRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val snapshot = projectAiConflicts(TWO_RULES, StreamRuntime(phase = AiStreamPhase.PausedConfirm), online = true)
        assertEquals(AiConflictsRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectAiConflicts(TWO_RULES, runtime, online = true)
        assertEquals(AiConflictsRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(AiConflictsRenderState.Offline, projectAiConflicts(TWO_RULES, byMessage, online = true).renderState)

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(AiConflictsRenderState.Offline, projectAiConflicts(TWO_RULES, byLimit, online = true).renderState)
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastKnownConflicts() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, conflicts = listOf(sampleRow()))
        val snapshot = projectAiConflicts(TWO_RULES, runtime, online = false)
        assertEquals(AiConflictsRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals(1, snapshot.conflicts.size)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_canStartFalseWhenFewerThanTwoRules() {
        assertFalse(projectAiConflicts(ruleCount = 1, StreamRuntime(), online = true).canStart)
        assertTrue(projectAiConflicts(ruleCount = 2, StreamRuntime(), online = true).canStart)
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_toolResultThenExtractsConflicts() {
        val raw =
            "event: tool_result\n" +
                "data: {\"id\":\"1\",\"name\":\"detect_rule_conflicts\",\"ok\":true," +
                "\"data\":{\"conflicts\":[{\"kind\":\"overlapping_threshold\",\"rule_a_id\":7,\"rule_b_id\":9}]}}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.ToolResult)
        val rows = extractConflicts(event!!)
        assertEquals(1, rows?.size)
        assertEquals("overlapping_threshold", rows?.first()?.kind)
        assertEquals(7L, rows?.first()?.ruleAId)
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
        name: String = DETECT_TOOL_NAME,
        ok: Boolean = true,
        conflicts: JsonArray? = sampleConflicts(),
    ): AiStreamEvent.ToolResult {
        val data =
            buildJsonObject {
                if (conflicts != null) put("conflicts", conflicts)
            }
        return AiStreamEvent.ToolResult(id = "t1", name = name, ok = ok, data = data, error = null)
    }

    private fun sampleConflicts(): JsonArray =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("kind", "redundant_duplicate")
                    put("rule_a_id", 12)
                    put("rule_b_id", 34)
                    put("rule_a_name", "Low battery")
                    put("rule_b_name", "Battery low")
                    put("signal_name", "soc")
                    put("reason", "Both fire on soc < 20%.")
                    put("subsumes", true)
                },
            )
            add(
                buildJsonObject {
                    put("kind", "overlapping_threshold")
                    put("rule_a_id", 7)
                    put("rule_b_id", 9)
                    put("signal_name", "tpms_fl")
                    put("severity_mismatch", true)
                    put("cooldown_mismatch", true)
                },
            )
        }

    private fun sampleRow(): RuleConflict = RuleConflict(kind = "overlapping_threshold", ruleAId = 7, ruleBId = 9)

    private companion object {
        const val TWO_RULES = 2
    }
}
