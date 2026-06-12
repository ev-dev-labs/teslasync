// The native Jetpack Compose + Material 3 StatusPageSkeleton feature view — a parity port of
// web/src/features/system/components/status/StatusPageSkeleton.tsx. The web component is a purely
// presentational loading scaffold returned while the System Status page makes its first fetch: a
// `space-y-5 max-w-3xl mx-auto` stack shaped like that page (a hero, a chip bar, a six-row health
// panel, an action-items panel, a resources panel, and four collapsed accordion rows) so there is no
// layout shift once the real data mounts.
//
// Because the surface has zero data sources there is no loading / empty / error / stale / offline
// lifecycle to branch on — the scaffold IS the loading affordance, with a single, unconditional
// render path (see StatusPageSkeletonModel for the drift rationale). What it owns is reproduced here
// in full: the exact bar geometry ([STATUS_PAGE_SKELETON_SPEC]), the centered max-width column (the
// web `max-w-3xl mx-auto`), the clipped chip overflow (the web `overflow-hidden`), and — native-only,
// since a loading region must be reachable by TalkBack — a single merged accessibility announcement
// over the whole scaffold. The shimmer pulse and reduce-motion handling are owned by the shared
// [Skeleton] primitive, exactly as the web source delegates them to its shared `<Skeleton>`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatusPageSkeleton — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package, so the package intentionally diverges from the path — exactly as the
// sibling LoadingSkeleton surface does. `MatchingDeclarationName` is suppressed for the co-located
// composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statuspageskeleton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
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
 * Stateful entry point for the StatusPageSkeleton scaffold. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) tagged with the surface slug, resolves the accessibility
 * announcement from the i18n catalog (P1/S10), and renders the presentational scaffold. The surface
 * binds no data of its own.
 *
 * @param modifier layout modifier applied to the scaffold's root.
 * @param spec the bar composition projected from the web source; defaults to its web-parity projection.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatusPageSkeleton(
    modifier: Modifier = Modifier,
    spec: StatusSkeletonSpec = StatusPageSkeletonProjection.webParity,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info(
            "view.opened",
            mapOf("surface" to StatusPageSkeletonRegistration.SLUG),
        )
    }
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    StatusPageSkeletonContent(loadingLabel = loadingLabel, modifier = modifier, spec = spec)
}

/**
 * Stateless renderer — the unit-test and preview entry point. Reproduces the web component's layout
 * exactly: a centered, `max-w-3xl`-capped `space-y-5` column (native [Spacing.xl]) of the hero, the
 * chip bar, the three list panels, and the four accordion rows. The whole scaffold is a polite live
 * region merged into one semantics node carrying [loadingLabel] so TalkBack announces the loading
 * state once instead of walking every decorative shimmer bar (the web `role="status"
 * aria-busy="true" aria-label"`).
 */
@Composable
fun StatusPageSkeletonContent(
    loadingLabel: String,
    modifier: Modifier = Modifier,
    spec: StatusSkeletonSpec = StatusPageSkeletonProjection.webParity,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .widthIn(max = MAX_CONTENT_WIDTH_DP.dp)
                    .semantics(mergeDescendants = true) {
                        contentDescription = loadingLabel
                        liveRegion = LiveRegionMode.Polite
                    },
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            HeroPanel(spec.hero)
            ChipBar(spec.chips)
            StatusListPanel(spec.health)
            StatusListPanel(spec.actionItems)
            StatusListPanel(spec.resources)
            repeat(spec.accordionCount) { AccordionPanel(spec.accordion) }
        }
    }
}

/**
 * Hero region — web `GlassPanel p-5` holding a `flex items-start gap-4` row: the rounded avatar bar,
 * a `flex-1 space-y-2` title/subtitle stack, and the trailing action bar. `p-5` (20 dp) is above the
 * `PanelPadding` scale, so the panel uses [PanelPadding.None] and insets its content row directly.
 */
@Composable
private fun HeroPanel(spec: HeroSpec) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl),
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            verticalAlignment = Alignment.Top,
        ) {
            ShimmerBar(spec.avatar)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                ShimmerBar(spec.title)
                ShimmerBar(spec.subtitle)
            }
            ShimmerBar(spec.action)
        }
    }
}

/**
 * Chip bar — web `flex gap-2 overflow-hidden` row of fixed-width pills. The row never wraps and is
 * clipped to its bounds ([clipToBounds]), so on a compact window the trailing pills are clipped just
 * like the web `overflow-hidden`, never reflowed onto a second line.
 */
@Composable
private fun ChipBar(spec: ChipBarSpec) {
    Row(
        modifier = Modifier.fillMaxWidth().clipToBounds(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(spec.count) { ShimmerBar(spec.chip) }
    }
}

/**
 * A labelled list panel (health / action-items / resources) — a `GlassPanel` with the fixed-width
 * header bar, a [ListPanelSpec.headerGap] gap, then [ListPanelSpec.rowCount] full-width row bars
 * spaced by [ListPanelSpec.rowGap]. Every panel insets its content by [ListPanelSpec.padding] (the
 * web `p-3` / `p-4`), applied directly since the panel uses [PanelPadding.None].
 */
@Composable
private fun StatusListPanel(spec: ListPanelSpec) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth().padding(spec.padding.toDp())) {
            ShimmerBar(spec.header)
            Spacer(modifier = Modifier.height(spec.headerGap.toDp()))
            Column(verticalArrangement = Arrangement.spacedBy(spec.rowGap.toDp())) {
                repeat(spec.rowCount) { ShimmerBar(spec.row) }
            }
        }
    }
}

/**
 * One collapsed accordion row — web `GlassPanel p-5` holding a `flex items-center gap-3` row: the
 * icon bar, a `flex-1` title/subtitle stack (web `mt-1`, native [Spacing.xs]), and the trailing
 * badge bar. `p-5` (20 dp) is above the `PanelPadding` scale, so the panel uses [PanelPadding.None]
 * and insets its content row directly.
 */
@Composable
private fun AccordionPanel(spec: AccordionRowSpec) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShimmerBar(spec.icon)
            Column(modifier = Modifier.weight(1f)) {
                ShimmerBar(spec.title)
                Spacer(modifier = Modifier.height(Spacing.xs))
                ShimmerBar(spec.subtitle)
            }
            ShimmerBar(spec.badge)
        }
    }
}

/**
 * Renders one [bar] via the shared [Skeleton] primitive. Width is a fixed dp when
 * [SkeletonBar.widthDp] is set (the web fixed-px bars), else a [SkeletonBar.widthFraction] of the
 * parent (the web percentage widths), else the full parent width (web `w-full`).
 * [SkeletonBar.rounded] picks the pill shape. The shared primitive owns the shimmer animation, the
 * neutral fill colour, and the reduce-motion behaviour.
 */
@Composable
private fun ShimmerBar(
    bar: SkeletonBar,
    modifier: Modifier = Modifier,
) {
    if (bar.widthDp != null) {
        Skeleton(
            modifier = modifier.width(bar.widthDp.dp),
            height = bar.heightDp.dp,
            rounded = bar.rounded,
        )
    } else {
        Skeleton(
            modifier = modifier,
            widthFraction = bar.widthFraction ?: 1f,
            height = bar.heightDp.dp,
            rounded = bar.rounded,
        )
    }
}

/** Resolves a [SkeletonGap] step to its generated [Spacing] token dp value. */
private fun SkeletonGap.toDp(): Dp =
    when (this) {
        SkeletonGap.None -> Spacing.none
        SkeletonGap.Xs -> Spacing.xs
        SkeletonGap.Sm -> Spacing.sm
        SkeletonGap.Md -> Spacing.md
        SkeletonGap.Lg -> Spacing.lg
        SkeletonGap.Xl -> Spacing.xl
        SkeletonGap.Xl2 -> Spacing.xl2
    }

@Preview(showBackground = true)
@Composable
private fun StatusPageSkeletonPreview() {
    TeslaSyncTheme {
        StatusPageSkeletonContent(loadingLabel = stringResource(R.string.translation_a11y_loading))
    }
}
