// Pure, framework-free model + projection + diagnostics for the KpiOverviewCard shared surface — the native
// analogue of every value the web component composes (web/src/components/data-display/KpiOverviewCard.tsx). No
// Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a PRESENTATIONAL section card, not a data-fetching view: it composes a ComparisonHeader, a
// responsive grid of caller-supplied KPI tiles, an optional muted secondary line, and an optional footer slot.
// It owns no `useQuery`/hook of its own — the page computes the values and hands them in. Because there is no
// async cache-then-network feed behind it, the surface has no loading / error / stale / offline lifecycle of
// its own — modelling those would fabricate behaviour the web spec does not have (the same rationale the
// accepted Avatar / VisuallyHidden ports document). The surface's REAL states are reproduced instead and every
// one renders (no hidden surface): the content state (one or more tiles), the empty state (no tiles → a
// friendly empty region, never a blank box), and the optional secondary / footer regions present or absent.
//
// The web card is anonymous: it resolves no static i18n strings itself (every label is caller-supplied), so the
// model carries no English copy. The one piece of real logic — the responsive column count mirroring the web
// `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` template — lives in [kpiColumnsForWidth] so it is pinned by an
// off-device test. The merged TalkBack summary the view exposes is built by [kpiOverviewAccessibilityLabel], a
// pure function so the accessibility label is unit-tested without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/KpiOverviewCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the one-shot `view.opened` event (P1/S11). It is the surface slug the
 * prompt mandates (`KpiOverviewCard`) and carries no caller data, so a diagnostics line can never leak which
 * overview a card was rendering.
 */
const val KPI_OVERVIEW_CARD_SLUG: String = "KpiOverviewCard"

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** KPI columns on a compact window (`< 600dp`) — the web `grid-cols-2` base. */
const val KPI_COLUMNS_COMPACT: Int = 2

/** KPI columns on a medium window (`600..839dp`) — the web `sm:grid-cols-3` breakpoint. */
const val KPI_COLUMNS_MEDIUM: Int = 3

/** KPI columns on an expanded window (`>= 840dp`) — the web `lg:grid-cols-6` breakpoint. */
const val KPI_COLUMNS_EXPANDED: Int = 6

private const val MEDIUM_WIDTH_DP: Int = 600
private const val EXPANDED_WIDTH_DP: Int = 840
private const val INTERPUNCT: String = "\u00b7"

/**
 * Resolves the responsive KPI column count for an available [widthDp], reproducing the web
 * `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` template on the Material 3 window-width breakpoints: two columns
 * on a compact phone window, three on a medium window, six on an expanded (tablet / unfolded) window. Pure so
 * the breakpoint mapping is pinned off-device; the view passes the live container width.
 */
fun kpiColumnsForWidth(widthDp: Int): Int =
    when {
        widthDp >= EXPANDED_WIDTH_DP -> KPI_COLUMNS_EXPANDED
        widthDp >= MEDIUM_WIDTH_DP -> KPI_COLUMNS_MEDIUM
        else -> KPI_COLUMNS_COMPACT
    }

/**
 * The header model the card renders through a `ComparisonHeader` — the native analogue of the web
 * `ComparisonHeaderProps` the card forwards. The page passes already-formatted period labels (date / unit
 * formatting is the page's job); [comparisonLabel] is omitted when the card shows a single period.
 */
data class KpiHeaderModel(
    val title: String,
    val currentLabel: String,
    val comparisonLabel: String? = null,
)

/**
 * The direction-aware change a tile shows beneath its value — the native analogue of the `Delta` a web
 * `MetricCard` receives. [current] / [previous] are the already-resolved values (display conversion is the
 * page's job); [metricKey] selects the good-direction semantics (e.g. `range`, `cost`); [unitSuffix] is the
 * resolved unit shown after the change.
 */
data class KpiTileDelta(
    val current: Double,
    val previous: Double,
    val metricKey: String,
    val unitSuffix: String = "",
)

/**
 * One KPI tile the card lays out in its grid — the native analogue of a web `MetricCard`. [value] is the
 * already-formatted display string; [subtitle] is an optional muted line; [delta] is the optional change chip.
 */
data class KpiTile(
    val label: String,
    val value: String,
    val subtitle: String? = null,
    val delta: KpiTileDelta? = null,
)

/**
 * The render-ready projection the surface's state holder streams: the [header], the [tiles] the grid lays out,
 * and the optional muted [secondary] summary line. The footer is a composable slot owned by the view, not data,
 * so it is not modelled here (the web `footer` is a `ReactNode`). [EMPTY] is the zero value the holder starts
 * from until the seam emits — an anonymous header with no tiles, which renders the empty state.
 */
data class KpiOverviewData(
    val header: KpiHeaderModel,
    val tiles: List<KpiTile>,
    val secondary: String? = null,
) {
    companion object {
        /** The initial, content-free projection: an anonymous header and no tiles (renders the empty state). */
        val EMPTY: KpiOverviewData = KpiOverviewData(KpiHeaderModel(title = "", currentLabel = ""), emptyList())
    }
}

/** Whether the overview has any KPI tiles to lay out; `false` routes the view to its empty state. */
fun hasKpiTiles(data: KpiOverviewData): Boolean = data.tiles.isNotEmpty()

/**
 * The period strip the header shows — the current label, joined with the comparison label by an interpunct when
 * a comparison is present (web `ComparisonHeader` `current · prior`).
 */
fun kpiPeriodLabel(header: KpiHeaderModel): String =
    if (header.comparisonLabel != null) {
        "${header.currentLabel} $INTERPUNCT ${header.comparisonLabel}"
    } else {
        header.currentLabel
    }

/**
 * The merged accessible summary a TalkBack user hears for the whole card: the title, the period strip, each
 * tile as "label value", and the secondary line, joined into one announcement so the overview reads as a single
 * unit. Kept pure so the accessibility label is unit-tested without a Compose host; built only from
 * caller-supplied display strings, so it carries no extra data a field could leak.
 */
fun kpiOverviewAccessibilityLabel(data: KpiOverviewData): String {
    val parts = mutableListOf<String>()
    if (data.header.title.isNotEmpty()) parts += data.header.title
    val period = kpiPeriodLabel(data.header)
    if (period.isNotEmpty()) parts += period
    if (data.tiles.isNotEmpty()) {
        parts += data.tiles.joinToString(", ") { "${it.label} ${it.value}" }
    }
    if (!data.secondary.isNullOrEmpty()) parts += data.secondary
    return parts.joinToString(", ")
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [KPI_OVERVIEW_CARD_SLUG] (P1/S11) —
 * never any caller value, so a diagnostics line can never leak what an overview showed. Kept free of Compose so
 * it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordKpiOverviewCardOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to KPI_OVERVIEW_CARD_SLUG))
}
