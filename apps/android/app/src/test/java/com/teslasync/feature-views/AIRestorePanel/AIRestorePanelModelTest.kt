// Off-device unit coverage for the AIRestorePanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the AI feature registry that mirrors the web `@/ai/features`
// (`AI_FEATURES` + `isKnownAiFeature`), the `previewLabels` adapter (web `previewLabels(archived, t)` — the
// known/unknown branch, the enabled filter, insertion order, and the `t(key, default)` fallback), the
// `resolveOptional` by-name seam, the surface-state classifier the composable switches on (per-state coverage
// over the shared UiState lifecycle), the host gate that mirrors the web "surfaced ONLY when…" conditions,
// the accessibility content-description fold (a11y label coverage), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest. Reference values are the
// strings + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.airestorepanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIRestorePanelModelTest {
    // ── defaults + i18n keys mirror the web source ──────────────────────────────

    @Test
    fun defaultsMirrorWebSource() {
        assertEquals("Restore previous Helix selection?", AIRestorePanelDefaults.TITLE)
        assertEquals(
            "You previously had these features enabled. Re-enable them now?",
            AIRestorePanelDefaults.DESCRIPTION,
        )
        assertEquals("No thanks", AIRestorePanelDefaults.DECLINE)
        assertEquals("Restore selection", AIRestorePanelDefaults.RESTORE)
    }

    @Test
    fun i18nKeysMatchCatalogResourceNames() {
        // Each web `ai.settings.archive.*` key maps to a `translation_*` resource present in values/,
        // values-ar/, and values-he/ (asserted by name; resource bytes are not read off-device).
        assertEquals("translation_ai_settings_archive_title", KEY_TITLE)
        assertEquals("translation_ai_settings_archive_description", KEY_DESCRIPTION)
        assertEquals("translation_ai_settings_archive_decline", KEY_DECLINE)
        assertEquals("translation_ai_settings_archive_restore", KEY_RESTORE)
    }

    // ── AI feature registry mirrors web @/ai/features ────────────────────────────

    @Test
    fun registryHasEvery57WebFeatureWithItsName() {
        // The web `AI_FEATURES` (generated from internal/ai/features/registry.go) has exactly 57 entries.
        assertEquals(57, AiFeatureRegistry.FALLBACK_LABELS.size)
        // A representative slice of the id → name (the web `t(key, default)` fallback) contract.
        assertEquals("Per-drive coaching", AiFeatureRegistry.FALLBACK_LABELS["drive-coaching"])
        assertEquals("AI Provider Health (ops)", AiFeatureRegistry.FALLBACK_LABELS["ai-provider-health"])
        assertEquals("AI Usage Card", AiFeatureRegistry.FALLBACK_LABELS["__usage__"])
        assertEquals("Year-in-review narration", AiFeatureRegistry.FALLBACK_LABELS["yir-narration"])
    }

    @Test
    fun isKnownMatchesWebIsKnownAiFeature() {
        assertTrue(AiFeatureRegistry.isKnown("drive-coaching"))
        assertTrue(AiFeatureRegistry.isKnown("__redaction_bypass__"))
        assertTrue(AiFeatureRegistry.isKnown("voice-mode"))
        assertFalse(AiFeatureRegistry.isKnown("a-removed-feature"))
        assertFalse(AiFeatureRegistry.isKnown(""))
    }

    @Test
    fun fallbackLabelReturnsRegistryNameForKnownAndRawIdForUnknown() {
        assertEquals("LLM Chatbot", AiFeatureRegistry.fallbackLabel("chatbot-llm"))
        assertEquals("a-removed-feature", AiFeatureRegistry.fallbackLabel("a-removed-feature"))
    }

    @Test
    fun labelResourceNameFlattensSeparatorsLikeTheCatalog() {
        // Web dynamic key `ai.settings.feature.<id>.label` → Android `translation_ai_settings_feature_<id>_label`,
        // every separator flattened to `_` (verified against res/values/strings.xml).
        assertEquals(
            "translation_ai_settings_feature_ai_provider_health_label",
            AiFeatureRegistry.labelResourceName("ai-provider-health"),
        )
        assertEquals(
            "translation_ai_settings_feature_lifetime_stats_qa_label",
            AiFeatureRegistry.labelResourceName("lifetime-stats-qa"),
        )
        // The double-underscore tier-F ids round-trip too (their label is absent → fallback applies).
        assertEquals(
            "translation_ai_settings_feature___usage___label",
            AiFeatureRegistry.labelResourceName("__usage__"),
        )
    }

    // ── previewLabels adapter (web `previewLabels(archived, t)`) ──────────────────

    @Test
    fun previewLabelsEmptyForNoEntriesOrAllDisabled() {
        assertTrue(previewLabels(emptyMap()) { _, fallback -> fallback }.isEmpty())
        val allDisabled = linkedMapOf("drive-coaching" to false, "nl-search" to false)
        assertTrue(previewLabels(allDisabled) { _, fallback -> fallback }.isEmpty())
    }

    @Test
    fun previewLabelsResolvesKnownAndKeepsUnknownIdRaw() {
        val archived = linkedMapOf("drive-coaching" to true, "a-removed-feature" to true)
        // The fake translate echoes the resolved catalog label as "L:<id>" for a known feature.
        val labels = previewLabels(archived) { id, _ -> "L:$id" }
        assertEquals(listOf("L:drive-coaching", "a-removed-feature"), labels)
    }

    @Test
    fun previewLabelsPassesRegistryNameAsFallbackForKnownFeatures() {
        var seenFallback: String? = null
        previewLabels(linkedMapOf("chatbot-llm" to true)) { _, fallback ->
            seenFallback = fallback
            fallback
        }
        // Mirrors web `translate(id, AI_FEATURES[id].name)`.
        assertEquals("LLM Chatbot", seenFallback)
    }

    @Test
    fun previewLabelsPreservesInsertionOrderAndFiltersDisabled() {
        val archived =
            linkedMapOf(
                "nl-search" to true,
                "drive-coaching" to false,
                "charging-diagnosis" to true,
            )
        val labels = previewLabels(archived) { id, _ -> id }
        // drive-coaching filtered (disabled); nl-search before charging-diagnosis (insertion order).
        assertEquals(listOf("nl-search", "charging-diagnosis"), labels)
    }

    // ── resolveOptional by-name seam (web `t(key, default)`) ──────────────────────

    @Test
    fun resolveOptionalPrefersPresentNonBlankElseFallback() {
        assertEquals("Resolved", resolveOptional({ "Resolved" }, "any.key", "Fallback"))
        assertEquals("Fallback", resolveOptional({ null }, "any.key", "Fallback"))
        // A present-but-blank resource is treated as absent (web empty-string guard).
        assertEquals("Fallback", resolveOptional({ "  " }, "any.key", "Fallback"))
    }

    // ── surface classifier: per-state coverage over the shared UiState lifecycle ─

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(AIRestoreSurfaceState.Loading, aiRestoreSurfaceFor(isLoading = true, isError = false))
        assertEquals(AIRestoreSurfaceState.Error, aiRestoreSurfaceFor(isLoading = false, isError = true))
        // Loading wins when both flags are set (first-load over a prior error).
        assertEquals(AIRestoreSurfaceState.Loading, aiRestoreSurfaceFor(isLoading = true, isError = true))
        assertEquals(AIRestoreSurfaceState.Prompt, aiRestoreSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(AIRestoreSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(
            AIRestoreSurfaceState.Error,
            surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(AIRestoreSurfaceState.Prompt, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(AIRestoreSurfaceState.Prompt, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        // Stale/offline (cached content after a failed refresh) resolves to the prompt presentation.
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(AIRestoreSurfaceState.Prompt, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── host gate (web "surfaced ONLY when mode != off, archived non-empty, not declined") ──

    @Test
    fun shouldRenderRequiresAllThreeWebConditions() {
        val archived = mapOf("drive-coaching" to true)
        assertTrue(shouldRender(aiModeOff = false, archived = archived, declinedThisSession = false))
        // (1) AI off → never offer a restore (user must enable AI first).
        assertFalse(shouldRender(aiModeOff = true, archived = archived, declinedThisSession = false))
        // (2) empty archive → nothing to restore.
        assertFalse(shouldRender(aiModeOff = false, archived = emptyMap(), declinedThisSession = false))
        // (3) declined this session → dismissed.
        assertFalse(shouldRender(aiModeOff = false, archived = archived, declinedThisSession = true))
    }

    // ── accessibility label fold ─────────────────────────────────────────────────

    @Test
    fun alertAnnouncementFoldsTitleAndDescriptionWhenNoLabels() {
        assertEquals(
            "${AIRestorePanelDefaults.TITLE}. ${AIRestorePanelDefaults.DESCRIPTION}",
            alertAnnouncement(AIRestorePanelDefaults.TITLE, AIRestorePanelDefaults.DESCRIPTION, emptyList()),
        )
    }

    @Test
    fun alertAnnouncementAppendsCommaSeparatedLabels() {
        assertEquals(
            "${AIRestorePanelDefaults.TITLE}. ${AIRestorePanelDefaults.DESCRIPTION} Per-drive coaching, Charging session diagnosis",
            alertAnnouncement(
                AIRestorePanelDefaults.TITLE,
                AIRestorePanelDefaults.DESCRIPTION,
                listOf("Per-drive coaching", "Charging session diagnosis"),
            ),
        )
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
        recordAIRestorePanelOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no archived feature id can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AIRestorePanel"), records[0].fields)
    }

    @Test
    fun registrationIdsAreStable() {
        assertEquals("ai-restore-panel", AIRestorePanelRegistration.ID)
        assertEquals("AIRestorePanel", AIRestorePanelRegistration.SLUG)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `AIRestorePanelContent` would. */
    private fun surfaceFor(state: UiState<*>): AIRestoreSurfaceState =
        aiRestoreSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
