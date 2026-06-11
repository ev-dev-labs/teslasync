package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The BatteryDegradationTrend dashboard widget — the native, Material-3 port of
 * web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx. It reproduces every conditional
 * branch of the web source: a skeleton while the first load is in flight, a hard-error retry surface,
 * the "no degradation data" empty state, the SoH / Degradation / Cycles summary stats (the Degradation
 * chip only when the rate is positive), the rated state-of-health area chart (with a "more data needed"
 * fallback below two samples), and the compact (stat-row-only) vs standard (stats + chart) layouts —
 * each with a freshness chip that conveys background-fetch / stale / offline / error honestly. The view
 * is stateless; it collects the shared-store-driven [BatteryDegradationTrendWidgetViewModel.state] and
 * forwards refresh.
 */
@Composable
fun BatteryDegradationTrendWidget(
    viewModel: BatteryDegradationTrendWidgetViewModel,
    modifier: Modifier = Modifier,
    size: BatteryDegradationSize = BatteryDegradationTrendWidgetDescriptor.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onAppear() }
    BatteryDegradationTrendWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * The stateless render of the widget for a resolved [state] + [size]. Separated from the ViewModel
 * binding so every branch is exercised by Compose UI tests with hand-built [UiState] inputs.
 */
@Composable
fun BatteryDegradationTrendWidgetContent(
    state: UiState<BatteryDegradationSnapshot>,
    size: BatteryDegradationSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxSize()) {
        when {
            state.isLoading -> BatteryDegradationLoading()
            state.isError -> BatteryDegradationError(state = state, onRetry = onRefresh)
            else -> BatteryDegradationLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun BatteryDegradationLoaded(
    state: UiState<BatteryDegradationSnapshot>,
    size: BatteryDegradationSize,
    onRefresh: () -> Unit,
) {
    val snapshot = state.data ?: BatteryDegradationSnapshot.EMPTY
    val display = remember(snapshot, size) { BatteryDegradationProjection.project(snapshot, size) }
    val showTitle = !display.isCompact
    val title = stringResource(R.string.translation_widget_batteryDegradation)
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BatteryDegradationHeader(
            title = if (showTitle) title else null,
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        if (display.isEmpty) {
            EmptyState(
                message = stringResource(R.string.translation_widget_noDegradation),
                icon = DataDisplayGlyphs.TrendingDown,
            )
        } else {
            BatteryDegradationBody(display = display)
        }
    }
}

@Composable
private fun BatteryDegradationHeader(
    title: String?,
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = DataDisplayGlyphs.TrendingDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.energy,
            )
            Caption(text = title, modifier = Modifier.weight(1f))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = title == null,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun BatteryDegradationBody(display: BatteryDegradationDisplay) {
    val labels =
        BatteryDegradationLabels(
            soh = stringResource(R.string.translation_widget_soh),
            degradation = stringResource(R.string.translation_widget_degradation),
            cycles = stringResource(R.string.translation_widget_cycles),
            perMonth = stringResource(R.string.translation_widget_mo),
        )
    val stats = remember(display, labels) { BatteryDegradationProjection.stats(display, labels) }
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BatteryDegradationStatRow(stats = stats)
        if (!display.isCompact) {
            BatteryDegradationChart(display = display)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BatteryDegradationStatRow(stats: List<BatteryDegradationStat>) {
    // FlowRow reproduces the web stat row's responsive behaviour: all chips on one line on a wide
    // widget (web `@sm:flex`), wrapping onto further lines when the widget is narrow (web `grid-cols-2`).
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.forEach { stat -> BatteryDegradationStatCell(stat = stat) }
    }
}

@Composable
private fun BatteryDegradationStatCell(stat: BatteryDegradationStat) {
    val description = stat.unit?.let { "${stat.label}: ${stat.value} $it" } ?: "${stat.label}: ${stat.value}"
    Column(modifier = Modifier.clearAndSetSemantics { contentDescription = description }) {
        MetricLabel(text = stat.label)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricValue(text = stat.value)
            if (stat.unit != null) MetricLabel(text = stat.unit)
        }
    }
}

@Composable
private fun BatteryDegradationChart(display: BatteryDegradationDisplay) {
    if (!display.hasTrend) {
        Box(
            modifier = Modifier.fillMaxWidth().height(CHART_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            Caption(text = stringResource(R.string.translation_widget_needMoreData))
        }
        return
    }
    val healthLabel = stringResource(R.string.translation_widget_healthPct)
    val series =
        remember(display, healthLabel) {
            listOf(
                ChartSeries(
                    key = HEALTH_SERIES_KEY,
                    label = healthLabel,
                    values = display.healthValues,
                    kind = ChartSeriesKind.Area,
                    color = SERIES_COLOR,
                ),
            )
        }
    // Vico 2.0 has no horizontal-reference-line decoration (charts SURVEY / ChartModels), so the web's
    // 80% rated-capacity warranty line is conveyed to assistive tech via the section description rather
    // than drawn; the SoH stat above states the current value against that floor.
    val chartDescription =
        "$healthLabel — ${BatteryDegradationProjection.WARRANTY_THRESHOLD_PCT.toInt()}$PERCENT ${
            stringResource(R.string.translation_widget_soh)
        }"
    Box(modifier = Modifier.semantics { contentDescription = chartDescription }) {
        AreaChartWrapper(
            series = series,
            xLabels = display.monthLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { "${ChartFormat.number(it, 0)}$PERCENT" },
            emptyMessage = stringResource(R.string.translation_widget_needMoreData),
        )
    }
}

@Composable
private fun BatteryDegradationLoading() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_WIDTH, height = SKELETON_TITLE_HEIGHT)
        Skeleton(height = SKELETON_STAT_HEIGHT, rounded = true)
        SkeletonLines(lines = SKELETON_ROW_COUNT)
    }
}

@Composable
private fun BatteryDegradationError(
    state: UiState<BatteryDegradationSnapshot>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = queryErrorKindFor(state),
        resourceName = stringResource(R.string.translation_widget_batteryDegradation),
        onRetry = onRetry,
    )
}

private const val PERCENT: String = "%"
private const val HEALTH_SERIES_KEY: String = "health"
private const val SKELETON_TITLE_WIDTH: Float = 0.5f
private const val SKELETON_ROW_COUNT: Int = 3
private val SERIES_COLOR = paletteColor(1)
private val CHART_HEIGHT = 140.dp
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_STAT_HEIGHT = 44.dp
