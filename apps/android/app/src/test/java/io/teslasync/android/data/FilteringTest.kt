package io.teslasync.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the pure list-control filters: sort direction/state, date range, and the combined filter. */
class FilteringTest {
    @Test
    fun sortDirectionToggles() {
        assertEquals(SortDirection.Descending, SortDirection.Ascending.toggled())
        assertEquals(SortDirection.Ascending, SortDirection.Descending.toggled())
    }

    @Test
    fun sortOnSameKeyTogglesDirection() {
        val sort = SortState("date", SortDirection.Ascending)

        assertEquals(SortDirection.Descending, sort.on("date").direction)
    }

    @Test
    fun sortOnNewKeyResetsToAscending() {
        val next = SortState("date", SortDirection.Descending).on("name")

        assertEquals("name", next.key)
        assertEquals(SortDirection.Ascending, next.direction)
    }

    @Test
    fun unboundedRangeMatchesEverything() {
        assertFalse(DateRange.Unbounded.isBounded)
        assertTrue(DateRange.Unbounded.contains(0L))
        assertTrue(DateRange.Unbounded.contains(Long.MAX_VALUE))
    }

    @Test
    fun closedRangeIsInclusive() {
        val range = DateRange(startMillis = 10L, endMillis = 20L)

        assertTrue(range.isBounded)
        assertTrue(range.contains(10L))
        assertTrue(range.contains(15L))
        assertTrue(range.contains(20L))
        assertFalse(range.contains(9L))
        assertFalse(range.contains(21L))
    }

    @Test
    fun halfOpenRangesHonourTheSetBound() {
        assertTrue(DateRange(startMillis = 10L).contains(1000L))
        assertFalse(DateRange(startMillis = 10L).contains(5L))
        assertTrue(DateRange(endMillis = 10L).contains(5L))
        assertFalse(DateRange(endMillis = 10L).contains(11L))
    }

    @Test
    fun filterStateActivityAndTransitions() {
        assertFalse(FilterState().isActive)
        assertTrue(FilterState().withQuery("model 3").isActive)

        val filtered = FilterState().toggleSort("date")
        assertEquals(SortState("date"), filtered.sort)
        assertEquals(SortDirection.Descending, filtered.toggleSort("date").sort?.direction)
        assertFalse(filtered.cleared().isActive)
    }
}
