// Pure, framework-free model + projection for the `MiniGridPreview` feature view — the native analogue of
// everything the web component derives before it paints its layout thumbnail
// (web/src/features/dashboard/components/MiniGridPreview.tsx). No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is a tiny presentational thumbnail. It receives a `SavedDashboard`, reads ONLY its `lg`
// react-grid-layout (`dashboard.layouts.lg ?? []`) against the four-column `GRID_COLS.lg` grid, derives the grid's
// total row count (`maxY = max(item.y + item.h)`, falling back to 2 for an empty layout and guarding a
// zero/NaN result back to 2 — the `safeMaxY`), and lays the whole frame out at a `cols / safeMaxY` aspect ratio.
// Each saved widget is drawn as a small box positioned by percentage (`x/cols`, `y/safeMaxY`, `w/cols`,
// `h/safeMaxY`) carrying its widget-registry icon centered inside. It fetches nothing and shows no text.
//
// This file owns exactly those pure derivations so the composable can stay declarative: the row-count guard
// ([MiniGridPreviewProjection.safeRows], the web `safeMaxY`), the frame aspect ratio
// ([MiniGridPreviewProjection.aspectRatio]), and the per-widget fractional placement rectangles
// ([MiniGridPreviewProjection.project] → [MiniGridCell], the web absolute `left/top/width/height` percentages).
// Resolving a widget's icon from the registry is a separate surface (out of scope here, exactly as the sibling
// `DashboardGrid` treats it), so each [MiniGridCell] carries only the widget's [MiniGridCell.widgetId] and the
// composable resolves the icon at the render boundary — `null` simply paints an empty box, mirroring the web
// `{Icon && <Icon/>}` guard.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MiniGridPreview — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.minigridpreview

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/** The fixed column count the thumbnail is drawn against — the web `GRID_COLS.lg` (4). */
const val MINI_GRID_COLUMNS: Int = 4

/** The row count an empty / degenerate layout falls back to — the web `maxY` default and `safeMaxY` guard (2). */
const val MINI_GRID_DEFAULT_ROWS: Int = 2

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object MiniGridPreviewRegistration {
    /** Stable surface id. */
    const val ID: String = "mini-grid-preview"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MiniGridPreview"
}

/**
 * One widget instance the thumbnail can place — the native mirror of the web `WidgetInstance` subset the preview
 * reads. [id] is the layout key (matched against a [MiniGridLayoutItem.i]) and [widgetId] the registry id the
 * composable resolves to an icon (the web `getWidgetDef(widget.widgetId)?.icon`).
 */
data class MiniGridWidget(
    val id: String,
    val widgetId: String,
)

/**
 * One react-grid-layout item — the native mirror of the web `RGLLayout` (`{ i, x, y, w, h }`). [i] is the widget
 * instance id, ([x], [y]) its grid origin (columns from the left, rows from the top) and ([w], [h]) its span.
 */
data class MiniGridLayoutItem(
    val i: String,
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
)

/**
 * The saved dashboard the thumbnail previews — the native mirror of the web `SavedDashboard` subset the component
 * touches. [widgets] is the instance list and [lgLayout] the `lg`-breakpoint positions (`dashboard.layouts.lg`),
 * the only layout the preview ever reads. Both default to empty so the empty thumbnail is expressible without a
 * payload.
 */
data class MiniGridDashboard(
    val widgets: List<MiniGridWidget> = emptyList(),
    val lgLayout: List<MiniGridLayoutItem> = emptyList(),
)

/**
 * One placed widget box, resolved to a render-ready fractional rectangle (no Compose types). [key] is the layout
 * key, [widgetId] the registry id the composable resolves to an icon (`null` when no widget matches the layout
 * item — the web `find` miss that paints an empty box), and the four fractions are the web absolute
 * `left/top/width/height` percentages expressed in the `0f..1f` range so the composable multiplies them by the
 * measured container size.
 */
data class MiniGridCell(
    val key: String,
    val widgetId: String?,
    val leftFraction: Float,
    val topFraction: Float,
    val widthFraction: Float,
    val heightFraction: Float,
)

/**
 * The fully projected, render-ready thumbnail — pure data so the projection is unit-tested without a UI host. The
 * composable lays out the frame at [aspectRatio] (`[columns] / [rows]`, the web `cols / safeMaxY`), positions each
 * [MiniGridCell], and reads [isEmpty] to know whether the layout had no widgets (the web empty frame). [columns] is
 * always [MINI_GRID_COLUMNS] and [rows] the guarded row count.
 */
data class MiniGridPreviewProjectionResult(
    val columns: Int,
    val rows: Int,
    val aspectRatio: Float,
    val cells: List<MiniGridCell>,
    val isEmpty: Boolean,
)

/** The mutually-exclusive surface the composable renders — the per-state switch the lifecycle wrapper drives. */
enum class MiniGridPreviewSurface {
    /** A first load is in flight with nothing cached — render a skeleton thumbnail. */
    Loading,

    /** A hard failure with nothing cached — render an error thumbnail with retry. */
    Error,

    /** The feed resolved to no dashboard at all — render a friendly empty state. */
    Empty,

    /** A dashboard is available — render the thumbnail (an empty `lg` layout still draws the empty frame). */
    Content,
}

/**
 * The pure projection the composable renders — the native mirror of the data the web thumbnail derives from its
 * `SavedDashboard`. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object MiniGridPreviewProjection {
    /**
     * The total row count the layout spans — the web `maxY`: `max(item.y + item.h)` over the `lg` layout, or
     * [MINI_GRID_DEFAULT_ROWS] when the layout is empty.
     */
    fun maxRow(lgLayout: List<MiniGridLayoutItem>): Int = if (lgLayout.isEmpty()) MINI_GRID_DEFAULT_ROWS else lgLayout.maxOf { it.y + it.h }

    /**
     * The guarded row count used for layout — the web `safeMaxY`: the [maxRow] when it is strictly positive, else
     * [MINI_GRID_DEFAULT_ROWS]. (The web also guards `Number.isFinite`; an `Int` row count is always finite, so the
     * positive guard alone reproduces it.)
     */
    fun safeRows(lgLayout: List<MiniGridLayoutItem>): Int {
        val max = maxRow(lgLayout)
        return if (max > 0) max else MINI_GRID_DEFAULT_ROWS
    }

    /** The frame aspect ratio (width / height) — the web `${cols} / ${safeMaxY}`. */
    fun aspectRatio(rows: Int): Float = MINI_GRID_COLUMNS.toFloat() / rows.coerceAtLeast(1)

    /**
     * Projects [dashboard] into the render-ready [MiniGridPreviewProjectionResult]: guards the row count, computes
     * the frame aspect ratio, and maps each `lg` layout item to its fractional placement rectangle, resolving the
     * owning widget's id with first-match semantics (the web `find`). An empty `lg` layout projects with no cells
     * and [MiniGridPreviewProjectionResult.isEmpty] set, so the composable can draw the web empty frame.
     */
    fun project(dashboard: MiniGridDashboard): MiniGridPreviewProjectionResult {
        val rows = safeRows(dashboard.lgLayout)
        val columns = MINI_GRID_COLUMNS
        val cells =
            dashboard.lgLayout.map { item ->
                MiniGridCell(
                    key = item.i,
                    widgetId = dashboard.widgets.firstOrNull { it.id == item.i }?.widgetId,
                    leftFraction = item.x.toFloat() / columns,
                    topFraction = item.y.toFloat() / rows,
                    widthFraction = item.w.toFloat() / columns,
                    heightFraction = item.h.toFloat() / rows,
                )
            }
        return MiniGridPreviewProjectionResult(
            columns = columns,
            rows = rows,
            aspectRatio = columns.toFloat() / rows,
            cells = cells,
            isEmpty = dashboard.lgLayout.isEmpty(),
        )
    }

    /**
     * The web-parity [UiState] for a ready [dashboard]: always [UiPhase.Content]. Unlike a data-backed surface, an
     * empty `lg` layout is NOT promoted to [UiPhase.Empty] — the web thumbnail draws the empty frame rather than a
     * "nothing here" message, so the composable's friendly empty state is reserved for the host-feed "no dashboard"
     * case ([UiPhase.Empty]) the stateful overload carries.
     */
    fun contentState(dashboard: MiniGridDashboard): UiState<MiniGridDashboard> = UiState(phase = UiPhase.Content, data = dashboard)
}

/**
 * Classifies a saved-dashboard feed [state] into the one [MiniGridPreviewSurface] the composable renders. A
 * stale/offline value kept over cached [UiState.data] stays [MiniGridPreviewSurface.Content] (the thumbnail is
 * shown with a freshness chip), matching the honest "last known + retry" contract of the sibling surfaces.
 */
fun miniGridPreviewSurface(state: UiState<MiniGridDashboard>): MiniGridPreviewSurface =
    when {
        state.isLoading -> MiniGridPreviewSurface.Loading
        state.isError -> MiniGridPreviewSurface.Error
        state.isEmpty -> MiniGridPreviewSurface.Empty
        else -> MiniGridPreviewSurface.Content
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [MiniGridPreviewRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordMiniGridPreviewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MiniGridPreviewRegistration.SLUG))
}
