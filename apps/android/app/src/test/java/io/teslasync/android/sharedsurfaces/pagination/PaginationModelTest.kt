package io.teslasync.android.sharedsurfaces.pagination

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Pagination surface's pure logic — the native mirror of every number the web
 * component derives before it paints its bar (web/src/components/ui/Pagination.tsx): the
 * `max(1, ceil(total / pageSize))` page count, the 1-based `start`/`end` window (with `start` shown as 0 when
 * the dataset is empty), and the `page <= 1` / `page >= totalPages` bound predicates that disable the jumps.
 * Because the composable is a thin render layer over [paginationProjection], the per-case assertions here double
 * as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class PaginationModelTest {
    // ── Empty dataset: a single page, "showing 0", every jump disabled (web `total > 0 ? start : 0`) ────────

    @Test
    fun emptyDatasetShowsZeroOnASinglePageWithEveryJumpDisabled() {
        val projection = paginationProjection(page = 1, pageSize = 25, total = 0)

        assertEquals(1, projection.totalPages)
        assertEquals(0, projection.showingStart)
        assertEquals(0, projection.showingEnd)
        assertTrue(projection.atStart)
        assertTrue(projection.atEnd)
    }

    // ── Single full page: start/end span the whole dataset; both ends are bounds ───────────────────────────

    @Test
    fun aSinglePartialPageSpansTheWholeDatasetAndIsBothBounds() {
        val projection = paginationProjection(page = 1, pageSize = 25, total = 20)

        assertEquals(1, projection.totalPages)
        assertEquals(1, projection.showingStart)
        assertEquals(20, projection.showingEnd)
        assertTrue(projection.atStart)
        assertTrue(projection.atEnd)
    }

    // ── First / middle / last of many: which button pairs disable (web `disabled` predicates) ──────────────

    @Test
    fun firstPageOfManyDisablesOnlyTheBackwardJumps() {
        val projection = paginationProjection(page = 1, pageSize = 25, total = 250)

        assertEquals(10, projection.totalPages)
        assertEquals(1, projection.showingStart)
        assertEquals(25, projection.showingEnd)
        assertTrue(projection.atStart)
        assertFalse(projection.atEnd)
    }

    @Test
    fun middlePageOfManyEnablesEveryJump() {
        val projection = paginationProjection(page = 3, pageSize = 25, total = 250)

        assertEquals(10, projection.totalPages)
        assertEquals(51, projection.showingStart)
        assertEquals(75, projection.showingEnd)
        assertFalse(projection.atStart)
        assertFalse(projection.atEnd)
    }

    @Test
    fun lastPageOfManyDisablesOnlyTheForwardJumps() {
        val projection = paginationProjection(page = 10, pageSize = 25, total = 250)

        assertEquals(10, projection.totalPages)
        assertEquals(226, projection.showingStart)
        assertEquals(250, projection.showingEnd)
        assertFalse(projection.atStart)
        assertTrue(projection.atEnd)
    }

    @Test
    fun aShortFinalPageClampsTheEndToTheTotal() {
        // total 255 over pages of 25 → 11 pages; the last page shows 251–255, not 251–275 (web `min(...)`).
        val projection = paginationProjection(page = 11, pageSize = 25, total = 255)

        assertEquals(11, projection.totalPages)
        assertEquals(251, projection.showingStart)
        assertEquals(255, projection.showingEnd)
        assertTrue(projection.atEnd)
    }

    // ── pageCount rounding: exact multiples vs the ceil one-over ────────────────────────────────────────────

    @Test
    fun pageCountIsCeilingDivisionOfTotalByPageSize() {
        assertEquals(4, paginationProjection(page = 1, pageSize = 25, total = 100).totalPages)
        assertEquals(5, paginationProjection(page = 1, pageSize = 25, total = 101).totalPages)
        assertEquals(1, paginationProjection(page = 1, pageSize = 25, total = 1).totalPages)
    }

    // ── Native-safety guards the web does not need (a non-positive pageSize would NaN/Infinity in JS) ───────

    @Test
    fun nonPositivePageSizeCollapsesToASinglePageInsteadOfDividingByZero() {
        val zero = paginationProjection(page = 1, pageSize = 0, total = 50)
        assertEquals(1, zero.totalPages)
        assertTrue(zero.atStart)
        assertTrue(zero.atEnd)

        val negative = paginationProjection(page = 1, pageSize = -5, total = 50)
        assertEquals(1, negative.totalPages)
    }

    @Test
    fun anEmptyDatasetShowsZeroEvenWhenTheCallerPassesAHigherPage() {
        // web: `start: total > 0 ? start : 0` — the summary floor is 0 regardless of the requested page.
        val projection = paginationProjection(page = 3, pageSize = 25, total = 0)

        assertEquals(1, projection.totalPages)
        assertEquals(0, projection.showingStart)
        assertEquals(0, projection.showingEnd)
        assertTrue(projection.atEnd)
    }

    // ── Page-size option contract: the web default is 25 / 50 / 100 ────────────────────────────────────────

    @Test
    fun defaultPageSizeOptionsMatchTheWebDefault() {
        assertEquals(listOf(25, 50, 100), DEFAULT_PAGE_SIZE_OPTIONS)
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("Pagination", PAGINATION_SLUG)
        assertEquals("Pagination", PaginationRegistration.SLUG)
        assertEquals("pagination", PaginationRegistration.ID)
    }
}
