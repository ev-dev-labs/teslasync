package io.teslasync.android.components.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Renders point-in-time markers (annotations, alert times, the replay cursor) as an
 * aligned rail above the plot. This is the Android-native stand-in for the web
 * `<ReferenceLine>` overlay: Vico 2.0 has no public vertical-line decoration, so each
 * marker is a severity-colored pin positioned by its x-axis fraction. Pins are
 * tappable and carry a screen-reader [ChartVerticalMarker.label]; the readable list
 * is provided alongside by `AnnotationList`.
 */
@Composable
fun ChartMarkerRail(
    markers: List<ChartVerticalMarker>,
    pointCount: Int,
    modifier: Modifier = Modifier,
    onMarkerClick: ((ChartVerticalMarker) -> Unit)? = null,
) {
    if (markers.isEmpty() || pointCount <= 0) return
    val density = LocalDensity.current
    BoxWithConstraints(modifier.fillMaxWidth().height(RAIL_HEIGHT)) {
        val widthPx = constraints.maxWidth.toFloat()
        val pinHalfPx = with(density) { PIN_WIDTH.toPx() / 2f }
        markers.forEach { marker ->
            val fraction = fractionForIndex(marker.index, pointCount)
            val xPx = widthPx * fraction - pinHalfPx
            MarkerPin(
                marker = marker,
                onClick = onMarkerClick,
                modifier = Modifier.offset { IntOffset(xPx.roundToInt(), 0) },
            )
        }
    }
}

/**
 * Convenience layer that projects [annotations] onto the marker rail and reports the
 * tapped annotation back. Mirrors the web `renderAnnotationLines` entry point.
 */
@Composable
fun ChartAnnotationLayer(
    annotations: List<DataAnnotation>,
    pointCount: Int,
    modifier: Modifier = Modifier,
    onAnnotationClick: ((DataAnnotation) -> Unit)? = null,
) {
    val markers = remember(annotations) { annotationMarkers(annotations) }
    ChartMarkerRail(
        markers = markers,
        pointCount = pointCount,
        modifier = modifier,
        onMarkerClick =
            onAnnotationClick?.let { callback ->
                { marker -> annotations.firstOrNull { it.id == marker.id }?.let(callback) }
            },
    )
}

@Composable
private fun MarkerPin(
    marker: ChartVerticalMarker,
    onClick: ((ChartVerticalMarker) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val color = resolveMarkerColor(marker)
    val base =
        modifier
            .width(PIN_WIDTH)
            .semantics { contentDescription = marker.label }
    val interactive = if (onClick != null) base.clickable { onClick(marker) } else base
    Column(
        modifier = interactive,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(modifier = Modifier.size(DOT_SIZE).clip(CircleShape).background(color))
        Box(
            modifier =
                Modifier
                    .width(TICK_WIDTH)
                    .height(TICK_HEIGHT)
                    .background(color.copy(alpha = TICK_ALPHA)),
        )
    }
}

private val RAIL_HEIGHT = 22.dp
private val PIN_WIDTH = 12.dp
private val DOT_SIZE = 8.dp
private val TICK_WIDTH = 2.dp
private val TICK_HEIGHT = 10.dp
private const val TICK_ALPHA = 0.6f
