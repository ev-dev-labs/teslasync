// The native Jetpack Compose + Material 3 PageSkeleton shared surface — a parity port of
// web/src/components/feedback/PageSkeleton.tsx. The web source is a SHAPED LOADING PRIMITIVE that exports
// four building blocks — `PageHeaderSkeleton`, `StatGridSkeleton`, `ChartBlockSkeleton`, `TableSkeleton` —
// each mirroring the structure of a common page section so the loading UI claims the same space the real
// content will (Cumulative Layout Shift ≈ 0). Every block is announced `role="status" aria-busy="true"`
// with a fixed aria-label and carries a stable `data-testid`. This surface reproduces all four blocks, the
// web layout defaults (cards 4, chart height 320, table 8×4), and a reduced-motion variant (the native
// translation of the web `animate-pulse` being disabled under `prefers-reduced-motion`).
//
// It performs NO HTTP and has no async feed — the web component imports only the `<Skeleton>` primitive and
// the `cn` class helper — so there is no loading/empty/error/stale/offline lifecycle to render; the surface
// IS the loading-state vocabulary itself (see PageSkeletonModel.kt for the full rationale and why there is
// no `PageSkeletonSource.kt`). The one dependency it has — the diagnostics [Logger] (P1/S11) — flows
// through [PageSkeletonViewModel], which emits the one-shot PII-safe `view.opened` on first composition; the
// view stays a thin renderer (ADR-002). The accessible label resolves through the P1/S10 catalog key
// `a11y.loading` (the Range precedent) and the design tokens (P1/S9) drive every size; the per-block
// `role="status"` distinction the shared label collapses is preserved via [PageSkeletonRegion.testTag].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PageSkeleton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located building blocks + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful surface entry — the diagnostics-bearing composite. Binds a [PageSkeletonViewModel] (keyed by
 * [PageSkeletonRegistration.ID]) so the one-shot PII-safe `view.opened` (P1/S11) fires on first composition,
 * then fades in a full-page loading scaffold composed of all four web blocks with their web-default layout.
 * Callers that need a single section, or custom counts, use the individual blocks below (the web's primary
 * API). The accessible label + reduced-motion preference are resolved once and threaded down.
 *
 * @param loadingLabel the localized region status label; defaults to the P1/S10 `a11y.loading` catalog key.
 * @param reduceMotion whether the shimmer is suppressed for accessibility; defaults to the OS preference.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PageSkeleton(
    modifier: Modifier = Modifier,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: PageSkeletonViewModel =
        viewModel(key = PageSkeletonRegistration.ID, factory = PageSkeletonViewModel.factory(logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    FadeIn(modifier = modifier) {
        PageSkeletonContent(loadingLabel = loadingLabel, reduceMotion = reduceMotion)
    }
}

/**
 * Stateless full-page loading scaffold — the test/preview entry point. Stacks the four web blocks
 * (header → stat grid → chart → table) so every shaped region renders; hoisted out of the ViewModel so it
 * is preview- and screenshot-testable without a data-layer host.
 */
@Composable
fun PageSkeletonContent(
    modifier: Modifier = Modifier,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        PageHeaderSkeleton(loadingLabel = loadingLabel, reduceMotion = reduceMotion)
        StatGridSkeleton(loadingLabel = loadingLabel, reduceMotion = reduceMotion)
        ChartBlockSkeleton(loadingLabel = loadingLabel, reduceMotion = reduceMotion)
        TableSkeleton(loadingLabel = loadingLabel, reduceMotion = reduceMotion)
    }
}

/**
 * Web `PageHeaderSkeleton` — a title bar over a wider subtitle bar, claiming a `<PageHeader>`'s vertical
 * space. Announced as a single "Loading" status region tagged [PageSkeletonRegion.Header].
 */
@Composable
fun PageHeaderSkeleton(
    modifier: Modifier = Modifier,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    Column(
        modifier = modifier.fillMaxWidth().loadingRegion(PageSkeletonRegion.Header, loadingLabel),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SkeletonBar(height = HEADER_TITLE_HEIGHT, reduceMotion = reduceMotion, widthFraction = HEADER_TITLE_FRACTION)
        SkeletonBar(height = HEADER_SUBTITLE_HEIGHT, reduceMotion = reduceMotion, widthFraction = HEADER_SUBTITLE_FRACTION)
    }
}

/**
 * Web `StatGridSkeleton({ cards = 4 })` — a responsive grid of equal stat-card skeletons. Reproduces the
 * web `grid-cols-2` mobile-first layout by chunking [cards] into rows of [STAT_GRID_COLUMNS]; a short final
 * row is padded so every card keeps the same width. [cards] is clamped by [PageSkeletonProjection].
 */
@Composable
fun StatGridSkeleton(
    modifier: Modifier = Modifier,
    cards: Int = DEFAULT_STAT_CARDS,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val spec = PageSkeletonProjection.statGridSpec(cards)
    Column(
        modifier = modifier.fillMaxWidth().loadingRegion(PageSkeletonRegion.StatGrid, loadingLabel),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        for (rowStart in 0 until spec.cards step STAT_GRID_COLUMNS) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                for (column in 0 until STAT_GRID_COLUMNS) {
                    val index = rowStart + column
                    if (index < spec.cards) {
                        SkeletonBar(
                            height = STAT_CARD_HEIGHT,
                            reduceMotion = reduceMotion,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(Radius.md),
                        )
                    } else {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Web `ChartBlockSkeleton({ height = 320 })` — a single layout-preserving box sized to a chart container.
 * [heightDp] is clamped by [PageSkeletonProjection]. Tagged [PageSkeletonRegion.Chart].
 */
@Composable
fun ChartBlockSkeleton(
    modifier: Modifier = Modifier,
    heightDp: Int = DEFAULT_CHART_HEIGHT_DP,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val height = PageSkeletonProjection.chartHeightDp(heightDp).dp
    Box(modifier = modifier.fillMaxWidth().loadingRegion(PageSkeletonRegion.Chart, loadingLabel)) {
        SkeletonBar(height = height, reduceMotion = reduceMotion, shape = RoundedCornerShape(Radius.md))
    }
}

/**
 * Web `TableSkeleton({ rows = 8, cols = 4 })` — a top-rounded header bar over [rows] body rows of [cols]
 * equal cells, claiming a `<DataTable>`'s space. [rows]/[cols] are clamped by [PageSkeletonProjection].
 * Tagged [PageSkeletonRegion.Table].
 */
@Composable
fun TableSkeleton(
    modifier: Modifier = Modifier,
    rows: Int = DEFAULT_TABLE_ROWS,
    cols: Int = DEFAULT_TABLE_COLS,
    loadingLabel: String = stringResource(R.string.translation_a11y_loading),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val spec = PageSkeletonProjection.tableSpec(rows, cols)
    Column(
        modifier = modifier.fillMaxWidth().loadingRegion(PageSkeletonRegion.Table, loadingLabel),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SkeletonBar(height = TABLE_HEADER_HEIGHT, reduceMotion = reduceMotion, shape = TABLE_HEADER_SHAPE)
        repeat(spec.rows) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                repeat(spec.cols) {
                    SkeletonBar(height = TABLE_CELL_HEIGHT, reduceMotion = reduceMotion, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * A single shimmering skeleton bar — the native analogue of the web `<Skeleton>` (`animate-pulse` over a
 * neutral fill). Fills [widthFraction] of its parent at [height] with the given [shape]. When [reduceMotion]
 * is set the pulse is replaced by a static fill, so the surface honors the OS "remove animations" setting
 * exactly as the web `animate-pulse` yields under `prefers-reduced-motion` (the library `Skeleton` always
 * animates, so this reduced-motion-aware bar is intentionally surface-local).
 */
@Composable
private fun SkeletonBar(
    height: Dp,
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
    widthFraction: Float = 1f,
    shape: Shape = RoundedCornerShape(Radius.sm),
) {
    val alpha = skeletonAlpha(reduceMotion)
    Box(
        modifier
            .fillMaxWidth(widthFraction.coerceIn(0f, 1f))
            .height(height)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = alpha)),
    )
}

/** The pulsing alpha for the shimmer, or a constant when [reduceMotion] is set (no infinite animation). */
@Composable
private fun skeletonAlpha(reduceMotion: Boolean): Float {
    if (reduceMotion) return SKELETON_STATIC_ALPHA
    val transition = rememberInfiniteTransition(label = "page-skeleton")
    val alpha by transition.animateFloat(
        initialValue = SHIMMER_MIN_ALPHA,
        targetValue = SHIMMER_MAX_ALPHA,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = MotionDurations.slow * SHIMMER_PERIOD_MULTIPLIER),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "page-skeleton-alpha",
    )
    return alpha
}

/**
 * Marks [this] as the surface's loading status region — the native analogue of the web blocks'
 * `role="status" aria-busy="true" aria-label` plus `data-testid`. [region] supplies the stable test tag
 * (the web `data-testid`) and the descendants are merged so assistive tech reads one "Loading" node per
 * region instead of each decorative bar.
 */
private fun Modifier.loadingRegion(
    region: PageSkeletonRegion,
    label: String,
): Modifier =
    this
        .testTag(region.testTag)
        .semantics(mergeDescendants = true) {
            contentDescription = label
            liveRegion = LiveRegionMode.Polite
        }

// ── Layout tokens (web heights; dp/fractions sized from the P1/S9 scale) ──────────────────────────────

private const val HEADER_TITLE_FRACTION = 0.6f
private const val HEADER_SUBTITLE_FRACTION = 0.9f
private val HEADER_TITLE_HEIGHT = 32.dp
private val HEADER_SUBTITLE_HEIGHT = 16.dp
private val STAT_CARD_HEIGHT = 96.dp
private const val STAT_GRID_COLUMNS = 2
private val TABLE_HEADER_HEIGHT = 40.dp
private val TABLE_CELL_HEIGHT = 32.dp
private val TABLE_HEADER_SHAPE =
    RoundedCornerShape(topStart = Radius.md, topEnd = Radius.md, bottomStart = 0.dp, bottomEnd = 0.dp)
private const val SKELETON_STATIC_ALPHA = 0.5f
private const val SHIMMER_MIN_ALPHA = 0.35f
private const val SHIMMER_MAX_ALPHA = 0.85f
private const val SHIMMER_PERIOD_MULTIPLIER = 2

// ── Previews — one per shaped region plus the composite (reduced motion for a deterministic frame) ────

@Preview(name = "PageSkeleton · header", showBackground = true)
@Composable
private fun PageHeaderSkeletonPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageHeaderSkeleton(reduceMotion = true)
    }
}

@Preview(name = "PageSkeleton · stat grid", showBackground = true)
@Composable
private fun StatGridSkeletonPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatGridSkeleton(cards = 6, reduceMotion = true)
    }
}

@Preview(name = "PageSkeleton · chart block", showBackground = true)
@Composable
private fun ChartBlockSkeletonPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartBlockSkeleton(reduceMotion = true)
    }
}

@Preview(name = "PageSkeleton · table", showBackground = true)
@Composable
private fun TableSkeletonPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TableSkeleton(rows = 4, reduceMotion = true)
    }
}

@Preview(name = "PageSkeleton · full page", showBackground = true)
@Composable
private fun PageSkeletonContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageSkeletonContent(reduceMotion = true)
    }
}

@Preview(name = "PageSkeleton · full page (dark)", showBackground = true)
@Composable
private fun PageSkeletonContentDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PageSkeletonContent(reduceMotion = true)
    }
}
