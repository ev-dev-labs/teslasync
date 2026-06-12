// The native Jetpack Compose + Material 3 LifetimeSummary feature view — a parity port of
// web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx. The web component renders a
// cyan-glow GlassPanel titled "Lifetime Summary" (a TrendingUp icon + heading) over a responsive grid of
// seven small label/value tiles (total spent, total energy, total sessions, average session cost, average
// energy per session, average duration, and free sessions), falling back to a centered "No data" message
// when either the lifetime metrics or the core stats are absent. This port keeps that contract: the panel
// carries the same cyan accent, the header pairs the same glyph with the localized title, the grid reflows
// at the web Tailwind `sm` (640dp) breakpoint, and the "No data" branch renders the shared empty state
// rather than a blank box.
//
// Every derivation flows through the pure [LifetimeSummaryProjection] (LifetimeSummaryModel.kt); this
// composable is a thin render layer that resolves the i18n labels (P1/S10) and the design tokens (P1/S9) and
// composes the shared GlassPanel / typography / empty-state primitives. The seven tile labels, the title,
// and the empty message resolve through the generated catalog (`costAnalysis.lifetime.*` keys) — there is no
// English label literal in this file. The currency symbol for the cost tiles is read from the shared
// settings store (web `useFormatting`, P1/S8); this view performs no HTTP. The one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// The web grid declares `grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3`. The `lg`→2 / `xl`→3
// reflow is a viewport-driven artifact of the Cost Analysis page placing this panel in a two-wide page
// region at `lg` (which narrows the panel, so by panel width it shows fewer columns); a full-width native
// panel grows monotonically, so this port maps the meaningful base→2 / `sm`→3 transition by the panel's own
// width via BoxWithConstraints.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LifetimeSummary) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.lifetimesummary

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.StatSkeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `sm` breakpoint (640px): at or above this panel width the tiles lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Columns at or above [GRID_SM_MIN_WIDTH] (web `sm:grid-cols-3`). */
private const val GRID_COLUMNS_WIDE: Int = 3

/** Columns below [GRID_SM_MIN_WIDTH] (web base `grid-cols-2`). */
private const val GRID_COLUMNS_BASE: Int = 2

/** The seven tiles this surface renders, matching the web component's fixed tile set. */
private const val TILE_COUNT: Int = 7

/**
 * Stateful entry point — the faithful port of the web `LifetimeSummary({ lifetimeMetrics, coreStats })`.
 * Records the one-shot `view.opened` diagnostic on first composition (P1/S11), resolves the user's currency
 * symbol from the shared settings store (web `useFormatting`, P1/S8), projects the props onto a
 * [LifetimeSummaryDisplay] via the pure [LifetimeSummaryProjection], and renders. The owning Cost Analysis
 * page holds the query (P1/S8) — this view never performs HTTP.
 *
 * @param coreStats lifetime totals (web `coreStats`), or `null` while the page query is unresolved.
 * @param lifetimeMetrics lifetime averages / free-session figures (web `lifetimeMetrics`), or `null`.
 * @param isLoading whether the page's query is still loading; the tiles show their skeleton while true.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost tiles.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LifetimeSummary(
    coreStats: LifetimeCoreStats?,
    lifetimeMetrics: LifetimeMetricsData?,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val locale: Locale = LocalConfiguration.current.locales[0]
    val currency = remember(settingsResource) { LifetimeCurrencyPrefs.fromSettings(settingsResource.cached) }
    LaunchedEffect(Unit) { LifetimeSummaryDiagnostics.recordViewOpened(logger) }
    val display =
        remember(coreStats, lifetimeMetrics, currency, isLoading, locale) {
            LifetimeSummaryProjection.project(
                coreStats = coreStats,
                lifetimeMetrics = lifetimeMetrics,
                currency = currency,
                loading = isLoading,
                locale = locale,
            )
        }
    LifetimeSummaryContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the cyan-accent GlassPanel with the
 * TrendingUp header, then one of three branches: the seven-tile skeleton grid while
 * [LifetimeSummaryDisplay.loading], the resolved seven-tile grid when [LifetimeSummaryDisplay.hasData], or
 * the shared "No data" empty state (web's `else` branch). The header chrome is always present so the panel
 * is never blank.
 */
@Composable
fun LifetimeSummaryContent(
    display: LifetimeSummaryDisplay,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_costAnalysis_lifetime_title)
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg, accent = PanelAccent.Info) {
        LifetimeSummaryHeader(title = title)
        Spacer(modifier = Modifier.height(Spacing.lg))
        when {
            display.loading -> LifetimeLoadingGrid()
            display.hasData -> LifetimeResolvedGrid(tiles = display.tiles)
            else -> EmptyState(message = stringResource(R.string.translation_costAnalysis_lifetime_noData))
        }
    }
}

/** The panel header — the cyan TrendingUp glyph paired with the localized title (web `<h3>`). */
@Composable
private fun LifetimeSummaryHeader(title: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            LifetimeSummaryGlyphs.TrendingUp,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(title)
    }
}

/** The resolved branch — the seven formatted [tiles] in the responsive grid (web `lifetimeMetrics && coreStats`). */
@Composable
private fun LifetimeResolvedGrid(
    tiles: List<LifetimeTile>,
    modifier: Modifier = Modifier,
) {
    val cells: List<@Composable (Modifier) -> Unit> =
        tiles.map { tile ->
            { cellModifier: Modifier -> LifetimeMetricTile(tile = tile, modifier = cellModifier) }
        }
    LifetimeMetricGrid(modifier = modifier, cells = cells)
}

/**
 * The loading branch — [TILE_COUNT] skeleton tiles in the same responsive grid as the resolved tiles. The
 * grid carries a single TalkBack "Loading" content description so the loading state is announced rather than
 * read as seven empty boxes.
 */
@Composable
private fun LifetimeLoadingGrid(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val skeletonCell: @Composable (Modifier) -> Unit = { cellModifier -> StatSkeleton(modifier = cellModifier) }
    LifetimeMetricGrid(
        modifier = modifier.semantics { contentDescription = loadingLabel },
        cells = List(TILE_COUNT) { skeletonCell },
    )
}

/**
 * Lays out the [cells] as the web responsive grid: three-per-row at or above [GRID_SM_MIN_WIDTH]
 * (`sm:grid-cols-3`) and two-per-row below it (`grid-cols-2`). Each cell fills its column via
 * [Modifier.weight]; a partial trailing row is padded with weighted spacers so the tiles keep a uniform
 * width. Cells are spaced by `Spacing.md`, the native expression of the web `gap-3`.
 */
@Composable
private fun LifetimeMetricGrid(
    cells: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_WIDE else GRID_COLUMNS_BASE
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cells.chunked(columns).forEach { rowCells ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCells.forEach { cell -> cell(Modifier.weight(1f)) }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One render-ready [tile] — the native analogue of the web local `LifetimeMetric`: a rounded surface-variant
 * card carrying the muted label and the semibold value. The value can wrap to two lines (e.g. the
 * free-sessions tile) so it is never truncated mid-figure.
 */
@Composable
private fun LifetimeMetricTile(
    tile: LifetimeTile,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(modifier = Modifier.padding(Spacing.md)) {
            MetricLabel(tileLabel(tile.kind))
            Subhead(tile.value, modifier = Modifier.padding(top = Spacing.xs))
        }
    }
}

/** Resolves the localized tile label for a [kind] from the generated `costAnalysis.lifetime.*` catalog. */
@Composable
private fun tileLabel(kind: LifetimeMetricKind): String =
    when (kind) {
        LifetimeMetricKind.TotalSpent -> stringResource(R.string.translation_costAnalysis_lifetime_totalSpent)
        LifetimeMetricKind.TotalEnergy -> stringResource(R.string.translation_costAnalysis_lifetime_totalEnergy)
        LifetimeMetricKind.TotalSessions ->
            stringResource(R.string.translation_costAnalysis_lifetime_totalSessions)
        LifetimeMetricKind.AvgSessionCost ->
            stringResource(R.string.translation_costAnalysis_lifetime_avgSessionCost)
        LifetimeMetricKind.AvgEnergy -> stringResource(R.string.translation_costAnalysis_lifetime_avgEnergy)
        LifetimeMetricKind.AvgDuration -> stringResource(R.string.translation_costAnalysis_lifetime_avgDuration)
        LifetimeMetricKind.FreeSessions ->
            stringResource(R.string.translation_costAnalysis_lifetime_freeSessions)
    }

/**
 * The single glyph this surface needs. The web uses lucide `TrendingUp`; Android ships no equivalent without
 * the frozen `material-icons-extended` artifact, so — exactly as the sibling feature-view ports do for their
 * lucide icons — it is authored here as a 24×24 stroked vector faithful to the lucide silhouette.
 */
private object LifetimeSummaryGlyphs {
    val TrendingUp: ImageVector =
        stroked("TrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_CORE =
    LifetimeCoreStats(totalCost = 1284.57, totalEnergy = 4210.6, count = 312.0)

private val PREVIEW_METRICS =
    LifetimeMetricsData(
        avgSessionCost = 4.12,
        avgSessionEnergy = 13.5,
        avgDuration = 42.0,
        freeCount = 18.0,
        freeEnergy = 210.4,
    )

@Preview(name = "Resolved — phone (2-col)", showBackground = true, widthDp = 420)
@Composable
private fun LifetimeSummaryResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LifetimeSummaryContent(
            LifetimeSummaryProjection.project(
                coreStats = PREVIEW_CORE,
                lifetimeMetrics = PREVIEW_METRICS,
                currency = LifetimeCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Resolved — wide (3-col)", showBackground = true, widthDp = 760)
@Composable
private fun LifetimeSummaryWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LifetimeSummaryContent(
            LifetimeSummaryProjection.project(
                coreStats = PREVIEW_CORE,
                lifetimeMetrics = PREVIEW_METRICS,
                currency = LifetimeCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Empty — No data", showBackground = true, widthDp = 420)
@Composable
private fun LifetimeSummaryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LifetimeSummaryContent(
            LifetimeSummaryProjection.project(
                coreStats = null,
                lifetimeMetrics = null,
                currency = LifetimeCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun LifetimeSummaryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LifetimeSummaryContent(
            LifetimeSummaryProjection.project(
                coreStats = PREVIEW_CORE,
                lifetimeMetrics = PREVIEW_METRICS,
                currency = LifetimeCurrencyPrefs.DEFAULT,
                loading = true,
                locale = Locale.US,
            ),
        )
    }
}
