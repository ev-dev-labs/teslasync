package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Marks the time of an alert (or any point-in-time event) on a chart — the Android
 * counterpart of the web `TimeMarker`. Builds a single severity-colored
 * [ChartVerticalMarker] and renders it on the [ChartMarkerRail]. Renders nothing when
 * [index] is `null`/out of range. [pointCount] is the chart's x-axis length so the
 * marker lands at the right fraction.
 */
@Composable
fun TimeMarker(
    index: Int?,
    pointCount: Int,
    modifier: Modifier = Modifier,
    severity: MarkerSeverity = MarkerSeverity.Warn,
    label: String = "Alert",
    onClick: (() -> Unit)? = null,
) {
    if (index == null || index < 0 || index >= pointCount) return
    ChartMarkerRail(
        markers = listOf(timeMarker(index, severity, label)),
        pointCount = pointCount,
        modifier = modifier,
        onMarkerClick = onClick?.let { callback -> { callback() } },
    )
}

/** Builds a [ChartVerticalMarker] for a point-in-time event (alert, milestone). */
fun timeMarker(
    index: Int,
    severity: MarkerSeverity = MarkerSeverity.Warn,
    label: String = "Alert",
): ChartVerticalMarker = ChartVerticalMarker(index = index, label = label, severity = severity)
