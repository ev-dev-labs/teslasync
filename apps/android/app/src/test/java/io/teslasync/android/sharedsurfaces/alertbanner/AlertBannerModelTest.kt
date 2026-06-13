package io.teslasync.android.sharedsurfaces.alertbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AlertBanner's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/feedback/AlertBanner.tsx): the `variant` selection, the prop-driven render
 * branches (title / body / icon / dismiss), the empty-body fallback that keeps the surface from ever painting a
 * blank box, and the merged TalkBack announcement. Because the composable is a thin render layer over
 * [classify], the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class AlertBannerModelTest {
    // ── variant taxonomy (web `variant` union) ───────────────────────────────────────────────────────

    @Test
    fun variantFromWireParsesEveryKnownVariant() {
        assertEquals(AlertVariant.Info, variantFromWire("info"))
        assertEquals(AlertVariant.Success, variantFromWire("success"))
        assertEquals(AlertVariant.Warning, variantFromWire("warning"))
        assertEquals(AlertVariant.Danger, variantFromWire("danger"))
    }

    @Test
    fun variantFromWireFallsBackToInfoForUnknownOrAbsent() {
        // A forward-compatible client renders the lowest-severity informational treatment for anything new.
        assertEquals(AlertVariant.Info, variantFromWire(null))
        assertEquals(AlertVariant.Info, variantFromWire(""))
        assertEquals(AlertVariant.Info, variantFromWire("critical"))
        assertEquals(AlertVariant.Info, variantFromWire("Success")) // case-sensitive, like the web union
    }

    // ── classify: the per-state snapshot (variant × prop branches) ───────────────────────────────────

    @Test
    fun classifyPassesEverySeverityVariantThrough() {
        AlertVariant.entries.forEach { variant ->
            val render = classify(AlertBannerInput(variant = variant, title = "T", message = "B"))
            assertEquals(variant, render.variant)
        }
    }

    @Test
    fun classifyShowsTitleOnlyWhenNonBlank() {
        assertTrue(classify(AlertBannerInput(title = "Heads up")).showTitle)
        assertFalse(classify(AlertBannerInput(title = null)).showTitle)
        assertFalse(classify(AlertBannerInput(title = "   ")).showTitle)
    }

    @Test
    fun classifyShowsBodyForAMessageOrASlot() {
        assertTrue("a message is a body", classify(AlertBannerInput(message = "Body")).showBody)
        assertTrue("a slot is a body", classify(AlertBannerInput(message = null, hasSlotContent = true)).showBody)
    }

    @Test
    fun classifyFlagsAnEmptyBodyForTheFallbackInsteadOfABlankBox() {
        val empty = classify(AlertBannerInput(message = null, hasSlotContent = false))
        assertFalse(empty.showBody)
        assertTrue("never a blank box — the view shows the localized caption", empty.showEmptyFallback)

        val blankMessage = classify(AlertBannerInput(message = "   ", hasSlotContent = false))
        assertFalse("a blank message is not a body", blankMessage.showBody)
        assertTrue(blankMessage.showEmptyFallback)
    }

    @Test
    fun classifyMirrorsIconAndDismissAffordances() {
        assertTrue(classify(AlertBannerInput(hasIcon = true)).showIcon)
        assertFalse(classify(AlertBannerInput(hasIcon = false)).showIcon)
        assertTrue(classify(AlertBannerInput(dismissible = true)).dismissible)
        assertFalse(classify(AlertBannerInput(dismissible = false)).dismissible)
    }

    // ── accessibility label (merged TalkBack announcement) ───────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndBody() {
        assertEquals(
            "Tesla connection expired. Reconnect to resume.",
            bannerAccessibilityLabel("Tesla connection expired", "Reconnect to resume.", EMPTY_FALLBACK),
        )
    }

    @Test
    fun accessibilityLabelSkipsTheMissingPart() {
        assertEquals("Body only", bannerAccessibilityLabel(null, "Body only", EMPTY_FALLBACK))
        assertEquals("Title only", bannerAccessibilityLabel("Title only", "   ", EMPTY_FALLBACK))
    }

    @Test
    fun accessibilityLabelAnnouncesTheFallbackWhenEverythingIsBlank() {
        // The region is never silent — a blank notice still announces the localized fallback.
        assertEquals(EMPTY_FALLBACK, bannerAccessibilityLabel(null, null, EMPTY_FALLBACK))
        assertEquals(EMPTY_FALLBACK, bannerAccessibilityLabel("  ", "  ", EMPTY_FALLBACK))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────

    private companion object {
        private const val EMPTY_FALLBACK = "No data available"
    }
}
