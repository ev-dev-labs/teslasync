// File named for its primary @Composable; the co-located point model is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.ChartPalette
import io.teslasync.android.ui.theme.generated.Spacing

/** One sample along a route: cumulative [distance], [elevation], and optional [speed]. */
data class ElevationPoint(
    val distance: Double,
    val elevation: Double,
    val speed: Double? = null,
)

/**
 * Elevation profile along a route — the Android counterpart of the web
 * `ElevationProfile`. A gradient-filled area of elevation vs. distance, a cumulative
 * gain/loss caption, and an optional cursor marker at [currentIndex] (the replay
 * position). Built on [AreaChartWrapper] so it inherits real empty/loading states.
 */
@Composable
fun ElevationProfile(
    points: List<ElevationPoint>,
    modifier: Modifier = Modifier,
    title: String? = null,
    currentIndex: Int? = null,
    height: Dp = ChartDefaults.CompactHeight,
    distanceUnit: String = "km",
    elevationUnit: String = "m",
    emptyMessage: String = "",
) {
    if (points.isEmpty()) {
        Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (title != null) PanelTitle(title)
            ChartEmptyState(message = emptyMessage, height = height)
        }
        return
    }

    val series =
        remember(points) {
            listOf(
                ChartSeries(
                    key = "elevation",
                    label = "Elevation",
                    values = points.map { it.elevation },
                    kind = ChartSeriesKind.Area,
                    color = ChartPalette.battery,
                    unit = elevationUnit,
                ),
            )
        }
    val xLabels = remember(points) { points.map { ChartFormat.number(it.distance, 1) } }
    val gainLoss = remember(points) { elevationGainLoss(points.map { it.elevation }) }
    val markers =
        if (currentIndex != null && currentIndex in points.indices) {
            listOf(
                ChartVerticalMarker(
                    index = currentIndex,
                    label = ChartFormat.withUnit(points[currentIndex].distance, distanceUnit, 1),
                    severity = MarkerSeverity.Info,
                ),
            )
        } else {
            emptyList()
        }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        if (title != null) PanelTitle(title)
        Caption(
            "\u2191 ${ChartFormat.withUnit(gainLoss.gain, elevationUnit, 0)}  " +
                "\u2193 ${ChartFormat.withUnit(gainLoss.loss, elevationUnit, 0)}",
        )
        AreaChartWrapper(
            series = series,
            xLabels = xLabels,
            height = height,
            markers = markers,
            yValueFormatter = { ChartFormat.withUnit(it, elevationUnit, 0) },
            emptyMessage = emptyMessage,
        )
    }
}
