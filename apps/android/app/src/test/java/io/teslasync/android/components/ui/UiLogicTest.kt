package io.teslasync.android.components.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free primitives in `UiLogic.kt`. These run in the
 * `:android:testDebugUnitTest` gate and cover the interactive behavior (sort, selection,
 * pagination, zoom, range, roving focus, inline-edit commit, masking) without the Compose UI.
 */
class UiLogicTest {
    @Test
    fun sortToggleFlipsDirectionOnSameKey() {
        val state = SortState("name", SortDirection.Desc)
        val next = state.toggledBy("name")
        assertEquals("name", next.key)
        assertEquals(SortDirection.Asc, next.direction)
        assertEquals(SortDirection.Desc, next.toggledBy("name").direction)
    }

    @Test
    fun sortToggleSelectsNewKeyDescending() {
        val next = SortState("name", SortDirection.Asc).toggledBy("date")
        assertEquals("date", next.key)
        assertEquals(SortDirection.Desc, next.direction)
    }

    @Test
    fun togglePresenceAddsThenRemoves() {
        assertEquals(setOf(1), emptySet<Int>().togglePresence(1))
        assertEquals(emptySet<Int>(), setOf(1).togglePresence(1))
        assertEquals(setOf("a", "b"), setOf("a").togglePresence("b"))
    }

    @Test
    fun pageCountRoundsUpAndGuardsZero() {
        assertEquals(1, PaginationMath.pageCount(total = 0, pageSize = 25))
        assertEquals(2, PaginationMath.pageCount(total = 50, pageSize = 25))
        assertEquals(3, PaginationMath.pageCount(total = 51, pageSize = 25))
        assertEquals(1, PaginationMath.pageCount(total = 10, pageSize = 0))
    }

    @Test
    fun clampPageStaysInBounds() {
        assertEquals(1, PaginationMath.clampPage(page = 0, total = 60, pageSize = 25))
        assertEquals(3, PaginationMath.clampPage(page = 9, total = 60, pageSize = 25))
    }

    @Test
    fun windowReportsOneBasedInclusiveRange() {
        assertEquals(PageWindow(1, 25), PaginationMath.window(page = 1, pageSize = 25, total = 60))
        assertEquals(PageWindow(51, 60), PaginationMath.window(page = 3, pageSize = 25, total = 60))
        assertEquals(PageWindow(0, 0), PaginationMath.window(page = 1, pageSize = 25, total = 0))
    }

    @Test
    fun sliceBoundsAreZeroBasedHalfOpen() {
        assertEquals(0 until 25, PaginationMath.sliceBounds(page = 1, pageSize = 25, total = 60))
        assertEquals(50 until 60, PaginationMath.sliceBounds(page = 3, pageSize = 25, total = 60))
    }

    @Test
    fun zoomClampsAndSteps() {
        assertEquals(5f, clampZoom(6f, 1f, 5f), 1e-4f)
        assertEquals(1f, clampZoom(0.5f, 1f, 5f), 1e-4f)
        assertEquals(1.5f, stepZoom(1f, 0.5f, 1f, 5f), 1e-4f)
        assertEquals(1f, stepZoom(1f, -1f, 1f, 5f), 1e-4f)
    }

    @Test
    fun rangeNormalizesAndClamps() {
        assertEquals(2f to 5f, normalizeRange(5f, 2f))
        assertEquals(1f to 3f, normalizeRange(1f, 3f))
        assertEquals(5f, clampToBounds(9f, 0f, 5f), 1e-4f)
    }

    @Test
    fun nextEnabledIndexSkipsDisabledAndWraps() {
        val enabled = listOf(true, false, true)
        assertEquals(2, nextEnabledIndex(enabled, from = 0, delta = 1))
        assertEquals(0, nextEnabledIndex(enabled, from = 2, delta = 1))
        assertEquals(2, nextEnabledIndex(enabled, from = 0, delta = -1))
        assertEquals(-1, nextEnabledIndex(listOf(false, false), from = 0, delta = 1))
    }

    @Test
    fun decideCommitClassifiesDraft() {
        assertEquals(CommitOutcome.NoOp, decideCommit(" x ", "x") { null })
        assertEquals(CommitOutcome.Invalid, decideCommit("  ", "x") { null })
        assertEquals(CommitOutcome.Commit, decideCommit("y", "x") { null })
        assertEquals(CommitOutcome.Invalid, decideCommit("y", "x") { "bad" })
    }

    @Test
    fun maskValueRevealsSuffixAndHandlesEmpty() {
        assertEquals("", maskValue("", MaskVariant.ApiKey))
        val masked = maskValue("sk-1234567890", MaskVariant.ApiKey)
        assertTrue(masked.endsWith("7890"))
        assertEquals("sk-1234567890".length, masked.length)
        assertEquals("\u2022\u2022\u2022\u2022\u2022\u2022gh", maskValue("abcdefgh", MaskVariant.Generic))
    }

    @Test
    fun maskValueEmailKeepsDomain() {
        assertEquals("j\u2022\u2022\u2022@x.com", maskValue("john@x.com", MaskVariant.Email))
        assertEquals("\u2022\u2022\u2022\u2022", maskValue("nope", MaskVariant.Email))
    }
}
