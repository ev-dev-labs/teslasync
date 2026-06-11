// The native Jetpack Compose + Material 3 Drive Efficiency Chart dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness
// header) wrapping the web `WidgetChartSummary`: an Avg / Best day / Trend stat row over an area chart
// of daily Wh/(km|mi) with a 7-day rolling-average line overlay + a matching legend; or a friendly
// "No efficiency data yet" empty state. The compact (1×1) footprint shows only the stat row, exactly
// like the web compact branch. All data flows through the shared [DriveEfficiencyChartWidgetViewModel]
// (P1/S8); SI distances are converted to the user's unit at this render boundary via the live
// [io.teslasync.android.data.UnitFormatter]. The view never performs HTTP. Every string resolves
// through the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveEfficiencyChartWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.driveefficiencychart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
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
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STAT_COUNT = 3
private const val Y_AXIS_DECIMALS = 0
private const val KEY_DAILY = "daily"
private const val KEY_ROLLING = "rolling"

/**
 * Stateful entry point. Collects the shared [DriveEfficiencyChartWidgetViewModel] state + the live
 * [units] formatter, records the one-shot `view.opened` diagnostic, and renders the surface for the
 * given [size]. A dashboard host supplies the view-model (wired via
 * [DriveEfficiencyChartWidgetViewModel.create]); [units] defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveEfficiencyChartWidget(
    viewModel: DriveEfficiencyChartWidgetViewModel,
    modifier: Modifier = Modifier,
    size: DriveEfficiencySize = DriveEfficiencyRegistration.defaultSize,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    DriveEfficiencyChartWidgetContent(
        state = state,
        size = size,
        distanceUnit = formatter.prefs.distance,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the Drive Efficiency Chart surface — every state from the web source is
 * reproduced and none is ever hidden. Split out from [DriveEfficiencyChartWidget] so each state can be
 * rendered in a snapshot/accessibility test without a view-model or network. [distanceUnit] supplies
 * the Wh/km → Wh/mi conversion + unit token at the render boundary.
 */
@Composable
fun DriveEfficiencyChartWidgetContent(
    state: UiState<List<Drive>>,
    size: DriveEfficiencySize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
) {
    val strings = rememberDriveEfficiencyStrings()
    val title = stringResource(R.string.translation_widget_driveEfficiencyChart_title)
    val emptyMessage = stringResource(R.string.translation_widget_driveEfficiencyChart_empty)
    val display =
        remember(state.data, size, distanceUnit, strings) {
            DriveEfficiencyProjection.project(state.data ?: emptyList(), size, strings, distanceUnit)
        }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> DriveEfficiencyLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = title, onRetry = onRetry)

            !display.hasData -> {
                DriveEfficiencyHeader(state = state, title = title, size = size, onRefresh = onRetry)
                EmptyState(message = emptyMessage, icon = DriveEfficiencyGlyphs.TrendingUp)
            }

            else -> {
                DriveEfficiencyHeader(state = state, title = title, size = size, onRefresh = onRetry)
                DriveEfficiencyBody(display = display)
            }
        }
    }
}

@Composable
private fun DriveEfficiencyHeader(
    state: UiState<List<Drive>>,
    title: String,
    size: DriveEfficiencySize,
    onRefresh: () -> Unit,
) {
    val showTitle = !size.isCompact
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    DriveEfficiencyGlyphs.TrendingUp,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.info,
                )
                PanelTitle(title, modifier = Modifier.semantics { heading() })
            }
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
                imageVector = DriveEfficiencyGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun DriveEfficiencyBody(display: DriveEfficiencyDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DriveEfficiencyStats(stats = display.stats)
        if (!display.isCompact) {
            DriveEfficiencyGraph(display = display)
            DriveEfficiencyLegend(display = display)
        }
    }
}

@Composable
private fun DriveEfficiencyStats(stats: List<DriveEfficiencyStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            DriveEfficiencyStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun DriveEfficiencyStatItem(
    stat: DriveEfficiencyStat,
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
private fun DriveEfficiencyGraph(display: DriveEfficiencyDisplay) {
    val dailyColor = paletteColor(0)
    val rollingColor = TeslaTokens.status.warning
    val locale = Locale.getDefault()
    val labels = remember(display) { display.points.map { it.label } }
    val series =
        remember(display, dailyColor, rollingColor) {
            listOf(
                ChartSeries(
                    key = KEY_DAILY,
                    label = display.dailyLabel,
                    values = display.points.map { it.efficiency },
                    kind = ChartSeriesKind.Area,
                    color = dailyColor,
                    unit = display.efficiencyUnit,
                ),
                ChartSeries(
                    key = KEY_ROLLING,
                    label = display.rollingLabel,
                    values = display.points.map { it.rollingAvg },
                    kind = ChartSeriesKind.Line,
                    color = rollingColor,
                    unit = display.efficiencyUnit,
                ),
            )
        }
    ComboChart(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

@Composable
private fun DriveEfficiencyLegend(display: DriveEfficiencyDisplay) {
    val entries =
        listOf(
            LegendEntry(KEY_DAILY, display.dailyLabel, paletteColor(0)),
            LegendEntry(KEY_ROLLING, display.rollingLabel, TeslaTokens.status.warning),
        )
    ChartLegend(entries = entries, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun DriveEfficiencyLoading(size: DriveEfficiencySize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = STAT_COUNT)
        if (!size.isCompact) {
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the source strings through the i18n facade (P1/S10). */
@Composable
private fun rememberDriveEfficiencyStrings(): DriveEfficiencyStrings =
    DriveEfficiencyStrings(
        avg = stringResource(R.string.translation_widget_driveEfficiencyChart_avg),
        best = stringResource(R.string.translation_widget_driveEfficiencyChart_best),
        trend = stringResource(R.string.translation_widget_driveEfficiencyChart_trend),
        daily = stringResource(R.string.translation_widget_driveEfficiencyChart_daily),
        rolling = stringResource(R.string.translation_widget_driveEfficiencyChart_rolling),
    )

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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library
 * leans on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured
 * at render time by the [Icon] tint — the same approach as the sibling ChargeSessionChartWidget.
 */
private object DriveEfficiencyGlyphs {
    /** lucide `trending-up` — the rising trend arrow (web header + empty-state icon). */
    val TrendingUp: ImageVector =
        driveVector("DriveEfficiencyTrendingUp") {
            moveTo(22f, 7f)
            lineTo(13.5f, 15.5f)
            lineTo(8.5f, 10.5f)
            lineTo(2f, 17f)
            moveTo(16f, 7f)
            lineTo(22f, 7f)
            lineTo(22f, 13f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        driveVector("DriveEfficiencyRefresh") {
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

private fun driveVector(
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
