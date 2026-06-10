package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberBottom
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberStart
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLine
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.cartesian.rememberVicoScrollState
import com.patrykandpatrick.vico.compose.common.ProvideVicoTheme
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.compose.common.fill
import com.patrykandpatrick.vico.compose.m3.common.rememberM3VicoTheme
import com.patrykandpatrick.vico.core.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.core.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.core.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.core.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.data.lineSeries
import com.patrykandpatrick.vico.core.cartesian.layer.CartesianLayer
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.cartesian.layer.LineCartesianLayer

/**
 * The single Vico-backed renderer behind every cartesian chart wrapper in this
 * package. It converts the framework-light [ChartSeries] model into Vico layers +
 * a model producer, themes them from the Material 3 scheme via `ProvideVicoTheme`,
 * and attaches the shared hover marker. Bar series become a column layer; line and
 * area series become a line layer (area = line + gradient fill). Null samples are
 * dropped so the line bridges gaps (the Android `connectNulls`).
 *
 * This is the only place Vico is imported for full charts; the public wrappers
 * ([LineChartWrapper], [BarChartWrapper], [AreaChartWrapper], `ComboChart`,
 * [MetricSwitcherChart], [ElevationProfile]) are thin presets over it, so pages
 * never depend on Vico directly.
 */
@Suppress("SpreadOperator")
@Composable
internal fun VicoCartesianChart(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    height: Dp = ChartDefaults.Height,
    hiddenKeys: Set<String> = emptySet(),
    markers: List<ChartVerticalMarker> = emptyList(),
    yValueFormatter: (Double) -> String = { ChartFormat.number(it, ChartDefaults.DECIMALS) },
    xValueFormatter: (String) -> String = { it },
    showStartAxis: Boolean = true,
    showBottomAxis: Boolean = true,
    showMarker: Boolean = true,
    emptyMessage: String = "",
) {
    val visible =
        remember(series, hiddenKeys) {
            series.filter { it.key !in hiddenKeys && finitePoints(it.values).isNotEmpty() }
        }
    if (visible.isEmpty()) {
        ChartEmptyState(message = emptyMessage, modifier = modifier, height = height)
        return
    }

    val indexByKey = remember(series) { series.mapIndexed { i, s -> s.key to i }.toMap() }
    val barSeries = remember(visible) { visible.filter { it.kind == ChartSeriesKind.Bar } }
    val lineSeriesList = remember(visible) { visible.filter { it.kind != ChartSeriesKind.Bar } }
    val summary =
        remember(series, xLabels, hiddenKeys) {
            accessibleSummary(series, xLabels.size, hiddenKeys, ChartDefaults.DECIMALS)
        }

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedModel(modelProducer, barSeries, lineSeriesList)

    val columnLayer: ColumnCartesianLayer? =
        if (barSeries.isNotEmpty()) {
            val columns =
                barSeries.map { s ->
                    rememberLineComponent(
                        fill = fill(seriesColor(s.color, indexByKey[s.key] ?: 0)),
                        thickness = COLUMN_THICKNESS,
                    )
                }
            rememberColumnCartesianLayer(ColumnCartesianLayer.ColumnProvider.series(columns))
        } else {
            null
        }

    val lineLayer: LineCartesianLayer? =
        if (lineSeriesList.isNotEmpty()) {
            val lines =
                lineSeriesList.map { s ->
                    val color = seriesColor(s.color, indexByKey[s.key] ?: 0)
                    LineCartesianLayer.rememberLine(
                        fill = LineCartesianLayer.LineFill.single(fill(color)),
                        areaFill =
                            if (s.kind == ChartSeriesKind.Area) {
                                LineCartesianLayer.AreaFill.single(fill(ChartGradient.solid(color)))
                            } else {
                                null
                            },
                    )
                }
            rememberLineCartesianLayer(LineCartesianLayer.LineProvider.series(lines))
        } else {
            null
        }

    val startAxis =
        if (showStartAxis) {
            VerticalAxis.rememberStart(
                valueFormatter = CartesianValueFormatter { _, value, _ -> yValueFormatter(value) },
            )
        } else {
            null
        }
    val bottomAxis =
        if (showBottomAxis) {
            HorizontalAxis.rememberBottom(
                valueFormatter =
                    CartesianValueFormatter { _, value, _ ->
                        xLabels.getOrNull(value.toInt())?.let(xValueFormatter).orEmpty()
                    },
            )
        } else {
            null
        }
    val marker = if (showMarker) rememberChartMarker() else null

    val layers: List<CartesianLayer<*>> = listOfNotNull(columnLayer, lineLayer)
    // The spread copies a list of at most two layers (column + line) built once per
    // recomposition, so the SpreadOperator cost flagged by detekt is negligible here.
    val chart =
        rememberCartesianChart(
            *layers.toTypedArray(),
            startAxis = startAxis,
            bottomAxis = bottomAxis,
            marker = marker,
        )

    Column(modifier = modifier) {
        if (markers.isNotEmpty()) {
            ChartMarkerRail(
                markers = markers,
                pointCount = xLabels.size,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        ProvideVicoTheme(rememberM3VicoTheme()) {
            CartesianChartHost(
                chart = chart,
                modelProducer = modelProducer,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(height)
                        .clearAndSetSemantics { contentDescription = summary },
                scrollState = rememberVicoScrollState(scrollEnabled = false),
            )
        }
    }
}

/** Feeds the current series data into [modelProducer], re-running when the data changes. */
@Composable
private fun LaunchedModel(
    modelProducer: CartesianChartModelProducer,
    barSeries: List<ChartSeries>,
    lineSeriesList: List<ChartSeries>,
) {
    androidx.compose.runtime.LaunchedEffect(barSeries, lineSeriesList) {
        modelProducer.runTransaction {
            if (barSeries.isNotEmpty()) {
                columnSeries {
                    barSeries.forEach { s ->
                        val points = finitePoints(s.values)
                        series(points.map { it.first }, points.map { it.second })
                    }
                }
            }
            if (lineSeriesList.isNotEmpty()) {
                lineSeries {
                    lineSeriesList.forEach { s ->
                        val points = finitePoints(s.values)
                        series(points.map { it.first }, points.map { it.second })
                    }
                }
            }
        }
    }
}

private val COLUMN_THICKNESS = 12.dp
