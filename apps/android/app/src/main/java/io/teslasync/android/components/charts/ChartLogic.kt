package io.teslasync.android.components.charts

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/*
 * Framework-free chart math and data shaping shared by every wrapper in this
 * package. Extracted so the behavior (axis ranges, gap handling, downsampling,
 * sparkline/gauge geometry, the accessible summary + fallback table, legend and
 * time-range state transitions) is covered by fast JVM unit tests in the
 * `:android:testDebugUnitTest` gate, independent of the Compose/Vico render layer.
 */

/** A "nice" axis range with rounded [min]/[max] bounds and a uniform [step]. */
data class NiceAxisRange(
    val min: Double,
    val max: Double,
    val step: Double,
)

/** Cumulative rise ([gain]) and fall ([loss]) across an elevation-like series. */
data class GainLoss(
    val gain: Double,
    val loss: Double,
)

/** The non-null, finite `(index, value)` samples of a series (the Android `connectNulls`). */
fun finitePoints(values: List<Double?>): List<Pair<Int, Double>> =
    values.mapIndexedNotNull { index, v ->
        if (v != null && v.isFinite()) index to v else null
    }

/** True when at least one visible series has a finite sample. */
fun hasAnyData(
    series: List<ChartSeries>,
    hiddenKeys: Set<String> = emptySet(),
): Boolean = series.any { it.key !in hiddenKeys && finitePoints(it.values).isNotEmpty() }

/** Min/max across all visible finite samples, or `null` when there is nothing to plot. */
fun visibleExtent(
    series: List<ChartSeries>,
    hiddenKeys: Set<String> = emptySet(),
): ClosedFloatingPointRange<Double>? {
    var lo = Double.POSITIVE_INFINITY
    var hi = Double.NEGATIVE_INFINITY
    for (s in series) {
        if (s.key in hiddenKeys) continue
        for ((_, v) in finitePoints(s.values)) {
            if (v < lo) lo = v
            if (v > hi) hi = v
        }
    }
    return if (lo <= hi) lo..hi else null
}

/**
 * "Nice numbers" axis bounds (Heckbert) so gridlines land on human-friendly
 * values. Guards flat and non-finite inputs so a constant series still renders.
 */
fun niceAxisRange(
    min: Double,
    max: Double,
    maxTicks: Int = 5,
): NiceAxisRange {
    if (!min.isFinite() || !max.isFinite()) return NiceAxisRange(0.0, 1.0, 1.0)
    var lo = minOf(min, max)
    var hi = maxOf(min, max)
    if (lo == hi) {
        if (lo == 0.0) {
            hi = 1.0
        } else {
            val pad = abs(lo) * FLAT_PAD_FRACTION
            lo -= pad
            hi += pad
        }
    }
    val ticks = maxOf(2, maxTicks)
    val range = niceNum(hi - lo, round = false)
    val step = niceNum(range / (ticks - 1), round = true)
    return NiceAxisRange(floor(lo / step) * step, ceil(hi / step) * step, step)
}

private fun niceNum(
    range: Double,
    round: Boolean,
): Double {
    if (range <= 0.0) return 1.0
    val exponent = floor(log10(range))
    val fraction = range / 10.0.pow(exponent)
    val niceFraction =
        if (round) {
            when {
                fraction < 1.5 -> 1.0
                fraction < 3.0 -> 2.0
                fraction < 7.0 -> 5.0
                else -> 10.0
            }
        } else {
            when {
                fraction <= 1.0 -> 1.0
                fraction <= 2.0 -> 2.0
                fraction <= 5.0 -> 5.0
                else -> 10.0
            }
        }
    return niceFraction * 10.0.pow(exponent)
}

/**
 * Stride-downsamples [rows] to at most [cap] entries, always preserving the first
 * and last. Mirrors the web `SmallMultiplesChart` perf guard so dense series stay
 * cheap to render.
 */
fun <T> strideSample(
    rows: List<T>,
    cap: Int,
): List<T> = sampleIndices(rows.size, cap).map { rows[it] }

/**
 * The original indices kept by a stride downsample of a [size]-length series to at
 * most [cap] points, always including the first and last index. Lets callers
 * downsample several parallel arrays (values + labels) consistently and remap a
 * cursor index into the sampled space.
 */
fun sampleIndices(
    size: Int,
    cap: Int,
): List<Int> {
    if (size <= 0 || cap <= 0) return emptyList()
    return if (size <= cap) {
        (0 until size).toList()
    } else {
        buildList {
            val stride = ((size + cap - 1) / cap).coerceAtLeast(1)
            var i = 0
            while (i < size) {
                add(i)
                i += stride
            }
            if (last() != size - 1) add(size - 1)
        }
    }
}

/**
 * Maps [values] to pixel-space points for the Canvas sparkline/mini-chart, fitting
 * the finite samples into `[padding, size-padding]`. A flat series sits on the
 * vertical center. Returns an empty list when fewer than two points are finite.
 */
fun sparklinePoints(
    values: List<Double?>,
    width: Float,
    height: Float,
    padding: Float = 0f,
): List<ChartPointF> {
    val pts = finitePoints(values)
    if (pts.size < 2 || width <= 0f || height <= 0f) return emptyList()
    val minV = pts.minOf { it.second }
    val maxV = pts.maxOf { it.second }
    val range = (maxV - minV).takeIf { it != 0.0 } ?: 1.0
    val innerW = (width - padding * 2).coerceAtLeast(0f)
    val innerH = (height - padding * 2).coerceAtLeast(0f)
    val lastIndex = (values.size - 1).coerceAtLeast(1)
    return pts.map { (index, v) ->
        val x = padding + (index.toFloat() / lastIndex) * innerW
        val norm = ((v - minV) / range).toFloat()
        val y = padding + innerH - norm * innerH
        ChartPointF(x, y)
    }
}

/** Clamps a gauge value into the `0f..1f` sweep fraction of [max]. */
fun gaugeFraction(
    value: Double,
    max: Double,
): Float {
    if (max <= 0.0 || !value.isFinite() || !max.isFinite()) return 0f
    return (value / max).coerceIn(0.0, 1.0).toFloat()
}

/** Cumulative rise/fall across the finite samples of [values] (elevation gain/loss). */
fun elevationGainLoss(values: List<Double?>): GainLoss {
    val pts = finitePoints(values).map { it.second }
    var gain = 0.0
    var loss = 0.0
    for (i in 1 until pts.size) {
        val diff = pts[i] - pts[i - 1]
        if (diff > 0) gain += diff else loss += abs(diff)
    }
    return GainLoss(gain, loss)
}

/** Adds [key] if absent, removes it if present — the legend/hidden-series toggle. */
fun toggleKey(
    keys: Set<String>,
    key: String,
): Set<String> = if (key in keys) keys - key else keys + key

/**
 * 1-based inclusive `[start, end]` window over [total] items, clamped so it never
 * runs past the ends while preserving the requested [size]. `(0, 0)` means empty.
 * Backs `ChartBrush`'s range selection.
 */
fun clampWindow(
    start: Int,
    size: Int,
    total: Int,
): Pair<Int, Int> {
    if (total <= 0 || size <= 0) return 0 to 0
    val span = size.coerceIn(1, total)
    val maxStart = total - span + 1
    val clampedStart = start.coerceIn(1, maxStart)
    return clampedStart to (clampedStart + span - 1)
}

/** Nearest sample index for a horizontal [fraction] of `[0,1]` across [count] points. */
fun indexForFraction(
    fraction: Float,
    count: Int,
): Int {
    if (count <= 1) return 0
    val clamped = fraction.coerceIn(0f, 1f)
    return (clamped * (count - 1)).roundToInt().coerceIn(0, count - 1)
}

/** Horizontal fraction `[0,1]` for a sample [index] across [count] points. */
fun fractionForIndex(
    index: Int,
    count: Int,
): Float {
    if (count <= 1) return 0f
    return (index.toFloat() / (count - 1)).coerceIn(0f, 1f)
}

/**
 * One-line, screen-reader-friendly description of the chart: shape, series count,
 * point count, and each visible series' range + latest value. Mirrors the intent
 * of the web `ChartContainer` `ariaLabel`/`ariaDescription`.
 */
fun accessibleSummary(
    series: List<ChartSeries>,
    pointCount: Int,
    hiddenKeys: Set<String> = emptySet(),
    decimals: Int = 1,
): String {
    val visible = series.filter { it.key !in hiddenKeys }
    if (visible.isEmpty() || pointCount == 0) {
        return "Chart with no data."
    }
    val shape =
        when {
            visible.all { it.kind == ChartSeriesKind.Bar } -> "Bar chart"
            visible.all { it.kind == ChartSeriesKind.Area } -> "Area chart"
            visible.all { it.kind == ChartSeriesKind.Line } -> "Line chart"
            else -> "Combination chart"
        }
    val head = "$shape with ${visible.size} series over $pointCount points."
    val parts =
        visible.joinToString(separator = " ") { s ->
            val pts = finitePoints(s.values)
            if (pts.isEmpty()) {
                "${s.label}: no data."
            } else {
                val lo = ChartFormat.number(pts.minOf { it.second }, decimals)
                val hi = ChartFormat.number(pts.maxOf { it.second }, decimals)
                val last = ChartFormat.withUnit(pts.last().second, s.unit, decimals)
                "${s.label} ranges $lo to $hi, latest $last."
            }
        }
    return "$head $parts"
}

/** Header row for the accessible fallback table: the x label column + each visible series. */
fun tableHeader(
    series: List<ChartSeries>,
    xHeader: String,
    hiddenKeys: Set<String> = emptySet(),
): List<String> = listOf(xHeader) + series.filter { it.key !in hiddenKeys }.map { it.label }

/**
 * Body rows for the accessible fallback table — one row per x label, each cell the
 * formatted series value (or em dash). This is the SR/forced-colors equivalent of
 * the web `ChartContainer` `data`/`dataColumns` table.
 */
fun tableRows(
    series: List<ChartSeries>,
    xLabels: List<String>,
    hiddenKeys: Set<String> = emptySet(),
    decimals: Int = 1,
): List<List<String>> {
    val visible = series.filter { it.key !in hiddenKeys }
    val rowCount = max(xLabels.size, visible.maxOfOrNull { it.values.size } ?: 0)
    return (0 until rowCount).map { row ->
        val label = xLabels.getOrNull(row) ?: (row + 1).toString()
        listOf(label) +
            visible.map { s ->
                ChartFormat.withUnit(s.values.getOrNull(row), s.unit, decimals)
            }
    }
}

/** RFC-4180-ish CSV text from a [header] + [rows] (quotes/escapes embedded separators). */
fun csvText(
    header: List<String>,
    rows: List<List<String>>,
): String {
    val sb = StringBuilder()

    fun appendRow(cells: List<String>) {
        sb.append(cells.joinToString(",") { escapeCsv(it) })
        sb.append('\n')
    }
    appendRow(header)
    rows.forEach(::appendRow)
    return sb.toString()
}

private fun escapeCsv(cell: String): String =
    if (cell.any { it == ',' || it == '"' || it == '\n' }) {
        "\"" + cell.replace("\"", "\"\"") + "\""
    } else {
        cell
    }

private const val FLAT_PAD_FRACTION = 0.1
