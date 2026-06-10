package io.teslasync.android.components.charts

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Shared sizing and behavior defaults for the chart layer. Centralized so every
 * wrapper renders at a consistent height and tick density without callers
 * re-specifying them. Values are A1-grid-aligned dp.
 */
object ChartDefaults {
    /** Default plot height for full charts (`LineChartWrapper`, `AreaChartWrapper`, …). */
    val Height: Dp = 240.dp

    /** Compact plot height for `MetricSwitcherChart` and small-multiples cells. */
    val CompactHeight: Dp = 180.dp

    /** Default radial-gauge diameter. */
    val GaugeSize: Dp = 120.dp

    /** Default `Sparkline`/`MiniChart` dimensions. */
    val SparklineWidth: Dp = 96.dp
    val SparklineHeight: Dp = 32.dp

    /** Target number of value-axis ticks fed to [niceAxisRange]. */
    const val AXIS_TICKS: Int = 5

    /** Default fraction digits for axes, tooltips, and the fallback table. */
    const val DECIMALS: Int = 1

    /** Per-cell point cap for `SmallMultiplesChart` downsampling (matches the web guard). */
    const val MAX_POINTS_PER_CELL: Int = 400
}
