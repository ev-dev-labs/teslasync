package io.teslasync.android.components.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Grid of mini line charts, one per series — the Android counterpart of the web
 * `SmallMultiplesChart` ("trellis"). Each cell gets its own y-scale so series of
 * very different magnitudes don't flatten each other. Dense series are stride-
 * downsampled per cell ([ChartDefaults.MAX_POINTS_PER_CELL]); a cross-cell cursor from
 * [CursorSyncStore] (keyed by [syncId]) draws an aligned guide in every cell.
 *
 * Cells use the same compact [VicoCartesianChart] as the full charts (axes/marker
 * off) so the whole grid stays Vico-based, with a precise Canvas cursor overlay
 * that aligns exactly because the axis-less plot fills the cell.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SmallMultiplesChart(
    series: List<ChartSeries>,
    xLabels: List<String>,
    modifier: Modifier = Modifier,
    columns: Int = 2,
    cellHeight: Dp = ChartDefaults.CompactHeight,
    syncId: String? = null,
    onCellClick: ((String) -> Unit)? = null,
    emptyCellLabel: String = "",
    maxPointsPerCell: Int = ChartDefaults.MAX_POINTS_PER_CELL,
) {
    if (series.isEmpty()) {
        ChartEmptyState(message = emptyCellLabel, modifier = modifier, height = cellHeight)
        return
    }
    val cols = columns.coerceAtLeast(1)
    val cursorIndex = cursorSyncPosition(syncId)
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        maxItemsInEachRow = cols,
    ) {
        series.forEachIndexed { index, chartSeries ->
            SmallMultiplesCell(
                series = chartSeries,
                xLabels = xLabels,
                colorIndex = index,
                cellHeight = cellHeight,
                cursorIndex = cursorIndex,
                onClick = onCellClick,
                emptyCellLabel = emptyCellLabel,
                maxPointsPerCell = maxPointsPerCell,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SmallMultiplesCell(
    series: ChartSeries,
    xLabels: List<String>,
    colorIndex: Int,
    cellHeight: Dp,
    cursorIndex: Int?,
    onClick: ((String) -> Unit)?,
    emptyCellLabel: String,
    maxPointsPerCell: Int,
    modifier: Modifier = Modifier,
) {
    val color = seriesColor(series.color, colorIndex)
    val sampledIndices =
        remember(series.values.size, maxPointsPerCell) {
            sampleIndices(series.values.size, maxPointsPerCell)
        }
    val cellSeries =
        remember(series, color, sampledIndices) {
            series.copy(
                kind = ChartSeriesKind.Line,
                color = color,
                values = sampledIndices.map { series.values.getOrNull(it) },
            )
        }
    val cellLabels = remember(xLabels, sampledIndices) { sampledIndices.map { xLabels.getOrNull(it).orEmpty() } }
    val cursorPos =
        remember(cursorIndex, sampledIndices) {
            cursorIndex?.let { sampledIndices.indexOf(it).takeIf { pos -> pos >= 0 } }
        }
    val cursorColor = markerColor(MarkerSeverity.Info)

    val cardModifier = if (onClick != null) modifier.clickable { onClick(series.key) } else modifier
    Card(modifier = cardModifier, padding = CardPadding.Sm) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier =
                    Modifier
                        .padding(end = Spacing.xs)
                        .size(SWATCH_SIZE)
                        .clip(CircleShape)
                        .background(color),
            )
            Caption(series.label)
        }
        Box(modifier = Modifier.fillMaxWidth()) {
            VicoCartesianChart(
                series = listOf(cellSeries),
                xLabels = cellLabels,
                height = cellHeight,
                showStartAxis = false,
                showBottomAxis = false,
                showMarker = false,
                emptyMessage = emptyCellLabel,
            )
            if (cursorPos != null) {
                val fraction = fractionForIndex(cursorPos, cellLabels.size)
                Canvas(modifier = Modifier.matchParentSize()) {
                    val x = size.width * fraction
                    drawLine(
                        color = cursorColor,
                        start = Offset(x, 0f),
                        end = Offset(x, size.height),
                        strokeWidth = CURSOR_STROKE.toPx(),
                    )
                }
            }
        }
    }
}

private val SWATCH_SIZE = 8.dp
private val CURSOR_STROKE = 1.5.dp
