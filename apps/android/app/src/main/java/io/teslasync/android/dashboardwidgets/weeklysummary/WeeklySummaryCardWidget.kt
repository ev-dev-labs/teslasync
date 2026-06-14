// File hosts the Weekly Summary Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.weeklysummary

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Weekly Summary dashboard surface — a parity port
 * of `web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx`. It mirrors the web
 * `WidgetShell` (skeleton while loading, a retry surface on error, otherwise a title + trending-up
 * icon + freshness header) wrapping either the compact big-number distance figure, the
 * Distance / Energy (+ Cost / Efficiency) stat tiles with week-over-week trend chips, or a friendly
 * empty state. All data flows through the [WeeklySummaryCardWidgetViewModel] (P1/S8); the view
 * performs no HTTP. Every string resolves from `strings.xml` (P1/S10) and the refresh control carries
 * a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared analytics / vehicles / settings holders.
 * @param size the grid footprint; controls the compact vs standard vs wide layout
 *   (web `isCompact`/`isWide`/`isTall`).
 */
@Composable
fun WeeklySummaryCardWidget(
    viewModel: WeeklySummaryCardWidgetViewModel,
    modifier: Modifier = Modifier,
    size: WeeklySummaryCardSize = WeeklySummaryCardRegistration.DEFAULT_SIZE,
) {
    val digestState by viewModel.digest.collectAsStateWithLifecycle()
    val prefs by viewModel.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    val metricsState = remember(digestState, prefs) { digestState.toMetricsState(prefs) }
    WeeklySummaryCardWidget(
        state = metricsState,
        prefs = prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Weekly Summary panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over cached figures, and the
 * compact 1×1 big-number layout). Hoisted out of the ViewModel so it is preview- and screenshot-
 * testable for each state. Stale (non-error) data auto-refreshes.
 */
@Composable
fun WeeklySummaryCardWidget(
    state: UiState<WeeklySummaryMetrics>,
    prefs: WeeklySummaryPrefs,
    size: WeeklySummaryCardSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val metrics = state.data ?: WeeklySummaryMetrics.EMPTY
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when (weeklySummarySurface(state)) {
            WeeklySummarySurface.Loading -> WeeklySummaryLoading(compact = size.isCompact)
            WeeklySummarySurface.Error -> WeeklySummaryError(state = state, onRetry = onRetry)
            WeeklySummarySurface.Empty -> {
                if (!size.isCompact) WeeklySummaryHeader(state = state, onRefresh = onRefresh)
                WeeklySummaryEmpty()
            }
            WeeklySummarySurface.Content ->
                if (size.isCompact) {
                    WeeklySummaryCompact(metrics = metrics, prefs = prefs, state = state)
                } else {
                    WeeklySummaryHeader(state = state, onRefresh = onRefresh)
                    WeeklySummaryBody(metrics = metrics, prefs = prefs, size = size)
                }
        }
    }
}

@Composable
private fun WeeklySummaryHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = WeeklySummaryTrendingUpGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_weeklySummary_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun WeeklySummaryLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = LOADING_NUMBER_FRACTION, height = LOADING_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            StatGridSkeleton(count = 2)
            StatGridSkeleton(count = 2)
        }
    }
}

@Composable
private fun WeeklySummaryError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = weeklySummaryErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_weeklySummary_title),
        onRetry = onRetry,
    )
}

@Composable
private fun WeeklySummaryEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_weeklySummary_noData),
        icon = WeeklySummaryTrendingUpGlyph,
    )
}

@Composable
private fun WeeklySummaryCompact(
    metrics: WeeklySummaryMetrics,
    prefs: WeeklySummaryPrefs,
    state: UiState<*>,
) {
    val locale = Locale.getDefault()
    val value = ChartFormat.number(metrics.distance.current, WeeklySummaryProjection.DISTANCE_COMPACT_DECIMALS, locale)
    val unit = prefs.distanceUnitLabel
    val thisWeek = stringResource(R.string.translation_widget_weeklySummary_thisWeek)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = COMPACT_MIN_HEIGHT)
                .semantics { contentDescription = weeklySummaryCompactContentDescription(value, unit, thisWeek) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MetricValue(value)
        MetricLabel("$unit $thisWeek")
    }
}

@Composable
private fun WeeklySummaryBody(
    metrics: WeeklySummaryMetrics,
    prefs: WeeklySummaryPrefs,
    size: WeeklySummaryCardSize,
) {
    val locale = Locale.getDefault()
    val distance =
        WeeklyStatItem(
            label = stringResource(R.string.translation_widget_weeklySummary_distance),
            value = ChartFormat.number(metrics.distance.current, WeeklySummaryProjection.DISTANCE_DECIMALS, locale),
            unit = prefs.distanceUnitLabel,
            icon = NavGlyphs.Route,
            trend = WeeklySummaryProjection.trendOf(metrics.distance, locale = locale),
        )
    val energy =
        WeeklyStatItem(
            label = stringResource(R.string.translation_widget_weeklySummary_energy),
            value = ChartFormat.number(metrics.energy.current, WeeklySummaryProjection.ENERGY_DECIMALS, locale),
            unit = WEEKLY_SUMMARY_ENERGY_UNIT,
            icon = DataDisplayGlyphs.Bolt,
            trend = WeeklySummaryProjection.trendOf(metrics.energy, locale = locale),
        )
    val cost =
        WeeklyStatItem(
            label = stringResource(R.string.translation_widget_weeklySummary_cost),
            value = prefs.formatting.formatCurrency(metrics.cost.current, locale = locale),
            unit = null,
            icon = WeeklySummaryDollarGlyph,
            trend = WeeklySummaryProjection.trendOf(metrics.cost, lowerIsPositive = true, locale = locale),
        )
    val efficiency =
        WeeklyStatItem(
            label = stringResource(R.string.translation_widget_weeklySummary_efficiency),
            value = ChartFormat.number(metrics.efficiency.current, WeeklySummaryProjection.EFFICIENCY_DECIMALS, locale),
            unit = prefs.efficiencyUnit,
            icon = DataDisplayGlyphs.Gauge,
            trend = WeeklySummaryProjection.trendOf(metrics.efficiency, lowerIsPositive = true, locale = locale),
        )

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        when {
            size.isWide ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    WeeklyStatTile(distance)
                    WeeklyStatTile(energy)
                    WeeklyStatTile(cost)
                    WeeklyStatTile(efficiency)
                }
            size.isTall -> {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    WeeklyStatTile(distance)
                    WeeklyStatTile(energy)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    WeeklyStatTile(cost)
                    WeeklyStatTile(efficiency)
                }
            }
            else -> {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    WeeklyStatTile(distance)
                    WeeklyStatTile(energy)
                }
                WeeklySummaryFooter(cost = cost, efficiency = efficiency)
            }
        }
    }
}

@Composable
private fun WeeklySummaryFooter(
    cost: WeeklyStatItem,
    efficiency: WeeklyStatItem,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        InlineMetric(icon = cost.icon, value = cost.value)
        InlineMetric(icon = efficiency.icon, value = "${efficiency.value} ${efficiency.unit}")
    }
}

@Composable
private fun RowScope.WeeklyStatTile(item: WeeklyStatItem) {
    StatCard(
        label = item.label,
        value = item.value,
        modifier = Modifier.weight(1f),
        unit = item.unit,
        icon = item.icon,
        trend = item.trend,
    )
}

private data class WeeklyStatItem(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: ImageVector,
    val trend: StatTrend,
)

// ── Local glyphs — the web `TrendingUp` + `DollarSign` lucide icons, authored as 24×24 stroked
// vectors (the data-display layer has no trending-up / money glyph; mirrors the hand-authored
// approach in components/datadisplay/DataDisplayGlyphs and the ChargeCostTracker dollar glyph). ──

private fun weeklyStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val WeeklySummaryTrendingUpGlyph: ImageVector =
    weeklyStroked("WeeklySummaryTrendingUp") {
        moveTo(22f, 7f)
        lineTo(13.5f, 15.5f)
        lineTo(8.5f, 10.5f)
        lineTo(2f, 17f)
        moveTo(16f, 7f)
        lineTo(22f, 7f)
        lineTo(22f, 13f)
    }

private val WeeklySummaryDollarGlyph: ImageVector =
    weeklyStroked("WeeklySummaryDollar") {
        moveTo(12f, 3f)
        lineTo(12f, 21f)
        moveTo(16f, 7.5f)
        curveTo(16f, 5.8f, 14.2f, 5f, 12f, 5f)
        curveTo(9.2f, 5f, 8f, 6.4f, 8f, 8.3f)
        curveTo(8f, 12.5f, 16f, 11f, 16f, 15.7f)
        curveTo(16f, 17.6f, 14.8f, 19f, 12f, 19f)
        curveTo(9.8f, 19f, 8f, 18.2f, 8f, 16.5f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val LOADING_TITLE_FRACTION = 0.5f
private const val LOADING_NUMBER_FRACTION = 0.6f
private val LOADING_TITLE_HEIGHT = 12.dp
private val LOADING_NUMBER_HEIGHT = 28.dp
private val COMPACT_MIN_HEIGHT = 56.dp

// ── Previews — one per rendered state (content / empty / loading / error / compact / wide). ────────

private val previewMetrics =
    WeeklySummaryMetrics(
        distance = WeeklyMetric(current = 182.4, previous = 150.0),
        energy = WeeklyMetric(current = 58.2, previous = 61.0),
        cost = WeeklyMetric(current = 8.15, previous = 9.40),
        efficiency = WeeklyMetric(current = 319.0, previous = 332.0),
        drives = WeeklyMetric(current = 9.0, previous = 7.0),
    )

@Preview(name = "WeeklySummary · content", showBackground = true)
@Composable
private fun WeeklySummaryContentPreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState(phase = UiPhase.Content, data = previewMetrics, fetchedAt = 1L),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WeeklySummary · wide", showBackground = true)
@Composable
private fun WeeklySummaryWidePreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState(phase = UiPhase.Content, data = previewMetrics, fetchedAt = 1L),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardSize(cols = 4, rows = 2),
        )
    }
}

@Preview(name = "WeeklySummary · empty", showBackground = true)
@Composable
private fun WeeklySummaryEmptyPreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState(phase = UiPhase.Empty, data = WeeklySummaryMetrics.EMPTY, fetchedAt = 1L),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WeeklySummary · loading", showBackground = true)
@Composable
private fun WeeklySummaryLoadingPreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState.loading(),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WeeklySummary · error", showBackground = true)
@Composable
private fun WeeklySummaryErrorPreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "WeeklySummary · compact", showBackground = true)
@Composable
private fun WeeklySummaryCompactPreview() {
    TeslaSyncTheme {
        WeeklySummaryCardWidget(
            state = UiState(phase = UiPhase.Content, data = previewMetrics, fetchedAt = 1L),
            prefs = WeeklySummaryPrefs.DEFAULT,
            size = WeeklySummaryCardSize(cols = 1, rows = 1),
        )
    }
}
