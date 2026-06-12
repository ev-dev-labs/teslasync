// The native Jetpack Compose + Material 3 LoadingSkeleton feature view — a parity port of
// web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx. The web component is a
// purely presentational loading scaffold: a `space-y-6` stack of shimmering bars shaped like the
// charging-curve page it stands in for (a header, a filter row, a six-tile stat grid, two chart
// panels, a two-up panel row, and a four-tile stat grid). It binds NO data and reads NO i18n.
//
// Because the surface has zero data sources there is no loading / empty / error / stale / offline
// lifecycle to branch on — the scaffold IS the loading affordance, with a single, unconditional
// render path (see LoadingSkeletonModel for the drift rationale). What it owns is reproduced here in
// full: the exact bar geometry ([LOADING_SKELETON_SPEC]), the responsive grid column counts (the web
// `grid-cols-*` breakpoints), and — native-only, since a loading region must be reachable by TalkBack
// — a single merged accessibility announcement over the whole scaffold.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LoadingSkeleton — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path — exactly as the sibling
// ToolCard surface does. `MatchingDeclarationName` is suppressed for the co-located composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.loadingskeleton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the LoadingSkeleton scaffold. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the accessibility announcement from the i18n catalog (P1/S10), and
 * renders the presentational scaffold. The surface binds no data of its own.
 *
 * @param modifier layout modifier applied to the scaffold's root column.
 * @param spec the bar composition to render; defaults to the web-parity projection.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LoadingSkeleton(
    modifier: Modifier = Modifier,
    spec: LoadingSkeletonSpec = LoadingSkeletonProjection.webParity,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to LoadingSkeletonRegistration.SLUG))
    }
    LoadingSkeletonContent(
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        modifier = modifier,
        spec = spec,
    )
}

/**
 * Stateless renderer — the unit-test and preview entry point. Reproduces the web component's layout
 * exactly: a `space-y-6` column (native `Spacing.xl2`) of the header, filter row, six-tile stat grid,
 * the two chart panels, the two-up split, and the four-tile stat grid. The whole scaffold is merged
 * into one semantics node carrying [loadingLabel] so TalkBack announces "Loading" once instead of
 * walking every decorative shimmer bar.
 */
@Composable
fun LoadingSkeletonContent(
    loadingLabel: String,
    modifier: Modifier = Modifier,
    spec: LoadingSkeletonSpec = LoadingSkeletonProjection.webParity,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        SkeletonHeader(spec.header)
        SkeletonFilters(spec.filters)
        SkeletonStatGrid(spec.topStats)
        spec.chartPanels.forEach { SkeletonChartPanel(it) }
        SkeletonSplitPanels(spec.splitPanels)
        SkeletonStatGrid(spec.bottomStats)
    }
}

/** Header region — web `space-y-2` stack of the title + subtitle bars (native `Spacing.sm`). */
@Composable
private fun SkeletonHeader(bars: List<SkeletonBar>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        bars.forEach { ShimmerBar(it) }
    }
}

/**
 * Filter region — web `flex gap-4` row of fixed-width control bars. Rendered with [FlowRow] so the
 * fixed-width bars wrap gracefully on a compact phone instead of overflowing, while on wider windows
 * they sit on one row exactly like the web flex layout.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkeletonFilters(bars: List<SkeletonBar>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        bars.forEach { ShimmerBar(it) }
    }
}

/**
 * A responsive stat grid — web `grid-cols-2 …` of `GlassPanel p-4` tiles, each a label bar above a
 * value bar (web `mt-2`, native `Spacing.sm`). Cells are spaced by `Spacing.lg` (web `gap-4`).
 */
@Composable
private fun SkeletonStatGrid(spec: SkeletonStatGridSpec) {
    SkeletonResponsiveGrid(
        itemCount = spec.count,
        columns = spec.columns,
        horizontalGap = Spacing.lg,
        verticalGap = Spacing.lg,
    ) {
        GlassPanel(modifier = Modifier.weight(1f), padding = PanelPadding.Lg) {
            ShimmerBar(spec.tile.label)
            Spacer(modifier = Modifier.height(Spacing.sm))
            ShimmerBar(spec.tile.value)
        }
    }
}

/**
 * A single chart panel — web `GlassPanel p-6` with a title bar above a full-width block (web `mt-4`,
 * native `Spacing.lg`). `p-6` maps to an explicit `Spacing.xl2` inset (the `PanelPadding` scale tops
 * out at `Lg`), so the panel uses `PanelPadding.None` and pads its content column directly.
 */
@Composable
private fun SkeletonChartPanel(
    spec: SkeletonChartPanelSpec,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            ShimmerBar(spec.title)
            ShimmerBar(SkeletonBar(heightDp = spec.blockHeightDp))
        }
    }
}

/** The two-up split region — web `grid-cols-1 lg:grid-cols-2 gap-6` of identical chart panels. */
@Composable
private fun SkeletonSplitPanels(spec: SkeletonSplitSpec) {
    SkeletonResponsiveGrid(
        itemCount = spec.count,
        columns = spec.columns,
        horizontalGap = Spacing.xl2,
        verticalGap = Spacing.xl2,
    ) {
        SkeletonChartPanel(spec.panel, modifier = Modifier.weight(1f))
    }
}

/**
 * A responsive grid of [itemCount] equal-width cells — the native analogue of a web `grid-cols-*`.
 * The column count tracks the available width via [LoadingSkeletonProjection.columnsFor]; the
 * trailing cells of a short final row are filled with weighted spacers so every cell keeps a uniform
 * width. [cell] runs in a [RowScope] and applies `Modifier.weight(1f)` to its content.
 */
@Composable
private fun SkeletonResponsiveGrid(
    itemCount: Int,
    columns: GridColumns,
    horizontalGap: Dp,
    verticalGap: Dp,
    cell: @Composable RowScope.(Int) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columnCount = LoadingSkeletonProjection.columnsFor(maxWidth.value, columns)
        val rowCount = (itemCount + columnCount - 1) / columnCount
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(verticalGap),
        ) {
            for (rowIndex in 0 until rowCount) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(horizontalGap),
                ) {
                    for (column in 0 until columnCount) {
                        val index = rowIndex * columnCount + column
                        if (index < itemCount) cell(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Renders one [bar] via the shared [Skeleton] primitive: a fixed [SkeletonBar.widthDp] dp width when
 * set (the web `w-*` bars), otherwise filling the parent width (the web `w-full` blocks). The shared
 * primitive owns the shimmer animation and the neutral fill colour.
 */
@Composable
private fun ShimmerBar(
    bar: SkeletonBar,
    modifier: Modifier = Modifier,
) {
    val sized = if (bar.widthDp != null) modifier.width(bar.widthDp.dp) else modifier
    Skeleton(modifier = sized, height = bar.heightDp.dp)
}

@Preview(showBackground = true)
@Composable
private fun LoadingSkeletonPreview() {
    TeslaSyncTheme {
        LoadingSkeletonContent(loadingLabel = stringResource(R.string.translation_a11y_loading))
    }
}
