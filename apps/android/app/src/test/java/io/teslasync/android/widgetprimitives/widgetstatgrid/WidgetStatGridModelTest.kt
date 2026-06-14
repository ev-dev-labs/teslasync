package io.teslasync.android.widgetprimitives.widgetstatgrid

import io.teslasync.android.components.datadisplay.DeltaArrow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetStatGrid frame's pure logic — the native mirror of the render decisions the
 * web component makes (web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx) before Compose paints anything:
 * which branch shows ([widgetStatGridPlan]), the resolved target column count ([resolveStatGridColumns] / [autoCols]),
 * the container-query column collapse at a given width ([gridColumnCount]), and the trend-chip combination
 * ([statGridTrend]). Because the composable is a thin render layer over these projections, the per-branch assertions
 * here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetStatGridModelTest {
    // ── widgetStatGridPlan: the per-state snapshot (web stats.length === 0 vs the grid) ──────────────────────

    @Test
    fun emptyStatsShowOnlyTheEmptyState() {
        val plan = widgetStatGridPlan(statCount = 0, compact = false, cols = null)
        assertTrue(plan.showEmptyState)
        assertFalse(plan.showGrid)
    }

    @Test
    fun negativeStatCountIsClampedToTheEmptyState() {
        val plan = widgetStatGridPlan(statCount = -3, compact = false, cols = null)
        assertTrue(plan.showEmptyState)
    }

    @Test
    fun populatedStatsShowTheGridWithTheResolvedColumns() {
        val plan = widgetStatGridPlan(statCount = 3, compact = false, cols = null)
        assertFalse(plan.showEmptyState)
        assertTrue(plan.showGrid)
        assertEquals(3, plan.resolvedCols)
    }

    @Test
    fun compactForcesASingleColumnEvenWithMoreStats() {
        // web: `compact ? 1 : (cols ?? autoCols(count))`.
        val plan = widgetStatGridPlan(statCount = 4, compact = true, cols = 4)
        assertEquals(1, plan.resolvedCols)
    }

    @Test
    fun explicitColsWinOverAutoSelection() {
        val plan = widgetStatGridPlan(statCount = 4, compact = false, cols = 2)
        assertEquals(2, plan.resolvedCols)
    }

    // ── autoCols: web `count % 3 === 0 ? 3 : count % 4 === 0 ? 4 : 2` ──────────────────────────────────────

    @Test
    fun autoColsPicksThreeForMultiplesOfThree() {
        assertEquals(3, autoCols(3))
        assertEquals(3, autoCols(6))
        assertEquals(3, autoCols(9))
    }

    @Test
    fun autoColsPicksFourForMultiplesOfFourThatAreNotMultiplesOfThree() {
        assertEquals(4, autoCols(4))
        assertEquals(4, autoCols(8))
        assertEquals(4, autoCols(16))
    }

    @Test
    fun autoColsPrefersThreeWhenBothApply() {
        // web checks `% 3` first, so 12 (a multiple of both 3 and 4) resolves to 3, not 4.
        assertEquals(3, autoCols(12))
    }

    @Test
    fun autoColsFallsBackToTwo() {
        assertEquals(2, autoCols(1))
        assertEquals(2, autoCols(2))
        assertEquals(2, autoCols(5))
        assertEquals(2, autoCols(7))
    }

    // ── gridColumnCount: the container-query collapse (web `containerColsClass`) ───────────────────────────

    @Test
    fun oneColumnTargetNeverCollapsesOrGrows() {
        assertEquals(1, gridColumnCount(resolvedCols = 1, availableWidthDp = 100f))
        assertEquals(1, gridColumnCount(resolvedCols = 1, availableWidthDp = 1000f))
    }

    @Test
    fun twoColumnTargetIsAlwaysTwo() {
        // web `grid-cols-2` — the baseline never collapses below 2.
        assertEquals(2, gridColumnCount(resolvedCols = 2, availableWidthDp = 50f))
        assertEquals(2, gridColumnCount(resolvedCols = 2, availableWidthDp = 1000f))
    }

    @Test
    fun threeColumnTargetCollapsesByWidth() {
        // web `grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`.
        assertEquals(1, gridColumnCount(resolvedCols = 3, availableWidthDp = STAT_GRID_XS_BREAKPOINT_DP - 1f))
        assertEquals(2, gridColumnCount(resolvedCols = 3, availableWidthDp = STAT_GRID_XS_BREAKPOINT_DP))
        assertEquals(2, gridColumnCount(resolvedCols = 3, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP - 1f))
        assertEquals(3, gridColumnCount(resolvedCols = 3, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP))
        assertEquals(3, gridColumnCount(resolvedCols = 3, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP + 200f))
    }

    @Test
    fun fourColumnTargetCollapsesToTwoBelowSm() {
        // web `grid-cols-2 @sm:grid-cols-4`.
        assertEquals(2, gridColumnCount(resolvedCols = 4, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP - 1f))
        assertEquals(4, gridColumnCount(resolvedCols = 4, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP))
        assertEquals(4, gridColumnCount(resolvedCols = 4, availableWidthDp = STAT_GRID_SM_BREAKPOINT_DP + 100f))
    }

    @Test
    fun outOfRangeTargetFallsBackToTwo() {
        assertEquals(2, gridColumnCount(resolvedCols = 0, availableWidthDp = 1000f))
        assertEquals(2, gridColumnCount(resolvedCols = 9, availableWidthDp = 1000f))
    }

    @Test
    fun theBreakpointsMatchTheTailwindContainerDefaults() {
        // @xs = 20rem = 320px, @sm = 24rem = 384px at 1rem = 16px.
        assertEquals(320f, STAT_GRID_XS_BREAKPOINT_DP)
        assertEquals(384f, STAT_GRID_SM_BREAKPOINT_DP)
    }

    // ── statGridTrend: web `trend && trendValue ? { direction, value, positive: trend === 'up' } : undefined` ─

    @Test
    fun trendIsNullUnlessBothDirectionAndValueArePresent() {
        assertNull(statGridTrend(direction = null, trendValue = "+5%"))
        assertNull(statGridTrend(direction = DeltaArrow.Up, trendValue = null))
        assertNull(statGridTrend(direction = null, trendValue = null))
    }

    @Test
    fun upTrendIsPositive() {
        val trend = statGridTrend(direction = DeltaArrow.Up, trendValue = "+12%")
        assertEquals(DeltaArrow.Up, trend?.direction)
        assertEquals("+12%", trend?.text)
        assertEquals(true, trend?.positive)
    }

    @Test
    fun downTrendIsNotPositive() {
        val trend = statGridTrend(direction = DeltaArrow.Down, trendValue = "-4%")
        assertEquals(DeltaArrow.Down, trend?.direction)
        assertEquals(false, trend?.positive)
    }

    @Test
    fun flatTrendIsNotPositive() {
        // web `positive: trend === 'up'` ⇒ flat is false; the StatCard tone then resolves flat to muted.
        val trend = statGridTrend(direction = DeltaArrow.Flat, trendValue = "0%")
        assertEquals(DeltaArrow.Flat, trend?.direction)
        assertEquals(false, trend?.positive)
    }

    // ── StatGridItem: the web `value: string | number` union ──────────────────────────────────────────────

    @Test
    fun numericFactoryFormatsTheValueAndKeepsTheUnit() {
        val item = StatGridItem.of(label = "Distance", value = 3420, unit = "km")
        assertEquals("Distance", item.label)
        assertEquals("3420", item.value)
        assertEquals("km", item.unit)
    }

    @Test
    fun numericFactoryUnitDefaultsToNull() {
        assertNull(StatGridItem.of(label = "Trips", value = 12).unit)
    }

    @Test
    fun optionalFieldsDefaultToNull() {
        val item = StatGridItem(label = "Trips", value = "12")
        assertNull(item.unit)
        assertNull(item.icon)
        assertNull(item.trend)
        assertNull(item.trendValue)
        assertNull(item.valueColor)
    }

    // ── registration / slug contract ──────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetStatGrid", WIDGET_STAT_GRID_SLUG)
        assertEquals("WidgetStatGrid", WidgetStatGridRegistration.SLUG)
        assertEquals("widget-stat-grid", WidgetStatGridRegistration.ID)
    }
}
