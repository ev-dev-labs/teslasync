// Off-device unit coverage for the AIChatbotIndicator surface's pure model (P3 acceptance: adapter + per-state
// + a11y-label tests). Exercises the registration slug + feature id the prompt mandates, the fail-closed gate
// predicate that mirrors the web `useAiEnabled('chatbot-llm')` (web/src/hooks/useAiEnabled.ts) for every input,
// the surface classifier covering the two real render outcomes (Hidden when the gate is closed — web
// `withAiFeature` → null — and Visible otherwise), the merged TalkBack label the chip exposes, and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the strings + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIChatbotIndicatorModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug + feature id ───

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("AIChatbotIndicator", AI_CHATBOT_INDICATOR_SLUG)
    }

    @Test
    fun featureIdMirrorsTheWebWithAiFeatureArgument() {
        assertEquals("chatbot-llm", CHATBOT_LLM_FEATURE)
        assertEquals("off", AI_MODE_OFF)
    }

    // ── gate predicate (web `useAiEnabled('chatbot-llm')`, fail-closed) ───────────────

    @Test
    fun gateClosedWhileSettingsUnresolved() {
        // A null mode is the unresolved settings query — the badge stays hidden while loading (web returns false).
        assertFalse(evaluateChatbotLlmGate(aiMode = null, featureEnabled = true))
        assertFalse(evaluateChatbotLlmGate(aiMode = null, featureEnabled = null))
    }

    @Test
    fun gateClosedInOffMode() {
        // Off mode blocks every AI surface unconditionally, even when the per-feature flag is on.
        assertFalse(evaluateChatbotLlmGate(aiMode = "off", featureEnabled = true))
    }

    @Test
    fun gateClosedWhenFeatureNotOptedIn() {
        // A non-off mode is not enough — the per-feature flag must be exactly true (a missing map => null => off).
        assertFalse(evaluateChatbotLlmGate(aiMode = "local", featureEnabled = null))
        assertFalse(evaluateChatbotLlmGate(aiMode = "local", featureEnabled = false))
        assertFalse(evaluateChatbotLlmGate(aiMode = "cloud", featureEnabled = false))
    }

    @Test
    fun gateOpenWhenModeOnAndFeatureOptedIn() {
        assertTrue(evaluateChatbotLlmGate(aiMode = "local", featureEnabled = true))
        assertTrue(evaluateChatbotLlmGate(aiMode = "cloud", featureEnabled = true))
    }

    // ── surface classifier (web `withAiFeature` → chip | null) ────────────────────────

    @Test
    fun defaultStateIsHiddenFailClosed() {
        // The initial state before the gate resolves must hide the chip (web's unresolved-settings behaviour).
        assertEquals(IndicatorSurface.Hidden, classifyIndicator(ChatbotIndicatorState()))
    }

    @Test
    fun gateDisabledClassifiesHidden() {
        assertEquals(IndicatorSurface.Hidden, classifyIndicator(ChatbotIndicatorState(gateEnabled = false)))
    }

    @Test
    fun gateEnabledClassifiesVisible() {
        assertEquals(IndicatorSurface.Visible, classifyIndicator(ChatbotIndicatorState(gateEnabled = true)))
    }

    // ── a11y label: the chip's merged TalkBack description (web aria-label + title) ───

    @Test
    fun accessibilityLabelMergesAriaLabelAndTooltip() {
        val tooltip = "Helix is your AI assistant. It generates responses using your redacted fleet context."
        assertEquals("Helix. $tooltip", indicatorAccessibilityLabel("Helix", tooltip))
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

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
        recordChatbotIndicatorOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no settings value or generated text can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AIChatbotIndicator"), records[0].fields)
    }
}
