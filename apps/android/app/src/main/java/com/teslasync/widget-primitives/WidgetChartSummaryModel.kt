// Pure, framework-free model + layout projection + diagnostics for the WidgetChartSummary widget primitive —
// the native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx) before Compose paints anything. No Compose,
// no Android, no HTTP: every declaration here runs off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a presentational chart
// "summary frame" shared by many dashboard widgets. It takes a list of `stats` ({ label, value: string|number,
// unit? }), an arbitrary `chart` node, and a few display flags. When `isEmpty` it renders the shared
// `EmptyState` with the caller's `emptyIcon` + `emptyMessage` (default literal "No data available"). Otherwise
// it stacks two regions in a full-height flex column: a stat row that renders only when there is at least one
// stat (a 2-column grid that, in NON-compact mode, relaxes to a horizontal flex row once the widget is at least
// the `@sm` container width = 24rem), and — only in NON-compact mode — the `chart` node filling the remaining
// height. It fetches nothing and owns no text of its own beyond that one empty-state default.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive performs no query — it is a layout frame whose data is handed to it fully resolved by the owning
// widget. There is nothing here to be loading, to error, to go stale, or to go offline; the `isEmpty` flag the
// caller passes IS the one data-driven branch the web source has, and it is reproduced exactly. Inventing the
// async states would model a dependency the web spec does not have (honesty covenant: no scope narrowing, no
// silent drift). The surface's REAL, fully-reproduced states are therefore: the empty state, and the populated
// layout permutations (compact / wide × has-stats / no-stats × the stat-row grid↔row breakpoint). Each is
// reduced here by [widgetChartSummaryPlan] / [statRowLayout] and asserted off-device, doubling as the per-state
// snapshot. The owning widget that DOES fetch renders its own data states and drops its resolved values into
// this frame.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling Checkbox / StaggerContainer / SectionErrorBoundary surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetchartsummary

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no stat labels, values, or
 * chart content — only this constant identifier — so a diagnostics line can never leak what was summarised.
 */
const val WIDGET_CHART_SUMMARY_SLUG: String = "WidgetChartSummary"

/**
 * Canonical registry metadata for the WidgetChartSummary surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetChartSummary`).
 */
object WidgetChartSummaryRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its root. */
    const val ID: String = "widget-chart-summary"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_CHART_SUMMARY_SLUG
}

/**
 * One summary statistic — the native mirror of the web `ChartSummaryStat` ({ label, value, unit? }). The web
 * `value` is `string | number`; React coerces a number to its display string, so the canonical native type is a
 * pre-formatted [value] string (unit conversion + locale formatting happen at the caller's display boundary, per
 * the SI cutover rules). The [ChartSummaryStat.of] factory accepts a [Number] for the common numeric call so the
 * `string | number` union is reproduced without leaking formatting concerns into this frame.
 *
 * @param label the muted caption above the value (web `stat.label`).
 * @param value the already-formatted display value (web `stat.value`).
 * @param unit the optional small trailing unit shown after the value (web `stat.unit`).
 */
data class ChartSummaryStat(
    val label: String,
    val value: String,
    val unit: String? = null,
) {
    companion object {
        /** Build a stat from a numeric [value] (web `value: number`); formats via the number's natural string. */
        fun of(
            label: String,
            value: Number,
            unit: String? = null,
        ): ChartSummaryStat = ChartSummaryStat(label = label, value = value.toString(), unit = unit)
    }
}

/**
 * The widget container width (in dp) at which a NON-compact stat row relaxes from the 2-column grid to a single
 * horizontal flex row — the native mirror of the web `@sm` container breakpoint (Tailwind `sm` = 24rem = 384px,
 * 1rem = 16px). A pure Float (no Compose `Dp`) so the breakpoint decision is unit-tested off-device.
 */
const val STAT_ROW_BREAKPOINT_DP: Float = 384f

/**
 * How the stat cells are arranged — the two web layouts the stat row can take. [Grid2Col] is the web
 * `grid grid-cols-2` (the mobile-safe default and the only layout in compact mode); [Row] is the web `@sm:flex`
 * horizontal row used once a NON-compact widget is wide enough to let the values breathe.
 */
enum class StatRowLayout {
    /** Two-column grid (web `grid grid-cols-2 gap-2`) — compact, or a non-compact widget below the breakpoint. */
    Grid2Col,

    /** Horizontal flex row (web `@sm:flex @sm:gap-4`) — a non-compact widget at or above [STAT_ROW_BREAKPOINT_DP]. */
    Row,
}

/**
 * Choose the stat-row layout for a widget of [availableWidthDp] dp wide — pure (no Compose), so the responsive
 * branch the web encodes in `compact ? 'grid' : 'grid ... @sm:flex'` is asserted off-device. [compact] forces the
 * grid regardless of width (the web compact branch has no `@sm:flex`); otherwise the row is chosen once the width
 * reaches [STAT_ROW_BREAKPOINT_DP], matching the web container query.
 */
fun statRowLayout(
    compact: Boolean,
    availableWidthDp: Float,
): StatRowLayout =
    when {
        compact -> StatRowLayout.Grid2Col
        availableWidthDp >= STAT_ROW_BREAKPOINT_DP -> StatRowLayout.Row
        else -> StatRowLayout.Grid2Col
    }

/**
 * Which regions the frame paints — the reduced result of the web component's three render branches. Pure data so
 * the composable stays a thin render layer over it and every permutation is asserted off-device (doubling as the
 * per-state snapshot).
 *
 * @param showEmptyState the web `isEmpty` branch — the shared EmptyState replaces all other content.
 * @param showStats the web `stats.length > 0` guard — the stat row renders only when there is at least one stat.
 * @param showChart the web `!compact` guard — the chart region renders only in non-compact mode (and never empty).
 */
data class WidgetChartSummaryPlan(
    val showEmptyState: Boolean,
    val showStats: Boolean,
    val showChart: Boolean,
) {
    /**
     * True when the frame paints at least one region. False only for the degenerate populated-but-empty case
     * (compact, no stats) — the web renders an empty `flex` column there too, so this surface honestly does the
     * same rather than inventing chrome the spec does not have.
     */
    val rendersAnyRegion: Boolean
        get() = showEmptyState || showStats || showChart
}

/**
 * Reduce the web inputs into the [WidgetChartSummaryPlan] the frame renders — pure, exhaustively covered, and
 * unit-tested off-device. Mirrors the web exactly: `isEmpty` wins and shows only the EmptyState; otherwise the
 * stat row shows when [statCount] > 0 (web `stats.length > 0`) and the chart shows when not [compact] (web
 * `!compact`). A negative [statCount] is clamped so a malformed caller can never flip the stats guard on with no
 * cells.
 */
fun widgetChartSummaryPlan(
    isEmpty: Boolean,
    statCount: Int,
    compact: Boolean,
): WidgetChartSummaryPlan =
    WidgetChartSummaryPlan(
        showEmptyState = isEmpty,
        showStats = !isEmpty && statCount.coerceAtLeast(0) > 0,
        showChart = !isEmpty && !compact,
    )

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no stat labels, no values, no chart content — so observability can never leak what was summarised.
 * Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object WidgetChartSummaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_CHART_SUMMARY_SLUG

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
