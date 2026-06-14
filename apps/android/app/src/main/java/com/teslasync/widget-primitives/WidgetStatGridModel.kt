// Pure, framework-free model + layout projection + diagnostics for the WidgetStatGrid widget primitive — the
// native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx) before Compose paints anything. No Compose, no
// Android, no HTTP: every declaration here runs off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a presentational grid of
// KPI tiles shared by many dashboard widgets. It takes a list of `stats` ({ label, value: string|number, unit?,
// icon?, trend?, trendValue?, valueColor? }) plus two layout flags (`compact`, `cols`). When the list is empty it
// renders the shared `EmptyState` with the literal "No stats available". Otherwise it resolves a target column
// count — `compact ? 1 : (cols ?? autoCols(count))`, where `autoCols` returns 3 when the count is a multiple of 3,
// 4 when a multiple of 4, else 2 — and lays the tiles out in a CSS grid whose ACTUAL column count collapses on
// narrow widgets via container queries keyed to the widget's own rendered width (not the viewport). Each tile is a
// `StatCard`; `valueColor` is passed as the card `className`, which (because the value is the only un-coloured text
// in StatCard) tints just the value.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this primitive
// performs no query — it is a layout frame whose data is handed to it fully resolved by the owning widget. There is
// nothing here to be loading, to error, to go stale, or to go offline; the empty-list branch the caller produces IS
// the one data-driven branch the web source has, and it is reproduced exactly. Inventing the async states would
// model a dependency the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The
// surface's REAL, fully-reproduced states are therefore: the empty state, and the populated layout permutations
// (compact / wide × the 1/2/3/4 column targets × the container-query column collapse × per-tile unit/icon/trend/
// valueColor). Each is reduced here by the pure projections below and asserted off-device, doubling as the
// per-state snapshot. The owning widget that DOES fetch renders its own data states and drops its resolved values
// into this frame.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as the
// sibling WidgetChartSummary / WidgetBigNumber surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetstatgrid

import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no stat labels, values, or unit
 * text — only this constant identifier — so a diagnostics line can never leak what was shown.
 */
const val WIDGET_STAT_GRID_SLUG: String = "WidgetStatGrid"

/**
 * Canonical registry metadata for the WidgetStatGrid surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetStatGrid`).
 */
object WidgetStatGridRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its root. */
    const val ID: String = "widget-stat-grid"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_STAT_GRID_SLUG
}

/**
 * The widget container width (in dp) at which a 3- or 4-up grid gains another column — the native mirror of the
 * web `@sm` container breakpoint (Tailwind `sm` = 24rem = 384px, 1rem = 16px). Matches the sibling
 * WidgetChartSummary's breakpoint. A pure Float (no Compose `Dp`) so the decision is unit-tested off-device.
 */
const val STAT_GRID_SM_BREAKPOINT_DP: Float = 384f

/**
 * The widget container width (in dp) at which a 3-up grid relaxes from 1 column to 2 — the native mirror of the web
 * `@xs` container breakpoint. The `@tailwindcss/container-queries` plugin default for `@xs` is 20rem = 320px, and
 * tailwind.config.js registers that plugin without customizing container sizes, so 320px is the width that actually
 * renders (the web source's "~16rem" comment is approximate). A pure Float so the decision is unit-tested off-device.
 */
const val STAT_GRID_XS_BREAKPOINT_DP: Float = 320f

/**
 * Resolve the auto column target for [statCount] tiles — the web `autoCols`: 3 when the count is a multiple of 3,
 * 4 when a multiple of 4 (checked after 3), else 2. Only ever called for a non-empty grid (the empty list short-
 * circuits to the empty state before this is reached), but it stays total for a malformed caller.
 */
fun autoCols(statCount: Int): Int =
    when {
        statCount % 3 == 0 -> 3
        statCount % 4 == 0 -> 4
        else -> 2
    }

/**
 * Resolve the TARGET column count — the web `compact ? 1 : (cols ?? autoCols(count))`. [compact] forces a single
 * column; otherwise an explicit [cols] (web `2 | 3 | 4`) wins, falling back to [autoCols] of [statCount]. The result
 * is the width-independent target; [gridColumnCount] then applies the container-query collapse for a given width.
 */
fun resolveStatGridColumns(
    compact: Boolean,
    cols: Int?,
    statCount: Int,
): Int =
    when {
        compact -> 1
        cols != null -> cols
        else -> autoCols(statCount)
    }

/**
 * The ACTUAL number of columns a grid of [resolvedCols] target columns renders at [availableWidthDp] dp wide —
 * pure (no Compose), so the container-query collapse the web encodes in `containerColsClass` is asserted off-device.
 * Mirrors the web table exactly:
 *  - 1 → always 1 (`grid-cols-1`)
 *  - 2 → always 2 (`grid-cols-2`, never collapses below 2)
 *  - 3 → 3 at/above @sm, 2 at/above @xs, else 1 (`grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3`)
 *  - 4 → 4 at/above @sm, else 2 (`grid-cols-2 @sm:grid-cols-4`)
 * Any out-of-range [resolvedCols] (never produced by [resolveStatGridColumns]) falls back to the 2-column baseline.
 */
fun gridColumnCount(
    resolvedCols: Int,
    availableWidthDp: Float,
): Int =
    when (resolvedCols) {
        1 -> 1
        2 -> 2
        3 ->
            when {
                availableWidthDp >= STAT_GRID_SM_BREAKPOINT_DP -> 3
                availableWidthDp >= STAT_GRID_XS_BREAKPOINT_DP -> 2
                else -> 1
            }
        4 -> if (availableWidthDp >= STAT_GRID_SM_BREAKPOINT_DP) 4 else 2
        else -> 2
    }

/**
 * Combine a tile's [direction] + pre-formatted [trendValue] into the shared [StatTrend] chip — the native mirror of
 * the web `stat.trend && stat.trendValue ? { direction, value, positive: trend === 'up' } : undefined`. Returns null
 * (no chip) unless BOTH are present, matching the web guard. `positive` is true only for an up arrow, so the shared
 * StatCard trend tone resolves to green for up, red for down, and muted for flat — exactly the web colouring.
 */
fun statGridTrend(
    direction: DeltaArrow?,
    trendValue: String?,
): StatTrend? {
    if (direction == null || trendValue == null) return null
    return StatTrend(direction = direction, text = trendValue, positive = direction == DeltaArrow.Up)
}

/**
 * Which branch the frame paints — the reduced result of the web component's two render paths. Pure data so the
 * composable stays a thin render layer over it and every permutation is asserted off-device (doubling as the
 * per-state snapshot).
 *
 * @param showEmptyState the web `stats.length === 0` branch — the shared EmptyState replaces the grid.
 * @param resolvedCols the web `resolvedCols` target column count (only meaningful when [showEmptyState] is false).
 */
data class WidgetStatGridPlan(
    val showEmptyState: Boolean,
    val resolvedCols: Int,
) {
    /** True when the populated grid renders (i.e. not the empty state). */
    val showGrid: Boolean
        get() = !showEmptyState
}

/**
 * Reduce the web inputs into the [WidgetStatGridPlan] the frame renders — pure, exhaustively covered, and unit-tested
 * off-device. Mirrors the web exactly: an empty (or malformed-negative) [statCount] shows only the EmptyState;
 * otherwise the grid shows with the resolved target column count. [resolvedCols] is still computed in the empty case
 * (so the data class stays total) but is not rendered then, mirroring the web early-return.
 */
fun widgetStatGridPlan(
    statCount: Int,
    compact: Boolean,
    cols: Int?,
): WidgetStatGridPlan {
    val count = statCount.coerceAtLeast(0)
    return WidgetStatGridPlan(
        showEmptyState = count == 0,
        resolvedCols = resolveStatGridColumns(compact = compact, cols = cols, statCount = count),
    )
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no stat labels, values, or unit text — so observability can never leak what was shown. Kept free of
 * Compose so it is unit-tested with a recording [Logger].
 */
object WidgetStatGridDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_STAT_GRID_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
