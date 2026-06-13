package io.teslasync.android.sharedsurfaces.sectionerrorboundary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SectionErrorBoundary's pure logic — the native mirror of every decision the
 * web component makes (web/src/components/feedback/SectionErrorBoundary.tsx): the three-way fallback branch
 * (custom / title / inline), which branch offers Retry, the inline detail line that never renders empty, the
 * merged TalkBack announcement, and the PII-safe error type. Because the composable is a thin render layer over
 * [classifyFallback], the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SectionErrorBoundaryModelTest {
    // ── classifyFallback: the per-state snapshot (web fallback / fallbackTitle / inline precedence) ──────

    @Test
    fun classifyPrefersACustomFallbackOverEverything() {
        // web: `if (fallback !== undefined)` wins before `fallbackTitle`.
        assertEquals(SectionFallbackKind.Custom, classifyFallback(hasCustomFallback = true, fallbackTitle = "Title"))
        assertEquals(SectionFallbackKind.Custom, classifyFallback(hasCustomFallback = true, fallbackTitle = null))
    }

    @Test
    fun classifySelectsTheTitleCardForANonBlankFallbackTitle() {
        assertEquals(
            SectionFallbackKind.Title,
            classifyFallback(hasCustomFallback = false, fallbackTitle = "Chart failed"),
        )
    }

    @Test
    fun classifyFallsToInlineWhenNoCustomAndTheTitleIsBlank() {
        // web: an empty `fallbackTitle` is falsy, so it falls through to the inline boundary.
        assertEquals(SectionFallbackKind.Inline, classifyFallback(hasCustomFallback = false, fallbackTitle = null))
        assertEquals(SectionFallbackKind.Inline, classifyFallback(hasCustomFallback = false, fallbackTitle = ""))
        assertEquals(SectionFallbackKind.Inline, classifyFallback(hasCustomFallback = false, fallbackTitle = "   "))
    }

    // ── showsRetry: only the inline default offers Retry (web `inline`; the other two render no button) ──

    @Test
    fun onlyTheInlineDefaultOffersRetry() {
        assertTrue(SectionFallbackKind.Inline.showsRetry)
        assertFalse(SectionFallbackKind.Custom.showsRetry)
        assertFalse(SectionFallbackKind.Title.showsRetry)
    }

    // ── inlineDetail: the captured message, else the subtitle — never empty (web `{error.message}`) ──────

    @Test
    fun inlineDetailShowsTheCapturedMessageWhenPresent() {
        assertEquals("render blew up", inlineDetail("render blew up", SUBTITLE))
        assertEquals("render blew up", inlineDetail("  render blew up  ", SUBTITLE))
    }

    @Test
    fun inlineDetailFallsBackToTheSubtitleForABlankMessage() {
        assertEquals(SUBTITLE, inlineDetail(null, SUBTITLE))
        assertEquals(SUBTITLE, inlineDetail("", SUBTITLE))
        assertEquals(SUBTITLE, inlineDetail("   ", SUBTITLE))
    }

    // ── accessibility label (merged TalkBack announcement, web `role="alert"`) ──────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndDetail() {
        assertEquals(
            "This section failed to load. render blew up",
            boundaryAccessibilityLabel("This section failed to load", "render blew up", SUBTITLE),
        )
    }

    @Test
    fun accessibilityLabelSkipsTheMissingPart() {
        assertEquals("Only the title", boundaryAccessibilityLabel("Only the title", "   ", SUBTITLE))
        assertEquals("Only the detail", boundaryAccessibilityLabel(null, "Only the detail", SUBTITLE))
    }

    @Test
    fun accessibilityLabelAnnouncesTheFallbackWhenEverythingIsBlank() {
        // The alert region is never silent — a blank card still announces the localized fallback.
        assertEquals(SUBTITLE, boundaryAccessibilityLabel(null, null, SUBTITLE))
        assertEquals(SUBTITLE, boundaryAccessibilityLabel("  ", "  ", SUBTITLE))
    }

    // ── errorTypeOf: the PII-safe class name, never the message (web logs message; native must not) ──────

    @Test
    fun errorTypeIsThePiiSafeClassNameNeverTheMessage() {
        val labelled = errorTypeOf(IllegalStateException("leaked detail 5YJ"))
        assertEquals("IllegalStateException", labelled)
        assertFalse("the message must never leak into the type label", labelled.contains("leaked"))
        assertEquals("RuntimeException", errorTypeOf(RuntimeException()))
    }

    @Test
    fun errorTypeOfAnAnonymousThrowableFallsBackToTheStableConstant() {
        val anonymous = object : Throwable() {}
        assertEquals(UNKNOWN_ERROR_TYPE, errorTypeOf(anonymous))
    }

    private companion object {
        private const val SUBTITLE = "Other parts of the page should still work."
    }
}
