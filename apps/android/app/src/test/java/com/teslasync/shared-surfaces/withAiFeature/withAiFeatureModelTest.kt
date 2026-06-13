// Off-device unit coverage for the withAiFeature surface's pure model (P3 acceptance: adapter + per-state +
// guard tests). Exercises the prompt-mandated surface slug, the native AI-feature registry mirror + its
// `data-testid` resolution (web `meta.uiTestIds[0] ?? "ai-feature-<id>"`), the fail-fast construction guard
// (web `withAiFeature` throw on a typo), the fail-closed gate predicate that mirrors the web
// `useAiEnabled(feature)` (web/src/hooks/useAiEnabled.ts) for every input, the surface classifier covering the
// two real render outcomes (Hidden when the gate is closed — web `withAiFeature` → null — and Visible
// otherwise), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web source produces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.withaifeature

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WithAiFeatureModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("withAiFeature", WITH_AI_FEATURE_SLUG)
        assertEquals("off", AI_MODE_OFF)
    }

    // ── registry mirror (web AI_FEATURE_IDS + AI_FEATURES, 57 features) ───────────────

    @Test
    fun registryMirrorsTheWebFeatureSet() {
        assertEquals(57, AI_FEATURE_TEST_IDS.size)
        assertEquals(AI_FEATURE_TEST_IDS.size, AI_FEATURE_TEST_IDS.keys.toSet().size)
        assertTrue(isKnownAiFeature("chatbot-llm"))
        assertTrue(isKnownAiFeature("nl-search"))
        assertTrue(isKnownAiFeature("__usage__"))
        assertTrue(isKnownAiFeature("yir-narration"))
        assertFalse(isKnownAiFeature("not-a-feature"))
        assertFalse(isKnownAiFeature(""))
    }

    // ── test-id resolution (web `meta.uiTestIds[0] ?? "ai-feature-<id>"`) ─────────────

    @Test
    fun resolveTestIdUsesExplicitUiTestIdWhenPresent() {
        // Features whose web uiTestIds[0] differs from the fallback form must resolve to that explicit value.
        assertEquals("ai-feature-chatbot-llm-root", resolveAiFeatureTestId("chatbot-llm"))
        assertEquals("ai-feature-redaction-bypass", resolveAiFeatureTestId("__redaction_bypass__"))
        assertEquals("ai-feature-usage", resolveAiFeatureTestId("__usage__"))
        assertEquals("ai-feature-nl-search-root", resolveAiFeatureTestId("nl-search"))
    }

    @Test
    fun resolveTestIdFallsBackToAiFeatureIdWhenUiTestIdsEmpty() {
        // ai-provider-health has empty web uiTestIds, so the web HOC resolves the `ai-feature-<id>` fallback.
        assertEquals("ai-feature-ai-provider-health", resolveAiFeatureTestId("ai-provider-health"))
    }

    @Test
    fun resolveTestIdIsTotalForUnregisteredIds() {
        // The gate never renders an unregistered id (requireKnownAiFeature throws first), but the helper stays
        // total with the web fallback form so it never crashes a render path.
        assertEquals("ai-feature-not-a-feature", resolveAiFeatureTestId("not-a-feature"))
    }

    // ── construction guard (web `withAiFeature` throw on a typo) ──────────────────────

    @Test
    fun requireKnownAiFeatureThrowsParityMessageOnUnknown() {
        val error =
            try {
                requireKnownAiFeature("not-a-real-feature")
                null
            } catch (e: IllegalArgumentException) {
                e
            }
        assertNotNull(error)
        val message = error?.message ?: ""
        assertTrue(message.contains("unknown AI feature id"))
        assertTrue(message.contains("\"not-a-real-feature\""))
        assertTrue(message.contains("make generate"))
    }

    @Test
    fun requireKnownAiFeaturePassesForRegisteredId() {
        // No exception for a registered id (the happy path the web compile-time check covers).
        requireKnownAiFeature("chatbot-llm")
    }

    // ── gate predicate (web `useAiEnabled(feature)`, fail-closed) ─────────────────────

    @Test
    fun gateClosedWhileSettingsUnresolved() {
        // A null mode is the unresolved settings query — the surface stays hidden while loading (web → false).
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = null, featureFlag = true))
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = null, featureFlag = null))
    }

    @Test
    fun gateClosedInOffMode() {
        // Off mode blocks every AI surface unconditionally, even when the per-feature flag is on.
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = "off", featureFlag = true))
    }

    @Test
    fun gateClosedWhenFeatureNotOptedIn() {
        // A non-off mode is not enough — the per-feature flag must be exactly true (a missing map => null => off).
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = "local", featureFlag = null))
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = "local", featureFlag = false))
        assertFalse(evaluateAiEnabled("chatbot-llm", aiMode = "cloud", featureFlag = false))
    }

    @Test
    fun gateClosedForUnregisteredFeatureEvenWhenModeOnAndOptedIn() {
        // Mirrors web `if (!AI_FEATURES[feature]) return false` — an unknown id is fail-closed regardless.
        assertFalse(evaluateAiEnabled("not-a-feature", aiMode = "local", featureFlag = true))
    }

    @Test
    fun gateOpenWhenModeOnAndFeatureOptedIn() {
        assertTrue(evaluateAiEnabled("chatbot-llm", aiMode = "local", featureFlag = true))
        assertTrue(evaluateAiEnabled("chatbot-llm", aiMode = "cloud", featureFlag = true))
    }

    // ── surface classifier (web `withAiFeature` → content | null) ─────────────────────

    @Test
    fun defaultStateIsHiddenFailClosed() {
        // The initial state before the gate resolves must hide the content (web's unresolved-settings behaviour).
        assertEquals(GateSurface.Hidden, classifyGate(WithAiFeatureState()))
    }

    @Test
    fun gateDisabledClassifiesHidden() {
        assertEquals(GateSurface.Hidden, classifyGate(WithAiFeatureState(gateEnabled = false)))
    }

    @Test
    fun gateEnabledClassifiesVisible() {
        assertEquals(GateSurface.Visible, classifyGate(WithAiFeatureState(gateEnabled = true)))
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
        recordWithAiFeatureOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no settings value, bound feature, or generated text can leak through.
        assertEquals(mapOf("surface" to "withAiFeature"), records[0].fields)
    }
}
