package io.teslasync.android.featureviews.dashboardgrid

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of `DashboardGrid`'s pure logic — the native analogue of everything the web component
 * derives before laying out its widgets (web/src/features/dashboard/components/DashboardGrid.tsx): the
 * container-width → breakpoint selection (the `useContainerWidth` + `getBreakpointFromWidth` parity), the
 * per-breakpoint column count (`GRID_COLS`), the live widget size (active layout → `lg` → default, the web
 * `getWidgetSizeLive`), the mobile stack ordering scalar (web `orderedWidgets`), the read-only row packing (the web
 * `verticalCompactor` flow), and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest
 * gate.
 */
class DashboardGridProjectionTest {
    private val widgets =
        listOf(
            DashboardWidget(id = "w-1", widgetId = "vehicle-hero", name = "Vehicle", defaultSize = WidgetSize(2, 2)),
            DashboardWidget(id = "w-2", widgetId = "battery-gauge", name = "Battery", defaultSize = WidgetSize(1, 2)),
            DashboardWidget(id = "w-3", widgetId = "range-bar", name = "Range", defaultSize = WidgetSize(1, 1)),
            DashboardWidget(id = "w-4", widgetId = "fleet-stats", name = "Fleet", defaultSize = WidgetSize(2, 1)),
        )

    private val layout =
        DashboardLayout(
            widgets = widgets,
            layouts =
                mapOf(
                    DashboardBreakpoint.Lg to
                        listOf(
                            WidgetLayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                            WidgetLayoutItem("w-2", x = 2, y = 0, w = 1, h = 2),
                            WidgetLayoutItem("w-3", x = 3, y = 0, w = 1, h = 1),
                            WidgetLayoutItem("w-4", x = 0, y = 2, w = 2, h = 1),
                        ),
                    DashboardBreakpoint.Xs to
                        listOf(
                            WidgetLayoutItem("w-2", x = 0, y = 0, w = 1, h = 2),
                            WidgetLayoutItem("w-1", x = 0, y = 2, w = 1, h = 2),
                            WidgetLayoutItem("w-4", x = 0, y = 4, w = 1, h = 1),
                            WidgetLayoutItem("w-3", x = 0, y = 5, w = 1, h = 1),
                        ),
                ),
        )

    // ── Breakpoint selection (useContainerWidth + getBreakpointFromWidth parity) ───────────────────

    @Test
    fun breakpointForWidthPicksLargestThresholdAtOrBelowWidth() {
        assertEquals(DashboardBreakpoint.Lg, DashboardGridProjection.breakpointForWidth(1_300))
        assertEquals(DashboardBreakpoint.Lg, DashboardGridProjection.breakpointForWidth(1_200))
        assertEquals(DashboardBreakpoint.Md, DashboardGridProjection.breakpointForWidth(1_100))
        assertEquals(DashboardBreakpoint.Md, DashboardGridProjection.breakpointForWidth(996))
        assertEquals(DashboardBreakpoint.Sm, DashboardGridProjection.breakpointForWidth(800))
        assertEquals(DashboardBreakpoint.Sm, DashboardGridProjection.breakpointForWidth(768))
    }

    @Test
    fun breakpointForWidthFallsBackToXsBelowEveryThreshold() {
        assertEquals(DashboardBreakpoint.Xs, DashboardGridProjection.breakpointForWidth(600))
        assertEquals(DashboardBreakpoint.Xs, DashboardGridProjection.breakpointForWidth(480))
        assertEquals(DashboardBreakpoint.Xs, DashboardGridProjection.breakpointForWidth(360))
        assertEquals(DashboardBreakpoint.Xs, DashboardGridProjection.breakpointForWidth(0))
    }

    @Test
    fun columnsForMatchesGridColsConstants() {
        assertEquals(4, DashboardGridProjection.columnsFor(DashboardBreakpoint.Lg))
        assertEquals(3, DashboardGridProjection.columnsFor(DashboardBreakpoint.Md))
        assertEquals(2, DashboardGridProjection.columnsFor(DashboardBreakpoint.Sm))
        assertEquals(1, DashboardGridProjection.columnsFor(DashboardBreakpoint.Xs))
    }

    // ── Layout / widget size resolution (web getWidgetSizeLive) ────────────────────────────────────

    @Test
    fun layoutForFallsBackToLgThenEmpty() {
        // Md has no saved array → falls back to the lg array.
        assertEquals(layout.layouts[DashboardBreakpoint.Lg], DashboardGridProjection.layoutFor(layout, DashboardBreakpoint.Md))
        // A layout with no arrays at all yields empty.
        assertTrue(DashboardGridProjection.layoutFor(DashboardLayout(widgets = widgets), DashboardBreakpoint.Lg).isEmpty())
    }

    @Test
    fun widgetSizeReadsActiveLayoutItemElseDefault() {
        // w-1 has a saved lg item (2×2) → read from the layout.
        assertEquals(
            WidgetSize(2, 2),
            DashboardGridProjection.widgetSize(layout, DashboardBreakpoint.Lg, widgets[0]),
        )
        // A widget with no saved item falls back to its registry default size.
        val orphan = DashboardWidget(id = "w-x", widgetId = "ghost", name = "Ghost", defaultSize = WidgetSize(3, 4))
        assertEquals(
            WidgetSize(3, 4),
            DashboardGridProjection.widgetSize(layout, DashboardBreakpoint.Lg, orphan),
        )
    }

    // ── Mobile stack ordering (web orderedWidgets scalar) ──────────────────────────────────────────

    @Test
    fun orderForMobileSortsBySavedScalarThenKeepsUnpositionedLast() {
        val xs = layout.layouts.getValue(DashboardBreakpoint.Xs)
        val ordered = DashboardGridProjection.orderForMobile(widgets, xs)
        // xs layout orders by y: w-2 (y0), w-1 (y2), w-4 (y4), w-3 (y5).
        assertEquals(listOf("w-2", "w-1", "w-4", "w-3"), ordered.map { it.id })
    }

    @Test
    fun orderForMobileKeepsInsertionOrderWhenNoXsLayout() {
        val ordered = DashboardGridProjection.orderForMobile(widgets, emptyList())
        assertEquals(listOf("w-1", "w-2", "w-3", "w-4"), ordered.map { it.id })
    }

    // ── Row packing (web verticalCompactor flow) ───────────────────────────────────────────────────

    @Test
    fun packRowsWrapsWhenSpansExceedColumns() {
        val placed =
            listOf(
                placed("a", span = 2),
                placed("b", span = 1),
                placed("c", span = 1),
                placed("d", span = 2),
            )
        val rows = DashboardGridProjection.packRows(placed, columns = 4)
        // a(2)+b(1)+c(1) = 4 fills row 1; d(2) wraps to row 2.
        assertEquals(2, rows.size)
        assertEquals(listOf("a", "b", "c"), rows[0].items.map { it.widget.id })
        assertEquals(listOf("d"), rows[1].items.map { it.widget.id })
    }

    @Test
    fun packRowsClampsOverWideSpanToColumns() {
        val rows = DashboardGridProjection.packRows(listOf(placed("wide", span = 9)), columns = 2)
        assertEquals(1, rows.size)
        assertEquals(listOf("wide"), rows[0].items.map { it.widget.id })
    }

    @Test
    fun packRowsReturnsEmptyForNoCells() {
        assertTrue(DashboardGridProjection.packRows(emptyList(), columns = 4).isEmpty())
    }

    // ── Projection (breakpoint + ordering + sizing + packing) ──────────────────────────────────────

    @Test
    fun projectBuildsDesktopGridInReadingOrder() {
        val result = DashboardGridProjection.project(layout, widthDp = 1_200)

        assertEquals(DashboardBreakpoint.Lg, result.breakpoint)
        assertEquals(4, result.columns)
        assertFalse(result.isMobileStack)
        assertFalse(result.isEmpty)

        // lg ordering by (y, x): row0 has w-1(0,0), w-2(2,0), w-3(3,0); w-4 (y2) wraps to its own row.
        assertEquals(listOf("w-1", "w-2", "w-3", "w-4"), result.placedWidgets.map { it.widget.id })
        assertEquals(2, result.rows.size)
        assertEquals(listOf("w-1", "w-2", "w-3"), result.rows[0].items.map { it.widget.id })
        assertEquals(listOf("w-4"), result.rows[1].items.map { it.widget.id })
        // w-1 keeps its 2-column span; the mobile flag is off.
        assertEquals(2, result.placedWidgets.first().columnSpan)
        assertEquals(WidgetSize(2, 2), result.placedWidgets.first().size)
    }

    @Test
    fun projectBuildsMobileStackOneCellPerRow() {
        val result = DashboardGridProjection.project(layout, widthDp = 360)

        assertEquals(DashboardBreakpoint.Xs, result.breakpoint)
        assertEquals(1, result.columns)
        assertTrue(result.isMobileStack)
        // Mobile order from the xs scalar; every cell spans the single column and is its own row.
        assertEquals(listOf("w-2", "w-1", "w-4", "w-3"), result.placedWidgets.map { it.widget.id })
        assertTrue(result.rows.all { it.items.size == 1 })
        assertTrue(result.placedWidgets.all { it.columnSpan == 1 })
    }

    @Test
    fun projectFlagsEmptyForNoWidgets() {
        val result = DashboardGridProjection.project(DashboardLayout(), widthDp = 1_200)
        assertTrue(result.isEmpty)
        assertTrue(result.rows.isEmpty())
        assertTrue(result.placedWidgets.isEmpty())
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordDashboardGridOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DashboardGrid"), fields)
    }

    private fun placed(
        id: String,
        span: Int,
    ): PlacedWidget {
        val widget = DashboardWidget(id = id, widgetId = id, name = id)
        return PlacedWidget(widget = widget, size = WidgetSize(span, 1), columnSpan = span, x = 0, y = 0)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
