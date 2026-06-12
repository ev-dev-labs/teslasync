// Pure, framework-free model + projection for the `DashboardGrid` feature view — the native analogue of
// everything the web component derives before laying out its widgets
// (web/src/features/dashboard/components/DashboardGrid.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is a presentational layout host. It receives a `SavedDashboard` (`widgets[]` + per-breakpoint
// `layouts{}`) and only arranges those widgets — it fetches nothing itself. Its one hook is `useContainerWidth`,
// which measures the grid container and selects the active react-grid-layout breakpoint
// (`GRID_BREAKPOINTS` lg 1200 / md 996 / sm 768 / xs 480, `GRID_COLS` 4 / 3 / 2 / 1, `ROW_HEIGHT` 80). Below the
// smallest breakpoint the web switches to a single-column "mobile stack" whose widget order is recovered from the
// saved `xs` layout (the `y * 10000 + x * 100 + i / 1000` sortable scalar); at every larger breakpoint it renders
// the absolute-positioned grid where each widget spans `w` of the breakpoint's columns and stands `h * ROW_HEIGHT`
// tall, and a widget's live size is read from the active breakpoint's layout (falling back to `lg`, then the
// registry default).
//
// This file owns exactly those pure derivations so the composable can stay declarative: the
// container-width → breakpoint selection ([DashboardGridProjection.breakpointForWidth], the `useContainerWidth`
// analogue), the per-breakpoint column count, the live widget size (active layout → `lg` → default, mirroring the
// web `getWidgetSizeLive`), the mobile stack ordering ([DashboardGridProjection.orderForMobile]), and the row
// packing that reproduces the web `verticalCompactor` flow into a list of rows the native Compose grid can lay out
// without a drag-and-drop engine. Drag/resize is a pointer-only web affordance (the web source itself notes the
// drag handle "has no effect on touch"), so it is intentionally not modelled here — the touch-first native surface
// keeps the functional Settings/Remove actions and the read-only compacted layout.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DashboardGrid — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.dashboardgrid

import io.teslasync.shared.core.diagnostics.Logger

/** Grid row unit in dp — the web `ROW_HEIGHT` (80 px); a widget `h` rows tall is `h * this` high on a wide grid. */
const val DASHBOARD_GRID_ROW_HEIGHT_DP: Int = 80

/**
 * Minimum height of a widget cell in the single-column mobile stack, in dp — the web `min-h-[12rem]` (192 px)
 * floor that gives chart/map widgets a definite parent height while letting taller content grow intrinsically.
 */
const val DASHBOARD_GRID_MOBILE_MIN_WIDGET_HEIGHT_DP: Int = 192

/** Weight applied to a saved row index when recovering the mobile order — the web `y * 10000`. */
private const val MOBILE_ORDER_ROW_WEIGHT: Double = 10_000.0

/** Weight applied to a saved column index when recovering the mobile order — the web `x * 100`. */
private const val MOBILE_ORDER_COLUMN_WEIGHT: Double = 100.0

/** Divisor that folds the array index into the mobile order scalar for a stable tiebreak — the web `i / 1000`. */
private const val MOBILE_ORDER_INDEX_DIVISOR: Double = 1_000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DashboardGridRegistration {
    /** Stable surface id. */
    const val ID: String = "dashboard-grid"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DashboardGrid"
}

/**
 * A widget's grid footprint in column/row units — the native mirror of the web `WidgetSize` (`{ cols, rows }`).
 * [cols] is the column span (1..breakpoint columns) and [rows] the height in [DASHBOARD_GRID_ROW_HEIGHT_DP] units.
 */
data class WidgetSize(
    val cols: Int,
    val rows: Int,
)

/**
 * One widget placed on the dashboard — the native mirror of the web `WidgetInstance` plus the two registry fields
 * the grid itself needs to render chrome ([name]) and fall back when a widget has no saved layout ([defaultSize]).
 * The registry that resolves a `widgetId` to its component/metadata is a separate surface (out of scope here), so
 * the host supplies the already-resolved [name]/[defaultSize] alongside the instance [id]. [vehicleId] is the web
 * `config.vehicleId` (the per-widget vehicle filter), passed through to the rendered widget body.
 */
data class DashboardWidget(
    val id: String,
    val widgetId: String,
    val name: String,
    val vehicleId: Int? = null,
    val defaultSize: WidgetSize = WidgetSize(cols = 1, rows = 1),
)

/**
 * One react-grid-layout item — the native mirror of the web `RGLLayout` (`{ i, x, y, w, h }`). [i] is the widget
 * instance id, ([x], [y]) its grid origin (columns from the left, rows from the top) and ([w], [h]) its span.
 */
data class WidgetLayoutItem(
    val i: String,
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
)

/**
 * The responsive breakpoints — the native mirror of the web `GRID_BREAKPOINTS` / `GRID_COLS`. [columns] is the grid
 * column count at that breakpoint and [minWidthDp] the smallest container width (dp) that selects it. [Xs] is the
 * single-column mobile stack the web falls back to below every threshold.
 */
enum class DashboardBreakpoint(
    val columns: Int,
    val minWidthDp: Int,
) {
    Lg(columns = 4, minWidthDp = 1_200),
    Md(columns = 3, minWidthDp = 996),
    Sm(columns = 2, minWidthDp = 768),
    Xs(columns = 1, minWidthDp = 480),
}

/**
 * The saved dashboard the grid renders — the native mirror of the web `SavedDashboard.{widgets, layouts}`.
 * [widgets] is the instance list (insertion order) and [layouts] the per-breakpoint positions/sizes. Defaulted to
 * empty so the loading / empty lifecycle states are expressible without a payload.
 */
data class DashboardLayout(
    val widgets: List<DashboardWidget> = emptyList(),
    val layouts: Map<DashboardBreakpoint, List<WidgetLayoutItem>> = emptyMap(),
)

/**
 * The presentation flags the web grid reads from its props and the dashboard settings. [editMode] swaps each
 * widget's fullscreen affordance for the drag/settings/remove chrome (web `editMode`); [compactMode] tightens the
 * inter-widget gaps (web `compactMode` → smaller `margin`); [showWidgetBorders] outlines each widget (web
 * `showWidgetBorders`). Kiosk opacity and live drag/resize are pointer/CSS-glass concerns that don't translate to
 * the Material surface idiom, so they are intentionally not represented (ADR-guided "don't port Tailwind classes").
 */
data class DashboardGridOptions(
    val editMode: Boolean = false,
    val compactMode: Boolean = false,
    val showWidgetBorders: Boolean = false,
)

/**
 * A widget resolved to a render-ready cell — pure data (no Compose types). [size] is the live size from the active
 * layout (web `getWidgetSizeLive`), [columnSpan] the clamped horizontal span the row layout uses (the full column
 * count on the mobile stack), and ([x], [y]) the saved grid origin used to order the cells top-to-bottom /
 * left-to-right (the read-only analogue of the web absolute placement).
 */
data class PlacedWidget(
    val widget: DashboardWidget,
    val size: WidgetSize,
    val columnSpan: Int,
    val x: Int,
    val y: Int,
)

/** One packed grid row — the cells that share a horizontal band once their spans are summed against the columns. */
data class WidgetRow(
    val items: List<PlacedWidget>,
)

/**
 * The fully projected, render-ready grid — pure data so the projection is unit-tested without a UI host. The
 * composable reads [isMobileStack] to choose the single-column stack vs the multi-column grid, lays out [rows]
 * (each a horizontal band), sizes each cell from its [PlacedWidget], and shows the surface-wide empty state from
 * [isEmpty]. [breakpoint]/[columns] expose the resolved responsive context (web active breakpoint + `GRID_COLS`).
 */
data class DashboardGridProjectionResult(
    val breakpoint: DashboardBreakpoint,
    val columns: Int,
    val isMobileStack: Boolean,
    val isEmpty: Boolean,
    val rows: List<WidgetRow>,
    val placedWidgets: List<PlacedWidget>,
)

/**
 * The pure projection the composable renders — the native mirror of the data the web grid derives from its
 * `SavedDashboard` + measured container width. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate.
 */
object DashboardGridProjection {
    /**
     * Selects the active breakpoint for a measured container [widthDp] — the native analogue of the web
     * `useContainerWidth` + `getBreakpointFromWidth`: the largest breakpoint whose [DashboardBreakpoint.minWidthDp]
     * threshold is `<=` the width, falling back to [DashboardBreakpoint.Xs] (the single-column stack) when the
     * width is below every threshold or unknown (`0`).
     */
    fun breakpointForWidth(widthDp: Int): DashboardBreakpoint =
        DashboardBreakpoint.entries
            .sortedByDescending { it.minWidthDp }
            .firstOrNull { widthDp >= it.minWidthDp }
            ?: DashboardBreakpoint.Xs

    /** Column count for [breakpoint] — the web `GRID_COLS[breakpoint]`. */
    fun columnsFor(breakpoint: DashboardBreakpoint): Int = breakpoint.columns

    /**
     * The layout array for [breakpoint], falling back to the `lg` array then empty — the web
     * `liveLayouts[activeBreakpoint] ?? liveLayouts.lg ?? []`.
     */
    fun layoutFor(
        layout: DashboardLayout,
        breakpoint: DashboardBreakpoint,
    ): List<WidgetLayoutItem> = layout.layouts[breakpoint] ?: layout.layouts[DashboardBreakpoint.Lg] ?: emptyList()

    /**
     * The live size of [widget] at [breakpoint] — the saved layout item's `(w, h)` when present, else the widget's
     * registry [DashboardWidget.defaultSize]. Mirrors the web `getWidgetSizeLive`.
     */
    fun widgetSize(
        layout: DashboardLayout,
        breakpoint: DashboardBreakpoint,
        widget: DashboardWidget,
    ): WidgetSize {
        val item = layoutFor(layout, breakpoint).firstOrNull { it.i == widget.id }
        return if (item != null) WidgetSize(cols = item.w, rows = item.h) else widget.defaultSize
    }

    /**
     * Recovers the mobile stack order from the saved `xs` [xsLayout] — the web `orderedWidgets`: widgets with a
     * saved position sort by the `y * 10000 + x * 100 + index / 1000` scalar (so equal rows/columns fall back to
     * the layout array order), and widgets without one keep their insertion order at the end (stable sort). An
     * empty [xsLayout] preserves insertion order outright.
     */
    fun orderForMobile(
        widgets: List<DashboardWidget>,
        xsLayout: List<WidgetLayoutItem>,
    ): List<DashboardWidget> {
        if (xsLayout.isEmpty()) return widgets
        val orderById = HashMap<String, Double>(xsLayout.size)
        xsLayout.forEachIndexed { index, item ->
            orderById[item.i] =
                item.y * MOBILE_ORDER_ROW_WEIGHT + item.x * MOBILE_ORDER_COLUMN_WEIGHT + index / MOBILE_ORDER_INDEX_DIVISOR
        }
        // Stable sort: positioned widgets ascend by their scalar; unpositioned ones share the sentinel and keep
        // their insertion order at the end (the web `aOrder !== undefined ? -1 : ...` branch).
        return widgets.sortedBy { orderById[it.id] ?: Double.MAX_VALUE }
    }

    /**
     * Packs [placed] cells into rows whose summed [PlacedWidget.columnSpan] never exceeds [columns] — the native
     * read-only analogue of the web `verticalCompactor` flow. A cell that would overflow the current row starts a
     * new one; each span is clamped to `1..columns` so an over-wide widget still fits.
     */
    fun packRows(
        placed: List<PlacedWidget>,
        columns: Int,
    ): List<WidgetRow> {
        val cols = columns.coerceAtLeast(1)
        val rows = mutableListOf<WidgetRow>()
        var current = mutableListOf<PlacedWidget>()
        var used = 0
        placed.forEach { item ->
            val span = item.columnSpan.coerceIn(1, cols)
            if (current.isNotEmpty() && used + span > cols) {
                rows += WidgetRow(current.toList())
                current = mutableListOf()
                used = 0
            }
            current += item
            used += span
        }
        if (current.isNotEmpty()) rows += WidgetRow(current.toList())
        return rows
    }

    /**
     * Projects [layout] at a measured container [widthDp] into the render-ready [DashboardGridProjectionResult]:
     * resolves the breakpoint + columns, orders the widgets (mobile stack scalar vs saved `(y, x)` reading order),
     * resolves each widget's live size + clamped span, and packs the desktop grid into rows (one cell per row on
     * the mobile stack). An empty widget list projects as [DashboardGridProjectionResult.isEmpty].
     */
    fun project(
        layout: DashboardLayout,
        widthDp: Int,
    ): DashboardGridProjectionResult {
        val breakpoint = breakpointForWidth(widthDp)
        val columns = columnsFor(breakpoint)
        val mobile = breakpoint == DashboardBreakpoint.Xs
        val positionById = layoutFor(layout, breakpoint).associateBy { it.i }
        val ordered = orderWidgets(layout, mobile, positionById)
        val placed =
            ordered.map { widget ->
                val size = widgetSize(layout, breakpoint, widget)
                val position = positionById[widget.id]
                PlacedWidget(
                    widget = widget,
                    size = size,
                    columnSpan = if (mobile) columns else size.cols.coerceIn(1, columns),
                    x = position?.x ?: 0,
                    y = position?.y ?: 0,
                )
            }
        val rows = if (mobile) placed.map { WidgetRow(listOf(it)) } else packRows(placed, columns)
        return DashboardGridProjectionResult(
            breakpoint = breakpoint,
            columns = columns,
            isMobileStack = mobile,
            isEmpty = layout.widgets.isEmpty(),
            rows = rows,
            placedWidgets = placed,
        )
    }

    /** Orders widgets for the active context: the mobile stack scalar, or the saved `(y, x)` reading order. */
    private fun orderWidgets(
        layout: DashboardLayout,
        mobile: Boolean,
        positionById: Map<String, WidgetLayoutItem>,
    ): List<DashboardWidget> {
        if (mobile) {
            return orderForMobile(layout.widgets, layout.layouts[DashboardBreakpoint.Xs].orEmpty())
        }
        return layout.widgets
            .withIndex()
            .sortedWith(
                compareBy(
                    { positionById[it.value.id]?.y ?: Int.MAX_VALUE },
                    { positionById[it.value.id]?.x ?: Int.MAX_VALUE },
                    { it.index },
                ),
            ).map { it.value }
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DashboardGridRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordDashboardGridOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DashboardGridRegistration.SLUG))
}
