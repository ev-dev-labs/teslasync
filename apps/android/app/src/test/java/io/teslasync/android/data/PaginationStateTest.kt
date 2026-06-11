package io.teslasync.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the immutable pagination invariants (clamping, page window, navigation, slicing). */
class PaginationStateTest {
    @Test
    fun defaultsAreFirstPageEmpty() {
        val state = PaginationState.of()

        assertEquals(1, state.page)
        assertEquals(PaginationState.DEFAULT_PAGE_SIZE, state.pageSize)
        assertEquals(0, state.total)
        assertEquals(1, state.pageCount)
        assertEquals(0, state.rangeStart)
        assertEquals(0, state.rangeEnd)
        assertFalse(state.canGoPrevious)
        assertFalse(state.canGoNext)
    }

    @Test
    fun pageCountAndRangeWindow() {
        val state = PaginationState.of(page = 2, pageSize = 10, total = 95)

        assertEquals(10, state.pageCount)
        assertEquals(10, state.offset)
        assertEquals(11, state.rangeStart)
        assertEquals(20, state.rangeEnd)
        assertTrue(state.canGoPrevious)
        assertTrue(state.canGoNext)
    }

    @Test
    fun lastPageRangeClampsToTotal() {
        val state = PaginationState.of(page = 10, pageSize = 10, total = 95)

        assertEquals(91, state.rangeStart)
        assertEquals(95, state.rangeEnd)
        assertFalse(state.canGoNext)
    }

    @Test
    fun pageIsClampedIntoRange() {
        assertEquals(1, PaginationState.of(page = 0, pageSize = 10, total = 30).page)
        assertEquals(3, PaginationState.of(page = 99, pageSize = 10, total = 30).page)
    }

    @Test
    fun pageSizeAndTotalAreClampedNonNegative() {
        val state = PaginationState.of(page = 1, pageSize = 0, total = -5)

        assertEquals(1, state.pageSize)
        assertEquals(0, state.total)
    }

    @Test
    fun navigationTransitionsClampAtEnds() {
        var state = PaginationState.of(page = 1, pageSize = 10, total = 30)

        state = state.next()
        assertEquals(2, state.page)
        state = state.last()
        assertEquals(3, state.page)
        state = state.next()
        assertEquals(3, state.page)
        state = state.previous()
        assertEquals(2, state.page)
        state = state.first()
        assertEquals(1, state.page)
    }

    @Test
    fun changingPageSizeReclampsThePage() {
        val state = PaginationState.of(page = 3, pageSize = 10, total = 30).withPageSize(50)

        assertEquals(1, state.pageCount)
        assertEquals(1, state.page)
    }

    @Test
    fun sliceReturnsCurrentPageWindow() {
        val source = (1..25).toList()
        val state = PaginationState.of(page = 2, pageSize = 10, total = 25)

        assertEquals((11..20).toList(), state.slice(source))
        assertEquals((21..25).toList(), state.last().slice(source))
    }

    @Test
    fun sliceHandlesEmptySource() {
        assertEquals(emptyList<Int>(), PaginationState.of().slice(emptyList<Int>()))
    }
}
