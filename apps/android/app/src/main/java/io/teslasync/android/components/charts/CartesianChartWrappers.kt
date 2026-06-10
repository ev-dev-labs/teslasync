package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp

/**
 * The public cartesian chart presets. Each forces a series shape and delegates to
 * the shared [VicoCartesianChart] renderer, so pages get a focused, Vico-free API:
 *
 * - [LineChartWrapper] — every series as a line.
 * - [AreaChartWrapper] — every series as a gradient-filled area.
 * - [BarChartWrapper] — every series as columns.
 * - [ComboChart] — honors each series' own [ChartSeries.kind] (e.g. columns + a
 *   trend line), the Android counterpart of the web `ComposedChart`.
 *
 * All accept hidden-series keys, a marker rail, and axis value formatters; all
 * render real loading/empty states through the scaffold.
 */
@Composable
fun LineChartWrapper(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    hiddenKeys: Set<String> = emptySet(),
    markers: List<ChartVerticalMarker> = emptyList(),
    yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
    xValueFormatter: (String) -> String = { it },
    emptyMessage: String = "",
) {
    val shaped = remember(series) { series.map { it.copy(kind = ChartSeriesKind.Line) } }
    VicoCartesianChart(
        series = shaped,
        xLabels = xLabels,
        modifier = modifier,
        height = height,
        hiddenKeys = hiddenKeys,
        markers = markers,
        yValueFormatter = yValueFormatter,
        xValueFormatter = xValueFormatter,
        emptyMessage = emptyMessage,
    )
}

@Composable
fun AreaChartWrapper(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    hiddenKeys: Set<String> = emptySet(),
    markers: List<ChartVerticalMarker> = emptyList(),
    yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
    xValueFormatter: (String) -> String = { it },
    emptyMessage: String = "",
) {
    val shaped = remember(series) { series.map { it.copy(kind = ChartSeriesKind.Area) } }
    VicoCartesianChart(
        series = shaped,
        xLabels = xLabels,
        modifier = modifier,
        height = height,
        hiddenKeys = hiddenKeys,
        markers = markers,
        yValueFormatter = yValueFormatter,
        xValueFormatter = xValueFormatter,
        emptyMessage = emptyMessage,
    )
}

@Composable
fun BarChartWrapper(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    hiddenKeys: Set<String> = emptySet(),
    markers: List<ChartVerticalMarker> = emptyList(),
    yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
    xValueFormatter: (String) -> String = { it },
    emptyMessage: String = "",
) {
    val shaped = remember(series) { series.map { it.copy(kind = ChartSeriesKind.Bar) } }
    VicoCartesianChart(
        series = shaped,
        xLabels = xLabels,
        modifier = modifier,
        height = height,
        hiddenKeys = hiddenKeys,
        markers = markers,
        yValueFormatter = yValueFormatter,
        xValueFormatter = xValueFormatter,
        emptyMessage = emptyMessage,
    )
}

@Composable
fun ComboChart(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    hiddenKeys: Set<String> = emptySet(),
    markers: List<ChartVerticalMarker> = emptyList(),
    yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
    xValueFormatter: (String) -> String = { it },
    emptyMessage: String = "",
) {
    VicoCartesianChart(
        series = series,
        xLabels = xLabels,
        modifier = modifier,
        height = height,
        hiddenKeys = hiddenKeys,
        markers = markers,
        yValueFormatter = yValueFormatter,
        xValueFormatter = xValueFormatter,
        emptyMessage = emptyMessage,
    )
}
