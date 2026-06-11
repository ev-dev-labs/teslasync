// The native Jetpack Compose + Material 3 Power Flow History dashboard surface — a parity port of
// web/src/features/dashboard/widgets/PowerFlowHistoryWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `WidgetChartSummary`: an Avg Solar / Peak Home / Net Grid stat row over a four-channel area chart of
// the last 24 hours of solar / battery / grid / home power routing (kW), with a matching legend; the
// compact (single-column) footprint shows only Avg Solar + Peak Home, exactly like the web compact
// branch; a linked site with no power rows shows the "No power flow data" empty state; and no linked
// Tesla Energy site shows the title-less "No Tesla Energy site linked" surface. All data flows through
// the shared [PowerFlowHistoryWidgetViewModel]; the view never performs HTTP. Every string resolves
// through the i18n catalog and the refresh control carries a screen-reader name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/PowerFlowHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.powerflowhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STANDARD_STAT_COUNT = 3
private const val COMPACT_STAT_COUNT = 2
private const val Y_AXIS_DECIMALS = 1
private const val KEY_SOLAR = "solar"
private const val KEY_BATTERY = "battery"
private const val KEY_GRID = "grid"
private const val KEY_HOME = "home"

/**
 * Stateful entry point. Binds the power-flow-history feeds via [source] into a
 * [PowerFlowHistoryWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * Energy data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (energy-sites + live-status-history adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PowerFlowHistoryWidget(
    source: PowerFlowHistorySource,
    modifier: Modifier = Modifier,
    size: PowerFlowHistorySize = PowerFlowHistoryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = PowerFlowHistoryRegistration.ID,
) {
    val viewModel: PowerFlowHistoryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { PowerFlowHistoryWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    PowerFlowHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header over the stat row + area chart, the "No power flow data" empty state, or the title-less
 * "No Tesla Energy site linked" surface. Split out so each state renders in a snapshot/accessibility
 * test without a view-model or network.
 */
@Composable
fun PowerFlowHistoryWidgetContent(
    state: UiState<PowerFlowHistorySnapshot>,
    size: PowerFlowHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberPowerFlowHistoryStrings()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> PowerFlowHistoryLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val snapshot = state.data ?: PowerFlowHistorySnapshot.EMPTY
                val display =
                    remember(snapshot, size, strings) {
                        PowerFlowHistoryProjection.project(snapshot, size, strings)
                    }
                PowerFlowHistoryLoaded(state = state, display = display, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun PowerFlowHistoryLoaded(
    state: UiState<PowerFlowHistorySnapshot>,
    display: PowerFlowHistoryDisplay,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PowerFlowHistoryHeader(state = state, display = display, onRefresh = onRefresh)
        when {
            !display.hasSites ->
                EmptyState(
                    message = display.noSiteMessage,
                    icon = PowerFlowHistoryGlyphs.TrendingUp,
                    modifier = Modifier.fillMaxWidth(),
                )

            !display.hasData ->
                EmptyState(
                    message = display.noDataMessage,
                    icon = PowerFlowHistoryGlyphs.TrendingUp,
                    modifier = Modifier.fillMaxWidth(),
                )

            else -> PowerFlowHistoryBody(display = display)
        }
    }
}

@Composable
private fun PowerFlowHistoryHeader(
    state: UiState<PowerFlowHistorySnapshot>,
    display: PowerFlowHistoryDisplay,
    onRefresh: () -> Unit,
) {
    // Web shows the shell title only in the standard (linked-site, non-compact) branch.
    val showTitle = display.hasSites && !display.isCompact
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                modifier = Modifier.semantics { heading() },
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    PowerFlowHistoryGlyphs.TrendingUp,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.chart.regen,
                )
                PanelTitle(display.title)
            }
        } else {
            Spacer(modifier = Modifier.fillMaxWidth().weight(1f))
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
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
}

@Composable
private fun PowerFlowHistoryBody(display: PowerFlowHistoryDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PowerFlowHistoryStats(stats = display.stats)
        if (!display.isCompact) {
            PowerFlowHistoryChart(display = display)
            PowerFlowHistoryLegend(display = display)
        }
    }
}

@Composable
private fun PowerFlowHistoryStats(stats: List<PowerFlowHistoryStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            PowerFlowHistoryStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun PowerFlowHistoryStatItem(
    stat: PowerFlowHistoryStat,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = stat.value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (stat.unit != null) {
                Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
            }
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun PowerFlowHistoryChart(display: PowerFlowHistoryDisplay) {
    val solarColor = TeslaTokens.chart.energy
    val batteryColor = TeslaTokens.chart.battery
    val gridColor = TeslaTokens.chart.speed
    val homeColor = MaterialTheme.colorScheme.onSurfaceVariant
    val locale = Locale.getDefault()
    val labels = remember(display.samples) { display.samples.map { it.timeLabel } }
    val series =
        remember(display, solarColor, batteryColor, gridColor, homeColor) {
            listOf(
                areaSeries(KEY_SOLAR, display.solarLabel, solarColor, display.samples.map { it.solarKw }),
                areaSeries(KEY_BATTERY, display.batteryLabel, batteryColor, display.samples.map { it.batteryKw }),
                areaSeries(KEY_GRID, display.gridLabel, gridColor, display.samples.map { it.gridKw }),
                areaSeries(KEY_HOME, display.homeLabel, homeColor, display.samples.map { it.homeKw }),
            )
        }
    AreaChartWrapper(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

private fun areaSeries(
    key: String,
    label: String,
    color: Color,
    values: List<Double>,
): ChartSeries =
    ChartSeries(
        key = key,
        label = label,
        values = values,
        kind = ChartSeriesKind.Area,
        color = color,
        unit = PowerFlowHistoryProjection.KW_UNIT,
    )

@Composable
private fun PowerFlowHistoryLegend(display: PowerFlowHistoryDisplay) {
    val entries =
        listOf(
            LegendEntry(KEY_SOLAR, display.solarLabel, TeslaTokens.chart.energy),
            LegendEntry(KEY_BATTERY, display.batteryLabel, TeslaTokens.chart.battery),
            LegendEntry(KEY_GRID, display.gridLabel, TeslaTokens.chart.speed),
            LegendEntry(KEY_HOME, display.homeLabel, MaterialTheme.colorScheme.onSurfaceVariant),
        )
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun PowerFlowHistoryLoading(size: PowerFlowHistorySize) {
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

/** Resolves the source strings through the i18n facade (P1/S10). */
@Composable
private fun rememberPowerFlowHistoryStrings(): PowerFlowHistoryStrings {
    val title = stringResource(R.string.translation_widget_powerFlowHistory_title)
    val noSite = stringResource(R.string.translation_widget_powerFlowHistory_noSite)
    val noData = stringResource(R.string.translation_widget_powerFlowHistory_noData)
    val avgSolar = stringResource(R.string.translation_widget_powerFlowHistory_avgSolar)
    val peakHome = stringResource(R.string.translation_widget_powerFlowHistory_peakHome)
    val netGrid = stringResource(R.string.translation_widget_powerFlowHistory_netGrid)
    val solar = stringResource(R.string.translation_widget_powerFlowHistory_solar)
    val battery = stringResource(R.string.translation_widget_powerFlowHistory_battery)
    val grid = stringResource(R.string.translation_widget_powerFlowHistory_grid)
    val home = stringResource(R.string.translation_widget_powerFlowHistory_home)
    return remember(title, noSite, noData, avgSolar, peakHome, netGrid, solar, battery, grid, home) {
        PowerFlowHistoryStrings(
            title = title,
            noSite = noSite,
            noData = noData,
            avgSolar = avgSolar,
            peakHome = peakHome,
            netGrid = netGrid,
            solar = solar,
            battery = battery,
            grid = grid,
            home = home,
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

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans
 * on lucide-react's `TrendingUp`, which has no bundled Android equivalent). Monochrome, recoloured at
 * render time by the [Icon] tint.
 */
private object PowerFlowHistoryGlyphs {
    /** Up-and-to-the-right trend line — header + empty state (web `TrendingUp`). */
    val TrendingUp: ImageVector =
        powerFlowGlyph("PowerFlowHistoryTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }
}

private fun powerFlowGlyph(
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
