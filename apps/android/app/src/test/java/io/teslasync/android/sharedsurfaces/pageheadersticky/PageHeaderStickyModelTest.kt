package io.teslasync.android.sharedsurfaces.pageheadersticky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PageHeaderSticky's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/layout/PageHeaderSticky.tsx), cross-checked against the web test suite
 * (web/src/components/layout/__tests__/PageHeaderSticky.test.tsx): the IntersectionObserver visibility decision
 * (`!isIntersecting && boundingClientRect.top < 0`) including the long-page guard, the LazyList-geometry
 * derivation that stands in for the observer, the prop-driven render branches (scroll-to-top / summary / empty
 * fallback), and the merged TalkBack announcement. Because the composable is a thin render layer over [classify]
 * and [stickyHeaderVisible], the per-branch assertions here double as the surface's per-state snapshot. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class PageHeaderStickyModelTest {
    // ── visibility decision (web `!entry.isIntersecting && entry.boundingClientRect.top < 0`) ─────────

    @Test
    fun hiddenAtRestWhenHeroFullyInView() {
        // web: "is hidden initially before any intersection event" — the hero is on screen, top >= 0.
        assertFalse(stickyHeaderVisible(StickyScrollSnapshot.atRest()))
        assertFalse(stickyHeaderVisible(StickyScrollSnapshot(heroIntersecting = true, heroAboveViewport = false)))
    }

    @Test
    fun visibleOnlyWhenHeroHasScrolledFullyAbove() {
        // web: "becomes visible when the target scrolls out of view" — not intersecting AND top < 0.
        assertTrue(stickyHeaderVisible(StickyScrollSnapshot(heroIntersecting = false, heroAboveViewport = true)))
    }

    @Test
    fun hiddenWhenHeroIsBelowViewportLongPageGuard() {
        // web: "stays hidden when the target is below the viewport" — not intersecting but top > 0 (not reached).
        assertFalse(stickyHeaderVisible(StickyScrollSnapshot(heroIntersecting = false, heroAboveViewport = false)))
    }

    @Test
    fun hiddenWhileHeroIsStillPartiallyIntersecting() {
        // A tall hero whose top has crossed above but is still partly on screen stays hidden (web isIntersecting).
        assertFalse(stickyHeaderVisible(StickyScrollSnapshot(heroIntersecting = true, heroAboveViewport = true)))
    }

    // ── LazyList-geometry derivation: the native IntersectionObserver stand-in ([snapshotFromHero]) ────

    @Test
    fun heroLaidOutAtOrBelowTriggerIsIntersectingAndNotAbove() {
        // Hero present in visibleItems with a non-negative offset → on screen, not scrolled past → hidden.
        val snap = snapshotFromHero(heroItemIndex = 0, firstVisibleItemIndex = 0, heroVisibleOffsetPx = 40)
        assertTrue(snap.heroIntersecting)
        assertFalse(snap.heroAboveViewport)
        assertFalse(stickyHeaderVisible(snap))
    }

    @Test
    fun heroScrolledFullyAboveBecomesVisible() {
        // Hero no longer laid out and the first visible item is past it → scrolled fully above → visible.
        val snap = snapshotFromHero(heroItemIndex = 0, firstVisibleItemIndex = 3, heroVisibleOffsetPx = null)
        assertFalse(snap.heroIntersecting)
        assertTrue(snap.heroAboveViewport)
        assertTrue(stickyHeaderVisible(snap))
    }

    @Test
    fun heroBelowViewportStaysHidden() {
        // Hero not yet laid out and the first visible item is before it → still below → hidden (long-page guard).
        val snap = snapshotFromHero(heroItemIndex = 4, firstVisibleItemIndex = 1, heroVisibleOffsetPx = null)
        assertFalse(snap.heroIntersecting)
        assertFalse(snap.heroAboveViewport)
        assertFalse(stickyHeaderVisible(snap))
    }

    @Test
    fun topOffsetMovesTheTriggerLine() {
        // With a 50 px top inset, a hero whose top sits at 20 px is "above" the trigger line (web rootMargin).
        val belowTrigger = snapshotFromHero(0, 0, heroVisibleOffsetPx = 20, topOffsetPx = 50)
        assertTrue(belowTrigger.heroAboveViewport)
        val atTop = snapshotFromHero(0, 0, heroVisibleOffsetPx = 60, topOffsetPx = 50)
        assertFalse(atTop.heroAboveViewport)
    }

    // ── classify: the per-state snapshot (visibility × affordance × body branches) ────────────────────

    @Test
    fun classifyPassesVisibilityThrough() {
        assertTrue(classify(PageHeaderStickyInput(visible = true)).visible)
        assertFalse(classify(PageHeaderStickyInput(visible = false)).visible)
    }

    @Test
    fun classifyMirrorsTheScrollToTopAffordance() {
        val withAffordance = classify(PageHeaderStickyInput(visible = true, scrollToTop = true, hasSummary = true))
        assertTrue(withAffordance.clickable)
        assertTrue(withAffordance.showScrollToTop)

        val plain = classify(PageHeaderStickyInput(visible = true, scrollToTop = false, hasSummary = true))
        assertFalse("web: no button when scrollToTop is false", plain.clickable)
        assertFalse(plain.showScrollToTop)
    }

    @Test
    fun classifyShowsTheSummaryBody() {
        val render = classify(PageHeaderStickyInput(visible = true, hasSummary = true))
        assertTrue(render.showSummary)
        assertFalse(render.showEmptyFallback)
    }

    @Test
    fun classifyLetsAnArbitrarySlotOverrideTheSummary() {
        val render = classify(PageHeaderStickyInput(visible = true, hasSummary = true, hasSlotContent = true))
        assertFalse("the slot (web children) wins over the flat summary", render.showSummary)
        assertFalse(render.showEmptyFallback)
    }

    @Test
    fun classifyFlagsAnEmptyBodyForTheFallbackInsteadOfABlankBar() {
        val render = classify(PageHeaderStickyInput(visible = true, hasSummary = false, hasSlotContent = false))
        assertFalse(render.showSummary)
        assertTrue("never a blank bar — the view shows the localized caption", render.showEmptyFallback)
    }

    // ── accessibility label (merged TalkBack announcement) ───────────────────────────────────────────

    @Test
    fun accessibilityLabelLeadsWithTheRegionNameThenTheBody() {
        assertEquals(
            "Drive history summary. Model Y · 4 drives",
            pageHeaderStickyLabel("Drive history summary", "Model Y · 4 drives"),
        )
    }

    @Test
    fun accessibilityLabelFallsBackToJustTheRegionNameWhenTheBodyIsBlank() {
        assertEquals("Drive history summary", pageHeaderStickyLabel("Drive history summary", null))
        assertEquals("Drive history summary", pageHeaderStickyLabel("Drive history summary", "   "))
    }
}
