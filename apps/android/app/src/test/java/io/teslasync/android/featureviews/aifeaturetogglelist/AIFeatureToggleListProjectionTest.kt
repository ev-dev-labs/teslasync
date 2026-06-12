package io.teslasync.android.featureviews.aifeaturetogglelist

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AIFeatureToggleList surface's pure logic — the native analogue of the web
 * component's data + derivations (web/src/features/settings/components/AIFeatureToggleList.tsx): the verbatim
 * registry mirror of `@/ai/features` (`AI_FEATURE_IDS` order + `AI_FEATURES` metadata), the i18n key → Android
 * resource-name mapping the composable resolves through `getIdentifier`, the per-row projection (resource
 * names + registry fallbacks + `data-testid` parity tags), the `Boolean(values[id])` enabled rule, and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class AIFeatureToggleListProjectionTest {
    // ── Registry mirror (web AI_FEATURE_IDS + AI_FEATURES) ──────────────────────────

    @Test
    fun registryMirrorsWebFeatureCountOrderAndIsAllOptIn() {
        // The generated web registry has exactly 57 features in this canonical order.
        assertEquals(57, AiFeatureRegistry.features.size)
        assertEquals(57, AiFeatureRegistry.ids.size)
        assertEquals(
            listOf("__redaction_bypass__", "__usage__", "ai-provider-health"),
            AiFeatureRegistry.ids.take(3),
        )
        assertEquals("yir-narration", AiFeatureRegistry.ids.last())
        // AI-off contract (ADR-015): every shipped feature is opt-in (defaultOn=false) — the legend's promise.
        assertTrue(AiFeatureRegistry.features.all { !it.defaultOn })
    }

    @Test
    fun registryIdsAreUniqueAndEachCarriesNonBlankFallbacks() {
        assertEquals(AiFeatureRegistry.ids.size, AiFeatureRegistry.ids.toSet().size)
        assertTrue(AiFeatureRegistry.features.all { it.name.isNotBlank() })
        assertTrue(AiFeatureRegistry.features.all { it.description.isNotBlank() })
    }

    @Test
    fun byIdAndIsKnownResolveTheRegistry() {
        assertEquals("AI Provider Health (ops)", AiFeatureRegistry.byId["ai-provider-health"]?.name)
        assertTrue(AiFeatureRegistry.isKnown("nl-search"))
        assertFalse(AiFeatureRegistry.isKnown("not-a-feature"))
    }

    // ── i18n key → Android resource-name mapping ────────────────────────────────────

    @Test
    fun i18nKeyBuildersMirrorTheWebKeys() {
        assertEquals("ai.settings.feature.legend", AiFeatureI18n.LEGEND_KEY)
        assertEquals("ai.settings.feature.nl-search.label", AiFeatureI18n.labelKey("nl-search"))
        assertEquals(
            "ai.settings.feature.nl-search.description",
            AiFeatureI18n.descriptionKey("nl-search"),
        )
    }

    @Test
    fun resourceNameFlattensDotsAndHyphensUnderTranslationPrefix() {
        assertEquals(
            "translation_ai_settings_feature_legend",
            AiFeatureI18n.resourceName(AiFeatureI18n.LEGEND_KEY),
        )
        assertEquals(
            "translation_ai_settings_feature_ai_provider_health_label",
            AiFeatureI18n.resourceName(AiFeatureI18n.labelKey("ai-provider-health")),
        )
        // The double-underscore internal ids keep their underscores (the catalog simply has no such key,
        // so the composable falls back to the registry text — exactly as the web does).
        assertEquals(
            "translation_ai_settings_feature___redaction_bypass___label",
            AiFeatureI18n.resourceName(AiFeatureI18n.labelKey("__redaction_bypass__")),
        )
    }

    // ── Projection (web AI_FEATURE_IDS.map) ─────────────────────────────────────────

    @Test
    fun rowsProjectsEveryFeatureInOrderWithKeysFallbacksAndTags() {
        val rows = AIFeatureToggleListProjection.rows()
        assertEquals(AiFeatureRegistry.ids, rows.map { it.id })

        val nlSearch = rows.first { it.id == "nl-search" }
        assertEquals("translation_ai_settings_feature_nl_search_label", nlSearch.labelResourceName)
        assertEquals(
            "translation_ai_settings_feature_nl_search_description",
            nlSearch.descriptionResourceName,
        )
        assertEquals(AiFeatureRegistry.byId["nl-search"]?.name, nlSearch.labelFallback)
        assertEquals(AiFeatureRegistry.byId["nl-search"]?.description, nlSearch.descriptionFallback)
        assertEquals("ai-feature-row-nl-search", nlSearch.rowTestTag)
        assertEquals("ai-feature-toggle-nl-search", nlSearch.toggleTestTag)
    }

    @Test
    fun rowsAcceptsACustomRegistrySlice() {
        val rows =
            AIFeatureToggleListProjection.rows(
                listOf(AiFeatureMeta("demo-x", "Demo X", "Demo desc", false)),
            )
        assertEquals(1, rows.size)
        assertEquals("demo-x", rows.single().id)
        assertEquals("Demo X", rows.single().labelFallback)
    }

    @Test
    fun testTagBuildersMatchWebTestIds() {
        assertEquals("ai-feature-toggle-list", AIFeatureToggleListProjection.LIST_TEST_TAG)
        assertEquals("ai-feature-row-voice-mode", AIFeatureToggleListProjection.rowTestTag("voice-mode"))
        assertEquals(
            "ai-feature-toggle-voice-mode",
            AIFeatureToggleListProjection.toggleTestTag("voice-mode"),
        )
    }

    // ── Enabled rule (web Boolean(values[id])) ──────────────────────────────────────

    @Test
    fun isEnabledMatchesWebBooleanCoercion() {
        val values = mapOf("nl-search" to true, "chatbot-llm" to false)
        assertTrue(AIFeatureToggleListProjection.isEnabled(values, "nl-search"))
        assertFalse(AIFeatureToggleListProjection.isEnabled(values, "chatbot-llm"))
        // Absent flag → off (web `undefined` → `Boolean(undefined)` === false).
        assertFalse(AIFeatureToggleListProjection.isEnabled(values, "drive-coaching"))
        assertFalse(AIFeatureToggleListProjection.isEnabled(emptyMap(), "nl-search"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAIFeatureToggleListOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AIFeatureToggleList"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("ai-feature-toggle-list", AIFeatureToggleListRegistration.ID)
        assertEquals("AIFeatureToggleList", AIFeatureToggleListRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
