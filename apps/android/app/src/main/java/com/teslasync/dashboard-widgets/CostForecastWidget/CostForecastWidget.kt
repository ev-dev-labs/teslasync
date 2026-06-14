// The native Jetpack Compose + Material 3 Cost Forecast dashboard surface — a parity port of
// web/src/features/dashboard/widgets/CostForecastWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header with the
// title + trend icon + refresh) wrapping the web `WidgetChartSummary`: a stat row over a bar chart of the
// last six months' charging cost (historical + projection), or a friendly "No forecast data" empty
// state. The standard (2-col) footprint shows three stats — Next Month / Avg $/kWh / Trend — above the
// chart; the compact (1-col) footprint shows only the two-stat Next Month / Trend summary, exactly like
// the web compact branch. All data flows through the shared [CostForecastWidgetViewModel]; currency is
// formatted at this render boundary via the live [CostForecastDisplayPrefs]. The view never performs
// HTTP. Every string resolves through the i18n catalog (P1/S10) and every interactive element carries a
// TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CostForecastWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costforecast

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private const val COMPACT_STAT_COUNT = 2
private const val STANDARD_STAT_COUNT = 3
private const val Y_AXIS_DECIMALS = 0

// The bar fill — the exact web `fill="#6366f1"` indigo every cost-forecast column receives.
private val BAR_COLOR = Color(0xFF6366F1)

// The rising-trend icon accent — the web `text-amber-400` the `TrendingUp` header icon receives. A
// specific brand accent (the direct analogue of the web utility class), not themed body styling.
private val TREND_UP_COLOR = Color(0xFFFBBF24)

// The falling-trend icon accent — the web `text-emerald-400` the `TrendingDown` header icon receives.
private val TREND_DOWN_COLOR = Color(0xFF34D399)

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [CostForecastWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + charging + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CostForecastWidget(
    source: CostForecastSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: CostForecastSize = CostForecastRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CostForecastRegistration.ID,
) {
    val viewModel: CostForecastWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { CostForecastWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    CostForecastWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header above the stat row + bar chart / empty surface. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract. [prefs] supplies the currency symbol; [locale] drives number grouping
 * (tests pin a deterministic locale).
 */
@Composable
fun CostForecastWidgetContent(
    state: UiState<JsonElement>,
    prefs: CostForecastDisplayPrefs,
    size: CostForecastSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberCostForecastStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> CostForecastLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val display =
                    remember(state.data, prefs, strings, locale) {
                        CostForecastProjection.project(parseCostForecast(state.data), prefs, strings, locale)
                    }
                CostForecastReady(
                    state = state,
                    display = display,
                    strings = strings,
                    size = size,
                    locale = locale,
                    onRefresh = onRefresh,
                )
            }
        }
    }
}

@Composable
private fun CostForecastReady(
    state: UiState<JsonElement>,
    display: CostForecastDisplay,
    strings: CostForecastStrings,
    size: CostForecastSize,
    locale: Locale,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CostForecastHeader(
            title = strings.title,
            state = state,
            trendUp = display.trendUp,
            showTitle = !size.isCompact,
            onRefresh = onRefresh,
        )
        if (display.hasData) {
            CostForecastStats(stats = if (size.isCompact) display.compactStats else display.standardStats)
            if (!size.isCompact) {
                CostForecastChart(display = display, costLabel = strings.costLabel, locale = locale)
            }
        } else {
            EmptyState(
                message = display.emptyMessage,
                icon = CostForecastGlyphs.TrendingUp,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CostForecastHeader(
    title: String,
    state: UiState<*>,
    trendUp: Boolean,
    showTitle: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
    ) {
        if (showTitle) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = if (trendUp) CostForecastGlyphs.TrendingUp else CostForecastGlyphs.TrendingDown,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = if (trendUp) TREND_UP_COLOR else TREND_DOWN_COLOR,
                )
                PanelTitle(title)
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
            IconButton(
                imageVector = CostForecastGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun CostForecastStats(stats: List<ForecastStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            CostForecastStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun CostForecastStatItem(
    stat: ForecastStat,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = stat.value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        MetricLabel(stat.label)
    }
}

@Composable
private fun CostForecastChart(
    display: CostForecastDisplay,
    costLabel: String,
    locale: Locale,
) {
    val bars = display.bars
    val labels = remember(bars) { bars.map { it.month } }
    val series =
        remember(bars, costLabel) {
            listOf(
                ChartSeries(
                    key = KEY_COST,
                    label = costLabel,
                    values = bars.map { it.cost },
                    kind = ChartSeriesKind.Bar,
                    color = BAR_COLOR,
                ),
            )
        }
    BarChartWrapper(
        series = series,
        xLabels = labels,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = display.chartContentDescription },
        height = CHART_HEIGHT,
        yValueFormatter = { "${display.currencySymbol}${ChartFormat.number(it, Y_AXIS_DECIMALS, locale)}" },
        emptyMessage = display.emptyMessage,
    )
}

@Composable
private fun CostForecastLoading(size: CostForecastSize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = if (size.isCompact) COMPACT_STAT_COUNT else STANDARD_STAT_COUNT)
        if (!size.isCompact) {
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the six source strings through the i18n facade (P1/S10) — the web `t('widget.costForecast.…')` keys. */
@Composable
private fun rememberCostForecastStrings(): CostForecastStrings {
    val title = stringResource(R.string.translation_widget_costForecast_title)
    val noData = stringResource(R.string.translation_widget_costForecast_noData)
    val nextMonth = stringResource(R.string.translation_widget_costForecast_nextMonth)
    val trend = stringResource(R.string.translation_widget_costForecast_trend)
    val avgPerKwh = stringResource(R.string.translation_widget_costForecast_avgPerKwh)
    val costLabel = stringResource(R.string.translation_widget_costForecast_costLabel)
    return remember(title, noData, nextMonth, trend, avgPerKwh, costLabel) {
        CostForecastStrings(
            title = title,
            noData = noData,
            nextMonth = nextMonth,
            trend = trend,
            avgPerKwh = avgPerKwh,
            costLabel = costLabel,
        )
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

private const val KEY_COST = "cost"

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render
 * time by the [Icon] / [EmptyState] tint.
 */
private object CostForecastGlyphs {
    /** Up-and-to-the-right trend line with an arrowhead — the rising header + empty-state icon (web lucide `TrendingUp`). */
    val TrendingUp: ImageVector =
        forecastVector("CostForecastTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** Down-and-to-the-right trend line with an arrowhead — the falling header icon (web lucide `TrendingDown`). */
    val TrendingDown: ImageVector =
        forecastVector("CostForecastTrendingDown") {
            moveTo(22f, 17f)
            lineTo(13.5f, 8.5f)
            lineTo(8.5f, 13.5f)
            lineTo(2f, 7f)
            moveTo(16f, 17f)
            lineTo(22f, 17f)
            lineTo(22f, 11f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        forecastVector("CostForecastRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

private fun forecastVector(
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
