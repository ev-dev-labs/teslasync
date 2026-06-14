// Pure, framework-free model + layout projection + diagnostics for the WidgetStatusGrid widget primitive — the
// native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx) before Compose paints anything. No Compose,
// no Android, no HTTP: every declaration here runs off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a presentational status
// "tile grid" shared by many dashboard widgets. It takes a list of cells ({ id, label, status, value?, icon? }),
// a `cols` count (2 | 3 | 4), and a `compact` flag. When the cell list is empty it renders the shared
// `EmptyState` with the caller's `emptyIcon` + `emptyMessage` (default "No status data available"). Otherwise it
// lays the cells into a container-query grid: `cols = 2` is always two columns; `cols = 3` collapses to one
// column, relaxing to two at the `@xs` container width (20rem) and three at `@sm` (24rem); `cols = 4` is two
// columns, relaxing to four at `@sm`. `compact` forces the two-column layout. Each cell paints a tone-tinted,
// bordered tile with a corner status dot, an optional leading icon, a truncating label, and — only when NOT
// compact — the value. It fetches nothing and owns no text of its own beyond that one empty-state default.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive performs no query — it is a layout frame whose cells are handed to it fully resolved by the owning
// widget. There is nothing here to be loading, to error, to go stale, or to go offline; the empty-list check the
// caller's data drives IS the one data-driven branch the web source has, and it is reproduced exactly. Inventing
// the async states would model a dependency the web spec does not have (honesty covenant: no scope narrowing, no
// silent drift). The surface's REAL, fully-reproduced states are therefore: the empty state, and the populated
// layout permutations (compact / wide × the 2/3/4 column counts × the container-query grid collapse). Each is
// reduced here by [widgetStatusGridPlan] / [resolveColumns] / [statusGridColumns] and asserted off-device,
// doubling as the per-state snapshot. The owning widget that DOES fetch renders its own data states and drops its
// resolved cells into this grid.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling WidgetChartSummary / WidgetBigNumber surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetstatusgrid

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no cell labels, values, or
 * statuses — only this constant identifier — so a diagnostics line can never leak what was shown.
 */
const val WIDGET_STATUS_GRID_SLUG: String = "WidgetStatusGrid"

/**
 * Canonical registry metadata for the WidgetStatusGrid surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetStatusGrid`).
 */
object WidgetStatusGridRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its root. */
    const val ID: String = "widget-status-grid"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_STATUS_GRID_SLUG
}

/**
 * The semantic state of one status cell — the native mirror of the web
 * `status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown'` union. Kept framework-free so the value branches
 * are unit-tested off-device; the composable maps each case onto the per-theme [io.teslasync.android.ui.theme]
 * status tokens (web `statusStyles`, where `inactive` and `unknown` share the muted neutral styling).
 */
enum class StatusTone {
    /** Web `ok` — the emerald (`status.success`) healthy tone. */
    Ok,

    /** Web `warning` — the amber (`status.warning`) caution tone. */
    Warning,

    /** Web `error` — the red (`status.danger`) failure tone. */
    Error,

    /** Web `inactive` — the muted neutral tone (web `bg-white/[0.03]` + `surface-2` dot). */
    Inactive,

    /** Web `unknown` — the muted neutral tone, identical to [Inactive] in the web `statusStyles`. */
    Unknown,
}

/**
 * The container widths (in dp) at which the responsive grid adds columns — the native mirror of the web Tailwind
 * container-query breakpoints used in `containerColsClass` (`@xs` = 20rem = 320px, `@sm` = 24rem = 384px, at
 * 1rem = 16px). Pure Floats (no Compose `Dp`) so the breakpoint decisions are unit-tested off-device.
 */
const val CONTAINER_XS_DP: Float = 320f

/** The `@sm` container-query width (24rem = 384px) — see [CONTAINER_XS_DP]. */
const val CONTAINER_SM_DP: Float = 384f

/** The default column count when the caller passes none / an out-of-range value (web `cols = 2`). */
const val DEFAULT_COLUMNS: Int = 2

/**
 * Resolve the configured column count the web component feeds into `containerColsClass` — the native mirror of
 * `const resolvedCols = compact ? 2 : cols`. [compact] forces two columns; otherwise a [cols] of 3 or 4 is
 * honored and anything else is clamped to the web default of [DEFAULT_COLUMNS], so a malformed caller can never
 * select a column track the web type (`2 | 3 | 4`) does not allow.
 */
fun resolveColumns(
    cols: Int,
    compact: Boolean,
): Int =
    when {
        compact -> DEFAULT_COLUMNS
        cols == 3 -> 3
        cols == 4 -> 4
        else -> DEFAULT_COLUMNS
    }

/**
 * Choose how many columns actually render for a grid configured for [resolvedCols] tracks at [availableWidthDp]
 * dp wide — pure (no Compose), so the responsive collapse the web encodes in `containerColsClass` is asserted
 * off-device. Mirrors the web exactly:
 *  - 2 tracks → always 2 (web `grid-cols-2`, no container query).
 *  - 3 tracks → 1 below [CONTAINER_XS_DP], 2 at/above it, 3 at/above [CONTAINER_SM_DP]
 *    (web `grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`).
 *  - 4 tracks → 2 below [CONTAINER_SM_DP], 4 at/above it (web `grid-cols-2 @sm:grid-cols-4`).
 *
 * Any other [resolvedCols] (it is always [resolveColumns]'s output in practice) falls back to the web default of
 * [DEFAULT_COLUMNS] columns.
 */
fun statusGridColumns(
    resolvedCols: Int,
    availableWidthDp: Float,
): Int =
    when (resolvedCols) {
        3 ->
            when {
                availableWidthDp >= CONTAINER_SM_DP -> 3
                availableWidthDp >= CONTAINER_XS_DP -> 2
                else -> 1
            }

        4 -> if (availableWidthDp >= CONTAINER_SM_DP) 4 else DEFAULT_COLUMNS
        else -> DEFAULT_COLUMNS
    }

/**
 * Which region the grid paints — the reduced result of the web component's two render branches (the empty-list
 * early return vs. the populated grid). Pure data so the composable stays a thin render layer over it and both
 * permutations are asserted off-device (doubling as the per-state snapshot).
 *
 * @param showEmptyState the web `cells.length === 0` branch — the shared EmptyState replaces the grid.
 * @param cellCount the number of cells the grid will render (clamped non-negative); 0 when [showEmptyState].
 */
data class WidgetStatusGridPlan(
    val showEmptyState: Boolean,
    val cellCount: Int,
) {
    /** True when the populated grid renders (web: the non-empty branch). The inverse of [showEmptyState]. */
    val showGrid: Boolean
        get() = !showEmptyState
}

/**
 * Reduce the cell count into the [WidgetStatusGridPlan] the grid renders — pure and unit-tested off-device.
 * Mirrors the web exactly: an empty cell list shows only the EmptyState (web `if (cells.length === 0)`), any
 * cells show the grid. A negative [cellCount] is clamped so a malformed caller is treated as empty rather than
 * flipping the grid on with no cells.
 */
fun widgetStatusGridPlan(cellCount: Int): WidgetStatusGridPlan {
    val safeCount = cellCount.coerceAtLeast(0)
    return WidgetStatusGridPlan(showEmptyState = safeCount == 0, cellCount = safeCount)
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no cell labels, no values, no statuses — so observability can never leak what was shown. Kept free of
 * Compose so it is unit-tested with a recording [Logger].
 */
object WidgetStatusGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_STATUS_GRID_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
