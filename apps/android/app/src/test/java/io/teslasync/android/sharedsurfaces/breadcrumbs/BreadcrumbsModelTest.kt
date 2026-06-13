package io.teslasync.android.sharedsurfaces.breadcrumbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Breadcrumbs' pure logic — the native mirror of every decision the web
 * component makes (web/src/components/layout/Breadcrumbs.tsx): the degenerate-trail guard
 * (`items.length <= 1 -> null`), the link-vs-current-label branch (`isLast || !item.href`), the responsive
 * middle-collapse (`hidden sm:inline` / `sm:hidden …`), the blank-label fallback that keeps a crumb from ever
 * rendering as an empty box, and the resolved Home accessibility label. Because the composable is a thin render
 * layer over [classify], the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class BreadcrumbsModelTest {
    // ── Degenerate trail: the web `items.length <= 1 -> null` guard ───────────────────────────────────

    @Test
    fun classifyHidesAnEmptyOrSingleSegmentTrail() {
        assertFalse("empty trail is not shown (web returns null)", classify(emptyList(), false, FALLBACK).visible)
        assertFalse(
            "single-segment trail is not shown (web returns null)",
            classify(listOf(BreadcrumbItem("Vehicles", "/vehicles")), false, FALLBACK).visible,
        )
        assertTrue(classify(emptyList(), false, FALLBACK).crumbs.isEmpty())
    }

    @Test
    fun classifyShowsATrailOfTwoOrMore() {
        val render = classify(twoCrumbs(), false, FALLBACK)
        assertTrue(render.visible)
        assertEquals(2, render.crumbs.size)
    }

    // ── Role: link (non-last with href) vs current label (last, or no href) ───────────────────────────

    @Test
    fun classifyMarksNonLastEntriesWithAnHrefAsLinks() {
        val render = classify(threeCrumbs(), compact = false, blankLabelFallback = FALLBACK)
        assertEquals(CrumbRole.Link, render.crumbs[0].role)
        assertEquals("/vehicles", render.crumbs[0].href)
        assertEquals(CrumbRole.Link, render.crumbs[1].role)
        assertEquals("/vehicles/1", render.crumbs[1].href)
    }

    @Test
    fun classifyMarksTheLastEntryAsTheCurrentPageWithNoHref() {
        val render = classify(threeCrumbs(), compact = false, blankLabelFallback = FALLBACK)
        val last = render.crumbs.last()
        assertEquals(CrumbRole.Current, last.role)
        assertTrue(last.isLast)
        assertNull("the current page is not a navigation target", last.href)
    }

    @Test
    fun classifyMarksAnEntryWithoutAnHrefAsCurrentEvenWhenNotLast() {
        // web `isLast || !item.href` -> a hrefless middle entry is a plain span, not a link.
        val items =
            listOf(
                BreadcrumbItem("Vehicles", "/vehicles"),
                BreadcrumbItem("Model 3"),
                BreadcrumbItem("Battery"),
            )
        val middle = classify(items, compact = false, blankLabelFallback = FALLBACK).crumbs[1]
        assertEquals(CrumbRole.Current, middle.role)
        assertNull(middle.href)
        assertFalse(middle.isLast)
    }

    @Test
    fun classifyTreatsABlankHrefAsNoLink() {
        val items = listOf(BreadcrumbItem("Vehicles", "   "), BreadcrumbItem("Battery"))
        val first = classify(items, compact = false, blankLabelFallback = FALLBACK).crumbs.first()
        assertEquals(CrumbRole.Current, first.role)
        assertNull(first.href)
    }

    // ── Responsive middle-collapse (web `hidden sm:inline` / `sm:hidden …`) ────────────────────────────

    @Test
    fun classifyCollapsesOnlyMiddleEntriesWhenCompact() {
        val crumbs = classify(threeCrumbs(), compact = true, blankLabelFallback = FALLBACK).crumbs
        // first (index 0) never collapses
        assertTrue(crumbs[0].showLabel)
        assertFalse(crumbs[0].showEllipsis)
        // middle (index 1) collapses to the ellipsis indicator
        assertFalse("middle label is hidden on compact", crumbs[1].showLabel)
        assertTrue("middle shows the collapsed indicator on compact", crumbs[1].showEllipsis)
        assertTrue(crumbs[1].isMiddle)
        // last (index 2) never collapses
        assertTrue(crumbs[2].showLabel)
        assertFalse(crumbs[2].showEllipsis)
    }

    @Test
    fun classifyShowsEveryLabelWhenNotCompact() {
        val crumbs = classify(threeCrumbs(), compact = false, blankLabelFallback = FALLBACK).crumbs
        assertTrue(crumbs.all { it.showLabel })
        assertTrue(crumbs.none { it.showEllipsis })
    }

    // ── Blank-label fallback: never a blank box ───────────────────────────────────────────────────────

    @Test
    fun classifyReplacesABlankLabelWithTheLocalizedFallback() {
        val items = listOf(BreadcrumbItem("Vehicles", "/vehicles"), BreadcrumbItem("   "))
        val last = classify(items, compact = false, blankLabelFallback = FALLBACK).crumbs.last()
        assertEquals(FALLBACK, last.label)
    }

    // ── Home accessibility label (web `homeAriaLabel ?? t('a11y.breadcrumbHome')`) ─────────────────────

    @Test
    fun resolveHomeAriaLabelPrefersTheExplicitOverrideThenTheFallback() {
        assertEquals("Fleet home", resolveHomeAriaLabel("Fleet home", HOME_FALLBACK))
        assertEquals(HOME_FALLBACK, resolveHomeAriaLabel(null, HOME_FALLBACK))
        assertEquals(HOME_FALLBACK, resolveHomeAriaLabel("   ", HOME_FALLBACK))
    }

    private fun twoCrumbs() = listOf(BreadcrumbItem("Charging", "/charging"), BreadcrumbItem("Session 42"))

    private fun threeCrumbs() =
        listOf(
            BreadcrumbItem("Vehicles", "/vehicles"),
            BreadcrumbItem("Model 3", "/vehicles/1"),
            BreadcrumbItem("Battery"),
        )

    private companion object {
        private const val FALLBACK = "No data available"
        private const val HOME_FALLBACK = "Dashboard"
    }
}
