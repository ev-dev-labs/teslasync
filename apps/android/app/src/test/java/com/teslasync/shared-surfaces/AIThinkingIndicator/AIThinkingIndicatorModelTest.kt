// Off-device unit coverage for the AIThinkingIndicator surface's pure model (P3 acceptance: adapter + per-state
// + a11y/diagnostics tests). Exercises the prompt-mandated surface slug, the label-resolution port that mirrors
// the web `label ?? t('helix.thinking', …)`, the fixed skeleton-line + dot geometry the web encodes (widths
// full / 11-12 / 9-12 and the staggered offsets), the reduced-motion projection that gates the bounce + shimmer
// (web `motion-safe:`), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs
// in :android:testReleaseUnitTest. Reference values are the data + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIThinkingIndicatorModelTest {
    private companion object {
        const val FRACTION_DELTA = 0.0001f
        const val DEFAULT_LABEL = "Helix is thinking…"
    }

    // ── registration metadata mirrors the prompt-mandated surface slug + i18n provenance ───

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("AIThinkingIndicator", AI_THINKING_INDICATOR_SLUG)
    }

    @Test
    fun defaultLabelProvenanceIsTheCatalogChatbotThinkingKey() {
        // The web default `t('helix.thinking', …)` falls back to the catalog's canonical "Helix is thinking…"
        // entry (web `chatbot.thinking`); the composable binds R.string.translation_chatbot_thinking to match.
        assertEquals("chatbot.thinking", DEFAULT_LABEL_CATALOG_KEY)
    }

    // ── label resolution (web `label ?? t('helix.thinking', …)`) ───────────────────────────

    @Test
    fun resolveLabelFallsBackToDefaultWhenNoOverride() {
        assertEquals(DEFAULT_LABEL, resolveThinkingLabel(override = null, default = DEFAULT_LABEL))
    }

    @Test
    fun resolveLabelPrefersACallerOverride() {
        assertEquals(
            "Helix is summarising",
            resolveThinkingLabel(override = "Helix is summarising", default = DEFAULT_LABEL),
        )
    }

    @Test
    fun resolveLabelPassesAnEmptyOverrideThroughLikeWebNullish() {
        // Web `??` only substitutes on null/undefined, so an explicit empty string is the caller's choice.
        assertEquals("", resolveThinkingLabel(override = "", default = DEFAULT_LABEL))
    }

    // ── fixed geometry: three decreasing lines + three rippling dots ───────────────────────

    @Test
    fun skeletonLinesAreThreeDecreasingWidthsWithStaggeredShimmer() {
        val lines = thinkingSkeletonLines()
        assertEquals(3, lines.size)
        assertEquals(1f, lines[0].widthFraction, FRACTION_DELTA)
        assertEquals(11f / 12f, lines[1].widthFraction, FRACTION_DELTA)
        assertEquals(9f / 12f, lines[2].widthFraction, FRACTION_DELTA)
        // Each line trails the previous by one stagger step (web `[animation-delay:0.3s]` / `0.6s`).
        assertEquals(0, lines[0].animationDelayMs)
        assertEquals(SKELETON_LINE_STAGGER_MS, lines[1].animationDelayMs)
        assertEquals(2 * SKELETON_LINE_STAGGER_MS, lines[2].animationDelayMs)
    }

    @Test
    fun dotsAreThreeWithAscendingRippleOffsets() {
        val dots = thinkingDots()
        assertEquals(THINKING_DOT_COUNT, dots.size)
        assertEquals(0, dots[0].animationDelayMs)
        assertEquals(THINKING_DOT_STAGGER_MS, dots[1].animationDelayMs)
        assertEquals(2 * THINKING_DOT_STAGGER_MS, dots[2].animationDelayMs)
    }

    // ── projection: motion gating + label threading (web `motion-safe:`) ───────────────────

    @Test
    fun fullMotionProjectionAnimatesAndCarriesTheResolvedLabel() {
        val projection =
            projectThinkingIndicator(
                state = ThinkingIndicatorState(reducedMotion = false),
                labelOverride = null,
                defaultLabel = DEFAULT_LABEL,
            )
        assertTrue(projection.animated)
        assertEquals(DEFAULT_LABEL, projection.label)
        assertEquals(thinkingSkeletonLines(), projection.lines)
        assertEquals(thinkingDots(), projection.dots)
    }

    @Test
    fun reducedMotionProjectionFreezesButKeepsTheStaticGeometry() {
        val projection =
            projectThinkingIndicator(
                state = ThinkingIndicatorState(reducedMotion = true),
                labelOverride = "Helix is summarising",
                defaultLabel = DEFAULT_LABEL,
            )
        // The skeleton stays visible (the lines are still projected); only the animation is suppressed.
        assertFalse(projection.animated)
        assertEquals("Helix is summarising", projection.label)
        assertEquals(3, projection.lines.size)
        assertEquals(THINKING_DOT_COUNT, projection.dots.size)
    }

    @Test
    fun compactDotsProjectionGatesMotionOnTheReducedFlag() {
        assertTrue(projectThinkingDots(reducedMotion = false).animated)
        assertFalse(projectThinkingDots(reducedMotion = true).animated)
        assertEquals(THINKING_DOT_COUNT, projectThinkingDots(reducedMotion = true).dots.size)
    }

    // ── diagnostics: one PII-safe view.opened ──────────────────────────────────────────────

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
        recordThinkingIndicatorOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no label text or model output can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AIThinkingIndicator"), records[0].fields)
    }
}
