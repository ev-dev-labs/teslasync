package io.teslasync.android.widgetprimitives.widgetchartsummary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetChartSummary frame's pure logic — the native mirror of the render
 * decisions the web component makes (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx) before
 * Compose paints anything: which regions show ([widgetChartSummaryPlan]) and how the stat cells are arranged at
 * a given width ([statRowLayout]). Because the composable is a thin render layer over these projections, the
 * per-branch assertions here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest
 * gate.
 */
class WidgetChartSummaryModelTest {
    // ── widgetChartSummaryPlan: the per-state snapshot (web isEmpty / stats.length>0 / !compact) ───────────

    @Test
    fun emptyShowsOnlyTheEmptyState() {
        val plan = widgetChartSummaryPlan(isEmpty = true, statCount = 3, compact = false)
        assertTrue(plan.showEmptyState)
        assertFalse(plan.showStats)
        assertFalse(plan.showChart)
        assertTrue(plan.rendersAnyRegion)
    }

    @Test
    fun emptyWinsEvenWithStatsAndNonCompact() {
        // web: the `isEmpty` early-return precedes the populated column regardless of stats / compact.
        val plan = widgetChartSummaryPlan(isEmpty = true, statCount = 0, compact = true)
        assertTrue(plan.showEmptyState)
        assertFalse(plan.showStats)
        assertFalse(plan.showChart)
    }

    @Test
    fun widePopulatedShowsBothTheStatRowAndTheChart() {
        val plan = widgetChartSummaryPlan(isEmpty = false, statCount = 4, compact = false)
        assertFalse(plan.showEmptyState)
        assertTrue(plan.showStats)
        assertTrue(plan.showChart)
    }

    @Test
    fun compactPopulatedShowsTheStatRowButHidesTheChart() {
        // web: `{!compact && <chart/>}` — compact suppresses the chart region.
        val plan = widgetChartSummaryPlan(isEmpty = false, statCount = 4, compact = true)
        assertFalse(plan.showEmptyState)
        assertTrue(plan.showStats)
        assertFalse(plan.showChart)
    }

    @Test
    fun noStatsHidesTheStatRowButKeepsTheChartWhenNonCompact() {
        // web: `{stats.length > 0 && <statRow/>}` — an empty stats list hides the row, the chart still shows.
        val plan = widgetChartSummaryPlan(isEmpty = false, statCount = 0, compact = false)
        assertFalse(plan.showStats)
        assertTrue(plan.showChart)
    }

    @Test
    fun compactWithNoStatsIsTheDegenerateEmptyColumn() {
        // web renders an empty `flex` column here too; the surface honestly does the same (no invented chrome).
        val plan = widgetChartSummaryPlan(isEmpty = false, statCount = 0, compact = true)
        assertFalse(plan.showEmptyState)
        assertFalse(plan.showStats)
        assertFalse(plan.showChart)
        assertFalse(plan.rendersAnyRegion)
    }

    @Test
    fun negativeStatCountIsClampedSoTheStatGuardStaysOff() {
        val plan = widgetChartSummaryPlan(isEmpty = false, statCount = -5, compact = false)
        assertFalse(plan.showStats)
    }

    // ── statRowLayout: the responsive grid↔row branch (web `compact ? grid : grid ... @sm:flex`) ───────────

    @Test
    fun compactAlwaysUsesTheTwoColumnGridRegardlessOfWidth() {
        assertEquals(StatRowLayout.Grid2Col, statRowLayout(compact = true, availableWidthDp = 100f))
        assertEquals(StatRowLayout.Grid2Col, statRowLayout(compact = true, availableWidthDp = 1000f))
    }

    @Test
    fun nonCompactBelowTheBreakpointUsesTheGrid() {
        assertEquals(
            StatRowLayout.Grid2Col,
            statRowLayout(compact = false, availableWidthDp = STAT_ROW_BREAKPOINT_DP - 1f),
        )
    }

    @Test
    fun nonCompactAtOrAboveTheBreakpointRelaxesToTheRow() {
        assertEquals(
            StatRowLayout.Row,
            statRowLayout(compact = false, availableWidthDp = STAT_ROW_BREAKPOINT_DP),
        )
        assertEquals(
            StatRowLayout.Row,
            statRowLayout(compact = false, availableWidthDp = STAT_ROW_BREAKPOINT_DP + 200f),
        )
    }

    @Test
    fun theBreakpointMatchesTheWebSmContainerWidth() {
        // Tailwind `sm` container query = 24rem = 384px at 1rem = 16px.
        assertEquals(384f, STAT_ROW_BREAKPOINT_DP)
        assertEquals(2, StatRowLayout.entries.size)
    }

    // ── ChartSummaryStat: the web `value: string | number` union + optional unit ──────────────────────────

    @Test
    fun numericFactoryFormatsTheValueAndKeepsTheUnit() {
        val stat = ChartSummaryStat.of(label = "Peak", value = 118, unit = "kW")
        assertEquals("Peak", stat.label)
        assertEquals("118", stat.value)
        assertEquals("kW", stat.unit)
    }

    @Test
    fun unitDefaultsToNullWhenOmitted() {
        assertEquals(null, ChartSummaryStat(label = "Trips", value = "12").unit)
        assertEquals(null, ChartSummaryStat.of(label = "Trips", value = 12).unit)
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("WidgetChartSummary", WIDGET_CHART_SUMMARY_SLUG)
        assertEquals("WidgetChartSummary", WidgetChartSummaryRegistration.SLUG)
        assertEquals("widget-chart-summary", WidgetChartSummaryRegistration.ID)
    }
}
