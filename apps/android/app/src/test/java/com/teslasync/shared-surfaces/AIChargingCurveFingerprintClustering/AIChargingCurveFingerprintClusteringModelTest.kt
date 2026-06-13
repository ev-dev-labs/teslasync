// Off-device unit coverage for the AIChargingCurveFingerprintClustering surface's pure model (P3
// acceptance: adapter + per-state + a11y-label tests). Exercises the registration slug the prompt mandates,
// the web `t(key, default)` defaults + the catalog resource-name mapping, the `haveInputs` / requestVehicleId
// gate + body shape, the `!canStart || streaming` button rule, the withAiFeature visibility gate, the
// AiOutputPanel branch classifier (per-state coverage over idle / streaming / done / error), the
// accessibility content-description fold (a11y-label coverage), the useAiStream SSE frame parser +
// chunk accumulator, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP —
// runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour the web source
// produces (web/src/components/ai/AIChargingCurveFingerprintClustering.tsx + the shared useAiStream hook).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIChargingCurveFingerprintClusteringModelTest {
    // ── registration + path mirror the prompt + web source ───────────────────────

    @Test
    fun registrationIdsAndPathAreStable() {
        assertEquals("charging-curve-fingerprint-clustering", AIChargingCurveFingerprintClusteringRegistration.FEATURE_ID)
        assertEquals(
            "ai-feature-charging-curve-fingerprint-clustering-root",
            AIChargingCurveFingerprintClusteringRegistration.TEST_ID,
        )
        assertEquals("AIChargingCurveFingerprintClustering", AIChargingCurveFingerprintClusteringRegistration.SLUG)
        assertEquals("/ai/charging/curves/clusters/explain", AI_CLUSTERING_EXPLAIN_PATH)
    }

    // ── defaults + i18n keys mirror the web source ───────────────────────────────

    @Test
    fun defaultsMirrorWebSource() {
        assertEquals("Explain the charging-curve cluster fingerprints", AiClusteringDefaults.TITLE)
        assertEquals("Explain clusters", AiClusteringDefaults.BUTTON_LABEL)
        assertEquals("Helix", AiClusteringDefaults.BADGE)
        assertEquals("Ask Helix", AiClusteringDefaults.ASK_HELIX)
        assertEquals("Helix is thinking\u2026", AiClusteringDefaults.THINKING)
        assertEquals("Helix error:", AiClusteringDefaults.ERROR_LABEL)
        assertEquals("unknown", AiClusteringDefaults.ERROR_UNKNOWN)
        // The description grounds the narration in the deterministic cluster numbers (web em-dash preserved).
        assertTrue(AiClusteringDefaults.DESCRIPTION.startsWith("Ask Helix to name and explain"))
        assertTrue(AiClusteringDefaults.DESCRIPTION.contains("\u2014"))
    }

    @Test
    fun i18nKeysMatchCatalogResourceNames() {
        // Each web `charging.aiClustering.*` key maps to a `translation_*` resource present in values/,
        // values-ar/, and values-he/ (asserted by name; resource bytes are not read off-device).
        assertEquals("translation_charging_aiClustering_title", KEY_TITLE)
        assertEquals("translation_charging_aiClustering_description", KEY_DESCRIPTION)
        assertEquals("translation_charging_aiClustering_generateButton", KEY_BUTTON_LABEL)
        assertEquals("translation_charging_aiClustering_badge", KEY_BADGE)
        // The shared-card chrome keys resolve by name with the web default as a fallback when absent.
        assertEquals("translation_helix_askHelix", KEY_ASK_HELIX)
        assertEquals("translation_helix_thinking", KEY_THINKING)
        assertEquals("translation_helix_errorLabel", KEY_ERROR_LABEL)
        assertEquals("translation_ai_common_errorUnknown", KEY_ERROR_UNKNOWN)
    }

    // ── canStart / body / button gates (web haveInputs + disabled) ───────────────

    @Test
    fun haveInputsMirrorsWebFiniteAndPositive() {
        assertTrue(haveInputs(5L))
        assertFalse(haveInputs(null))
        assertFalse(haveInputs(0L))
        assertFalse(haveInputs(-3L))
    }

    @Test
    fun requestVehicleIdDefaultsToZeroWhenNotReady() {
        assertEquals(42L, requestVehicleId(42L))
        assertEquals(0L, requestVehicleId(null))
        assertEquals(0L, requestVehicleId(0L))
    }

    @Test
    fun buttonDisabledMirrorsWebNotCanStartOrStreaming() {
        assertFalse(buttonDisabled(canStart = true, phase = AiStreamPhase.Idle))
        assertFalse(buttonDisabled(canStart = true, phase = AiStreamPhase.Done))
        assertFalse(buttonDisabled(canStart = true, phase = AiStreamPhase.Error))
        // Disabled while a stream is open (double-submit protection)...
        assertTrue(buttonDisabled(canStart = true, phase = AiStreamPhase.Streaming))
        // ...and while no vehicle is in scope.
        assertTrue(buttonDisabled(canStart = false, phase = AiStreamPhase.Idle))
    }

    @Test
    fun shouldRenderMirrorsWithAiFeatureGate() {
        assertTrue(shouldRender(featureEnabled = true))
        assertFalse(shouldRender(featureEnabled = false))
    }

    @Test
    fun streamPhaseCoversTheFourRenderedStates() {
        assertEquals(
            listOf(AiStreamPhase.Idle, AiStreamPhase.Streaming, AiStreamPhase.Done, AiStreamPhase.Error),
            AiStreamPhase.entries.toList(),
        )
    }

    // ── output-panel classifier: per-state coverage (web AiOutputPanel branches) ──

    @Test
    fun outputPanelHiddenBeforeAnyRun() {
        assertEquals(OutputPanelState.Hidden, outputPanelStateFor(AiStreamPhase.Idle, "", null))
    }

    @Test
    fun outputPanelThinkingWhileStreamingWithNoText() {
        assertEquals(OutputPanelState.Thinking, outputPanelStateFor(AiStreamPhase.Streaming, "", null))
    }

    @Test
    fun outputPanelShowsAccumulatedTextOnceTokensArrive() {
        assertEquals(
            OutputPanelState.Text("Cluster A is cold-soak DC fast charging."),
            outputPanelStateFor(AiStreamPhase.Streaming, "Cluster A is cold-soak DC fast charging.", null),
        )
        assertEquals(
            OutputPanelState.Text("Done narrative."),
            outputPanelStateFor(AiStreamPhase.Done, "Done narrative.", null),
        )
    }

    @Test
    fun outputPanelShowsErrorMessageOrUnknownFallback() {
        assertEquals(
            OutputPanelState.Error("stream_http_503"),
            outputPanelStateFor(AiStreamPhase.Error, "", "stream_http_503"),
        )
        // A blank / null error message falls back to "unknown" (web `error ?? t('ai.common.errorUnknown')`).
        assertEquals(OutputPanelState.Error("unknown"), outputPanelStateFor(AiStreamPhase.Error, "", null))
        assertEquals(OutputPanelState.Error("unknown"), outputPanelStateFor(AiStreamPhase.Error, "", "  "))
    }

    // ── accessibility label fold (a11y-label coverage) ───────────────────────────

    @Test
    fun accessibilityLabelFoldsHeaderWithoutHintWhenReady() {
        val label =
            cardAccessibilityLabel(
                title = AiClusteringDefaults.TITLE,
                badge = AiClusteringDefaults.BADGE,
                description = AiClusteringDefaults.DESCRIPTION,
                emptyHint = AiClusteringDefaults.EMPTY_HINT,
                canStart = true,
            )
        assertEquals(
            "${AiClusteringDefaults.TITLE}. ${AiClusteringDefaults.BADGE}. ${AiClusteringDefaults.DESCRIPTION}",
            label,
        )
        assertFalse(label.contains(AiClusteringDefaults.EMPTY_HINT))
    }

    @Test
    fun accessibilityLabelAppendsHintWhenNoVehicleInScope() {
        val label =
            cardAccessibilityLabel(
                title = AiClusteringDefaults.TITLE,
                badge = AiClusteringDefaults.BADGE,
                description = AiClusteringDefaults.DESCRIPTION,
                emptyHint = AiClusteringDefaults.EMPTY_HINT,
                canStart = false,
            )
        assertTrue(label.endsWith(AiClusteringDefaults.EMPTY_HINT))
    }

    // ── SSE frame parser (web parseSSEFrame + toTypedEvent) ───────────────────────

    @Test
    fun parsesDeltaDoneAndErrorFrames() {
        assertEquals(AiStreamFrame.Delta("hello"), parseAiSseEvent("event: delta\ndata: {\"text\":\"hello\"}"))
        assertEquals(AiStreamFrame.Done, parseAiSseEvent("event: done\ndata: {\"finish_reason\":\"stop\"}"))
        assertEquals(AiStreamFrame.Error("boom"), parseAiSseEvent("event: error\ndata: {\"message\":\"boom\"}"))
    }

    @Test
    fun parsesFramesWithoutSpaceAfterColonAndSkipsComments() {
        assertEquals(AiStreamFrame.Delta("y"), parseAiSseEvent(":keep-alive\nevent:delta\ndata:{\"text\":\"y\"}"))
    }

    @Test
    fun reassemblesJsonSplitAcrossMultipleDataLines() {
        // Web joins consecutive `data:` lines with "\n" before JSON.parse.
        val frame = "event: delta\ndata: {\ndata: \"text\": \"z\"\ndata: }"
        assertEquals(AiStreamFrame.Delta("z"), parseAiSseEvent(frame))
    }

    @Test
    fun errorFrameWithoutMessageFallsBackToUnknown() {
        assertEquals(AiStreamFrame.Error("unknown"), parseAiSseEvent("event: error\ndata: {}"))
    }

    @Test
    fun dropsUnknownDatalessMalformedAndEventlessFrames() {
        // Unknown event type for this feature (tool_call) → dropped (web drops what it does not act on).
        assertNull(parseAiSseEvent("event: tool_call\ndata: {\"id\":\"1\",\"name\":\"x\"}"))
        // No `event:` line → null (web `if (!event) return null`).
        assertNull(parseAiSseEvent("data: {\"text\":\"x\"}"))
        // Malformed JSON payload → null (web JSON.parse catch).
        assertNull(parseAiSseEvent("event: delta\ndata: not-json"))
        // delta whose `text` is not a string → null (web `typeof d.text !== 'string'`).
        assertNull(parseAiSseEvent("event: delta\ndata: {\"text\":123}"))
        // Non-object JSON payload → null (web `typeof data !== 'object'`).
        assertNull(parseAiSseEvent("event: done\ndata: 42"))
    }

    // ── chunk accumulator (web read-loop buffer split on the blank line) ──────────

    @Test
    fun accumulatorSplitsMultipleFramesInOneChunk() {
        val accumulator = AiSseFrameAccumulator()
        val frames =
            accumulator.feed("event: delta\ndata: {\"text\":\"a\"}\n\nevent: done\ndata: {}\n\n")
        assertEquals(2, frames.size)
        assertEquals(AiStreamFrame.Delta("a"), parseAiSseEvent(frames[0]))
        assertEquals(AiStreamFrame.Done, parseAiSseEvent(frames[1]))
        assertNull(accumulator.flush())
    }

    @Test
    fun accumulatorBuffersAPartialFrameAcrossChunks() {
        val accumulator = AiSseFrameAccumulator()
        // First chunk ends mid-frame: nothing complete yet.
        assertTrue(accumulator.feed("event: delta\ndata: {\"text\":\"hel").isEmpty())
        // The frame completes on the next chunk's blank line.
        val frames = accumulator.feed("lo\"}\n\n")
        assertEquals(listOf(AiStreamFrame.Delta("hello")), frames.map { parseAiSseEvent(it) })
    }

    @Test
    fun accumulatorFlushDrainsAFinalFrameWithNoTrailingBlankLine() {
        val accumulator = AiSseFrameAccumulator()
        assertTrue(accumulator.feed("event: done\ndata: {}").isEmpty())
        val tail = accumulator.flush()
        assertEquals(AiStreamFrame.Done, tail?.let { parseAiSseEvent(it) })
        // Idempotent: a second flush yields nothing.
        assertNull(accumulator.flush())
    }

    // ── diagnostics: one PII-safe view.opened ────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordAIChargingCurveClusteringOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id or narrative can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AIChargingCurveFingerprintClustering"), records[0].fields)
    }
}
