// The native Jetpack Compose + Material 3 WeekOverWeekSummary feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx. The web component renders a
// fade-in GlassPanel titled "Week-over-Week Comparison" containing six StatCards (distance, drives, energy,
// cost, efficiency, CO2 saved) in a responsive 1 / 2 / 3-column grid, each card carrying a value, an optional
// unit, a lucide icon, and a week-over-week trend chip. This port keeps that contract: the panel fades in
// exactly as the web `<FadeIn delay={0.3}>` wrapper does, the six cards always render (the always-present
// empty contract — zeros format rather than blanking a card), and the grid reflows at the web Tailwind `sm`
// (640dp) and `lg` (1024dp) breakpoints.
//
// Every derivation flows through the pure [WeekOverWeekSummaryProjection] (WeekOverWeekSummaryModel.kt); this
// composable is a thin render layer that resolves the i18n labels (P1/S10) and the design-token glyphs
// (P1/S9) and hands them to the shared StatCard. The card labels resolve through the generated catalog
// (`analytics.weeklyDigest.*` keys) — there is no English label literal in this file. The currency symbol for
// the cost card is read from the shared settings store (web `useFormatting`, P1/S8); this view performs no
// HTTP. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WeekOverWeekSummary) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.weekoverweeksummary

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the six cards lay out three-per-row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out two-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 3
private const val GRID_COLUMNS_SM: Int = 2
private const val GRID_COLUMNS_BASE: Int = 1

/** Web `<FadeIn delay={0.3}>` — the panel enters 300ms after mount. */
private const val FADE_DELAY_MS: Int = 300

/**
 * Stateful entry point — the faithful port of the web `WeekOverWeekSummary({ metrics })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), resolves the user's currency symbol from
 * the shared settings store (web `useFormatting`, P1/S8), projects the [metrics] onto a
 * [WeekOverWeekSummaryDisplay] via the pure [WeekOverWeekSummaryProjection], and renders. The owning Weekly
 * Digest page holds the queries (P1/S8) — this view never performs HTTP.
 *
 * @param metrics the aggregated week-over-week values (web `metrics: DigestMetrics`).
 * @param isLoading whether the page's queries are still loading; each card shows its StatCard skeleton while
 *   true (the lifecycle chrome the host's load implies). Defaults to `false`, the web's only render path.
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost card.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WeekOverWeekSummary(
    metrics: WeekOverWeekMetrics,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val locale: Locale = LocalConfiguration.current.locales[0]
    val currency = remember(settingsResource) { WeekDigestCurrencyPrefs.fromSettings(settingsResource.cached) }
    LaunchedEffect(Unit) { WeekOverWeekSummaryDiagnostics.recordViewOpened(logger) }
    val display =
        remember(metrics, currency, isLoading, locale) {
            WeekOverWeekSummaryProjection.project(
                metrics = metrics,
                currency = currency,
                loading = isLoading,
                locale = locale,
            )
        }
    WeekOverWeekSummaryContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Fades in a GlassPanel titled
 * "Week-over-Week Comparison" over the six-card responsive grid. Every card is always present and always
 * carries an accessible label, value, and trend (the cost / drive-count cards render without a unit), so no
 * surface is ever hidden or blank; while [WeekOverWeekSummaryDisplay.loading] is true each card shows its
 * StatCard skeleton instead of the value.
 */
@Composable
fun WeekOverWeekSummaryContent(
    display: WeekOverWeekSummaryDisplay,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_analytics_weeklyDigest_weekOverWeek)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            SectionTitle(title)
            Spacer(modifier = Modifier.height(Spacing.lg))
            WeekOverWeekGrid(
                tiles = display.tiles,
                loading = display.loading,
                loadingLabel = loadingLabel,
            )
        }
    }
}

/**
 * Lays out the six [tiles] as the web responsive grid: three-per-row at or above [GRID_LG_MIN_WIDTH]
 * (`lg:grid-cols-3`), two-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-2`), and stacked below it
 * (`grid-cols-1`). Each card fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cards keep a uniform width. Cells are spaced by `Spacing.md`, the native
 * expression of the web `gap-3`. While [loading] the grid carries a single TalkBack "Loading" description so
 * the loading state is announced rather than read as six empty boxes.
 */
@Composable
private fun WeekOverWeekGrid(
    tiles: List<WeekMetricTile>,
    loading: Boolean,
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    val gridModifier = if (loading) modifier.semantics { contentDescription = loadingLabel } else modifier
    BoxWithConstraints(modifier = gridModifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowTiles.forEach { tile ->
                        WeekMetricStatCard(tile = tile, loading = loading, modifier = Modifier.weight(1f))
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Renders one comparison [tile] as the shared StatCard — resolving its localized label (P1/S10) and
 * design-token glyph (P1/S9) from the tile's metric identity, and mapping the pure [WeekTrend] onto the
 * card's [StatTrend]. While [loading] the card shows its own skeleton instead of the value.
 */
@Composable
private fun WeekMetricStatCard(
    tile: WeekMetricTile,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    StatCard(
        label = metricLabel(tile.metric),
        value = tile.value,
        modifier = modifier,
        unit = tile.unit,
        icon = metricIcon(tile.metric),
        trend =
            StatTrend(
                direction = toDeltaArrow(tile.trend.direction),
                text = tile.trend.text,
                positive = tile.trend.positive,
            ),
        loading = loading,
    )
}

/** Resolves the localized card label for a [metric] from the generated `analytics.weeklyDigest.*` catalog. */
@Composable
private fun metricLabel(metric: WeekMetric): String =
    when (metric) {
        WeekMetric.Distance -> stringResource(R.string.translation_analytics_weeklyDigest_distance)
        WeekMetric.Drives -> stringResource(R.string.translation_analytics_weeklyDigest_drives)
        WeekMetric.Energy -> stringResource(R.string.translation_analytics_weeklyDigest_energy)
        WeekMetric.Cost -> stringResource(R.string.translation_analytics_weeklyDigest_cost)
        WeekMetric.Efficiency -> stringResource(R.string.translation_analytics_weeklyDigest_efficiency)
        WeekMetric.Co2 -> stringResource(R.string.translation_analytics_weeklyDigest_co2)
    }

/** Maps a [metric] to its design-token glyph — the native counterparts of the web lucide icons. */
private fun metricIcon(metric: WeekMetric): ImageVector =
    when (metric) {
        WeekMetric.Distance -> WeekOverWeekSummaryGlyphs.Car
        WeekMetric.Drives -> WeekOverWeekSummaryGlyphs.Activity
        WeekMetric.Energy -> WeekOverWeekSummaryGlyphs.Zap
        WeekMetric.Cost -> WeekOverWeekSummaryGlyphs.Fuel
        WeekMetric.Efficiency -> WeekOverWeekSummaryGlyphs.BarChart3
        WeekMetric.Co2 -> WeekOverWeekSummaryGlyphs.Leaf
    }

/** Maps the pure [TrendDirection] onto the shared StatCard's [DeltaArrow] glyph. */
private fun toDeltaArrow(direction: TrendDirection): DeltaArrow =
    when (direction) {
        TrendDirection.Up -> DeltaArrow.Up
        TrendDirection.Down -> DeltaArrow.Down
        TrendDirection.Flat -> DeltaArrow.Flat
    }

/**
 * The six glyphs this surface needs. The web uses lucide `Car`, `Activity`, `Zap`, `Fuel`, `BarChart3`, and
 * `Leaf`; Android ships no equivalents without the frozen `material-icons-extended` artifact, so — exactly as
 * the sibling SummaryStatsRow port does for its lucide icons — they are authored here as 24×24 stroked
 * vectors faithful to the lucide silhouettes.
 */
private object WeekOverWeekSummaryGlyphs {
    val Car: ImageVector =
        stroked("Car") {
            moveTo(2.5f, 13f)
            lineTo(5f, 13f)
            lineTo(7f, 8.5f)
            lineTo(14.5f, 8.5f)
            lineTo(18f, 13f)
            lineTo(21.5f, 13f)
            lineTo(21.5f, 16f)
            lineTo(2.5f, 16f)
            close()
            circle(7f, 16f, 1.9f)
            circle(17f, 16f, 1.9f)
        }

    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    val Zap: ImageVector =
        stroked("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    val Fuel: ImageVector =
        stroked("Fuel") {
            moveTo(4f, 21f)
            lineTo(4f, 5f)
            curveTo(4f, 3.9f, 4.9f, 3f, 6f, 3f)
            lineTo(11f, 3f)
            curveTo(12.1f, 3f, 13f, 3.9f, 13f, 5f)
            lineTo(13f, 21f)
            moveTo(3f, 21f)
            lineTo(14f, 21f)
            moveTo(4.5f, 9f)
            lineTo(12.5f, 9f)
            moveTo(13f, 12f)
            lineTo(16f, 12f)
            curveTo(17.1f, 12f, 18f, 12.9f, 18f, 14f)
            lineTo(18f, 16.5f)
            curveTo(18f, 17.6f, 18.9f, 18.5f, 20f, 18.5f)
            curveTo(21.1f, 18.5f, 22f, 17.6f, 22f, 16.5f)
            lineTo(22f, 8f)
            lineTo(18.5f, 5f)
        }

    val BarChart3: ImageVector =
        stroked("BarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 14f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
        }

    val Leaf: ImageVector =
        stroked("Leaf") {
            moveTo(4f, 20f)
            curveTo(4f, 11f, 10f, 4f, 21f, 4f)
            curveTo(21f, 14f, 14f, 20f, 4f, 20f)
            close()
            moveTo(6.5f, 17.5f)
            curveTo(10f, 13f, 14f, 9f, 18f, 7f)
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (for the Car wheels). */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_METRICS =
    WeekOverWeekMetrics(
        distance = WeekComparison(current = 412.6, previous = 380.2),
        drives = WeekComparison(current = 23.0, previous = 25.0),
        energy = WeekComparison(current = 78.4, previous = 81.0),
        cost = WeekComparison(current = 14.27, previous = 12.5),
        efficiency = WeekComparison(current = 168.3, previous = 171.0),
        co2 = WeekComparison(current = 31.7, previous = 29.1),
    )

@Preview(name = "Resolved — full week", showBackground = true, widthDp = 420)
@Composable
private fun WeekOverWeekSummaryResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekOverWeekSummaryContent(
            WeekOverWeekSummaryProjection.project(
                metrics = PREVIEW_METRICS,
                currency = WeekDigestCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Resolved — wide (3-col)", showBackground = true, widthDp = 1100)
@Composable
private fun WeekOverWeekSummaryWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekOverWeekSummaryContent(
            WeekOverWeekSummaryProjection.project(
                metrics = PREVIEW_METRICS,
                currency = WeekDigestCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Empty — zero week", showBackground = true, widthDp = 420)
@Composable
private fun WeekOverWeekSummaryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekOverWeekSummaryContent(
            WeekOverWeekSummaryProjection.project(
                metrics = WeekOverWeekMetrics.EMPTY,
                currency = WeekDigestCurrencyPrefs.DEFAULT,
                loading = false,
                locale = Locale.US,
            ),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun WeekOverWeekSummaryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekOverWeekSummaryContent(
            WeekOverWeekSummaryProjection.project(
                metrics = WeekOverWeekMetrics.EMPTY,
                currency = WeekDigestCurrencyPrefs.DEFAULT,
                loading = true,
                locale = Locale.US,
            ),
        )
    }
}
