package io.teslasync.android.widgetprimitives.widgetstatusgrid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetStatusGrid frame's pure logic — the native mirror of the render decisions
 * the web component makes (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx) before Compose paints
 * anything: whether the empty state or the grid shows ([widgetStatusGridPlan]), the configured column track
 * ([resolveColumns], web `compact ? 2 : cols`), and how that track collapses with the rendered width
 * ([statusGridColumns], web `containerColsClass`). Because the composable is a thin render layer over these
 * projections, the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class WidgetStatusGridModelTest {
    // ── widgetStatusGridPlan: the empty vs. grid snapshot (web `cells.length === 0`) ──────────────────────────

    @Test
    fun emptyCellListShowsOnlyTheEmptyState() {
        val plan = widgetStatusGridPlan(cellCount = 0)
        assertTrue(plan.showEmptyState)
        assertFalse(plan.showGrid)
        assertEquals(0, plan.cellCount)
    }

    @Test
    fun anyCellsShowTheGrid() {
        val plan = widgetStatusGridPlan(cellCount = 4)
        assertFalse(plan.showEmptyState)
        assertTrue(plan.showGrid)
        assertEquals(4, plan.cellCount)
    }

    @Test
    fun negativeCellCountIsClampedToTheEmptyState() {
        val plan = widgetStatusGridPlan(cellCount = -3)
        assertTrue(plan.showEmptyState)
        assertEquals(0, plan.cellCount)
    }

    // ── resolveColumns: the configured track (web `const resolvedCols = compact ? 2 : cols`) ──────────────────

    @Test
    fun nonCompactHonorsTheConfiguredTwoThreeOrFourColumns() {
        assertEquals(2, resolveColumns(cols = 2, compact = false))
        assertEquals(3, resolveColumns(cols = 3, compact = false))
        assertEquals(4, resolveColumns(cols = 4, compact = false))
    }

    @Test
    fun compactAlwaysForcesTwoColumns() {
        // web: `compact ? 2 : cols` — compact ignores the requested column count.
        assertEquals(2, resolveColumns(cols = 3, compact = true))
        assertEquals(2, resolveColumns(cols = 4, compact = true))
        assertEquals(2, resolveColumns(cols = 2, compact = true))
    }

    @Test
    fun outOfRangeColumnsClampToTheWebDefaultOfTwo() {
        // web type is `2 | 3 | 4`; a malformed caller can never select an unsupported track.
        assertEquals(DEFAULT_COLUMNS, resolveColumns(cols = 0, compact = false))
        assertEquals(DEFAULT_COLUMNS, resolveColumns(cols = 1, compact = false))
        assertEquals(DEFAULT_COLUMNS, resolveColumns(cols = 5, compact = false))
        assertEquals(DEFAULT_COLUMNS, resolveColumns(cols = -2, compact = false))
    }

    // ── statusGridColumns: the responsive collapse (web `containerColsClass`) ─────────────────────────────────

    @Test
    fun twoTrackGridIsAlwaysTwoColumnsAtEveryWidth() {
        // web `grid-cols-2` — no container query.
        assertEquals(2, statusGridColumns(resolvedCols = 2, availableWidthDp = 0f))
        assertEquals(2, statusGridColumns(resolvedCols = 2, availableWidthDp = CONTAINER_SM_DP))
        assertEquals(2, statusGridColumns(resolvedCols = 2, availableWidthDp = 2_000f))
    }

    @Test
    fun threeTrackGridCollapsesOneTwoThreeAtTheContainerBreakpoints() {
        // web `grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`.
        assertEquals(1, statusGridColumns(resolvedCols = 3, availableWidthDp = 0f))
        assertEquals(1, statusGridColumns(resolvedCols = 3, availableWidthDp = CONTAINER_XS_DP - 1f))
        assertEquals(2, statusGridColumns(resolvedCols = 3, availableWidthDp = CONTAINER_XS_DP))
        assertEquals(2, statusGridColumns(resolvedCols = 3, availableWidthDp = CONTAINER_SM_DP - 1f))
        assertEquals(3, statusGridColumns(resolvedCols = 3, availableWidthDp = CONTAINER_SM_DP))
        assertEquals(3, statusGridColumns(resolvedCols = 3, availableWidthDp = 1_000f))
    }

    @Test
    fun fourTrackGridCollapsesTwoThenFourAtTheSmBreakpoint() {
        // web `grid-cols-2 @sm:grid-cols-4`.
        assertEquals(2, statusGridColumns(resolvedCols = 4, availableWidthDp = 0f))
        assertEquals(2, statusGridColumns(resolvedCols = 4, availableWidthDp = CONTAINER_SM_DP - 1f))
        assertEquals(4, statusGridColumns(resolvedCols = 4, availableWidthDp = CONTAINER_SM_DP))
        assertEquals(4, statusGridColumns(resolvedCols = 4, availableWidthDp = 1_000f))
    }

    @Test
    fun unsupportedTrackFallsBackToTwoColumns() {
        assertEquals(DEFAULT_COLUMNS, statusGridColumns(resolvedCols = 99, availableWidthDp = 500f))
    }

    @Test
    fun theBreakpointsMatchTheWebContainerQueryWidths() {
        // Tailwind container queries: @xs = 20rem = 320px, @sm = 24rem = 384px, at 1rem = 16px.
        assertEquals(320f, CONTAINER_XS_DP)
        assertEquals(384f, CONTAINER_SM_DP)
        assertEquals(2, DEFAULT_COLUMNS)
    }

    // ── StatusTone: the web `ok | warning | error | inactive | unknown` union ─────────────────────────────────

    @Test
    fun statusToneReproducesTheFiveWebStatuses() {
        assertEquals(5, StatusTone.entries.size)
        assertTrue(StatusTone.entries.containsAll(listOf(StatusTone.Ok, StatusTone.Warning, StatusTone.Error)))
        assertTrue(StatusTone.entries.containsAll(listOf(StatusTone.Inactive, StatusTone.Unknown)))
    }

    // ── registration / slug contract ──────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetStatusGrid", WIDGET_STATUS_GRID_SLUG)
        assertEquals("WidgetStatusGrid", WidgetStatusGridRegistration.SLUG)
        assertEquals("widget-status-grid", WidgetStatusGridRegistration.ID)
    }
}
