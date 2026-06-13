// Off-device unit tests for the AIFeatureCard model + projection (the :android:testReleaseUnitTest gate). These
// cover the framework-free core the composable renders: the i18n key folding + fallback parity that backs every
// accessible label (web `t(key, default)`), the action label / accessible-name / enabled rules (web's "Ask
// Helix" CTA + `aria-label` + `disabled`), the button-placement coercion (web `inputSlot` ⇒ below), and the
// every-state output projection (loading / empty / content / error / stale / offline) reproducing the
// AiOutputPanel branches plus the prompt's mandated stale + offline overlays. The composable is a thin render
// layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIFeatureCardModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_helix_askHelix", foldCatalogKey(AIFeatureCardKeys.ASK_HELIX))
        assertEquals("translation_helix_thinking", foldCatalogKey(AIFeatureCardKeys.THINKING))
        assertEquals("translation_helix_badge", foldCatalogKey(AIFeatureCardKeys.BADGE))
        // Lifecycle-chrome keys that ARE present in the generated catalog.
        assertEquals("translation_common_offline", foldCatalogKey(AIFeatureCardKeys.OFFLINE))
        assertEquals("translation_common_retry", foldCatalogKey(AIFeatureCardKeys.RETRY))
        assertEquals(
            "translation_error_network_offlineDetail",
            foldCatalogKey(AIFeatureCardKeys.OFFLINE_DETAIL),
        )
        assertEquals("translation_ai_common_errorUnknown", foldCatalogKey(AIFeatureCardKeys.ERROR_UNKNOWN))
    }

    @Test
    fun chrome_resolvesToWebEnglishViaFallback() {
        val chrome = aiFeatureCardChrome(FallbackResolver)
        assertEquals("Helix", chrome.badge)
        assertEquals("Helix", chrome.badgeAria)
        assertEquals(
            "Helix is your AI assistant. It generates responses using your redacted fleet context.",
            chrome.badgeTooltip,
        )
        assertEquals("Ask Helix", chrome.askHelix)
        assertEquals("Helix is thinking\u2026", chrome.thinking)
        assertEquals("Helix is refreshing\u2026", chrome.refreshing)
        assertEquals("Helix error:", chrome.errorLabel)
        assertEquals("unknown", chrome.errorUnknown)
        assertEquals("Offline", chrome.offline)
        assertEquals("We'll retry automatically when your connection returns.", chrome.offlineDetail)
        assertEquals("Retry", chrome.retry)
    }

    @Test
    fun chrome_consultsCatalogForPresentKeysAndFallsBackForBrandKeys() {
        val catalog =
            mapOf(
                AIFeatureCardKeys.OFFLINE to "Sin conexión",
                AIFeatureCardKeys.RETRY to "Reintentar",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val chrome = aiFeatureCardChrome(resolve)
        assertEquals("Sin conexión", chrome.offline)
        assertEquals("Reintentar", chrome.retry)
        // A brand key absent from the catalog still falls back to the web English.
        assertEquals("Ask Helix", chrome.askHelix)
    }

    @Test
    fun allChromeLabels_areNonBlank() {
        val chrome = aiFeatureCardChrome(FallbackResolver)
        listOf(
            chrome.badge,
            chrome.badgeAria,
            chrome.badgeTooltip,
            chrome.askHelix,
            chrome.thinking,
            chrome.refreshing,
            chrome.errorLabel,
            chrome.errorUnknown,
            chrome.emptyOutput,
            chrome.offline,
            chrome.offlineDetail,
            chrome.retry,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── action label / accessible name / enabled (web Ask-Helix CTA) ──────────────────────────────────────

    @Test
    fun actionContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix \u00b7 Summarize drive", actionContentDescription("Ask Helix", "Summarize drive"))
    }

    @Test
    fun actionLabel_flipsToThinkingWhileStreaming() {
        assertEquals("Ask Helix", actionLabel(AiStreamPhase.Idle, "Ask Helix", "Helix is thinking\u2026"))
        assertEquals("Ask Helix", actionLabel(AiStreamPhase.Done, "Ask Helix", "Helix is thinking\u2026"))
        assertEquals(
            "Helix is thinking\u2026",
            actionLabel(AiStreamPhase.Streaming, "Ask Helix", "Helix is thinking\u2026"),
        )
    }

    @Test
    fun actionEnabled_mirrorsWebDisabledRuleExtendedWithConnectivity() {
        // Enabled only when ready, online, and not already streaming.
        assertTrue(actionEnabled(canStart = true, online = true, phase = AiStreamPhase.Idle))
        assertTrue(actionEnabled(canStart = true, online = true, phase = AiStreamPhase.Done))
        // Paused-confirm is not "streaming", so the action stays available (web `isStreaming` is false there).
        assertTrue(actionEnabled(canStart = true, online = true, phase = AiStreamPhase.PausedConfirm))
        assertFalse(actionEnabled(canStart = false, online = true, phase = AiStreamPhase.Idle))
        assertFalse(actionEnabled(canStart = true, online = false, phase = AiStreamPhase.Idle))
        assertFalse(actionEnabled(canStart = true, online = true, phase = AiStreamPhase.Streaming))
    }

    // ── placement coercion (web inputSlot ⇒ below) ────────────────────────────────────────────────────────

    @Test
    fun effectivePlacement_coercesToBelowWhenInputSlotPresent() {
        assertEquals(ButtonPlacement.Inline, effectivePlacement(ButtonPlacement.Inline, hasInputSlot = false))
        assertEquals(ButtonPlacement.Below, effectivePlacement(ButtonPlacement.Below, hasInputSlot = false))
        assertEquals(ButtonPlacement.Below, effectivePlacement(ButtonPlacement.Inline, hasInputSlot = true))
    }

    @Test
    fun aiFeatureStream_hasTextReflectsAccumulatedDelta() {
        assertFalse(AiFeatureStream().hasText)
        assertFalse(AiFeatureStream(text = "").hasText)
        assertTrue(AiFeatureStream(text = "x").hasText)
    }

    // ── output-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun surface_hiddenWhenIdleNoText() {
        assertEquals(
            AiOutputSurface.Hidden,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Idle, hasText = false),
        )
        // paused-confirm with no text is also not rendered (web AiOutputPanel `hasAnything` excludes it).
        assertEquals(
            AiOutputSurface.Hidden,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.PausedConfirm, hasText = false),
        )
    }

    @Test
    fun surface_thinkingWhenStreamingNoText() {
        assertEquals(
            AiOutputSurface.Thinking,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Streaming, hasText = false),
        )
    }

    @Test
    fun surface_staleWhenStreamingOverText() {
        assertEquals(
            AiOutputSurface.Stale,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Streaming, hasText = true),
        )
    }

    @Test
    fun surface_contentWhenTextPresentOrDone() {
        assertEquals(
            AiOutputSurface.Content,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Done, hasText = true),
        )
        // done with no token still renders the panel (web renders the empty `done` panel).
        assertEquals(
            AiOutputSurface.Content,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Done, hasText = false),
        )
        // paused-confirm with captured text shows that text.
        assertEquals(
            AiOutputSurface.Content,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.PausedConfirm, hasText = true),
        )
    }

    @Test
    fun surface_errorWhenStreamErrored() {
        assertEquals(
            AiOutputSurface.Error,
            aiOutputSurfaceFor(online = true, phase = AiStreamPhase.Error, hasText = false),
        )
    }

    @Test
    fun surface_offlineWinsOverEveryOtherState() {
        assertEquals(
            AiOutputSurface.Offline,
            aiOutputSurfaceFor(online = false, phase = AiStreamPhase.Idle, hasText = false),
        )
        assertEquals(
            AiOutputSurface.Offline,
            aiOutputSurfaceFor(online = false, phase = AiStreamPhase.Error, hasText = true),
        )
        assertEquals(
            AiOutputSurface.Offline,
            aiOutputSurfaceFor(online = false, phase = AiStreamPhase.Done, hasText = true),
        )
    }

    @Test
    fun project_emptyReadyWhenIdle() {
        val snapshot = projectAiFeatureCard(AiFeatureStream(), canStart = true, online = true)
        assertEquals(AiOutputSurface.Hidden, snapshot.surface)
        assertTrue(snapshot.canStart)
        assertTrue(snapshot.actionEnabled)
        assertFalse(snapshot.busy)
        assertFalse(snapshot.stale)
    }

    @Test
    fun project_loadingWhenStreamingNoText() {
        val snapshot =
            projectAiFeatureCard(AiFeatureStream(phase = AiStreamPhase.Streaming), canStart = true, online = true)
        assertEquals(AiOutputSurface.Thinking, snapshot.surface)
        assertTrue(snapshot.busy)
        assertFalse(snapshot.actionEnabled)
    }

    @Test
    fun project_staleWhenStreamingOverLastText() {
        val snapshot =
            projectAiFeatureCard(
                AiFeatureStream(phase = AiStreamPhase.Streaming, text = "partial"),
                canStart = true,
                online = true,
            )
        assertEquals(AiOutputSurface.Stale, snapshot.surface)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.busy)
    }

    @Test
    fun project_errorRetainsMessageAndStaysStartable() {
        val snapshot =
            projectAiFeatureCard(
                AiFeatureStream(phase = AiStreamPhase.Error, error = "stream_http_503"),
                canStart = true,
                online = true,
            )
        assertEquals(AiOutputSurface.Error, snapshot.surface)
        assertEquals("stream_http_503", snapshot.error)
        assertTrue(snapshot.actionEnabled)
    }

    @Test
    fun project_offlineKeepsLastTextFlaggedStaleAndDisablesAction() {
        val snapshot =
            projectAiFeatureCard(
                AiFeatureStream(phase = AiStreamPhase.Done, text = "cached"),
                canStart = true,
                online = false,
            )
        assertEquals(AiOutputSurface.Offline, snapshot.surface)
        assertEquals("cached", snapshot.text)
        assertTrue(snapshot.stale)
        assertFalse(snapshot.actionEnabled)
    }

    @Test
    fun project_actionDisabledWhenNotReady() {
        assertFalse(projectAiFeatureCard(AiFeatureStream(), canStart = false, online = true).actionEnabled)
    }

    // ── error message + merged TalkBack announcement (a11y) ───────────────────────────────────────────────

    @Test
    fun outputErrorMessage_fallsBackToUnknown() {
        val chrome = aiFeatureCardChrome(FallbackResolver)
        assertEquals("stream_http_500", outputErrorMessage("stream_http_500", chrome))
        assertEquals("unknown", outputErrorMessage(null, chrome))
        assertEquals("unknown", outputErrorMessage("   ", chrome))
    }

    @Test
    fun outputAnnouncement_coversEverySurface() {
        val chrome = aiFeatureCardChrome(FallbackResolver)
        assertEquals("", outputAnnouncement(snapshotFor(AiOutputSurface.Hidden), chrome))
        assertEquals(chrome.thinking, outputAnnouncement(snapshotFor(AiOutputSurface.Thinking), chrome))
        assertEquals(
            "${chrome.refreshing} partial",
            outputAnnouncement(snapshotFor(AiOutputSurface.Stale, text = "partial"), chrome),
        )
        assertEquals(chrome.refreshing, outputAnnouncement(snapshotFor(AiOutputSurface.Stale), chrome))
        assertEquals("done", outputAnnouncement(snapshotFor(AiOutputSurface.Content, text = "done"), chrome))
        assertEquals(chrome.emptyOutput, outputAnnouncement(snapshotFor(AiOutputSurface.Content), chrome))
        assertEquals(
            "Helix error: boom",
            outputAnnouncement(snapshotFor(AiOutputSurface.Error, error = "boom"), chrome),
        )
        assertEquals(
            "Offline. ${chrome.offlineDetail}",
            outputAnnouncement(snapshotFor(AiOutputSurface.Offline), chrome),
        )
        assertEquals(
            "Offline. cached",
            outputAnnouncement(snapshotFor(AiOutputSurface.Offline, text = "cached"), chrome),
        )
    }

    // ── view.opened diagnostic (P1/S11) ──────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsSlugOnly() {
        val logger = RecordingLogger()
        recordAIFeatureCardViewOpened(logger)
        assertEquals(1, logger.events.size)
        val (event, fields) = logger.events.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AIFeatureCard"), fields)
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun snapshotFor(
        surface: AiOutputSurface,
        text: String = "",
        error: String? = null,
    ): AiFeatureCardSnapshot =
        AiFeatureCardSnapshot(
            surface = surface,
            phase = AiStreamPhase.Idle,
            text = text,
            error = error,
            canStart = true,
            actionEnabled = true,
            busy = false,
            online = surface != AiOutputSurface.Offline,
            stale = surface == AiOutputSurface.Stale,
        )
}
