package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.RangeSlider
import kotlin.math.roundToInt

/**
 * Time-range brush — the Android counterpart of the web `ChartBrush`. A dual-thumb
 * range slider over the series' index domain that drives a [ChartTimeRangeState] so
 * charts sharing it zoom to the selected window. Commits on thumb release (mirroring
 * recharts' brush). Renders nothing for a single-point series.
 */
@Composable
fun ChartBrush(
    range: ChartTimeRangeState,
    modifier: Modifier = Modifier,
    label: String? = null,
    valueText: ((start: Int, end: Int) -> String)? = null,
) {
    if (range.total <= 1) return
    var selection by remember(range.start, range.end) {
        mutableStateOf(range.start.toFloat()..range.end.toFloat())
    }
    val start = selection.start.roundToInt()
    val end = selection.endInclusive.roundToInt()
    RangeSlider(
        value = selection,
        onValueChange = { selection = it },
        modifier = modifier,
        label = label,
        valueText = valueText?.invoke(start, end),
        valueRange = 1f..range.total.toFloat(),
        steps = (range.total - 2).coerceAtLeast(0),
        onValueChangeFinished = { range.setBounds(start, end) },
    )
}
