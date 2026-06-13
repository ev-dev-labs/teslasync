package io.teslasync.android.sharedsurfaces.pagecontainer

import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PageContainer pure model — the native mirror of every decision the web
 * `PageContainer` makes between its props and the rendered chrome (web/src/components/layout/PageContainer.tsx):
 * the body ladder (loading > error > empty > content), the `pickWorstQuery` freshness fold, the trailing-cluster
 * guard, the empty / error message fallbacks, and the breadcrumb-overrides merge. Because the composable is a
 * thin render layer over these functions, the per-branch assertions here double as the surface's per-state
 * snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class PageContainerModelTest {
    private fun snap(
        fetching: Boolean = false,
        stale: Boolean = false,
        hardError: Boolean = false,
        offline: Boolean = false,
        updatedAtMs: Long = BASE,
    ): FreshnessSnapshot =
        FreshnessSnapshot(
            updatedAtMs = updatedAtMs,
            fetching = fetching,
            stale = stale,
            hardError = hardError,
            offline = offline,
            hasData = !hardError,
            empty = false,
        )

    // ── classifyPageBody: web precedence loading > error > empty > content ─────────────────────────────

    @Test
    fun bodyFollowsTheWebPrecedence() {
        assertEquals("loading wins over everything", PageBodyState.Loading, classifyPageBody(true, true, true))
        assertEquals("error beats empty", PageBodyState.Error, classifyPageBody(false, true, true))
        assertEquals(PageBodyState.Empty, classifyPageBody(false, false, true))
        assertEquals(PageBodyState.Content, classifyPageBody(false, false, false))
    }

    // ── pickWorstFreshness / freshnessSeverity: web pickWorstQuery (error > stale > fetching > fresh) ──

    @Test
    fun pickWorstOnEmptyListIsNull() {
        assertNull("an empty query array is the same as no chip (web resolvedQuery)", pickWorstFreshness(emptyList()))
    }

    @Test
    fun pickWorstOfOneIsItself() {
        val only = snap(stale = true)
        assertEquals(only, pickWorstFreshness(listOf(only)))
    }

    @Test
    fun pickWorstSurfacesTheMostDegradedTier() {
        val fresh = snap()
        val fetching = snap(fetching = true)
        val stale = snap(stale = true)
        val offline = snap(offline = true)
        val hard = snap(hardError = true)
        assertEquals(hard, pickWorstFreshness(listOf(fresh, fetching, stale, offline, hard)))
        assertEquals(offline, pickWorstFreshness(listOf(fresh, fetching, stale, offline)))
        assertEquals(stale, pickWorstFreshness(listOf(fresh, fetching, stale)))
        assertEquals(fetching, pickWorstFreshness(listOf(fresh, fetching)))
        assertEquals(fresh, pickWorstFreshness(listOf(fresh)))
    }

    @Test
    fun pickWorstKeepsTheFirstAtTheWorstTier() {
        val first = snap(stale = true, updatedAtMs = 1L)
        val second = snap(stale = true, updatedAtMs = 2L)
        assertSame("web pickWorstQuery keeps the first strictly-greater rank", first, pickWorstFreshness(listOf(first, second)))
    }

    @Test
    fun severityMapsEachTierWithTheErrorSplit() {
        assertEquals(FreshnessSeverity.HardError, freshnessSeverity(snap(hardError = true)))
        assertEquals(FreshnessSeverity.Offline, freshnessSeverity(snap(offline = true)))
        assertEquals(FreshnessSeverity.Stale, freshnessSeverity(snap(stale = true)))
        assertEquals(FreshnessSeverity.Fetching, freshnessSeverity(snap(fetching = true)))
        assertEquals(FreshnessSeverity.Fresh, freshnessSeverity(snap()))
        assertEquals(
            "a hard error outranks an offline cache",
            FreshnessSeverity.HardError,
            freshnessSeverity(snap(hardError = true, offline = true)),
        )
    }

    // ── pageHasTrailingCluster: web (actions || copyLink || resolvedQuery) ─────────────────────────────

    @Test
    fun trailingClusterShowsWhenAnyTrailingItemExists() {
        assertFalse(pageHasTrailingCluster(hasActions = false, hasCopyLink = false, hasFreshness = false))
        assertTrue(pageHasTrailingCluster(hasActions = true, hasCopyLink = false, hasFreshness = false))
        assertTrue(pageHasTrailingCluster(hasActions = false, hasCopyLink = true, hasFreshness = false))
        assertTrue(pageHasTrailingCluster(hasActions = false, hasCopyLink = false, hasFreshness = true))
    }

    // ── pageEmptyMessage / pageErrorMessage: web emptyMessage ?? … and {error.message} ────────────────

    @Test
    fun emptyMessageUsesCustomThenFallback() {
        assertEquals("Custom", pageEmptyMessage("Custom", "Fallback"))
        assertEquals("Fallback", pageEmptyMessage(null, "Fallback"))
        assertEquals("a blank custom message degrades to the fallback", "Fallback", pageEmptyMessage("   ", "Fallback"))
    }

    @Test
    fun errorMessageUsesThrowableMessageThenFallback() {
        assertEquals("Boom", pageErrorMessage("Boom", "Fallback"))
        assertEquals("Fallback", pageErrorMessage(null, "Fallback"))
        assertEquals("Fallback", pageErrorMessage("", "Fallback"))
    }

    // ── mergeBreadcrumbOverrides: later owners win per route key ───────────────────────────────────────

    @Test
    fun mergeLetsLaterOwnersWinPerKey() {
        val merged =
            mergeBreadcrumbOverrides(
                listOf(
                    mapOf("/drives/:id" to "Trip", "/charging/:id" to "Charge"),
                    mapOf("/drives/:id" to "Trip to office"),
                ),
            )
        assertEquals("Trip to office", merged["/drives/:id"])
        assertEquals("Charge", merged["/charging/:id"])
    }

    @Test
    fun mergeOfNothingIsEmpty() {
        assertEquals(emptyMap<String, String>(), mergeBreadcrumbOverrides(emptyList()))
    }

    private companion object {
        private const val BASE = 1_000_000_000_000L
    }
}
