package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Holder for a chart's visible time window — the Android counterpart of the web
 * `ChartTimeRangeContext`. `ChartBrush` drives it; charts read [start]/[end] (1-based
 * inclusive indices) to clip their data. The clamping math is the pure, JVM-tested
 * [clampWindow].
 */
@Stable
class ChartTimeRangeState internal constructor(
    val total: Int,
    initialStart: Int,
    initialEnd: Int,
) {
    var start: Int by mutableIntStateOf(initialStart)
        private set
    var end: Int by mutableIntStateOf(initialEnd)
        private set

    /** True when the whole series is visible (no zoom applied). */
    val isFullRange: Boolean
        get() = start <= 1 && end >= total

    /** Sets a window of [size] starting at [newStart] (both clamped to the data bounds). */
    fun setWindow(
        newStart: Int,
        size: Int,
    ) {
        val (s, e) = clampWindow(newStart, size, total)
        start = s
        end = e
    }

    /** Sets an explicit inclusive `[from, to]` window (clamped). */
    fun setBounds(
        from: Int,
        to: Int,
    ) {
        val (s, e) = clampWindow(from, to - from + 1, total)
        start = s
        end = e
    }

    /** Resets to the full range. */
    fun reset() {
        start = if (total > 0) 1 else 0
        end = total
    }
}

/** Remembers a [ChartTimeRangeState] for a series of [total] points, rebuilt when [total] changes. */
@Composable
fun rememberChartTimeRange(total: Int): ChartTimeRangeState =
    remember(total) {
        ChartTimeRangeState(total, if (total > 0) 1 else 0, total)
    }

/** The active cross-chart `syncId`, or `null` outside a [ChartSyncScope]. */
val LocalChartSyncId = staticCompositionLocalOf<String?> { null }

/**
 * Scopes a `syncId` to its [content] so descendant charts cursor-sync with each
 * other (via [CursorSyncStore]) and clears the persistent cursor on dispose, so
 * navigating away never leaks a stale cursor into the next screen.
 */
@Composable
fun ChartSyncScope(
    syncId: String,
    content: @Composable () -> Unit,
) {
    DisposableEffect(syncId) {
        onDispose { CursorSyncStore.clear(syncId) }
    }
    CompositionLocalProvider(LocalChartSyncId provides syncId, content = content)
}
