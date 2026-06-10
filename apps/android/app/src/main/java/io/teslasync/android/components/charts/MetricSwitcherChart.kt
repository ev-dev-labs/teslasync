// File named for its primary @Composable; the co-located metric model is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * One switchable metric in a [MetricSwitcherChart]: a stable [key], a pill [label],
 * the [series] to plot (its [ChartSeries.kind] picks line/area/bar), the matching
 * [xLabels], and an optional axis formatter.
 */
data class MetricSwitcherMetric(
    val key: String,
    val label: String,
    val series: ChartSeries,
    val xLabels: List<String>,
    val yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
)

/**
 * A chart with a pill row above for switching the displayed metric — the Android
 * counterpart of the web `MetricSwitcherChart`. One panel answers several questions
 * ("Distance" / "Energy" / "Score" over time) without a panel each. The component
 * owns the pill row (a [TabNav]) and delegates the plot to [VicoCartesianChart];
 * callers own the per-metric data and active key.
 */
@Composable
fun MetricSwitcherChart(
    metrics: List<MetricSwitcherMetric>,
    activeKey: String,
    onMetricChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.CompactHeight,
    emptyMessage: String = "",
) {
    if (metrics.isEmpty()) {
        ChartEmptyState(message = emptyMessage, modifier = modifier, height = height)
        return
    }
    val active = metrics.firstOrNull { it.key == activeKey } ?: metrics.first()
    val items = remember(metrics) { metrics.map { TabNavItem(it.key, it.label) } }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        TabNav(items = items, selectedKey = active.key, onSelect = onMetricChange)
        VicoCartesianChart(
            series = listOf(active.series),
            xLabels = active.xLabels,
            height = height,
            yValueFormatter = active.yValueFormatter,
            emptyMessage = emptyMessage,
        )
    }
}
